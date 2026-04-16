/**
 * AppController - handles user input and coordinates the animation loop.
 *
 * Connects SceneModel (domain state) with the View layer (SceneView / MeshView /
 * UIView / OutlinerView). Owns only transient interaction state (drag, hover,
 * grab, sketch phase, etc.) — persistent domain state lives in SceneModel.
 *
 * Side effects: event listener registration, requestAnimationFrame, SceneModel
 * and View mutations.
 */
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import {
  buildCuboidFromRect,
  computeOutwardFaceNormal,
  getCentroid,
  toNDC,
  getPivotCandidates,
  getVertexPivotCandidates,
  getEdgePivotCandidates,
  getFacePivotCandidates,
  collectSnapTargets,
  collectWorldSnapTargets,
} from '../model/CuboidModel.js'
import { SceneService }    from '../service/SceneService.js'
import { Solid }           from '../domain/Solid.js'
import { Profile }         from '../domain/Profile.js'
import { ImportedMesh }      from '../domain/ImportedMesh.js'
import { MeasureLine }       from '../domain/MeasureLine.js'
import { CoordinateFrame }   from '../domain/CoordinateFrame.js'
import { Face }            from '../graph/Face.js'
import { ICONS }           from '../view/UIView.js'
import { NodeEditorView }  from '../view/NodeEditorView.js'
import { CommandStack }              from '../service/CommandStack.js'
import { createMoveCommand }          from '../command/MoveCommand.js'
import { createExtrudeSketchCommand } from '../command/ExtrudeSketchCommand.js'
import { createAddSolidCommand }      from '../command/AddSolidCommand.js'
import { createDeleteCommand }        from '../command/DeleteCommand.js'
import { createRenameCommand }        from '../command/RenameCommand.js'
import { createFrameRotateCommand }   from '../command/FrameRotateCommand.js'
import { createSetIfcClassCommand }   from '../command/SetIfcClassCommand.js'
import { createSetPlaceTypeCommand }  from '../command/SetPlaceTypeCommand.js'  // N-panel place type change (post-hoc push)
import { createReparentFrameCommand } from '../command/ReparentFrameCommand.js'
import { downloadSceneJson }          from '../service/SceneExporter.js'
import { parseImportJson }            from '../service/SceneImporter.js'
import { AnnotatedLine }   from '../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../domain/AnnotatedPoint.js'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'
import { SpatialLink } from '../domain/SpatialLink.js'
import { createSpatialLinkCommand }           from '../command/CreateSpatialLinkCommand.js'
import { createDeleteSpatialLinkCommand }     from '../command/DeleteSpatialLinkCommand.js'
import { createCreateCoordinateFrameCommand } from '../command/CreateCoordinateFrameCommand.js'
import { createMountAnnotationCommand }       from '../command/MountAnnotationCommand.js'

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Returns the set of valid linkType values for a given source/target entity pair.
 * Based on ADR-032 §2 validation table.
 * @param {object|null} source
 * @param {object|null} target
 * @returns {string[]}
 */
function _computeValidLinkTypes(source, target) {
  const isAnnotated = o => o instanceof AnnotatedLine || o instanceof AnnotatedRegion || o instanceof AnnotatedPoint
  const isCF = o => o instanceof CoordinateFrame

  const geometric = []
  if (isAnnotated(source) && isCF(target))  geometric.push('mounts')
  if ((source instanceof Solid || isAnnotated(source)) && isCF(target)) geometric.push('fastened')
  if (isCF(source) && isCF(target)) geometric.push('aligned')

  const topological = ['adjacent', 'above']
  if (source instanceof AnnotatedRegion) topological.push('contains')
  if (source instanceof AnnotatedLine)   topological.push('connects')

  const semantic = ['references', 'represents']

  return [...geometric, ...topological, ...semantic]
}

export class AppController {
  /**
   * @param {import('../view/SceneView.js').SceneView}       sceneView
   * @param {import('../view/UIView.js').UIView}             uiView
   * @param {import('../view/GizmoView.js').GizmoView}       gizmoView
   * @param {import('../view/OutlinerView.js').OutlinerView} outlinerView
   */
  constructor(sceneView, uiView, gizmoView = null, outlinerView = null) {
    this._sceneView    = sceneView
    this._uiView       = uiView
    this._gizmoView    = gizmoView
    this._outlinerView = outlinerView

    // ── Application service (owns SceneModel aggregate root) ─────────────
    this._service = new SceneService(sceneView.scene)

    // ── Undo / Redo command history (ADR-022) ─────────────────────────────
    this._commandStack = new CommandStack()

    // ── Domain event subscriptions — keep View in sync with domain state ──
    this._service.on('objectAdded',   obj       => {
      const type = obj instanceof ImportedMesh
        ? 'imported'
        : obj instanceof MeasureLine
          ? 'measure'
          : obj instanceof CoordinateFrame
            ? 'frame'
            : obj instanceof Profile
              ? 'sketch'
              : obj instanceof AnnotatedLine
                ? 'annot-line'
                : obj instanceof AnnotatedRegion
                  ? 'annot-region'
                  : obj instanceof AnnotatedPoint
                    ? 'annot-point'
                    : 'cuboid'
      outlinerView?.addObject(obj.id, obj.name, type, obj.parentId ?? null)
      // Origin frames are locked — cannot be dragged to a new parent (ADR-028)
      if (obj instanceof CoordinateFrame && obj.name === 'Origin') {
        outlinerView?.setObjectLocked(obj.id, true)
      }
      // New CoordinateFrame always starts unreferenced (ADR-033 Phase C-4)
      if (obj instanceof CoordinateFrame) {
        outlinerView?.setFrameUnreferenced(obj.id, true)
      }
      if (obj.ifcClass) outlinerView?.setObjectIfcClass(obj.id, obj.ifcClass)
      if (obj.placeType) outlinerView?.setObjectPlaceType(obj.id, obj.placeType)
    })
    // Update outliner hierarchy and N panel when a frame is re-parented (ADR-028)
    this._service.on('frameReparented', ({ id, newParentId }) => {
      outlinerView?.reparentObject(id, newParentId)
      if (id === this._scene.activeId) this._updateNPanel()
    })
    this._service.on('objectRemoved', id        => outlinerView?.removeObject(id))
    this._service.on('objectRenamed', (id, nm)  => {
      outlinerView?.setObjectName(id, nm)
      if (id === this._scene.activeId && this._scene.selectionMode === 'object') {
        this._refreshObjectModeStatus()
      }
    })
    this._service.on('activeChanged', id        => outlinerView?.setActive(id))
    this._service.on('objectIfcClassChanged', (id, ifcClass) => {
      outlinerView?.setObjectIfcClass(id, ifcClass)
    })
    this._service.on('objectPlaceTypeChanged', (id, placeType) => {
      outlinerView?.setObjectPlaceType(id, placeType)
      // Update view color when place type changes
      const obj = this._scene.getObject(id)
      if (obj?.meshView?.setPlaceType) obj.meshView.setPlaceType(placeType, obj.name)
      // Refresh N panel if this is the active object
      if (id === this._scene.activeId) this._updateNPanel()
    })
    // SpatialLink events — refresh outliner badges and N panel (ADR-030 Phase 4)
    this._service.on('spatialLinkAdded', (link) => {
      this._refreshLinkBadge(link.sourceId)
      this._refreshLinkBadge(link.targetId)
      if (link.sourceId === this._scene.activeId || link.targetId === this._scene.activeId) {
        this._updateNPanel()
      }
    })
    this._service.on('spatialLinkRemoved', () => {
      // Refresh all badges — a removal may drop an entity's link count to 0
      for (const obj of this._scene.objects.values()) {
        this._refreshLinkBadge(obj.id)
      }
      if (this._activeObj) this._updateNPanel()
    })

    this._service.on('geometryApplied', ({ objectId }) => {
      this._importProgressUnsub?.(); this._importProgressUnsub = null
      this._uiView.hideImportProgress()
      const obj = this._scene.getObject(objectId)
      const sphere = obj?.meshView?.cuboid?.geometry?.boundingSphere
      if (sphere && sphere.radius > 0) {
        this._sceneView.fitCameraToSphere(sphere.center, sphere.radius)
      }
    })
    this._service.on('geometryError', ({ message }) => {
      this._importProgressUnsub?.(); this._importProgressUnsub = null
      this._uiView.hideImportProgress()
      this._uiView.showToast(`Geometry error: ${message}`)
    })
    this._service.on('wsDisconnected', () => {
      // If an import was in progress when the server dropped, clear it and notify.
      if (this._importProgressUnsub) {
        this._importProgressUnsub(); this._importProgressUnsub = null
        this._uiView.hideImportProgress()
        this._uiView.showToast('サーバーとの接続が切れました。インポートを再試行してください。', { type: 'error', duration: 5000 })
      }
    })

    // ── Wasm batch geometry rebuild progress (ADR-027 Phase 2) ────────────────
    this._service.on('batchRebuildStart', ({ total }) => {
      this._uiView.showImportProgress(0, `Building geometry… (0 / ${total})`)
    })
    this._service.on('batchRebuildProgress', ({ done, total }) => {
      const pct = Math.round((done / total) * 100)
      this._uiView.showImportProgress(pct, `Building geometry… (${done} / ${total})`)
    })
    this._service.on('batchRebuildEnd', () => {
      this._uiView.hideImportProgress()
    })

    // ── Measure placement state ────────────────────────────────────────────
    // Active while the user is placing a MeasureLine (M key / Add → Measure).
    // Phase 1: waiting for first click (p1 = null)
    // Phase 2: p1 set, waiting for second click (preview line shown)
    this._measure = {
      active:       false,
      /** @type {THREE.Vector3|null} fixed first endpoint */
      p1:           null,
      /** @type {THREE.Vector3|null} live cursor position (snapped) */
      p2:           null,
      /** @type {{label:string, position:THREE.Vector3, type:string, objectId:string, elementId:string}[]} */
      snapTargets:  [],
      snapping:     false,
      /** @type {{label:string, position:THREE.Vector3, type:string, objectId:string, elementId:string}|null} */
      snappedTarget: null,
      /** Anchor reference captured when p1 was confirmed (ADR-028).
       *  @type {{ objectId:string, type:string, elementId:string }|null} */
      p1Anchor:     null,
      /** Three.js Line for preview before entity is created */
      previewLine:  null,
      /** True while the user is holding a pointer down to snap a point */
      pressing:     false,
      /** MeshView used for snap candidate display (may differ from _meshView when active obj is MeasureLine) */
      snapMeshView: null,
    }

    // ── SpatialLink creation state (ADR-030 Phase 4) ──────────────────────
    // Active while the user is selecting a target entity after pressing L.
    // Phase 1: sourceId captured, waiting for target click.
    this._spatialLinkMode = {
      active:           false,
      /** @type {string|null} ID of the source entity */
      sourceId:         null,
      /** @type {string|null} ID of the candidate target (pending picker) */
      pendingTargetId:  null,
    }

    // ── Mount picking state (ADR-032 Phase H-6, Mobile) ──────────────────
    // Entered via "Mount on frame ⊕" long-press context menu item.
    // The user taps a CoordinateFrame as the mount target.
    this._mountPicking = {
      active:   false,
      /** @type {string|null} ID of the Annotated* entity to mount */
      sourceId: null,
    }

    // ── 2D Map Mode state ─────────────────────────────────────────────────
    // Entered via the "Map" header button.  Uses an orthographic top-down
    // camera (SceneView.useOrthoCamera) for distortion-free 2D placement.
    //
    // Three-state drawing model (ADR-031 §1):
    //   idle     → no gesture in progress; tool may or may not be selected
    //   drawing  → gesture in progress (rubber-band follows cursor)
    //   pending  → geometry fully defined; static dashed preview; awaiting name + confirm
    this._mapMode = {
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
       * Populated by _mapPickPoint on PC; consumed by _updateMapPreview.
       * @type {THREE.Vector3|null}
       */
      snapCandidate: null,
    }

    // ── Sketch drawing state (Edit Mode · 2D) ──────────────────────────────
    this._sketch = {
      drawing: false,
      p1: null,  // THREE.Vector3 ground-plane point
      p2: null,  // THREE.Vector3 ground-plane point
    }
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

    // ── Sketch-to-cuboid extrude state ─────────────────────────────────────
    this._extrudePhase = {
      dragPlane:  new THREE.Plane(),
      startPoint: new THREE.Vector3(),
      height:     0,
      inputStr:   '',
      hasInput:   false,
    }

    // ── Object mode state ──────────────────────────────────────────────────
    this._objSelected           = false
    this._objDragging           = false
    this._objCtrlDrag           = false
    this._objDragPlane          = new THREE.Plane()
    this._objDragStart          = new THREE.Vector3()
    this._objDragStartCorners   = []
    /** @type {Map<string, import('three').Vector3[]>} corners snapshot for each selected object at drag start */
    this._objDragAllStartCorners = new Map()
    this._objRotateStartX       = 0
    this._objRotateCentroid     = new THREE.Vector3()
    this._objRotateStartCorners = []

    // ── Rectangle selection state ──────────────────────────────────────────
    /** @type {Set<string>} IDs of all currently selected objects (multi-select) */
    this._selectedIds = new Set()
    this._rectSel = {
      active:    false,
      startPx:   { x: 0, y: 0 },
      currentPx: { x: 0, y: 0 },
    }
    this._rectSelEl = this._createRectSelEl()

    // ── Edit mode hover state ───────────────────────────────────────────────
    /** @type {import('../graph/Face.js').Face|null} */
    this._hoveredFace      = null

    // ── Edit mode sub-element selection state (Phase 6) ────────────────────
    /** @type {'vertex'|'edge'|'face'} */
    this._editSelectMode = 'face'
    /** @type {import('../graph/Vertex.js').Vertex|null} */
    this._hoveredVertex  = null
    /** @type {import('../graph/Edge.js').Edge|null} */
    this._hoveredEdge    = null

    // ── Face extrude state (Edit Mode · 3D, E key) ─────────────────────────
    this._faceExtrude = {
      active:        false,
      /** @type {import('../graph/Face.js').Face|null} */
      face:          null,
      savedCorners:  [],
      normal:        new THREE.Vector3(),
      dist:          0,
      dragPlane:     new THREE.Plane(),
      startPoint:    new THREE.Vector3(),
      inputStr:      '',
      hasInput:      false,
      snapping:      false,
      snappedTarget: null,
      snapTargets:   [],
    }

    // ── Blender-style grab state ───────────────────────────────────────────
    this._grab = {
      active:          false,
      axis:            null,
      startMouse:      new THREE.Vector2(),
      startCorners:    [],
      /** @type {Map<string, import('three').Vector3[]>} corners snapshot for all selected objects */
      allStartCorners: new Map(),
      /** @type {Map<string, import('three').Vector3[]>} corners at the start of the current drag segment (touch re-grab) */
      segmentStartCorners: new Map(),
      centroid:        new THREE.Vector3(),
      pivot:           new THREE.Vector3(),
      pivotLabel:      'Centroid',
      dragPlane:       new THREE.Plane(),
      startPoint:      new THREE.Vector3(),
      inputStr:        '',
      hasInput:        false,
      pivotSelectMode: false,
      hoveredPivotIdx: -1,
      candidates:      [],
      /** Current candidate filter in pivot select mode: 'all'|'vertex'|'edge'|'face' */
      pivotMode:       'all',
      snapping:        false,
      /** Set to true after G->V pivot confirm; enables auto-snap without Ctrl */
      autoSnap:        false,
      /** The snap target currently locked to, or null */
      snappedTarget:   null,
      /** Snap target filter: 'all'|'vertex'|'edge'|'face' */
      snapMode:        'all',
      /** All snap candidates from last _trySnapToGeometry call (for display) */
      snapTargets:     [],
      /** Grid snap unit size (Ctrl during grab). Cycled with Ctrl+Wheel. */
      gridSize:        1,
      /** When true, grabbed object snaps Z so its bottom rests on the top surface below. */
      stackMode:       false,
      /** True when stacking is actively snapping Z this frame. */
      stacking:        false,
    }

    /** Unsubscribe function for the active import.progress WS listener, or null */
    this._importProgressUnsub = null

    /**
     * Set of CoordinateFrame IDs currently visible because of frame-chain selection.
     * Cleared by _hideFrameChain(). Used to restore correct visibility on deselect.
     * @type {Set<string>}
     */
    this._activeFrameChain = new Set()

    // ── TC mode toggle for mobile CoordinateFrame (translate / rotate) ────
    /** @type {'translate'|'rotate'} Current TC gizmo mode when a CoordinateFrame is active. */
    this._tcMode           = 'translate'
    /** Proxy quaternion snapshot at TC drag start (rotate mode only). @type {THREE.Quaternion|null} */
    this._tcStartProxyQuat = null
    /** Frame rotation snapshot at TC drag start (rotate mode only). @type {THREE.Quaternion|null} */
    this._tcStartFrameRot  = null

    // ── CoordinateFrame rotate state (R key, ADR-019 Phase B) ─────────────
    // Symmetric to _grab but applies a quaternion rotation to CoordinateFrame.rotation.
    this._rotate = {
      active:     false,
      /** World-space axis to rotate around: null = view-space Z, 'x'|'y'|'z' = world axes. */
      axis:       null,
      /** Screen-angle (radians) from frame projected position to mouse at start. */
      startAngle: 0,
      /** Saved rotation quaternion at the moment rotation begins (for cancel). */
      startRot:   new THREE.Quaternion(),
      /** Numeric degree string typed by the user; empty when mouse-driven. */
      inputStr:   '',
      /** True when the user has typed at least one digit. */
      hasInput:   false,
      /** Degree increment for Ctrl snap. Cycled with Ctrl+Wheel. */
      stepSize:   1,
    }

    this._ctrlHeld  = false

    this._raycaster = new THREE.Raycaster()
    this._mouse     = new THREE.Vector2()

    // ── Pointer tracking (Pointer Events API — mouse + touch + stylus) ─────
    /** @type {number|null} pointerId of the active edit drag; null when idle */
    this._activeDragPointerId = null

    // ── Long-press detection for touch Grab (object mode) ─────────────────
    // On touch, single-finger drag orbits the camera. A long press (≥ 400 ms
    // without significant movement) on a selected object triggers Grab mode.
    this._longPress = {
      /** @type {ReturnType<typeof setTimeout>|null} */
      timer:     null,
      pointerId: null,
      startX:    0,
      startY:    0,
    }

    // ── Mobile TransformControls (touch devices only, translate mode) ──────
    /** @type {import('three/addons/controls/TransformControls.js').TransformControls|null} */
    this._tc              = null
    /** @type {THREE.Object3D|null} Proxy Object3D that TC drives; positioned at object centroid */
    this._tcProxy         = null
    /** True while the TC gizmo is being dragged (prevents conflicting input handling) */
    this._tcDragging      = false
    /** Proxy world position snapshotted at drag start (for computing absolute delta) */
    this._tcStartProxyPos = new THREE.Vector3()
    /** corners/localOffset snapshot for undo — populated at drag start */
    this._tcStartCorners  = new Map()

    // ── UI wiring ──────────────────────────────────────────────────────────
    uiView.setCanvas(sceneView.renderer.domElement)
    uiView.onModeChange(mode => this.setMode(mode))

    if (outlinerView) {
      outlinerView.onSelect(  id       => this._onOutlinerSelect(id))
      outlinerView.onDelete(  id       => this._deleteObject(id))
      outlinerView.onAdd(  ()          => this._addObject())
      outlinerView.onVisible( (id, v)  => this._setObjectVisible(id, v))
      outlinerView.onRename(  (id, nm) => this._renameObject(id, nm))
      // Drag-and-drop re-parent (ADR-028)
      outlinerView.onReparent((frameId, targetId) => {
        const frame = this._scene.getObject(frameId)
        if (!frame || frame.name === 'Origin') {
          this._uiView.showToast('Origin frames cannot be re-parented', { type: 'warn' })
          return
        }
        const cmd = createReparentFrameCommand(frameId, targetId, this._service)
        if (!this._service.reparentFrame(frameId, targetId)) {
          this._uiView.showToast('Cannot re-parent: invalid target or cycle detected', { type: 'warn' })
          return
        }
        this._commandStack.push(cmd)
      })
    }

    // N panel parent dropdown (ADR-028)
    uiView.onFrameParentChange((newParentId) => {
      const obj = this._activeObj
      if (!(obj instanceof CoordinateFrame) || obj.name === 'Origin') return
      const cmd = createReparentFrameCommand(obj.id, newParentId, this._service)
      if (!this._service.reparentFrame(obj.id, newParentId)) {
        this._uiView.showToast('Cannot re-parent: invalid target or cycle detected', { type: 'warn' })
        return
      }
      this._commandStack.push(cmd)
    })

    uiView.onNameChange(name => {
      if (this._scene.activeId) this._renameObject(this._scene.activeId, name)
    })
    uiView.onDescriptionChange(desc => {
      const obj = this._activeObj
      if (obj) obj.description = desc
    })
    uiView.onIfcClassChange(ifcClass => {
      const obj = this._activeObj
      if (!obj) return
      const oldClass = obj.ifcClass ?? null
      this._service.setIfcClass(obj.id, ifcClass)          // apply first (post-hoc push pattern)
      const cmd = createSetIfcClassCommand(obj.id, oldClass, ifcClass ?? null, this._service)
      this._commandStack.push(cmd)
      this._updateNPanel()
    })
    uiView.onPlaceTypeChange(placeType => {
      const obj = this._activeObj
      if (!obj) return
      const oldType = obj.placeType ?? null
      this._service.setPlaceType(obj.id, placeType)        // apply first (post-hoc push pattern)
      const cmd = createSetPlaceTypeCommand(obj.id, oldType, placeType ?? null, this._service)
      this._commandStack.push(cmd)
      this._updateNPanel()
    })
    uiView.onFramePositionChange((axis, val) => {
      const frame = this._activeObj
      if (!(frame instanceof CoordinateFrame) || frame.name === 'Origin') return
      const parent = this._scene.getObject(frame.parentId)
      if (!parent) return
      const parentRot = (parent instanceof CoordinateFrame) ? parent.rotation : new THREE.Quaternion()
      // For a geometry parent: centroid from world-space corners.
      // For a CoordinateFrame parent: world position from cache (localOffset is NOT world pos).
      // (PHILOSOPHY #21 Phase 3 — CoordinateFrame.corners does not exist)
      const parentCentroid = (parent instanceof CoordinateFrame)
        ? (this._service.worldPoseOf(parent.id)?.position?.clone() ?? null)
        : (parent.corners.length > 0 ? getCentroid(parent.corners) : null)
      if (!parentCentroid) return
      // val is in parent's local space; convert to world-space translation
      const localPos = frame.translation.clone().applyQuaternion(parentRot.clone().conjugate())
      localPos[axis] = val
      frame.translation.copy(localPos).applyQuaternion(parentRot)
      const newWorldPos = parentCentroid.clone().add(frame.translation)
      const cacheEntry = this._service.worldPoseOf(frame.id)
      if (cacheEntry) cacheEntry.position.copy(newWorldPos)
      frame.meshView.updatePosition(newWorldPos)
    })
    uiView.onFrameRotationChange((axis, val) => {
      const frame = this._activeObj
      if (!(frame instanceof CoordinateFrame) || frame.name === 'Origin') return
      const parent = this._scene.getObject(frame.parentId)
      const parentRot = (parent instanceof CoordinateFrame) ? parent.rotation : new THREE.Quaternion()
      // val is local Euler degrees; rebuild local quaternion then convert to world
      const localRot = parentRot.clone().conjugate().multiply(frame.rotation)
      const localEuler = new THREE.Euler().setFromQuaternion(localRot, 'ZYX')
      localEuler[axis] = THREE.MathUtils.degToRad(val)
      localRot.setFromEuler(localEuler)
      frame.rotation.copy(parentRot.clone().multiply(localRot))
      frame.meshView.updateRotation(frame.rotation)
    })
    uiView.onLocationChange((axis, val) => {
      const obj = this._activeObj
      if (!obj || typeof obj.move !== 'function') return
      const corners = this._corners
      if (!corners.length) return
      const currentCentroid = getCentroid(corners)
      const delta = new THREE.Vector3()
      delta[axis] = val - currentCentroid[axis]
      const startCorners = corners.map(c => c.clone())
      obj.move(startCorners, delta)
      obj.meshView.updateGeometry(corners)
      if (this._objSelected) obj.meshView.updateBoxHelper()
    })

    // ── Mobile drawer coordination ─────────────────────────────────────────
    uiView.onOutlinerToggle(() => {
      if (!outlinerView) return
      if (outlinerView.isDrawerOpen) {
        outlinerView.closeDrawer()
        uiView.hideBackdrop()
      } else {
        if (uiView.nPanelVisible) this._toggleNPanel()
        outlinerView.openDrawer()
        uiView.showBackdrop(() => outlinerView.closeDrawer())
      }
    })

    uiView.onNPanelToggle(() => {
      if (outlinerView?.isDrawerOpen) {
        outlinerView.closeDrawer()
        uiView.hideBackdrop()
      }
      this._toggleNPanel()
      if (uiView.nPanelVisible) {
        uiView.showBackdrop(() => this._toggleNPanel())
      } else {
        uiView.hideBackdrop()
      }
    })

    uiView.onUndoClick(() => {
      if (this._grab.active || this._rotate.active || this._faceExtrude.active) return
      const cmd = this._commandStack.undo()
      if (cmd) this._uiView.showToast(`Undo: ${cmd.label}`)
      this._refreshUndoRedoState()
      this._syncMobileTransformProxy()
    })
    uiView.onRedoClick(() => {
      if (this._grab.active || this._rotate.active || this._faceExtrude.active) return
      const cmd = this._commandStack.redo()
      if (cmd) this._uiView.showToast(`Redo: ${cmd.label}`)
      this._refreshUndoRedoState()
      this._syncMobileTransformProxy()
    })

    // ── Map Mode entry ────────────────────────────────────────────────────
    uiView.onMapModeClick(() => this._enterMapMode())

    this._bindEvents()

    // Initialise translate gizmo for touch devices (desktop keeps Grab)
    if (window.matchMedia('(pointer: coarse)').matches) {
      this._initMobileTransformControls()
    }

    // Create the initial object
    this._addObject()
    this.setMode('object')
    // The initial solid creation must not be undoable — the user has done nothing yet.
    this._commandStack.clear()
  }

  // ─── Domain state shorthand ───────────────────────────────────────────────

  /** Shorthand to access SceneModel through the ApplicationService. */
  get _scene() { return this._service.scene }

  // ─── Active-object accessors ──────────────────────────────────────────────

  /** Returns the active object entry, or null if none */
  get _activeObj() {
    return this._scene.activeObject
  }

  /** Returns the grab-handle array for the active object.
   *  Geometry → world-space corners; CoordinateFrame → localOffset. */
  get _corners() {
    const obj = this._scene.activeObject
    if (!obj) return []
    return _grabHandlesOf(obj)
  }

  /** Returns the active object's MeshView */
  get _meshView() {
    return this._scene.activeObject?.meshView ?? null
  }

  // ─── Convenience getters ──────────────────────────────────────────────────
  get _camera()   { return this._sceneView.camera }
  get _controls() { return this._sceneView.controls }

  // ─── Object management ────────────────────────────────────────────────────

  /**
   * Adds a new object of the given type.
   * @param {'box'|'sketch'|'measure'|'frame'} [type='box']
   */
  _addObject(type = 'box') {
    if (type === 'sketch')  { this._addProfileObject();    return }
    if (type === 'measure') { this._startMeasurePlacement(); return }
    if (type === 'frame')   { this._addCoordinateFrame();  return }

    // Exit Edit Mode cleanly before adding, so the previous object's visual state is cleared
    if (this._scene.selectionMode === 'edit') this.setMode('object')

    const obj = this._service.createSolid()

    // ── Record undo snapshot (ADR-022 Phase 3) ────────────────────────────
    const childrenRefs = [...this._collectAllDescendantFrames(obj.id)]
      .map(fid => this._scene.getObject(fid)).filter(Boolean)
    const cmd = createAddSolidCommand(
      obj, childrenRefs, this._service,
      ()   => {
        // onAfterUndo: switch active to any remaining geometry object.
        // When none remains, clear selection so the toolbar reverts to the
        // empty-scene state (no stale _objSelected flag).
        const nextId = [...this._scene.objects.entries()]
          .find(([k, o]) => k !== obj.id && !(o instanceof CoordinateFrame))?.[0] ?? null
        if (nextId) {
          this._switchActiveObject(nextId, true)
        } else {
          this._objSelected = false
          this._selectedIds.clear()
          this._refreshObjectModeStatus()
          this._updateMobileToolbar()
        }
      },
      (id) => this._switchActiveObject(id, true),
    )
    this._commandStack.push(cmd)

    this._switchActiveObject(obj.id, true)
  }

  /**
   * Adds a CoordinateFrame as a child of the currently active geometry object.
   * No-ops with a toast if no suitable parent is selected.
   */
  _addCoordinateFrame() {
    const parentId = this._scene.activeId
    const parent   = parentId ? this._scene.getObject(parentId) : null
    // MeasureLine and ImportedMesh are not valid parents (ADR-019).
    // CoordinateFrame parents are now allowed (nested frame hierarchy).
    if (!parent || parent instanceof MeasureLine || parent instanceof ImportedMesh) {
      this._uiView.showToast('Select a geometry object or frame to add a coordinate frame', { type: 'warn' })
      return
    }
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    const frame = this._service.createCoordinateFrame(parentId)
    if (frame) this._switchActiveObject(frame.id, true)
  }

  // ── STEP import ─────────────────────────────────────────────────────────────

  _triggerStepImport() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.stp,.step,.STP,.STEP'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return

      const scale = await this._showUnitDialog()
      if (scale === null) return  // user cancelled

      if (!this._service._bff) {
        this._uiView.showToast('サーバーに接続されていません', { type: 'warn' })
        return
      }

      // Always upload via REST (multipart/form-data) to avoid WS payload size limits.
      // Pass sessionId so the server can stream import.progress events back over WS.
      const ws        = this._service.wsChannel
      const sessionId = ws?.sessionId ?? null

      if (ws) {
        this._importProgressUnsub = ws.on('import.progress', ({ percent, status }) => {
          this._uiView.showImportProgress(percent, status)
        })
      }

      this._uiView.showImportProgress(0, 'Uploading…')
      try {
        await this._service._bff.importStep(file, { scale, sessionId })
        // Progress overlay is hidden by geometryApplied / geometryError handlers.
        // If WS is not connected (REST-only mode), hide it now.
        if (!ws) this._uiView.hideImportProgress()
      } catch (err) {
        this._importProgressUnsub?.(); this._importProgressUnsub = null
        this._uiView.hideImportProgress()
        this._uiView.showToast('Import failed', { type: 'error' })
        console.error('[AppController] STEP import error:', err)
      }
    })
    input.click()
  }

  // ── Save / Load scene ──────────────────────────────────────────────────────

  async _saveScene() {
    const name = await this._showInputDialog('Save Scene', 'Scene name:', 'Untitled')
    if (name === null) return
    const id = await this._service.saveScene(name)
    if (id) {
      this._uiView.showToast(`Saved: "${name}"`)
    } else {
      this._uiView.showToast('Save failed', { type: 'error' })
    }
  }

  async _loadScene() {
    const scenes = await this._service.listScenes()
    if (!scenes || scenes.length === 0) {
      this._uiView.showToast('No saved scenes', { type: 'warn' })
      return
    }
    const id = await this._showSceneListDialog(scenes)
    if (id === null) return
    const ok = await this._service.loadScene(id, {
      camera:    this._camera,
      renderer:  this._sceneView.renderer,
      container: document.body,
    })
    if (ok) {
      this._commandStack.clear()
      this._uiView.showToast('Scene loaded')
      this._switchActiveObject(null)
    } else {
      this._uiView.showToast('Load failed', { type: 'error' })
    }
  }

  /** Shows a text-input dialog. Resolves with the trimmed string, or null if cancelled. */
  _showInputDialog(title, label, placeholder = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.6)',
        'display:flex;align-items:center;justify-content:center;z-index:9999',
      ].join(';')

      const dlg = document.createElement('div')
      dlg.style.cssText = [
        'background:#1e2a3a;border:1px solid #3a4a5a;border-radius:6px',
        'padding:20px 24px;min-width:300px;color:#ecf0f1;font-family:monospace',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      ].join(';')

      const titleEl = document.createElement('div')
      titleEl.textContent = title
      titleEl.style.cssText = 'font-size:13px;font-weight:bold;margin-bottom:14px;color:#aad4f5'
      dlg.appendChild(titleEl)

      const lbl = document.createElement('div')
      lbl.textContent = label
      lbl.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:6px'
      dlg.appendChild(lbl)

      const input = document.createElement('input')
      input.type = 'text'
      input.value = placeholder
      input.setAttribute('aria-label', label)
      input.style.cssText = [
        'width:100%;box-sizing:border-box;background:#0d1a26;color:#ecf0f1',
        'border:1px solid #3a4a5a;border-radius:4px;padding:6px 8px',
        'font-family:monospace;font-size:12px;outline:none',
      ].join(';')
      dlg.appendChild(input)

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px'

      const btnCancel = document.createElement('button')
      btnCancel.textContent = 'Cancel'
      btnCancel.style.cssText = [
        'padding:6px 14px;background:#2c3e50;color:#ecf0f1;border:1px solid #3a4a5a',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px',
      ].join(';')

      const btnSave = document.createElement('button')
      btnSave.textContent = 'Save'
      btnSave.style.cssText = [
        'padding:6px 14px;background:#2980b9;color:#fff;border:none',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold',
      ].join(';')

      btnRow.appendChild(btnCancel)
      btnRow.appendChild(btnSave)
      dlg.appendChild(btnRow)
      overlay.appendChild(dlg)
      document.body.appendChild(overlay)

      const close = (result) => { document.body.removeChild(overlay); resolve(result) }
      btnCancel.addEventListener('click', () => close(null))
      btnSave.addEventListener('click', () => close(input.value.trim() || placeholder))
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close(input.value.trim() || placeholder)
        if (e.key === 'Escape') close(null)
      })
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
      input.focus()
      input.select()
    })
  }

  /**
   * Shows a list-selection dialog for saved scenes.
   * Resolves with the selected scene id, or null if cancelled.
   * @param {{ id: string, name: string, updated_at: string }[]} scenes
   */
  _showSceneListDialog(scenes) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.6)',
        'display:flex;align-items:center;justify-content:center;z-index:9999',
      ].join(';')

      const dlg = document.createElement('div')
      dlg.style.cssText = [
        'background:#1e2a3a;border:1px solid #3a4a5a;border-radius:6px',
        'padding:20px 24px;min-width:320px;max-width:480px;color:#ecf0f1;font-family:monospace',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      ].join(';')

      const titleEl = document.createElement('div')
      titleEl.textContent = 'Load Scene'
      titleEl.style.cssText = 'font-size:13px;font-weight:bold;margin-bottom:14px;color:#aad4f5'
      dlg.appendChild(titleEl)

      let selectedId = null

      const list = document.createElement('div')
      list.setAttribute('role', 'listbox')
      list.setAttribute('aria-label', 'Saved scenes')
      list.style.cssText = [
        'max-height:240px;overflow-y:auto;border:1px solid #3a4a5a;border-radius:4px',
      ].join(';')

      const selectRow = (row, id) => {
        list.querySelectorAll('[role="option"]').forEach(r => {
          r.style.background = ''
          r.setAttribute('aria-selected', 'false')
        })
        row.style.background = '#2980b9'
        row.setAttribute('aria-selected', 'true')
        selectedId = id
      }

      scenes.forEach((scene) => {
        const row = document.createElement('div')
        row.setAttribute('role', 'option')
        row.setAttribute('tabindex', '0')
        row.setAttribute('aria-selected', 'false')
        row.style.cssText = [
          'padding:8px 10px;cursor:pointer;font-size:12px',
          'border-bottom:1px solid #2a3a4a;display:flex;justify-content:space-between;align-items:center',
        ].join(';')
        row.dataset.id = scene.id

        const nameEl = document.createElement('span')
        nameEl.textContent = scene.name
        nameEl.style.cssText = 'color:#ecf0f1;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'

        const dateEl = document.createElement('span')
        const d = new Date(scene.updated_at)
        dateEl.textContent = isNaN(d) ? '' : d.toLocaleDateString()
        dateEl.style.cssText = 'color:#7f8c8d;font-size:10px;margin-left:8px;flex-shrink:0'

        row.appendChild(nameEl)
        row.appendChild(dateEl)

        row.addEventListener('click', () => selectRow(row, scene.id))
        row.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectRow(row, scene.id) }
        })

        list.appendChild(row)
      })

      dlg.appendChild(list)

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px'

      const btnCancel = document.createElement('button')
      btnCancel.textContent = 'Cancel'
      btnCancel.style.cssText = [
        'padding:6px 14px;background:#2c3e50;color:#ecf0f1;border:1px solid #3a4a5a',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px',
      ].join(';')

      const btnLoad = document.createElement('button')
      btnLoad.textContent = 'Load'
      btnLoad.style.cssText = [
        'padding:6px 14px;background:#2980b9;color:#fff;border:none',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold',
      ].join(';')

      btnRow.appendChild(btnCancel)
      btnRow.appendChild(btnLoad)
      dlg.appendChild(btnRow)
      overlay.appendChild(dlg)
      document.body.appendChild(overlay)

      const close = (result) => { document.body.removeChild(overlay); resolve(result) }
      btnCancel.addEventListener('click', () => close(null))
      btnLoad.addEventListener('click', () => close(selectedId))
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
    })
  }

  // ── Unit selection dialog ──────────────────────────────────────────────────

  /** Shows a modal dialog for unit scale selection. Resolves with scale factor or null if cancelled. */
  _showUnitDialog() {
    return new Promise((resolve) => {
      const UNITS = [
        { label: 'No conversion  (1 : 1)',    value: 1 },
        { label: 'mm  →  m       (÷ 1000)',   value: 0.001 },
        { label: 'm   →  mm      (× 1000)',   value: 1000 },
        { label: 'cm  →  m       (÷ 100)',    value: 0.01 },
        { label: 'inch →  m      (× 0.0254)', value: 0.0254 },
        { label: 'inch →  mm     (× 25.4)',   value: 25.4 },
      ]

      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.6)',
        'display:flex;align-items:center;justify-content:center;z-index:9999',
      ].join(';')

      const dlg = document.createElement('div')
      dlg.style.cssText = [
        'background:#1e2a3a;border:1px solid #3a4a5a;border-radius:6px',
        'padding:20px 24px;min-width:320px;color:#ecf0f1;font-family:monospace',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      ].join(';')

      const title = document.createElement('div')
      title.textContent = 'Import STEP — Unit Conversion'
      title.style.cssText = 'font-size:13px;font-weight:bold;margin-bottom:14px;color:#aad4f5'
      dlg.appendChild(title)

      const lbl = document.createElement('div')
      lbl.textContent = 'Scale'
      lbl.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:6px'
      dlg.appendChild(lbl)

      const sel = document.createElement('select')
      sel.style.cssText = [
        'width:100%;background:#0d1a26;color:#ecf0f1;border:1px solid #3a4a5a',
        'border-radius:4px;padding:6px 8px;font-family:monospace;font-size:12px',
        'cursor:pointer;outline:none',
      ].join(';')
      UNITS.forEach((u, i) => {
        const opt = document.createElement('option')
        opt.value = i
        opt.textContent = u.label
        sel.appendChild(opt)
      })
      dlg.appendChild(sel)

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px'

      const btnCancel = document.createElement('button')
      btnCancel.textContent = 'Cancel'
      btnCancel.style.cssText = [
        'padding:6px 14px;background:#2c3e50;color:#ecf0f1;border:1px solid #3a4a5a',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px',
      ].join(';')

      const btnImport = document.createElement('button')
      btnImport.textContent = 'Import'
      btnImport.style.cssText = [
        'padding:6px 14px;background:#e67e22;color:#fff;border:none',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold',
      ].join(';')

      btnRow.appendChild(btnCancel)
      btnRow.appendChild(btnImport)
      dlg.appendChild(btnRow)
      overlay.appendChild(dlg)
      document.body.appendChild(overlay)

      const close = (result) => { document.body.removeChild(overlay); resolve(result) }
      btnCancel.addEventListener('click', () => close(null))
      btnImport.addEventListener('click', () => close(UNITS[sel.value].value))
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
    })
  }

  // ────────────────────────────────────────────────────────────────────────────

  _addProfileObject() {
    // Exit current mode cleanly before switching active object
    if (this._scene.selectionMode === 'edit') this.setMode('object')

    const obj = this._service.createProfile()
    this._switchActiveObject(obj.id, true)
    this.setMode('edit')  // enters Edit Mode · 2D
  }

  /** Enters measure placement mode: click p1, then p2 to create a MeasureLine. */
  _startMeasurePlacement() {
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    this._measure.active       = true
    this._measure.p1           = null
    this._measure.p2           = null
    this._measure.p1Anchor     = null
    this._measure.snapTargets  = []
    this._measure.snapping     = false
    this._measure.snappedTarget = null
    // Snap display requires a MeshView with THREE.Points infrastructure.
    // MeasureLineView and CoordinateFrameView have no snap display infrastructure.
    // Fall back to any real MeshView-backed object for snap candidate rendering.
    const activeObj = this._scene.activeObject
    const _isSnapCapable = o => !(o instanceof MeasureLine) && !(o instanceof CoordinateFrame)
    this._measure.snapMeshView = (activeObj && _isSnapCapable(activeObj))
      ? activeObj.meshView
      : ([...this._scene.objects.values()].find(_isSnapCapable)?.meshView ?? null)
    // On touch devices, disable orbit so single-finger touch places measure
    // points instead of orbiting the camera.  Use (pointer: coarse) rather
    // than innerWidth so that tablets and landscape phones are also covered.
    if (window.matchMedia('(pointer: coarse)').matches) this._controls.enabled = false
    this._uiView.setCursor('crosshair')
    this._updateMeasureStatus()
    this._updateMobileToolbar()
  }

  _cancelMeasure() {
    if (!this._measure.active) return
    this._measure.active       = false
    this._measure.p1           = null
    this._measure.p2           = null
    this._measure.p1Anchor     = null
    this._measure.snapping     = false
    this._measure.snappedTarget = null
    this._measure.snapTargets  = []
    this._measure.pressing     = false
    if (this._measure.previewLine) {
      this._sceneView.scene.remove(this._measure.previewLine)
      this._measure.previewLine.geometry.dispose()
      this._measure.previewLine.material.dispose()
      this._measure.previewLine = null
    }
    this._measure.snapMeshView?.clearSnapDisplay()
    this._measure.snapMeshView = null
    if (window.matchMedia('(pointer: coarse)').matches) this._controls.enabled = true
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
    this._updateMobileToolbar()
  }

  /**
   * Confirms the current snapped cursor position as a measure point.
   * Phase 1: sets p1. Phase 2: creates the MeasureLine entity.
   * Called from _onPointerUp so mobile users can hold-to-snap before releasing.
   */
  _confirmMeasurePoint() {
    const pt = this._measurePickPoint()
    if (!pt) return
    if (!this._measure.p1) {
      // Phase 1 → Phase 2: record start point and its anchor (ADR-028)
      this._measure.p1 = pt.clone()
      const t = this._measure.snappedTarget
      this._measure.p1Anchor = (t?.objectId && t?.elementId)
        ? { objectId: t.objectId, type: t.type, elementId: t.elementId }
        : null
      this._updateMeasureStatus()
    } else {
      // Phase 2: record end point → create entity
      const p2 = pt.clone()
      // Capture anchor refs before clearing state (ADR-028)
      const t2       = this._measure.snappedTarget
      const p2Anchor = (t2?.objectId && t2?.elementId)
        ? { objectId: t2.objectId, type: t2.type, elementId: t2.elementId }
        : null
      const p1Anchor = this._measure.p1Anchor
      if (this._measure.previewLine) {
        this._sceneView.scene.remove(this._measure.previewLine)
        this._measure.previewLine.geometry.dispose()
        this._measure.previewLine.material.dispose()
        this._measure.previewLine = null
      }
      this._measure.snapMeshView?.clearSnapDisplay()
      this._measure.snapMeshView  = null
      this._measure.active        = false
      const p1                    = this._measure.p1
      this._measure.p1            = null
      this._measure.p2            = null
      this._measure.p1Anchor      = null
      this._measure.snapTargets   = []
      this._measure.snapping      = false
      this._measure.snappedTarget = null
      const obj = this._service.createMeasureLine(
        p1, p2,
        this._camera,
        this._sceneView.renderer,
        document.body,
        { p1: p1Anchor, p2: p2Anchor },
      )
      this._switchActiveObject(obj.id, true)
      if (window.matchMedia('(pointer: coarse)').matches) this._controls.enabled = true
      this._uiView.setCursor('default')
      this._refreshObjectModeStatus()
      this._updateMobileToolbar()
    }
  }

  _updateMeasureStatus() {
    if (!this._measure.active) return
    if (!this._measure.p1) {
      this._uiView.setStatusRich([
        { text: 'Measure', bold: true, color: '#f9a825' },
        { text: 'Click to set start point', color: '#888' },
        { text: 'ESC cancel', color: '#444' },
      ])
    } else {
      const parts = [
        { text: 'Measure', bold: true, color: '#f9a825' },
        { text: 'Click to set end point', color: '#888' },
      ]
      if (this._measure.p2) {
        const d = this._measure.p1.distanceTo(this._measure.p2)
        const f = d < 1 ? `${(d * 100).toFixed(1)} cm` : `${d.toFixed(3)} m`
        parts.push({ text: f, bold: true, color: '#f9a825' })
      }
      if (this._measure.snapping && this._measure.snappedTarget) {
        parts.push({ text: `Snap: ${this._measure.snappedTarget.label}`, color: '#ff9800' })
      }
      parts.push({ text: 'ESC cancel', color: '#444' })
      this._uiView.setStatusRich(parts)
    }
  }

  // ── 2D Map Mode ──────────────────────────────────────────────────────────

  /** Returns true when running on a coarse-pointer (touch) device. */
  _isMapMobile() {
    return window.matchMedia('(pointer: coarse)').matches
  }

  /** Enters 2D Map Mode: switches to orthographic top-down camera, shows map toolbar. */
  _enterMapMode() {
    if (this._mapMode.active) return
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    this._mapMode.active        = true
    this._mapMode.tool          = null
    this._mapMode.drawState     = 'idle'
    this._mapMode.points        = []
    this._mapMode.pendingPoints = null
    this._mapMode.pendingName   = null
    this._mapMode.cursor        = null
    this._mapMode.mobileDragStart = null
    this._mapMode.isPanning     = false
    // TC was created with the perspective camera; the ortho camera used in Map
    // Mode would cause wrong gizmo scale and broken raycast — hide it.
    this._detachMobileTransform()
    this._sceneView.useOrthoCamera(true, this._mapMode.frustumSize)
    this._uiView.setCursor('default')
    this._uiView.setStatus('Map Mode — select a type on the left to start drawing')
    this._refreshMapToolbar()
    this._updateMobileToolbar()
  }

  /** Exits 2D Map Mode: restores perspective camera, removes map toolbar. */
  _exitMapMode() {
    this._mapCancelDrawing()
    this._mapMode.active      = false
    this._mapMode.isPanning   = false
    this._sceneView.useOrthoCamera(false)
    this._uiView.hideMapToolbar()
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
    // Restore TC gizmo now that the perspective camera is active again.
    if (this._activeObj && this._objSelected) this._attachMobileTransform(this._activeObj)
    this._updateMobileToolbar()
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
  _setMapTool(type) {
    this._mapCancelDrawing()   // clear any in-progress drawing
    this._mapMode.tool          = type
    this._mapMode.drawState     = 'drawing'
    this._mapMode.points        = []
    this._mapMode.pendingPoints = null
    this._mapMode.pendingName   = null
    this._mapMode.cursor        = null
    this._uiView.setCursor('crosshair')
    this._refreshMapToolbar()
    this._updateMapStatus()
  }

  /** Cancels the current drawing without creating an entity. */
  _mapCancelDrawing() {
    this._clearMapPreview()
    this._mapMode.tool            = null
    this._mapMode.drawState       = 'idle'
    this._mapMode.points          = []
    this._mapMode.pendingPoints   = null
    this._mapMode.pendingName     = null
    this._mapMode.cursor          = null
    this._mapMode.mobileDragStart = null
    this._mapMode.snapCandidate   = null
    this._uiView.setCursor('default')
    this._refreshMapToolbar()
    if (this._mapMode.active) {
      this._uiView.setStatus('Map Mode — select a type on the left to start drawing')
    }
  }

  /**
   * Transitions from drawing → pending state.
   * Freezes the current geometry, generates a default name, switches the preview to
   * dashed style, and refreshes the toolbar to show the name input + Confirm button.
   * @param {THREE.Vector3[]} points  the completed geometry vertices
   */
  _enterMapPendingState(points) {
    if (!this._mapMode.tool) return
    const placeType = this._placeTypeForType(this._mapMode.tool)
    const n = ++this._mapMode.nameCounters[placeType]
    this._mapMode.drawState     = 'pending'
    this._mapMode.pendingPoints = points.map(p => p.clone())
    this._mapMode.pendingName   = `${placeType} ${n}`
    this._mapMode.cursor        = null
    this._mapMode.snapCandidate = null
    this._clearMapPreview()
    this._showPendingPreview()
    this._refreshMapToolbar()
    this._uiView.setStatusRich([
      { text: placeType, bold: true, color: '#80cbc4' },
      { text: '— enter a name and confirm', color: '#888' },
      { text: '  ESC = cancel', color: '#444' },
    ])
  }

  /**
   * Confirms the pending entity.
   * Must only be called while drawState === 'pending'.
   * Reads the entity name from the toolbar name input (falls back to pendingName).
   */
  _mapConfirmDrawing() {
    const { tool, pendingPoints, pendingName } = this._mapMode
    if (!tool || !pendingPoints) return

    const geometry  = this._geometryForType(tool)
    const placeType = this._placeTypeForType(tool)
    const renderer  = this._sceneView.renderer

    // Read the user-supplied name (or fall back to the auto-generated default)
    const name = this._uiView.getMapPendingName() ?? pendingName ?? placeType

    // Create entity — state reset always happens in finally, even if creation throws
    let created = false
    try {
      if (geometry === 'point' && pendingPoints.length >= 1) {
        const obj = this._service.createAnnotatedPoint(pendingPoints[0], name, {
          camera: this._camera, renderer, container: document.body,
        })
        this._service.setPlaceType(obj.id, placeType)
        created = true
      } else if (geometry === 'line' && pendingPoints.length >= 2) {
        const obj = this._service.createAnnotatedLine(pendingPoints, name, renderer)
        this._service.setPlaceType(obj.id, placeType)
        created = true
      } else if (geometry === 'region' && pendingPoints.length >= 3) {
        const obj = this._service.createAnnotatedRegion(pendingPoints, name, renderer)
        this._service.setPlaceType(obj.id, placeType)
        created = true
      }
    } catch (err) {
      console.error('[MapMode] entity creation failed:', err)
    } finally {
      // Always exit pending state — confirm button must disappear regardless of success
      this._clearMapPreview()
      this._mapMode.drawState     = 'drawing'  // ready for another gesture
      this._mapMode.points        = []
      this._mapMode.pendingPoints = null
      this._mapMode.pendingName   = null
      this._mapMode.cursor        = null
      this._refreshMapToolbar()
    }

    if (created) {
      this._uiView.setStatus(`Map Mode — ${placeType} placed. Draw another or select a different type.`)
    }
  }

  /** Removes preview line, cursor dot, and snap ring from the Three.js scene. */
  _clearMapPreview() {
    const scene = this._sceneView.scene
    if (this._mapMode.previewLine) {
      scene.remove(this._mapMode.previewLine)
      this._mapMode.previewLine.geometry.dispose()
      this._mapMode.previewLine.material.dispose()
      this._mapMode.previewLine = null
    }
    if (this._mapMode.cursorDot) {
      scene.remove(this._mapMode.cursorDot)
      this._mapMode.cursorDot.geometry.dispose()
      this._mapMode.cursorDot.material.dispose()
      this._mapMode.cursorDot = null
    }
    if (this._mapMode.snapRingMesh) {
      scene.remove(this._mapMode.snapRingMesh)
      this._mapMode.snapRingMesh.geometry.dispose()
      this._mapMode.snapRingMesh.material.dispose()
      this._mapMode.snapRingMesh = null
    }
    this._mapMode.snapCandidate = null
  }

  /**
   * Picks the ground-plane (Z=0) world position under the pointer in Map Mode,
   * using the orthographic camera for correct distortion-free picking.
   * Applies grid snapping (1-unit grid) then, on PC only, endpoint snapping.
   * Also stores the active snap candidate in this._mapMode.snapCandidate.
   * @param {PointerEvent|MouseEvent} e
   * @returns {THREE.Vector3}
   */
  _mapPickPoint(e) {
    const ndcX =  (e.clientX / innerWidth)  * 2 - 1
    const ndcY = -(e.clientY / innerHeight) * 2 + 1
    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._sceneView.activeCamera)
    const pt = new THREE.Vector3()
    this._raycaster.ray.intersectPlane(this._groundPlane, pt)
    pt.z = 0

    // Grid snap: round to nearest grid unit (matches GridHelper 20×20 / 20 divisions = 1 unit)
    const GRID = 1.0
    pt.x = Math.round(pt.x / GRID) * GRID
    pt.y = Math.round(pt.y / GRID) * GRID

    // Endpoint snap: PC only — not reliable on touch (ADR-031 §6)
    if (!this._isMapMobile()) {
      const { snapped, point } = this._mapSnapToEndpoint(pt, e.clientX, e.clientY)
      this._mapMode.snapCandidate = snapped
      return point
    }

    this._mapMode.snapCandidate = null
    return pt
  }

  /**
   * Snaps a grid-snapped world point to a nearby annotated entity vertex (PC only).
   * Uses the orthographic camera to measure screen-space distance.
   * Endpoint snap has higher priority than grid snap.
   * @param {THREE.Vector3} gridPt  grid-snapped world position
   * @param {number} screenX  pointer clientX
   * @param {number} screenY  pointer clientY
   * @param {number} [snapPx=20]  snap radius in CSS pixels (ADR-031 §6)
   * @returns {{ snapped: THREE.Vector3|null, point: THREE.Vector3 }}
   */
  _mapSnapToEndpoint(gridPt, screenX, screenY, snapPx = 20) {
    const cam = this._sceneView.activeCamera
    let bestDist = snapPx
    let bestPt   = null

    for (const obj of this._scene.objects.values()) {
      const verts = (obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint)
        ? obj.vertices.map(v => v.position)
        : null
      if (!verts) continue

      for (const vert of verts) {
        const sv = this._projectToScreen(vert, cam)
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
  _updateMapPreview() {
    const { tool, points, cursor, mobileDragStart, drawState } = this._mapMode
    if (!tool || drawState !== 'drawing') return
    if (!cursor) return

    const geometry = this._geometryForType(tool)
    const entry    = getPlaceTypeEntry(this._placeTypeForType(tool))
    const color    = entry ? parseInt(entry.color.slice(1), 16) : 0x80cbc4

    // Cursor dot — shown only in drawing state
    if (!this._mapMode.cursorDot) {
      const g = new THREE.SphereGeometry(0.08, 8, 8)
      const m = new THREE.MeshBasicMaterial({ color, depthTest: false })
      this._mapMode.cursorDot = new THREE.Mesh(g, m)
      this._mapMode.cursorDot.renderOrder = 3
      this._sceneView.scene.add(this._mapMode.cursorDot)
    }
    this._mapMode.cursorDot.position.copy(cursor)
    this._mapMode.cursorDot.material.color.setHex(color)

    // Update snap ring visibility (PC only)
    this._updateSnapRing(this._mapMode.snapCandidate, color)

    // Determine the preview point sequence to render
    let previewPts = null

    if (geometry === 'region' && mobileDragStart) {
      // Drag-to-rectangle: show live rectangle from anchor to cursor
      const p1 = mobileDragStart.pt
      const p2 = cursor
      previewPts = [
        new THREE.Vector3(p1.x, p1.y, 0),
        new THREE.Vector3(p2.x, p1.y, 0),
        new THREE.Vector3(p2.x, p2.y, 0),
        new THREE.Vector3(p1.x, p2.y, 0),
        new THREE.Vector3(p1.x, p1.y, 0),  // close ring
      ]
    } else if (geometry === 'line' && mobileDragStart) {
      // Mobile line drag: straight line from start to cursor
      previewPts = [mobileDragStart.pt, cursor]
    } else if (geometry !== 'point' && points.length > 0) {
      // PC multi-click preview: confirmed points + live cursor
      previewPts = [...points, cursor]
      if (geometry === 'region' && previewPts.length >= 3) previewPts.push(previewPts[0])
    }

    if (previewPts) {
      const flat = []
      for (const p of previewPts) flat.push(p.x, p.y, p.z)

      if (!this._mapMode.previewLine) {
        const geo = new THREE.BufferGeometry()
        // Solid line at 70% opacity for drawing state (ADR-031 §3)
        const mat = new THREE.LineBasicMaterial({
          color, depthTest: false, transparent: true, opacity: 0.70,
        })
        this._mapMode.previewLine = new THREE.Line(geo, mat)
        this._mapMode.previewLine.renderOrder = 2
        this._sceneView.scene.add(this._mapMode.previewLine)
      }
      this._mapMode.previewLine.geometry.setAttribute(
        'position', new THREE.Float32BufferAttribute(new Float32Array(flat), 3),
      )
      this._mapMode.previewLine.geometry.attributes.position.needsUpdate = true
      this._mapMode.previewLine.material.color.setHex(color)
    } else if (this._mapMode.previewLine) {
      this._sceneView.scene.remove(this._mapMode.previewLine)
      this._mapMode.previewLine.geometry.dispose()
      this._mapMode.previewLine.material.dispose()
      this._mapMode.previewLine = null
    }
  }

  /**
   * Creates or updates the static dashed preview for the pending state (ADR-031 §3).
   * Must be called after entering pending state with pendingPoints populated.
   */
  _showPendingPreview() {
    const { tool, pendingPoints } = this._mapMode
    if (!tool || !pendingPoints) return

    const geometry = this._geometryForType(tool)
    const entry    = getPlaceTypeEntry(this._placeTypeForType(tool))
    const color    = entry ? parseInt(entry.color.slice(1), 16) : 0x80cbc4

    // Remove cursor dot — pending state shows no live cursor
    if (this._mapMode.cursorDot) {
      this._sceneView.scene.remove(this._mapMode.cursorDot)
      this._mapMode.cursorDot.geometry.dispose()
      this._mapMode.cursorDot.material.dispose()
      this._mapMode.cursorDot = null
    }
    // Hide snap ring
    this._updateSnapRing(null, color)

    // Frozen point list (close ring for region)
    let previewPts = [...pendingPoints]
    if (geometry === 'region' && previewPts.length >= 3) previewPts.push(previewPts[0])

    if (previewPts.length < 2) {
      // Point type (Hub / Anchor): no line to draw, but show a static dot at the
      // placed position so the user can see where they placed it (ADR-031 §3).
      if (this._mapMode.previewLine) {
        this._sceneView.scene.remove(this._mapMode.previewLine)
        this._mapMode.previewLine.geometry.dispose()
        this._mapMode.previewLine.material.dispose()
        this._mapMode.previewLine = null
      }
      if (previewPts.length === 1) {
        const g = new THREE.SphereGeometry(0.15, 12, 12)
        const m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })
        const dot = new THREE.Mesh(g, m)
        dot.position.copy(previewPts[0])
        dot.renderOrder = 3
        this._sceneView.scene.add(dot)
        this._mapMode.previewLine = dot  // reuse slot; disposed the same way on exit/confirm
      }
      return
    }

    const flat = []
    for (const p of previewPts) flat.push(p.x, p.y, p.z)

    // Recreate as dashed line (LineDashedMaterial) at 90% opacity (ADR-031 §3)
    if (this._mapMode.previewLine) {
      this._sceneView.scene.remove(this._mapMode.previewLine)
      this._mapMode.previewLine.geometry.dispose()
      this._mapMode.previewLine.material.dispose()
      this._mapMode.previewLine = null
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
    this._sceneView.scene.add(line)
    this._mapMode.previewLine = line
  }

  /**
   * Shows or hides the endpoint snap indicator ring (PC only, ADR-031 §6).
   * @param {THREE.Vector3|null} snapPt  world position to show ring at; null = hide
   * @param {number} color  hex color for the ring
   */
  _updateSnapRing(snapPt, color) {
    const scene = this._sceneView.scene

    if (!snapPt) {
      if (this._mapMode.snapRingMesh) this._mapMode.snapRingMesh.visible = false
      return
    }

    if (!this._mapMode.snapRingMesh) {
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
      this._mapMode.snapRingMesh = mesh
    }

    this._mapMode.snapRingMesh.visible = true
    this._mapMode.snapRingMesh.material.color.setHex(color)
    this._mapMode.snapRingMesh.position.copy(snapPt)
    this._mapMode.snapRingMesh.position.z = 0
  }

  /** Updates the status bar text during map drawing. */
  _updateMapStatus() {
    const { tool, points, drawState } = this._mapMode
    if (!tool) return

    if (drawState === 'pending') return   // pending status set in _enterMapPendingState

    const geometry  = this._geometryForType(tool)
    const typeLabel = this._placeTypeForType(tool)
    const n = points.length
    const mobile = this._isMapMobile()

    if (geometry === 'point') {
      this._uiView.setStatusRich([
        { text: typeLabel, bold: true, color: '#80cbc4' },
        { text: mobile ? 'Tap to place' : 'Click to place', color: '#888' },
        { text: '  ESC cancel', color: '#444' },
      ])
    } else if (geometry === 'line') {
      if (mobile) {
        this._uiView.setStatusRich([
          { text: typeLabel, bold: true, color: '#80cbc4' },
          { text: 'Drag to draw a straight line', color: '#888' },
          { text: '  ESC cancel', color: '#444' },
        ])
      } else {
        this._uiView.setStatusRich([
          { text: typeLabel, bold: true, color: '#80cbc4' },
          { text: `${n} pts`, color: '#aaa' },
          { text: 'click to add vertex', color: '#888' },
          { text: n >= 2 ? '  Enter / RMB = done' : '', color: '#aaa' },
          { text: '  ESC cancel', color: '#444' },
        ])
      }
    } else {
      const typeHint = mobile ? 'Drag to draw rectangle' : 'Drag to draw rectangle'
      this._uiView.setStatusRich([
        { text: typeLabel, bold: true, color: '#80cbc4' },
        { text: typeHint, color: '#888' },
        { text: '  ESC cancel', color: '#444' },
      ])
    }
  }

  /**
   * Rebuilds the Map toolbar to reflect current state.
   * In pending state: shows name input + Confirm + Cancel.
   * In drawing state: shows tool buttons + (Confirm if ready) + Cancel.
   * @private
   */
  _refreshMapToolbar() {
    if (!this._mapMode.active) return
    const { tool, drawState, pendingName } = this._mapMode

    // In pending state: Confirm is always available; show name input
    const isPending  = drawState === 'pending'
    const canConfirm = isPending

    this._uiView.showMapToolbar(
      tool,
      (t) => this._setMapTool(t),
      canConfirm ? () => this._mapConfirmDrawing() : null,
      tool       ? () => this._mapCancelDrawing()  : null,
      ()         => this._exitMapMode(),
      isPending ? (pendingName ?? '') : null,  // pendingName = show name input; null = hide
    )
  }

  /**
   * Finds the nearest V/E/F snap target to the current mouse cursor.
   * Returns the snapped world position (or ground-plane fallback).
   * Also updates this._measure.snapping / snappedTarget / snapTargets.
   */
  _measurePickPoint() {
    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight

    const targets = collectSnapTargets(this._scene.objects, 'all')
    this._measure.snapTargets = targets

    const bestTarget = this._pickBestSnapTarget(targets, mx, my)

    if (bestTarget) {
      this._measure.snapping      = true
      this._measure.snappedTarget = bestTarget
      return bestTarget.position.clone()
    }

    // Fallback: intersect ground plane (Z=0)
    this._measure.snapping      = false
    this._measure.snappedTarget = null
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (this._raycaster.ray.intersectPlane(this._groundPlane, pt)) return pt
    return null
  }

  /** Builds or updates the dashed preview line shown during measure placement phase 2. */
  _updateMeasurePreview(p1, p2) {
    const pts = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]
    if (!this._measure.previewLine) {
      const geo  = new THREE.BufferGeometry()
      const mat  = new THREE.LineDashedMaterial({
        color: 0xf9a825, dashSize: 0.15, gapSize: 0.08, depthTest: false,
      })
      this._measure.previewLine = new THREE.Line(geo, mat)
      this._measure.previewLine.renderOrder = 1
      this._sceneView.scene.add(this._measure.previewLine)
    }
    const geo = this._measure.previewLine.geometry
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    geo.attributes.position.needsUpdate = true
    this._measure.previewLine.computeLineDistances()
  }

  _deleteObject(id) {
    const target = this._scene.getObject(id)
    if (!target) return

    // Frames are always deletable.  Geometry objects require at least one
    // other geometry object to remain in the scene.
    if (!(target instanceof CoordinateFrame)) {
      const geometryCount = [...this._scene.objects.values()]
        .filter(o => !(o instanceof CoordinateFrame)).length
      if (geometryCount <= 1) {
        this._uiView.showToast('Scene must contain at least one object', { type: 'warn' })
        return
      }
    }

    // ADR-033 §4: warn when deleting a CoordinateFrame that is referenced by SpatialLinks
    if (target instanceof CoordinateFrame) {
      const links = this._service.getLinksOf(id)
      if (links.length > 0) {
        const n = links.length
        this._uiView.showConfirmDialog(
          `Frame "${target.name}" is referenced by ${n} spatial link${n > 1 ? 's' : ''}.\n` +
          `Deleting it will leave those links dangling. Delete anyway?`,
          (confirmed) => {
            if (confirmed) this._execDeleteObject(id, target)
          },
          { title: 'Delete Frame', confirmLabel: 'Delete', danger: true },
        )
        return
      }
    }

    this._execDeleteObject(id, target)
  }

  /** Performs the actual soft-delete after all guards have passed. */
  _execDeleteObject(id, target) {
    if (!target) target = this._scene.getObject(id)
    if (!target) return

    // If deleting the active object while in Edit Mode, exit cleanly first
    // (setMode operates on the active meshView, so must be called before dispose)
    if (id === this._scene.activeId && this._scene.selectionMode === 'edit') {
      this.setMode('object')
    }

    const wasActive = this._scene.activeId === id

    // If deleting the active frame, hide its chain before detaching
    if (wasActive && target instanceof CoordinateFrame && this._activeFrameChain.size > 0) {
      this._hideFrameChain()
    }
    // If deleting a geometry object with visible child frames, hide them first
    if (wasActive && !(target instanceof CoordinateFrame)) {
      this._setChildFramesVisible(id, false)
    }

    // Determine next active object: prefer geometry objects over frames.
    const nextId = wasActive
      ? (
          // First try another geometry object
          [...this._scene.objects.entries()].find(
            ([k, o]) => k !== id && !(o instanceof CoordinateFrame),
          )?.[0]
          // Fall back to any object (e.g. another frame)
          ?? [...this._scene.objects.keys()].find(k => k !== id)
          ?? null
        )
      : null

    // ── Soft-delete for undo support (ADR-022 Phase 3) ────────────────────
    const childrenRefs = [...this._collectAllDescendantFrames(id)]
      .map(fid => this._scene.getObject(fid)).filter(Boolean)

    // Detach children first (deepest last, though frames rarely nest >1 deep)
    for (let i = childrenRefs.length - 1; i >= 0; i--) {
      this._service.detachObject(childrenRefs[i].id)
    }
    this._service.detachObject(id)
    target.meshView.setVisible(false)

    const cmd = createDeleteCommand(
      target, childrenRefs, this._service,
      // onAfterUndo: switch active to the restored entity
      (restoredId) => this._switchActiveObject(restoredId, true),
      // onAfterRedo: switch active to next available object
      (deletedId)  => {
        const nxt = [...this._scene.objects.entries()]
          .find(([k, o]) => k !== deletedId && !(o instanceof CoordinateFrame))?.[0]
          ?? [...this._scene.objects.keys()].find(k => k !== deletedId)
          ?? null
        if (nxt) this._switchActiveObject(nxt, true)
      },
    )
    this._commandStack.push(cmd)

    if (wasActive && nextId) {
      this._switchActiveObject(nextId, true)
    }
  }

  /**
   * Duplicates the active Solid, makes the copy active, and immediately
   * starts a grab so the user can position it (Blender Shift+D behaviour).
   * No-ops if there is no active object or it is a Profile.
   */
  _duplicateObject() {
    const id = this._scene.activeId
    if (!id) return
    // SpatialLink has no geometry — cannot be duplicated (ADR-030)
    if (this._activeObj instanceof SpatialLink) {
      this._uiView.showToast('SpatialLink cannot be duplicated', { type: 'warn' })
      return
    }
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    const copy = this._service.duplicateSolid(id)
    if (!copy) return
    this._selectedIds.clear()
    this._selectedIds.add(copy.id)
    this._switchActiveObject(copy.id, true)
    this._startGrab()
  }

  // ─── Mobile TransformControls helpers ─────────────────────────────────────

  /**
   * Creates TransformControls (translate mode) and a proxy Object3D for mobile.
   * The proxy is positioned at the selected object's world centroid so TC can
   * drive it; objectChange then propagates the delta to the domain entity.
   *
   * Called once at construction time when `pointer: coarse` is detected.
   */
  _initMobileTransformControls() {
    this._tcProxy = new THREE.Object3D()
    this._sceneView.scene.add(this._tcProxy)

    this._tc = new TransformControls(this._sceneView.camera, this._sceneView.renderer.domElement)
    this._tc.setMode('translate')
    this._tc.setSpace('world')
    // In Three.js r152+ TransformControls extends Controls (not Object3D).
    // The visible scene graph lives in tc.getHelper() (= tc._root, an Object3D).
    // Must add getHelper() to the scene, not tc itself.
    this._sceneView.scene.add(this._tc.getHelper())

    // Render the gizmo on top of CoordinateFrame axes (renderOrder 1) so it
    // is never hidden behind the origin frame that appears on selection.
    this._tc.getHelper().traverse(child => {
      child.renderOrder = 2
    })

    // Disable OrbitControls while dragging; re-enable on release
    this._tc.addEventListener('dragging-changed', (e) => {
      this._tcDragging = e.value
      this._controls.enabled = !e.value
      if (e.value) {
        // Drag start — snapshot based on current TC mode
        this._tcStartProxyPos  = this._tcProxy.position.clone()
        this._tcStartProxyQuat = this._tcProxy.quaternion.clone()
        this._tcStartCorners   = this._snapshotTcCorners()
        if (this._tcMode === 'rotate' && this._activeObj instanceof CoordinateFrame) {
          this._tcStartFrameRot = this._activeObj.rotation.clone()
        }
      } else {
        // Drag end — record undo command based on TC mode
        const obj = this._activeObj
        if (this._tcMode === 'rotate' && obj instanceof CoordinateFrame) {
          if (this._tcStartFrameRot) {
            const endQuat = obj.rotation.clone()
            if (!endQuat.equals(this._tcStartFrameRot)) {
              const cmd = createFrameRotateCommand(
                obj, this._tcStartFrameRot.clone(), endQuat, this._service,
                () => this._updateNPanel(),
              )
              this._commandStack.push(cmd)
              this._refreshUndoRedoState()
            }
            this._tcStartFrameRot = null
          }
          this._updateNPanel()
        } else {
          // Translate: record MoveCommand
          if (this._tcStartCorners.size > 0 && obj) {
            const endCorners = this._snapshotTcCorners()
            const cmd = createMoveCommand('Move', this._tcStartCorners, endCorners, this._scene, this._service)
            this._commandStack.push(cmd)
            this._refreshUndoRedoState()
          }
        }
        this._tcStartCorners = new Map()
      }
    })

    // Apply proxy transform to domain entity every frame during drag
    this._tc.addEventListener('objectChange', () => {
      const obj = this._activeObj
      if (!obj) return
      if (this._tcMode === 'rotate' && obj instanceof CoordinateFrame) {
        // Rotate mode: apply quaternion delta to frame rotation
        if (!this._tcStartProxyQuat || !this._tcStartFrameRot) return
        const deltaQ = this._tcProxy.quaternion.clone().multiply(
          this._tcStartProxyQuat.clone().invert(),
        )
        obj.rotation.copy(this._tcStartFrameRot).premultiply(deltaQ)
        obj.meshView.updateRotation(obj.rotation)
      } else {
        // Translate mode: apply position delta to handles
        const delta    = this._tcProxy.position.clone().sub(this._tcStartProxyPos)
        const startPts = this._tcStartCorners.get(obj.id)
        if (!startPts) return
        const handles = (obj instanceof CoordinateFrame) ? obj.localOffset : obj.corners
        startPts.forEach((c, i) => handles[i].copy(c).add(delta))
        obj.meshView.updateGeometry(handles)
        obj.meshView.updateBoxHelper()
        if (obj instanceof CoordinateFrame) this._service.invalidateWorldPose(obj.id)
      }
    })
  }

  /**
   * Attaches the TC gizmo to the active object on mobile.
   * Does nothing on desktop (this._tc is null) or for unsupported entity types.
   * @param {object} obj - domain entity
   */
  _attachMobileTransform(obj) {
    if (!this._tc || !obj) return
    // Skip entity types that either can't move or have special movement semantics
    if (obj instanceof SpatialLink    ||
        obj instanceof MeasureLine    ||
        obj instanceof AnnotatedLine  ||
        obj instanceof AnnotatedRegion ||
        obj instanceof AnnotatedPoint) {
      this._detachMobileTransform()
      return
    }
    // Position proxy at object's world centroid
    const centroid = (obj instanceof CoordinateFrame)
      ? (this._service.worldPoseOf(obj.id)?.position?.clone() ?? new THREE.Vector3())
      : getCentroid(obj.corners)
    this._tcProxy.position.copy(centroid)
    this._tcProxy.quaternion.identity()  // reset accumulated proxy rotation each attach
    this._tcProxy.updateMatrixWorld()
    // CoordinateFrame: default to translate mode (user adjusts position first, then
    // switches to rotate with the toolbar button).  All other entities: translate only.
    // Always keep _tcMode in sync with the actual TC mode so that objectChange
    // and dragging-changed handlers read the correct mode.
    if (obj instanceof CoordinateFrame) {
      this._tcMode = 'translate'
      this._tc.setMode('translate')
    } else {
      this._tcMode = 'translate'
      this._tc.setMode('translate')
    }
    this._tc.attach(this._tcProxy)
    // Force the TC gizmo to immediately update to the proxy's new world position.
    // Without this, the gizmo stays at the previous object's position until the
    // next render cycle, visually separating TC from the newly selected frame's origin.
    this._tc.getHelper().updateMatrixWorld()
  }

  /** Detaches and hides the TC gizmo. Safe to call when TC is already detached. */
  _detachMobileTransform() {
    if (!this._tc) return
    this._tc.detach()
  }

  /**
   * Toggles the TC gizmo between 'rotate' and 'translate' mode.
   * Only effective when a CoordinateFrame is the active object on mobile.
   */
  _toggleTcMode() {
    if (!this._tc) return
    this._tcMode = this._tcMode === 'rotate' ? 'translate' : 'rotate'
    this._tc.setMode(this._tcMode)
    this._tcProxy.quaternion.identity()  // clear accumulated proxy rotation on mode switch
    this._syncMobileTransformProxy()     // re-anchor gizmo to current frame world position
    this._updateMobileToolbar()
  }

  /**
   * Repositions the TC proxy to match the current state of the active object
   * and forces the TC gizmo to update its internal state.
   *
   * Called after undo/redo and mode switches.
   *
   * For CoordinateFrame: forces `_updateWorldPoses()` first, because undo/redo
   * runs MoveCommand.apply() which calls `invalidateWorldPose()` before this
   * method runs — leaving the cache empty and causing `worldPoseOf()` to return
   * null (which would fall back to the world origin).
   */
  _syncMobileTransformProxy() {
    if (!this._tc || !this._tcProxy || !this._activeObj || !this._tc.object) return
    const obj = this._activeObj
    // Ensure world pose cache is populated for CoordinateFrame. It may have been
    // cleared by invalidateWorldPose() (e.g. in MoveCommand.apply during undo/redo)
    // before the animation loop's _updateWorldPoses() has had a chance to run.
    if (obj instanceof CoordinateFrame) this._service._updateWorldPoses()
    const centroid = (obj instanceof CoordinateFrame)
      ? (this._service.worldPoseOf(obj.id)?.position?.clone() ?? new THREE.Vector3())
      : getCentroid(obj.corners)
    this._tcProxy.position.copy(centroid)
    this._tc.getHelper().updateMatrixWorld()
  }

  /**
   * Snapshots current corners/localOffset of the active object into a Map.
   * @returns {Map<string, THREE.Vector3[]>}
   */
  _snapshotTcCorners() {
    const obj = this._activeObj
    if (!obj) return new Map()
    const handles = (obj instanceof CoordinateFrame) ? obj.localOffset : obj.corners
    return new Map([[obj.id, handles.map(c => c.clone())]])
  }

  /**
   * Switches the active object without toggling selection.
   * @param {string} id
   * @param {boolean} select - whether to set _objSelected = true
   */
  _switchActiveObject(id, select = false) {
    // Deselect / un-highlight previous
    if (this._scene.activeId && this._scene.activeId !== id) {
      const prev = this._scene.getObject(this._scene.activeId)
      if (prev) {
        prev.meshView.setObjectSelected(false)
        if (prev instanceof CoordinateFrame) {
          this._hideFrameChain()
        } else {
          this._setChildFramesVisible(this._scene.activeId, false)
        }
      }
    }

    this._service.setActiveObject(id)
    this._objSelected = select
    // Keep _selectedIds in sync so grab / pointer-drag work after outliner selection
    if (select) {
      this._selectedIds.clear()
      this._selectedIds.add(id)
    }

    const obj = this._scene.getObject(id)
    if (obj) obj.meshView.setObjectSelected(select)
    if (select) {
      if (obj instanceof CoordinateFrame) {
        this._showFrameChain(id)
      } else {
        this._setChildFramesVisible(id, true)
      }
    }

    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()

    // Attach or detach mobile translate gizmo based on new selection state
    if (obj && select) {
      this._attachMobileTransform(obj)
    } else if (!id) {
      this._detachMobileTransform()
    }
  }

  _setObjectVisible(id, visible) {
    this._service.setObjectVisible(id, visible)
  }

  _renameObject(id, name) {
    const oldName = this._scene.getObject(id)?.name
    if (!oldName || oldName === name) return
    this._service.renameObject(id, name)
    if (id === this._scene.activeId) this._updateNPanel()
    // ── Record undo snapshot (ADR-022 Phase 4) ────────────────────────────
    const cmd = createRenameCommand(id, oldName, name, this._service)
    this._commandStack.push(cmd)
  }

  /** Toggles N panel visibility and updates gizmo offset (desktop only) */
  _toggleNPanel() {
    this._uiView.toggleNPanel()
    this._updateNPanel()
    if (this._gizmoView) {
      const mobile = window.innerWidth < 768
      this._gizmoView.setRightOffset(!mobile && this._uiView.nPanelVisible ? 216 : 16)
    }
  }

  /** Called when user clicks a row in the outliner */
  _onOutlinerSelect(id) {
    // During link creation: treat the clicked row as the target entity
    if (this._spatialLinkMode.active) {
      if (id !== this._spatialLinkMode.sourceId) {
        this._showLinkTypePicker(window.innerWidth / 2, window.innerHeight / 2, id)
      }
      return  // don't change active selection while in link mode
    }
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    if (id !== this._scene.activeId) {
      this._switchActiveObject(id, true)
    } else {
      // Clicking the already-active row just re-selects it
      this._setObjectSelected(true)
    }
  }

  // ── SpatialLink creation flow (ADR-030 Phase 4) ────────────────────────────

  /** Starts the two-phase L-key link creation. Source = currently active entity. */
  _startSpatialLinkCreation() {
    this._spatialLinkMode.active   = true
    this._spatialLinkMode.sourceId = this._scene.activeId
    this._spatialLinkMode.pendingTargetId = null
    this._uiView.setStatus('Click target entity  [Esc: cancel]')
    this._uiView.setCursor('crosshair')
  }

  /** Cancels link creation mode and restores normal status. */
  _cancelSpatialLinkCreation() {
    this._spatialLinkMode.active   = false
    this._spatialLinkMode.sourceId = null
    this._spatialLinkMode.pendingTargetId = null
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
  }

  /**
   * Opens the link-type picker at (x, y) for the given target entity.
   * Filters valid link types based on source / target entity type (ADR-032 §2).
   * @param {number} x  client X
   * @param {number} y  client Y
   * @param {string} targetId
   */
  _showLinkTypePicker(x, y, targetId) {
    this._spatialLinkMode.pendingTargetId = targetId
    const sourceId = this._spatialLinkMode.sourceId
    const source   = this._scene.getObject(sourceId)
    const target   = this._scene.getObject(targetId)
    const validTypes = _computeValidLinkTypes(source, target)
    this._uiView.showLinkTypePicker(x, y, (linkType) => {
      if (linkType === 'mounts') {
        this._confirmMountAnnotation(sourceId, targetId)
      } else {
        this._confirmSpatialLink(linkType)
      }
    }, { validTypes })
  }

  /**
   * Creates the SpatialLink and records the undo command.
   * @param {string} linkType
   */
  _confirmSpatialLink(linkType) {
    const { sourceId, pendingTargetId } = this._spatialLinkMode
    if (!sourceId || !pendingTargetId) return
    const link = this._service.createSpatialLink(sourceId, pendingTargetId, linkType)
    this._commandStack.push(createSpatialLinkCommand(link, this._service))
    this._uiView.showToast(`Link created: ${linkType}`)
    this._cancelSpatialLinkCreation()
    this._updateNPanel()
  }

  /**
   * Mounts an Annotated* entity onto a CoordinateFrame and records the command.
   * Called from both the L-key flow (PC) and the mobile mount-picking flow.
   * @param {string} sourceId  Annotated* entity ID
   * @param {string} targetId  CoordinateFrame entity ID
   */
  _confirmMountAnnotation(sourceId, targetId) {
    const result = this._service.mountAnnotation(sourceId, targetId)
    if (!result) {
      this._uiView.showToast('Cannot mount — host frame pose unknown', { type: 'warn' })
      return
    }
    const { link, worldPositionsBefore } = result
    this._commandStack.push(createMountAnnotationCommand(
      link, worldPositionsBefore, this._service,
      () => { this._updateNPanel() },
      () => { this._updateNPanel() },
    ))
    this._uiView.showToast(`Mounted on frame "${this._scene.getObject(targetId)?.name}"`)
    this._cancelSpatialLinkCreation()
    this._cancelMountPicking()
    this._updateNPanel()
  }

  // ── Mount picking flow (Mobile, ADR-032 Phase H-6) ────────────────────────

  /** Starts mount-picking mode for the given source Annotated* entity (mobile). */
  _startMountPicking(sourceId) {
    this._mountPicking.active   = true
    this._mountPicking.sourceId = sourceId
    this._uiView.setStatus('Tap target frame (or empty space to cancel)  [✕]')
    this._uiView.setCursor('crosshair')
  }

  /** Cancels mount-picking mode and restores normal status. */
  _cancelMountPicking() {
    if (!this._mountPicking.active) return
    this._mountPicking.active   = false
    this._mountPicking.sourceId = null
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
  }

  /**
   * Refreshes the outliner "linked" badge for an entity based on its current link count.
   * @param {string} entityId
   */
  _refreshLinkBadge(entityId) {
    if (!this._outlinerView) return
    const hasLinks = this._service.getLinksOf(entityId).length > 0
    this._outlinerView.setObjectLinked(entityId, hasLinks)
    // Also refresh the "unreferenced" badge for CoordinateFrames (ADR-033 Phase C-4)
    const obj = this._scene.getObject(entityId)
    if (obj instanceof CoordinateFrame) {
      this._outlinerView.setFrameUnreferenced(entityId, !hasLinks)
    }
  }

  /**
   * Refreshes the outliner "unreferenced" badge for a single CoordinateFrame.
   * No-op for non-CoordinateFrame entities. (ADR-033 Phase C-4)
   * @param {string} frameId
   */
  _refreshFrameUnreferencedBadge(frameId) {
    if (!this._outlinerView) return
    const obj = this._scene.getObject(frameId)
    if (!(obj instanceof CoordinateFrame)) return
    const hasLinks = this._service.getLinksOf(frameId).length > 0
    this._outlinerView.setFrameUnreferenced(frameId, !hasLinks)
  }

  /**
   * Hit-tests all scene entities for SpatialLink target selection.
   * Returns the hit entity, or null if nothing was hit.
   * Checks cuboid geometry first, then falls back to bounding-box for
   * non-geometry entities (AnnotatedLine/Region/Point, MeasureLine, CoordinateFrame).
   * @returns {{ obj: object }|null}
   */
  _hitAnyEntityForLink() {
    // Step 1: cuboid-based raycast (same as _hitAnyObject but excludes source)
    const cuboidHit = this._hitAnyObject()
    if (cuboidHit && cuboidHit.obj.id !== this._spatialLinkMode.sourceId) {
      return cuboidHit
    }

    // Step 2: bounding-box check for non-cuboid entities
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const ray = this._raycaster.ray
    const pt  = new THREE.Vector3()

    let nearestDist = Infinity
    let nearestObj  = null

    for (const obj of this._scene.objects.values()) {
      if (obj.id === this._spatialLinkMode.sourceId) continue
      if (obj.meshView?.cuboid?.visible) continue  // already checked in step 1

      let box = null

      if (obj instanceof CoordinateFrame) {
        const wp = this._service.worldPoseOf(obj.id)?.position
        if (wp) {
          box = new THREE.Box3(
            wp.clone().subScalar(0.4),
            wp.clone().addScalar(0.4),
          )
        }
      } else if (obj.corners && obj.corners.length > 0) {
        box = new THREE.Box3()
        for (const c of obj.corners) box.expandByPoint(c)
        box.expandByScalar(0.4)
      }

      if (!box) continue

      const hitPt = ray.intersectBox(box, pt)
      if (hitPt) {
        const dist = ray.origin.distanceTo(hitPt)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestObj  = obj
        }
      }
    }

    return nearestObj ? { obj: nearestObj } : null
  }

  // ─── Event binding ─────────────────────────────────────────────────────────
  _bindEvents() {
    // Store bound references so dispose() can remove them.
    this._handlers = {
      pointermove: e => this._onPointerMove(e),
      pointerdown: e => this._onPointerDown(e),
      pointerup:   e => this._onPointerUp(e),
      keydown:     e => this._onKeyDown(e),
      keyup:       e => this._onKeyUp(e),
      wheel:       e => this._onWheel(e),
      contextmenu: e => e.preventDefault(),
    }
    window.addEventListener('pointermove', this._handlers.pointermove)
    window.addEventListener('pointerdown', this._handlers.pointerdown)
    window.addEventListener('pointerup',   this._handlers.pointerup)
    window.addEventListener('keydown',     this._handlers.keydown)
    window.addEventListener('keyup',       this._handlers.keyup)
    window.addEventListener('wheel',       this._handlers.wheel, { passive: false })
    window.addEventListener('contextmenu', this._handlers.contextmenu)
  }

  dispose() {
    if (!this._handlers) return
    window.removeEventListener('pointermove', this._handlers.pointermove)
    window.removeEventListener('pointerdown', this._handlers.pointerdown)
    window.removeEventListener('pointerup',   this._handlers.pointerup)
    window.removeEventListener('keydown',     this._handlers.keydown)
    window.removeEventListener('keyup',       this._handlers.keyup)
    window.removeEventListener('wheel',       this._handlers.wheel)
    window.removeEventListener('contextmenu', this._handlers.contextmenu)
    this._handlers = null
  }

  // ─── Raycasting ────────────────────────────────────────────────────────────
  _updateMouse(e) {
    const v = toNDC(e.clientX, e.clientY, innerWidth, innerHeight)
    this._mouse.copy(v)
  }

  /**
   * Filters snap targets to visible ones, then removes far-background
   * candidates that are occluded by closer geometry.
   * @param {{ position: THREE.Vector3, type: string }[]} targets
   * @param {number} maxDepthRatio  Keep targets within this multiple of the
   *   nearest candidate's camera distance (default 2.0).
   * @returns {{ position: THREE.Vector3, type: string }[]}
   */
  _filterNearbySnapTargets(targets, maxDepthRatio = 2.0) {
    const camPos = this._camera.position
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)

    // Pass 1: visibility filter — exclude points beyond the far clip plane
    // or behind the camera (both map to v.z > 1 after project()).
    const visible = targets.filter(({ position }) => {
      const v = position.clone().project(this._camera)
      return v.z <= 1
    })

    if (visible.length === 0) return visible

    // Pass 2: depth filter — keep only candidates within maxDepthRatio of the
    // nearest candidate in 3D space.  This hides occluded or far-background
    // points that happen to overlap foreground geometry on screen.
    const dists   = visible.map(({ position }) => position.distanceTo(camPos))
    const minDist = Math.min(...dists)
    const depthFiltered = visible.filter((_, i) => dists[i] <= minDist * maxDepthRatio)

    // Pass 3 (Idea A): remove face snap candidates whose normal points away from
    // the camera.  Back-facing face centers are rarely useful snap targets and
    // create visual noise on the opposite side of objects.
    return depthFiltered.filter(t => {
      if (t.type !== 'face' || !t.normal) return true
      return t.normal.dot(camDir) < 0   // normal toward camera = front-facing
    })
  }

  /**
   * Finds the best snap target from `targets` near screen position (sx, sy).
   *
   * Idea A — back-face cull: face snap targets whose outward normal points away
   * from the camera are excluded (they are behind the visible surface).
   *
   * Idea D — front-facing bonus: among face candidates within SNAP_PX, those
   * whose normal is most directly toward the camera receive a screen-distance
   * discount (up to FRONTNESS_BONUS_PX), so they beat a slightly-closer
   * grazing-angle face snap target.
   *
   * @param {{ position: THREE.Vector3, type: string, normal?: THREE.Vector3 }[]} targets
   * @param {number} sx  cursor screen x (pixels)
   * @param {number} sy  cursor screen y (pixels)
   * @returns {{ position: THREE.Vector3, type: string, normal?: THREE.Vector3 }|null}
   */
  _pickBestSnapTarget(targets, sx, sy) {
    const SNAP_PX           = 25
    const FRONTNESS_BONUS_PX = 5   // max screen-px discount for a face directly facing camera
    const camMat = this._camera.matrixWorldInverse
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)

    let bestScore  = SNAP_PX
    let bestTarget = null

    for (const t of targets) {
      // Skip targets behind the camera
      const camPos = t.position.clone().applyMatrix4(camMat)
      if (camPos.z >= 0) continue

      // Idea A: skip back-facing face snap points
      if (t.type === 'face' && t.normal && t.normal.dot(camDir) >= 0) continue

      const s = this._projectToScreen(t.position)
      const d = Math.hypot(sx - s.x, sy - s.y)

      // Idea D: front-facing face candidates get a screen-distance discount
      const bonus = (t.type === 'face' && t.normal)
        ? Math.max(0, -t.normal.dot(camDir)) * FRONTNESS_BONUS_PX
        : 0
      const score = d - bonus
      if (score < bestScore) { bestScore = score; bestTarget = t }
    }
    return bestTarget
  }

  /**
   * Returns the snap candidate nearest to screen position (sx, sy) within
   * maxPx pixels, applying back-face culling for face targets.
   * Used to drive the hover-highlight indicator before the snap locks.
   * @param {{ position: THREE.Vector3, type: string, normal?: THREE.Vector3 }[]} targets
   * @param {number} sx  cursor x (pixels)
   * @param {number} sy  cursor y (pixels)
   * @param {number} [maxPx=60]
   * @returns target or null
   */
  _findNearestSnapCandidate(targets, sx, sy, maxPx = 60) {
    const camMat = this._camera.matrixWorldInverse
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    let bestDist   = maxPx
    let bestTarget = null
    for (const t of targets) {
      const cp = t.position.clone().applyMatrix4(camMat)
      if (cp.z >= 0) continue
      if (t.type === 'face' && t.normal && t.normal.dot(camDir) >= 0) continue
      const s = this._projectToScreen(t.position)
      const d = Math.hypot(sx - s.x, sy - s.y)
      if (d < bestDist) { bestDist = d; bestTarget = t }
    }
    return bestTarget
  }

  /** Hits any visible object — returns { hit, obj } or null */
  _hitAnyObject() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const meshes = [...this._scene.objects.values()]
      .filter(o => !(o instanceof MeasureLine) && !(o instanceof AnnotatedLine) && !(o instanceof AnnotatedRegion) && !(o instanceof AnnotatedPoint) && o.meshView.cuboid?.visible)
      .map(o => o.meshView.cuboid)
    const hits = this._raycaster.intersectObjects(meshes)
    if (!hits.length) return null
    const hitMesh = hits[0].object
    const obj = [...this._scene.objects.values()].find(o => o.meshView.cuboid === hitMesh)
    return obj ? { hit: hits[0], obj } : null
  }

  /**
   * Hits any visible annotation entity (AnnotatedLine/Region/Point) using a
   * bounding-box raycast.  Called as a fallback when _hitAnyObject() misses
   * (annotation entities have no cuboid and are excluded from that test).
   * @returns {{ obj: object }|null}
   */
  _hitAnyAnnotation() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const ray = this._raycaster.ray
    const pt  = new THREE.Vector3()

    let nearestDist = Infinity
    let nearestObj  = null

    for (const obj of this._scene.objects.values()) {
      if (!(obj instanceof AnnotatedLine) && !(obj instanceof AnnotatedRegion) && !(obj instanceof AnnotatedPoint)) continue
      if (!obj.meshView?.visible) continue  // skip soft-deleted

      const corners = obj.corners
      if (!corners.length) continue

      const box = new THREE.Box3()
      for (const c of corners) box.expandByPoint(c)
      // Expand by pick tolerance; for single-point entities this is the full hit area.
      box.expandByScalar(0.3)

      const hitPt = ray.intersectBox(box, pt)
      if (hitPt) {
        const dist = ray.origin.distanceTo(hitPt)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestObj  = obj
        }
      }
    }

    return nearestObj ? { obj: nearestObj } : null
  }

  /** Hits only the active object's mesh */
  _hitActiveSolid() {
    if (!this._activeObj) return null
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const hits = this._raycaster.intersectObject(this._activeObj.meshView.cuboid)
    return hits.length ? hits[0] : null
  }

  _hitFace() {
    const hit = this._hitActiveSolid()
    if (!hit) return null
    const fi   = Math.floor(hit.face.a / 4)
    const face = this._activeObj?.faces?.[fi] ?? null
    return face ? { face, point: hit.point } : null
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────
  _projectToScreen(position, camera = this._camera) {
    const v = position.clone().project(camera)
    return {
      x: (v.x + 1) / 2 * innerWidth,
      y: (-v.y + 1) / 2 * innerHeight,
    }
  }

  _updateNPanel() {
    if (!this._uiView.nPanelVisible) return
    const obj = this._activeObj
    if (!obj) return

    if (obj instanceof CoordinateFrame) {
      const frameUnreferenced = this._service.getLinksOf(obj.id).length === 0
      if (obj.name === 'Origin') {
        // Origin is fixed at parent centroid — show world position, locked (no local offset)
        const wp = this._service.worldPoseOf(obj.id)?.position ?? obj.translation
        this._uiView.updateNPanelForFrame(
          { x: wp.x, y: wp.y, z: wp.z },
          { x: 0, y: 0, z: 0 },
          obj.name,
          true, null, null, frameUnreferenced
        )
        return
      }
      // Non-Origin frame: show position/rotation in parent's local coordinate system
      const parent = this._scene.getObject(obj.parentId)
      const parentRot = (parent instanceof CoordinateFrame) ? parent.rotation : new THREE.Quaternion()
      const localPos = obj.translation.clone().applyQuaternion(parentRot.clone().conjugate())
      const localRot  = parentRot.clone().conjugate().multiply(obj.rotation)
      const euler = new THREE.Euler().setFromQuaternion(localRot, 'ZYX')
      // Build valid parent candidates for the N panel dropdown (ADR-028)
      const parentOptions = [...this._scene.objects.values()]
        .filter(o => {
          if (o.id === obj.id) return false
          if (o instanceof MeasureLine || o instanceof ImportedMesh) return false
          if (this._service._isDescendant(obj.id, o.id)) return false
          return true
        })
        .map(o => ({ id: o.id, name: o.name }))
      this._uiView.updateNPanelForFrame(localPos, {
        x: THREE.MathUtils.radToDeg(euler.x),
        y: THREE.MathUtils.radToDeg(euler.y),
        z: THREE.MathUtils.radToDeg(euler.z),
      }, obj.name, false, parentOptions, obj.parentId, frameUnreferenced)
      return
    }

    // SpatialLink has no geometry — show a minimal N-panel summary (ADR-030)
    if (obj instanceof SpatialLink) {
      const src = this._scene.getObject(obj.sourceId)
      const tgt = this._scene.getObject(obj.targetId)
      const srcName = src?.name ?? obj.sourceId
      const tgtName = tgt?.name ?? obj.targetId
      this._uiView.updateNPanelForSpatialLink(obj, srcName, tgtName, () => {
        // Delete callback from N-panel
        const link = this._scene.getLink(obj.id)
        if (!link) return
        this._service.detachSpatialLink(obj.id)
        this._commandStack.push(createDeleteSpatialLinkCommand(link, this._service))
        this._uiView.showToast('Link deleted')
        this._updateNPanel()
      })
      return
    }

    if (obj instanceof Profile && obj.sketchRect) {
      const { p1, p2 } = obj.sketchRect
      const centroid = new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0)
      const dims = new THREE.Vector3(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y), 0)
      this._uiView.updateNPanel(centroid, dims, obj.name, obj.description ?? '')
      return
    }

    const corners = this._corners
    if (!corners.length) return
    const centroid = getCentroid(corners)
    const bMin = new THREE.Vector3(Infinity, Infinity, Infinity)
    const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    corners.forEach(c => { bMin.min(c); bMax.max(c) })
    const dims = new THREE.Vector3().subVectors(bMax, bMin)
    const locationEditable = typeof obj.move === 'function' && !(obj instanceof CoordinateFrame)
    const showIfcClass    = obj instanceof Solid || obj instanceof ImportedMesh
    const showPlaceType   = obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint
    const placeTypeGeometry = obj instanceof AnnotatedLine   ? 'line'
      : obj instanceof AnnotatedRegion ? 'region'
      : obj instanceof AnnotatedPoint  ? 'point'
      : null
    // Spatial Links section: list all links for this entity with delete buttons
    const spatialLinks    = this._service.getLinksOf(obj.id)
    const onDeleteSpatialLink = (linkId) => {
      const link = this._scene.getLink(linkId)
      if (!link) return
      this._service.detachSpatialLink(linkId)
      this._commandStack.push(createDeleteSpatialLinkCommand(link, this._service))
      this._uiView.showToast('Link deleted')
      this._updateNPanel()
    }

    // Frames section (ADR-033 Phase C-2): only for entities that can host frames
    // (Solid / Annotated* / ImportedMesh — same restriction as createCoordinateFrame)
    const showFrames = obj instanceof Solid || obj instanceof AnnotatedLine ||
      obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint
    let frames = null
    let onAddFrame = null
    let onSelectFrame = null
    if (showFrames) {
      // Collect child CoordinateFrames whose parentId === obj.id
      frames = [...this._scene.objects.values()]
        .filter(o => o instanceof CoordinateFrame && o.parentId === obj.id)
        .map(f => {
          const linksToFrame = this._service.getLinksOf(f.id)
          return { id: f.id, name: f.name, unreferenced: linksToFrame.length === 0 }
        })
      onAddFrame = () => {
        const frame = this._service.createCoordinateFrame(obj.id)
        if (!frame) return
        this._commandStack.push(createCreateCoordinateFrameCommand(
          frame, this._service,
          () => { this._updateNPanel() },
          (id) => { this._updateNPanel() },
        ))
        this._uiView.showToast(`Frame "${frame.name}" added`)
        this._updateNPanel()
      }
      onSelectFrame = (frameId) => {
        this._switchActiveObject(frameId)
      }
    }

    this._uiView.updateNPanel(centroid, dims, obj.name, obj.description ?? '', {
      locationEditable,
      showIfcClass,
      ifcClass: showIfcClass ? (obj.ifcClass ?? null) : undefined,
      showPlaceType,
      placeType:        showPlaceType ? (obj.placeType ?? null) : undefined,
      placeTypeGeometry,
      spatialLinks:        spatialLinks.length > 0 ? spatialLinks : null,
      onDeleteSpatialLink,
      getEntityName:       (id) => this._scene.getObject(id)?.name ?? id,
      frames,
      onAddFrame,
      onSelectFrame,
    })
  }

  // ─── Mobile toolbar ────────────────────────────────────────────────────────

  /**
   * Shows the long-press context menu near the touch point.
   * Items vary by object type — only operations valid for `obj` are listed.
   * @param {number} x - client X of the touch
   * @param {number} y - client Y of the touch
   * @param obj - the domain entity that was long-pressed
   */
  _showLongPressContextMenu(x, y, obj) {
    const id = obj.id
    const canDup = !(obj instanceof ImportedMesh) && !(obj instanceof Profile)
    const isAnnotated = obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint
    const isSolidOrCF = obj instanceof Solid || obj instanceof CoordinateFrame
    const canAddFrame = obj instanceof Solid || isAnnotated

    // ADR-032 §9: mount / unmount items for Annotated* entities
    const mountLink = isAnnotated ? this._scene.getMountsLink(id) : null
    const hostFrame = mountLink ? this._scene.getObject(mountLink.targetId) : null
    const mountItems = isAnnotated
      ? (mountLink
        ? [{ label: `Unmount ⊗ "${hostFrame?.name ?? '?'}"`, onClick: () => {
            const wb = obj.vertices.map(v => v.position.clone())
            this._service.unmountAnnotation(mountLink, wb)
            // Record undo
            const undoCmd = createMountAnnotationCommand(
              mountLink, wb, this._service,
              () => { this._updateNPanel() },
              () => { this._updateNPanel() },
            )
            // Swap execute/undo for unmount: execute = unmount, undo = remount
            this._commandStack.push({ label: `Unmount from frame`, execute: undoCmd.undo, undo: undoCmd.execute })
            this._uiView.showToast('Unmounted')
            this._updateNPanel()
          }}]
        : [{ label: 'Mount on frame ⊕', onClick: () => this._startMountPicking(id) }])
      : []

    // ADR-032 §9: generic Link to... for Solid / CoordinateFrame
    const linkItems = isSolidOrCF
      ? [{ label: 'Link to... 🔗', onClick: () => {
          this._startSpatialLinkCreation()
          // Override the sourceId to the long-pressed object (it may not be active)
          this._spatialLinkMode.sourceId = id
        }}]
      : []

    const items = [
      {
        label: 'Grab',
        onClick: () => this._startGrab(),
      },
      ...(canDup ? [{
        label: 'Duplicate',
        onClick: () => this._duplicateObject(),
      }] : []),
      ...mountItems,
      ...linkItems,
      ...(canAddFrame ? [{
        label: 'Add interface frame ⊞',
        onClick: () => this._promptAddFrame(id),
      }] : []),
      {
        label: 'Rename',
        onClick: () => this._promptRename(id),
      },
      {
        label: 'Delete',
        danger: true,
        onClick: () => this._deleteObject(id),
      },
    ]
    this._uiView.showContextMenu(x, y, items)
  }

  /**
   * Shows a name-input dialog then creates a CoordinateFrame as a child of the
   * given entity.  The frame is recorded on the command stack for undo/redo.
   * Called from the long-press context menu (mobile, ADR-033 Phase C-3).
   * @param {string} parentId - ID of the parent entity
   */
  _promptAddFrame(parentId) {
    if (!this._scene.getObject(parentId)) return
    this._uiView.showRenameDialog('Frame', (name) => {
      if (name === null) return  // user cancelled
      const frameName = name || 'Frame'
      const frame = this._service.createCoordinateFrame(parentId, frameName)
      if (!frame) return
      this._commandStack.push(createCreateCoordinateFrameCommand(
        frame, this._service,
        () => { this._updateNPanel() },
        () => { this._updateNPanel() },
      ))
      this._uiView.showToast(`Frame "${frame.name}" added`)
      this._updateNPanel()
    }, { title: 'Add Interface Frame' })
  }

  /** Opens the rename prompt for the given object id (shared helper). */
  _promptRename(id) {
    const obj = this._scene.getObject(id)
    if (!obj) return
    this._uiView.showRenameDialog(obj.name, (name) => {
      if (name) this._renameObject(id, name)
    })
  }

  /** Syncs the enabled/disabled state of the mobile header Undo/Redo buttons. */
  _refreshUndoRedoState() {
    this._uiView.setUndoRedoEnabled(
      this._commandStack.canUndo,
      this._commandStack.canRedo,
    )
  }

  /** Rebuilds the mobile floating toolbar to reflect current app state. */
  _updateMobileToolbar() {
    this._refreshUndoRedoState()
    const mode     = this._scene.selectionMode
    const substate = this._scene.editSubstate

    if (this._mapMode.active) {
      // In Map Mode the left-side map toolbar handles drawing controls.
      // Show a minimal "Exit Map" slot on mobile.
      this._uiView.setMobileToolbar([
        { icon: ICONS.back, label: 'Exit Map', onClick: () => this._exitMapMode() },
        { spacer: true },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (this._measure.active) {
      this._uiView.setMobileToolbar([
        { icon: ICONS.cancel, label: 'Cancel', onClick: () => this._cancelMeasure(), danger: true },
        { spacer: true },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (this._grab.active) {
      this._uiView.setMobileToolbar([
        { icon: ICONS.confirm, label: 'Confirm', onClick: () => this._confirmGrab() },
        { icon: ICONS.stack,   label: 'Stack',   onClick: () => this._toggleStackMode(), active: this._grab.stackMode },
        { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => this._cancelGrab(), danger: true },
        { spacer: true },
      ])
      return
    }

    if (mode === 'object') {
      const hasObj = this._objSelected

      // CoordinateFrame: TC mode toggle | Done | Delete | Add Frame | spacer
      if (hasObj && this._activeObj instanceof CoordinateFrame) {
        const isRotate = this._tcMode === 'rotate'
        this._uiView.setMobileToolbar([
          {
            icon:    isRotate ? ICONS.rotate    : ICONS.translate,
            label:   isRotate ? 'Rotate'        : 'Move',
            active:  true,  // always highlight current mode
            onClick: () => this._toggleTcMode(),
          },
          { icon: ICONS.confirm, label: 'Done', onClick: () => this._setObjectSelected(false) },
          { icon: ICONS.delete, label: 'Delete', onClick: () => this._deleteObject(this._scene.activeId), danger: true },
          { icon: ICONS.frame,  label: 'Add Frame', onClick: () => this._addObject('frame') },
          { spacer: true },
        ])
        return
      }

      // Annotated entity toolbar: Grab | Map (to edit in map mode) | Delete | (spacer)
      const _isAnnotated = o => o instanceof AnnotatedLine || o instanceof AnnotatedRegion || o instanceof AnnotatedPoint
      const _isSpatialLink = o => o instanceof SpatialLink
      // SpatialLink: no operations available on mobile toolbar (ADR-030)
      if (hasObj && _isSpatialLink(this._activeObj)) {
        this._uiView.setMobileToolbar([
          { spacer: true }, { spacer: true },
          { icon: ICONS.delete, label: 'Delete', onClick: () => this._deleteObject(this._scene.activeId), danger: true },
          { spacer: true }, { spacer: true },
        ])
        return
      }
      if (hasObj && _isAnnotated(this._activeObj)) {
        this._uiView.setMobileToolbar([
          { icon: ICONS.grab,   label: 'Grab',   onClick: () => this._startGrab() },
          { icon: ICONS.map,    label: 'Map',    onClick: () => this._enterMapMode() },
          { icon: ICONS.delete, label: 'Delete', onClick: () => this._deleteObject(this._scene.activeId), danger: true },
          { spacer: true },
        ])
        return
      }

      // 5-slot layout: Add | Dup | Edit | Delete | Stack
      // All slots always present; unavailable actions are disabled to prevent layout shifts.
      const canDup   = hasObj && !(this._activeObj instanceof ImportedMesh) && !(this._activeObj instanceof MeasureLine) && !(this._activeObj instanceof CoordinateFrame) && !(this._activeObj instanceof Profile) && !_isAnnotated(this._activeObj) && !_isSpatialLink(this._activeObj)
      const canEdit  = canDup
      const canStack = hasObj
        && !(this._activeObj instanceof ImportedMesh)
        && !(this._activeObj instanceof MeasureLine)
        && !_isAnnotated(this._activeObj)
        && !_isSpatialLink(this._activeObj)
      this._uiView.setMobileToolbar([
        {
          icon: ICONS.add, label: 'Add',
          onClick: () => {
            const canAddFrame = this._objSelected && !(this._activeObj instanceof MeasureLine) && !(this._activeObj instanceof ImportedMesh)
            this._uiView.showAddMenu(
              window.innerWidth / 2, window.innerHeight / 2,
              () => this._addObject('box'),
              () => this._addObject('sketch'),
              () => this._addObject('measure'),
              () => this._triggerStepImport(),
              canAddFrame ? () => this._addObject('frame') : undefined,
            )
          },
        },
        { icon: ICONS.duplicate, label: 'Dup',    onClick: () => this._duplicateObject(),                                        disabled: !canDup },
        { icon: ICONS.edit,      label: 'Edit',   onClick: () => this.setMode('edit'),                                           disabled: !canEdit },
        { icon: ICONS.delete,    label: 'Delete', onClick: () => this._deleteObject(this._scene.activeId), danger: hasObj,       disabled: !hasObj },
        { icon: ICONS.stack,     label: 'Stack',  onClick: () => { this._grab.stackMode = !this._grab.stackMode; this._updateMobileToolbar() }, active: this._grab.stackMode, disabled: !canStack },
      ])
      return
    }

    if (substate === '2d-sketch') {
      // Always show ← first so its position never shifts. Extrude is disabled
      // until a rectangle has been drawn.
      const hasRect = this._sketch.p1 && this._sketch.p2 &&
        (Math.abs(this._sketch.p2.x - this._sketch.p1.x) > 0.01 ||
         Math.abs(this._sketch.p2.y - this._sketch.p1.y) > 0.01)
      this._uiView.setMobileToolbar([
        { icon: ICONS.back,    label: 'Object',  onClick: () => this.setMode('object') },
        { icon: ICONS.extrude, label: 'Extrude', onClick: () => this._enterExtrudePhase(), disabled: !hasRect },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (substate === '2d-extrude') {
      this._uiView.setMobileToolbar([
        { icon: ICONS.confirm, label: 'Confirm', onClick: () => this._confirmExtrudePhase() },
        { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => this._cancelExtrudePhase(), danger: true },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (substate === '3d') {
      const em = this._editSelectMode
      this._uiView.setMobileToolbar([
        { icon: ICONS.back,   label: 'Object', onClick: () => this.setMode('object') },
        { icon: ICONS.vertex, label: 'Vertex', onClick: () => this._setEditSelectMode('vertex'), active: em === 'vertex' },
        { icon: ICONS.edge,   label: 'Edge',   onClick: () => this._setEditSelectMode('edge'),   active: em === 'edge' },
        { icon: ICONS.face,   label: 'Face',   onClick: () => this._setEditSelectMode('face'),   active: em === 'face' },
      ])
    }
  }

  // ─── Status bar helpers ────────────────────────────────────────────────────

  /** Single source of truth for "X selected" / '' status in Object Mode. */
  _refreshObjectModeStatus() {
    if (!this._objSelected || !this._activeObj) {
      this._uiView.setStatus('')
      return
    }
    this._uiView.setStatusRich([
      { text: this._activeObj.name, bold: true, color: '#e8e8e8' },
      { text: 'selected', color: '#888' },
    ])
    this._uiView.appendInfoHint(
      this._activeObj instanceof CoordinateFrame ? 'R' : null,
      'Rotate',
    )
  }

  // ─── Edit mode sub-element helpers (Phase 6) ─────────────────────────────

  /** Status bar for Edit Mode · 3D showing current sub-element mode. */
  _refreshEditModeStatus() {
    const LABEL = { vertex: 'Vertex', edge: 'Edge', face: 'Face' }
    const COLOR = { vertex: '#69f0ae', edge: '#ffd740', face: '#4fc3f7' }
    const m = this._editSelectMode
    this._uiView.setStatusRich([
      { text: 'Edit', color: '#888' },
      { text: LABEL[m], bold: true, color: COLOR[m] },
      { text: '1 Vertex  2 Edge  3 Face', color: '#444' },
    ])
  }

  /** Switches the sub-element mode and clears stale hover state. */
  _setEditSelectMode(mode) {
    this._editSelectMode = mode
    this._hoveredFace   = null
    this._hoveredVertex = null
    this._hoveredEdge   = null
    if (this._meshView) {
      this._meshView.setFaceHighlight(null, this._corners)
      this._meshView.clearVertexHover()
      this._meshView.clearEdgeHover()
    }
    this._uiView.setCursor('default')
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
  }

  /**
   * Projects a world position to screen pixels.
   * @param {import('three').Vector3} pos3d
   * @returns {{ x: number, y: number }}
   */
  _toScreenPx(pos3d) {
    const v = pos3d.clone().project(this._camera)
    return {
      x: (v.x + 1) / 2 * innerWidth,
      y: (-v.y + 1) / 2 * innerHeight,
    }
  }

  /**
   * Finds the vertex of the active object nearest to screen position (mx, my).
   * @param {number} mx  screen x in pixels
   * @param {number} my  screen y in pixels
   * @param {number} [maxPx=15]  max pixel radius
   * @returns {import('../graph/Vertex.js').Vertex|null}
   */
  _findNearestVertex(mx, my, maxPx = 15) {
    const obj = this._activeObj
    if (!obj?.vertices) return null
    let best = null, bestDist = maxPx
    for (const v of obj.vertices) {
      const s = this._toScreenPx(v.position)
      const d = Math.hypot(s.x - mx, s.y - my)
      if (d < bestDist) { bestDist = d; best = v }
    }
    return best
  }

  /**
   * Finds the edge of the active object nearest to screen position (mx, my)
   * by comparing to each edge's midpoint.
   * @param {number} mx
   * @param {number} my
   * @param {number} [maxPx=15]
   * @returns {import('../graph/Edge.js').Edge|null}
   */
  _findNearestEdge(mx, my, maxPx = 15) {
    const obj = this._activeObj
    if (!obj?.edges) return null
    let best = null, bestDist = maxPx
    for (const e of obj.edges) {
      const mid = e.v0.position.clone().add(e.v1.position).multiplyScalar(0.5)
      const s = this._toScreenPx(mid)
      const d = Math.hypot(s.x - mx, s.y - my)
      if (d < bestDist) { bestDist = d; best = e }
    }
    return best
  }

  /**
   * Handles a click in Edit Mode · 3D — updates editSelection and visuals.
   * @param {boolean} shift  whether Shift was held
   */
  _handleEditClick(shift) {
    const sel = this._scene.editSelection
    let element = null

    if (this._editSelectMode === 'face')   element = this._hoveredFace
    else if (this._editSelectMode === 'vertex') element = this._hoveredVertex
    else if (this._editSelectMode === 'edge')   element = this._hoveredEdge

    if (!element) {
      if (!shift) this._scene.clearEditSelection()
    } else {
      if (shift) {
        if (sel.has(element)) sel.delete(element)
        else                  sel.add(element)
      } else {
        this._scene.clearEditSelection()
        sel.add(element)
      }
    }

    this._meshView.updateEditSelection(sel, this._corners)

    const count = sel.size
    if (count > 0) {
      const LABEL = { vertex: 'vertex', edge: 'edge', face: 'face' }
      this._uiView.setStatusRich([
        { text: String(count), bold: true, color: '#e8e8e8' },
        { text: `${LABEL[this._editSelectMode]}${count > 1 ? 's' : ''} selected`, color: '#888' },
      ])
    } else {
      this._refreshEditModeStatus()
    }
    this._updateMobileToolbar()
  }

  // ─── Mode management ───────────────────────────────────────────────────────
  setMode(mode) {
    // ImportedMesh, MeasureLine, CoordinateFrame, Annotated entities, and SpatialLink
    // have no vertex graph — Edit Mode not supported (ADR-030)
    if (mode === 'edit' && (
      this._activeObj instanceof ImportedMesh ||
      this._activeObj instanceof MeasureLine  ||
      this._activeObj instanceof CoordinateFrame ||
      this._activeObj instanceof AnnotatedLine   ||
      this._activeObj instanceof AnnotatedRegion ||
      this._activeObj instanceof AnnotatedPoint  ||
      this._activeObj instanceof SpatialLink
    )) {
      this._uiView.showToast('Edit Mode is not available for this object type')
      return
    }

    // ── Cancel all in-progress operations ──────────────────────────────────
    if (this._grab.active)   this._cancelGrab()
    if (this._rotate.active) this._cancelRotate()
    if (this._faceExtrude.active) this._cancelFaceExtrude()
    if (this._objDragging) {
      this._objDragging = false
      this._objCtrlDrag = false
    }

    // ── Clear all edit visual state on the current active object ───────────
    if (this._meshView) {
      this._meshView.setFaceHighlight(null, this._corners)
      this._meshView.clearExtrusionDisplay()
      this._meshView.clearSketchRect()
      this._meshView.clearVertexHover()
      this._meshView.clearEdgeHover()
      this._meshView.clearEditSelection()
    }
    this._uiView.clearExtrusionLabel()
    this._hoveredFace   = null
    this._hoveredVertex = null
    this._hoveredEdge   = null
    this._scene.clearEditSelection()

    // ── Substate reset and mode dispatch ───────────────────────────────────
    this._cleanupEditSubstate()
    this._scene.setSelectionMode(mode)
    this._controls.enabled = true

    if (mode === 'object') {
      // Restore selection state when returning from Edit Mode — the active
      // object is still valid but _objSelected was cleared on Edit entry.
      if (this._activeObj && !this._objSelected) {
        this._objSelected = true
        this._activeObj.meshView.setObjectSelected(true)
        if (this._activeObj instanceof CoordinateFrame) {
          this._showFrameChain(this._scene.activeId)
        } else {
          this._setChildFramesVisible(this._scene.activeId, true)
        }
      }
      this._refreshObjectModeStatus()
      this._uiView.updateMode('object')
      this._updateMobileToolbar()
      // Re-attach mobile gizmo when returning to Object mode
      if (this._activeObj && this._objSelected) this._attachMobileTransform(this._activeObj)
    } else {
      // edit mode — dispatch on entity type
      this._detachMobileTransform()  // hide gizmo in Edit mode (no 3D translate there)
      this._clearObjectSelection()
      this._setObjectSelected(false)
      this._objDragging = false
      if (this._activeObj instanceof Profile) {
        this._enterEditMode2D()
      } else {
        this._enterEditMode3D()
      }
    }
  }

  _cleanupEditSubstate() {
    this._scene.setEditSubstate(null)
    this._sketch.drawing = false
    this._sketch.p1 = null
    this._sketch.p2 = null
    this._extrudePhase.hasInput = false
    this._extrudePhase.inputStr = ''
    this._extrudePhase.height = 0
  }

  _enterEditMode2D() {
    this._scene.setEditSubstate('2d-sketch')
    this._uiView.setStatus('')
    this._uiView.updateMode('edit', '2d')
    // Restore existing sketch rect if any
    const obj = this._activeObj
    if (obj?.sketchRect) {
      this._sketch.p1 = obj.sketchRect.p1.clone()
      this._sketch.p2 = obj.sketchRect.p2.clone()
      this._meshView.showSketchRect(this._sketch.p1, this._sketch.p2)
      this._uiView.setStatusRich([
        { text: 'Sketch', bold: true, color: '#4fc3f7' },
        { text: 'Drag to redraw · Enter to extrude', color: '#888' },
      ])
    } else {
      this._uiView.setStatusRich([
        { text: 'Sketch', bold: true, color: '#4fc3f7' },
        { text: 'Click and drag to draw rectangle', color: '#888' },
      ])
    }
    this._updateMobileToolbar()
  }

  _enterEditMode3D() {
    this._scene.setEditSubstate('3d')
    this._editSelectMode = 'face'
    this._uiView.updateMode('edit', '3d')
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
  }

  _enterExtrudePhase() {
    if (!this._sketch.p1 || !this._sketch.p2) return
    this._scene.setEditSubstate('2d-extrude')
    this._extrudePhase.height = 1
    this._extrudePhase.inputStr = ''
    this._extrudePhase.hasInput = false

    // Drag plane at sketch center, with horizontal normal (allows Z variation on mouse move)
    const p1 = this._sketch.p1, p2 = this._sketch.p2
    const sketchCenter = new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0)
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    camDir.z = 0
    if (camDir.lengthSq() < 0.001) camDir.set(1, 0, 0)
    camDir.normalize()
    this._extrudePhase.dragPlane.setFromNormalAndCoplanarPoint(camDir, sketchCenter)

    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (this._raycaster.ray.intersectPlane(this._extrudePhase.dragPlane, pt)) {
      this._extrudePhase.startPoint.copy(pt)
    } else {
      this._extrudePhase.startPoint.copy(sketchCenter)
    }

    // Show cuboid mesh for preview
    if (this._meshView) this._meshView.setVisible(true)
    this._applyExtrudePreview()
    this._uiView.updateMode('edit', '2d-extrude')
    this._updateExtrudePhaseStatus()
    this._updateMobileToolbar()
    if (window.matchMedia('(pointer: coarse)').matches) this._controls.enabled = false
  }

  _applyExtrudePreview() {
    const parsed = parseFloat(this._extrudePhase.inputStr)
    const height = this._extrudePhase.hasInput
      ? (isNaN(parsed) ? 0 : parsed)
      : this._extrudePhase.height
    const corners = buildCuboidFromRect(this._sketch.p1, this._sketch.p2, height)
    this._meshView.updateGeometry(corners)
    this._meshView.showSketchRect(this._sketch.p1, this._sketch.p2)

    // Show extrusion label
    const labelPos = new THREE.Vector3(
      (this._sketch.p1.x + this._sketch.p2.x) / 2,
      (this._sketch.p1.y + this._sketch.p2.y) / 2,
      height / 2,
    )
    const screen = this._projectToScreen(labelPos)
    this._uiView.setExtrusionLabel(`H ${Math.abs(height).toFixed(3)}`, screen.x, screen.y)
  }

  _confirmExtrudePhase() {
    const parsed = parseFloat(this._extrudePhase.inputStr)
    const height = this._extrudePhase.hasInput
      ? (isNaN(parsed) ? 0 : parsed)
      : this._extrudePhase.height
    if (Math.abs(height) < 0.001) { this._cancelExtrudePhase(); return }

    // Capture Profile ref before the swap for undo (ADR-022 Phase 2)
    const profileRef = this._scene.getObject(this._scene.activeId)

    const cuboid = this._service.extrudeProfile(this._scene.activeId, height)
    if (!cuboid) return

    // ── Record undo snapshot ──────────────────────────────────────────────
    const cmd = createExtrudeSketchCommand(
      profileRef, height, this._service,
      (id) => { this._switchActiveObject(id, true) },
    )
    this._commandStack.push(cmd)

    // Synchronous JS rebuild for immediate display (ADR-027: real-time path).
    this._meshView.updateGeometry(cuboid.corners)
    this._meshView.setVisible(true)
    this._meshView.clearSketchRect()
    this._uiView.clearExtrusionLabel()

    // Background Wasm rebuild via the profile-specific path (ADR-027 Phase 3).
    // `profileRef.vertices` holds the original 2D profile vertices before the swap.
    // Silently falls back to the JS geometry above if the worker is not ready.
    const profileVerts2d = profileRef.vertices.map(v => v.position)
    cuboid.meshView.rebuildExtrudedProfile(profileVerts2d, height).catch(() => {})

    this._uiView.setStatusRich([
      { text: 'Extruded', color: '#6ab04c' },
      { text: 'Edit Mode · 3D', bold: true, color: '#e8e8e8' },
    ])
    this._controls.enabled = true
    this._cleanupEditSubstate()
    this._enterEditMode3D()
  }

  _cancelExtrudePhase() {
    // Return to sketch phase
    this._uiView.clearExtrusionLabel()
    if (this._meshView) {
      this._meshView.setVisible(false)
      this._meshView.clearSketchRect()
    }
    this._extrudePhase.hasInput = false
    this._extrudePhase.inputStr = ''
    this._extrudePhase.height = 0
    this._controls.enabled = true
    this._enterEditMode2D()
  }

  _updateExtrudePhaseStatus() {
    const parsed = parseFloat(this._extrudePhase.inputStr)
    const height = this._extrudePhase.hasInput
      ? (isNaN(parsed) ? 0 : parsed)
      : this._extrudePhase.height
    const parts = [{ text: 'Extrude', bold: true, color: '#ffffff' }]
    if (this._extrudePhase.hasInput) {
      parts.push({ text: this._extrudePhase.inputStr + '_', color: '#ffeb3b' })
    } else {
      parts.push({ text: `H: ${height.toFixed(3)}`, color: '#ffeb3b' })
    }
    this._uiView.setStatusRich(parts)
  }

  _setObjectSelected(sel) {
    this._objSelected = sel
    if (this._meshView) this._meshView.setObjectSelected(sel)
    if (this._scene.activeId) {
      const active = this._scene.getObject(this._scene.activeId)
      if (active instanceof CoordinateFrame) {
        if (sel) this._showFrameChain(this._scene.activeId)
        else this._hideFrameChain()
      } else {
        this._setChildFramesVisible(this._scene.activeId, sel)
      }
    }
    // Sync the TC gizmo with the new selection state so every code path
    // (not just _switchActiveObject) keeps the gizmo visible/hidden correctly.
    if (sel && this._activeObj) this._attachMobileTransform(this._activeObj)
    else this._detachMobileTransform()
    this._refreshObjectModeStatus()
    this._updateMobileToolbar()
  }

  // ─── Rectangle selection helpers ──────────────────────────────────────────

  /** Creates the CSS overlay <div> used to draw the selection rectangle. */
  _createRectSelEl() {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position:       'fixed',
      pointerEvents:  'none',
      display:        'none',
      zIndex:         '50',
      boxSizing:      'border-box',
    })
    document.body.appendChild(el)
    return el
  }

  /** Updates the overlay position/style to reflect the current drag rectangle. */
  _updateRectSelDisplay() {
    const { startPx, currentPx } = this._rectSel
    const isRight = currentPx.x >= startPx.x
    const x = Math.min(startPx.x, currentPx.x)
    const y = Math.min(startPx.y, currentPx.y)
    const w = Math.abs(currentPx.x - startPx.x)
    const h = Math.abs(currentPx.y - startPx.y)
    Object.assign(this._rectSelEl.style, {
      display:     'block',
      left:        x + 'px',
      top:         y + 'px',
      width:       w + 'px',
      height:      h + 'px',
      border:      '1px ' + (isRight ? 'solid' : 'dashed') + ' ' + (isRight ? '#4fc3f7' : '#ffa726'),
      background:  isRight ? 'rgba(79,195,247,0.05)' : 'rgba(255,167,38,0.05)',
    })
  }

  /**
   * Collects ALL CoordinateFrame IDs in the frame tree rooted at `parentId`
   * (any object type).  Recurses through all levels of CoordinateFrame children.
   * @param {string} parentId
   * @returns {Set<string>}
   */
  _collectAllDescendantFrames(parentId) {
    const result = new Set()
    const recurse = (id) => {
      for (const child of this._scene.getChildren(id)) {
        if (child instanceof CoordinateFrame) {
          result.add(child.id)
          recurse(child.id)
        }
      }
    }
    recurse(parentId)
    return result
  }

  /**
   * Shows or hides the frame tree attached to a geometry object.
   * `visible = true`  → showFull() on all frames + connection lines (full opacity)
   * `visible = false` → _hideFrameChain()
   *
   * Used when the GEOMETRY PARENT is selected/deselected (not a frame).
   * @param {string|null} parentId
   * @param {boolean} visible
   */
  _setChildFramesVisible(parentId, visible) {
    if (!parentId) return
    if (visible) {
      this._showGeometryFrameTree(parentId)
    } else {
      this._hideFrameChain()
    }
  }

  /**
   * Shows all CoordinateFrame descendants of a geometry object at full opacity.
   * Called when the geometry parent is selected (no specific frame is active).
   * @param {string} geoId
   */
  _showGeometryFrameTree(geoId) {
    const treeIds = this._collectAllDescendantFrames(geoId)
    this._activeFrameChain = treeIds
    for (const fid of treeIds) {
      const f = this._scene.getObject(fid)
      if (!f) continue
      f.meshView.showFull()
      f.meshView.showConnection(false)   // always draw line to parent (geometry or frame)
    }
  }

  /**
   * Shows the full frame tree of the geometry root that `frameId` belongs to.
   * The selected frame is shown at full opacity; all other frames are dimmed.
   * Connection lines between parent-child frame pairs are drawn; the line to
   * the selected frame is full opacity, others are dimmed.
   * @param {string} frameId  ID of the active CoordinateFrame
   */
  _showFrameChain(frameId) {
    // Find geometry root (walk up through CoordinateFrame parents)
    let geoRoot = this._scene.getObject(frameId)
    while (geoRoot instanceof CoordinateFrame) {
      geoRoot = this._scene.getObject(geoRoot.parentId)
    }
    if (!geoRoot) return

    const treeIds = this._collectAllDescendantFrames(geoRoot.id)
    this._activeFrameChain = treeIds

    for (const fid of treeIds) {
      const f = this._scene.getObject(fid)
      if (!f) continue
      const isSelected = fid === frameId
      if (isSelected) f.meshView.showFull()
      else            f.meshView.showDimmed()
      // Connection line to parent (geometry centroid or parent frame).
      // Full opacity for the selected frame's own line; dimmed for others.
      f.meshView.showConnection(!isSelected)
    }
  }

  /**
   * Hides all frames in _activeFrameChain and clears connection lines.
   * Safe to call when _activeFrameChain is empty (no-op).
   */
  _hideFrameChain() {
    const chain = this._activeFrameChain
    this._activeFrameChain = new Set()
    for (const fid of chain) {
      const f = this._scene.getObject(fid)
      if (!f) continue  // already deleted — skip (view already disposed)
      f.meshView.hide()
      f.meshView.hideConnection()
    }
  }

  /** Clears visual selection highlight for all currently selected objects. */
  _clearObjectSelection() {
    // Always hide any visible frame tree first (_hideFrameChain handles both
    // geometry-tree and frame-chain visibility in _activeFrameChain)
    this._hideFrameChain()
    for (const id of this._selectedIds) {
      const obj = this._scene.getObject(id)
      if (obj) obj.meshView.setObjectSelected(false)
    }
    this._selectedIds.clear()
  }

  /**
   * Finalizes the rectangle selection.
   * Right-drag (x increases): enclosed-only mode.
   * Left-drag (x decreases): touch mode (any overlap counts).
   */
  _finalizeRectSelection() {
    const { startPx, currentPx } = this._rectSel
    const w = Math.abs(currentPx.x - startPx.x)
    const h = Math.abs(currentPx.y - startPx.y)

    // Tiny movement — treat as deselect click
    if (w < 3 && h < 3) {
      this._clearObjectSelection()
      this._setObjectSelected(false)
      return
    }

    const isRight = currentPx.x >= startPx.x
    const minX = Math.min(startPx.x, currentPx.x)
    const minY = Math.min(startPx.y, currentPx.y)
    const maxX = Math.max(startPx.x, currentPx.x)
    const maxY = Math.max(startPx.y, currentPx.y)

    const matched = []
    for (const obj of this._scene.objects.values()) {
      if (!obj.meshView.cuboid?.visible) continue
      const corners = obj.corners ?? _meshBboxCorners(obj)
      if (!corners || corners.length === 0) continue
      const pts = corners.map(c => this._toScreenPx(c))

      if (isRight) {
        // Enclosed: every projected corner must be inside the rect
        if (pts.every(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) {
          matched.push(obj)
        }
      } else {
        // Touch: object screen-bounding-box overlaps the rect
        const bMinX = Math.min(...pts.map(p => p.x))
        const bMaxX = Math.max(...pts.map(p => p.x))
        const bMinY = Math.min(...pts.map(p => p.y))
        const bMaxY = Math.max(...pts.map(p => p.y))
        if (bMinX <= maxX && bMaxX >= minX && bMinY <= maxY && bMaxY >= minY) {
          matched.push(obj)
        }
      }
    }

    // Clear previous multi-selection then apply new one
    this._clearObjectSelection()
    if (matched.length === 0) {
      this._setObjectSelected(false)
      return
    }

    for (const obj of matched) {
      obj.meshView.setObjectSelected(true)
      this._setChildFramesVisible(obj.id, true)
      this._selectedIds.add(obj.id)
    }

    // Make the first matched object active
    const first = matched[0]
    if (first.id !== this._scene.activeId) {
      // Deselect previous active's box-helper (already handled above)
      this._service.setActiveObject(first.id)
    }
    this._objSelected = true
    this._refreshObjectModeStatus()
    this._updateNPanel()
  }

  // ─── Blender-style grab ────────────────────────────────────────────────────

  _startGrab() {
    if (!this._objSelected) return
    // SpatialLink has no geometry — cannot be grabbed (ADR-030)
    if (this._activeObj instanceof SpatialLink) {
      this._uiView.showToast('SpatialLink cannot be grabbed', { type: 'warn' })
      return
    }
    this._grab.active          = true
    this._grab.axis            = null
    this._grab.inputStr        = ''
    this._grab.hasInput        = false
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._grab.snapMode        = 'all'
    this._grab.snapTargets     = []
    this._grab.startMouse.copy(this._mouse)
    this._grab.startCorners = this._corners.map(c => c.clone())
    // Snapshot corners of every selected object for multi-object grab
    this._grab.allStartCorners = new Map()
    for (const id of this._selectedIds) {
      const selObj = this._scene.getObject(id)
      if (selObj) this._grab.allStartCorners.set(id, _grabHandlesOf(selObj).map(c => c.clone()))
    }
    // segmentStartCorners tracks the start of each individual drag segment (touch).
    // Initially identical to allStartCorners; re-snapshotted on each touch re-down.
    this._grab.segmentStartCorners = new Map(
      [...this._grab.allStartCorners.entries()].map(([id, cs]) => [id, cs.map(c => c.clone())])
    )
    // For CoordinateFrame, corners = [translation] (parent-relative offset).
    // Use the world position from the cache so the drag plane passes through
    // the frame's actual world location (ADR-020).
    const grabCenter = (this._activeObj instanceof CoordinateFrame)
      ? (this._service.worldPoseOf(this._activeObj.id)?.position?.clone() ?? getCentroid(this._corners))
      : getCentroid(this._corners)
    this._grab.centroid.copy(grabCenter)
    this._grab.pivot.copy(this._grab.centroid)
    this._grab.pivotLabel = 'Centroid'
    this._grab.autoSnap   = false

    // ADR-032 §6: for mounted Annotated* entities, constrain drag to host local XY plane.
    // For unmounted Annotated* entities, constrain to world XY (prevents Z drift).
    // For all other entities, use the camera-facing plane (existing behaviour).
    const isAnnotated = this._activeObj instanceof AnnotatedLine ||
      this._activeObj instanceof AnnotatedRegion ||
      this._activeObj instanceof AnnotatedPoint
    let planeNormal = null
    if (isAnnotated) {
      const mountLink = this._scene.getMountsLink(this._scene.activeId)
      if (mountLink) {
        // Mounted: use host CoordinateFrame's local Z axis as drag plane normal
        const hostPose = this._service.worldPoseOf(mountLink.targetId)
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
      this._camera.getWorldDirection(camDir)
      planeNormal = camDir
    }
    this._grab.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this._grab.pivot)

    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (this._raycaster.ray.intersectPlane(this._grab.dragPlane, pt)) {
      this._grab.startPoint.copy(pt)
    } else {
      this._grab.startPoint.copy(this._grab.pivot)
    }

    this._controls.enabled = false
    this._uiView.setCursor('grabbing')
    this._updateGrabStatus()
    this._updateMobileToolbar()
  }

  _confirmGrab() {
    if (!this._grab.active) return
    if (this._grab.pivotSelectMode) { this._cancelPivotSelect(); return }
    this._applyGrab()

    // ADR-032 §6: after grab on mounted Annotated* entities, sync local positions
    // so _updateMountedAnnotations uses the new world positions going forward.
    for (const id of this._selectedIds) {
      this._service.syncMountedPosition(id)
    }

    // ── Record undo snapshot (ADR-022 Phase 1) ────────────────────────────
    const endCornersMap = new Map()
    for (const id of this._selectedIds) {
      const obj = this._scene.getObject(id)
      if (obj) endCornersMap.set(id, _grabHandlesOf(obj).map(c => c.clone()))
    }
    if (endCornersMap.size > 0) {
      const label = endCornersMap.size === 1 ? 'Move' : `Move ${endCornersMap.size} objects`
      const cmd = createMoveCommand(label, this._grab.allStartCorners, endCornersMap, this._scene, this._service)
      this._commandStack.push(cmd)
    }

    this._grab.active        = false
    this._grab.axis          = null
    this._grab.autoSnap      = false
    this._grab.snappedTarget = null
    this._grab.stackMode     = false
    this._grab.stacking      = false
    this._meshView.clearPivotDisplay()
    this._meshView.clearSnapDisplay()
    this._controls.enabled = true
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()
    // Re-anchor the TC gizmo to the object's new position after grab.
    // During a regular touch/keyboard grab the proxy is never moved by the TC,
    // so after confirm the gizmo would remain at the pre-grab position.
    if (this._activeObj) this._attachMobileTransform(this._activeObj)
  }

  _cancelGrab() {
    if (!this._grab.active) return
    if (this._grab.pivotSelectMode) { this._grab.pivotSelectMode = false }
    // Restore all selected objects to their pre-grab positions
    for (const [id, startCorners] of this._grab.allStartCorners) {
      const selObj = this._scene.getObject(id)
      if (selObj) {
        const handles = _grabHandlesOf(selObj)
        startCorners.forEach((c, i) => handles[i].copy(c))
        selObj.meshView.updateGeometry(handles)
        selObj.meshView.updateBoxHelper()
      }
    }
    this._meshView.clearPivotDisplay()
    this._meshView.clearSnapDisplay()
    this._grab.active        = false
    this._grab.axis          = null
    this._grab.autoSnap      = false
    this._grab.snappedTarget = null
    this._grab.stackMode     = false
    this._grab.stacking      = false
    this._controls.enabled = true
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()
  }

  // ── CoordinateFrame rotation (R key, ADR-019) ────────────────────────────

  /**
   * Starts rotate mode for the active CoordinateFrame.
   * Only valid when the active object is a CoordinateFrame and no grab is active.
   */
  _startRotate() {
    const frame = this._activeObj
    if (!(frame instanceof CoordinateFrame)) return
    if (this._grab.active) return

    this._rotate.active    = true
    this._rotate.axis      = null
    this._rotate.inputStr  = ''
    this._rotate.hasInput  = false
    this._rotate.startRot.copy(frame.rotation)

    // Compute the screen-space angle from the projected frame origin to the mouse.
    // This allows the mouse-driven angle to be relative to where it started.
    const projected = (this._service.worldPoseOf(frame.id)?.position ?? frame.translation).clone().project(this._camera)
    this._rotate.startAngle = Math.atan2(
      this._mouse.y - projected.y,
      this._mouse.x - projected.x,
    )

    this._controls.enabled = false
    this._updateRotateStatus()
  }

  /**
   * Confirms the current rotation and exits rotate mode.
   */
  _confirmRotate() {
    if (!this._rotate.active) return
    this._applyRotate()
    // ── Record undo snapshot (ADR-022 Phase 4) ────────────────────────────
    if (this._activeObj instanceof CoordinateFrame) {
      const frame = this._activeObj
      const endQuat = frame.rotation.clone()
      if (!endQuat.equals(this._rotate.startRot)) {
        const cmd = createFrameRotateCommand(
          frame, this._rotate.startRot.clone(), endQuat, this._service,
          () => this._updateNPanel(),
        )
        this._commandStack.push(cmd)
      }
    }
    this._rotate.active   = false
    this._rotate.axis     = null
    this._rotate.inputStr = ''
    this._rotate.hasInput = false
    this._controls.enabled = true
    this._refreshObjectModeStatus()
    this._updateNPanel()
  }

  /**
   * Cancels the rotation, restoring the frame to its saved rotation.
   */
  _cancelRotate() {
    if (!this._rotate.active) return
    const frame = this._activeObj
    if (frame instanceof CoordinateFrame) {
      frame.rotation.copy(this._rotate.startRot)
      frame.meshView.updateRotation(frame.rotation)
    }
    this._rotate.active   = false
    this._rotate.axis     = null
    this._rotate.inputStr = ''
    this._rotate.hasInput = false
    this._controls.enabled = true
    this._refreshObjectModeStatus()
  }

  /**
   * Sets the world-axis constraint for the current rotation.
   * Toggling the same axis clears the constraint (free rotation).
   * @param {'x'|'y'|'z'} axis
   */
  _setRotateAxis(axis) {
    this._rotate.axis = (this._rotate.axis === axis) ? null : axis
    this._rotate.inputStr = ''
    this._rotate.hasInput = false
    // Recompute start angle with new axis
    const frame = this._activeObj
    if (frame instanceof CoordinateFrame) {
      const projected = (this._service.worldPoseOf(frame.id)?.position ?? frame.translation).clone().project(this._camera)
      this._rotate.startAngle = Math.atan2(
        this._mouse.y - projected.y,
        this._mouse.x - projected.x,
      )
    }
    this._applyRotate()
    this._updateRotateStatus()
  }

  /**
   * Applies the current rotation delta to the active CoordinateFrame.
   * Called on every pointer move and on numeric input changes.
   */
  _applyRotate() {
    const frame = this._activeObj
    if (!(frame instanceof CoordinateFrame) || !this._rotate.active) return

    let angle
    if (this._rotate.hasInput) {
      const parsed = parseFloat(this._rotate.inputStr)
      angle = isNaN(parsed) ? 0 : parsed * (Math.PI / 180)
    } else {
      // Mouse-driven: measure signed angle from start to current mouse position.
      // Negated so that moving the mouse CCW around the frame rotates CCW (natural tracking).
      const projected = (this._service.worldPoseOf(frame.id)?.position ?? frame.translation).clone().project(this._camera)
      const currentAngle = Math.atan2(
        this._mouse.y - projected.y,
        this._mouse.x - projected.x,
      )
      angle = this._rotate.startAngle - currentAngle
      // Ctrl: snap to stepSize degree increments
      if (this._ctrlHeld) {
        const stepRad = this._rotate.stepSize * (Math.PI / 180)
        angle = Math.round(angle / stepRad) * stepRad
      }
    }

    // Build axis vector: world axis when constrained, view-direction when free.
    let axisVec
    if (this._rotate.axis === 'x') axisVec = new THREE.Vector3(1, 0, 0)
    else if (this._rotate.axis === 'y') axisVec = new THREE.Vector3(0, 1, 0)
    else if (this._rotate.axis === 'z') axisVec = new THREE.Vector3(0, 0, 1)
    else {
      // Screen-plane rotation: axis points toward the camera (view direction negated).
      axisVec = new THREE.Vector3()
      this._camera.getWorldDirection(axisVec).negate()
    }

    const deltaQ = new THREE.Quaternion().setFromAxisAngle(axisVec, angle)
    frame.rotation.copy(this._rotate.startRot).premultiply(deltaQ)
    frame.meshView.updateRotation(frame.rotation)
    this._updateRotateStatus()
  }

  /**
   * Updates the status bar text to reflect the current rotate operation.
   */
  _updateRotateStatus() {
    const AXIS_COLORS = { x: '#e05252', y: '#6ab04c', z: '#4a9eed' }
    const parts = [{ text: 'Rotate', bold: true, color: '#80b3ff' }]

    if (this._rotate.axis) {
      parts.push({ text: this._rotate.axis.toUpperCase(), bold: true, color: AXIS_COLORS[this._rotate.axis] })
    }
    if (this._rotate.hasInput) {
      parts.push({ text: this._rotate.inputStr + '°_', color: '#ffeb3b' })
    } else if (this._ctrlHeld) {
      parts.push({ text: `Step: ${this._rotate.stepSize}°`, bold: true, color: '#80cbc4' })
      parts.push({ text: 'Scroll to change', color: '#444' })
    }
    parts.push({ text: 'Enter confirm  Esc cancel', color: '#444' })
    this._uiView.setStatusRich(parts)
  }

  _setGrabAxis(axis) {
    this._grab.axis     = (this._grab.axis === axis) ? null : axis
    this._grab.inputStr = ''
    this._grab.hasInput = false
    this._applyGrab()
    this._updateGrabStatus()
  }

  _getAxisVec(axis) {
    return new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    )
  }

  _applyGrab() {
    if (!this._grab.active) return
    if (this._grab.hasInput && this._grab.axis) {
      this._applyGrabFromInput()
    } else if (this._grab.axis) {
      this._applyAxisConstrainedGrab()
    } else {
      this._applyFreeGrab()
    }
    // Stack snap: adjust Z so grabbed objects rest on top of any object below
    if (this._grab.stackMode) {
      this._applyStackSnap()
    } else {
      this._grab.stacking = false
    }
    // Update geometry for all selected objects
    for (const id of this._selectedIds) {
      const selObj = this._scene.getObject(id)
      if (selObj) {
        selObj.meshView.updateGeometry(_grabHandlesOf(selObj))
        selObj.meshView.updateBoxHelper()
      }
    }
  }

  /** Toggles stacking mode on/off during an active grab. */
  _toggleStackMode() {
    this._grab.stackMode = !this._grab.stackMode
    this._grab.stacking  = false
    this._applyGrab()
    this._updateGrabStatus()
    this._updateMobileToolbar()
  }

  /**
   * Stack snap: after all grab movement is applied, cast downward rays from the
   * bottom face of the active grabbed object. If another object is directly below,
   * shift all grabbed objects upward so the bottom face rests on that surface.
   *
   * Must be called after `_applyGrabDeltaToAll()` has updated vertex positions.
   */
  _applyStackSnap() {
    const grabbed = this._activeObj
    if (!(grabbed instanceof Solid)) { this._grab.stacking = false; return }

    // Find bottom Z of the grabbed object
    const gCorners = grabbed.corners
    let gZMin = Infinity
    gCorners.forEach(c => { if (c.z < gZMin) gZMin = c.z })

    // Collect meshes from non-grabbed objects (excluding MeasureLine)
    const grabbedIds = new Set(this._selectedIds)
    const targetMeshes = [...this._scene.objects.values()]
      .filter(o => !grabbedIds.has(o.id) && !(o instanceof MeasureLine) && o.meshView?.cuboid?.visible)
      .map(o => o.meshView.cuboid)

    if (!targetMeshes.length) { this._grab.stacking = false; return }

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

    if (highestHitZ === null) { this._grab.stacking = false; return }

    const zOffset = highestHitZ - gZMin
    // Skip if already resting on the surface (within 1mm tolerance)
    if (Math.abs(zOffset) < 0.001) { this._grab.stacking = false; return }

    // Apply additional Z shift to all selected objects' vertex positions directly
    for (const id of this._selectedIds) {
      const selObj = this._scene.getObject(id)
      if (selObj instanceof Solid) {
        selObj.corners.forEach(c => { c.z += zOffset })
      }
    }
    this._grab.stacking = true
  }

  /**
   * Applies `delta` to the active object and all other selected objects.
   * Uses each object's own startCorners snapshot from `_grab.allStartCorners`.
   * @param {import('three').Vector3} delta
   */
  _applyGrabDeltaToAll(delta) {
    for (const [id, startCorners] of this._grab.segmentStartCorners) {
      const selObj = this._scene.getObject(id)
      if (selObj) selObj.move(startCorners, delta)
    }
  }

  _applyGrabFromInput() {
    this._grab.snapping = false
    const parsed = parseFloat(this._grab.inputStr)
    if (this._grab.inputStr && isNaN(parsed)) {
      this._uiView.showToast('Invalid number')
      return
    }
    const dist    = isNaN(parsed) ? 0 : parsed
    const axisVec = this._getAxisVec(this._grab.axis)
    this._applyGrabDeltaToAll(axisVec.clone().multiplyScalar(dist))
  }

  _applyFreeGrab() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (!this._raycaster.ray.intersectPlane(this._grab.dragPlane, pt)) return
    let delta = pt.clone().sub(this._grab.startPoint)
    if (this._grab.autoSnap) {
      delta = this._trySnapToGeometry(delta)
    } else if (this._ctrlHeld) {
      delta = this._applyGridSnapToDelta(delta)
      this._grab.snapping      = false
      this._grab.snappedTarget = null
    } else {
      this._grab.snapping      = false
      this._grab.snappedTarget = null
    }
    this._applyGrabDeltaToAll(delta)
  }

  _applyAxisConstrainedGrab() {
    const axisVec = this._getAxisVec(this._grab.axis)

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
    const P_c = this._grab.pivot.clone().applyMatrix4(this._camera.matrixWorldInverse)
    const v_c = axisVec.clone().transformDirection(this._camera.matrixWorldInverse)
    const f_y = 1 / Math.tan(THREE.MathUtils.degToRad(this._camera.fov * 0.5))
    const f_x = f_y / this._camera.aspect
    const z   = P_c.z    // negative for in-front points

    const dx        = f_x * (v_c.x * (-z) - P_c.x * v_c.z) / (z * z)
    const dy        = f_y * (v_c.y * (-z) - P_c.y * v_c.z) / (z * z)
    const screenLen = Math.sqrt(dx * dx + dy * dy)
    if (screenLen < 1e-4) return

    const axisNormX = dx / screenLen
    const axisNormY = dy / screenLen

    const mdx  = this._mouse.x - this._grab.startMouse.x
    const mdy  = this._mouse.y - this._grab.startMouse.y
    const dist = (mdx * axisNormX + mdy * axisNormY) / screenLen

    if (this._grab.autoSnap) {
      const delta        = new THREE.Vector3().addScaledVector(axisVec, dist)
      const snappedDelta = this._trySnapToGeometry(delta)
      this._applyGrabDeltaToAll(snappedDelta)
    } else if (this._ctrlHeld) {
      this._grab.snapping      = false
      this._grab.snappedTarget = null
      const g           = this._grab.gridSize
      const snappedDist = Math.round(dist / g) * g
      this._applyGrabDeltaToAll(axisVec.clone().multiplyScalar(snappedDist))
    } else {
      this._grab.snapping      = false
      this._grab.snappedTarget = null
      this._applyGrabDeltaToAll(axisVec.clone().multiplyScalar(dist))
    }
  }

  _updateGrabStatus() {
    if (this._grab.pivotSelectMode) {
      const MODE_LABEL = { all: 'All', vertex: 'Vertex', edge: 'Edge', face: 'Face' }
      const MODE_COLOR = { all: '#aaa', vertex: '#69f0ae', edge: '#ffd740', face: '#4fc3f7' }
      const m = this._grab.pivotMode ?? 'all'
      this._uiView.setStatusRich([
        { text: 'Select Pivot', bold: true, color: '#e8e8e8' },
        { text: MODE_LABEL[m], color: MODE_COLOR[m] },
        { text: '1 Vertex  2 Edge  3 Face', color: '#444' },
      ])
      return
    }

    const AXIS_COLORS = { x: '#e05252', y: '#6ab04c', z: '#4a9eed' }
    const parts = [{ text: 'Grab', bold: true, color: '#ffffff' }]

    if (this._grab.axis) {
      parts.push({ text: this._grab.axis.toUpperCase(), bold: true, color: AXIS_COLORS[this._grab.axis] })
    }
    if (this._grab.hasInput) {
      parts.push({ text: this._grab.inputStr + '_', color: '#ffeb3b' })
    }
    if (this._grab.pivotLabel !== 'Centroid') {
      parts.push({ text: this._grab.pivotLabel, color: '#888' })
    }
    if (this._grab.stackMode) {
      if (this._grab.stacking) {
        parts.push({ text: 'Stack: ON', bold: true, color: '#a5d6a7' })
      } else {
        parts.push({ text: 'Stack', color: '#4caf50' })
      }
    }
    if (this._grab.snapping && this._grab.snappedTarget) {
      parts.push({ text: `Snap: ${this._grab.snappedTarget.label}`, bold: true, color: '#ff9800' })
    } else if (this._grab.autoSnap) {
      parts.push({ text: 'Auto Snap [World]', color: '#80cbc4' })
      parts.push({ text: 'Origin / X / Y / Z', color: '#444' })
    } else if (this._ctrlHeld) {
      parts.push({ text: `Grid: ${this._grab.gridSize}`, bold: true, color: '#80cbc4' })
      parts.push({ text: 'Scroll to change', color: '#444' })
    }

    this._uiView.setStatusRich(parts)
  }

  // ─── Grid snap (Ctrl during grab) ─────────────────────────────────────────

  /** Grid sizes cycled by Ctrl+Wheel during grab */
  static get GRID_SIZES() { return [0.1, 0.25, 0.5, 1, 2.5, 5, 10] }

  /** Angle step sizes (degrees) cycled by Ctrl+Wheel during rotate */
  static get ANGLE_STEPS() { return [1, 5, 10, 15, 22.5, 45, 90] }

  /**
   * Rounds a delta vector to the nearest multiple of the current grid size.
   * @param {THREE.Vector3} delta
   * @returns {THREE.Vector3}
   */
  _applyGridSnapToDelta(delta) {
    const g = this._grab.gridSize
    return new THREE.Vector3(
      Math.round(delta.x / g) * g,
      Math.round(delta.y / g) * g,
      Math.round(delta.z / g) * g,
    )
  }

  _onWheel(e) {
    // ── 2D Map Mode: scroll to zoom ──────────────────────────────────────
    if (this._mapMode.active) {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      this._mapMode.frustumSize = Math.max(2, Math.min(500, this._mapMode.frustumSize * factor))
      this._sceneView.setOrthoZoom(this._mapMode.frustumSize)
      return
    }
    if (this._rotate.active && this._ctrlHeld) {
      e.preventDefault()
      const steps = AppController.ANGLE_STEPS
      const idx   = steps.indexOf(this._rotate.stepSize)
      const cur   = idx >= 0 ? idx : (steps.findIndex(s => s >= this._rotate.stepSize) || 0)
      const next  = e.deltaY > 0
        ? Math.min(cur + 1, steps.length - 1)
        : Math.max(cur - 1, 0)
      this._rotate.stepSize = steps[next]
      this._applyRotate()
      this._updateRotateStatus()
      return
    }
    if (!this._grab.active || !this._ctrlHeld) return
    e.preventDefault()
    const sizes = AppController.GRID_SIZES
    const idx   = sizes.indexOf(this._grab.gridSize)
    // fall back to nearest index if current size not in list
    const cur   = idx >= 0 ? idx : sizes.findIndex(s => s >= this._grab.gridSize) || 0
    const next  = e.deltaY > 0
      ? Math.min(cur + 1, sizes.length - 1)
      : Math.max(cur - 1, 0)
    this._grab.gridSize = sizes[next]
    this._applyGrab()
    this._updateGrabStatus()
  }

  // ─── Face extrude (E key) ──────────────────────────────────────────────────

  _startFaceExtrude(face) {
    const fe = this._faceExtrude
    fe.active        = true
    fe.face          = face
    fe.savedCorners  = face.vertices.map(v => v.position.clone())
    fe.allStartCorners = this._corners.map(c => c.clone())   // full Solid snapshot for undo (ADR-022)
    fe.dist          = 0
    fe.inputStr      = ''
    fe.hasInput      = false
    fe.snapping      = false
    fe.snappedTarget = null
    fe.normal.copy(computeOutwardFaceNormal(this._corners, face.index))
    const center = fe.savedCorners.reduce((a, c) => a.add(c), new THREE.Vector3()).divideScalar(fe.savedCorners.length)
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    fe.dragPlane.setFromNormalAndCoplanarPoint(camDir, center)
    const pt = new THREE.Vector3()
    this._raycaster.setFromCamera(this._mouse, this._camera)
    fe.startPoint.copy(this._raycaster.ray.intersectPlane(fe.dragPlane, pt) ? pt : center)
    this._controls.enabled = false
    this._updateFaceExtrudeStatus()
    this._updateMobileToolbar()
  }

  _applyFaceExtrude() {
    const { face, savedCorners, normal, dist } = this._faceExtrude
    this._activeObj.extrudeFace(face, savedCorners, normal, dist)
    this._meshView.updateGeometry(this._corners)
    this._meshView.setFaceHighlight(face.index, this._corners)
    const currentFaceCorners = face.vertices.map(v => v.position)
    const { spanMid, armDir } = this._meshView.setExtrusionDisplay(savedCorners, currentFaceCorners)
    const labelPos = spanMid.clone().addScaledVector(armDir, 0.25)
    const screen = this._projectToScreen(labelPos)
    this._uiView.setExtrusionLabel(`D ${Math.abs(dist).toFixed(3)}`, screen.x, screen.y)
    this._updateNPanel()
  }

  _applyFaceExtrudeFromInput() {
    this._faceExtrude.snapping = false
    const parsed = parseFloat(this._faceExtrude.inputStr)
    if (this._faceExtrude.inputStr && isNaN(parsed)) {
      this._uiView.showToast('Invalid number')
      return
    }
    this._faceExtrude.dist = isNaN(parsed) ? 0 : parsed
    this._applyFaceExtrude()
  }

  _confirmFaceExtrude() {
    // ── Record undo snapshot (ADR-022 Phase 2) ────────────────────────────
    if (this._scene.activeId) {
      const activeId = this._scene.activeId
      const endCornersMap   = new Map([[activeId, this._corners.map(c => c.clone())]])
      const startCornersMap = new Map([[activeId, this._faceExtrude.allStartCorners]])
      const cmd = createMoveCommand('Face Extrude', startCornersMap, endCornersMap, this._scene, this._service)
      this._commandStack.push(cmd)
    }

    this._faceExtrude.active = false
    this._controls.enabled = true
    this._meshView.clearExtrusionDisplay()
    this._meshView.clearSnapDisplay()
    this._meshView.setFaceHighlight(null, this._corners)
    this._scene.editSelection.clear()
    this._meshView.updateEditSelection(this._scene.editSelection, this._corners)
    this._uiView.clearExtrusionLabel()
    this._updateNPanel()
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
  }

  _cancelFaceExtrude() {
    const { face, savedCorners, normal } = this._faceExtrude
    if (face) {
      this._activeObj.extrudeFace(face, savedCorners, normal, 0)
      this._meshView.updateGeometry(this._corners)
      this._meshView.setFaceHighlight(face.index, this._corners)
    }
    this._faceExtrude.active = false
    this._controls.enabled = true
    this._meshView.clearExtrusionDisplay()
    this._meshView.clearSnapDisplay()
    this._uiView.clearExtrusionLabel()
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
  }

  _updateFaceExtrudeStatus() {
    const fe = this._faceExtrude
    const parts = [
      { text: 'Extrude', bold: true, color: '#ffffff' },
      { text: fe.face?.name ?? '', color: '#4fc3f7' },
    ]
    if (fe.hasInput) {
      parts.push({ text: fe.inputStr + '_', color: '#ffeb3b' })
    } else {
      parts.push({ text: `D: ${fe.dist.toFixed(3)}`, color: '#ffeb3b' })
    }
    if (fe.snapping && fe.snappedTarget) {
      parts.push({ text: `Snap: ${fe.snappedTarget.label}`, bold: true, color: '#ff9800' })
    }
    const hint = window.innerWidth < 768
      ? 'Release to confirm'
      : 'Enter confirm  Esc cancel'
    parts.push({ text: hint, color: '#444' })
    this._uiView.setStatusRich(parts)
  }

  /**
   * Snaps face extrude distance to nearest geometry element projected onto the face normal.
   * @param {number} dist  raw extrude distance
   * @returns {number}  snapped or original distance
   */
  _trySnapFaceExtrude(dist) {
    const fe      = this._faceExtrude
    const center  = fe.savedCorners.reduce((a, c) => a.add(c), new THREE.Vector3()).divideScalar(fe.savedCorners.length)
    const posAfter = center.clone().addScaledVector(fe.normal, dist)

    // Compare snap targets to the mouse cursor, not the face center
    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight

    const geoTargets   = collectSnapTargets(this._scene.objects, 'all', new Set([this._scene.activeId]))
    const worldTargets = collectWorldSnapTargets(posAfter)
    const targets      = [...geoTargets, ...worldTargets]
    fe.snapTargets = targets
    const bestTarget = this._pickBestSnapTarget(targets, mx, my)

    if (bestTarget) {
      fe.snapping      = true
      fe.snappedTarget = bestTarget
      return bestTarget.position.clone().sub(center).dot(fe.normal)
    }
    fe.snapping      = false
    fe.snappedTarget = null
    return dist
  }

  // ─── Geometry snap ─────────────────────────────────────────────────────────

  /**
   * Attempts to snap the grab pivot to the nearest geometry element.
   * Snap candidates: all Vertex positions, Edge midpoints, Face centers.
   * @param {THREE.Vector3} delta  current free delta
   * @returns {THREE.Vector3}  snapped or original delta
   */
  _trySnapToGeometry(delta) {
    const pivotAfter = this._grab.pivot.clone().add(delta)
    const pScreen    = this._projectToScreen(pivotAfter)

    const grabbedIds   = new Set(this._grab.allStartCorners.keys())
    const geoTargets   = collectSnapTargets(this._scene.objects, this._grab.snapMode, grabbedIds)
    const worldTargets = collectWorldSnapTargets(pivotAfter)
    const targets      = [...geoTargets, ...worldTargets]
    this._grab.snapTargets = targets  // cache for candidate display
    const bestTarget = this._pickBestSnapTarget(targets, pScreen.x, pScreen.y)

    if (bestTarget) {
      this._grab.snapping      = true
      this._grab.snappedTarget = bestTarget
      return bestTarget.position.clone().sub(this._grab.pivot)
    }
    this._grab.snapping      = false
    this._grab.snappedTarget = null
    return delta
  }

  // ─── Pivot point selection ─────────────────────────────────────────────────

  _startPivotSelect() {
    if (!this._grab.active || this._grab.pivotSelectMode) return
    // Pivot selection uses Cuboid-specific vertex geometry — skip for non-Cuboid types.
    if (this._activeObj instanceof ImportedMesh || this._activeObj instanceof MeasureLine || this._activeObj instanceof CoordinateFrame) return
    this._grab.startCorners.forEach((c, i) => this._corners[i].copy(c))
    this._meshView.updateGeometry(this._corners)
    this._meshView.updateBoxHelper()
    this._grab.pivotSelectMode = true
    this._grab.pivotMode       = 'all'
    this._grab.hoveredPivotIdx = -1
    this._grab.candidates = getPivotCandidates(this._grab.startCorners)
    this._meshView.showPivotCandidates(this._grab.candidates)
    this._updateGrabStatus()
  }

  /**
   * Filters pivot candidates by sub-element type and refreshes the display.
   * @param {'all'|'vertex'|'edge'|'face'} mode
   */
  _setPivotCandidateMode(mode) {
    this._grab.pivotMode = mode
    const corners = this._grab.startCorners
    const candidates =
      mode === 'vertex' ? getVertexPivotCandidates(corners) :
      mode === 'edge'   ? getEdgePivotCandidates(corners)   :
      mode === 'face'   ? getFacePivotCandidates(corners)   :
                          getPivotCandidates(corners)
    this._grab.candidates      = candidates
    this._grab.hoveredPivotIdx = -1
    this._meshView.showPivotCandidates(candidates)
    this._meshView.setHoveredPivot(null)
    this._updateGrabStatus()
  }

  _updatePivotHover() {
    const SNAP_PX = 30
    let minDist    = Infinity
    let closestIdx = -1
    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight
    this._grab.candidates.forEach((c, i) => {
      const ndc = c.position.clone().project(this._camera)
      const sx  = (ndc.x + 1) / 2 * innerWidth
      const sy  = (-ndc.y + 1) / 2 * innerHeight
      const d   = Math.hypot(sx - mx, sy - my)
      if (d < minDist) { minDist = d; closestIdx = i }
    })
    if (minDist <= SNAP_PX && closestIdx >= 0) {
      this._grab.hoveredPivotIdx = closestIdx
      const cand = this._grab.candidates[closestIdx]
      this._meshView.setHoveredPivot(cand)
      this._uiView.setStatusRich([
        { text: 'Pivot', color: '#aaa' },
        { text: cand.label, bold: true, color: '#ffeb3b' },
      ])
    } else {
      this._grab.hoveredPivotIdx = -1
      this._meshView.setHoveredPivot(null)
      this._uiView.setStatusRich([
        { text: 'Select Pivot', bold: true, color: '#e8e8e8' },
        { text: 'Click to confirm', color: '#aaa' },
        { text: 'Esc to cancel', color: '#666' },
      ])
    }
  }

  /**
   * Changes the snap target filter during grab and resets the current snap lock.
   * @param {'all'|'vertex'|'edge'|'face'} mode
   */
  _setSnapMode(mode) {
    this._grab.snapMode      = mode
    this._grab.snapping      = false
    this._grab.snappedTarget = null
    this._meshView.clearSnapLocked()
    this._updateGrabStatus()
  }

  _confirmPivotSelect() {
    const idx = this._grab.hoveredPivotIdx
    if (idx >= 0) {
      const cand = this._grab.candidates[idx]
      this._grab.pivot.copy(cand.position)
      this._grab.pivotLabel = cand.label
      this._restartGrabFromPivot()
      this._grab.autoSnap = true  // auto-snap enabled after pivot selection
    }
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._meshView.clearPivotDisplay()
    this._updateGrabStatus()
  }

  _cancelPivotSelect() {
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._meshView.clearPivotDisplay()
    this._updateGrabStatus()
  }

  _restartGrabFromPivot() {
    const pivot  = this._grab.pivot
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._grab.dragPlane.setFromNormalAndCoplanarPoint(camDir, pivot)
    this._grab.startPoint.copy(pivot)
    this._grab.axis     = null
    this._grab.inputStr = ''
    this._grab.hasInput = false
    this._grab.startMouse.copy(this._mouse)
  }

  // ─── Pointer events (mouse + touch + stylus) ──────────────────────────────
  _onPointerMove(e) {
    // Cancel long-press grab if the finger moved more than 8 px
    if (this._longPress.timer !== null && e.pointerId === this._longPress.pointerId) {
      const dx = e.clientX - this._longPress.startX
      const dy = e.clientY - this._longPress.startY
      if (dx * dx + dy * dy > 64) {
        clearTimeout(this._longPress.timer)
        this._longPress.timer = null
        this._longPress.pointerId = null
      }
    }

    // During a drag, only process the pointer that started it
    if (this._activeDragPointerId !== null && e.pointerId !== this._activeDragPointerId) return
    this._updateMouse(e)

    if (this._rotate.active) {
      this._applyRotate()
      this._updateNPanel()
      return
    }

    if (this._grab.active) {
      if (this._grab.pivotSelectMode) {
        this._updatePivotHover()
        return
      }
      this._applyGrab()
      if (this._grab.autoSnap) {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._meshView.showSnapCandidates(this._filterNearbySnapTargets(this._grab.snapTargets))
        if (this._grab.snapping && this._grab.snappedTarget) {
          this._meshView.clearSnapNearest()
          this._meshView.showSnapLocked(
            this._grab.snappedTarget.position,
            this._grab.snappedTarget.type,
            this._grab.pivot,
          )
        } else {
          this._meshView.clearSnapLocked()
          const nearest = this._findNearestSnapCandidate(this._grab.snapTargets, mx, my)
          if (nearest) this._meshView.showSnapNearest(nearest.position, nearest.type)
          else         this._meshView.clearSnapNearest()
        }
      } else {
        this._meshView.clearSnapDisplay()
      }
      this._updateGrabStatus()
      this._updateNPanel()
      return
    }

    // ── 2D Map Mode: pan or drawing hover ────────────────────────────────
    if (this._mapMode.active) {
      if (this._mapMode.isPanning && this._mapMode.panStart) {
        const { frustumSize } = this._mapMode
        const aspect = innerWidth / innerHeight
        const dx = (e.clientX - this._mapMode.panStart.screenX) * (frustumSize * aspect / innerWidth)
        const dy = (e.clientY - this._mapMode.panStart.screenY) * (frustumSize / innerHeight)
        this._sceneView.panOrthoCamera(
          this._mapMode.panStart.camX - dx,
          this._mapMode.panStart.camY + dy,
        )
        return
      }
      // Only update preview in drawing state; pending state shows frozen dashed preview
      if (this._mapMode.tool && this._mapMode.drawState === 'drawing') {
        const pt = this._mapPickPoint(e)
        this._mapMode.cursor = pt
        this._updateMapPreview()
      }
      return
    }

    // ── Measure placement hover ───────────────────────────────────────────
    if (this._measure.active) {
      const pt = this._measurePickPoint()
      if (pt) {
        this._measure.p2 = pt
        // Show snap candidates via snapMeshView (a real MeshView, not MeasureLineView)
        const smv = this._measure.snapMeshView
        if (smv) {
          const mx = (this._mouse.x + 1) / 2 * innerWidth
          const my = (-this._mouse.y + 1) / 2 * innerHeight
          smv.showSnapCandidates(this._filterNearbySnapTargets(this._measure.snapTargets))
          if (this._measure.snapping && this._measure.snappedTarget) {
            smv.clearSnapNearest()
            smv.showSnapLocked(
              this._measure.snappedTarget.position,
              this._measure.snappedTarget.type,
              pt,
            )
          } else {
            smv.clearSnapLocked()
            const nearest = this._findNearestSnapCandidate(this._measure.snapTargets, mx, my)
            if (nearest) smv.showSnapNearest(nearest.position, nearest.type)
            else         smv.clearSnapNearest()
          }
        }
        // Phase 2: draw preview line
        if (this._measure.p1) {
          this._updateMeasurePreview(this._measure.p1, pt)
        }
      }
      this._updateMeasureStatus()
      return
    }

    if (this._scene.selectionMode === 'object') {
      if (this._rectSel.active) {
        this._rectSel.currentPx = { x: e.clientX, y: e.clientY }
        this._updateRectSelDisplay()
        return
      }
      if (this._objDragging) {
        if (this._objCtrlDrag) {
          const angle = (e.clientX - this._objRotateStartX) * 0.01
          const quat  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
          this._objRotateStartCorners.forEach((c, i) => {
            this._corners[i].copy(c).sub(this._objRotateCentroid).applyQuaternion(quat).add(this._objRotateCentroid)
          })
          this._meshView.updateGeometry(this._corners)
          if (this._objSelected) this._meshView.updateBoxHelper()
        } else {
          this._raycaster.setFromCamera(this._mouse, this._camera)
          const pt = new THREE.Vector3()
          if (this._raycaster.ray.intersectPlane(this._objDragPlane, pt)) {
            const delta = pt.clone().sub(this._objDragStart)
            // Apply delta to all selected objects
            for (const [id, startCorners] of this._objDragAllStartCorners) {
              const selObj = this._scene.getObject(id)
              if (selObj) selObj.move(startCorners, delta)
            }
            // Stack snap: after XY movement, adjust Z so the object rests on
            // the highest surface directly below it (same logic as _grab path).
            if (this._grab.stackMode) this._applyStackSnap()
            // Update geometry for all dragged objects
            for (const [id] of this._objDragAllStartCorners) {
              const selObj = this._scene.getObject(id)
              if (selObj) {
                selObj.meshView.updateGeometry(selObj.corners)
                selObj.meshView.updateBoxHelper()
              }
            }
          }
        }
        this._updateNPanel()
      } else {
        this._uiView.setCursor((this._hitAnyObject() || this._hitAnyAnnotation()) ? 'pointer' : 'default')
      }
      return
    }

    // ── Edit mode · 2D sketch ─────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-sketch') {
      if (this._sketch.drawing) {
        const pt = new THREE.Vector3()
        this._raycaster.setFromCamera(this._mouse, this._camera)
        if (this._raycaster.ray.intersectPlane(this._groundPlane, pt)) {
          this._sketch.p2 = pt.clone()
          this._meshView.showSketchRect(this._sketch.p1, this._sketch.p2)
        }
      }
      return
    }

    // ── Edit mode · 2D extrude ────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-extrude') {
      if (!this._extrudePhase.hasInput) {
        const pt = new THREE.Vector3()
        this._raycaster.setFromCamera(this._mouse, this._camera)
        if (this._raycaster.ray.intersectPlane(this._extrudePhase.dragPlane, pt)) {
          this._extrudePhase.height = pt.z - this._extrudePhase.startPoint.z
        }
      }
      this._applyExtrudePreview()
      this._updateExtrudePhaseStatus()
      return
    }

    // ── Face extrude mode (E key) ─────────────────────────────────────────
    if (this._faceExtrude.active) {
      if (this._faceExtrude.hasInput) return
      this._raycaster.setFromCamera(this._mouse, this._camera)
      const pt = new THREE.Vector3()
      if (!this._raycaster.ray.intersectPlane(this._faceExtrude.dragPlane, pt)) return
      const rawDist = pt.clone().sub(this._faceExtrude.startPoint).dot(this._faceExtrude.normal)
      this._faceExtrude.dist = this._trySnapFaceExtrude(rawDist)
      this._applyFaceExtrude()
      // snap visuals
      const fe = this._faceExtrude
      const mx = (this._mouse.x + 1) / 2 * innerWidth
      const my = (-this._mouse.y + 1) / 2 * innerHeight
      this._meshView.showSnapCandidates(this._filterNearbySnapTargets(fe.snapTargets))
      if (fe.snapping && fe.snappedTarget) {
        this._meshView.clearSnapNearest()
        const faceCenterAfter = fe.savedCorners
          .reduce((a, c) => a.add(c), new THREE.Vector3())
          .divideScalar(fe.savedCorners.length)
          .addScaledVector(fe.normal, fe.dist)
        this._meshView.showSnapLocked(fe.snappedTarget.position, fe.snappedTarget.type, faceCenterAfter)
      } else {
        this._meshView.clearSnapLocked()
        const nearest = this._findNearestSnapCandidate(fe.snapTargets, mx, my)
        if (nearest) this._meshView.showSnapNearest(nearest.position, nearest.type)
        else         this._meshView.clearSnapNearest()
      }
      this._updateFaceExtrudeStatus()
      return
    }

    // ── Hover detection per sub-element mode ──────────────────────────────
    if (this._editSelectMode === 'face') {
      const hit  = this._hitFace()
      const face = hit?.face ?? null
      if (face !== this._hoveredFace) {
        this._hoveredFace = face
        this._meshView.setFaceHighlight(face?.index ?? null, this._corners)
        if (face) {
          const hasSel = [...this._scene.editSelection].some(x => x instanceof Face)
          this._uiView.setStatusRich([
            { text: 'Face', color: '#888' },
            { text: face.name, color: '#e8e8e8' },
            { text: hasSel ? 'E to extrude' : 'Click to select', color: '#555' },
          ])
        } else {
          this._refreshEditModeStatus()
        }
        this._uiView.setCursor(face ? 'pointer' : 'default')
      }
      return
    }

    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight

    if (this._editSelectMode === 'vertex') {
      const v = this._findNearestVertex(mx, my)
      if (v !== this._hoveredVertex) {
        this._hoveredVertex = v
        if (v) {
          this._meshView.showVertexHover(v)
          this._uiView.setStatusRich([
            { text: 'Vertex', bold: true, color: '#69f0ae' },
            { text: 'Click to select', color: '#555' },
          ])
          this._uiView.setCursor('pointer')
        } else {
          this._meshView.clearVertexHover()
          this._refreshEditModeStatus()
          this._uiView.setCursor('default')
        }
      }
      return
    }

    if (this._editSelectMode === 'edge') {
      const e = this._findNearestEdge(mx, my)
      if (e !== this._hoveredEdge) {
        this._hoveredEdge = e
        if (e) {
          this._meshView.showEdgeHover(e)
          this._uiView.setStatusRich([
            { text: 'Edge', bold: true, color: '#ffd740' },
            { text: 'Click to select', color: '#555' },
          ])
          this._uiView.setCursor('pointer')
        } else {
          this._meshView.clearEdgeHover()
          this._refreshEditModeStatus()
          this._uiView.setCursor('default')
        }
      }
    }
  }

  _onPointerDown(e) {
    // Ignore secondary touches while an edit drag is already active
    if (this._activeDragPointerId !== null && e.pointerType === 'touch') {
      // Second finger while rect selection is active: cancel rect sel so
      // OrbitControls can handle the two-finger orbit/dolly gesture.
      if (this._rectSel.active) {
        this._rectSel.active = false
        this._rectSelEl.style.display = 'none'
        this._activeDragPointerId = null
      }
      return
    }

    // Only process events that target the canvas. Toolbar button taps are
    // handled by the buttons' own click listeners, not via pointer events.
    // Without this guard, button taps trigger _handleEditClick which clears
    // face selection before the button's click handler fires (e.g. Extrude).
    if (e.target !== this._sceneView.renderer.domElement) return

    // Update _mouse from the event immediately after the canvas guard.
    // On touch devices pointermove does not fire before the first pointerdown,
    // so _mouse would otherwise hold a stale (or zero) position. Every
    // subsequent handler that calls _mapPickPoint() / _raycaster depends on
    // an up-to-date _mouse — calling _updateMouse here covers all of them.
    this._updateMouse(e)

    if (this._rotate.active) {
      if (e.button === 0) { this._confirmRotate(); return }
      if (e.button === 2) { this._cancelRotate();  return }
      return
    }

    // ── Mount target selection (ADR-032 Phase H-6, Mobile) ────────────────
    if (this._mountPicking.active) {
      if (e.button === 2 || e.pointerType === 'touch') {
        // Right-click or empty-tap cancels
        const hit = this._hitAnyEntityForLink()
        if (hit) {
          const hitObj = this._scene.getObject(hit.obj.id)
          if (hitObj instanceof CoordinateFrame) {
            this._confirmMountAnnotation(this._mountPicking.sourceId, hit.obj.id)
          } else if (hitObj instanceof Solid) {
            this._uiView.showToast('Add a frame to this object first', { type: 'warn' })
          } else {
            this._cancelMountPicking()
          }
        } else {
          this._cancelMountPicking()
        }
        return
      }
      if (e.button === 0) {
        const hit = this._hitAnyEntityForLink()
        if (hit) {
          const hitObj = this._scene.getObject(hit.obj.id)
          if (hitObj instanceof CoordinateFrame) {
            this._confirmMountAnnotation(this._mountPicking.sourceId, hit.obj.id)
          } else if (hitObj instanceof Solid) {
            this._uiView.showToast('Add a frame to this object first', { type: 'warn' })
          } else {
            this._cancelMountPicking()
          }
        } else {
          this._cancelMountPicking()
        }
        return
      }
      return
    }

    // ── SpatialLink target selection (ADR-030 Phase 4) ─────────────────────
    if (this._spatialLinkMode.active) {
      if (e.button === 2) { this._cancelSpatialLinkCreation(); return }
      if (e.button === 0) {
        const hit = this._hitAnyEntityForLink()
        if (hit) {
          this._showLinkTypePicker(e.clientX, e.clientY, hit.obj.id)
        } else {
          this._cancelSpatialLinkCreation()
        }
        return
      }
      return
    }

    if (this._grab.active) {
      if (this._grab.pivotSelectMode) {
        if (e.button === 0) { this._confirmPivotSelect(); return }
        if (e.button === 2) { this._cancelPivotSelect();  return }
        return
      }
      if (e.button === 0) {
        if (e.pointerType === 'touch') {
          // On touch: checkpoint the current position as the start of a new drag
          // segment, then track the pointer. Grab stays active until Confirm is pressed.
          this._grab.segmentStartCorners = new Map()
          for (const id of this._selectedIds) {
            const selObj = this._scene.getObject(id)
            if (selObj) this._grab.segmentStartCorners.set(id, _grabHandlesOf(selObj).map(c => c.clone()))
          }
          this._grab.startCorners = this._corners.map(c => c.clone())
          const grabCenter = (this._activeObj instanceof CoordinateFrame)
            ? (this._service.worldPoseOf(this._activeObj.id)?.position?.clone() ?? getCentroid(this._corners))
            : getCentroid(this._corners)
          this._grab.centroid.copy(grabCenter)
          this._grab.pivot.copy(grabCenter)
          const camDir = new THREE.Vector3()
          this._camera.getWorldDirection(camDir)
          this._grab.dragPlane.setFromNormalAndCoplanarPoint(camDir, grabCenter)
          this._raycaster.setFromCamera(this._mouse, this._camera)
          const _segPt = new THREE.Vector3()
          if (this._raycaster.ray.intersectPlane(this._grab.dragPlane, _segPt)) {
            this._grab.startPoint.copy(_segPt)
          } else {
            this._grab.startPoint.copy(grabCenter)
          }
          this._grab.startMouse.copy(this._mouse)
          this._activeDragPointerId = e.pointerId
          return
        }
        this._confirmGrab()
        return
      }
      if (e.button === 2) { this._cancelGrab();  return }
      return
    }

    if (this._faceExtrude.active) {
      if (e.button === 0) {
        // Don't confirm immediately — let pointermove update the distance,
        // then confirm on pointerup. This allows touch-drag to set distance.
        this._activeDragPointerId = e.pointerId
        return
      }
      if (e.button === 2) { this._cancelFaceExtrude(); return }
      return
    }

    // ── 2D Map Mode: drawing clicks and pan start ────────────────────────
    if (this._mapMode.active) {
      // Pan: middle button OR left button with no tool selected
      if (e.button === 1 || (e.button === 0 && !this._mapMode.tool)) {
        this._mapMode.isPanning = true
        const cam = this._sceneView.activeCamera
        this._mapMode.panStart = {
          screenX: e.clientX, screenY: e.clientY,
          camX: cam.position.x, camY: cam.position.y,
        }
        this._uiView.setCursor('grabbing')
        this._activeDragPointerId = e.pointerId
        return
      }

      if (e.button === 0 && this._mapMode.tool) {
        const { drawState } = this._mapMode

        // In pending state: LMB on canvas confirms (keyboard-free fallback)
        if (drawState === 'pending') {
          this._mapConfirmDrawing()
          return
        }

        const pt       = this._mapPickPoint(e)
        const geometry = this._geometryForType(this._mapMode.tool)

        if (this._isMapMobile()) {
          // ── Mobile: single drag gesture for all types (ADR-031 §2) ──────
          // Record drag start; interaction completes on pointerup.
          this._mapMode.mobileDragStart = { pt: pt.clone(), screenX: e.clientX, screenY: e.clientY }
          this._mapMode.cursor          = pt.clone()
          this._activeDragPointerId     = e.pointerId
          this._updateMapPreview()
          return
        }

        // ── PC interaction ───────────────────────────────────────────────
        if (geometry === 'point') {
          // Single click → enter pending immediately
          this._enterMapPendingState([pt])
          return
        }

        if (geometry === 'region') {
          // Drag-to-rectangle: record drag start; pointerup enters pending
          this._mapMode.mobileDragStart = { pt: pt.clone(), screenX: e.clientX, screenY: e.clientY }
          this._mapMode.cursor          = pt.clone()
          this._activeDragPointerId     = e.pointerId
          const typeLabel = this._placeTypeForType(this._mapMode.tool)
          this._uiView.setStatusRich([
            { text: typeLabel, bold: true, color: '#80cbc4' },
            { text: 'drag to draw rectangle', color: '#888' },
            { text: '  ESC cancel', color: '#444' },
          ])
          return
        }

        // Line (PC): each click adds a vertex; Enter/RMB transitions to pending
        this._mapMode.points.push(pt.clone())
        this._mapMode.cursor = pt.clone()
        this._updateMapPreview()
        this._updateMapStatus()
        return
      }

      if (e.button === 2 && this._mapMode.tool) {
        const { drawState, points, tool: currentTool } = this._mapMode
        if (drawState === 'pending') {
          // RMB in pending → cancel back to drawing (re-select same tool)
          this._mapCancelDrawing()
          if (currentTool) this._setMapTool(currentTool)
          return
        }
        // RMB in drawing: for PC Line with ≥2 pts → enter pending; else cancel
        const geometry = this._geometryForType(this._mapMode.tool)
        if (geometry === 'line' && points.length >= 2) {
          this._enterMapPendingState(points)
        } else {
          this._mapCancelDrawing()
        }
        return
      }
      return
    }

    // ── Measure placement clicks ──────────────────────────────────────────
    if (this._measure.active) {
      if (e.button === 2) { this._cancelMeasure(); return }
      if (e.button === 0) {
        // Hold to snap, release to confirm — handled in _onPointerUp.
        // This lets mobile users slide their finger to the snap target before lifting.
        this._measure.pressing = true
        this._activeDragPointerId = e.pointerId
        return
      }
      return
    }

    if (e.button !== 0) return

    // ── 2D extrude height drag ────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-extrude') {
      this._activeDragPointerId = e.pointerId
      return
    }

    // ── Sketch drawing ────────────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-sketch') {
      const pt = new THREE.Vector3()
      this._raycaster.setFromCamera(this._mouse, this._camera)
      if (this._raycaster.ray.intersectPlane(this._groundPlane, pt)) {
        this._sketch.drawing = true
        this._sketch.p1 = pt.clone()
        this._sketch.p2 = pt.clone()
        this._controls.enabled = false
        this._activeDragPointerId = e.pointerId
      }
      return
    }

    if (this._scene.selectionMode === 'object') {
      // If TC gizmo is active, check if this pointer hits a gizmo handle BEFORE
      // doing regular object selection. Without this guard, the ray passes through
      // TC handles (rotate ring, translate arrows) and hits objects behind them,
      // causing an unintended active-object switch and mode change.
      // Example: tapping the TC rotate ring hits the Cuboid behind it →
      //   _switchActiveObject(cuboid) → _attachMobileTransform(cuboid) → tc.setMode('translate')
      // TC registers its own pointer listeners after _onPointerDown, so _tcDragging
      // is still false at this point — we must raycast against the gizmo explicitly.
      if (this._tc?.object) {
        this._raycaster.setFromCamera(this._mouse, this._camera)
        const tcHits = this._raycaster.intersectObject(this._tc.getHelper(), true)
        if (tcHits.length > 0) return
      }

      // Primary cuboid hit; fall back to annotation entity bounding-box hit.
      let result = this._hitAnyObject()
      if (!result) result = this._hitAnyAnnotation()
      if (result) {
        const { hit, obj } = result
        if (!this._selectedIds.has(obj.id)) {
          // Clicked an unselected object — clear previous selection, select only this
          this._clearObjectSelection()
          if (obj.id !== this._scene.activeId) {
            this._switchActiveObject(obj.id, true)
          } else if (!this._objSelected) {
            this._setObjectSelected(true)
          }
          this._selectedIds.add(obj.id)
        } else {
          // Clicked an already-selected object — keep all selected, update active
          if (obj.id !== this._scene.activeId) {
            this._service.setActiveObject(obj.id)
            this._objSelected = true
            this._refreshObjectModeStatus()
            this._updateNPanel()
          }
        }

        // MeasureLine, CoordinateFrame, and annotation entities cannot be pointer-dragged
        // (use G key to move them after selecting).
        if (obj instanceof MeasureLine || obj instanceof CoordinateFrame ||
            obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint) {
          return
        }

        if (e.pointerType === 'touch') {
          // On touch, single-finger drag always orbits.
          // A long press (≥ 400 ms, < 8 px movement) on a selected object
          // opens a context menu with common actions (Grab, Duplicate, Delete, Rename).
          if (this._objSelected && this._selectedIds.has(obj.id)) {
            this._longPress.pointerId = e.pointerId
            this._longPress.startX    = e.clientX
            this._longPress.startY    = e.clientY
            this._longPress.timer = setTimeout(() => {
              this._longPress.timer = null
              if (this._longPress.pointerId === e.pointerId) {
                this._longPress.pointerId = null
                this._showLongPressContextMenu(
                  this._longPress.startX,
                  this._longPress.startY,
                  obj,
                )
              }
            }, 400)
          }
          return
        }

        // Snapshot corners of every selected object for this drag (mouse only)
        this._objDragAllStartCorners = new Map()
        for (const id of this._selectedIds) {
          const selObj = this._scene.getObject(id)
          // CoordinateFrame uses localOffset (not corners); exclude it from mouse-drag
          // (frames are moved via G-key grab only — PHILOSOPHY #21 Phase 3).
          if (selObj && !(selObj instanceof CoordinateFrame))
            this._objDragAllStartCorners.set(id, selObj.corners.map(c => c.clone()))
        }

        this._objDragging      = true
        // Ctrl+drag (rotate) only works for locally-editable objects (Cuboid).
        this._objCtrlDrag      = e.ctrlKey && !(obj instanceof ImportedMesh) && !(obj instanceof MeasureLine) && !(obj instanceof CoordinateFrame)
        this._controls.enabled = false
        this._activeDragPointerId = e.pointerId
        this._uiView.setCursor('grabbing')

        const camDir = new THREE.Vector3()
        this._camera.getWorldDirection(camDir)
        this._objDragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
        this._objDragStart.copy(hit.point)
        this._objDragStartCorners = this._corners.map(c => c.clone())

        if (e.ctrlKey) {
          this._objRotateStartX = e.clientX
          this._objRotateCentroid.copy(getCentroid(this._corners))
          this._objRotateStartCorners = this._corners.map(c => c.clone())
        }
      } else {
        // No object hit — start rectangle selection (mouse only).
        // On touch, empty-space drag is orbit via OrbitControls.
        if (e.pointerType === 'touch') return
        // Do NOT disable _controls here: orbit (right-click / two-finger) uses
        // separate buttons/fingers and must remain available simultaneously.
        this._rectSel.active    = true
        this._rectSel.startPx   = { x: e.clientX, y: e.clientY }
        this._rectSel.currentPx = { x: e.clientX, y: e.clientY }
        this._activeDragPointerId = e.pointerId
      }
      return
    }

    // ── Edit mode: click to select sub-elements ───────────────────────────
    // Refresh hover state for touch (pointermove may not fire before pointerdown on touch devices)
    if (this._scene.editSubstate === '3d') {
      if (this._editSelectMode === 'face') {
        const hit = this._hitFace()
        this._hoveredFace = hit?.face ?? null
        this._meshView.setFaceHighlight(this._hoveredFace?.index ?? null, this._corners)
      } else if (this._editSelectMode === 'vertex') {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._hoveredVertex = this._findNearestVertex(mx, my)
      } else if (this._editSelectMode === 'edge') {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._hoveredEdge = this._findNearestEdge(mx, my)
      }
    }
    this._handleEditClick(e.shiftKey)

    // Mobile: auto-start face extrude immediately after a face tap, so the
    // user can drag to set the distance without pressing the Extrude button.
    // (Only fires when a face was selected without Shift — not for multi-select.)
    if (window.matchMedia('(pointer: coarse)').matches &&
        this._scene.editSubstate === '3d' &&
        this._editSelectMode === 'face' &&
        !e.shiftKey) {
      const faces = [...this._scene.editSelection].filter(x => x instanceof Face)
      if (faces.length > 0) {
        this._startFaceExtrude(faces[0])
        this._activeDragPointerId = e.pointerId
      }
    }
  }

  _onPointerUp(e) {
    if (e.button !== 0) return

    // Cancel long-press timer on release (quick tap — don't start Grab)
    if (this._longPress.timer !== null && e.pointerId === this._longPress.pointerId) {
      clearTimeout(this._longPress.timer)
      this._longPress.timer = null
      this._longPress.pointerId = null
    }

    // ── 2D Map Mode: end panning on pointer up ────────────────────────────
    if (this._mapMode.active && this._mapMode.isPanning) {
      if (this._activeDragPointerId === e.pointerId) {
        this._activeDragPointerId = null
        this._mapMode.isPanning   = false
        this._mapMode.panStart    = null
        this._uiView.setCursor(this._mapMode.tool ? 'crosshair' : 'default')
      }
      return
    }

    // ── 2D Map Mode: drag gesture completion (mobile + PC Region) ─────────
    if (this._mapMode.active && this._mapMode.mobileDragStart &&
        this._activeDragPointerId === e.pointerId) {
      const { pt: startPt, screenX: sx, screenY: sy } = this._mapMode.mobileDragStart
      this._mapMode.mobileDragStart = null
      this._activeDragPointerId     = null

      const savedTool = this._mapMode.tool
      if (!savedTool) return

      const pt       = this._mapPickPoint(e)
      const geometry = this._geometryForType(savedTool)
      const dx       = e.clientX - sx
      const dy       = e.clientY - sy
      const moved    = Math.hypot(dx, dy)

      if (geometry === 'point') {
        // Point: any tap (no movement threshold) → pending (ADR-031 §2)
        this._enterMapPendingState([startPt])
        return
      }

      if (geometry === 'line') {
        // Line: drag from start to end → 2-point straight line → pending
        // Minimum drag threshold: 8 px screen-space (ADR-031 §2)
        if (moved < 8) {
          this._mapCancelDrawing()
          this._setMapTool(savedTool)
          return
        }
        this._enterMapPendingState([startPt, pt])
        return
      }

      if (geometry === 'region') {
        // Region: drag-to-rectangle → pending
        // Minimum drag threshold: 8 px (ADR-031 §2)
        if (moved < 8) {
          this._mapCancelDrawing()
          this._setMapTool(savedTool)
          return
        }
        const p1 = startPt
        const p2 = this._mapMode.cursor ?? pt
        const rectPts = [
          new THREE.Vector3(p1.x, p1.y, 0),
          new THREE.Vector3(p2.x, p1.y, 0),
          new THREE.Vector3(p2.x, p2.y, 0),
          new THREE.Vector3(p1.x, p2.y, 0),
        ]
        this._enterMapPendingState(rectPts)
        return
      }
      return
    }

    // ── Measure point confirmation (hold-to-snap, release-to-confirm) ─────
    if (this._measure.active && this._measure.pressing) {
      if (this._activeDragPointerId === e.pointerId) {
        this._activeDragPointerId = null
        this._measure.pressing    = false
        this._confirmMeasurePoint()
      }
      return
    }

    // wasDragging: a canvas drag started for this pointer (via _onPointerDown)
    const wasDragging = this._activeDragPointerId === e.pointerId
    if (wasDragging) this._activeDragPointerId = null
    if (this._grab.active) {
      // Touch grab: keep grab active after finger release.
      // The object stays at the dragged position; user confirms via the Confirm button.
      // Multiple drag segments are supported before confirming.
      return
    }
    if (this._faceExtrude.active) {
      // Only confirm when a canvas drag was started; prevents double-confirm
      // when the mobile Confirm toolbar button fires both pointerup and click.
      if (wasDragging) this._confirmFaceExtrude()
      return
    }
    if (this._sketch.drawing) {
      this._sketch.drawing = false
      this._controls.enabled = true
      // Save rect to object
      if (this._sketch.p1 && this._sketch.p2) {
        const obj = this._activeObj
        if (obj) {
          const dx = Math.abs(this._sketch.p2.x - this._sketch.p1.x)
          const dy = Math.abs(this._sketch.p2.y - this._sketch.p1.y)
          if (dx > 0.01 || dy > 0.01) {
            obj.setRect(this._sketch.p1, this._sketch.p2)
            this._uiView.setStatusRich([
              { text: 'Sketch', bold: true, color: '#4fc3f7' },
              { text: 'Press Enter to extrude · Drag to redraw', color: '#888' },
            ])
            this._updateMobileToolbar()
          }
        }
      }
      return
    }
    if (this._rectSel.active) {
      this._rectSel.active = false
      this._rectSelEl.style.display = 'none'
      this._controls.enabled = true
      this._finalizeRectSelection()
      return
    }
    if (this._objDragging) {
      this._objDragging  = false
      this._objCtrlDrag  = false
      this._controls.enabled = true
      this._activeDragPointerId = null
      this._uiView.setCursor(this._hitAnyObject() ? 'pointer' : 'default')
      this._updateNPanel()
    }
  }

  _onKeyUp(e) {
    if (e.key === 'Control') {
      this._ctrlHeld = false
      if (this._grab.active && !this._grab.pivotSelectMode) this._updateGrabStatus()
      if (this._faceExtrude.active) this._updateFaceExtrudeStatus()
      if (this._rotate.active && !this._rotate.hasInput) {
        this._applyRotate()
        this._updateRotateStatus()
      }
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Control') {
      this._ctrlHeld = true
      if (this._rotate.active && !this._rotate.hasInput) {
        this._applyRotate()
        this._updateRotateStatus()
      }
    }

    // ── Undo / Redo (ADR-022) ──────────────────────────────────────────────
    // Intercept Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z before any operation-specific
    // key handlers so they don't mis-fire as grab-axis or rotate-axis keys.
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault()
      if (!this._grab.active && !this._rotate.active && !this._faceExtrude.active) {
        const isUndo = e.key === 'z' && !e.shiftKey
        if (isUndo) {
          const cmd = this._commandStack.undo()
          if (cmd) this._uiView.showToast(`Undo: ${cmd.label}`)
        } else {
          const cmd = this._commandStack.redo()
          if (cmd) this._uiView.showToast(`Redo: ${cmd.label}`)
        }
        this._refreshUndoRedoState()
        this._syncMobileTransformProxy()
      }
      return
    }

    // ── Ctrl+E: export scene JSON ─────────────────────────────────────────
    if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault()
      this._exportSceneJson()
      return
    }

    // ── Ctrl+I: import scene JSON ─────────────────────────────────────────
    if (e.ctrlKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault()
      this._triggerImportSceneJson()
      return
    }

    // ── Keys active during rotate (CoordinateFrame R key, ADR-019) ────────
    if (this._rotate.active) {
      switch (e.key) {
        case 'x': case 'X': this._setRotateAxis('x'); return
        case 'y': case 'Y': this._setRotateAxis('y'); return
        case 'z': case 'Z': this._setRotateAxis('z'); return
        case 'Enter':  this._confirmRotate(); return
        case 'Escape': this._cancelRotate();  return
      }
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        this._rotate.inputStr += e.key
        this._rotate.hasInput  = true
        this._applyRotate()
        this._updateRotateStatus()
        return
      }
      if (e.key === '-' && this._rotate.inputStr.length === 0) {
        this._rotate.inputStr = '-'
        this._rotate.hasInput = true
        this._updateRotateStatus()
        return
      }
      if (e.key === 'Backspace') {
        this._rotate.inputStr = this._rotate.inputStr.slice(0, -1)
        this._rotate.hasInput = this._rotate.inputStr.length > 0 && this._rotate.inputStr !== '-'
        this._applyRotate()
        this._updateRotateStatus()
        return
      }
      return
    }

    // ── Keys active during grab ────────────────────────────────────────────
    if (this._grab.active) {
      if (this._grab.pivotSelectMode) {
        if (e.key === 'Escape') this._cancelPivotSelect()
        if (e.key === '1') { this._setPivotCandidateMode('vertex'); return }
        if (e.key === '2') { this._setPivotCandidateMode('edge');   return }
        if (e.key === '3') { this._setPivotCandidateMode('face');   return }
        return
      }
      switch (e.key) {
        case 'v': case 'V': this._startPivotSelect(); return
        case 'x': case 'X': this._setGrabAxis('x'); return
        case 'y': case 'Y': this._setGrabAxis('y'); return
        case 'z': case 'Z': this._setGrabAxis('z'); return
        case 's': case 'S': this._toggleStackMode(); return
        case 'Enter':        this._confirmGrab();    return
        case 'Escape':       this._cancelGrab();     return
        case '1': this._setSnapMode('vertex'); return
        case '2': this._setSnapMode('edge');   return
        case '3': this._setSnapMode('face');   return
      }
      if (this._grab.axis) {
        if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
          this._grab.inputStr += e.key
          this._grab.hasInput  = true
          this._applyGrab()
          this._updateGrabStatus()
          return
        }
        if (e.key === '-' && this._grab.inputStr.length === 0) {
          this._grab.inputStr = '-'
          this._grab.hasInput = true
          this._updateGrabStatus()
          return
        }
        if (e.key === 'Backspace') {
          this._grab.inputStr = this._grab.inputStr.slice(0, -1)
          this._grab.hasInput = this._grab.inputStr.length > 0 && this._grab.inputStr !== '-'
          this._applyGrab()
          this._updateGrabStatus()
          return
        }
      }
      return
    }

    // ── 2D Map Mode keys ────────────────────────────────────────────────────
    if (this._mapMode.active) {
      const { drawState, tool } = this._mapMode

      if (e.key === 'Escape') {
        if (drawState === 'pending') {
          // ESC in pending → cancel back to drawing with empty points
          const savedTool = tool
          this._mapCancelDrawing()
          if (savedTool) this._setMapTool(savedTool)
        } else if (tool) {
          this._mapCancelDrawing()   // cancel drawing, stay in map mode
        } else {
          this._exitMapMode()        // exit map mode entirely
        }
        return
      }

      if (e.key === 'Enter' && tool) {
        if (drawState === 'pending') {
          // Enter in pending → confirm the entity
          this._mapConfirmDrawing()
        } else {
          // Enter in drawing → transition to pending if enough points (PC Line)
          const geometry = this._geometryForType(tool)
          const n        = this._mapMode.points.length
          if (geometry === 'line' && n >= 2) {
            this._enterMapPendingState(this._mapMode.points)
          }
          // Region + Point enter pending via gesture (pointerup), not Enter key
        }
        return
      }
      return
    }

    // ── Measure placement keys ─────────────────────────────────────────────
    if (this._measure.active) {
      if (e.key === 'Escape') { this._cancelMeasure(); return }
      return
    }

    // ── SpatialLink creation keys (ADR-030 Phase 4) ────────────────────────
    if (this._spatialLinkMode.active) {
      if (e.key === 'Escape') { this._cancelSpatialLinkCreation(); return }
      return  // consume all other keys during link mode
    }

    // ── Mount picking keys (ADR-032 Phase H-5) ─────────────────────────────
    if (this._mountPicking.active) {
      if (e.key === 'Escape') { this._cancelMountPicking(); return }
      return  // consume all other keys during mount picking
    }

    // ── Sketch phase keys ──────────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-sketch') {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (this._sketch.p1 && this._sketch.p2) {
          const dx = Math.abs(this._sketch.p2.x - this._sketch.p1.x)
          const dy = Math.abs(this._sketch.p2.y - this._sketch.p1.y)
          if (dx > 0.01 || dy > 0.01) this._enterExtrudePhase()
        }
        return
      }
      if (e.key === 'Escape') { this.setMode('object'); return }
      return
    }

    // ── Extrude-from-sketch phase keys ─────────────────────────────────────
    if (this._scene.editSubstate === '2d-extrude') {
      if (e.key === 'Enter') { e.preventDefault(); this._confirmExtrudePhase(); return }
      if (e.key === 'Escape') { this._cancelExtrudePhase(); return }
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        this._extrudePhase.inputStr += e.key
        this._extrudePhase.hasInput = true
        this._applyExtrudePreview()
        this._updateExtrudePhaseStatus()
        return
      }
      if (e.key === '-' && this._extrudePhase.inputStr.length === 0) {
        this._extrudePhase.inputStr = '-'
        this._extrudePhase.hasInput = true
        this._updateExtrudePhaseStatus()
        return
      }
      if (e.key === 'Backspace') {
        this._extrudePhase.inputStr = this._extrudePhase.inputStr.slice(0, -1)
        this._extrudePhase.hasInput = this._extrudePhase.inputStr.length > 0 && this._extrudePhase.inputStr !== '-'
        this._applyExtrudePreview()
        this._updateExtrudePhaseStatus()
        return
      }
      return
    }

    // ── Face extrude keys (Edit Mode · 3D) ────────────────────────────────
    if (this._faceExtrude.active) {
      if (e.key === 'Enter')  { e.preventDefault(); this._confirmFaceExtrude(); return }
      if (e.key === 'Escape') { this._cancelFaceExtrude(); return }
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        this._faceExtrude.inputStr += e.key
        this._faceExtrude.hasInput  = true
        this._applyFaceExtrudeFromInput()
        this._updateFaceExtrudeStatus()
        return
      }
      if (e.key === '-' && this._faceExtrude.inputStr.length === 0) {
        this._faceExtrude.inputStr = '-'
        this._faceExtrude.hasInput = true
        this._updateFaceExtrudeStatus()
        return
      }
      if (e.key === 'Backspace') {
        this._faceExtrude.inputStr = this._faceExtrude.inputStr.slice(0, -1)
        this._faceExtrude.hasInput = this._faceExtrude.inputStr.length > 0 && this._faceExtrude.inputStr !== '-'
        this._applyFaceExtrudeFromInput()
        this._updateFaceExtrudeStatus()
        return
      }
      return
    }

    // ── Sub-element mode switching (Edit Mode · 3D only) ──────────────────
    if (this._scene.selectionMode === 'edit' && this._scene.editSubstate === '3d') {
      if (e.key === '1') { this._setEditSelectMode('vertex'); return }
      if (e.key === '2') { this._setEditSelectMode('edge');   return }
      if (e.key === '3') { this._setEditSelectMode('face');   return }
      if ((e.key === 'e' || e.key === 'E') && this._editSelectMode === 'face') {
        const selected = [...this._scene.editSelection].filter(x => x instanceof Face)
        if (selected.length > 0) this._startFaceExtrude(selected[0])
        return
      }
    }

    // ── Normal keys ────────────────────────────────────────────────────────
    if (e.key === 'Tab') {
      e.preventDefault()
      this.setMode(this._scene.selectionMode === 'object' ? 'edit' : 'object')
      return
    }
    if (e.key === 'n' || e.key === 'N') {
      this._toggleNPanel()
      return
    }

    if (this._scene.selectionMode === 'object') {
      // M: start measure placement
      if (e.key === 'm' || e.key === 'M') {
        this._startMeasurePlacement()
        return
      }
      // L: start SpatialLink creation (ADR-030 Phase 4)
      if ((e.key === 'l' || e.key === 'L') && this._objSelected) {
        if (this._activeObj instanceof SpatialLink) {
          this._uiView.showToast('SpatialLink cannot be used as a link source', { type: 'warn' })
          return
        }
        this._startSpatialLinkCreation()
        return
      }
      // Shift+D: duplicate active object and immediately grab (Blender-style)
      if (e.key === 'D' && e.shiftKey && this._objSelected) {
        e.preventDefault()
        this._duplicateObject()
        return
      }
      // G: grab
      if ((e.key === 'g' || e.key === 'G') && this._objSelected) {
        this._startGrab()
        return
      }
      // R: rotate (CoordinateFrame only, ADR-019)
      if ((e.key === 'r' || e.key === 'R') && this._activeObj instanceof CoordinateFrame) {
        this._startRotate()
        return
      }
      // Shift+A: show Add menu
      if (e.key === 'A' && e.shiftKey) {
        e.preventDefault()
        const screenX = (this._mouse.x + 1) / 2 * innerWidth
        const screenY = (-this._mouse.y + 1) / 2 * innerHeight
        const canAddFrame = this._objSelected && !(this._activeObj instanceof MeasureLine) && !(this._activeObj instanceof ImportedMesh)
        this._uiView.showAddMenu(screenX, screenY,
          () => this._addObject('box'),
          () => this._addObject('sketch'),
          () => this._addObject('measure'),
          () => this._triggerStepImport(),
          canAddFrame ? () => this._addObject('frame') : undefined,
        )
        return
      }
      // X / Delete: delete active object
      if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete') && this._objSelected) {
        this._deleteObject(this._scene.activeId)
        return
      }
    }
  }

  // ── BFF + Node Editor initialisation (Phase B, ADR-017) ──────────────────

  /**
   * Initialises BFF connection and opens the WebSocket Geometry Service channel.
   * Called asynchronously from start() — non-blocking; app works without BFF.
   */
  async _initBff() {
    await this._service.connectBff()
    if (!this._service.bffConnected) return

    // Open WebSocket geometry channel
    this._service.openGeometryChannel()

    // Wire up Node Editor
    this._nodeEditorView = new NodeEditorView(document.body, this._service)
    this._uiView.onNodeEditorToggle(() => {
      const visible = this._nodeEditorView.toggle()
      // Visual feedback on header button
      const btn = this._uiView._nodeEditorBtn
      if (btn) btn.style.borderColor = visible ? '#3a7bd5' : '#3a3a3a'
    })

    // Enable Save/Load buttons now that BFF is connected
    this._uiView.enableSaveLoad(
      () => this._saveScene(),
      () => this._loadScene(),
    )
  }

  // ─── Animation loop ────────────────────────────────────────────────────────
  start() {
    const loop = () => {
      requestAnimationFrame(loop)
      this._sceneView.render()
      if (this._gizmoView) this._gizmoView.update()
      // Keep MeasureLine / AnnotatedPoint HTML labels positioned over the correct screen pixel,
      // drive per-element animations, and keep CoordinateFrame axes at constant screen size.
      const t = performance.now() * 0.001  // elapsed seconds for animation clock
      for (const obj of this._scene.objects.values()) {
        if (obj instanceof MeasureLine)     obj.meshView.updateLabelPosition()
        if (obj instanceof AnnotatedPoint)  { obj.meshView.updateLabelPosition(this._sceneView.activeCamera); obj.meshView.tick(t) }
        if (obj instanceof AnnotatedLine)   obj.meshView.tick(t)
        if (obj instanceof AnnotatedRegion) obj.meshView.tick(t)
        if (obj instanceof CoordinateFrame) {
          // Cap the frame's world size so it never visually dwarfs its parent.
          // Compute the parent object's bounding radius (max distance from centroid
          // to any corner) and allow the frame axes to grow to at most 1.5× that.
          // Falls back to Infinity (uncapped) when the parent has no geometry corners
          // (e.g. another CoordinateFrame parent).
          let maxWS = Infinity
          const frameParent = this._scene.getObject(obj.parentId)
          if (frameParent && !(frameParent instanceof CoordinateFrame) && frameParent.corners?.length > 0) {
            const centroid = getCentroid(frameParent.corners)
            let maxR = 0
            for (const c of frameParent.corners) {
              const r = centroid.distanceTo(c)
              if (r > maxR) maxR = r
            }
            if (maxR > 0) maxWS = maxR * 1.5
          }
          obj.meshView.updateScale(this._camera, this._sceneView.renderer, maxWS)
        }
      }
      // Sync CoordinateFrame world poses every frame (ADR-020).
      // SceneService._updateWorldPoses() computes worldPos = parentCentroid + translation
      // in topological order and updates the _worldPoseCache + meshView.updatePosition.
      this._service._updateWorldPoses()
    }
    loop()

    // Show first-run gesture hints on mobile
    this._uiView.showOnboardingIfNeeded()

    // Wire Export / Import JSON buttons
    this._uiView.onExportJson(() => this._exportSceneJson())
    this._uiView.onImportJson(() => this._triggerImportSceneJson())

    // Non-blocking BFF + Node Editor setup (Phase B)
    this._initBff().catch(err => {
      console.warn('[AppController] BFF init failed (offline mode):', err.message)
    })
  }

  // ── Scene JSON export ─────────────────────────────────────────────────────

  /**
   * Serialises the current scene to a JSON file and triggers a browser download.
   * Includes geometry, bounding boxes, face normals, coordinate frames with world
   * poses, measurement distances, and metadata for every scene object.
   */
  _exportSceneJson() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename  = `scene-${timestamp}.json`
    try {
      downloadSceneJson(
        this._scene,
        (id) => this._service.worldPoseOf(id),
        filename,
      )
      this._uiView.showToast(`Exported: ${filename}`)
    } catch (err) {
      console.error('[AppController] Export failed:', err)
      this._uiView.showToast('Export failed', { type: 'error' })
    }
  }

  // ── Scene JSON import ─────────────────────────────────────────────────────

  /**
   * Opens a file picker for .json files, reads the selected file, then shows
   * the import confirmation modal (clear / merge choice).
   * Side-effectful; must only be called from user gestures.
   */
  _triggerImportSceneJson() {
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = '.json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        this._handleImportJsonText(file.name, ev.target.result)
      }
      reader.readAsText(file)
    })
    input.click()
  }

  /**
   * Parses the JSON text and shows the import modal.
   * On confirmation, delegates to SceneService.importFromJson().
   * @param {string} filename
   * @param {string} jsonText
   */
  async _handleImportJsonText(filename, jsonText) {
    let parsed
    try {
      parsed = parseImportJson(jsonText)
    } catch (err) {
      this._uiView.showToast(`Import failed: ${err.message}`, { type: 'error' })
      return
    }

    const choice = await this._uiView.showImportModal(filename)
    if (choice === null) return    // user cancelled

    const viewContext = {
      camera:    this._camera,
      renderer:  this._sceneView.renderer,
      container: document.body,
    }

    try {
      const { imported, skipped } = await this._service.importFromJson(
        parsed,
        viewContext,
        { clear: choice === 'clear' },
      )
      const msg = skipped > 0
        ? `Imported ${imported} objects (${skipped} skipped)`
        : `Imported ${imported} objects`
      this._uiView.showToast(msg)
    } catch (err) {
      console.error('[AppController] Import failed:', err)
      this._uiView.showToast('Import failed', { type: 'error' })
    }
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Returns the mutable handle array used by the grab / move system.
 *
 * - Geometry entities (Solid, Profile, MeasureLine, ImportedMesh, Annotated*):
 *   `obj.corners` — WorldVector3[], positions in world space.
 * - CoordinateFrame: `obj.localOffset` — LocalVector3[], the translation offset
 *   relative to the parent centroid.
 *
 * Using `.corners` on a CoordinateFrame returns undefined (PHILOSOPHY #21 Phase 3).
 * This helper centralises the branching so call sites stay clean.
 *
 * @param {object} obj  scene entity
 * @returns {import('three').Vector3[]}
 */
function _grabHandlesOf(obj) {
  return (obj instanceof CoordinateFrame) ? obj.localOffset : obj.corners
}

/**
 * Returns 8 AABB corners for objects that don't have a `corners` property
 * (e.g. ImportedMesh). Falls back to empty array if bounding box is unavailable.
 * @param {object} obj  scene entity
 * @returns {THREE.Vector3[]}
 */
function _meshBboxCorners(obj) {
  const geo = obj.meshView?.cuboid?.geometry
  if (!geo) return []
  geo.computeBoundingBox()
  const box = geo.boundingBox
  if (!box || box.isEmpty()) return []
  const { min, max } = box
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z),
  ]
}
