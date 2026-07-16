/**
 * MapModeController — owns all 2D Map Mode state and interaction logic.
 *
 * Entered via the "Map" header button. Uses an orthographic top-down camera
 * for distortion-free 2D placement of AnnotatedLine / AnnotatedRegion /
 * AnnotatedPoint entities.
 *
 * Three-state drawing model (ADR-031 §1):
 *   idle     → no gesture in progress; tool may or may not be selected
 *   drawing  → gesture in progress (rubber-band follows cursor)
 *   pending  → geometry fully defined; static dashed preview; awaiting name + confirm
 *
 * Dependencies:
 *   ctrl — the AppController instance (sceneView, uiView, service, scene, etc.)
 *          accessed through the parent reference to avoid duplicating injections.
 */

import * as THREE from 'three'
import { AnnotatedLine }   from '../../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../../domain/AnnotatedPoint.js'
import { getPlaceTypeEntry } from '../../domain/PlaceTypeRegistry.js'
import { CoordinateFrame } from '../../domain/CoordinateFrame.js'
import { frustumForDistance, distanceForFrustum } from '../../view/CameraMath.js'
import { createAddAnnotationCommand } from '../../command/AddAnnotationCommand.js'
import { geometrySnapshot, snapTransition, snapFlashDescriptor } from '../../view/SnapFeedbackMath.js'
import { SnapFlash } from '../../view/SnapFlash.js'
import { cursorFrame, ringFrame, mapGridStep } from '../../view/MapPreviewMath.js'
import { prefersReducedMotion } from '../../theme/motion.js'
import { COLOR } from '../../theme/tokens.js'

/** Ortho zoom clamp (world-units frustum height) — shared by wheel and enter. */
const FRUSTUM_MIN = 2
const FRUSTUM_MAX = 500

export class MapModeController {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /** @type {object} All mutable map-mode state */
    this.state = {
      /** Whether map mode is currently active */
      active: false,
      /** Active drawing tool: 'route'|'boundary'|'zone'|'hub'|'anchor'|null */
      tool:   null,
      /** 'idle'|'drawing'|'pending' (ADR-031 §1) */
      drawState: 'idle',
      /** @type {THREE.Vector3[]} vertex positions collected during drawing */
      points: [],
      /** @type {THREE.Vector3[]|null} frozen geometry entered when going pending */
      pendingPoints: null,
      /** Default name for the pending entity (e.g. "Route 1") */
      pendingName: null,
      /** @type {THREE.Vector3|null} live cursor world position */
      cursor: null,
      /** THREE.Line preview drawn while placing */
      previewLine: null,
      /** THREE.Mesh cursor dot */
      cursorDot:   null,
      /** Panning state */
      isPanning:   false,
      panStart:    null,   // { screenX, screenY, camX, camY }
      /** Current orthographic frustum height (world units) */
      frustumSize: 50,
      /**
       * Mobile drag start: set on pointerdown for Line/Region/Point tools.
       * Cleared on pointerup.
       * @type {{ pt: THREE.Vector3, screenX: number, screenY: number }|null}
       */
      mobileDragStart: null,
      /**
       * Per-type creation counters for default name generation ("Route 1", "Zone 2" …).
       */
      nameCounters: { Route: 0, Boundary: 0, Zone: 0, Hub: 0, Anchor: 0 },
      /**
       * Snap indicator ring (PC only) — shown at the snap-candidate world position.
       * @type {THREE.Mesh|null}
       */
      snapRingMesh: null,
      /**
       * The world position of the active snap candidate (null when not snapping).
       * @type {THREE.Vector3|null}
       */
      snapCandidate: null,
      /**
       * Active touch pointers (screen coords), for two-finger pinch-zoom.
       * Touch devices have no wheel and OrbitControls' pinch is disabled in
       * Map Mode, so the ortho zoom is driven here instead.
       * @type {Map<number,{x:number,y:number}>}
       */
      touchPoints: new Map(),
      /**
       * Live pinch-zoom baseline captured when the 2nd finger lands, or null.
       * @type {{startDist:number, startFrustum:number}|null}
       */
      pinch: null,
      /**
       * True from the 2nd finger landing until ALL fingers lift — suppresses
       * single-finger pan/draw so a leftover finger can't jump after a pinch.
       */
      pinchLock: false,
    }

    /**
     * Pre-map perspective pose, captured at enter() for the exit return
     * flight (ADR-072 decision 1). Presentation-only — never part of the
     * drawing FSM.
     * @type {{position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3}|null}
     */
    this._savedView = null
    /** True once the enter flight handed the viewport to the ortho camera. */
    this._orthoSwapped = false
    /**
     * Perspective camera position at the moment of the ortho swap — the
     * external-write guard for exit (CameraFlight `_cameraStolen` sibling):
     * if anything moved the perspective camera during map mode (a scene load's
     * fitCameraToSphere), the external writer owns it and exit swaps without
     * repositioning or flying.
     * @type {THREE.Vector3|null}
     */
    this._stagedPos = null
    /**
     * Previous endpoint-snap snapshot for the engagement flash (ADR-072
     * decision 3) — controller-local presentation history, same rule as the
     * grab handler's `_snapFxPrev` (ADR-065 Phase 2 completion).
     * @type {{key: string, x: number, y: number, z: number}|null}
     */
    this._snapFxPrev = null

    /**
     * Preview idle-motion state (ADR-072 refinement, Tier A): birth clocks
     * for the cursor dot and snap ring, assigned by `tick()` on the first
     * frame each exists; reduced-motion is sampled once per map session at
     * enter() from the single boundary (per-spawn discipline, ADR-065 Ph 5).
     */
    this._cursorBornAt   = null
    this._ringBornAt     = null
    this._previewReduced = false
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** True when map mode is currently active. */
  get isActive() { return this.state.active }

  /** True when a drawing tool is selected (map pointerdown guard). */
  get hasTool() { return !!this.state.tool }

  /**
   * Enters 2D Map Mode (ADR-072 decision 1): the mode state activates
   * immediately (state first, presentation follows — 核 §1.4); the camera
   * flies to a top-down staging pose through the same `flyToView` contract as
   * the world gizmo (ADR-069), and the perspective→ortho projection swap
   * happens when the flight ends — in ANY way (landing, user interruption,
   * external write, eviction), so the mode's terminal camera state is always
   * reached (#11). The staging frustum is derived from the current viewing
   * distance (`frustumForDistance`) so the swap preserves apparent scale and
   * the map opens framed on what the user was looking at.
   */
  enter() {
    const { _ctrl: ctrl, state } = this
    if (state.active) return
    if (ctrl._scene.selectionMode === 'edit') ctrl.setMode('object')
    state.active          = true
    state.tool            = null
    state.drawState       = 'idle'
    state.points          = []
    state.pendingPoints   = null
    state.pendingName     = null
    state.cursor          = null
    state.mobileDragStart = null
    state.isPanning       = false
    state.touchPoints.clear()
    state.pinch           = null
    state.pinchLock       = false
    this._snapFxPrev      = null
    this._cursorBornAt    = null
    this._ringBornAt      = null
    this._previewReduced  = prefersReducedMotion()

    const sv = ctrl._sceneView
    this._savedView = {
      position: sv.camera.position.clone(),
      target:   sv.controls.target.clone(),
      up:       sv.camera.up.clone(),
    }
    this._orthoSwapped = false
    this._stagedPos    = null
    // Orbit must not fight the enter flight or the map's pointer handlers;
    // useOrthoCamera(true) re-disables it at the swap (idempotent).
    sv.controls.enabled = false

    const t    = sv.controls.target
    const dist = Math.max(sv.camera.position.distanceTo(t), 1e-3)
    state.frustumSize = Math.max(FRUSTUM_MIN,
      Math.min(FRUSTUM_MAX, frustumForDistance(dist, sv.camera.fov)))
    const stageDist = distanceForFrustum(state.frustumSize, sv.camera.fov)
    ctrl.flyToView({
      position: new THREE.Vector3(t.x, t.y, stageDist),
      target:   new THREE.Vector3(t.x, t.y, 0),
      // Screen-north = +Y, matching the ortho camera, so the swap is
      // orientation-seamless (up ⊥ the top-down view direction — no
      // singularity, unlike the gizmo's Z+ special case).
      up:       new THREE.Vector3(0, 1, 0),
    }, () => this._completeEnterSwap())

    ctrl._uiView.setCursor('default')
    ctrl._uiView.setStatus('Map Mode — select a type on the left to start drawing')
    this._refreshToolbar()
    ctrl._updateMobileToolbar()
  }

  /**
   * The terminal projection swap at the end of the enter flight. No-ops when
   * the user already exited map mode mid-flight (exit flips `state.active`
   * BEFORE it flies back, so a finished enter flight cannot re-swap).
   */
  _completeEnterSwap() {
    const { _ctrl: ctrl, state } = this
    if (!state.active || this._orthoSwapped) return
    this._orthoSwapped = true
    ctrl._sceneView.useOrthoCamera(true, state.frustumSize)
    this._stagedPos = ctrl._sceneView.camera.position.clone()
  }

  /**
   * Exits 2D Map Mode (ADR-072 decision 1, the inverse choreography): the
   * perspective camera is placed at the pose that MATCHES the current ortho
   * view (same centre, `distanceForFrustum` height, same screen-north) so the
   * projection swap back is a seamless one-frame cut, then it flies to the
   * pose saved at enter. If something else wrote the perspective camera while
   * the map was open (external-write guard), the external writer owns it:
   * swap only, no reposition, no flight.
   */
  exit() {
    const { _ctrl: ctrl, state } = this
    this._cancelDrawing()
    state.active     = false
    state.isPanning  = false

    const sv    = ctrl._sceneView
    const saved = this._savedView
    this._savedView = null

    if (this._orthoSwapped) {
      const staged = this._stagedPos
      this._stagedPos = null
      const tol = Math.max(Math.abs(staged?.x ?? 1), Math.abs(staged?.y ?? 1),
        Math.abs(staged?.z ?? 1), 1) * 1e-4
      const stolen = !staged ||
        sv.camera.position.distanceToSquared(staged) > tol * tol
      if (!stolen) {
        // Matched staging pose from the CURRENT ortho centre/zoom.
        const oc = sv.activeCamera // the ortho camera while swapped
        const h  = distanceForFrustum(state.frustumSize, sv.camera.fov)
        sv.camera.position.set(oc.position.x, oc.position.y, h)
        sv.camera.up.set(0, 1, 0)
        sv.controls.target.set(oc.position.x, oc.position.y, 0)
        sv.camera.lookAt(oc.position.x, oc.position.y, 0)
      }
      sv.useOrthoCamera(false)
      if (!stolen && saved) ctrl.flyToView(saved)
    } else {
      // Exit during the enter flight: never swapped — fly straight back
      // (flyToView finishes the running enter flight first; its onDone
      // no-ops because state.active is already false).
      sv.useOrthoCamera(false)
      if (saved) ctrl.flyToView(saved)
    }

    ctrl._uiView.hideMapToolbar()
    ctrl._uiView.setCursor('default')
    ctrl._refreshObjectModeStatus()
    ctrl._updateMobileToolbar()
  }

  /**
   * Handles wheel zoom event in map mode.
   * @param {WheelEvent} e
   * @returns {boolean} true if event was consumed
   */
  onWheel(e) {
    if (!this.state.active) return false
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    this.state.frustumSize = Math.max(2, Math.min(500, this.state.frustumSize * factor))
    this._ctrl._sceneView.setOrthoZoom(this.state.frustumSize)
    return true
  }

  /**
   * Handles pointermove in map mode (pan + drawing preview).
   * @param {PointerEvent} e
   * @returns {boolean} true if event was consumed
   */
  onPointerMove(e) {
    const { state } = this
    if (!state.active) return false

    // Two-finger pinch-zoom takes priority over pan/draw (touch only).
    if (state.touchPoints.has(e.pointerId)) {
      state.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (state.pinchLock) {
        if (state.pinch && state.touchPoints.size >= 2) this._updatePinch()
        return true // a lone leftover finger holds steady — never resumes pan
      }
    }

    if (state.isPanning && state.panStart) {
      const { frustumSize } = state
      const aspect = innerWidth / innerHeight
      const dx = (e.clientX - state.panStart.screenX) * (frustumSize * aspect / innerWidth)
      const dy = (e.clientY - state.panStart.screenY) * (frustumSize / innerHeight)
      this._ctrl._sceneView.panOrthoCamera(
        state.panStart.camX - dx,
        state.panStart.camY + dy,
      )
      return true
    }

    // Update preview in drawing state only; pending shows frozen dashed preview
    if (state.tool && state.drawState === 'drawing') {
      const pt = this._pickPoint(e)
      state.cursor = pt
      this._updatePreview()
    }
    return true
  }

  /**
   * Handles pointerdown in map mode (pan start + drawing clicks).
   * @param {PointerEvent} e
   * @returns {boolean} true if event was consumed
   */
  onPointerDown(e) {
    const { _ctrl: ctrl, state } = this
    if (!state.active) return false

    // Record touch pointers for pinch-zoom. Only the FIRST finger reaches here
    // (AppController routes the 2nd through `onExtraTouchDown`), so recording
    // it here never itself starts a pinch — but it makes the first finger's
    // live position available once the second lands.
    if (e.pointerType === 'touch') this._trackTouchDown(e)

    // Pan: middle button OR left button with no tool selected
    if (e.button === 1 || (e.button === 0 && !state.tool)) {
      state.isPanning = true
      const cam = ctrl._sceneView.activeCamera
      state.panStart = {
        screenX: e.clientX, screenY: e.clientY,
        camX: cam.position.x, camY: cam.position.y,
      }
      ctrl._uiView.setCursor('grabbing')
      ctrl._activeDragPointerId = e.pointerId
      return true
    }

    if (e.button === 0 && state.tool) {
      const { drawState } = state

      // In pending state: LMB on canvas confirms (keyboard-free fallback)
      if (drawState === 'pending') {
        this._confirmDrawing()
        return true
      }

      const pt       = this._pickPoint(e)
      const geometry = this._geometryForType(state.tool)

      if (this._isMobile()) {
        // Mobile: single drag gesture for all types (ADR-031 §2)
        state.mobileDragStart = { pt: pt.clone(), screenX: e.clientX, screenY: e.clientY }
        state.cursor          = pt.clone()
        ctrl._activeDragPointerId = e.pointerId
        this._updatePreview()
        return true
      }

      // PC interaction
      if (geometry === 'point') {
        this._enterPendingState([pt])
        return true
      }

      if (geometry === 'region') {
        // Drag-to-rectangle: record drag start; pointerup enters pending
        state.mobileDragStart = { pt: pt.clone(), screenX: e.clientX, screenY: e.clientY }
        state.cursor          = pt.clone()
        ctrl._activeDragPointerId = e.pointerId
        const typeLabel = this._placeTypeForType(state.tool)
        ctrl._uiView.setStatusRich([
          { text: typeLabel, bold: true, color: '#80cbc4' },
          { text: 'drag to draw rectangle', color: COLOR.textSecondary },
          { text: '  ESC cancel', color: '#444' },
        ])
        return true
      }

      // Line (PC): each click adds a vertex; Enter/RMB transitions to pending
      state.points.push(pt.clone())
      state.cursor = pt.clone()
      this._updatePreview()
      this._updateStatus()
      return true
    }

    if (e.button === 2 && state.tool) {
      const { drawState, points, tool: currentTool } = state
      if (drawState === 'pending') {
        // RMB in pending → cancel back to drawing (re-select same tool)
        this._cancelDrawing()
        if (currentTool) this._setTool(currentTool)
        return true
      }
      // RMB in drawing: for PC Line with ≥2 pts → enter pending; else cancel
      const geometry = this._geometryForType(state.tool)
      if (geometry === 'line' && points.length >= 2) {
        this._enterPendingState(points)
      } else {
        this._cancelDrawing()
      }
      return true
    }

    return true  // always consume while map mode is active
  }

  /**
   * Handles pointerup in map mode (end pan + drag gesture completion).
   * @param {PointerEvent} e
   * @returns {boolean} true if event was consumed
   */
  onPointerUp(e) {
    const { _ctrl: ctrl, state } = this
    if (!state.active) return false

    // Pinch-zoom bookkeeping: drop the lifted finger. While a pinch was in
    // effect (pinchLock), consume every lift so a leftover finger never
    // completes a pan/draw, and release AppController's drag pointer so a later
    // touch isn't mistaken for a 2nd finger. The lock clears when all up.
    if (state.touchPoints.delete(e.pointerId) && state.pinchLock) {
      if (state.touchPoints.size < 2) state.pinch = null
      if (ctrl._activeDragPointerId === e.pointerId) ctrl._activeDragPointerId = null
      if (state.touchPoints.size === 0) state.pinchLock = false
      return true
    }

    if (state.isPanning) {
      if (ctrl._activeDragPointerId === e.pointerId) {
        ctrl._activeDragPointerId = null
        state.isPanning  = false
        state.panStart   = null
        ctrl._uiView.setCursor(state.tool ? 'crosshair' : 'default')
      }
      return true
    }

    if (state.mobileDragStart && ctrl._activeDragPointerId === e.pointerId) {
      const { pt: startPt, screenX: sx, screenY: sy } = state.mobileDragStart
      state.mobileDragStart             = null
      ctrl._activeDragPointerId         = null

      const savedTool = state.tool
      if (!savedTool) return true

      const pt       = this._pickPoint(e)
      const geometry = this._geometryForType(savedTool)
      const moved    = Math.hypot(e.clientX - sx, e.clientY - sy)

      if (geometry === 'point') {
        this._enterPendingState([startPt])
        return true
      }

      if (geometry === 'line') {
        if (moved < 8) {
          this._cancelDrawing()
          this._setTool(savedTool)
          return true
        }
        this._enterPendingState([startPt, pt])
        return true
      }

      if (geometry === 'region') {
        if (moved < 8) {
          this._cancelDrawing()
          this._setTool(savedTool)
          return true
        }
        const p1 = startPt
        const p2 = state.cursor ?? pt
        this._enterPendingState([
          new THREE.Vector3(p1.x, p1.y, 0),
          new THREE.Vector3(p2.x, p1.y, 0),
          new THREE.Vector3(p2.x, p2.y, 0),
          new THREE.Vector3(p1.x, p2.y, 0),
        ])
        return true
      }
    }

    return false
  }

  /**
   * Handles keydown in map mode (Escape / Enter).
   * @param {KeyboardEvent} e
   * @returns {boolean} true if event was consumed
   */
  onKeyDown(e) {
    const { state } = this
    if (!state.active) return false

    const { drawState, tool } = state

    if (e.key === 'Escape') {
      if (drawState === 'pending') {
        const savedTool = tool
        this._cancelDrawing()
        if (savedTool) this._setTool(savedTool)
      } else if (tool) {
        this._cancelDrawing()
      } else {
        this.exit()
      }
      return true
    }

    if (e.key === 'Enter' && tool) {
      if (drawState === 'pending') {
        this._confirmDrawing()
      } else {
        const geometry = this._geometryForType(tool)
        if (geometry === 'line' && state.points.length >= 2) {
          this._enterPendingState(state.points)
        }
      }
      return true
    }

    return true  // consume all keys while map mode is active
  }

  /**
   * Per-frame preview motion (ADR-072 refinement, Tier A) — called from
   * AppController._animate alongside MotionGovernor.tick. The cursor dot
   * breathes ("draw mode is live here" — the viewport sibling of the chrome
   * active-tool glow) and pops on entry; the snap ring settles on appearance
   * and then holds steady (a lock indicator must not breathe). All curve
   * shape lives in the pure `MapPreviewMath`; under reduced motion both
   * scales are exactly 1 — static cues, never a disappearance (#30/#11).
   * @param {number} t  loop clock (seconds)
   */
  tick(t) {
    const { state } = this
    if (!state.active) return

    if (state.cursorDot) {
      if (this._cursorBornAt === null) this._cursorBornAt = t
      state.cursorDot.scale.setScalar(
        cursorFrame(t, this._cursorBornAt, this._previewReduced).scale)
    } else {
      this._cursorBornAt = null
    }

    const ring = state.snapRingMesh
    if (ring?.visible) {
      if (this._ringBornAt === null) this._ringBornAt = t
      ring.scale.setScalar(ringFrame(t, this._ringBornAt, this._previewReduced).scale)
    } else {
      this._ringBornAt = null
    }
  }

  /**
   * Registers a SECOND touch finger and starts a pinch-zoom. Called by
   * AppController for a touch pointerdown that its single-drag guard would
   * otherwise ignore (a 2nd finger while the 1st is panning/drawing). Map Mode
   * is a full overlay, so it owns multi-touch here rather than OrbitControls
   * (which is disabled while the ortho camera is active).
   * @param {PointerEvent} e
   * @returns {boolean} true (always consumes)
   */
  onExtraTouchDown(e) {
    this._trackTouchDown(e)
    return true
  }

  /**
   * Records a touch pointer; when the second finger lands, begins the pinch.
   * @param {PointerEvent} e
   */
  _trackTouchDown(e) {
    const { state } = this
    state.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (state.touchPoints.size === 2) this._beginPinch()
  }

  /** Captures the pinch baseline (finger distance + current zoom). */
  _beginPinch() {
    const { state } = this
    const pts = [...state.touchPoints.values()]
    if (pts.length < 2) return
    const [a, b] = pts
    state.pinch = {
      startDist:    Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
      startFrustum: state.frustumSize,
    }
    state.pinchLock = true
    // Pinch supersedes any single-finger pan/draw already in progress.
    state.isPanning       = false
    state.panStart        = null
    state.mobileDragStart = null
    state.snapCandidate   = null
    this._snapFxPrev      = null
    this._clearPreview()
    this._ctrl._uiView.setCursor('default')
  }

  /**
   * Drives the ortho zoom from the live finger separation (spreading fingers
   * apart zooms in). Centred like the wheel zoom — no recentre. Clamped to the
   * same [FRUSTUM_MIN, FRUSTUM_MAX] band.
   */
  _updatePinch() {
    const { state } = this
    const pts = [...state.touchPoints.values()]
    if (pts.length < 2 || !state.pinch) return
    const [a, b] = pts
    const dist   = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)
    const factor = state.pinch.startDist / dist // fingers apart → dist↑ → zoom in
    state.frustumSize = Math.max(FRUSTUM_MIN,
      Math.min(FRUSTUM_MAX, state.pinch.startFrustum * factor))
    this._ctrl._sceneView.setOrthoZoom(state.frustumSize)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Returns true when running on a coarse-pointer (touch) device. */
  _isMobile() {
    return window.matchMedia('(pointer: coarse)').matches
  }

  /**
   * Returns the geometry kind for a place-type drawing tool.
   * @param {string} type
   * @returns {'line'|'region'|'point'}
   */
  _geometryForType(type) {
    if (type === 'zone') return 'region'
    if (type === 'hub' || type === 'anchor') return 'point'
    return 'line'
  }

  /** Returns the place type name capitalised from a tool type string. */
  _placeTypeForType(type) {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  /**
   * Sets the active map drawing tool, resetting to drawing state.
   * @param {string} type  PlaceType name lowercase: 'route'|'boundary'|'zone'|'hub'|'anchor'
   */
  _setTool(type) {
    this._cancelDrawing()
    const { state } = this
    state.tool          = type
    state.drawState     = 'drawing'
    state.points        = []
    state.pendingPoints = null
    state.pendingName   = null
    state.cursor        = null
    this._ctrl._uiView.setCursor('crosshair')
    this._refreshToolbar()
    this._updateStatus()
  }

  /** Cancels the current drawing without creating an entity. */
  _cancelDrawing() {
    this._clearPreview()
    const { state } = this
    state.tool            = null
    state.drawState       = 'idle'
    state.points          = []
    state.pendingPoints   = null
    state.pendingName     = null
    state.cursor          = null
    state.mobileDragStart = null
    state.snapCandidate   = null
    this._snapFxPrev      = null
    this._ctrl._uiView.setCursor('default')
    this._refreshToolbar()
    if (state.active) {
      this._ctrl._uiView.setStatus('Map Mode — select a type on the left to start drawing')
    }
  }

  /**
   * Transitions from drawing → pending state.
   * @param {THREE.Vector3[]} points  the completed geometry vertices
   */
  _enterPendingState(points) {
    const { state } = this
    if (!state.tool) return
    const placeType = this._placeTypeForType(state.tool)
    const n = ++state.nameCounters[placeType]
    state.drawState     = 'pending'
    state.pendingPoints = points.map(p => p.clone())
    state.pendingName   = `${placeType} ${n}`
    state.cursor        = null
    state.snapCandidate = null
    this._snapFxPrev    = null
    this._clearPreview()
    this._showPendingPreview()
    this._refreshToolbar()
    this._ctrl._uiView.setStatusRich([
      { text: placeType, bold: true, color: '#80cbc4' },
      { text: '— enter a name and confirm', color: COLOR.textSecondary },
      { text: '  ESC = cancel', color: '#444' },
    ])
  }

  /**
   * Confirms the pending entity.
   * Must only be called while drawState === 'pending'.
   */
  _confirmDrawing() {
    const { _ctrl: ctrl, state } = this
    const { tool, pendingPoints, pendingName } = state
    if (!tool || !pendingPoints) return

    const geometry  = this._geometryForType(tool)
    const placeType = this._placeTypeForType(tool)
    const renderer  = ctrl._sceneView.renderer

    const name = ctrl._uiView.getMapPendingName() ?? pendingName ?? placeType

    // Map objects rest on the ground plane or a building roof, never floating
    // (user requirement). `_pickPoint` returns Z=0 for the ortho top-down
    // preview (Z is invisible there); the committed entity is a flat plate
    // seated on max(building top under its footprint, 0), so an annotation
    // drawn over a Solid lands on the roof instead of buried at Z=0.
    const groundZ = ctrl._service.highestSurfaceZAt(pendingPoints)
    pendingPoints.forEach(p => { p.z = groundZ })

    let created = null
    try {
      if (geometry === 'point' && pendingPoints.length >= 1) {
        created = ctrl._service.createAnnotatedPoint(pendingPoints[0], name, {
          camera: ctrl._sceneView.camera, renderer, container: document.body,
        })
      } else if (geometry === 'line' && pendingPoints.length >= 2) {
        created = ctrl._service.createAnnotatedLine(pendingPoints, name, {
          camera: ctrl._sceneView.camera, renderer, container: document.body,
        })
      } else if (geometry === 'region' && pendingPoints.length >= 3) {
        created = ctrl._service.createAnnotatedRegion(pendingPoints, name, {
          camera: ctrl._sceneView.camera, renderer, container: document.body,
        })
      }
      if (created) {
        ctrl._service.setPlaceType(created.id, placeType)
        // Post-hoc recording (CommandStack push-vs-execute rule): the
        // entity already exists — record it so map placement is undoable
        // like every other add path (ADR-072 decision 2). placeType is set
        // BEFORE the push so one gesture is one undo step.
        const obj = created
        ctrl._commandStack.push(createAddAnnotationCommand(obj, ctrl._service, () => {
          // Clear a stale selection of the vanished entity (same shape as
          // _addObject's onAfterUndo); map placement never auto-selects,
          // but the user may select it later and then undo past the add.
          if (ctrl._scene.activeId !== obj.id) return
          const nextId = [...ctrl._scene.objects.entries()]
            .find(([k, o]) => k !== obj.id && !(o instanceof CoordinateFrame))?.[0] ?? null
          if (nextId) {
            ctrl._switchActiveObject(nextId, true)
          } else {
            ctrl._objSelected = false
            ctrl._selectedIds.clear()
            ctrl._refreshObjectModeStatus()
            ctrl._updateMobileToolbar()
          }
        }))
      }
    } catch (err) {
      console.error('[MapMode] entity creation failed:', err)
    } finally {
      this._clearPreview()
      state.drawState     = 'drawing'
      state.points        = []
      state.pendingPoints = null
      state.pendingName   = null
      state.cursor        = null
      this._refreshToolbar()
    }

    if (created) {
      ctrl._uiView.setStatus(`Map Mode — ${placeType} placed. Draw another or select a different type.`)
    }
  }

  /** Removes preview line, cursor dot, and snap ring from the Three.js scene. */
  _clearPreview() {
    const scene = this._ctrl._sceneView.scene
    const state = this.state
    if (state.previewLine) {
      scene.remove(state.previewLine)
      state.previewLine.geometry.dispose()
      state.previewLine.material.dispose()
      state.previewLine = null
    }
    if (state.cursorDot) {
      scene.remove(state.cursorDot)
      state.cursorDot.geometry.dispose()
      state.cursorDot.material.dispose()
      state.cursorDot = null
    }
    if (state.snapRingMesh) {
      scene.remove(state.snapRingMesh)
      state.snapRingMesh.geometry.dispose()
      state.snapRingMesh.material.dispose()
      state.snapRingMesh = null
    }
    state.snapCandidate = null
  }

  /**
   * Picks the ground-plane (Z=0) world position under the pointer in Map Mode.
   * Applies zoom-adaptive grid snapping (`mapGridStep`) then, on PC only,
   * endpoint snapping. The grid step tracks the ortho zoom so the user gets
   * finer placement by zooming in (ADR-072 addendum — the old fixed 1-unit grid
   * was "quite coarse", unplaceably so when zoomed in).
   * @param {PointerEvent|MouseEvent} e
   * @returns {THREE.Vector3}
   */
  _pickPoint(e) {
    const ctrl = this._ctrl
    const ndcX =  (e.clientX / innerWidth)  * 2 - 1
    const ndcY = -(e.clientY / innerHeight) * 2 + 1
    ctrl._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), ctrl._sceneView.activeCamera)
    const pt = new THREE.Vector3()
    ctrl._raycaster.ray.intersectPlane(ctrl._groundPlane, pt)
    pt.z = 0

    const GRID = mapGridStep(this.state.frustumSize)
    pt.x = Math.round(pt.x / GRID) * GRID
    pt.y = Math.round(pt.y / GRID) * GRID

    if (!this._isMobile()) {
      const { snapped, point } = this._snapToEndpoint(pt, e.clientX, e.clientY)
      this.state.snapCandidate = snapped
      this._syncSnapFx()
      return point
    }

    this.state.snapCandidate = null
    return pt
  }

  /**
   * Endpoint-snap engagement flash (ADR-072 decision 3): renders the lock
   * EVENT (free→locked = engage, endpoint change = retarget) at the snap
   * point, reusing the ADR-065 Phase 2 vocabulary wholesale — pure math from
   * `SnapFeedbackMath`, view `SnapFlash`, spawned only through the
   * MotionGovernor. Same-key hold and disengagement stay silent (volume
   * design); `_snapFxPrev` is controller-local presentation history.
   * The map has no grabbed entity, so the size analog is frustum-proportional
   * (a fixed fraction of the visible world height — screen-stable, #27).
   */
  _syncSnapFx() {
    const { _ctrl: ctrl, state } = this
    const snap = state.snapCandidate
    const next = snap
      ? geometrySnapshot(true, {
          label: 'map-endpoint',
          position: { x: snap.x, y: snap.y, z: snap.z },
        })
      : null
    const transition = snapTransition(this._snapFxPrev, next)
    this._snapFxPrev = next
    if (!transition) return
    const desc = snapFlashDescriptor('geometry', transition, next, state.frustumSize * 0.075)
    if (!desc) return
    ctrl._motion.spawn(reduced =>
      new SnapFlash(ctrl._sceneView.scene, ctrl._sceneView, desc, { reduced }))
  }

  /**
   * Snaps a grid-snapped world point to a nearby annotated entity vertex (PC only).
   * @param {THREE.Vector3} gridPt
   * @param {number} screenX
   * @param {number} screenY
   * @param {number} [snapPx=20]
   * @returns {{ snapped: THREE.Vector3|null, point: THREE.Vector3 }}
   */
  _snapToEndpoint(gridPt, screenX, screenY, snapPx = 20) {
    const ctrl = this._ctrl
    const cam  = ctrl._sceneView.activeCamera
    let bestDist = snapPx
    let bestPt   = null

    for (const obj of ctrl._scene.objects.values()) {
      const verts = (obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint)
        ? obj.vertices.map(v => v.position)
        : null
      if (!verts) continue

      for (const vert of verts) {
        const sv = ctrl._projectToScreen(vert, cam)
        const d  = Math.hypot(screenX - sv.x, screenY - sv.y)
        if (d < bestDist) { bestDist = d; bestPt = vert.clone() }
      }
    }

    return bestPt
      ? { snapped: bestPt, point: bestPt }
      : { snapped: null,   point: gridPt }
  }

  /**
   * Updates the live preview during map drawing (drawing state only).
   * In pending state use _showPendingPreview() instead.
   */
  _updatePreview() {
    const { state } = this
    const { tool, points, cursor, mobileDragStart, drawState } = state
    if (!tool || drawState !== 'drawing') return
    if (!cursor) return

    const scene    = this._ctrl._sceneView.scene
    const geometry = this._geometryForType(tool)
    const entry    = getPlaceTypeEntry(this._placeTypeForType(tool))
    const color    = entry ? parseInt(entry.color.slice(1), 16) : 0x80cbc4

    // Cursor dot — shown only in drawing state
    if (!state.cursorDot) {
      const g = new THREE.SphereGeometry(0.08, 8, 8)
      const m = new THREE.MeshBasicMaterial({ color, depthTest: false })
      state.cursorDot = new THREE.Mesh(g, m)
      state.cursorDot.renderOrder = 3
      scene.add(state.cursorDot)
    }
    state.cursorDot.position.copy(cursor)
    state.cursorDot.material.color.setHex(color)

    this._updateSnapRing(state.snapCandidate, color)

    let previewPts = null

    if (geometry === 'region' && mobileDragStart) {
      const p1 = mobileDragStart.pt
      const p2 = cursor
      previewPts = [
        new THREE.Vector3(p1.x, p1.y, 0),
        new THREE.Vector3(p2.x, p1.y, 0),
        new THREE.Vector3(p2.x, p2.y, 0),
        new THREE.Vector3(p1.x, p2.y, 0),
        new THREE.Vector3(p1.x, p1.y, 0),
      ]
    } else if (geometry === 'line' && mobileDragStart) {
      previewPts = [mobileDragStart.pt, cursor]
    } else if (geometry !== 'point' && points.length > 0) {
      previewPts = [...points, cursor]
      if (geometry === 'region' && previewPts.length >= 3) previewPts.push(previewPts[0])
    }

    if (previewPts) {
      const flat = []
      for (const p of previewPts) flat.push(p.x, p.y, p.z)

      if (!state.previewLine) {
        const geo = new THREE.BufferGeometry()
        const mat = new THREE.LineBasicMaterial({
          color, depthTest: false, transparent: true, opacity: 0.70,
        })
        state.previewLine = new THREE.Line(geo, mat)
        state.previewLine.renderOrder = 2
        scene.add(state.previewLine)
      }
      state.previewLine.geometry.setAttribute(
        'position', new THREE.Float32BufferAttribute(new Float32Array(flat), 3),
      )
      state.previewLine.geometry.attributes.position.needsUpdate = true
      state.previewLine.material.color.setHex(color)
    } else if (state.previewLine) {
      scene.remove(state.previewLine)
      state.previewLine.geometry.dispose()
      state.previewLine.material.dispose()
      state.previewLine = null
    }
  }

  /**
   * Creates or updates the static dashed preview for the pending state (ADR-031 §3).
   */
  _showPendingPreview() {
    const { state } = this
    const { tool, pendingPoints } = state
    if (!tool || !pendingPoints) return

    const scene    = this._ctrl._sceneView.scene
    const geometry = this._geometryForType(tool)
    const entry    = getPlaceTypeEntry(this._placeTypeForType(tool))
    const color    = entry ? parseInt(entry.color.slice(1), 16) : 0x80cbc4

    if (state.cursorDot) {
      scene.remove(state.cursorDot)
      state.cursorDot.geometry.dispose()
      state.cursorDot.material.dispose()
      state.cursorDot = null
    }
    this._updateSnapRing(null, color)

    let previewPts = [...pendingPoints]
    if (geometry === 'region' && previewPts.length >= 3) previewPts.push(previewPts[0])

    if (previewPts.length < 2) {
      if (state.previewLine) {
        scene.remove(state.previewLine)
        state.previewLine.geometry.dispose()
        state.previewLine.material.dispose()
        state.previewLine = null
      }
      if (previewPts.length === 1) {
        const g = new THREE.SphereGeometry(0.15, 12, 12)
        const m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })
        const dot = new THREE.Mesh(g, m)
        dot.position.copy(previewPts[0])
        dot.renderOrder = 3
        scene.add(dot)
        state.previewLine = dot
      }
      return
    }

    const flat = []
    for (const p of previewPts) flat.push(p.x, p.y, p.z)

    if (state.previewLine) {
      scene.remove(state.previewLine)
      state.previewLine.geometry.dispose()
      state.previewLine.material.dispose()
      state.previewLine = null
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(flat), 3))
    const mat = new THREE.LineDashedMaterial({
      color,
      dashSize:    0.40,
      gapSize:     0.20,
      depthTest:   false,
      transparent: true,
      opacity:     0.90,
    })
    const line = new THREE.Line(geo, mat)
    line.computeLineDistances()
    line.renderOrder = 2
    scene.add(line)
    state.previewLine = line
  }

  /**
   * Shows or hides the endpoint snap indicator ring (PC only, ADR-031 §6).
   * @param {THREE.Vector3|null} snapPt
   * @param {number} color
   */
  _updateSnapRing(snapPt, color) {
    const { state } = this
    const scene = this._ctrl._sceneView.scene

    if (!snapPt) {
      if (state.snapRingMesh) state.snapRingMesh.visible = false
      return
    }

    if (!state.snapRingMesh) {
      const geo = new THREE.RingGeometry(0.18, 0.30, 16)
      const mat = new THREE.MeshBasicMaterial({
        depthTest:   false,
        transparent: true,
        opacity:     0.85,
        side:        THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 5
      scene.add(mesh)
      state.snapRingMesh = mesh
    }

    state.snapRingMesh.visible = true
    state.snapRingMesh.material.color.setHex(color)
    state.snapRingMesh.position.copy(snapPt)
    state.snapRingMesh.position.z = 0
  }

  /** Updates the status bar text during map drawing. */
  _updateStatus() {
    const { state } = this
    const { tool, points, drawState } = state
    if (!tool) return
    if (drawState === 'pending') return

    const geometry  = this._geometryForType(tool)
    const typeLabel = this._placeTypeForType(tool)
    const n      = points.length
    const mobile = this._isMobile()

    if (geometry === 'point') {
      this._ctrl._uiView.setStatusRich([
        { text: typeLabel, bold: true, color: '#80cbc4' },
        { text: mobile ? 'Tap to place' : 'Click to place', color: COLOR.textSecondary },
        { text: '  ESC cancel', color: '#444' },
      ])
    } else if (geometry === 'line') {
      if (mobile) {
        this._ctrl._uiView.setStatusRich([
          { text: typeLabel, bold: true, color: '#80cbc4' },
          { text: 'Drag to draw a straight line', color: COLOR.textSecondary },
          { text: '  ESC cancel', color: '#444' },
        ])
      } else {
        this._ctrl._uiView.setStatusRich([
          { text: typeLabel, bold: true, color: '#80cbc4' },
          { text: `${n} pts`, color: '#aaa' },
          { text: 'click to add vertex', color: COLOR.textSecondary },
          { text: n >= 2 ? '  Enter / RMB = done' : '', color: '#aaa' },
          { text: '  ESC cancel', color: '#444' },
        ])
      }
    } else {
      this._ctrl._uiView.setStatusRich([
        { text: typeLabel, bold: true, color: '#80cbc4' },
        { text: 'Drag to draw rectangle', color: COLOR.textSecondary },
        { text: '  ESC cancel', color: '#444' },
      ])
    }
  }

  /**
   * Rebuilds the Map toolbar to reflect current state.
   * In pending state: shows name input + Confirm + Cancel.
   * In drawing state: shows tool buttons + (Confirm if ready) + Cancel.
   */
  _refreshToolbar() {
    const { state } = this
    if (!state.active) return
    const { tool, drawState, pendingName } = state

    const isPending  = drawState === 'pending'
    const canConfirm = isPending

    this._ctrl._uiView.showMapToolbar(
      tool,
      (t) => this._setTool(t),
      canConfirm ? () => this._confirmDrawing() : null,
      tool       ? () => this._cancelDrawing()  : null,
      ()         => this.exit(),
      isPending ? (pendingName ?? '') : null,
    )
  }
}
