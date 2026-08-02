/**
 * PlaceToolController — owns the annotation DRAWING TOOL and nothing else.
 *
 * ## What this used to be (ADR-103)
 *
 * This was `MapModeController`, a third top-level mode alongside OBJECT / EDIT.
 * The mode fused three unrelated things: a camera ORIENTATION (top-down), a
 * PROJECTION (orthographic), and a set of DRAWING TOOLS. Fusing them made
 * `edit ∧ mapMode.active` representable (an illegal state held off only by
 * convention) while making "edit while looking straight down" — a thing users
 * actually want — unreachable. ADR-103 took the three apart and put each back
 * on a shelf that already existed:
 *
 *   - orientation → the world gizmo (Z axis click, eased flight since ADR-068)
 *   - projection  → `SceneView.setProjection()` (a view setting, not a mode)
 *   - tools       → the `+ Add` menu, next to every other "place a thing" verb
 *   - entities    → plain scene objects (they always were)
 *
 * What survives is this: the tool state. It is orthogonal to both the camera and
 * the mode, exactly like Sketch drawing.
 *
 * ## State (STATE_LEDGER §配置ツール)
 *
 *   tool       'route'|'boundary'|'zone'|'hub'|'anchor'|null   cardinality 0..1
 *   drawState  'idle'|'drawing'   (ADR-031 §1; ADR-073 removed 'pending')
 *
 * `tool === null` is the common, legitimate case: no tool selected means the
 * viewport behaves exactly as it always does (select, orbit, grab). Nothing here
 * intercepts input while the cardinality is 0.
 *
 * Completing the geometry (click a point / release a drag / Enter|RMB a line)
 * creates the entity IMMEDIATELY with an auto-name — no name form, no confirm.
 *
 * ## What this controller deliberately does NOT own
 *
 * Camera. There is no pan, no wheel zoom, no pinch handling here any more:
 * OrbitControls owns all three, and `SceneView.setDrawGestureActive()` suspends
 * only the two gestures a drawing tool truly consumes (RMB, one-finger drag —
 * 原則 #14). The old code carried its own pan state, its own frustum size, its
 * own pinch tracker and its own saved-view/stolen-camera guard; every one of
 * those existed only because the mode had taken the camera hostage.
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
import { frustumForDistance } from '../../view/CameraMath.js'
import { createAddAnnotationCommand } from '../../command/AddAnnotationCommand.js'
import { geometrySnapshot, snapTransition, snapFlashDescriptor } from '../../view/SnapFeedbackMath.js'
import { SnapFlash } from '../../view/SnapFlash.js'
import { cursorFrame, ringFrame, mapGridStep } from '../../view/MapPreviewMath.js'
import { prefersReducedMotion } from '../../theme/motion.js'
import { COLOR } from '../../theme/tokens.js'

/**
 * The place types this tool can draw, in the order they are offered. The single
 * source for "which tools exist" — the Add menu reads it rather than repeating
 * the list (§1.1).
 */
export const PLACE_TOOLS = Object.freeze([
  { type: 'route',    label: 'Route',    geometry: 'line'   },
  { type: 'boundary', label: 'Boundary', geometry: 'line'   },
  { type: 'zone',     label: 'Zone',     geometry: 'region' },
  { type: 'hub',      label: 'Hub',      geometry: 'point'  },
  { type: 'anchor',   label: 'Anchor',   geometry: 'point'  },
])

/** Tool type → entry. Unknown types throw rather than defaulting (原則 #31). */
const TOOL_BY_TYPE = new Map(PLACE_TOOLS.map(t => [t.type, t]))

export class PlaceToolController {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /** @type {object} All mutable place-tool state */
    this.state = {
      /** Active drawing tool: 'route'|'boundary'|'zone'|'hub'|'anchor'|null */
      tool:   null,
      /** 'idle'|'drawing' (ADR-031 §1; the old 'pending' name+confirm gate was
       *  removed by ADR-073 — geometry completion creates immediately) */
      drawState: 'idle',
      /** @type {THREE.Vector3[]} vertex positions collected during drawing */
      points: [],
      /** @type {THREE.Vector3|null} live cursor world position */
      cursor: null,
      /** THREE.Line preview drawn while placing */
      previewLine: null,
      /** THREE.Mesh cursor dot */
      cursorDot:   null,
      /**
       * Drag start: set on pointerdown for the drag-shaped gestures (all types
       * on touch, Region on PC). Cleared on pointerup.
       * @type {{ pt: THREE.Vector3, screenX: number, screenY: number }|null}
       */
      dragStart: null,
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
    }

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
     * frame each exists; reduced-motion is sampled once per tool activation
     * from the single boundary (per-spawn discipline, ADR-065 Ph 5).
     */
    this._cursorBornAt   = null
    this._ringBornAt     = null
    this._previewReduced = false
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** True when a drawing tool is selected (the pointer-handler guard). */
  get hasTool() { return !!this.state.tool }

  /**
   * Selects a place tool — the ONE entry point for arming the drawing gesture
   * (原則 #1). Wired to the `+ Add` menu's Place group; there is no mode to
   * enter first and the camera is not touched (ADR-103: if the user wants a
   * top-down view they press the gizmo's Z axis, which is where that control
   * has always lived).
   * @param {string} type  'route'|'boundary'|'zone'|'hub'|'anchor'
   */
  setTool(type) {
    if (!TOOL_BY_TYPE.has(type)) throw new Error(`[PlaceTool] unknown place tool "${type}"`)
    this.cancel()
    const { state } = this
    state.tool           = type
    state.drawState      = 'drawing'
    state.points         = []
    state.cursor         = null
    this._previewReduced = prefersReducedMotion()
    this._ctrl._sceneView.setDrawGestureActive(true)
    this._ctrl._uiView.setCursor('crosshair')
    this._updateStatus()
    this._ctrl._updateMobileToolbar()
  }

  /**
   * Disarms the tool and discards any in-progress geometry — the ONE exit
   * (原則 #1). Idempotent: calling it with no tool active is a no-op, so ESC in
   * an ordinary viewport is not intercepted.
   */
  cancel() {
    const { state } = this
    const had = !!state.tool
    this._clearPreview()
    state.tool          = null
    state.drawState     = 'idle'
    state.points        = []
    state.cursor        = null
    state.dragStart     = null
    state.snapCandidate = null
    this._snapFxPrev    = null
    this._cursorBornAt  = null
    this._ringBornAt    = null
    if (!had) return
    this._ctrl._sceneView.setDrawGestureActive(false)
    this._ctrl._uiView.setCursor('default')
    this._ctrl._refreshObjectModeStatus()
    this._ctrl._updateMobileToolbar()
  }

  /**
   * Handles pointermove while a tool is armed (drawing preview only — panning
   * belongs to OrbitControls now).
   * @param {PointerEvent} e
   * @returns {boolean} true if event was consumed
   */
  onPointerMove(e) {
    const { state } = this
    if (!state.tool) return false
    if (state.drawState !== 'drawing') return false
    state.cursor = this._pickPoint(e)
    this._updatePreview()
    return true
  }

  /**
   * Handles pointerdown while a tool is armed.
   * @param {PointerEvent} e
   * @returns {boolean} true if event was consumed
   */
  onPointerDown(e) {
    const { _ctrl: ctrl, state } = this
    if (!state.tool) return false

    if (e.button === 0) {
      const pt       = this._pickPoint(e)
      const geometry = this._geometryForType(state.tool)

      if (this._isMobile()) {
        // Mobile: single drag gesture for all types (ADR-031 §2)
        state.dragStart = { pt: pt.clone(), screenX: e.clientX, screenY: e.clientY }
        state.cursor    = pt.clone()
        ctrl._activeDragPointerId = e.pointerId
        this._updatePreview()
        return true
      }

      // PC interaction
      if (geometry === 'point') {
        // Single click creates immediately — no name form (ADR-073)
        this._createAnnotation([pt])
        return true
      }

      if (geometry === 'region') {
        // Drag-to-rectangle: record drag start; pointerup creates the region
        state.dragStart = { pt: pt.clone(), screenX: e.clientX, screenY: e.clientY }
        state.cursor    = pt.clone()
        ctrl._activeDragPointerId = e.pointerId
        const typeLabel = this._placeTypeForType(state.tool)
        ctrl._uiView.setStatusRich([
          { text: typeLabel, bold: true, color: '#80cbc4' },
          { text: 'drag to draw rectangle', color: COLOR.textSecondary },
          { text: '  ESC cancel', color: '#444' },
        ])
        return true
      }

      // Line (PC): each click adds a vertex; Enter/RMB completes → creates
      state.points.push(pt.clone())
      state.cursor = pt.clone()
      this._updatePreview()
      this._updateStatus()
      return true
    }

    if (e.button === 2) {
      const { points } = state
      // RMB while armed: PC Line with ≥2 pts → create immediately; else disarm.
      // OrbitControls' RMB orbit is suspended while a tool is armed
      // (setDrawGestureActive — a true gesture conflict, 原則 #14).
      const geometry = this._geometryForType(state.tool)
      if (geometry === 'line' && points.length >= 2) {
        this._createAnnotation(points)
      } else {
        this.cancel()
      }
      return true
    }

    return false  // middle button → OrbitControls dolly
  }

  /**
   * Handles pointerup while a tool is armed (drag gesture completion).
   * @param {PointerEvent} e
   * @returns {boolean} true if event was consumed
   */
  onPointerUp(e) {
    const { _ctrl: ctrl, state } = this
    if (!state.tool) return false

    if (state.dragStart && ctrl._activeDragPointerId === e.pointerId) {
      const { pt: startPt, screenX: sx, screenY: sy } = state.dragStart
      state.dragStart           = null
      ctrl._activeDragPointerId = null

      const savedTool = state.tool
      const pt        = this._pickPoint(e)
      const geometry  = this._geometryForType(savedTool)
      const moved     = Math.hypot(e.clientX - sx, e.clientY - sy)

      if (geometry === 'point') {
        this._createAnnotation([startPt])
        return true
      }

      if (moved < 8) {
        // A tap where a drag was needed: re-arm the same tool rather than
        // silently dropping the gesture (原則 #11).
        this.cancel()
        this.setTool(savedTool)
        return true
      }

      if (geometry === 'line') {
        this._createAnnotation([startPt, pt])
        return true
      }

      const p1 = startPt
      const p2 = state.cursor ?? pt
      this._createAnnotation([
        new THREE.Vector3(p1.x, p1.y, 0),
        new THREE.Vector3(p2.x, p1.y, 0),
        new THREE.Vector3(p2.x, p2.y, 0),
        new THREE.Vector3(p1.x, p2.y, 0),
      ])
      return true
    }

    return false
  }

  /**
   * Handles keydown while a tool is armed (Escape / Enter). Every other key
   * falls through — the tool is not a mode, so it does not swallow the app's
   * keyboard (the old Map Mode consumed ALL keys).
   * @param {KeyboardEvent} e
   * @returns {boolean} true if event was consumed
   */
  onKeyDown(e) {
    const { state } = this
    if (!state.tool) return false

    if (e.key === 'Escape') {
      this.cancel()
      return true
    }

    // Enter finalizes a PC multi-vertex line → creates immediately (ADR-073)
    if (e.key === 'Enter') {
      const geometry = this._geometryForType(state.tool)
      if (geometry === 'line' && state.points.length >= 2) {
        this._createAnnotation(state.points)
        return true
      }
    }

    return false
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
    if (!state.tool) return

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

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Returns true when running on a coarse-pointer (touch) device. */
  _isMobile() {
    return window.matchMedia('(pointer: coarse)').matches
  }

  /**
   * The visible world height at the orbit target — the screen-space size analog
   * the old code read off `state.frustumSize`. Derived from the camera rather
   * than stored, so it is correct in BOTH projections and cannot go stale
   * (原則 #23/#27: a screen-px target paired with a scene-derived world cap).
   * @returns {number}
   */
  _visibleWorldHeight() {
    const sv = this._ctrl._sceneView
    const dist = Math.max(sv.camera.position.distanceTo(sv.controls.target), 1e-3)
    return frustumForDistance(dist, sv.camera.fov)
  }

  /**
   * Returns the geometry kind for a place-type drawing tool.
   * @param {string} type
   * @returns {'line'|'region'|'point'}
   */
  _geometryForType(type) {
    const entry = TOOL_BY_TYPE.get(type)
    if (!entry) throw new Error(`[PlaceTool] unknown place tool "${type}"`)
    return entry.geometry
  }

  /** Returns the place type name for a tool type string. */
  _placeTypeForType(type) {
    const entry = TOOL_BY_TYPE.get(type)
    if (!entry) throw new Error(`[PlaceTool] unknown place tool "${type}"`)
    return entry.label
  }

  /**
   * Creates the annotation entity immediately from completed geometry, with an
   * auto-generated default name (e.g. "Route 1") — NO name form, NO confirm step
   * (ADR-073: map objects are high-frequency "place a lot, rename later"). Rename
   * stays a separate deliberate act (N-panel / long-press). After creation the
   * tool stays active so the next object can be placed straight away ("ポンポン").
   * @param {THREE.Vector3[]} points  the completed geometry vertices
   */
  _createAnnotation(points) {
    const { _ctrl: ctrl, state } = this
    const { tool } = state
    if (!tool) return

    const geometry  = this._geometryForType(tool)
    const placeType = this._placeTypeForType(tool)
    const renderer  = ctrl._sceneView.renderer
    // Auto-name from the per-type counter — the single naming source for map
    // objects (no user input). Renaming later goes through the N-panel.
    const n    = ++state.nameCounters[placeType]
    const name = `${placeType} ${n}`

    // Map objects rest on the ground plane or a building roof, never floating
    // (user requirement). `_pickPoint` returns Z=0 on the ground plane; the
    // committed entity is a flat plate seated on max(building top under its
    // footprint, 0), so an annotation drawn over a Solid lands on the roof
    // instead of buried at Z=0.
    const pts = points.map(p => p.clone())
    const groundZ = ctrl._service.highestSurfaceZAt(pts)
    pts.forEach(p => { p.z = groundZ })

    let created = null
    try {
      if (geometry === 'point' && pts.length >= 1) {
        created = ctrl._service.createAnnotatedPoint(pts[0], name, {
          camera: ctrl._sceneView.camera, renderer, container: document.body,
        })
      } else if (geometry === 'line' && pts.length >= 2) {
        created = ctrl._service.createAnnotatedLine(pts, name, {
          camera: ctrl._sceneView.camera, renderer, container: document.body,
        })
      } else if (geometry === 'region' && pts.length >= 3) {
        created = ctrl._service.createAnnotatedRegion(pts, name, {
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
            ctrl._selMgr.selectOnly(nextId)
          } else {
            ctrl._selMgr.clearSelection()
          }
        }))
      }
    } catch (err) {
      console.error('[PlaceTool] entity creation failed:', err)
    } finally {
      this._clearPreview()
      state.drawState     = 'drawing'
      state.points        = []
      state.cursor        = null
      state.snapCandidate = null
      this._snapFxPrev    = null
    }

    if (created) {
      ctrl._uiView.setStatus(
        `${placeType} placed. Draw another, or ESC to finish.`)
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
   * Picks the ground-plane (Z=0) world position under the pointer. Applies
   * zoom-adaptive grid snapping (`mapGridStep`) then, on PC only, endpoint
   * snapping. The grid step tracks the visible world height so the user gets
   * finer placement by zooming in (ADR-072 addendum — the old fixed 1-unit grid
   * was "quite coarse", unplaceably so when zoomed in).
   *
   * Raycasts through `activeCamera`, so it is correct under BOTH projections —
   * drawing no longer requires a top-down ortho camera, it just reads better
   * there (ADR-103 §未解決: the tool does not tilt the camera for you).
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

    const GRID = mapGridStep(this._visibleWorldHeight())
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
   * There is no grabbed entity here, so the size analog is a fraction of the
   * visible world height — screen-stable in both projections (#27).
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
    const desc = snapFlashDescriptor('geometry', transition, next,
      this._visibleWorldHeight() * 0.075)
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
   * Updates the live preview during drawing (drawing state only).
   */
  _updatePreview() {
    const { state } = this
    const { tool, points, cursor, dragStart, drawState } = state
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

    if (geometry === 'region' && dragStart) {
      const p1 = dragStart.pt
      const p2 = cursor
      previewPts = [
        new THREE.Vector3(p1.x, p1.y, 0),
        new THREE.Vector3(p2.x, p1.y, 0),
        new THREE.Vector3(p2.x, p2.y, 0),
        new THREE.Vector3(p1.x, p2.y, 0),
        new THREE.Vector3(p1.x, p1.y, 0),
      ]
    } else if (geometry === 'line' && dragStart) {
      previewPts = [dragStart.pt, cursor]
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

  /** Updates the status bar text while a tool is armed. */
  _updateStatus() {
    const { state } = this
    const { tool, points } = state
    if (!tool) return

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
}
