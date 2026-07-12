/**
 * GrabOperationHandler — manages G-key grab/move operations.
 *
 * Encapsulates all grab state and the start/apply/confirm/cancel lifecycle
 * for Solid, CoordinateFrame, and all other entity types that support grab.
 *
 * Owned by AppController as this._grabHandler.
 * Accesses parent controller via this._ctrl.
 */

import * as THREE from 'three'
import { CoordinateFrame } from '../../domain/CoordinateFrame.js'
import { Solid }           from '../../domain/Solid.js'
import { MeasureLine }     from '../../domain/MeasureLine.js'
import { ImportedMesh }    from '../../domain/ImportedMesh.js'
import { SpatialLink }     from '../../domain/SpatialLink.js'
import { AnnotatedLine }   from '../../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../../domain/AnnotatedPoint.js'
import { RoleService }     from '../../service/RoleService.js'
import { createMoveCommand } from '../../command/MoveCommand.js'
import { S_GRAB_ACTIVE }   from '../../core/editorStates.js'
import {
  getCentroid,
  getPivotCandidates,
  getVertexPivotCandidates,
  getEdgePivotCandidates,
  getFacePivotCandidates,
  collectSnapTargets,
  collectWorldSnapTargets,
} from '../../model/CuboidModel.js'
import { computeApproachWarmth } from '../../service/SemanticInferencer.js'
import { projectToScreen, pickBestSnapTarget } from '../snap/SnapSystem.js'
import { boundsOf } from '../../view/CommandFeedbackMath.js'
import {
  geometrySnapshot,
  stackSnapshot,
  snapTransition,
  snapFlashDescriptor,
} from '../../view/SnapFeedbackMath.js'
import { COLOR } from '../../theme/tokens.js'

/**
 * Returns the appropriate handles array for grab/move operations.
 * Geometry entities → world-space corners; CoordinateFrame → localOffset.
 * @param {object} obj  scene entity
 * @returns {import('three').Vector3[]}
 */
function _grabHandlesOf(obj) {
  return (obj instanceof CoordinateFrame) ? obj.localOffset : obj.corners
}

export class GrabOperationHandler {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /**
     * All mutable grab state — accessed externally via .state or getters.
     * @type {object}
     */
    this.state = {
      /** World axis constraint: null = free, 'x'|'y'|'z' = world axes. */
      axis:            null,
      /** Mouse position at grab start (NDC). */
      startMouse:      new THREE.Vector2(),
      /** Grab-handle snapshots for the active object at grab start. */
      startCorners:    [],
      /** @type {Map<string, import('three').Vector3[]>} corners snapshot for all selected objects */
      allStartCorners: new Map(),
      /** @type {Map<string, import('three').Vector3[]>} corners at the start of the current drag segment (touch re-grab) */
      segmentStartCorners: new Map(),
      /** @type {Map<string, import('three').Vector3>} Solid._position snapshot at segment start (ADR-040) */
      segmentStartPositions: new Map(),
      /** Centroid of the grabbed selection (updated on segment re-start). */
      centroid:        new THREE.Vector3(),
      /** Custom pivot point (changes after V pivot selection). */
      pivot:           new THREE.Vector3(),
      /** Display label for the current pivot. */
      pivotLabel:      'Centroid',
      /** Camera-facing drag plane. */
      dragPlane:       new THREE.Plane(),
      /** World-space intersection point at grab start. */
      startPoint:      new THREE.Vector3(),
      /** Numeric distance string typed by the user; empty when mouse-driven. */
      inputStr:        '',
      /** True when the user has typed at least one digit. */
      hasInput:        false,
      /** True when the handler is in pivot-selection sub-mode. */
      pivotSelectMode: false,
      /** Index of the currently hovered pivot candidate, or -1. */
      hoveredPivotIdx: -1,
      /** Current pivot candidates (recomputed on pivot-select entry and mode change). */
      candidates:      [],
      /** Current candidate filter in pivot select mode: 'all'|'vertex'|'edge'|'face' */
      pivotMode:       'all',
      /** True when a snap target is currently locked. */
      snapping:        false,
      /** Set to true after G→V pivot confirm; enables auto-snap without Ctrl. */
      autoSnap:        false,
      /** The snap target currently locked to, or null. */
      snappedTarget:   null,
      /** Snap target filter: 'all'|'vertex'|'edge'|'face' */
      snapMode:        'all',
      /** All snap candidates from last _trySnapToGeometry call (for display). */
      snapTargets:     [],
      /** Grid snap unit size (Ctrl during grab). Cycled with Ctrl+Wheel. */
      gridSize:        1,
      /** When true, grabbed object snaps Z so its bottom rests on the top surface below. */
      stackMode:       false,
      /** True when stacking is actively snapping Z this frame. */
      stacking:        false,
      /** Bottom-face centre at the landing surface while stacking (flash anchor). @type {{x:number,y:number,z:number}|null} */
      stackContact:    null,
      /** Last delta applied via _applyDeltaToAll; used for live coordinate display. */
      lastDelta:       new THREE.Vector3(),
      /** True when a live semantic suggestion is showing during G-key grab (ADR-041 Phase 3). */
      isSuggesting:    false,
      /** The suggestion currently displayed, or null. @type {object|null} */
      currentSuggestion: null,
    }

    /**
     * Controller-local presentation history for the snap engagement flash
     * (ADR-065 Phase 2): the previous frame's per-channel snap snapshots.
     * Never a store field (same rule as grasp hover / `_ghostData`).
     * @type {{geometry: {key:string}|null, stack: {key:string}|null}}
     */
    this._snapFxPrev = { geometry: null, stack: null }
  }

  /** Grid snap sizes cycled by Ctrl+Wheel during grab. */
  static get GRID_SIZES() { return [0.1, 0.25, 0.5, 1, 2.5, 5, 10] }

  // ── Convenience getters (used by AppController toolbars / wheel handler) ───

  get axis()           { return this.state.axis }
  get stackMode()      { return this.state.stackMode }
  get pivotSelectMode(){ return this.state.pivotSelectMode }
  get hoveredPivotIdx(){ return this.state.hoveredPivotIdx }
  get isSuggesting()   { return this.state.isSuggesting }
  get currentSuggestion() { return this.state.currentSuggestion }

  /**
   * Cycles the Ctrl-snap grid size through GRID_SIZES (Ctrl+Wheel during grab).
   * @param {number} deltaY  Wheel delta — positive = coarser grid, negative = finer.
   */
  cycleGridSize(deltaY) {
    const sizes = GrabOperationHandler.GRID_SIZES
    const cur   = sizes.indexOf(this.state.gridSize)
    const idx   = cur >= 0 ? cur : Math.max(sizes.findIndex(s => s >= this.state.gridSize), 0)
    const next  = deltaY > 0
      ? Math.min(idx + 1, sizes.length - 1)
      : Math.max(idx - 1, 0)
    this.state.gridSize = sizes[next]
    this.apply()
    this.updateStatus()
  }

  // ── Public operation lifecycle ─────────────────────────────────────────────

  /**
   * Starts grab mode for the currently selected entity/entities.
   * Runs all domain guards (SpatialLink, Origin CF, Role, semantic guardrail)
   * before transitioning to S_GRAB_ACTIVE.
   */
  start() {
    const { _ctrl: ctrl } = this
    ctrl._uiView.dismissSemanticSuggestion()
    if (!ctrl._objSelected) return
    // SpatialLink has no geometry — cannot be grabbed (ADR-030)
    if (ctrl._activeObj instanceof SpatialLink) {
      ctrl._uiView.showToast('SpatialLink cannot be grabbed', { type: 'warn' })
      return
    }
    // Origin frames are fixed at the Solid centroid — cannot be grabbed (ADR-037)
    if (ctrl._activeObj instanceof CoordinateFrame && ctrl._activeObj.name === 'Origin') {
      ctrl._uiView.showToast('Origin frame is fixed at the centroid', { type: 'warn' })
      return
    }
    // Provenance check: block grab if frame was declared by a different role (ADR-034 §8.2)
    if (ctrl._activeObj instanceof CoordinateFrame && !RoleService.canEdit(ctrl._activeObj)) {
      ctrl._uiView.showToast(`This frame was declared by a ${ctrl._activeObj.declaredBy}. Switch to that role to edit it.`, { type: 'warn' })
      return
    }
    // Semantic guardrail: block grab when any selected entity is fastened or mounted to
    // an entity outside the selection (PHILOSOPHY #1 — One Authoritative Entry Point).
    const grabGuardrail = ctrl._service.checkMoveGuardrail(ctrl._selectedIds)
    if (grabGuardrail.blocked) {
      ctrl._uiView.showToast(grabGuardrail.message, { type: 'warn' })
      return
    }
    // All domain guards passed → mutual exclusion + state transition
    if (!ctrl._opState.send('BEGIN_GRAB')) return
    // Rubber-band: activate marching ants + tension for links connected to dragged entities.
    ctrl._service.setLinkDragging(ctrl._selectedIds, true)

    const s = this.state
    s.axis            = null
    s.inputStr        = ''
    s.hasInput        = false
    s.pivotSelectMode = false
    s.hoveredPivotIdx = -1
    s.snapMode        = 'all'
    s.snapTargets     = []
    s.startMouse.copy(ctrl._mouse)
    s.startCorners = ctrl._corners.map(c => c.clone())
    // Snapshot corners of every selected object for multi-object grab
    s.allStartCorners = new Map()
    for (const id of ctrl._selectedIds) {
      const selObj = ctrl._scene.getObject(id)
      if (selObj) s.allStartCorners.set(id, _grabHandlesOf(selObj).map(c => c.clone()))
    }
    // segmentStartCorners tracks the start of each individual drag segment (touch).
    // Initially identical to allStartCorners; re-snapshotted on each touch re-down.
    s.segmentStartCorners = new Map(
      [...s.allStartCorners.entries()].map(([id, cs]) => [id, cs.map(c => c.clone())])
    )
    // Solid _position snapshots for move() — separate from corner snapshots (ADR-040)
    s.segmentStartPositions = new Map()
    for (const id of ctrl._selectedIds) {
      const selObj = ctrl._scene.getObject(id)
      if (selObj instanceof Solid) s.segmentStartPositions.set(id, selObj._position.clone())
    }
    // For CoordinateFrame, corners = [translation] (parent-relative offset).
    // Use the world position from the cache so the drag plane passes through
    // the frame's actual world location (ADR-020).
    const grabCenter = (ctrl._activeObj instanceof CoordinateFrame)
      ? (ctrl._service.worldPoseOf(ctrl._activeObj.id)?.position?.clone() ?? getCentroid(ctrl._corners))
      : (ctrl._activeObj instanceof Solid ? ctrl._activeObj._position.clone() : getCentroid(ctrl._corners))
    s.centroid.copy(grabCenter)
    s.pivot.copy(s.centroid)
    s.lastDelta.set(0, 0, 0)
    s.pivotLabel       = 'Centroid'
    s.autoSnap         = false
    s.isSuggesting     = false
    s.currentSuggestion = null
    this._snapFxPrev   = { geometry: null, stack: null } // fresh gesture — no engagement carried over

    // ADR-032 §6: for mounted Annotated* entities, constrain drag to host local XY plane.
    // For unmounted Annotated* entities, constrain to world XY (prevents Z drift).
    // For all other entities, use the camera-facing plane (existing behaviour).
    const isAnnotated = ctrl._activeObj instanceof AnnotatedLine ||
      ctrl._activeObj instanceof AnnotatedRegion ||
      ctrl._activeObj instanceof AnnotatedPoint
    let planeNormal = null
    if (isAnnotated) {
      const mountLink = ctrl._scene.getMountsLink(ctrl._scene.activeId)
      if (mountLink) {
        // Mounted: use host CoordinateFrame's local Z axis as drag plane normal
        const hostPose = ctrl._service.worldPoseOf(mountLink.targetId)
        if (hostPose) {
          planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(hostPose.quaternion)
        }
      }
      if (!planeNormal) {
        // Unmounted Annotated*: use world Z (XY plane)
        planeNormal = new THREE.Vector3(0, 0, 1)
      }
    } else {
      const camDir = new THREE.Vector3()
      ctrl._camera.getWorldDirection(camDir)
      planeNormal = camDir
    }
    s.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, s.pivot)

    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const pt = new THREE.Vector3()
    if (ctrl._raycaster.ray.intersectPlane(s.dragPlane, pt)) {
      s.startPoint.copy(pt)
    } else {
      s.startPoint.copy(s.pivot)
    }

    ctrl._controls.enabled = false
    ctrl._uiView.setCursor('grabbing')
    this.updateStatus()
    ctrl._updateMobileToolbar()
  }

  /**
   * Confirms the current grab and exits grab mode.
   * Records an undo command and runs semantic inference.
   */
  confirm() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_GRAB_ACTIVE)) return
    const s = this.state
    if (s.pivotSelectMode) { this.cancelPivotSelect(); return }
    // Clear live suggestion ghost before final state is committed (Drag Suggestion Lifecycle).
    if (s.isSuggesting) {
      s.isSuggesting      = false
      s.currentSuggestion = null
      ctrl._quickDragCtx.hideDragSuggestion()
    }
    // Clear approach warmth on all Solids.
    for (const obj of ctrl._scene.objects.values()) {
      if (obj instanceof Solid) obj.meshView?.setApproachWarmth(0)
    }
    this.apply()

    // ADR-032 §6: after grab on mounted Annotated* entities, sync local positions
    // so _updateMountedAnnotations uses the new world positions going forward.
    for (const id of ctrl._selectedIds) {
      ctrl._service.syncMountedPosition(id)
    }

    // ── Record undo snapshot (ADR-022 Phase 1) ────────────────────────────
    const endCornersMap = new Map()
    for (const id of ctrl._selectedIds) {
      const obj = ctrl._scene.getObject(id)
      if (obj) endCornersMap.set(id, _grabHandlesOf(obj).map(c => c.clone()))
    }
    if (endCornersMap.size > 0) {
      const label = endCornersMap.size === 1 ? 'Move' : `Move ${endCornersMap.size} objects`
      const cmd = createMoveCommand(label, s.allStartCorners, endCornersMap, ctrl._scene, ctrl._service)
      ctrl._commandStack.push(cmd)
    }

    s.axis          = null
    s.autoSnap      = false
    s.snappedTarget = null
    s.stackMode     = false
    s.stacking      = false
    this._snapFxPrev = { geometry: null, stack: null }
    ctrl._meshView.clearPivotDisplay()
    ctrl._meshView.clearSnapDisplay()
    ctrl._opState.send('CONFIRM')
    // Rubber-band: end drag animation; stay highlighted since entity is still selected.
    ctrl._service.setLinkDragging(new Set(), false)
    ctrl._service.updateLinkSelectionHighlight(ctrl._selectedIds)
    ctrl._controls.enabled = true
    ctrl._uiView.setCursor('default')
    ctrl._refreshObjectModeStatus()
    ctrl._updateNPanel()
    ctrl._updateMobileToolbar()
    ctrl._hideAxisGuide()

    // ── Semantic inference (ADR-041) ─────────────────────────────────────
    // Suggest a SpatialLink when a single Solid lands near another object.
    ctrl._runSemanticInference()
  }

  /**
   * Cancels the current grab, restoring all moved entities to their pre-grab positions.
   */
  cancel() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_GRAB_ACTIVE)) return
    const s = this.state
    if (s.pivotSelectMode) { s.pivotSelectMode = false }
    if (s.isSuggesting) {
      s.isSuggesting      = false
      s.currentSuggestion = null
      ctrl._quickDragCtx.hideDragSuggestion()
    }
    for (const obj of ctrl._scene.objects.values()) {
      if (obj instanceof Solid) obj.meshView?.setApproachWarmth(0)
    }
    // Restore all selected objects to their pre-grab positions
    for (const [id, startCorners] of s.allStartCorners) {
      const selObj = ctrl._scene.getObject(id)
      if (!selObj) continue
      if (selObj instanceof Solid) {
        // Decompose world corners back into _position + localCorners (ADR-040)
        selObj.setWorldCorners(startCorners)
        selObj.meshView.updateGeometry(selObj.corners)
      } else {
        const handles = _grabHandlesOf(selObj)
        startCorners.forEach((c, i) => handles[i].copy(c))
        selObj.meshView.updateGeometry(handles)
      }
      selObj.meshView.updateBoxHelper()
    }
    ctrl._meshView.clearPivotDisplay()
    ctrl._meshView.clearSnapDisplay()
    s.axis          = null
    s.autoSnap      = false
    s.snappedTarget = null
    s.stackMode     = false
    s.stacking      = false
    this._snapFxPrev = { geometry: null, stack: null }
    ctrl._opState.send('CANCEL')
    // Rubber-band: end drag animation; stay highlighted since entity is still selected.
    ctrl._service.setLinkDragging(new Set(), false)
    ctrl._service.updateLinkSelectionHighlight(ctrl._selectedIds)
    ctrl._controls.enabled = true
    ctrl._hideAxisGuide()
    ctrl._uiView.setCursor('default')
    ctrl._refreshObjectModeStatus()
    ctrl._updateNPanel()
    ctrl._updateMobileToolbar()
  }

  /**
   * Sets or toggles the world-axis constraint for the current grab.
   * Toggleing the same axis clears the constraint (free grab).
   * Re-snapshots segment start so accumulated movement from the prior constraint is preserved.
   * @param {'x'|'y'|'z'} axis
   */
  setAxis(axis) {
    const { _ctrl: ctrl } = this
    const s = this.state
    s.axis     = (s.axis === axis) ? null : axis
    s.inputStr = ''
    s.hasInput = false
    // Re-snapshot current positions as the new segment start so accumulated
    // movement from the previous axis constraint is preserved (e.g. X→Y keeps
    // the X offset). Mirrors the touch re-grab pattern (pointerdown in S_GRAB_ACTIVE).
    s.segmentStartCorners   = new Map()
    s.segmentStartPositions = new Map()
    for (const id of ctrl._selectedIds) {
      const selObj = ctrl._scene.getObject(id)
      if (selObj) {
        s.segmentStartCorners.set(id, _grabHandlesOf(selObj).map(c => c.clone()))
        if (selObj instanceof Solid) s.segmentStartPositions.set(id, selObj._position.clone())
      }
    }
    s.startMouse.copy(ctrl._mouse)
    // Update centroid/pivot to current position so the axis guide and
    // screen-projection track the object after accumulated movement from the
    // prior constraint. Mirrors the touch re-grab centroid update (pointerdown
    // in S_GRAB_ACTIVE). segmentStartPositions was just re-snapshotted above.
    if (ctrl._activeObj instanceof CoordinateFrame) {
      const pos = ctrl._service.worldPoseOf(ctrl._activeObj.id)?.position
      if (pos) { s.centroid.copy(pos); s.pivot.copy(pos) }
    } else if (s.segmentStartPositions.size > 0) {
      const avg = new THREE.Vector3()
      for (const p of s.segmentStartPositions.values()) avg.add(p)
      avg.divideScalar(s.segmentStartPositions.size)
      s.centroid.copy(avg)
      s.pivot.copy(avg)
    }
    if (!s.axis) {
      // Switching back to free grab: reset the 3D drag-plane anchor to the current
      // mouse position so the free-grab delta starts at zero.
      ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
      const _pt = new THREE.Vector3()
      if (ctrl._raycaster.ray.intersectPlane(s.dragPlane, _pt)) {
        s.startPoint.copy(_pt)
      }
    }
    this.apply()
    this.updateStatus()
    if (s.axis) {
      ctrl._showAxisGuide(s.axis, s.centroid.clone(), 'translate')
    } else {
      ctrl._hideAxisGuide()
    }
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Applies the current grab delta to all selected entities.
   * Called on every pointer move and on numeric input changes.
   * Also drives stack snap and live semantic inference.
   */
  apply() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_GRAB_ACTIVE)) return
    const s = this.state
    if (s.hasInput && s.axis) {
      this._applyFromInput()
    } else if (s.axis) {
      this._applyAxisConstrained()
    } else {
      this._applyFree()
    }
    // Stack snap: adjust Z so grabbed objects rest on top of any object below.
    // applyPreviewTranslation (called from _applyDeltaToAll) already updated
    // views; re-update after stack snap since it re-applies domain mutations.
    if (s.stackMode) {
      this._applyStackSnap(s.segmentStartPositions, s.lastDelta)
      for (const id of ctrl._selectedIds) {
        const selObj = ctrl._scene.getObject(id)
        if (selObj) {
          selObj.meshView.updateGeometry(_grabHandlesOf(selObj))
          selObj.meshView.updateBoxHelper()
        }
      }
    } else {
      s.stacking = false
    }

    // Live inference preview during G-key grab (ADR-041 Phase 3 — mirrors QuickDragState sub-state).
    if (ctrl._selectedIds.size === 1) {
      const ctx        = ctrl._quickDragCtx
      const suggestion = ctx.runInference()
      const key        = suggestion ? `${suggestion.semanticType}|${suggestion.targetId}` : null
      const prevKey    = s.currentSuggestion
        ? `${s.currentSuggestion.semanticType}|${s.currentSuggestion.targetId}` : null
      if (suggestion) {
        if (!s.isSuggesting || key !== prevKey) {
          s.isSuggesting      = true
          s.currentSuggestion = suggestion
          ctx.showDragSuggestion(suggestion)
        } else {
          ctx.updateDragSuggestion(suggestion)
        }
      } else if (s.isSuggesting) {
        s.isSuggesting      = false
        s.currentSuggestion = null
        ctx.hideDragSuggestion()
      }
    }

    // Approach gradient: warm wireframe of nearby Solids before the snap threshold is reached.
    const [movedId] = ctrl._selectedIds
    const movedObj  = ctrl._scene.getObject(movedId)
    if (movedObj instanceof Solid) {
      const warmthEntries = computeApproachWarmth(movedObj, ctrl._scene.objects.values())
      const warmthMap     = new Map(warmthEntries.map(e => [e.targetId, e.warmth]))
      for (const obj of ctrl._scene.objects.values()) {
        if (obj instanceof Solid && !ctrl._selectedIds.has(obj.id)) {
          obj.meshView?.setApproachWarmth(warmthMap.get(obj.id) ?? 0)
        }
      }
    }

    this._syncSnapFx()
  }

  /**
   * Snap engagement flash (ADR-065 Phase 2): diff this frame's snap state
   * against the previous frame's controller-local snapshots and spawn at most
   * one flash per frame (geometry lock wins over stack landing). All decision
   * logic is the pure `SnapFeedbackMath`; this method only feeds it facts and
   * hands the descriptor to the controller's spawn helper. Holding a lock or
   * disengaging spawns nothing (volume design — transitions only).
   */
  _syncSnapFx() {
    const { _ctrl: ctrl } = this
    const s    = this.state
    const prev = this._snapFxPrev
    const next = {
      geometry: geometrySnapshot(s.snapping, s.snappedTarget),
      stack:    stackSnapshot(s.stacking, s.stackContact),
    }
    this._snapFxPrev = next
    const geomT  = snapTransition(prev.geometry, next.geometry)
    const stackT = snapTransition(prev.stack, next.stack)
    const channel = geomT ? 'geometry' : (stackT ? 'stack' : null)
    if (!channel) return
    const radius = boundsOf(_grabHandlesOf(ctrl._activeObj))?.radius
    ctrl._spawnSnapFx(
      snapFlashDescriptor(channel, geomT ?? stackT, next[channel], radius))
  }

  /** Toggles stacking mode on/off during an active grab. */
  toggleStackMode() {
    const { _ctrl: ctrl } = this
    const s = this.state
    s.stackMode = !s.stackMode
    s.stacking  = false
    this.apply()
    this.updateStatus()
    ctrl._updateMobileToolbar()
  }

  /**
   * Updates the status bar text to reflect the current grab operation.
   */
  updateStatus() {
    const { _ctrl: ctrl } = this
    const s = this.state
    if (s.pivotSelectMode) {
      const MODE_LABEL = { all: 'All', vertex: 'Vertex', edge: 'Edge', face: 'Face' }
      const MODE_COLOR = { all: '#aaa', vertex: '#69f0ae', edge: '#ffd740', face: '#4fc3f7' }
      const m = s.pivotMode ?? 'all'
      ctrl._uiView.setStatusRich([
        { text: 'Select Pivot', bold: true, color: '#e8e8e8' },
        { text: MODE_LABEL[m], color: MODE_COLOR[m] },
        { text: '1 Vertex  2 Edge  3 Face', color: '#444' },
      ])
      return
    }

    const AXIS_COLORS = { x: '#e05252', y: '#6ab04c', z: '#4a9eed' }
    const parts = [{ text: 'Grab', bold: true, color: '#ffffff' }]

    if (s.axis) {
      parts.push({ text: s.axis.toUpperCase(), bold: true, color: AXIS_COLORS[s.axis] })
    }
    if (s.hasInput) {
      parts.push({ text: s.inputStr + '_', color: '#ffeb3b' })
    }
    if (s.pivotLabel !== 'Centroid') {
      parts.push({ text: s.pivotLabel, color: '#888' })
    }
    if (s.stackMode) {
      if (s.stacking) {
        parts.push({ text: 'Stack: ON', bold: true, color: '#a5d6a7' })
      } else {
        parts.push({ text: 'Stack', color: '#4caf50' })
      }
    }
    if (s.snapping && s.snappedTarget) {
      parts.push({ text: `Snap: ${s.snappedTarget.label}`, bold: true, color: COLOR.fxSnap })
    } else if (s.autoSnap) {
      parts.push({ text: 'Auto Snap [World]', color: '#80cbc4' })
      parts.push({ text: 'Origin / X / Y / Z', color: '#444' })
    } else if (ctrl._ctrlHeld) {
      parts.push({ text: `Grid: ${s.gridSize}`, bold: true, color: '#80cbc4' })
      parts.push({ text: 'Scroll to change', color: '#444' })
    }

    if (!s.hasInput) {
      const d = s.lastDelta
      const cx = (s.centroid.x + d.x).toFixed(2)
      const cy = (s.centroid.y + d.y).toFixed(2)
      const cz = (s.centroid.z + d.z).toFixed(2)
      parts.push({ text: `X:${cx} Y:${cy} Z:${cz}`, color: '#546e7a' })
      const dx = (d.x >= 0 ? '+' : '') + d.x.toFixed(2)
      const dy = (d.y >= 0 ? '+' : '') + d.y.toFixed(2)
      const dz = (d.z >= 0 ? '+' : '') + d.z.toFixed(2)
      parts.push({ text: `Δ ${dx} ${dy} ${dz}`, color: '#78909c' })
    }

    ctrl._uiView.setStatusRich(parts)
  }

  // ── Pivot point selection ─────────────────────────────────────────────────

  /**
   * Enters pivot-selection sub-mode during an active grab.
   * Only available for Cuboid-based entities (Solid).
   */
  startPivotSelect() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_GRAB_ACTIVE) || this.state.pivotSelectMode) return
    // Pivot selection uses Cuboid-specific vertex geometry — skip for non-Cuboid types.
    if (ctrl._activeObj instanceof ImportedMesh || ctrl._activeObj instanceof MeasureLine || ctrl._activeObj instanceof CoordinateFrame) return
    const s = this.state
    s.startCorners.forEach((c, i) => ctrl._corners[i].copy(c))
    ctrl._meshView.updateGeometry(ctrl._corners)
    ctrl._meshView.updateBoxHelper()
    s.pivotSelectMode = true
    s.pivotMode       = 'all'
    s.hoveredPivotIdx = -1
    s.candidates = getPivotCandidates(s.startCorners)
    ctrl._meshView.showPivotCandidates(s.candidates)
    this.updateStatus()
  }

  /**
   * Filters pivot candidates by sub-element type and refreshes the display.
   * @param {'all'|'vertex'|'edge'|'face'} mode
   */
  setPivotCandidateMode(mode) {
    const { _ctrl: ctrl } = this
    const s = this.state
    s.pivotMode = mode
    const corners = s.startCorners
    const candidates =
      mode === 'vertex' ? getVertexPivotCandidates(corners) :
      mode === 'edge'   ? getEdgePivotCandidates(corners)   :
      mode === 'face'   ? getFacePivotCandidates(corners)   :
                          getPivotCandidates(corners)
    s.candidates      = candidates
    s.hoveredPivotIdx = -1
    ctrl._meshView.showPivotCandidates(candidates)
    ctrl._meshView.setHoveredPivot(null)
    this.updateStatus()
  }

  /**
   * Updates the hovered pivot candidate based on the current mouse position.
   * Called on every pointer move when pivotSelectMode is active.
   */
  updatePivotHover() {
    const { _ctrl: ctrl } = this
    const s = this.state
    const SNAP_PX = 30
    let minDist    = Infinity
    let closestIdx = -1
    const mx = (ctrl._mouse.x + 1) / 2 * innerWidth
    const my = (-ctrl._mouse.y + 1) / 2 * innerHeight
    s.candidates.forEach((c, i) => {
      const ndc = c.position.clone().project(ctrl._camera)
      const sx  = (ndc.x + 1) / 2 * innerWidth
      const sy  = (-ndc.y + 1) / 2 * innerHeight
      const d   = Math.hypot(sx - mx, sy - my)
      if (d < minDist) { minDist = d; closestIdx = i }
    })
    if (minDist <= SNAP_PX && closestIdx >= 0) {
      s.hoveredPivotIdx = closestIdx
      const cand = s.candidates[closestIdx]
      ctrl._meshView.setHoveredPivot(cand)
      ctrl._uiView.setStatusRich([
        { text: 'Pivot', color: '#aaa' },
        { text: cand.label, bold: true, color: '#ffeb3b' },
      ])
    } else {
      s.hoveredPivotIdx = -1
      ctrl._meshView.setHoveredPivot(null)
      ctrl._uiView.setStatusRich([
        { text: 'Select Pivot', bold: true, color: '#e8e8e8' },
        { text: 'Click to confirm', color: '#aaa' },
        { text: 'Esc to cancel', color: '#666' },
      ])
    }
  }

  /**
   * Cancels pivot-select sub-mode and returns to regular grab mode.
   */
  cancelPivotSelect() {
    const { _ctrl: ctrl } = this
    const s = this.state
    s.pivotSelectMode = false
    s.hoveredPivotIdx = -1
    ctrl._meshView.clearPivotDisplay()
    this.updateStatus()
  }

  /**
   * Resets the drag plane and start point to the current pivot position.
   * Called after a pivot is confirmed via pivot select (G→V).
   */
  restartFromPivot() {
    const { _ctrl: ctrl } = this
    const s = this.state
    const pivot  = s.pivot
    const camDir = new THREE.Vector3()
    ctrl._camera.getWorldDirection(camDir)
    s.dragPlane.setFromNormalAndCoplanarPoint(camDir, pivot)
    s.startPoint.copy(pivot)
    s.axis     = null
    s.inputStr = ''
    s.hasInput = false
    s.startMouse.copy(ctrl._mouse)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Returns a THREE.Vector3 for the given axis letter.
   * @param {'x'|'y'|'z'} axis
   * @returns {THREE.Vector3}
   */
  _getAxisVec(axis) {
    return new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    )
  }

  /**
   * Stack snap: after all grab movement is applied, cast downward rays from the
   * bottom face of the active grabbed object. If another object is directly below,
   * shift all grabbed objects upward so the bottom face rests on that surface.
   * @param {Map<string, import('three').Vector3>} segStartPositions  per-Solid _position snapshots
   * @param {import('three').Vector3} currentDelta  world delta already applied by the caller
   */
  _applyStackSnap(segStartPositions, currentDelta) {
    const { _ctrl: ctrl } = this
    const s = this.state
    const grabbed = ctrl._activeObj
    if (!(grabbed instanceof Solid)) { s.stacking = false; return }

    // Find bottom Z of the grabbed object
    const gCorners = grabbed.corners
    let gZMin = Infinity
    gCorners.forEach(c => { if (c.z < gZMin) gZMin = c.z })

    // Collect meshes from non-grabbed objects (excluding MeasureLine)
    const grabbedIds = new Set(ctrl._selectedIds)
    const targetMeshes = [...ctrl._scene.objects.values()]
      .filter(o => !grabbedIds.has(o.id) && !(o instanceof MeasureLine) && o.meshView?.cuboid?.visible)
      .map(o => o.meshView.cuboid)

    if (!targetMeshes.length) { s.stacking = false; return }

    // Sample the bottom face: 4 corners at gZMin + centroid
    const bottomCorners = gCorners.filter(c => Math.abs(c.z - gZMin) < 0.001)
    const center = new THREE.Vector3()
    bottomCorners.forEach(c => center.add(c))
    center.divideScalar(bottomCorners.length || 1)

    const origins = [...bottomCorners, center]
    const downDir = new THREE.Vector3(0, 0, -1)
    const stackRay = new THREE.Raycaster()

    // Cast downward from well above the scene; find the highest surface hit at (x,y).
    // Using gZMin+ε as origin would miss surfaces above the current bottom face.
    const RAY_TOP = 10000
    let highestHitZ = null
    for (const origin of origins) {
      stackRay.set(new THREE.Vector3(origin.x, origin.y, RAY_TOP), downDir)
      const hits = stackRay.intersectObjects(targetMeshes)
      if (hits.length > 0) {
        const hz = hits[0].point.z
        if (highestHitZ === null || hz > highestHitZ) highestHitZ = hz
      }
    }

    if (highestHitZ === null) { s.stacking = false; return }

    const zOffset = highestHitZ - gZMin
    // Skip if already resting on the surface (within 1mm tolerance)
    if (Math.abs(zOffset) < 0.001) { s.stacking = false; return }

    // Apply additional Z shift via the public Solid.move() API (ADR-040: never mutate
    // corners directly — _position and localCorners must remain the SSOT).
    const snapDelta = currentDelta.clone().add(new THREE.Vector3(0, 0, zOffset))
    for (const id of ctrl._selectedIds) {
      const selObj = ctrl._scene.getObject(id)
      if (selObj instanceof Solid) {
        const segStartPos = segStartPositions?.get(id)
        if (segStartPos) selObj.move(segStartPos, snapDelta)
      }
    }
    s.stackContact = { x: center.x, y: center.y, z: highestHitZ }
    s.stacking = true
  }

  /**
   * Applies `delta` to the active object and all other selected objects.
   * Uses each object's own startCorners snapshot from `state.allStartCorners`.
   * @param {import('three').Vector3} delta
   */
  _applyDeltaToAll(delta) {
    const { _ctrl: ctrl } = this
    const s = this.state
    s.lastDelta.copy(delta)
    ctrl._service.applyPreviewTranslation(
      s.segmentStartCorners,
      s.segmentStartPositions,
      delta,
    )
  }

  /**
   * Applies grab when the user has typed a numeric distance along the axis.
   */
  _applyFromInput() {
    const { _ctrl: ctrl } = this
    const s = this.state
    s.snapping = false
    const parsed = parseFloat(s.inputStr)
    if (s.inputStr && isNaN(parsed)) {
      ctrl._uiView.showToast('Invalid number')
      return
    }
    const dist    = isNaN(parsed) ? 0 : parsed
    const axisVec = this._getAxisVec(s.axis)
    this._applyDeltaToAll(axisVec.clone().multiplyScalar(dist))
  }

  /**
   * Applies free (camera-facing plane) grab based on raycaster intersection.
   */
  _applyFree() {
    const { _ctrl: ctrl } = this
    const s = this.state
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const pt = new THREE.Vector3()
    if (!ctrl._raycaster.ray.intersectPlane(s.dragPlane, pt)) return
    let delta = pt.clone().sub(s.startPoint)
    if (s.autoSnap) {
      delta = this._trySnapToGeometry(delta)
    } else if (ctrl._ctrlHeld) {
      delta = this._applyGridSnapToDelta(delta)
      s.snapping      = false
      s.snappedTarget = null
    } else {
      s.snapping      = false
      s.snappedTarget = null
      const _fgTension = ctrl._service.getLinkDragTension()
      if (_fgTension > 0) delta.multiplyScalar(Math.max(0.15, 1.0 - Math.min(_fgTension, 1.0) * 0.85))
    }
    this._applyDeltaToAll(delta)
  }

  /**
   * Applies axis-constrained grab: projects mouse movement onto the world axis
   * using the analytic Jacobian of the perspective projection (immune to
   * behind-camera sign-flip that the old pivot+axisVec NDC approach had).
   */
  _applyAxisConstrained() {
    const { _ctrl: ctrl } = this
    const s = this.state
    const axisVec = this._getAxisVec(s.axis)

    // Compute the screen-space direction of the world axis using the analytic
    // Jacobian of the perspective projection, evaluated at the grab pivot.
    //
    // The previous approach projected (pivot + axisVec) to NDC and subtracted
    // project(pivot). When the camera is close to the object, (pivot + axisVec)
    // can land behind the camera. THREE.js perspective division by a negative W
    // flips the NDC sign, reversing the apparent axis direction and causing the
    // object to move opposite to the cursor.
    //
    // The Jacobian d(ndc)/dt at t=0 is computed entirely at the pivot point
    // (always in front of the camera), so it is immune to this sign-flip.
    //
    // Derivation for perspective projection  ndc.x = x_c * f_x / (−z_c):
    //   dx_ndc/dt = f_x * (v_x * (−z_c) − x_c * v_z) / z_c²
    //   dy_ndc/dt = f_y * (v_y * (−z_c) − y_c * v_z) / z_c²
    // where (x_c, y_c, z_c) = pivot in camera space, (v_x, v_y, v_z) = axis
    // in camera space, and z_c < 0 for points in front of the camera.
    const P_c = s.pivot.clone().applyMatrix4(ctrl._camera.matrixWorldInverse)
    const v_c = axisVec.clone().transformDirection(ctrl._camera.matrixWorldInverse)
    const f_y = 1 / Math.tan(THREE.MathUtils.degToRad(ctrl._camera.fov * 0.5))
    const f_x = f_y / ctrl._camera.aspect
    const z   = P_c.z    // negative for in-front points

    const dx        = f_x * (v_c.x * (-z) - P_c.x * v_c.z) / (z * z)
    const dy        = f_y * (v_c.y * (-z) - P_c.y * v_c.z) / (z * z)
    const screenLen = Math.sqrt(dx * dx + dy * dy)
    if (screenLen < 1e-4) return

    const axisNormX = dx / screenLen
    const axisNormY = dy / screenLen

    const mdx  = ctrl._mouse.x - s.startMouse.x
    const mdy  = ctrl._mouse.y - s.startMouse.y
    const dist = (mdx * axisNormX + mdy * axisNormY) / screenLen

    if (s.autoSnap) {
      const delta        = new THREE.Vector3().addScaledVector(axisVec, dist)
      const snappedDelta = this._trySnapToGeometry(delta)
      this._applyDeltaToAll(snappedDelta)
    } else if (ctrl._ctrlHeld) {
      s.snapping      = false
      s.snappedTarget = null
      const g           = s.gridSize
      const snappedDist = Math.round(dist / g) * g
      this._applyDeltaToAll(axisVec.clone().multiplyScalar(snappedDist))
    } else {
      s.snapping      = false
      s.snappedTarget = null
      const _acTension = ctrl._service.getLinkDragTension()
      const _acDist    = _acTension > 0 ? dist * Math.max(0.15, 1.0 - Math.min(_acTension, 1.0) * 0.85) : dist
      this._applyDeltaToAll(axisVec.clone().multiplyScalar(_acDist))
    }
  }

  /**
   * Snaps `delta` to the nearest geometry snap target within SNAP_PX pixels.
   * Returns a corrected delta pointing at the snap target, or the original delta.
   */
  _trySnapToGeometry(delta) {
    const { _ctrl: ctrl } = this
    const s = this.state
    const pivotAfter = s.pivot.clone().add(delta)
    const pScreen    = projectToScreen(pivotAfter, ctrl._camera)

    const grabbedIds   = new Set(s.allStartCorners.keys())
    const geoTargets   = collectSnapTargets(ctrl._scene.objects, s.snapMode, grabbedIds)
    const worldTargets = collectWorldSnapTargets(pivotAfter)
    const targets      = [...geoTargets, ...worldTargets]
    s.snapTargets      = targets
    const bestTarget   = pickBestSnapTarget(targets, pScreen.x, pScreen.y, ctrl._camera)

    if (bestTarget) {
      s.snapping      = true
      s.snappedTarget = bestTarget
      return bestTarget.position.clone().sub(s.pivot)
    }
    s.snapping      = false
    s.snappedTarget = null
    return delta
  }

  /** Rounds each component of `delta` to the current grid size. */
  _applyGridSnapToDelta(delta) {
    const g = this.state.gridSize
    return new THREE.Vector3(
      Math.round(delta.x / g) * g,
      Math.round(delta.y / g) * g,
      Math.round(delta.z / g) * g,
    )
  }
}
