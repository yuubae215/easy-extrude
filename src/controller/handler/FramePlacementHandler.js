/**
 * FramePlacementHandler — manages the CoordinateFrame placement pick sub-mode.
 *
 * Encapsulates all frame-placement state and the start/confirm/cancel/pickPoint
 * lifecycle (ADR-034 §6).
 *
 * Owned by AppController as this._framePlacementHandler.
 * Accesses parent controller via this._ctrl.
 *
 * State machine: S_FRAME_PLACEMENT ∈ AppController._opState.
 * Triggered by: _addCoordinateFrame() → start(parentId).
 *
 * Visual elements (lazily created, reused):
 *   _parentAxesOverlay  THREE.Group — world-aligned dimmed dashed axes at parent centroid.
 *   _frameCursorGhost   THREE.Group — bright axes following the cursor during pick.
 * These are kept on the handler (mirroring the original AppController fields).
 */

import * as THREE from 'three'
import { CoordinateFrame }                      from '../../domain/CoordinateFrame.js'
import { S_FRAME_PLACEMENT }                    from '../../core/editorStates.js'
import { createCreateCoordinateFrameCommand }   from '../../command/CreateCoordinateFrameCommand.js'

// ── Module-level ghost geometry helpers (ADR-034 §6, §7) ──────────────────────

const _GHOST_AXIS_LEN = 0.5
const _GHOST_OPACITY  = 0.35
const _GHOST_DASH     = 0.08
const _GHOST_GAP      = 0.05

/** Creates a dimmed dashed axis-lines group (world-aligned — always identity rotation). */
function _makeGhostAxesGroup() {
  const group = new THREE.Group()
  for (const [dx, dy, dz, color] of [
    [_GHOST_AXIS_LEN, 0, 0, 0xff4444],
    [0, _GHOST_AXIS_LEN, 0, 0x44cc44],
    [0, 0, _GHOST_AXIS_LEN, 0x4488ff],
  ]) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, dx, dy, dz], 3))
    const mat = new THREE.LineDashedMaterial({
      color, dashSize: _GHOST_DASH, gapSize: _GHOST_GAP,
      depthTest: false, transparent: true, opacity: _GHOST_OPACITY,
    })
    const line = new THREE.Line(geo, mat)
    line.renderOrder = 1
    line.computeLineDistances()
    group.add(line)
  }
  return group
}

/** Creates a bright solid axis-lines group to show as cursor ghost during frame pick. */
function _makeFrameAxesGroup() {
  const group = new THREE.Group()
  for (const [dx, dy, dz, color] of [
    [_GHOST_AXIS_LEN, 0, 0, 0xff4444],
    [0, _GHOST_AXIS_LEN, 0, 0x44cc44],
    [0, 0, _GHOST_AXIS_LEN, 0x4488ff],
  ]) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, dx, dy, dz], 3))
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.75 })
    const line = new THREE.Line(geo, mat)
    line.renderOrder = 2
    group.add(line)
  }
  return group
}

export class FramePlacementHandler {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /**
     * All mutable placement state — accessed externally via .state or getters.
     * @type {{ parentId: string|null }}
     */
    this.state = { parentId: null }

    /**
     * Scene-level Three.js Group showing world-aligned parent axes during pick sub-mode.
     * Lazily created on first entry; reused on subsequent entries.
     * @type {THREE.Group|null}
     */
    this._parentAxesOverlay = null

    /**
     * Ghost CoordinateFrame axes following the cursor during pick sub-mode.
     * @type {THREE.Group|null}
     */
    this._frameCursorGhost = null
  }

  // ── Convenience getters ───────────────────────────────────────────────────

  get isActive() {
    return this._ctrl._opState.is(S_FRAME_PLACEMENT)
  }

  // ── Public operation lifecycle ────────────────────────────────────────────

  /**
   * Enters the frame placement pick sub-mode for the given parent entity.
   * Shows the parent axes ghost and cursor ghost; updates status bar and mobile toolbar.
   * @param {string} parentId
   */
  start(parentId) {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.send('BEGIN_FRAME_PLACEMENT')) return
    this.state.parentId = parentId

    // Show parent axes overlay at geometry ancestor centroid (ADR-034 §7)
    const ancestorCentroid = this._geometryAncestorCentroid(parentId)
    if (ancestorCentroid) {
      if (!this._parentAxesOverlay) {
        this._parentAxesOverlay = _makeGhostAxesGroup()
        ctrl._sceneView.scene.add(this._parentAxesOverlay)
      }
      this._parentAxesOverlay.position.copy(ancestorCentroid)
      this._parentAxesOverlay.quaternion.set(0, 0, 0, 1)
      this._parentAxesOverlay.visible = true
    }

    // Cursor ghost axes (hidden until hover)
    if (!this._frameCursorGhost) {
      this._frameCursorGhost = _makeFrameAxesGroup()
      ctrl._sceneView.scene.add(this._frameCursorGhost)
    }
    this._frameCursorGhost.visible = false

    const mobile = window.innerWidth < 768
    if (mobile) {
      ctrl._uiView.setStatus('Tap to place frame')
      ctrl._updateMobileToolbar()
    } else {
      ctrl._uiView.setStatus('Click to place frame — Esc to cancel')
      ctrl._uiView.setCursor('crosshair')
    }
  }

  /**
   * Cancels pick sub-mode; hides overlays and restores normal state.
   */
  cancel() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_FRAME_PLACEMENT)) return
    this.state.parentId = null
    if (this._parentAxesOverlay) this._parentAxesOverlay.visible = false
    if (this._frameCursorGhost)  this._frameCursorGhost.visible  = false
    ctrl._uiView.setCursor('default')
    ctrl._opState.send('CANCEL')
    ctrl._refreshObjectModeStatus()
    ctrl._updateMobileToolbar()
  }

  /**
   * Confirms frame placement at the given world position.
   * Creates the CoordinateFrame, records undo, exits sub-mode.
   * @param {THREE.Vector3} worldPos
   */
  confirm(worldPos) {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_FRAME_PLACEMENT)) return
    const parentId = this.state.parentId
    this.state.parentId = null
    if (this._parentAxesOverlay) this._parentAxesOverlay.visible = false
    if (this._frameCursorGhost)  this._frameCursorGhost.visible  = false
    ctrl._uiView.setCursor('default')
    ctrl._opState.send('CONFIRM')
    ctrl._refreshObjectModeStatus()
    ctrl._updateMobileToolbar()

    // User CFs are always parented to the Origin CF of the Solid (ADR-037 §2)
    const parentObj = ctrl._scene.getObject(parentId)
    let effectiveParentId = parentId
    if (parentObj && !(parentObj instanceof CoordinateFrame)) {
      const originFrame = [...ctrl._scene.objects.values()]
        .find(o => o instanceof CoordinateFrame && o.parentId === parentId && o.name === 'Origin')
      if (originFrame) effectiveParentId = originFrame.id
    }

    const frame = ctrl._service.createCoordinateFrame(effectiveParentId, null, worldPos)
    if (!frame) return

    const cmd = createCreateCoordinateFrameCommand(
      frame, ctrl._service,
      () => {
        // After undo: restore parent selection if parent still exists
        const parent = ctrl._scene.getObject(parentId)
        if (parent) ctrl._switchActiveObject(parentId, true)
        else {
          ctrl._objSelected = false
          ctrl._selectedIds.clear()
          ctrl._refreshObjectModeStatus()
          ctrl._updateMobileToolbar()
        }
      },
      (id) => ctrl._switchActiveObject(id, true),
    )
    ctrl._commandStack.push(cmd)
    ctrl._switchActiveObject(frame.id, true)
  }

  /**
   * Updates the cursor ghost position and scale during hover (pointer move).
   * Call from the S_FRAME_PLACEMENT branch of _onPointerMove for non-touch events.
   */
  updateCursorGhost() {
    const { _ctrl: ctrl } = this
    const pt = this.pickPoint()
    if (pt && this._frameCursorGhost) {
      this._frameCursorGhost.position.copy(pt)
      this._frameCursorGhost.quaternion.set(0, 0, 0, 1)
      this._frameCursorGhost.visible = true
      // Scale cursor ghost to consistent screen size
      const d = ctrl._camera.position.distanceTo(pt)
      if (d > 0 && ctrl._camera.isPerspectiveCamera) {
        const tanHalfFov = Math.tan((ctrl._camera.fov * Math.PI) / 360)
        const screenH    = ctrl._sceneView.renderer.domElement.clientHeight || 1
        const ws = (60 / screenH) * 2 * d * tanHalfFov
        this._frameCursorGhost.scale.setScalar(ws / _GHOST_AXIS_LEN)
      }
    } else if (this._frameCursorGhost) {
      this._frameCursorGhost.visible = false
    }
    // Scale parent axes overlay too
    if (this._parentAxesOverlay?.visible) {
      const dp = ctrl._camera.position.distanceTo(this._parentAxesOverlay.position)
      if (dp > 0 && ctrl._camera.isPerspectiveCamera) {
        const tanHalfFov = Math.tan((ctrl._camera.fov * Math.PI) / 360)
        const screenH    = ctrl._sceneView.renderer.domElement.clientHeight || 1
        const ws = (80 / screenH) * 2 * dp * tanHalfFov
        this._parentAxesOverlay.scale.setScalar(ws / _GHOST_AXIS_LEN)
      }
    }
  }

  /**
   * Picks a world position on the parent entity's surface from the current mouse/pointer.
   * Returns null when the ray misses the entity bounding box.
   * @returns {THREE.Vector3|null}
   */
  pickPoint() {
    const { _ctrl: ctrl } = this
    const { parentId } = this.state
    const parent = ctrl._scene.getObject(parentId)
    if (!parent) return null

    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const ray = ctrl._raycaster.ray
    const pt  = new THREE.Vector3()

    // Try raycasting against the parent's cuboid mesh first (Solid)
    const cuboid = parent.meshView?.cuboid
    if (cuboid) {
      const hits = []
      ctrl._raycaster.intersectObject(cuboid, true, hits)
      if (hits.length > 0) return hits[0].point.clone()
    }

    // Fallback: bounding box intersection
    if (parent.corners?.length > 0) {
      const box = new THREE.Box3()
      for (const c of parent.corners) box.expandByPoint(c)
      if (ray.intersectBox(box, pt)) return pt.clone()
    }

    // For CoordinateFrame parent: use a plane at the frame world position
    if (parent instanceof CoordinateFrame) {
      const wp = ctrl._service.worldPoseOf(parentId)?.position
      if (wp) {
        const camDir = new THREE.Vector3()
        ctrl._camera.getWorldDirection(camDir)
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, wp)
        if (ray.intersectPlane(plane, pt)) return pt.clone()
      }
    }

    return null
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * Walks from the given id up the parent chain past CoordinateFrames to find
   * the geometry ancestor, then returns its centroid.
   * @param {string} frameId
   * @returns {THREE.Vector3|null}
   */
  _geometryAncestorCentroid(frameId) {
    const { _ctrl: ctrl } = this
    let obj = ctrl._scene.getObject(frameId)
    while (obj instanceof CoordinateFrame) {
      obj = ctrl._scene.getObject(obj.parentId)
    }
    if (!obj) return null
    const corners = obj.corners
    if (!corners || corners.length === 0) return null
    const centroid = new THREE.Vector3()
    for (const c of corners) centroid.add(c)
    centroid.divideScalar(corners.length)
    return centroid
  }
}
