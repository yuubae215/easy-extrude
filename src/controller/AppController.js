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
import {
  buildCuboidFromRect,
  computeOutwardFaceNormal,
  getCentroid,
  collectSnapTargets,
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
import { LinkNetworkView } from '../view/LinkNetworkView.js'
import { CommandStack }              from '../service/CommandStack.js'
import { createExtrudeSketchCommand } from '../command/ExtrudeSketchCommand.js'
import { createAddSolidCommand }      from '../command/AddSolidCommand.js'
import { createDeleteCommand }        from '../command/DeleteCommand.js'
import { createRenameCommand }        from '../command/RenameCommand.js'
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
import { createFastenFrameCommand }           from '../command/FastenFrameCommand.js'
import { RoleService }                        from '../service/RoleService.js'
import { StateMachine } from '../core/StateMachine.js'
import {
  S_OBJECT_IDLE, S_GRAB_ACTIVE, S_ROTATE_ACTIVE,
  S_FACE_EXTRUDE, S_MEASURE_PLACING, S_LINK_MODE,
  S_FRAME_PLACEMENT, S_MOUNT_PICKING,
  S_QUICK_DRAG, S_RECT_SELECT,
  EO_IDLE, EO_1D_DRAG, EO_2D_SKETCH_DRAW,
} from '../core/editorStates.js'
import { EndpointDragState } from '../core/states/EndpointDragState.js'
import { SketchDrawState }   from '../core/states/SketchDrawState.js'
import { QuickDragState }    from '../core/states/QuickDragState.js'
import { RectSelectState }   from '../core/states/RectSelectState.js'
import { inferSemanticRelationships } from '../service/SemanticInferencer.js'
import { SpatialLinkView, LINK_TYPE_COLORS } from '../view/SpatialLinkView.js'
import { RotateSectorPreview }        from '../view/RotateSectorPreview.js'
import { RippleEffect }               from '../view/RippleEffect.js'
import { MapModeController }          from './map/MapModeController.js'
import { ContextDemoController }      from './ContextDemoController.js'
import { useUIStore }                 from '../store/uiStore.js'
import { RotationHandler }            from './handler/RotationHandler.js'
import { GrabOperationHandler }       from './handler/GrabOperationHandler.js'
import { MeasurePlacementHandler }    from './handler/MeasurePlacementHandler.js'
import { LinkCreationHandler }        from './handler/LinkCreationHandler.js'
import { FaceExtrudeHandler }         from './handler/FaceExtrudeHandler.js'
import { FramePlacementHandler }         from './handler/FramePlacementHandler.js'
import { EditModeSelectionHandler }      from './handler/EditModeSelectionHandler.js'
import { ContextMenuHandler }            from './handler/ContextMenuHandler.js'
import { SelectionManager }             from './SelectionManager.js'
import { UIStateManager }               from './UIStateManager.js'
import {
  projectToScreen,
  filterNearbySnapTargets,
  findNearestSnapCandidate,
} from './snap/SnapSystem.js'
import { HitTestService } from './HitTestService.js'

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Returns the set of valid link options for a given source/target entity pair.
 * Each option carries jointType (URDF kinematic), semanticType (domain annotation),
 * and a display label. Based on ADR-038 validation table.
 *
 * @param {object|null} source
 * @param {object|null} target
 * @returns {{ jointType: string|null, semanticType: string, label: string }[]}
 */
function _computeLinkOptions(source, target) {
  const isAnnotated = o => o instanceof AnnotatedLine || o instanceof AnnotatedRegion || o instanceof AnnotatedPoint
  const isCF = o => o instanceof CoordinateFrame

  const options = []

  // ── Kinematic (fixed joint) options ──────────────────────────────────────
  if (isCF(source) && isCF(target)) {
    options.push({ jointType: 'fixed', semanticType: 'fastened', label: 'Fixed · Fastened' })
    options.push({ jointType: 'fixed', semanticType: 'aligned',  label: 'Fixed · Aligned' })
  }
  if (isAnnotated(source) && isCF(target)) {
    options.push({ jointType: 'fixed', semanticType: 'mounts',   label: 'Fixed · Mounts' })
  }

  // ── Topological / semantic annotation options ─────────────────────────────
  if (source instanceof AnnotatedRegion) {
    options.push({ jointType: null, semanticType: 'contains',  label: 'Contains' })
  }
  if (source instanceof AnnotatedLine) {
    if (source.placeType === 'Route' && target instanceof AnnotatedPoint && target.placeType === 'Hub') {
      // Tact-time constrained route connections (deadline + speed stored in properties).
      options.push({ jointType: null, semanticType: 'connects', label: 'Tact 30 s · 1.5 m/s',  properties: { deadline: 30,  speed: 1.5 } })
      options.push({ jointType: null, semanticType: 'connects', label: 'Tact 60 s · 1.5 m/s',  properties: { deadline: 60,  speed: 1.5 } })
      options.push({ jointType: null, semanticType: 'connects', label: 'Tact 120 s · 1.5 m/s', properties: { deadline: 120, speed: 1.5 } })
    } else {
      options.push({ jointType: null, semanticType: 'connects', label: 'Connects' })
    }
  }
  if ((source instanceof AnnotatedLine || source instanceof AnnotatedRegion) && target instanceof Solid) {
    options.push({ jointType: null, semanticType: 'bounded_by', label: 'Bounded By (500mm)',   properties: { clearance: 500 } })
    options.push({ jointType: null, semanticType: 'bounded_by', label: 'Bounded By (1000mm)',  properties: { clearance: 1000 } })
    options.push({ jointType: null, semanticType: 'bounded_by', label: 'Bounded By (no gap)',  properties: { clearance: 0 } })
  }
  options.push({ jointType: null, semanticType: 'adjacent',   label: 'Adjacent' })
  options.push({ jointType: null, semanticType: 'above',      label: 'Above' })
  // Anchor → CoordinateFrame: tolerance-constrained references presets (ADR-043 Phase 4).
  if (source instanceof AnnotatedPoint && source.placeType === 'Anchor' && isCF(target)) {
    options.push({ jointType: null, semanticType: 'references', label: 'Tolerance ±1 mm',  properties: { tolerance: 1 } })
    options.push({ jointType: null, semanticType: 'references', label: 'Tolerance ±5 mm',  properties: { tolerance: 5 } })
    options.push({ jointType: null, semanticType: 'references', label: 'Tolerance ±10 mm', properties: { tolerance: 10 } })
  } else {
    options.push({ jointType: null, semanticType: 'references', label: 'References' })
  }
  options.push({ jointType: null, semanticType: 'represents', label: 'Represents' })

  return options
}

export class AppController {
  /**
   * @param {import('../view/SceneView.js').SceneView}       sceneView
   * @param {import('../view/UIView.js').UIView}             uiView
   * @param {import('../view/GizmoView.js').GizmoView}       gizmoView
   * @param {import('../view/OutlinerView.js').OutlinerView} outlinerView
   */
  constructor(sceneView, uiView, gizmoView = null, outlinerView = null) {
    this._sceneView          = sceneView
    this._uiView             = uiView
    this._gizmoView          = gizmoView
    this._outlinerView       = outlinerView
    this._rotateSectorPreview = new RotateSectorPreview(sceneView.scene)

    // ── Application service (owns SceneModel aggregate root) ─────────────
    this._service = new SceneService(sceneView.scene)
    this._service.setViewContext({
      camera:    sceneView.camera,
      renderer:  sceneView.renderer,
      container: document.body,
    })

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
    this._service.on('objectRemoved', id => {
      outlinerView?.removeObject(id)
      this._updateLinkNetwork()
    })
    this._service.on('objectRenamed', (id, nm)  => {
      outlinerView?.setObjectName(id, nm)
      if (id === this._scene.activeId && this._scene.selectionMode === 'object') {
        this._refreshObjectModeStatus()
      }
      // Update floating 3D label if entity has one (CoordinateFrame, AnnotatedPoint)
      const renamedObj = this._scene.getObject(id)
      renamedObj?.meshView?.setLabelText?.(nm)
      renamedObj?.meshView?.setName?.(nm)
      this._updateLinkNetwork()
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
      this._updateLinkNetwork()
    })
    this._service.on('spatialLinkRemoved', () => {
      // Refresh all badges — a removal may drop an entity's link count to 0
      for (const obj of this._scene.objects.values()) {
        this._refreshLinkBadge(obj.id)
      }
      if (this._activeObj) this._updateNPanel()
      this._updateLinkNetwork()
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
    this._service.on('constraintCycleDetected', () => {
      this._uiView.showToast('Constraint cycle detected — some fastened links are inactive', { type: 'warn' })
    })
    this._service.on('anchorToleranceConflict', ({ cfIds }) => {
      this._uiView.showToast(`Anchor conflict: ${cfIds.size} frame(s) constrained by multiple Anchors with different tolerances`, { type: 'warn' })
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

    // ── Measure placement handler (delegated to MeasurePlacementHandler) ──
    this._measureHandler  = new MeasurePlacementHandler(this)
    this._measure         = this._measureHandler.state

    // ── SpatialLink creation handler (delegated to LinkCreationHandler) ───
    this._linkHandler     = new LinkCreationHandler(this)
    this._spatialLinkMode = this._linkHandler.state

    // ── Primary operation FSM (ADR-039) ──────────────────────────────────
    // Single source of truth for which Object Mode operation is currently active.
    // Replaces five separate `.active` boolean flags (grab/rotate/faceExtrude/
    // measure/spatialLink). Mutual exclusion is structural: BEGIN_X can only
    // fire from S_OBJECT_IDLE, so two operations can never be active simultaneously.
    this._opState = new StateMachine(S_OBJECT_IDLE, [
      // Grab
      { from: S_OBJECT_IDLE,    on: 'BEGIN_GRAB',          to: S_GRAB_ACTIVE },
      { from: S_GRAB_ACTIVE,    on: 'CONFIRM',              to: S_OBJECT_IDLE },
      { from: S_GRAB_ACTIVE,    on: 'CANCEL',               to: S_OBJECT_IDLE },
      // Rotate
      { from: S_OBJECT_IDLE,    on: 'BEGIN_ROTATE',         to: S_ROTATE_ACTIVE },
      { from: S_ROTATE_ACTIVE,  on: 'CONFIRM',              to: S_OBJECT_IDLE },
      { from: S_ROTATE_ACTIVE,  on: 'CANCEL',               to: S_OBJECT_IDLE },
      // Face Extrude (Edit Mode · 3D)
      { from: S_OBJECT_IDLE,    on: 'BEGIN_FACE_EXTRUDE',   to: S_FACE_EXTRUDE },
      { from: S_FACE_EXTRUDE,   on: 'CONFIRM',              to: S_OBJECT_IDLE },
      { from: S_FACE_EXTRUDE,   on: 'CANCEL',               to: S_OBJECT_IDLE },
      // Measure placement
      { from: S_OBJECT_IDLE,    on: 'BEGIN_MEASURE',        to: S_MEASURE_PLACING },
      { from: S_MEASURE_PLACING, on: 'CONFIRM',             to: S_OBJECT_IDLE },
      { from: S_MEASURE_PLACING, on: 'CANCEL',              to: S_OBJECT_IDLE },
      // Spatial Link creation
      { from: S_OBJECT_IDLE,    on: 'BEGIN_LINK',              to: S_LINK_MODE },
      { from: S_LINK_MODE,      on: 'CONFIRM',                 to: S_OBJECT_IDLE },
      { from: S_LINK_MODE,      on: 'CANCEL',                  to: S_OBJECT_IDLE },
      // Frame placement pick sub-mode (ADR-034 §6)
      { from: S_OBJECT_IDLE,    on: 'BEGIN_FRAME_PLACEMENT',   to: S_FRAME_PLACEMENT },
      { from: S_FRAME_PLACEMENT, on: 'CONFIRM',                to: S_OBJECT_IDLE },
      { from: S_FRAME_PLACEMENT, on: 'CANCEL',                 to: S_OBJECT_IDLE },
      // Mount target picking (ADR-032 Phase H-6, Mobile)
      { from: S_OBJECT_IDLE,    on: 'BEGIN_MOUNT_PICKING',     to: S_MOUNT_PICKING },
      { from: S_MOUNT_PICKING,  on: 'CONFIRM',                 to: S_OBJECT_IDLE },
      { from: S_MOUNT_PICKING,  on: 'CANCEL',                  to: S_OBJECT_IDLE },

      { from: S_OBJECT_IDLE,   on: 'BEGIN_QUICK_DRAG',        to: S_QUICK_DRAG },
      { from: S_QUICK_DRAG,    on: 'CONFIRM',                  to: S_OBJECT_IDLE },
      { from: S_QUICK_DRAG,    on: 'CANCEL',                   to: S_OBJECT_IDLE },

      { from: S_OBJECT_IDLE,   on: 'BEGIN_RECT_SELECT',       to: S_RECT_SELECT },
      { from: S_RECT_SELECT,   on: 'CONFIRM',                  to: S_OBJECT_IDLE },
      { from: S_RECT_SELECT,   on: 'CANCEL',                   to: S_OBJECT_IDLE },
    ])

    // ── Mount picking state (ADR-032 Phase H-6, Mobile) ──────────────────
    // Entered via "Mount on frame ⊕" long-press context menu item.
    // The user taps a CoordinateFrame as the mount target.
    // Active state tracked by this._opState (S_MOUNT_PICKING).
    this._mountPicking = {
      /** @type {string|null} ID of the Annotated* entity to mount */
      sourceId: null,
    }

    // ── 2D Map Mode (delegated to MapModeController) ─────────────────────
    // All map mode state and interaction logic live in MapModeController.
    // AppController accesses map state via this._mapModeCtrl.isActive / .hasTool.
    this._mapModeCtrl = new MapModeController(this)

    // ── Context DSL demo (ADR-046/047, delegated to ContextDemoController) ─
    // Registers its own uiStore callbacks; AppController only ticks it.
    this._demoCtrl = new ContextDemoController(this)

    // ── Sketch drawing state (Edit Mode · 2D) ──────────────────────────────
    // drawing flag removed — EO_2D_SKETCH_DRAW state in _editOpState is the authority.
    // p1/p2 are kept here (vs. inside SketchDrawState) so _enterExtrudePhase can read them.
    this._sketch = {
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
    this._objCtrlDrag           = false  // true during Ctrl+drag rotate within S_QUICK_DRAG
    this._objDragPlane          = new THREE.Plane()
    this._objDragStart          = new THREE.Vector3()
    this._objDragStartCorners   = []
    /** @type {Map<string, import('three').Vector3[]>} corners snapshot for each selected object at drag start */
    this._objDragAllStartCorners = new Map()
    /** @type {Map<string, import('three').Vector3>} Solid._position snapshot at mouse-drag start (ADR-040) */
    this._objDragAllStartPositions = new Map()
    this._objRotateStartX           = 0
    this._objRotateCentroid         = new THREE.Vector3()
    this._objRotateStartCorners     = []
    /** ADR-040: orientation snapshot for Solid ctrl+drag rotate. @type {import('three').Quaternion|null} */
    this._objRotateStartOrientation = null
    /** ADR-040: _position snapshot for Solid ctrl+drag rotate. @type {import('three').Vector3|null} */
    this._objRotateStartPos         = null

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
    /** @type {number|null} Hovered endpoint index (0 or 1) in 1D Edit Mode */
    this._hoveredEndpointIndex = null

    // ── Edit Mode operation FSM + handler (ADR-039 follow-up) ────────────
    // Mirrors _opState but scoped to Edit Mode. Currently covers 1D endpoint
    // drag; structured for future edit-mode operations (vertex grab, etc.).
    this._editOpState = new StateMachine(EO_IDLE, [
      { from: EO_IDLE,           on: 'BEGIN_1D_DRAG',    to: EO_1D_DRAG },
      { from: EO_1D_DRAG,        on: 'CONFIRM',          to: EO_IDLE },
      { from: EO_1D_DRAG,        on: 'CANCEL',           to: EO_IDLE },

      { from: EO_IDLE,           on: 'BEGIN_2D_SKETCH',  to: EO_2D_SKETCH_DRAW },
      { from: EO_2D_SKETCH_DRAW, on: 'CONFIRM',          to: EO_IDLE },
      { from: EO_2D_SKETCH_DRAW, on: 'CANCEL',           to: EO_IDLE },
    ])
    this._endpointDragHandler  = new EndpointDragState()
    this._sketchDrawHandler    = new SketchDrawState()
    this._quickDragHandler     = new QuickDragState()
    /** @type {import('../view/SpatialLinkView.js').SpatialLinkView|null} Ghost link during drag suggestion */
    this._ghostLinkView        = null
    /** @type {import('../view/RippleEffect.js').RippleEffect[]} Active link-acceptance ripple animations */
    this._activeRipples        = []
    this._rectSelHandler       = new RectSelectState()

    // ── Face extrude handler (delegated to FaceExtrudeHandler) ──────────────
    this._faceExtrudeHandler = new FaceExtrudeHandler(this)
    this._faceExtrude        = this._faceExtrudeHandler.state

    // ── Blender-style grab state ───────────────────────────────────────────
    this._grabHandler = new GrabOperationHandler(this)

    /** Unsubscribe function for the active import.progress WS listener, or null */
    this._importProgressUnsub = null

    /**
     * Set of CoordinateFrame IDs currently visible because of frame-chain selection.
     * Cleared by _hideFrameChain(). Used to restore correct visibility on deselect.
     * @type {Set<string>}
     */
    this._activeFrameChain = new Set()

    // ── Mobile axis guide (replaces TransformControls on touch devices) ──────
    /** THREE.Line for the world-axis guide shown during axis-constrained grab. @type {THREE.Line|null} */
    this._axisGuideLine = null
    /** THREE.LineLoop for the gimbal ring shown during axis-constrained rotate. @type {THREE.Line|null} */
    this._axisGuideRing = null

    // ── CoordinateFrame / Solid rotate state (R key, ADR-019 Phase B / ADR-036) ─
    this._rotateHandler = new RotationHandler(this)

    this._ctrlHeld  = false

    this._raycaster = new THREE.Raycaster()
    this._mouse     = new THREE.Vector2()

    // ── Hit-testing (raycasting utilities) ───────────────────────────────────
    this._hitTest = new HitTestService(this)

    // ── Edit mode sub-element selection ──────────────────────────────────────
    this._editSelHandler = new EditModeSelectionHandler(this)

    // ── Object selection + frame-chain visibility ─────────────────────────────
    this._selMgr = new SelectionManager(this)
    this._uiStateMgr = new UIStateManager(this)
    this._contextMenuHandler = new ContextMenuHandler(this)

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

    // ── CoordinateFrame placement handler (delegated to FramePlacementHandler) ─
    this._framePlacementHandler = new FramePlacementHandler(this)
    this._framePlacementState   = this._framePlacementHandler.state

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
      // translation is already in parent-local space (ROS TF) — set directly
      frame.translation[axis] = val
      this._service.invalidateWorldPose(frame.id)
      const newWorldPos = this._service.worldPoseOf(frame.id)?.position
      if (newWorldPos) frame.meshView.updatePosition(newWorldPos)
    })
    uiView.onFrameRotationChange((axis, val) => {
      const frame = this._activeObj
      if (!(frame instanceof CoordinateFrame) || frame.name === 'Origin') return
      if (this._rotateHandler.isFastenedRotationBlocked(frame)) return
      // rotation is already in parent-local space (ROS TF) — edit directly
      const localEuler = new THREE.Euler().setFromQuaternion(frame.rotation, 'ZYX')
      localEuler[axis] = THREE.MathUtils.degToRad(val)
      frame.rotation.setFromEuler(localEuler)
      const parentWorldQuat = this._service._getParentWorldQuat(frame)
      frame.meshView.updateRotation(parentWorldQuat.clone().multiply(frame.rotation))
      this._service.invalidateWorldPose(frame.id)
    })
    uiView.onLocationChange((axis, val) => {
      const obj = this._activeObj
      if (!obj || typeof obj.move !== 'function') return
      const corners = this._corners
      if (!corners.length) return
      const delta = new THREE.Vector3()
      if (obj instanceof Solid) {
        // ADR-040: use _position directly — getCentroid(corners) introduces FP rounding
        // that feeds back into _position each call (PHILOSOPHY #24 manifestation c).
        delta[axis] = val - obj._position[axis]
        obj.move(obj._position.clone(), delta)
      } else {
        const currentCentroid = getCentroid(corners)
        delta[axis] = val - currentCentroid[axis]
        const startCorners = corners.map(c => c.clone())
        obj.move(startCorners, delta)
      }
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
        uiView.showBackdrop(() => { outlinerView.closeDrawer(); uiView.hideBackdrop() })
      }
    })

    uiView.onNPanelToggle(() => {
      if (outlinerView?.isDrawerOpen) {
        outlinerView.closeDrawer()
        uiView.hideBackdrop()
      }
      this._toggleNPanel()
      if (uiView.nPanelVisible) {
        uiView.showBackdrop(() => { this._toggleNPanel(); uiView.hideBackdrop() })
      } else {
        uiView.hideBackdrop()
      }
    })

    uiView.onUndoClick(() => {
      if (this._opState.is(S_GRAB_ACTIVE) || this._opState.is(S_ROTATE_ACTIVE) || this._opState.is(S_FACE_EXTRUDE)) return
      const cmd = this._commandStack.undo()
      if (cmd) this._uiView.showToast(`Undo: ${cmd.label}`)
      this._refreshUndoRedoState()
    })
    uiView.onRedoClick(() => {
      if (this._opState.is(S_GRAB_ACTIVE) || this._opState.is(S_ROTATE_ACTIVE) || this._opState.is(S_FACE_EXTRUDE)) return
      const cmd = this._commandStack.redo()
      if (cmd) this._uiView.showToast(`Redo: ${cmd.label}`)
      this._refreshUndoRedoState()
    })

    // ── Map Mode entry ────────────────────────────────────────────────────
    uiView.onMapModeClick(() => this._mapModeCtrl.enter())

    // ── CF Link Network Overlay ───────────────────────────────────────────
    this._linkNetworkView = new LinkNetworkView(id => this._switchActiveObject(id, true))
    this._linkNetworkView.setMobile(window.matchMedia('(pointer: coarse)').matches)

    // ── Gizmo right-edge occupancy ────────────────────────────────────────
    // The gizmo offset is owned by _updateGizmoOffset() alone (PHILOSOPHY #4);
    // it tracks every right-edge panel (N panel, Context Inspector) through
    // a single store subscription instead of per-toggle call sites.
    useUIStore.subscribe((s, prev) => {
      if (s.nPanelVisible !== prev.nPanelVisible ||
          s.demo.active !== prev.demo.active ||
          s.demo.inspectorTab !== prev.demo.inspectorTab) {
        this._updateGizmoOffset()
      }
    })

    this._bindEvents()
    this._initMobileAxisGuide()

    // Create the initial object
    this._addObject()
    this.setMode('object')
    // The initial solid creation must not be undoable — the user has done nothing yet.
    this._commandStack.clear()

    // Expose console API for role-based provenance (ADR-034 §8.3)
    // + Context DSL demo entry (ADR-047)
    window.__easyExtrude = {
      setRole:     (role) => RoleService.setRole(role),
      getRole:     ()     => RoleService.getRole(),
      demoContext: ()     => this._demoCtrl.enter(),
    }
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

  /** Minimal context object passed to Edit Mode operation state handlers. */
  get _editCtx() {
    return {
      obj:                   this._activeObj,
      camera:                this._camera,
      mouse:                 this._mouse,
      raycaster:             this._raycaster,
      controls:              this._controls,
      commandStack:          this._commandStack,
      scene:                 this._scene,
      sceneService:          this._service,
      // Extended for SketchDrawState:
      groundPlane:           this._groundPlane,
      sketch:                this._sketch,
      meshView:              this._meshView,
      uiView:                this._uiView,
      onMobileToolbarUpdate: () => this._updateMobileToolbar(),
    }
  }

  get _quickDragCtx() {
    return {
      controls: this._controls,
      uiView:   this._uiView,
      applyMove: (e) => {
        if (this._objCtrlDrag) {
          const angle = (e.clientX - this._objRotateStartX) * 0.01
          const quat  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
          const obj   = this._activeObj
          if (obj instanceof Solid && this._objRotateStartOrientation) {
            obj.rotate(this._objRotateStartOrientation, this._objRotateStartPos, this._objRotateCentroid, quat)
            obj.meshView.updateGeometry(obj.corners)
          } else {
            this._objRotateStartCorners.forEach((c, i) => {
              this._corners[i].copy(c).sub(this._objRotateCentroid).applyQuaternion(quat).add(this._objRotateCentroid)
            })
            this._meshView.updateGeometry(this._corners)
          }
          if (this._objSelected) this._meshView.updateBoxHelper()
        } else {
          this._raycaster.setFromCamera(this._mouse, this._camera)
          const pt = new THREE.Vector3()
          if (this._raycaster.ray.intersectPlane(this._objDragPlane, pt)) {
            const delta = pt.clone().sub(this._objDragStart)
            const _qdTension = this._service.getLinkDragTension()
            if (_qdTension > 0) delta.multiplyScalar(Math.max(0.15, 1.0 - Math.min(_qdTension, 1.0) * 0.85))
            this._service.applyPreviewTranslation(
              this._objDragAllStartCorners,
              this._objDragAllStartPositions,
              delta,
            )
            if (this._grabHandler.stackMode) {
              this._grabHandler._applyStackSnap(this._objDragAllStartPositions, delta)
              for (const [id] of this._objDragAllStartCorners) {
                const selObj = this._scene.getObject(id)
                if (selObj) {
                  selObj.meshView.updateGeometry(selObj.corners)
                  selObj.meshView.updateBoxHelper()
                }
              }
            }
          }
        }
      },
      finish: () => {
        this._uiView.setCursor(this._hitTest.hitAnyObject() ? 'pointer' : 'default')
        this._updateNPanel()
      },

      // ── Live semantic inference during drag (ADR-041 Phase 2) ────────────

      runInference: () => {
        if (this._selectedIds.size !== 1) return null
        const [movedId] = this._selectedIds
        const moved = this._scene.getObject(movedId)
        if (!(moved instanceof Solid)) return null
        const existingPairs = new Set(
          this._service.getLinks().map(l => `${l.sourceId}|${l.targetId}`),
        )
        const suggestions = inferSemanticRelationships(
          moved, this._scene.objects.values(), existingPairs,
        )
        return suggestions.length > 0 ? suggestions[0] : null
      },

      showDragSuggestion: (suggestion) => {
        if (this._ghostLinkView) {
          this._ghostLinkView.dispose(this._sceneView.scene)
          this._ghostLinkView = null
        }
        const srcPos = this._dragSuggestionCentroid(suggestion.sourceId)
        const tgtPos = this._dragSuggestionCentroid(suggestion.targetId)
        if (!srcPos || !tgtPos) return
        this._ghostLinkView = new SpatialLinkView(
          this._sceneView.scene, srcPos, tgtPos, suggestion.semanticType,
        )
        this._ghostLinkView.setHighlighted(true)
        this._uiView.showDragSuggestionTooltip(suggestion)
      },

      updateDragSuggestion: (suggestion) => {
        if (!this._ghostLinkView) return
        const srcPos = this._dragSuggestionCentroid(suggestion.sourceId)
        const tgtPos = this._dragSuggestionCentroid(suggestion.targetId)
        if (srcPos && tgtPos) this._ghostLinkView.update(srcPos, tgtPos)
      },

      hideDragSuggestion: () => {
        if (this._ghostLinkView) {
          this._ghostLinkView.dispose(this._sceneView.scene)
          this._ghostLinkView = null
        }
        this._uiView.hideDragSuggestionTooltip()
      },

      // Confirm the drag and immediately create the inferred SpatialLink.
      // Sets _activeDragPointerId=null so the subsequent pointerup is a no-op.
      acceptSuggestion: (suggestion) => {
        this._objCtrlDrag = false
        this._quickDragHandler.confirm(this._quickDragCtx)
        this._opState.send('CONFIRM')
        this._activeDragPointerId = null
        this._service.setLinkDragging(new Set(), false)
        this._service.updateLinkSelectionHighlight(this._selectedIds)
        this._linkHandler.createDirect(suggestion.sourceId, suggestion.targetId, suggestion)
      },
    }
  }

  get _rectSelCtx() {
    return {
      controls:      this._controls,
      rectSel:       this._rectSel,
      rectSelEl:     this._rectSelEl,
      updateDisplay: () => this._selMgr.updateRectSelDisplay(),
      finalize:      () => this._selMgr.finalizeRectSelection(),
    }
  }

  /**
   * Returns the world-space centroid of an entity by id.
   * For Solid uses _position (authoritative ADR-040 primary triple).
   * For other entities (e.g. AnnotatedRegion) uses avg(corners).
   * Read-only display only — never feed this back into physics or state.
   * @param {string} id
   * @returns {import('three').Vector3|null}
   */
  _dragSuggestionCentroid(id) {
    const obj = this._scene.getObject(id)
    if (!obj) return null
    if (obj instanceof Solid) return obj._position.clone()
    const cs = obj.corners
    if (!cs || cs.length === 0) return null
    const sum = new THREE.Vector3()
    for (const c of cs) sum.add(c)
    return sum.divideScalar(cs.length)
  }

  /**
   * Projects a world-space position to CSS pixel coordinates.
   * @param {import('three').Vector3} position
   * @param {import('three').Camera} [camera]
   * @returns {{ x: number, y: number }}
   */
  _projectToScreen(position, camera = this._camera) {
    const v = position.clone().project(camera)
    return {
      x: (v.x + 1) / 2 * innerWidth,
      y: (-v.y + 1) / 2 * innerHeight,
    }
  }

  /**
   * Runs semantic inference after a grab/drag confirms, showing a SpatialLink
   * suggestion banner when the moved Solid lands near another object (ADR-041).
   */
  _runSemanticInference() {
    if (this._selectedIds.size !== 1) return
    const [movedId] = this._selectedIds
    const moved = this._scene.getObject(movedId)
    if (!(moved instanceof Solid)) return

    const existingPairs = new Set(
      this._service.getLinks().map(l => `${l.sourceId}|${l.targetId}`),
    )
    const suggestions = inferSemanticRelationships(
      moved, this._scene.objects.values(), existingPairs,
    )
    if (suggestions.length === 0) return

    const top    = suggestions[0]
    const source = this._scene.getObject(top.sourceId)
    const target = this._scene.getObject(top.targetId)
    this._uiView.showSemanticSuggestion({
      sourceId:     top.sourceId,
      targetId:     top.targetId,
      semanticType: top.semanticType,
      label:        top.label,
      sourceName:   source?.name ?? '?',
      targetName:   target?.name ?? '?',
    }, () => {
      this._quickDragCtx.hideDragSuggestion()
      this._linkHandler.createDirect(top.sourceId, top.targetId, top)
    })
  }

  /**
   * Duplicates the active Solid, makes the copy active, and immediately
   * starts a grab so the user can position it (Blender Shift+D behaviour).
   */
  _duplicateObject() {
    const id = this._scene.activeId
    if (!id) return
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
    this._grabHandler.start()
  }

  /**
   * Deletes an entity by id with all safety guards (Origin frame protection,
   * minimum geometry count, provenance check, dangling-link confirmation).
   * @param {string} id
   */
  _deleteObject(id) {
    const target = this._scene.getObject(id)
    if (!target) return

    if (target instanceof CoordinateFrame && target.name === 'Origin') {
      this._uiView.showToast('Origin frame cannot be deleted', { type: 'warn' })
      return
    }

    if (!(target instanceof CoordinateFrame)) {
      const geometryCount = [...this._scene.objects.values()]
        .filter(o => !(o instanceof CoordinateFrame)).length
      if (geometryCount <= 1) {
        this._uiView.showToast('Scene must contain at least one object', { type: 'warn' })
        return
      }
    }

    if (target instanceof CoordinateFrame && !RoleService.canEdit(target)) {
      this._uiView.showToast(
        `This frame was declared by a ${target.declaredBy}. Switch to that role to edit it.`,
        { type: 'warn' },
      )
      return
    }

    if (target instanceof CoordinateFrame) {
      const links = this._service.getLinksOf(id)
      if (links.length > 0) {
        const n = links.length
        this._uiView.showConfirmDialog(
          `Frame "${target.name}" is referenced by ${n} spatial link${n > 1 ? 's' : ''}.\n` +
          `Deleting it will leave those links dangling. Delete anyway?`,
          (confirmed) => { if (confirmed) this._execDeleteObject(id, target) },
          { title: 'Delete Frame', confirmLabel: 'Delete', danger: true },
        )
        return
      }
    }

    this._execDeleteObject(id, target)
  }

  /** Performs the actual soft-delete after all guards in _deleteObject have passed. */
  _execDeleteObject(id, target) {
    if (!target) target = this._scene.getObject(id)
    if (!target) return

    if (id === this._scene.activeId && this._scene.selectionMode === 'edit') {
      this.setMode('object')
    }

    const wasActive = this._scene.activeId === id

    if (wasActive && target instanceof CoordinateFrame && this._activeFrameChain.size > 0) {
      this._selMgr.hideFrameChain()
    }
    if (wasActive && !(target instanceof CoordinateFrame)) {
      this._selMgr.setChildFramesVisible(id, false)
    }

    const nextId = wasActive
      ? (
          [...this._scene.objects.entries()].find(
            ([k, o]) => k !== id && !(o instanceof CoordinateFrame),
          )?.[0]
          ?? [...this._scene.objects.keys()].find(k => k !== id)
          ?? null
        )
      : null

    const childrenRefs = [...this._selMgr.collectAllDescendantFrames(id)]
      .map(fid => this._scene.getObject(fid)).filter(Boolean)

    for (let i = childrenRefs.length - 1; i >= 0; i--) {
      this._service.detachObject(childrenRefs[i].id)
    }
    this._service.detachObject(id)
    target.meshView.setVisible(false)

    const cmd = createDeleteCommand(
      target, childrenRefs, this._service,
      (restoredId) => this._switchActiveObject(restoredId, true),
      (deletedId) => {
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

  // ─── Object management ────────────────────────────────────────────────────

  /**
   * Adds a new object of the given type.
   * @param {'box'|'sketch'|'measure'|'frame'} [type='box']
   */
  _addObject(type = 'box') {
    if (type === 'sketch')  { this._addProfileObject();    return }
    if (type === 'measure') { this._measureHandler.start(); return }
    if (type === 'frame')   { this._addCoordinateFrame();  return }

    // Exit Edit Mode cleanly before adding, so the previous object's visual state is cleared
    if (this._scene.selectionMode === 'edit') this.setMode('object')

    const obj = this._service.createSolid()

    // ── Record undo snapshot (ADR-022 Phase 3) ────────────────────────────
    const childrenRefs = [...this._selMgr.collectAllDescendantFrames(obj.id)]
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
   * Begins the CoordinateFrame placement pick sub-mode (ADR-034 §6).
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
    this._framePlacementHandler.start(parentId)
  }

  _setObjectVisible(id, visible) {
    this._service.setObjectVisible(id, visible)
  }

  _renameObject(id, name) {
    const oldName = this._scene.getObject(id)?.name
    if (!oldName || oldName === name) return
    const obj = this._scene.getObject(id)
    // Origin frames are the body frame — renaming would strip protection (ADR-037)
    if (obj instanceof CoordinateFrame && obj.name === 'Origin') {
      this._uiView.showToast('Origin frame cannot be renamed', { type: 'warn' })
      return
    }
    // Provenance check for CoordinateFrame (ADR-034 §8.2)
    if (obj instanceof CoordinateFrame && !RoleService.canEdit(obj)) {
      this._uiView.showToast(`This frame was declared by a ${obj.declaredBy}. Switch to that role to edit it.`, { type: 'warn' })
      return
    }
    this._service.renameObject(id, name)
    if (id === this._scene.activeId) this._updateNPanel()
    // ── Record undo snapshot (ADR-022 Phase 4) ────────────────────────────
    const cmd = createRenameCommand(id, oldName, name, this._service)
    this._commandStack.push(cmd)
  }

  /** Toggles N panel visibility (gizmo offset follows via the store subscription) */
  _toggleNPanel() {
    this._uiView.toggleNPanel()
    this._updateNPanel()
  }

  /**
   * Repositions the world gizmo left of whichever right-edge panels are open.
   * Sole owner of the gizmo right offset — driven by the uiStore subscription
   * registered in the constructor; never call setRightOffset() elsewhere.
   * Desktop only: on mobile the N panel is a drawer and the demo inspector is hidden.
   */
  _updateGizmoOffset() {
    if (!this._gizmoView) return
    const mobile = window.innerWidth < 768
    const s = useUIStore.getState()
    const inspectorOpen = !mobile && s.demo.active && !!s.demo.inspectorTab   // 280px (ADR-047)
    const nPanelOpen    = !mobile && s.nPanelVisible                          // 200px
    this._gizmoView.setRightOffset(16 + (nPanelOpen ? 200 : 0) + (inspectorOpen ? 280 : 0))
  }

  /** Called when user clicks a row in the outliner */
  _onOutlinerSelect(id) {
    // During link creation: treat the clicked row as the target entity
    if (this._opState.is(S_LINK_MODE)) {
      if (id !== this._spatialLinkMode.sourceId) {
        this._linkHandler.showTypePicker(window.innerWidth / 2, window.innerHeight / 2, id)
      }
      return  // don't change active selection while in link mode
    }
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    if (id !== this._scene.activeId) {
      this._switchActiveObject(id, true)
    } else {
      // Clicking the already-active row just re-selects it
      this._selMgr.setObjectSelected(true)
    }
  }

  // ── Mobile axis guide ─────────────────────────────────────────────────────

  /**
   * Creates 3D axis guide visuals: a colored line (translate) and a gimbal ring
   * (rotate).  Both are invisible until _showAxisGuide() is called.
   * Called once at construction time.
   */
  _initMobileAxisGuide() {
    const lineGeom = new THREE.BufferGeometry()
    lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 })
    this._axisGuideLine = new THREE.Line(lineGeom, lineMat)
    this._axisGuideLine.visible = false
    this._axisGuideLine.renderOrder = 999
    this._sceneView.scene.add(this._axisGuideLine)

    const SEG = 64
    const pts = new Float32Array((SEG + 1) * 3)
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * Math.PI * 2
      pts[i * 3] = Math.cos(t); pts[i * 3 + 1] = Math.sin(t); pts[i * 3 + 2] = 0
    }
    const ringGeom = new THREE.BufferGeometry()
    ringGeom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    const ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 })
    this._axisGuideRing = new THREE.Line(ringGeom, ringMat)
    this._axisGuideRing.visible = false
    this._axisGuideRing.renderOrder = 999
    this._sceneView.scene.add(this._axisGuideRing)
  }

  /**
   * @param {'x'|'y'|'z'} axis
   * @param {THREE.Vector3} center
   * @param {'translate'|'rotate'} mode
   */
  _showAxisGuide(axis, center, mode) {
    const COLORS = { x: 0xe05252, y: 0x6ab04c, z: 0x4a9eed }
    const color = COLORS[axis] ?? 0xffffff
    const camDist = center.distanceTo(this._camera.position)
    const r = Math.max(0.5, camDist * 0.25)

    if (mode === 'translate') {
      const dir = axis === 'x' ? new THREE.Vector3(1, 0, 0)
                : axis === 'y' ? new THREE.Vector3(0, 1, 0)
                :                new THREE.Vector3(0, 0, 1)
      const attr = this._axisGuideLine.geometry.attributes.position
      const p0 = center.clone().addScaledVector(dir, -r * 2.5)
      const p1 = center.clone().addScaledVector(dir,  r * 2.5)
      attr.array[0] = p0.x; attr.array[1] = p0.y; attr.array[2] = p0.z
      attr.array[3] = p1.x; attr.array[4] = p1.y; attr.array[5] = p1.z
      attr.needsUpdate = true
      this._axisGuideLine.material.color.setHex(color)
      this._axisGuideLine.visible = true
      this._axisGuideRing.visible = false
    } else {
      this._axisGuideRing.position.copy(center)
      this._axisGuideRing.scale.setScalar(r)
      if (axis === 'x') {
        this._axisGuideRing.rotation.set(0, Math.PI / 2, 0)
      } else if (axis === 'y') {
        this._axisGuideRing.rotation.set(Math.PI / 2, 0, 0)
      } else {
        this._axisGuideRing.rotation.set(0, 0, 0)
      }
      this._axisGuideRing.material.color.setHex(color)
      this._axisGuideRing.visible = true
      this._axisGuideLine.visible = false
    }
  }

  /** Hides all axis guide visuals. */
  _hideAxisGuide() {
    if (this._axisGuideLine) this._axisGuideLine.visible = false
    if (this._axisGuideRing) this._axisGuideRing.visible = false
  }

  // ── Active object switching ────────────────────────────────────────────────

  /**
   * Switches the active object, updating visual selection, frame visibility,
   * link highlighting, and all UI components.
   * @param {string} id
   * @param {boolean} [select=false]
   */
  _switchActiveObject(id, select = false) {
    if (this._scene.activeId && this._scene.activeId !== id) {
      const prev = this._scene.getObject(this._scene.activeId)
      if (prev) {
        prev.meshView.setObjectSelected(false)
        if (prev instanceof CoordinateFrame) {
          this._selMgr.hideFrameChain()
          prev.meshView.hideParentAxesGhost()
        } else {
          this._selMgr.setChildFramesVisible(this._scene.activeId, false)
        }
      }
    }

    this._service.setActiveObject(id)
    this._objSelected = select
    if (select) {
      this._selectedIds.clear()
      this._selectedIds.add(id)
    }
    this._service.updateLinkSelectionHighlight(select && id ? this._selectedIds : new Set())
    this._linkNetworkView?.setSelection(select && id ? this._selectedIds : new Set())

    const obj = this._scene.getObject(id)
    if (obj) obj.meshView.setObjectSelected(select)
    if (select) {
      if (obj instanceof CoordinateFrame) {
        this._selMgr.showFrameChain(id)
        const ghostPos = this._geometryAncestorCentroid(id)
        if (ghostPos) obj.meshView.showParentAxesGhost(ghostPos)
      } else {
        this._selMgr.setChildFramesVisible(id, true)
      }
    }

    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()
  }

  /**
   * Walks the parentId chain from a CoordinateFrame to find the first
   * non-CF ancestor's world centroid (used for parent axes ghost ADR-034 §7).
   * @param {string} frameId
   * @returns {THREE.Vector3|null}
   */
  _geometryAncestorCentroid(frameId) {
    let obj = this._scene.getObject(frameId)
    while (obj instanceof CoordinateFrame) {
      obj = this._scene.getObject(obj.parentId)
    }
    if (!obj) return null
    const corners = obj.corners
    if (!corners || corners.length === 0) return null
    const centroid = new THREE.Vector3()
    for (const c of corners) centroid.add(c)
    centroid.divideScalar(corners.length)
    return centroid
  }

  // ── Mount picking flow (Mobile, ADR-032 Phase H-6) ────────────────────────

  /** Starts mount-picking mode for the given source Annotated* entity (mobile). */
  _startMountPicking(sourceId) {
    if (!this._opState.send('BEGIN_MOUNT_PICKING')) return
    this._mountPicking.sourceId = sourceId
    this._uiView.setStatus('Tap target frame (or empty space to cancel)  [✕]')
    this._uiView.setCursor('crosshair')
  }

  /** Cancels mount-picking mode and restores normal status. */
  _cancelMountPicking() {
    if (!this._opState.is(S_MOUNT_PICKING)) return
    this._mountPicking.sourceId = null
    this._uiView.setCursor('default')
    this._opState.send('CANCEL')
    this._refreshObjectModeStatus()
  }

  /**
   * Refreshes the outliner link-role badges for an entity.
   * Passes separate source/target flags so the outliner can distinguish
   * which role (child/dependent vs parent/reference) the entity plays.
   * @param {string} entityId
   */
  _refreshLinkBadge(entityId) {
    if (!this._outlinerView) return
    const links = this._service.getLinksOf(entityId)
    const asSource = links.some(l => l.sourceId === entityId)
    const asTarget = links.some(l => l.targetId === entityId)
    this._outlinerView.setObjectLinked(entityId, asSource, asTarget)
    // Also refresh the "unreferenced" badge for CoordinateFrames (ADR-033 Phase C-4)
    const obj = this._scene.getObject(entityId)
    if (obj instanceof CoordinateFrame) {
      this._outlinerView.setFrameUnreferenced(entityId, links.length === 0)
    }
  }

  /** Rebuilds the Link Network Overlay from current scene state. */
  _updateLinkNetwork() {
    if (!this._linkNetworkView) return
    const entityInfos = new Map()
    for (const [id, obj] of this._scene.objects) {
      const type = obj instanceof ImportedMesh    ? 'imported'
        : obj instanceof MeasureLine             ? 'measure'
        : obj instanceof CoordinateFrame         ? 'frame'
        : obj instanceof Profile                 ? 'sketch'
        : obj instanceof AnnotatedLine           ? 'annot-line'
        : obj instanceof AnnotatedRegion         ? 'annot-region'
        : obj instanceof AnnotatedPoint          ? 'annot-point'
        : 'cuboid'
      entityInfos.set(id, { name: obj.name, type })
    }
    const links = [...this._scene.links.values()]
    this._linkNetworkView.update(entityInfos, links)
    this._linkNetworkView.setSelection(this._selectedIds)
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
    // Step 0: prioritise CoordinateFrame hits — CFs are rendered on top of Solids,
    // so the cuboid raycast (step 1) would return the parent Solid instead of the CF.
    const cfHit = this._hitTest.hitAnyCoordinateFrame()
    if (cfHit && cfHit.obj.id !== this._spatialLinkMode.sourceId) {
      return cfHit
    }

    // Step 1: cuboid-based raycast (same as _hitAnyObject but excludes source)
    const cuboidHit = this._hitTest.hitAnyObject()
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
      contextmenu: e => {
        e.preventDefault()
        if (this._contextMenuSuppressed) { this._contextMenuSuppressed = false; return }
        if (e.target !== this._sceneView.renderer.domElement) return
        if (this._scene.selectionMode !== 'object') return
        this._hitTest.updateMouse(e)
        // PHILOSOPHY #22 — same hit-priority logic as _onPointerDown:
        // CF beats its own parent Solid; unrelated CF does not shadow a Solid.
        const cfResult    = this._hitTest.hitAnyCoordinateFrame()
        const solidResult = this._hitTest.hitAnyObject()
        let result
        if (cfResult && solidResult) {
          result = this._hitTest.isCfDescendantOf(cfResult.obj, solidResult.obj.id) ? cfResult : solidResult
        } else {
          result = cfResult ?? solidResult
        }
        if (!result) result = this._hitTest.hitAnyAnnotation()
        if (!result) return
        const { obj } = result
        if (!this._selectedIds.has(obj.id)) {
          this._selMgr.clearObjectSelection()
          if (obj.id !== this._scene.activeId) {
            this._switchActiveObject(obj.id, true)
          } else if (!this._objSelected) {
            this._selMgr.setObjectSelected(true)
          }
          this._selectedIds.add(obj.id)
        } else if (obj.id !== this._scene.activeId) {
          this._service.setActiveObject(obj.id)
          this._objSelected = true
          this._refreshObjectModeStatus()
          this._updateNPanel()
        }
        this._showLongPressContextMenu(e.clientX, e.clientY, obj)
      },
    }
    window.addEventListener('pointermove', this._handlers.pointermove)
    window.addEventListener('pointerdown', this._handlers.pointerdown)
    window.addEventListener('pointerup',   this._handlers.pointerup)
    window.addEventListener('keydown',     this._handlers.keydown)
    window.addEventListener('keyup',       this._handlers.keyup)
    window.addEventListener('wheel',       this._handlers.wheel, { passive: false })
    window.addEventListener('contextmenu', this._handlers.contextmenu)
  }

  /**
   * Window wheel handler. Three consumers, in priority order:
   * 1. Map mode — scroll zooms the orthographic camera (MapModeController.onWheel)
   * 2. Rotate + Ctrl — cycles the angle snap step (RotationHandler.cycleStepSize)
   * 3. Grab + Ctrl — cycles the grid snap size (GrabOperationHandler.cycleGridSize)
   * Everything else falls through to OrbitControls' own wheel zoom.
   */
  _onWheel(e) {
    if (this._mapModeCtrl.onWheel(e)) return
    if (this._opState.is(S_ROTATE_ACTIVE) && this._ctrlHeld) {
      e.preventDefault()
      this._rotateHandler.cycleStepSize(e.deltaY)
      return
    }
    if (this._opState.is(S_GRAB_ACTIVE) && this._ctrlHeld) {
      e.preventDefault()
      this._grabHandler.cycleGridSize(e.deltaY)
    }
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

  _updateNPanel() { this._uiStateMgr.updateNPanel() }

  // ─── Mobile toolbar ────────────────────────────────────────────────────────

  _showLongPressContextMenu(x, y, obj) { this._contextMenuHandler.showLongPressContextMenu(x, y, obj) }
  _promptAddFrame(parentId)            { this._contextMenuHandler.promptAddFrame(parentId) }
  _promptRename(id)                    { this._contextMenuHandler.promptRename(id) }

  _refreshUndoRedoState() { this._uiStateMgr.refreshUndoRedoState() }

  /** Rebuilds the mobile floating toolbar to reflect current app state. */
  _updateMobileToolbar() { this._uiStateMgr.updateMobileToolbar() }

  // ─── Status bar helpers ────────────────────────────────────────────────────

  _refreshObjectModeStatus() { this._uiStateMgr.refreshObjectModeStatus() }

  // ─── Mode management ───────────────────────────────────────────────────────
  setMode(mode) {
    // ImportedMesh, CoordinateFrame, Annotated entities, and SpatialLink have
    // no editable vertex graph — Edit Mode not supported.
    // MeasureLine supports 1D Edit Mode (endpoint drag).
    if (mode === 'edit' && (
      this._activeObj instanceof ImportedMesh ||
      this._activeObj instanceof CoordinateFrame ||
      this._activeObj instanceof AnnotatedLine   ||
      this._activeObj instanceof AnnotatedRegion ||
      this._activeObj instanceof AnnotatedPoint  ||
      this._activeObj instanceof SpatialLink
    )) {
      this._uiView.showToast('Edit Mode is not available for this object type')
      return
    }
    if (mode === 'edit' && !this._activeObj) {
      this._uiView.showToast('Select an object first')
      return
    }

    // ── Cancel all in-progress operations ──────────────────────────────────
    if (this._opState.is(S_GRAB_ACTIVE))      this._grabHandler.cancel()
    if (this._opState.is(S_ROTATE_ACTIVE))    this._rotateHandler.cancel()
    if (this._opState.is(S_FACE_EXTRUDE))     this._faceExtrudeHandler.cancel()
    if (this._opState.is(S_FRAME_PLACEMENT))  this._framePlacementHandler.cancel()
    if (this._opState.is(S_MOUNT_PICKING))    this._cancelMountPicking()
    if (this._opState.is(S_QUICK_DRAG)) {
      this._quickDragHandler.cancel(this._quickDragCtx)
      for (const obj of this._scene.objects.values()) {
        if (obj instanceof Solid) obj.meshView?.setApproachWarmth(0)
      }
      this._opState.send('CANCEL')
      this._service.setLinkDragging(new Set(), false)
      this._service.updateLinkSelectionHighlight(this._selectedIds)
    }
    if (this._opState.is(S_RECT_SELECT)) {
      this._rectSelHandler.cancel(this._rectSelCtx)
      this._opState.send('CANCEL')
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
          this._selMgr.showFrameChain(this._scene.activeId)
        } else {
          this._selMgr.setChildFramesVisible(this._scene.activeId, true)
        }
      }
      this._refreshObjectModeStatus()
      this._uiView.updateMode('object')
      this._updateMobileToolbar()
    } else {
      // edit mode — dispatch on entity type
      this._selMgr.clearObjectSelection()
      this._selMgr.setObjectSelected(false)
      if (this._activeObj instanceof Profile) {
        this._enterEditMode2D()
      } else if (this._activeObj instanceof MeasureLine) {
        this._enterEditMode1D()
      } else {
        this._enterEditMode3D()
      }
    }
  }

  _cleanupEditSubstate() {
    this._scene.setEditSubstate(null)
    this._extrudePhase.hasInput = false
    this._extrudePhase.inputStr = ''
    this._extrudePhase.height = 0
    // Cancel any in-progress 2D sketch draw (restores controls, clears p1/p2)
    if (this._editOpState.is(EO_2D_SKETCH_DRAW)) {
      this._sketchDrawHandler.cancel(this._editCtx)
      this._editOpState.send('CANCEL')
    }
    // Cancel any in-progress endpoint drag (restores original positions)
    if (this._editOpState.is(EO_1D_DRAG)) {
      this._endpointDragHandler.cancel(this._editCtx)
      this._editOpState.send('CANCEL')
    }
    this._hoveredEndpointIndex = null
    if (this._meshView) this._meshView.clearEndpointHover?.()
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
    this._editSelHandler.refreshStatus()
    this._updateMobileToolbar()
  }

  _enterEditMode1D() {
    this._scene.setEditSubstate('1d')
    this._hoveredEndpointIndex = null
    this._uiView.updateMode('edit', '1d')
    this._refreshEditMode1DStatus()
    this._updateMobileToolbar()
  }

  _refreshEditMode1DStatus() { this._uiStateMgr.refreshEditMode1DStatus() }

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
    const screen = projectToScreen(labelPos, this._camera)
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

  _updateExtrudePhaseStatus() { this._uiStateMgr.updateExtrudePhaseStatus() }

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

  /**
   * Selects all entities reachable from the active object via fixed-joint SpatialLinks.
   * BFS traversal through jointType === 'fixed' edges (Semantic Select / assembly select).
   * Keyboard: Shift+S  Mobile: long-press context menu "Select Assembly"
   */
  _selectAssembly() {
    if (!this._objSelected || !this._activeObj) return
    if (this._activeObj instanceof SpatialLink) return

    const startId = this._activeObj.id
    const assemblyIds = this._service.getConnectedAssembly(startId)

    if (assemblyIds.size <= 1) {
      this._uiView.showToast('No fixed-linked parts found', { type: 'warn' })
      return
    }

    this._selMgr.clearObjectSelection()
    for (const id of assemblyIds) {
      const obj = this._scene.getObject(id)
      if (!obj?.meshView) continue
      obj.meshView.setObjectSelected(true)
      this._selMgr.setChildFramesVisible(obj.id, true)
      this._selectedIds.add(id)
    }

    if (this._scene.activeId !== startId) this._service.setActiveObject(startId)
    this._objSelected = true
    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()
    this._uiView.showToast(`${assemblyIds.size} objects selected`)
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
    this._hitTest.updateMouse(e)

    if (this._opState.is(S_ROTATE_ACTIVE)) {
      this._rotateHandler.apply()
      this._updateNPanel()
      return
    }

    if (this._opState.is(S_GRAB_ACTIVE)) {
      const gs = this._grabHandler.state
      if (this._grabHandler.pivotSelectMode) {
        this._grabHandler.updatePivotHover()
        return
      }
      this._grabHandler.apply()
      if (gs.autoSnap) {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._meshView.showSnapCandidates(filterNearbySnapTargets(gs.snapTargets, this._camera))
        if (gs.snapping && gs.snappedTarget) {
          this._meshView.clearSnapNearest()
          this._meshView.showSnapLocked(
            gs.snappedTarget.position,
            gs.snappedTarget.type,
            gs.pivot,
          )
        } else {
          this._meshView.clearSnapLocked()
          const nearest = findNearestSnapCandidate(gs.snapTargets, mx, my, this._camera)
          if (nearest) this._meshView.showSnapNearest(nearest.position, nearest.type)
          else         this._meshView.clearSnapNearest()
        }
      } else {
        this._meshView.clearSnapDisplay()
      }
      this._grabHandler.updateStatus()
      this._updateNPanel()
      return
    }

    // ── Frame placement pick sub-mode hover (ADR-034 §6) ─────────────────
    if (this._opState.is(S_FRAME_PLACEMENT) && e.pointerType !== 'touch') {
      this._framePlacementHandler.updateCursorGhost()
      return
    }

    // ── 2D Map Mode: pan or drawing hover ────────────────────────────────
    if (this._mapModeCtrl.onPointerMove(e)) return

    // ── Measure placement hover ───────────────────────────────────────────
    if (this._opState.is(S_MEASURE_PLACING)) {
      const pt = this._measureHandler.pickPoint()
      if (pt) {
        this._measure.p2 = pt
        // Show snap candidates via snapMeshView (a real MeshView, not MeasureLineView)
        const smv = this._measure.snapMeshView
        if (smv) {
          const mx = (this._mouse.x + 1) / 2 * innerWidth
          const my = (-this._mouse.y + 1) / 2 * innerHeight
          smv.showSnapCandidates(filterNearbySnapTargets(this._measure.snapTargets, this._camera))
          if (this._measure.snapping && this._measure.snappedTarget) {
            smv.clearSnapNearest()
            smv.showSnapLocked(
              this._measure.snappedTarget.position,
              this._measure.snappedTarget.type,
              pt,
            )
          } else {
            smv.clearSnapLocked()
            const nearest = findNearestSnapCandidate(this._measure.snapTargets, mx, my, this._camera)
            if (nearest) smv.showSnapNearest(nearest.position, nearest.type)
            else         smv.clearSnapNearest()
          }
        }
        // Phase 2: draw preview line
        if (this._measure.p1) {
          this._measureHandler.updatePreview(this._measure.p1, pt)
        }
      }
      this._measureHandler.updateStatus()
      return
    }

    if (this._scene.selectionMode === 'object') {
      if (this._opState.is(S_RECT_SELECT)) {
        this._rectSelHandler.onPointerMove(this._rectSelCtx, e)
        return
      }
      if (this._opState.is(S_QUICK_DRAG)) {
        this._quickDragHandler.onPointerMove(this._quickDragCtx, e)
        this._updateNPanel()
        return
      }
      this._uiView.setCursor((this._hitTest.hitAnyObject() || this._hitTest.hitAnyAnnotation()) ? 'pointer' : 'default')
      return
    }

    // ── Edit mode · 2D sketch ─────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-sketch') {
      if (this._editOpState.is(EO_2D_SKETCH_DRAW)) {
        this._sketchDrawHandler.onPointerMove(this._editCtx)
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

    // ── Endpoint drag (1D Edit Mode) ─────────────────────────────────────
    if (this._editOpState.is(EO_1D_DRAG)) {
      this._endpointDragHandler.onPointerMove(this._editCtx)
      return
    }

    // ── 1D Edit Mode: endpoint hover detection ────────────────────────────
    if (this._scene.editSubstate === '1d') {
      const mx = (this._mouse.x + 1) / 2 * innerWidth
      const my = (-this._mouse.y + 1) / 2 * innerHeight
      const v   = this._editSelHandler.findNearestVertex(mx, my, 20)
      const idx = v ? this._activeObj.vertices.indexOf(v) : null
      if (idx !== this._hoveredEndpointIndex) {
        this._meshView.clearEndpointHover()
        this._hoveredEndpointIndex = idx
        if (idx !== null) {
          this._meshView.setEndpointHover(idx)
          this._uiView.setStatusRich([
            { text: `Endpoint ${idx + 1}`, bold: true, color: '#69f0ae' },
            { text: 'Drag to reposition', color: '#555' },
          ])
          this._uiView.setCursor('pointer')
        } else {
          this._refreshEditMode1DStatus()
          this._uiView.setCursor('default')
        }
      }
      return
    }

    // ── Face extrude mode (E key) ─────────────────────────────────────────
    if (this._opState.is(S_FACE_EXTRUDE)) {
      if (this._faceExtrude.hasInput) return
      this._raycaster.setFromCamera(this._mouse, this._camera)
      const pt = new THREE.Vector3()
      if (!this._raycaster.ray.intersectPlane(this._faceExtrude.dragPlane, pt)) return
      const rawDist = pt.clone().sub(this._faceExtrude.startPoint).dot(this._faceExtrude.normal)
      this._faceExtrude.dist = this._faceExtrudeHandler.trySnap(rawDist)
      this._faceExtrudeHandler.applyPreview()
      // snap visuals
      const fe = this._faceExtrude
      const mx = (this._mouse.x + 1) / 2 * innerWidth
      const my = (-this._mouse.y + 1) / 2 * innerHeight
      this._meshView.showSnapCandidates(filterNearbySnapTargets(fe.snapTargets, this._camera))
      if (fe.snapping && fe.snappedTarget) {
        this._meshView.clearSnapNearest()
        const faceCenterAfter = fe.savedCorners
          .reduce((a, c) => a.add(c), new THREE.Vector3())
          .divideScalar(fe.savedCorners.length)
          .addScaledVector(fe.normal, fe.dist)
        this._meshView.showSnapLocked(fe.snappedTarget.position, fe.snappedTarget.type, faceCenterAfter)
      } else {
        this._meshView.clearSnapLocked()
        const nearest = findNearestSnapCandidate(fe.snapTargets, mx, my, this._camera)
        if (nearest) this._meshView.showSnapNearest(nearest.position, nearest.type)
        else         this._meshView.clearSnapNearest()
      }
      this._faceExtrudeHandler.updateStatus()
      return
    }

    // ── Hover detection per sub-element mode ──────────────────────────────
    if (this._editSelectMode === 'face') {
      const hit  = this._hitTest.hitFace()
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
          this._editSelHandler.refreshStatus()
        }
        this._uiView.setCursor(face ? 'pointer' : 'default')
      }
      return
    }

    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight

    if (this._editSelectMode === 'vertex') {
      const v = this._editSelHandler.findNearestVertex(mx, my)
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
          this._editSelHandler.refreshStatus()
          this._uiView.setCursor('default')
        }
      }
      return
    }

    if (this._editSelectMode === 'edge') {
      const e = this._editSelHandler.findNearestEdge(mx, my)
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
          this._editSelHandler.refreshStatus()
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
      if (this._opState.is(S_RECT_SELECT)) {
        this._rectSelHandler.cancel(this._rectSelCtx)
        this._opState.send('CANCEL')
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
    this._hitTest.updateMouse(e)

    // Suppress contextmenu-triggered menu when right-click is a cancel (ADR-006)
    this._contextMenuSuppressed = e.button === 2 && (
      this._opState.is(S_ROTATE_ACTIVE) || this._opState.is(S_MOUNT_PICKING) ||
      this._opState.is(S_LINK_MODE) || this._opState.is(S_GRAB_ACTIVE) ||
      this._opState.is(S_FACE_EXTRUDE) || this._mapModeCtrl.hasTool || this._opState.is(S_MEASURE_PLACING) ||
      this._opState.is(S_FRAME_PLACEMENT)
    )

    // ── Frame placement pick sub-mode (ADR-034 §6) ────────────────────────
    if (this._opState.is(S_FRAME_PLACEMENT)) {
      if (e.button === 2) { this._framePlacementHandler.cancel(); return }
      if (e.button === 0 || e.pointerType === 'touch') {
        const pt = this._framePlacementHandler.pickPoint()
        if (pt) {
          this._framePlacementHandler.confirm(pt)
        } else {
          this._framePlacementHandler.cancel()
        }
        return
      }
      return
    }

    if (this._opState.is(S_ROTATE_ACTIVE)) {
      if (e.pointerType === 'touch') {
        // Mobile: drag rotates the object; confirmation is via the toolbar button.
        // Re-snapshot segmentStart* so each new drag segment starts from current state.
        const obj = this._activeObj
        const s = this._rotateHandler.state
        if (obj instanceof Solid) {
          // Re-snapshot segment-start triple for new drag segment (ADR-040)
          s.segStartOrientation = obj.orientation.clone()
          s.segStartPos         = obj._position.clone()
          s.segStartPivot       = obj._position.clone()
        } else if (obj instanceof CoordinateFrame) {
          s.segmentStartRot.copy(obj.rotation)
        }
        s.needsStartAngle     = true
        this._activeDragPointerId = e.pointerId
        return
      }
      if (e.button === 0) { this._rotateHandler.confirm(); return }
      if (e.button === 2) { this._rotateHandler.cancel();  return }
      return
    }

    // ── Mount target selection (ADR-032 Phase H-6, Mobile) ────────────────
    if (this._opState.is(S_MOUNT_PICKING)) {
      if (e.button === 2 || e.pointerType === 'touch') {
        // Right-click or empty-tap cancels
        const hit = this._hitTest.hitAnyEntityForLink()
        if (hit) {
          const hitObj = this._scene.getObject(hit.obj.id)
          if (hitObj instanceof CoordinateFrame) {
            this._linkHandler.confirmMount(this._mountPicking.sourceId, hit.obj.id)
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
        const hit = this._hitTest.hitAnyEntityForLink()
        if (hit) {
          const hitObj = this._scene.getObject(hit.obj.id)
          if (hitObj instanceof CoordinateFrame) {
            this._linkHandler.confirmMount(this._mountPicking.sourceId, hit.obj.id)
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
    if (this._opState.is(S_LINK_MODE)) {
      if (e.button === 2) { this._linkHandler.cancel(); return }
      if (e.button === 0) {
        const hit = this._hitTest.hitAnyEntityForLink()
        if (hit) {
          this._linkHandler.showTypePicker(e.clientX, e.clientY, hit.obj.id)
        } else {
          this._linkHandler.cancel()
        }
        return
      }
      return
    }

    if (this._opState.is(S_GRAB_ACTIVE)) {
      if (this._grabHandler.pivotSelectMode) {
        if (e.button === 0) { this._confirmPivotSelect(); return }
        if (e.button === 2) { this._grabHandler.cancelPivotSelect();  return }
        return
      }
      if (e.button === 0) {
        if (e.pointerType === 'touch') {
          // On touch: checkpoint the current position as the start of a new drag
          // segment, then track the pointer. Grab stays active until Confirm is pressed.
          const gs = this._grabHandler.state
          gs.segmentStartCorners = new Map()
          gs.segmentStartPositions = new Map()
          for (const id of this._selectedIds) {
            const selObj = this._scene.getObject(id)
            if (selObj) {
              gs.segmentStartCorners.set(id, _grabHandlesOf(selObj).map(c => c.clone()))
              if (selObj instanceof Solid) gs.segmentStartPositions.set(id, selObj._position.clone())
            }
          }
          gs.startCorners = this._corners.map(c => c.clone())
          const grabCenter = (this._activeObj instanceof CoordinateFrame)
            ? (this._service.worldPoseOf(this._activeObj.id)?.position?.clone() ?? getCentroid(this._corners))
            : (this._activeObj instanceof Solid ? this._activeObj._position.clone() : getCentroid(this._corners))
          gs.centroid.copy(grabCenter)
          gs.pivot.copy(grabCenter)
          gs.lastDelta.set(0, 0, 0)
          const camDir = new THREE.Vector3()
          this._camera.getWorldDirection(camDir)
          gs.dragPlane.setFromNormalAndCoplanarPoint(camDir, grabCenter)
          this._raycaster.setFromCamera(this._mouse, this._camera)
          const _segPt = new THREE.Vector3()
          if (this._raycaster.ray.intersectPlane(gs.dragPlane, _segPt)) {
            gs.startPoint.copy(_segPt)
          } else {
            gs.startPoint.copy(grabCenter)
          }
          gs.startMouse.copy(this._mouse)
          this._activeDragPointerId = e.pointerId
          return
        }
        this._grabHandler.confirm()
        return
      }
      if (e.button === 2) { this._grabHandler.cancel();  return }
      return
    }

    if (this._opState.is(S_FACE_EXTRUDE)) {
      if (e.button === 0) {
        // Don't confirm immediately — let pointermove update the distance,
        // then confirm on pointerup. This allows touch-drag to set distance.
        this._activeDragPointerId = e.pointerId
        return
      }
      if (e.button === 2) { this._faceExtrudeHandler.cancel(); return }
      return
    }

    // ── 2D Map Mode: drawing clicks and pan start ────────────────────────
    if (this._mapModeCtrl.onPointerDown(e)) return

    // ── Measure placement clicks ──────────────────────────────────────────
    if (this._opState.is(S_MEASURE_PLACING)) {
      if (e.button === 2) { this._measureHandler.cancel(); return }
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
      if (this._editOpState.send('BEGIN_2D_SKETCH')) {
        if (this._sketchDrawHandler.enter(this._editCtx)) {
          this._activeDragPointerId = e.pointerId
        } else {
          // Ground plane not hit — roll back FSM immediately
          this._editOpState.send('CANCEL')
        }
      }
      return
    }

    if (this._scene.selectionMode === 'object') {
      // PHILOSOPHY #22 — Narrower Scope Wins in Hit-Testing:
      // Run scene hit tests first so we know what the user is actually targeting.
      // A CF should beat its own parent Solid when both are in the same screen region.
      // However a CF belonging to a *different* Solid must NOT intercept clicks on
      // the target Solid — the bounding-box fallback in _hitAnyCoordinateFrame()
      // creates a 0.4-unit false-positive zone that would otherwise block Solid selection.
      const cfResult    = this._hitTest.hitAnyCoordinateFrame()
      const solidResult = this._hitTest.hitAnyObject()
      let result
      if (cfResult && solidResult) {
        // Both hit: prefer CF only when it is a descendant of the found Solid
        // (PHILOSOPHY #22 applies to child→parent, not to cross-Solid relationships).
        result = this._hitTest.isCfDescendantOf(cfResult.obj, solidResult.obj.id)
          ? cfResult
          : solidResult
      } else {
        result = cfResult ?? solidResult
      }
      if (!result) result = this._hitTest.hitAnyAnnotation()

      // If TC already claimed this pointer (gizmo fired dragging-changed synchronously
      if (result) {
        const { hit, obj } = result
        if (!this._selectedIds.has(obj.id)) {
          // Clicked an unselected object — clear previous selection, select only this
          this._selMgr.clearObjectSelection()
          if (obj.id !== this._scene.activeId) {
            this._switchActiveObject(obj.id, true)
          } else if (!this._objSelected) {
            this._selMgr.setObjectSelected(true)
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
        // On touch, still set up the long-press timer so the context menu (including
        // "Link to...") can be triggered for these entity types on mobile.
        if (obj instanceof MeasureLine || obj instanceof CoordinateFrame ||
            obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint) {
          if (e.pointerType === 'touch' && this._objSelected && this._selectedIds.has(obj.id)) {
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
        this._objDragAllStartCorners   = new Map()
        this._objDragAllStartPositions = new Map()
        for (const id of this._selectedIds) {
          const selObj = this._scene.getObject(id)
          // CoordinateFrame uses localOffset (not corners); exclude it from mouse-drag
          // (frames are moved via G-key grab only — PHILOSOPHY #21 Phase 3).
          if (selObj && !(selObj instanceof CoordinateFrame)) {
            this._objDragAllStartCorners.set(id, selObj.corners.map(c => c.clone()))
            if (selObj instanceof Solid) this._objDragAllStartPositions.set(id, selObj._position.clone())
          }
        }

        // Ctrl+drag (rotate) only works for locally-editable objects (Cuboid).
        this._objCtrlDrag = e.ctrlKey && !(obj instanceof ImportedMesh) && !(obj instanceof MeasureLine) && !(obj instanceof CoordinateFrame)

        const camDir = new THREE.Vector3()
        this._camera.getWorldDirection(camDir)
        this._objDragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
        this._objDragStart.copy(hit.point)
        this._objDragStartCorners = this._corners.map(c => c.clone())

        if (e.ctrlKey) {
          this._objRotateStartX = e.clientX
          this._objRotateCentroid.copy(obj instanceof Solid ? obj._position : getCentroid(this._corners))
          if (obj instanceof Solid) {
            // ADR-040: snapshot primary triple for snapshot-based rotate (no corner mutation)
            this._objRotateStartOrientation = obj.orientation.clone()
            this._objRotateStartPos         = obj._position.clone()
          } else {
            this._objRotateStartOrientation = null
            this._objRotateStartPos         = null
            this._objRotateStartCorners = this._corners.map(c => c.clone())
          }
        }

        // Semantic guardrail: same check as _startGrab — block independent movement of
        // fastened/mounted entities during mouse-drag (mirrors G-key grab guard).
        const dragGuardrail = this._service.checkMoveGuardrail(this._selectedIds)
        if (dragGuardrail.blocked) {
          this._uiView.showToast(dragGuardrail.message, { type: 'warn' })
          return
        }

        if (this._opState.send('BEGIN_QUICK_DRAG')) {
          this._quickDragHandler.enter(this._quickDragCtx)
          this._activeDragPointerId = e.pointerId
          this._service.setLinkDragging(this._selectedIds, true)
        }
      } else {
        // No object hit: touch tap → deselect; desktop → start rectangle selection.
        if (e.pointerType === 'touch') {
          this._selMgr.clearObjectSelection()
          this._selMgr.setObjectSelected(false)
          return
        }
        // Do NOT disable _controls here: orbit (right-click / two-finger) uses
        // separate buttons/fingers and must remain available simultaneously.
        if (this._opState.send('BEGIN_RECT_SELECT')) {
          this._rectSelHandler.enter(this._rectSelCtx, e)
          this._activeDragPointerId = e.pointerId
        }
      }
      return
    }

    // ── Edit mode · 1D: start endpoint drag ──────────────────────────────
    if (this._scene.editSubstate === '1d') {
      const isTouch = e.pointerType === 'touch'
      const mx = (this._mouse.x + 1) / 2 * innerWidth
      const my = (-this._mouse.y + 1) / 2 * innerHeight
      const v   = this._editSelHandler.findNearestVertex(mx, my, isTouch ? 30 : 15)
      if (v) {
        const obj = this._activeObj
        const idx = obj.vertices.indexOf(v)
        if (this._editOpState.send('BEGIN_1D_DRAG')) {
          this._endpointDragHandler.enter(this._editCtx, v, idx)
          this._activeDragPointerId  = e.pointerId
          this._meshView.clearEndpointHover()
          this._hoveredEndpointIndex = null
          this._uiView.setCursor('grabbing')
        }
      }
      return
    }

    // ── Edit mode: click to select sub-elements ───────────────────────────
    // Refresh hover state for touch (pointermove may not fire before pointerdown on touch devices)
    if (this._scene.editSubstate === '3d') {
      if (this._editSelectMode === 'face') {
        const hit = this._hitTest.hitFace()
        this._hoveredFace = hit?.face ?? null
        this._meshView.setFaceHighlight(this._hoveredFace?.index ?? null, this._corners)
      } else if (this._editSelectMode === 'vertex') {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._hoveredVertex = this._editSelHandler.findNearestVertex(mx, my)
      } else if (this._editSelectMode === 'edge') {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._hoveredEdge = this._editSelHandler.findNearestEdge(mx, my)
      }
    }
    this._editSelHandler.handleEditClick(e.shiftKey)

    // Mobile: auto-start face extrude immediately after a face tap, so the
    // user can drag to set the distance without pressing the Extrude button.
    // (Only fires when a face was selected without Shift — not for multi-select.)
    if (window.matchMedia('(pointer: coarse)').matches &&
        this._scene.editSubstate === '3d' &&
        this._editSelectMode === 'face' &&
        !e.shiftKey) {
      const faces = [...this._scene.editSelection].filter(x => x instanceof Face)
      if (faces.length > 0) {
        this._faceExtrudeHandler.start(faces[0])
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

    // ── 2D Map Mode: end panning / drag gesture completion ───────────────
    if (this._mapModeCtrl.onPointerUp(e)) return

    // ── Endpoint drag confirmation (1D Edit Mode) ────────────────────────
    if (this._editOpState.is(EO_1D_DRAG) && this._activeDragPointerId === e.pointerId) {
      this._activeDragPointerId = null
      const obj = this._activeObj
      this._endpointDragHandler.confirm(this._editCtx)
      this._editOpState.send('CONFIRM')
      obj.meshView.updateBoxHelper()
      this._uiView.setCursor('default')
      this._refreshEditMode1DStatus()
      return
    }

    // ── Measure point confirmation (hold-to-snap, release-to-confirm) ─────
    if (this._opState.is(S_MEASURE_PLACING) && this._measure.pressing) {
      if (this._activeDragPointerId === e.pointerId) {
        this._activeDragPointerId = null
        this._measure.pressing    = false
        this._measureHandler.confirmPoint()
      }
      return
    }

    // wasDragging: a canvas drag started for this pointer (via _onPointerDown)
    const wasDragging = this._activeDragPointerId === e.pointerId
    if (wasDragging) this._activeDragPointerId = null
    if (this._opState.is(S_ROTATE_ACTIVE)) {
      // Mobile rotate: keep active after finger lift; user confirms via toolbar button.
      return
    }
    if (this._opState.is(S_GRAB_ACTIVE)) {
      // Touch grab: keep grab active after finger release.
      // The object stays at the dragged position; user confirms via the Confirm button.
      // Multiple drag segments are supported before confirming.
      return
    }
    if (this._opState.is(S_FACE_EXTRUDE)) {
      // Only confirm when a canvas drag was started; prevents double-confirm
      // when the mobile Confirm toolbar button fires both pointerup and click.
      if (wasDragging) this._faceExtrudeHandler.confirm()
      return
    }
    if (this._editOpState.is(EO_2D_SKETCH_DRAW) && wasDragging) {
      this._sketchDrawHandler.confirm(this._editCtx)
      this._editOpState.send('CONFIRM')
      return
    }
    if (this._opState.is(S_RECT_SELECT) && wasDragging) {
      this._rectSelHandler.confirm(this._rectSelCtx)
      this._opState.send('CONFIRM')
      return
    }
    if (this._opState.is(S_QUICK_DRAG) && wasDragging) {
      this._objCtrlDrag = false
      this._quickDragHandler.confirm(this._quickDragCtx)
      this._opState.send('CONFIRM')
      this._service.setLinkDragging(new Set(), false)
      this._service.updateLinkSelectionHighlight(this._selectedIds)
      for (const obj of this._scene.objects.values()) {
        if (obj instanceof Solid) obj.meshView?.setApproachWarmth(0)
      }
      this._runSemanticInference()
    }
  }

  _onKeyUp(e) {
    if (e.key === 'Control') {
      this._ctrlHeld = false
      if (this._opState.is(S_GRAB_ACTIVE) && !this._grabHandler.pivotSelectMode) this._grabHandler.updateStatus()
      if (this._opState.is(S_FACE_EXTRUDE)) this._faceExtrudeHandler.updateStatus()
      if (this._opState.is(S_ROTATE_ACTIVE) && !this._rotateHandler.state.hasInput) {
        this._rotateHandler.apply()
        this._rotateHandler.updateStatus()
      }
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Control') {
      this._ctrlHeld = true
      if (this._opState.is(S_ROTATE_ACTIVE) && !this._rotateHandler.state.hasInput) {
        this._rotateHandler.apply()
        this._rotateHandler.updateStatus()
      }
    }

    // ── Undo / Redo (ADR-022) ──────────────────────────────────────────────
    // Intercept Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z before any operation-specific
    // key handlers so they don't mis-fire as grab-axis or rotate-axis keys.
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault()
      if (!this._opState.is(S_GRAB_ACTIVE) && !this._opState.is(S_ROTATE_ACTIVE) && !this._opState.is(S_FACE_EXTRUDE)) {
        const isUndo = e.key === 'z' && !e.shiftKey
        if (isUndo) {
          const cmd = this._commandStack.undo()
          if (cmd) this._uiView.showToast(`Undo: ${cmd.label}`)
        } else {
          const cmd = this._commandStack.redo()
          if (cmd) this._uiView.showToast(`Redo: ${cmd.label}`)
        }
        this._refreshUndoRedoState()
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

    // ── Keys active during quick drag (ADR-041 Phase 2) ───────────────────
    if (this._opState.is(S_QUICK_DRAG)) {
      if (this._quickDragHandler.onKeyDown(this._quickDragCtx, e)) return
    }

    // ── Keys active during rotate (CoordinateFrame R key, ADR-019) ────────
    if (this._opState.is(S_ROTATE_ACTIVE)) {
      switch (e.key) {
        case 'x': case 'X': this._rotateHandler.setAxis('x'); return
        case 'y': case 'Y': this._rotateHandler.setAxis('y'); return
        case 'z': case 'Z': this._rotateHandler.setAxis('z'); return
        case 'Enter':  this._rotateHandler.confirm(); return
        case 'Escape': this._rotateHandler.cancel();  return
      }
      const rs = this._rotateHandler.state
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        rs.inputStr += e.key
        rs.hasInput  = true
        this._rotateHandler.apply()
        this._rotateHandler.updateStatus()
        return
      }
      if (e.key === '-' && rs.inputStr.length === 0) {
        rs.inputStr = '-'
        rs.hasInput = true
        this._rotateHandler.updateStatus()
        return
      }
      if (e.key === 'Backspace') {
        rs.inputStr = rs.inputStr.slice(0, -1)
        rs.hasInput = rs.inputStr.length > 0 && rs.inputStr !== '-'
        this._rotateHandler.apply()
        this._rotateHandler.updateStatus()
        return
      }
      return
    }

    // ── Keys active during grab ────────────────────────────────────────────
    if (this._opState.is(S_GRAB_ACTIVE)) {
      const gh = this._grabHandler
      const gs = gh.state
      if (gh.pivotSelectMode) {
        if (e.key === 'Escape') gh.cancelPivotSelect()
        if (e.key === '1') { gh.setPivotCandidateMode('vertex'); return }
        if (e.key === '2') { gh.setPivotCandidateMode('edge');   return }
        if (e.key === '3') { gh.setPivotCandidateMode('face');   return }
        return
      }
      switch (e.key) {
        case 'v': case 'V': gh.startPivotSelect(); return
        case 'x': case 'X': gh.setAxis('x'); return
        case 'y': case 'Y': gh.setAxis('y'); return
        case 'z': case 'Z': gh.setAxis('z'); return
        case 's': case 'S': gh.toggleStackMode(); return
        case 'Enter':
          if (gh.isSuggesting && gh.currentSuggestion) {
            this._linkHandler.createDirect(
              gh.currentSuggestion.sourceId,
              gh.currentSuggestion.targetId,
              gh.currentSuggestion,
            )
          }
          gh.confirm()
          return
        case 'Escape':       gh.cancel();     return
        case '1': this._setSnapMode('vertex'); return
        case '2': this._setSnapMode('edge');   return
        case '3': this._setSnapMode('face');   return
      }
      if (gs.axis) {
        if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
          gs.inputStr += e.key
          gs.hasInput  = true
          gh.apply()
          gh.updateStatus()
          return
        }
        if (e.key === '-' && gs.inputStr.length === 0) {
          gs.inputStr = '-'
          gs.hasInput = true
          gh.updateStatus()
          return
        }
        if (e.key === 'Backspace') {
          gs.inputStr = gs.inputStr.slice(0, -1)
          gs.hasInput = gs.inputStr.length > 0 && gs.inputStr !== '-'
          gh.apply()
          gh.updateStatus()
          return
        }
      }
      return
    }

    // ── 2D Map Mode keys ────────────────────────────────────────────────────
    if (this._mapModeCtrl.onKeyDown(e)) return

    // ── Frame placement pick sub-mode keys (ADR-034 §6) ──────────────────
    if (this._opState.is(S_FRAME_PLACEMENT)) {
      if (e.key === 'Escape') { this._framePlacementHandler.cancel(); return }
      return  // consume all other keys during frame pick
    }

    // ── Measure placement keys ─────────────────────────────────────────────
    if (this._opState.is(S_MEASURE_PLACING)) {
      if (e.key === 'Escape') { this._measureHandler.cancel(); return }
      return
    }

    // ── SpatialLink creation keys (ADR-030 Phase 4) ────────────────────────
    if (this._opState.is(S_LINK_MODE)) {
      if (e.key === 'Escape') { this._linkHandler.cancel(); return }
      return  // consume all other keys during link mode
    }

    // ── Mount picking keys (ADR-032 Phase H-5) ─────────────────────────────
    if (this._opState.is(S_MOUNT_PICKING)) {
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
    if (this._opState.is(S_FACE_EXTRUDE)) {
      if (e.key === 'Enter')  { e.preventDefault(); this._faceExtrudeHandler.confirm(); return }
      if (e.key === 'Escape') { this._faceExtrudeHandler.cancel(); return }
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        this._faceExtrude.inputStr += e.key
        this._faceExtrude.hasInput  = true
        this._faceExtrudeHandler.applyFromInput()
        this._faceExtrudeHandler.updateStatus()
        return
      }
      if (e.key === '-' && this._faceExtrude.inputStr.length === 0) {
        this._faceExtrude.inputStr = '-'
        this._faceExtrude.hasInput = true
        this._faceExtrudeHandler.updateStatus()
        return
      }
      if (e.key === 'Backspace') {
        this._faceExtrude.inputStr = this._faceExtrude.inputStr.slice(0, -1)
        this._faceExtrude.hasInput = this._faceExtrude.inputStr.length > 0 && this._faceExtrude.inputStr !== '-'
        this._faceExtrudeHandler.applyFromInput()
        this._faceExtrudeHandler.updateStatus()
        return
      }
      return
    }

    // ── Sub-element mode switching (Edit Mode · 3D only) ──────────────────
    if (this._scene.selectionMode === 'edit' && this._scene.editSubstate === '3d') {
      if (e.key === '1') { this._editSelHandler.setEditSelectMode('vertex'); return }
      if (e.key === '2') { this._editSelHandler.setEditSelectMode('edge');   return }
      if (e.key === '3') { this._editSelHandler.setEditSelectMode('face');   return }
      if ((e.key === 'e' || e.key === 'E') && this._editSelectMode === 'face') {
        const selected = [...this._scene.editSelection].filter(x => x instanceof Face)
        if (selected.length > 0) this._faceExtrudeHandler.start(selected[0])
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
        this._measureHandler.start()
        return
      }
      // L: start SpatialLink creation (ADR-030 Phase 4)
      if ((e.key === 'l' || e.key === 'L') && this._objSelected) {
        if (this._activeObj instanceof SpatialLink) {
          this._uiView.showToast('SpatialLink cannot be used as a link source', { type: 'warn' })
          return
        }
        this._linkHandler.start()
        return
      }
      // Shift+S: select all fixed-joint-connected parts (Semantic Select / assembly select)
      if (e.key === 'S' && e.shiftKey && this._objSelected) {
        e.preventDefault()
        this._selectAssembly()
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
        this._grabHandler.start()
        return
      }
      // R: rotate (CoordinateFrame or Solid, ADR-019 / ADR-036)
      if ((e.key === 'r' || e.key === 'R') &&
          (this._activeObj instanceof CoordinateFrame || this._activeObj instanceof Solid)) {
        this._rotateHandler.start()
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

    // Wire up Node Editor (Phase S-2: topology editing callbacks)
    this._nodeEditorView = new NodeEditorView(document.body, this._service, {
      onNodeHover: (id) => {
        const obj = this._scene.getObject(id)
        obj?.meshView?.setLabelHighlighted?.(true)
      },
      onNodeHoverEnd: (id) => {
        const obj = this._scene.getObject(id)
        obj?.meshView?.setLabelHighlighted?.(false)
      },
      onLinkRequested: (sourceId, targetId, x, y) => {
        const source = this._scene.getObject(sourceId)
        const target = this._scene.getObject(targetId)
        if (!source || !target) return
        const linkOptions = _computeLinkOptions(source, target)
        this._uiView.showLinkTypePicker(x, y, (option) => {
          if (option.semanticType === 'mounts') {
            this._linkHandler.confirmMount(sourceId, targetId)
          } else if (option.jointType === 'fixed') {
            this._linkHandler.confirmFasten(sourceId, targetId, option.semanticType)
          } else {
            this._linkHandler.createDirect(sourceId, targetId, option)
          }
        }, { linkOptions })
      },
      onDeleteSpatialLink: (linkId) => {
        const link = this._scene.getLink(linkId)
        if (!link) return
        this._service.detachSpatialLink(linkId)
        this._commandStack.push(createDeleteSpatialLinkCommand(link, this._service))
        this._uiView.showToast('Link deleted')
        this._updateNPanel()
      },
    })
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
      // Keep MeasureLine / AnnotatedPoint HTML labels positioned over the correct screen pixel,
      // drive per-element animations, and keep CoordinateFrame axes at constant screen size.
      const t = performance.now() * 0.001  // elapsed seconds for animation clock
      // Compute scene bounding radius once per frame: used as a fallback cap for
      // CFs that have no solid parent (otherwise they grow unboundedly when zooming out).
      let sceneRadius = 0
      for (const o of this._scene.objects.values()) {
        if (o.corners?.length > 0) {
          for (const c of o.corners) {
            const r = c.length()
            if (r > sceneRadius) sceneRadius = r
          }
        }
      }
      // Sync CoordinateFrame world poses and SpatialLink arrows BEFORE render() so that
      // link views and CF axes follow entities in the same frame as entity mesh updates.
      // (Entity meshes are updated synchronously in event handlers via applyPreviewTranslation;
      // without this ordering, link arrows lag one frame behind the entity during movement.)
      // updateLabelPosition() below also reads _group.position set here — no change needed.
      this._service._updateWorldPoses()
      this._sceneView.render()
      if (this._gizmoView) this._gizmoView.update()
      for (const obj of this._scene.objects.values()) {
        if (obj instanceof MeasureLine)     obj.meshView.updateLabelPosition()
        if (obj instanceof AnnotatedPoint)  {
          // Constant screen-size marker, capped to 5% of the scene radius so it
          // stays proportionate; floor at the legacy 0.25-unit world radius so
          // meter-scale scenes keep their original marker size.
          obj.meshView.updateScale(this._camera, this._sceneView.renderer, Math.max(sceneRadius * 0.05, 0.25))
          obj.meshView.updateLabelPosition(this._sceneView.activeCamera)
          obj.meshView.tick(t)
          // Bilateral tolerance alarm: update error bridge line toward violated CF.
          if (obj.meshView._bridgeCfId) {
            const pose = this._service._worldPoseCache.get(obj.meshView._bridgeCfId)
            if (pose) obj.meshView.updateBridgeLine(this._sceneView.scene, pose.position)
          }
        }
        if (obj instanceof AnnotatedLine)   { obj.meshView.updateLabelPosition(this._sceneView.activeCamera); obj.meshView.tick(t) }
        if (obj instanceof AnnotatedRegion) { obj.meshView.updateLabelPosition(this._sceneView.activeCamera); obj.meshView.tick(t) }
        if (obj instanceof CoordinateFrame) {
          // Cap the frame's world size so it never visually dwarfs its parent.
          // Compute the parent object's bounding radius (max distance from centroid
          // to any corner) and allow the frame axes to grow to at most 1.5× that.
          // When no solid parent exists, fall back to a scene-wide cap (30% of the
          // furthest corner from origin) so independent CFs also stay proportional.
          let maxWS = Infinity
          // Walk up the parent chain past any CoordinateFrame ancestors to find
          // the nearest Solid (or other geometry entity with corners). This ensures
          // grandchild CFs use the same size reference as direct-child CFs.
          let solidAncestor = this._scene.getObject(obj.parentId)
          while (solidAncestor instanceof CoordinateFrame) {
            solidAncestor = this._scene.getObject(solidAncestor.parentId)
          }
          if (solidAncestor && solidAncestor.corners?.length > 0) {
            const centroid = getCentroid(solidAncestor.corners)
            let maxR = 0
            for (const c of solidAncestor.corners) {
              const r = centroid.distanceTo(c)
              if (r > maxR) maxR = r
            }
            if (maxR > 0) maxWS = maxR * 0.75
          }
          if (maxWS === Infinity) {
            // sceneRadius=0 means empty scene; use 1.0 so the CF is still visible
            maxWS = sceneRadius > 0 ? sceneRadius * 0.15 : 1.0
          }
          obj.meshView.updateScale(this._camera, this._sceneView.renderer, maxWS)
          obj.meshView.updateLabelPosition(this._sceneView.activeCamera)
        }
      }
      // Tick and prune completed link-acceptance ripple animations.
      if (this._activeRipples.length > 0) {
        this._activeRipples = this._activeRipples.filter(r => {
          const done = r.tick(t)
          if (done) r.dispose()
          return !done
        })
      }
      // Context DSL demo: ghost pulse/collapse + staggered reveal (ADR-047).
      this._demoCtrl.tick(t)
    }
    loop()

    // Show first-run gesture hints on mobile
    this._uiView.showOnboardingIfNeeded()

    // Wire Export / Import JSON buttons
    this._uiView.onExportJson(() => this._exportSceneJson())
    this._uiView.onImportJson(() => this._triggerImportSceneJson())

    // Context DSL demo via URL param (?demo=context) — same path as the
    // header Demo button and window.__easyExtrude.demoContext().
    if (new URLSearchParams(location.search).get('demo') === 'context') {
      this._demoCtrl.enter()
    }

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

