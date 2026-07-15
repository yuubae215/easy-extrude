/**
 * SceneService - Application Service layer (DDD Phase 3).
 *
 * Owns the SceneModel aggregate root and orchestrates domain use-cases:
 * creating entities, disposing them, and delegating mutations to the
 * domain entities themselves.
 *
 * DDD Phase 4: SceneService extends EventEmitter and emits domain events
 * whenever scene state changes. Subscribers (e.g. OutlinerView) react to
 * these events instead of being called directly by AppController.
 *
 * BFF Phase A (ADR-015): optional BFF integration via `connectBff()`.
 * When connected, `saveScene()` / `loadScene()` / `listScenes()` delegate to
 * the BFF REST API. All existing local operations remain unchanged —
 * disconnected (BFF unavailable) mode works exactly as before.
 *
 * BFF Phase B (ADR-017): WebSocket geometry streaming via `openGeometryChannel()`.
 * When connected, geometry.update messages from the Geometry Service are applied
 * to the matching scene object's MeshView automatically.
 *
 * Events emitted:
 *   'objectAdded'               (obj: SceneObject)
 *   'objectRemoved'             (id: string)
 *   'objectRenamed'             (id: string, name: string)
 *   'objectIfcClassChanged'     (id: string, ifcClass: string|null)
 *   'objectPlaceTypeChanged'    (id: string, placeType: string|null)
 *   'activeChanged'             (id: string|null)
 *   'spatialLinkAdded'          (link: SpatialLink)
 *   'spatialLinkRemoved'        (id: string)
 *
 * Rules:
 *  - SceneService is the ONLY place that calls new Solid / new Profile / new MeshView.
 *  - SceneService is the ONLY place that calls SceneModel.addObject / removeObject.
 *  - Callers (AppController) interact with domain state through `service.scene`
 *    for reads and through service methods for writes.
 */
import { Vector3, Quaternion } from 'three'
import { EventEmitter } from '../core/EventEmitter.js'
import { SceneModel } from '../model/SceneModel.js'
import { MeshView } from '../view/MeshView.js'
import { Solid }   from '../domain/Solid.js'
import { Profile } from '../domain/Profile.js'
import { createInitialCorners } from '../model/CuboidModel.js'
import { Vertex } from '../graph/Vertex.js'
import { Edge }   from '../graph/Edge.js'
import { BffClient, BffUnavailableError, WsChannel } from './BffClient.js'
import { serializeScene, base64ToF32, base64ToU32 } from './SceneSerializer.js'
import { ImportedMesh } from '../domain/ImportedMesh.js'
import { ImportedMeshView } from '../view/ImportedMeshView.js'
import { MeasureLine } from '../domain/MeasureLine.js'
import { MeasureLineView } from '../view/MeasureLineView.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { CoordinateFrameView } from '../view/CoordinateFrameView.js'
import { AnnotatedLine }   from '../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../domain/AnnotatedPoint.js'
import { AnnotatedLineView }   from '../view/AnnotatedLineView.js'
import { AnnotatedRegionView } from '../view/AnnotatedRegionView.js'
import { AnnotatedPointView }  from '../view/AnnotatedPointView.js'
import { SpatialLink, migrateLinkType } from '../domain/SpatialLink.js'
import { SpatialLinkView } from '../view/SpatialLinkView.js'
import { RoleService } from './RoleService.js'
import { constraintSolver } from './ConstraintSolver.js'
import { getIFCClassEntry } from '../domain/IFCClassRegistry.js'

/**
 * Minimum 2D (XY-projected) distance from any polyline segment to any point.
 * Used for clearance evaluation of bounded_by SpatialLinks.
 * @param {import('three').Vector3[]} linePoints  ordered polyline vertices
 * @param {import('three').Vector3[]} testPoints  points to test against
 * @returns {number} minimum distance in world units
 */
function _minDistPolylineToPoints(linePoints, testPoints) {
  let minDist = Infinity
  for (let i = 0; i < linePoints.length - 1; i++) {
    const ax = linePoints[i].x,     ay = linePoints[i].y
    const bx = linePoints[i + 1].x, by = linePoints[i + 1].y
    const dx = bx - ax,             dy = by - ay
    const segLen2 = dx * dx + dy * dy
    for (const pt of testPoints) {
      const px = pt.x, py = pt.y
      let t = 0
      if (segLen2 > 1e-10) {
        t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / segLen2))
      }
      const cx2 = ax + t * dx, cy2 = ay + t * dy
      const dist = Math.sqrt((px - cx2) ** 2 + (py - cy2) ** 2)
      if (dist < minDist) minDist = dist
    }
  }
  return minDist
}

/**
 * Ray-casting point-in-polygon test on the XY plane (odd-even rule).
 * Used for containment evaluation of contains SpatialLinks.
 * @param {number} px
 * @param {number} py
 * @param {import('three').Vector3[]} poly  ordered ring of polygon vertices (≥ 3)
 * @returns {boolean}
 */
function _xyPointInPolygon(px, py, poly) {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export class SceneService extends EventEmitter {
  /**
   * @param {import('three').Scene} threeScene  Three.js scene used for MeshView creation/disposal
   */
  constructor(threeScene) {
    super()
    this._threeScene = threeScene
    this._model      = new SceneModel()
    /** @type {BffClient|null} */
    this._bff        = null
    /** Server-assigned scene id when synced with the BFF. */
    this._remoteId   = null
    /** @type {WsChannel|null} */
    this._wsChannel  = null
    /** Unsubscribe functions for active WS handlers. */
    this._wsUnsubs   = []
    /**
     * World pose cache for CoordinateFrame entities (ADR-020).
     * Populated by _updateWorldPoses() each animation frame.
     * Source of truth for world position; never stored on the entity itself.
     * @type {Map<string, { position: import('../types/spatial.js').WorldVector3, quaternion: import('three').Quaternion }>}
     */
    this._worldPoseCache = new Map()
    /**
     * SpatialLink rendering views (ADR-030 Phase 3).
     * Keyed by SpatialLink.id. Parallel to _model.links.
     * @type {Map<string, SpatialLinkView>}
     */
    this._linkViews = new Map()
    /**
     * Local-space vertex positions for mounted Annotated* entities (ADR-032 Phase H-2).
     * Keyed by SpatialLink.id (mounts link).
     * Populated by mountAnnotation(); cleared by unmountAnnotation().
     * _updateMountedAnnotations() reads this every frame and writes world positions
     * back to vertex.position so the rest of the app continues to see world coords.
     * @type {Map<string, { sourceId: string, localPositions: import('three').Vector3[] }>}
     */
    this._mountLocalPositions = new Map()
    /**
     * Relative transforms for fixed-joint CoordinateFrame pairs (ADR-038, jointType='fixed').
     * Keyed by SpatialLink.id. Populated by fastenFrame(); cleared by unfastenFrame() / detachSpatialLink().
     * _updateFixedJointFrames() reads this every frame and drives the source CF's
     * world pose to match targetPose × relativeTransform.
     * @type {Map<string, { sourceId: string, relativeOffset: import('three').Vector3, relativeQuat: import('three').Quaternion }>}
     */
    this._fixedJointTransforms = new Map()
    /**
     * Set of fastened linkIds detected as part of a cycle in the previous frame.
     * Used to debounce the constraintCycleDetected event so it fires only when
     * the cyclic set changes (ADR-035 §2).
     * @type {Set<string>}
     */
    this._prevCyclicLinkIds = new Set()

    // ── Rubber-band link highlight state ──────────────────────────────────────
    /** Entity IDs currently selected (not dragging). Drives link opacity. */
    this._linkSelectedIds = new Set()
    /** Entity IDs currently being grabbed. Drives marching ants + tension. */
    this._dragEntityIds   = new Set()
    /** Accumulates each frame during drag to scroll dash offset. */
    this._dashTimer       = 0
    /**
     * View context for HTML label rendering (camera, renderer, container).
     * Set by AppController.setViewContext() after construction.
     * @type {{ camera: import('three').Camera|null, renderer: import('three').WebGLRenderer|null, container: HTMLElement|null }}
     */
    this._viewContext = { camera: null, renderer: null, container: null }
  }

  /**
   * Provides the camera/renderer/container needed for HTML label projection on
   * CoordinateFrameView. Called once by AppController after construction.
   * @param {{ camera: import('three').Camera, renderer: import('three').WebGLRenderer, container: HTMLElement }} ctx
   */
  setViewContext(ctx) {
    this._viewContext = ctx
  }

  /**
   * Constructs a MeshView wired with the label view context (ADR-070) —
   * the single construction point so no creation path forgets the deps.
   * @returns {MeshView}
   */
  _newMeshView() {
    const { camera = null, renderer = null, container = null } = this._viewContext
    return new MeshView(this._threeScene, camera, renderer, container)
  }

  /** ImportedMeshView twin of _newMeshView (ADR-070). */
  _newImportedMeshView() {
    const { camera = null, renderer = null, container = null } = this._viewContext
    return new ImportedMeshView(this._threeScene, camera, renderer, container)
  }

  /**
   * Pushes the entity's identity (name + IFC classification) into its mesh
   * view — floating label text/accent and base-colour tint (ADR-070).
   * Call after any creation/deserialization path and after setIfcClass.
   * Views without the label interface are skipped via optional calls.
   * @param {object} obj  scene entity
   */
  _syncIdentityVisuals(obj) {
    obj.meshView?.setLabelText?.(obj.name)
    obj.meshView?.setIfcTint?.(getIFCClassEntry(obj.ifcClass ?? null))
  }

  // ── BFF integration (ADR-015, Phase A) ────────────────────────────────────

  /**
   * Initialises the BFF client. Safe to call before/after object operations.
   * Attempts to fetch a dev token; silently skips on network error.
   * @param {string} [baseUrl]  defaults to '/api'
   */
  async connectBff(baseUrl = '/api') {
    this._bff = new BffClient(baseUrl)
    try {
      await this._bff.fetchToken()
    } catch {
      // BFF unreachable — stay in local-only mode
      this._bff = null
    }
  }

  /** true when BFF connection is active. */
  get bffConnected() { return this._bff !== null }

  /** The connected BffClient, or null (ADR-054 grasp walkthrough reads this). */
  get bff() { return this._bff }

  // ── WebSocket Geometry Service (ADR-017, Phase B) ──────────────────────────

  /**
   * Opens a WebSocket channel to the BFF Geometry Service.
   * On `session.ready`, sends `session.resume` with the current remote scene id
   * so the server restores graph state from the DB.
   *
   * `geometry.update` messages are automatically applied to matching MeshView instances.
   * Callers can also subscribe to the underlying WsChannel via `sceneService.wsChannel`.
   *
   * No-ops if BFF is not connected or WS is already open.
   * @returns {WsChannel|null}
   */
  openGeometryChannel() {
    if (!this._bff) return null
    if (this._wsChannel?.isOpen) return this._wsChannel
    this._wsChannel = this._bff.openWs()

    const unsubReady = this._wsChannel.on('session.ready', () => {
      if (this._remoteId) {
        this._wsChannel.send('session.resume', { sceneId: this._remoteId })
      }
    })

    const unsubGeom = this._wsChannel.on('geometry.update', (payload) => {
      this._applyGeometryUpdate(payload)
    })

    const unsubClose = this._wsChannel.on('close', () => {
      console.warn('[SceneService] WS channel closed')
      this.emit('wsDisconnected')
    })

    this._wsUnsubs = [unsubReady, unsubGeom, unsubClose]
    this.emit('wsConnected')
    return this._wsChannel
  }

  /** Closes the WebSocket channel and cleans up handlers. */
  closeGeometryChannel() {
    this._wsUnsubs.forEach(fn => fn())
    this._wsUnsubs = []
    this._bff?.closeWs()
    this._wsChannel = null
  }

  /** Returns the active WsChannel, or null if not opened. */
  get wsChannel() { return this._wsChannel }

  /** true when the geometry WebSocket channel is open. */
  get wsConnected() { return this._wsChannel?.isOpen ?? false }

  /**
   * Applies a geometry.update message from the Geometry Service to the matching
   * scene object's MeshView.
   *
   * Accepts both the legacy plain-array format and the base64 binary format
   * (positionsB64 / normalsB64 / indicesB64) introduced to reduce WS payload size.
   *
   * Phase C: If the objectId is not yet registered in the SceneModel, an
   * ImportedMesh is auto-created (thin-client entity for server-side geometry).
   *
   * @param {{ objectId: string,
   *           positionsB64?: string, normalsB64?: string, indicesB64?: string,
   *           positions?: number[], normals?: number[], indices?: number[] }} payload
   */
  _applyGeometryUpdate({ objectId, positionsB64, normalsB64, indicesB64, positions, normals, indices }) {
    const pos = positionsB64 ? base64ToF32(positionsB64) : positions
    const nrm = normalsB64  ? base64ToF32(normalsB64)   : normals
    const idx = indicesB64  ? base64ToU32(indicesB64)   : indices
    if (!objectId || !pos?.length) return

    let obj = this._model.getObject(objectId)

    // Auto-create an ImportedMesh when the server references an unknown object
    if (!obj) {
      obj = this.createImportedMesh(objectId, `Import_${objectId}`)
    }

    if (obj instanceof ImportedMesh) {
      try {
        obj.meshView.updateGeometryBuffers(pos, nrm, idx)
        // Initialise synthetic AABB corners so grab/move operations work.
        obj.initCorners(obj.meshView.getInitialCorners8())
        this.emit('geometryApplied', { objectId })
      } catch (err) {
        console.error('[SceneService] Failed to apply geometry update:', err)
        this.emit('geometryError', { objectId, message: err.message })
      }
      return
    }

    // Cuboid path: convert flat position array to corner Vector3 array
    const corners = _positionsToCorners(pos)
    if (corners) {
      obj.meshView.updateGeometry(corners)
    }
  }

  /**
   * Saves the current scene to the BFF.
   * Creates a new scene record on the first call; updates it on subsequent calls.
   * No-ops gracefully when BFF is not connected.
   * @param {string} [name]  scene name (defaults to 'Untitled')
   * @returns {Promise<string|null>}  server-assigned scene id, or null on error
   */
  async saveScene(name = 'Untitled') {
    if (!this._bff) return null
    const data = serializeScene(this._model)
    try {
      if (this._remoteId) {
        await this._bff.updateScene(this._remoteId, { name, data })
        return this._remoteId
      }
      const result = await this._bff.saveScene({ name, data })
      this._remoteId = result.id
      return result.id
    } catch (err) {
      if (err instanceof BffUnavailableError) {
        console.warn('[SceneService] BFF unavailable — save skipped:', err.cause)
        return null
      }
      throw err
    }
  }

  /**
   * Loads a scene from the BFF and replaces the current scene.
   * All existing objects are disposed first. Emits objectAdded for each loaded entity.
   * @param {string} sceneId
   * @param {{ camera?: import('three').Camera, renderer?: import('three').WebGLRenderer, container?: HTMLElement }} [viewContext]
   *   Required only when the scene contains MeasureLine objects (for label rendering).
   * @returns {Promise<boolean>}  true on success
   */
  async loadScene(sceneId, viewContext = {}) {
    if (!this._bff) return false
    try {
      const remote = await this._bff.getScene(sceneId)
      this._clearScene()
      const entities = this._deserializeEntities(remote.data, viewContext)
      for (const entity of entities) {
        this._model.addObject(entity)
        this.emit('objectAdded', entity)
      }
      for (const dto of (remote.data.links ?? [])) {
        try {
          // Migrate old linkType field (v1.2) to jointType/semanticType (v1.3)
          const [jt, st] = dto.jointType !== undefined
            ? [dto.jointType ?? null, dto.semanticType]
            : migrateLinkType(dto.linkType)
          const link = new SpatialLink(dto.id, dto.sourceId, dto.targetId, jt, st, dto.properties ?? {})
          this._model.addLink(link)
          this._createLinkView(link)
          this.emit('spatialLinkAdded', link)
        } catch (err) {
          console.warn('[SceneService] loadScene: skipping link', dto.id, err)
        }
      }
      this._remoteId = sceneId

      // Rebuild Solid geometry in parallel via Wasm worker (ADR-027 Phase 2).
      const solids = entities.filter(e => e instanceof Solid)
      await this.batchRebuildSolids(solids)

      // Migration: ensure every Solid has an Origin CF (ADR-037 §6).
      this._ensureOriginFrames(solids)

      // One synchronous world-pose pass so _worldPoseCache is populated, then
      // reactivate geometric constraints (_fixedJointTransforms / _mountLocalPositions).
      this._updateWorldPoses()
      this._reactivateLiveLinks()

      return true
    } catch (err) {
      if (err instanceof BffUnavailableError) {
        console.warn('[SceneService] BFF unavailable — load skipped:', err.cause)
        return false
      }
      throw err
    }
  }

  /**
   * Returns the list of scenes stored on the BFF (metadata only).
   * @returns {Promise<{ id, name, created_at, updated_at }[]>}
   */
  async listScenes() {
    if (!this._bff) return []
    try {
      return await this._bff.listScenes()
    } catch (err) {
      if (err instanceof BffUnavailableError) return []
      throw err
    }
  }

  /**
   * Reconstructs live domain entities from a plain-JSON scene DTO.
   * Kept in SceneService so entity creation (new Solid/Profile/MeshView)
   * stays within the service boundary (ADR-011).
   * @param {object} data  Parsed `data` field from BFF
   * @param {{ camera?: import('three').Camera, renderer?: import('three').WebGLRenderer, container?: HTMLElement }} viewContext
   * @returns {(Solid|Profile|MeasureLine|CoordinateFrame)[]}
   */
  _deserializeEntities(data, viewContext = {}) {
    const entities = []
    for (const dto of (data.objects ?? [])) {
      // Accept both new ('Solid') and legacy ('Cuboid') type strings
      if (dto.type === 'Solid' || dto.type === 'Cuboid') {
        let solid
        if (dto.position && dto.orientation && dto.localCorners) {
          // v1.3+ format: restore primary triple directly via setPose (ADR-040)
          const vertices = Array.from({ length: 8 }, (_, i) => new Vertex(`${dto.id}_v${i}`, new Vector3()))
          solid = new Solid(dto.id, dto.name, vertices, this._newMeshView())
          solid.setPose(
            new Vector3(dto.position.x, dto.position.y, dto.position.z),
            new Quaternion(dto.orientation.x, dto.orientation.y, dto.orientation.z, dto.orientation.w),
            dto.localCorners.map(lc => new Vector3(lc.x, lc.y, lc.z))
          )
        } else {
          // Legacy format: vertices are world corners; bodyRotation may be non-identity
          const vertices = dto.vertices.map(v => new Vertex(v.id, new Vector3(v.x, v.y, v.z)))
          solid = new Solid(dto.id, dto.name, vertices, this._newMeshView())
          if (dto.bodyRotation) {
            // _initFromWorldCorners stored localCorners as (worldCorner - centroid), which is the
            // world-space offset, not the body-frame offset. De-rotate to fix them (ADR-040).
            const q    = new Quaternion(dto.bodyRotation.x, dto.bodyRotation.y, dto.bodyRotation.z, dto.bodyRotation.w)
            const invQ = q.clone().invert()
            for (let i = 0; i < 8; i++) solid.localCorners[i].applyQuaternion(invQ)
            // _position is already correct (centroid from _initFromWorldCorners).
            // restorePose() sets orientation and rebuilds world corners via the public API.
            solid.restorePose(solid._position, q)
          }
        }
        solid.description = dto.description ?? ''
        solid.ifcClass    = dto.ifcClass    ?? null
        this._syncIdentityVisuals(solid)
        // Geometry is rebuilt asynchronously by batchRebuildSolids() after all
        // entities are created — see loadScene() / importFromJson().
        entities.push(solid)
      // Accept both new ('Profile') and legacy ('Sketch') type strings
      } else if (dto.type === 'Profile' || dto.type === 'Sketch') {
        const meshView = this._newMeshView()
        meshView.setVisible(false)
        const profile = new Profile(dto.id, dto.name, meshView)
        profile.description = dto.description ?? ''
        if (dto.sketchRect) {
          const p1 = new Vector3(dto.sketchRect.p1.x, dto.sketchRect.p1.y, dto.sketchRect.p1.z)
          const p2 = new Vector3(dto.sketchRect.p2.x, dto.sketchRect.p2.y, dto.sketchRect.p2.z)
          profile.setRect(p1, p2)
        }
        this._syncIdentityVisuals(profile)
        entities.push(profile)
      } else if (dto.type === 'MeasureLine') {
        const { camera, renderer, container = document.body } = viewContext
        if (!camera || !renderer) continue  // skip if no view context
        const p1 = new Vector3(dto.p1.x, dto.p1.y, dto.p1.z)
        const p2 = new Vector3(dto.p2.x, dto.p2.y, dto.p2.z)
        const v0 = new Vertex(`${dto.id}_v0`, p1)
        const v1 = new Vertex(`${dto.id}_v1`, p2)
        if (dto.anchorRef0) v0.anchorRef = dto.anchorRef0
        if (dto.anchorRef1) v1.anchorRef = dto.anchorRef1
        const e0 = new Edge(`${dto.id}_e0`, v0, v1)
        const meshView = new MeasureLineView(this._threeScene, container, camera, renderer)
        const entity   = new MeasureLine(dto.id, dto.name, [v0, v1], [e0], meshView)
        meshView.update(entity.p1, entity.p2)
        entities.push(entity)
      } else if (dto.type === 'ImportedMesh') {
        const meshView  = this._newImportedMeshView()
        const entity    = new ImportedMesh(dto.id, dto.name, meshView)
        entity.ifcClass = dto.ifcClass ?? null
        const positions = base64ToF32(dto.positions)
        const normals   = dto.normals  ? base64ToF32(dto.normals)  : null
        const indices   = dto.indices  ? base64ToU32(dto.indices)  : null
        meshView.updateGeometryBuffers(positions, normals, indices)
        if (dto.offset) {
          meshView.cuboid.position.set(dto.offset.x, dto.offset.y, dto.offset.z)
          meshView.updateBoxHelper()
        }
        entity.initCorners(meshView.getInitialCorners8())
        this._syncIdentityVisuals(entity)
        entities.push(entity)
      } else if (dto.type === 'CoordinateFrame') {
        const { camera: cfCam = null, renderer: cfRnd = null, container: cfCnt = null } = viewContext
        const meshView = new CoordinateFrameView(this._threeScene, cfCam, cfRnd, cfCnt)
        meshView.setLabelText(dto.name)
        const frame    = new CoordinateFrame(dto.id, dto.name, dto.parentId, meshView)
        if (dto.translation) {
          frame.translation.set(dto.translation.x, dto.translation.y, dto.translation.z)
        }
        if (dto.rotation) {
          frame.rotation.set(dto.rotation.x, dto.rotation.y, dto.rotation.z, dto.rotation.w)
        }
        // Restore provenance field (ADR-034 §8.4, backward-compatible: null on missing key)
        if (dto.declaredBy === 'modeller' || dto.declaredBy === 'integrator') {
          frame.declaredBy = dto.declaredBy
        }
        entities.push(frame)
      } else if (dto.type === 'AnnotatedLine') {
        const { camera = null, renderer = null, container = document.body } = viewContext
        const points  = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
        const meshView = new AnnotatedLineView(this._threeScene, points, dto.placeType ?? null, renderer, camera, container, dto.name ?? '')
        const entity   = AnnotatedLine.fromPoints(dto.id, dto.name, points, meshView)
        entity.description = dto.description ?? ''
        entity.placeType   = dto.placeType   ?? null
        if (entity.placeType) meshView.setPlaceType(entity.placeType)
        entities.push(entity)
      } else if (dto.type === 'AnnotatedRegion') {
        const { camera = null, renderer = null, container = document.body } = viewContext
        const points  = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
        const meshView = new AnnotatedRegionView(this._threeScene, points, dto.placeType ?? null, renderer, camera, container, dto.name ?? '')
        const entity   = AnnotatedRegion.fromPoints(dto.id, dto.name, points, meshView)
        entity.description = dto.description ?? ''
        entity.placeType   = dto.placeType   ?? null
        if (entity.placeType) meshView.setPlaceType(entity.placeType)
        entities.push(entity)
      } else if (dto.type === 'AnnotatedPoint') {
        const { camera = null, renderer = null, container = document.body } = viewContext
        const point  = new Vector3(dto.vertex.x, dto.vertex.y, dto.vertex.z)
        const meshView = new AnnotatedPointView(
          this._threeScene, camera, container, renderer, point, dto.name, dto.placeType ?? null,
        )
        const entity  = AnnotatedPoint.fromPoint(dto.id, dto.name, point, meshView)
        entity.description = dto.description ?? ''
        entity.placeType   = dto.placeType   ?? null
        if (entity.placeType) meshView.setPlaceType(entity.placeType, entity.name)
        entities.push(entity)
      }
    }
    return entities
  }

  /**
   * Imports a parsed scene JSON (from SceneImporter.parseImportJson) into the scene.
   *
   * - clear=true  → clears the current scene first (replaces it)
   * - clear=false → merges into the current scene; all IDs are remapped to avoid collisions
   *
   * CoordinateFrames that appear as standalone objects in the export JSON are
   * imported; the `attachedFrames` arrays inside each parent entry are ignored
   * (they are informational duplicates).
   *
   * ImportedMesh objects are imported only when the export JSON contains a
   * `geometry` field (v1.1+); they are silently skipped otherwise.
   *
   * Emits: 'objectAdded' for each successfully reconstructed entity.
   *
   * @param {{ version: string, objects: object[] }} parsed  output of parseImportJson()
   * @param {{ camera?: import('three').Camera, renderer?: import('three').WebGLRenderer, container?: HTMLElement }} viewContext
   * @param {{ clear?: boolean }} [options]
   * @returns {{ imported: number, skipped: number }}
   */
  async importFromJson(parsed, viewContext = {}, { clear = true } = {}) {
    if (clear) this._clearScene()

    // When merging, build an id-remap table so imported IDs never collide.
    // When clearing first, reuse original IDs (simpler undo story).
    const idMap = new Map()   // originalId → newId
    const remapId = (origId) => {
      if (clear) return origId
      if (!idMap.has(origId)) idMap.set(origId, `imp_${idMap.size}_${Date.now()}`)
      return idMap.get(origId)
    }

    // Filter out standalone CoordinateFrame entries — process them after their parents
    const nonFrames = parsed.objects.filter(o => o.type !== 'CoordinateFrame')
    const frames    = parsed.objects.filter(o => o.type === 'CoordinateFrame')

    let imported = 0
    let skipped  = 0
    const solids = []

    for (const dto of [...nonFrames, ...frames]) {
      try {
        const entity = this._reconstructEntity(dto, viewContext, remapId)
        if (!entity) { skipped++; continue }
        this._model.addObject(entity)
        this.emit('objectAdded', entity)
        if (entity instanceof Solid) solids.push(entity)
        imported++
      } catch (err) {
        console.warn('[SceneService] importFromJson: skipping entry', dto.id, err)
        skipped++
      }
    }

    // Rebuild Solid geometry in parallel via Wasm worker (ADR-027 Phase 2).
    await this.batchRebuildSolids(solids)

    // Migration: ensure every Solid has an Origin CF (ADR-037 §6).
    this._ensureOriginFrames(solids)

    // Import SpatialLinks (v1.2+); silently skip on older exports.
    for (const dto of (parsed.links ?? [])) {
      try {
        // Migrate old linkType field (v1.2) to jointType/semanticType (v1.3)
        const [jt, st] = dto.jointType !== undefined
          ? [dto.jointType ?? null, dto.semanticType]
          : migrateLinkType(dto.linkType)
        const link = new SpatialLink(
          remapId(dto.id),
          remapId(dto.sourceId),
          remapId(dto.targetId),
          jt,
          st,
          dto.properties ?? {},
        )
        this._model.addLink(link)
        this._createLinkView(link)
        this.emit('spatialLinkAdded', link)
        imported++
      } catch (err) {
        console.warn('[SceneService] importFromJson: skipping link', dto.id, err)
        skipped++
      }
    }

    // One synchronous world-pose pass so _worldPoseCache is populated, then
    // reactivate geometric constraints for any imported fastened / mounts links.
    this._updateWorldPoses()
    this._reactivateLiveLinks()

    return { imported, skipped }
  }

  /**
   * Rebuilds cuboid geometry for multiple Solid objects in parallel using the
   * Wasm worker (ADR-027 Phase 2).  Falls back to the synchronous JS path
   * automatically when the Wasm worker is unavailable.
   *
   * Emits progress events so the UI can display a spinner when N > BATCH_PROGRESS_THRESHOLD:
   *   'batchRebuildStart'    { total: number }
   *   'batchRebuildProgress' { done: number, total: number }
   *   'batchRebuildEnd'
   *
   * @param {import('../domain/Solid.js').Solid[]} solids
   * @returns {Promise<void>}
   */
  async batchRebuildSolids(solids) {
    const BATCH_PROGRESS_THRESHOLD = 3
    const total = solids.length
    if (total === 0) return

    const showProgress = total > BATCH_PROGRESS_THRESHOLD
    if (showProgress) this.emit('batchRebuildStart', { total })

    let done = 0
    await Promise.all(solids.map(async (solid) => {
      await solid.meshView.rebuildGeometry(solid.corners)
      done++
      if (showProgress) this.emit('batchRebuildProgress', { done, total })
    }))

    if (showProgress) this.emit('batchRebuildEnd')
  }

  /**
   * Reconstructs a single domain entity from an export-format DTO.
   * Returns null when the entry should be skipped (e.g. ImportedMesh without geometry).
   * @private
   */
  _reconstructEntity(dto, viewContext, remapId) {
    const newId = remapId(dto.id)

    if (dto.type === 'Solid') {
      let solid
      if (dto.position && dto.orientation && dto.localCorners) {
        // v1.3+ format (e.g. compileLayout output): restore the primary triple
        // directly via setPose (ADR-040) — mirrors _deserializeEntities.
        const vertices = Array.from({ length: 8 }, (_, i) => new Vertex(`${newId}_v${i}`, new Vector3()))
        solid = new Solid(newId, dto.name ?? 'Solid', vertices, this._newMeshView())
        solid.setPose(
          new Vector3(dto.position.x, dto.position.y, dto.position.z),
          new Quaternion(dto.orientation.x, dto.orientation.y, dto.orientation.z, dto.orientation.w),
          dto.localCorners.map(lc => new Vector3(lc.x, lc.y, lc.z))
        )
      } else {
        // Legacy format: vertices are world corners
        const vertices = dto.vertices.map((v, i) =>
          new Vertex(remapId(v.id) || `${newId}_v${i}`, new Vector3(v.x, v.y, v.z))
        )
        solid = new Solid(newId, dto.name ?? 'Solid', vertices, this._newMeshView())
      }
      solid.description = dto.description ?? ''
      solid.ifcClass    = dto.ifcClass    ?? null
      this._syncIdentityVisuals(solid)
      // Geometry is rebuilt asynchronously by batchRebuildSolids() — see importFromJson().
      return solid
    }

    if (dto.type === 'Profile') {
      const meshView = this._newMeshView()
      meshView.setVisible(false)
      const profile = new Profile(newId, dto.name ?? 'Profile', meshView)
      profile.description = dto.description ?? ''
      if (dto.sketchRect) {
        const p1 = new Vector3(dto.sketchRect.p1.x, dto.sketchRect.p1.y, dto.sketchRect.p1.z)
        const p2 = new Vector3(dto.sketchRect.p2.x, dto.sketchRect.p2.y, dto.sketchRect.p2.z)
        profile.setRect(p1, p2)
      }
      this._syncIdentityVisuals(profile)
      return profile
    }

    if (dto.type === 'MeasureLine') {
      const { camera, renderer, container = document.body } = viewContext
      if (!camera || !renderer) return null
      const p1 = new Vector3(dto.p1.x, dto.p1.y, dto.p1.z)
      const p2 = new Vector3(dto.p2.x, dto.p2.y, dto.p2.z)
      const v0 = new Vertex(`${newId}_v0`, p1)
      const v1 = new Vertex(`${newId}_v1`, p2)
      if (dto.anchorRef0) v0.anchorRef = dto.anchorRef0
      if (dto.anchorRef1) v1.anchorRef = dto.anchorRef1
      const e0 = new Edge(`${newId}_e0`, v0, v1)
      const meshView = new MeasureLineView(this._threeScene, container, camera, renderer)
      const entity   = new MeasureLine(newId, dto.name ?? 'Measure', [v0, v1], [e0], meshView)
      meshView.update(entity.p1, entity.p2)
      return entity
    }

    if (dto.type === 'ImportedMesh') {
      if (!dto.geometry?.positions) return null   // v1.0 export — no buffers, skip
      const meshView  = this._newImportedMeshView()
      const entity    = new ImportedMesh(newId, dto.name ?? 'ImportedMesh', meshView)
      entity.ifcClass = dto.ifcClass ?? null
      const positions = base64ToF32(dto.geometry.positions)
      const normals   = dto.geometry.normals ? base64ToF32(dto.geometry.normals) : null
      const indices   = dto.geometry.indices ? base64ToU32(dto.geometry.indices) : null
      meshView.updateGeometryBuffers(positions, normals, indices)
      if (dto.offset) {
        meshView.cuboid.position.set(dto.offset.x, dto.offset.y, dto.offset.z)
        meshView.updateBoxHelper()
      }
      entity.initCorners(meshView.getInitialCorners8())
      this._syncIdentityVisuals(entity)
      return entity
    }

    if (dto.type === 'CoordinateFrame') {
      const newParentId = remapId(dto.parentId)
      // Skip if parent is not present in the scene (e.g. ImportedMesh that was skipped)
      if (!this._model.getObject(newParentId)) return null
      const { camera: cfCam = null, renderer: cfRnd = null, container: cfCnt = null } = viewContext
      const meshView = new CoordinateFrameView(this._threeScene, cfCam, cfRnd, cfCnt)
      const cfName   = dto.name ?? 'Frame'
      meshView.setLabelText(cfName)
      const frame    = new CoordinateFrame(newId, cfName, newParentId, meshView)
      if (dto.translation) {
        frame.translation.set(dto.translation.x, dto.translation.y, dto.translation.z)
      }
      if (dto.rotation) {
        frame.rotation.set(dto.rotation.x, dto.rotation.y, dto.rotation.z, dto.rotation.w)
      }
      if (dto.declaredBy === 'modeller' || dto.declaredBy === 'integrator') {
        frame.declaredBy = dto.declaredBy
      }
      return frame
    }

    if (dto.type === 'AnnotatedLine') {
      const { camera = null, renderer = null, container = document.body } = viewContext
      const lineName = dto.name ?? 'Line'
      const points   = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
      const meshView = new AnnotatedLineView(this._threeScene, points, dto.placeType ?? null, renderer, camera, container, lineName)
      const entity   = AnnotatedLine.fromPoints(newId, lineName, points, meshView)
      entity.description = dto.description ?? ''
      entity.placeType   = dto.placeType   ?? null
      if (entity.placeType) meshView.setPlaceType(entity.placeType)
      return entity
    }

    if (dto.type === 'AnnotatedRegion') {
      const { camera = null, renderer = null, container = document.body } = viewContext
      const regionName = dto.name ?? 'Region'
      const points   = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
      const meshView = new AnnotatedRegionView(this._threeScene, points, dto.placeType ?? null, renderer, camera, container, regionName)
      const entity   = AnnotatedRegion.fromPoints(newId, regionName, points, meshView)
      entity.description = dto.description ?? ''
      entity.placeType   = dto.placeType   ?? null
      if (entity.placeType) meshView.setPlaceType(entity.placeType)
      return entity
    }

    if (dto.type === 'AnnotatedPoint') {
      const { camera = null, renderer = null, container = document.body } = viewContext
      const point    = new Vector3(dto.vertex.x, dto.vertex.y, dto.vertex.z)
      const meshView = new AnnotatedPointView(
        this._threeScene, camera, container, renderer, point, dto.name ?? 'Point', dto.placeType ?? null,
      )
      const entity   = AnnotatedPoint.fromPoint(newId, dto.name ?? 'Point', point, meshView)
      entity.description = dto.description ?? ''
      entity.placeType   = dto.placeType   ?? null
      if (entity.placeType) meshView.setPlaceType(entity.placeType, entity.name)
      return entity
    }

    return null
  }

  /** Disposes all objects and links, then resets the model (local). */
  _clearScene() {
    for (const [id, obj] of this._model.objects) {
      obj.meshView.dispose(this._threeScene)
      this.emit('objectRemoved', id, obj)
    }
    for (const [id] of this._model.links) {
      this._linkViews.get(id)?.dispose(this._threeScene)
      this.emit('spatialLinkRemoved', id)
    }
    this._linkViews.clear()
    this._worldPoseCache.clear()
    this._mountLocalPositions.clear()
    this._fixedJointTransforms.clear()
    this._model = new SceneModel()
  }

  // ── Aggregate root access ──────────────────────────────────────────────────

  /** Read access to the aggregate root (SceneModel). */
  get scene() { return this._model }

  // ── World pose query (ADR-020) ─────────────────────────────────────────────

  /**
   * Returns the world pose for a CoordinateFrame.
   * On a cache miss (empty cache or unknown id), eagerly runs _updateWorldPoses()
   * so callers that run synchronously before the animation loop — Outliner selection,
   * _promptAddFrame, pointer-down handlers, etc. — always get a valid pose instead
   * of null.  Redundant calls within a single frame are cheap (O(frames) recompute).
   * @param {string} frameId
   * @returns {{ position: import('three').Vector3, quaternion: import('three').Quaternion }|null}
   */
  worldPoseOf(frameId) {
    if (!this._worldPoseCache.has(frameId)) this._updateWorldPoses()
    return this._worldPoseCache.get(frameId) ?? null
  }

  /**
   * Returns the world-space quaternion of a CoordinateFrame's parent.
   * For a Solid parent: Solid.bodyRotation.
   * For a CF parent: cache entry quaternion (world).
   * @param {import('../domain/CoordinateFrame.js').CoordinateFrame} frame
   * @returns {import('three').Quaternion}
   */
  _getParentWorldQuat(frame) {
    const parent = this._model.getObject(frame.parentId)
    if (!parent) return new Quaternion()
    if (parent instanceof CoordinateFrame) {
      const cached = this._worldPoseCache.get(parent.id)
      return cached ? cached.quaternion.clone() : new Quaternion()
    }
    // Solid parent
    return parent.orientation.clone()
  }

  /**
   * Returns the world-space position of a CoordinateFrame's parent origin.
   * For a Solid parent: _position (authoritative, exact — PHILOSOPHY #24).
   * For a CF parent: cache entry position.
   * @param {import('../domain/CoordinateFrame.js').CoordinateFrame} frame
   * @returns {import('three').Vector3}
   */
  _getParentWorldPos(frame) {
    const parent = this._model.getObject(frame.parentId)
    if (!parent) return new Vector3()
    if (parent instanceof CoordinateFrame) {
      const cached = this._worldPoseCache.get(parent.id)
      return cached ? cached.position.clone() : new Vector3()
    }
    // Solid parent: ADR-040 _position is the authoritative exact centroid (PHILOSOPHY #24).
    // Never use avg(corners) — FP rounding accumulates each frame and causes slow divergence.
    return parent._position.clone()
  }

  /**
   * Recomputes and caches the world pose for every CoordinateFrame in the scene.
   * Must be called once per animation frame (from AppController animation loop).
   *
   * Position model (ROS TF): worldPos = parentWorldPos + parentWorldQuat * localTranslation
   *
   * Frames are processed in topological order (shallow before deep) so nested
   * frame chains (ADR-019) propagate correctly in a single pass.
   * Since move() now directly updates `translation`, no grabbed/not-grabbed
   * branching is needed — worldPos is always derived from translation.
   */
  _updateWorldPoses() {
    // Purge stale entries from removed entities before recomputing (PHILOSOPHY #24).
    this._worldPoseCache.clear()

    const allFrames = [...this._model.objects.values()].filter(o => o instanceof CoordinateFrame)

    // Topological sort: parents before children (by depth)
    const depthCache = new Map()
    const getDepth = (frame) => {
      if (depthCache.has(frame.id)) return depthCache.get(frame.id)
      const parent = this._model.getObject(frame.parentId)
      const d = (parent instanceof CoordinateFrame) ? getDepth(parent) + 1 : 0
      depthCache.set(frame.id, d)
      return d
    }
    allFrames.sort((a, b) => getDepth(a) - getDepth(b))

    for (const frame of allFrames) {
      const parent = this._model.getObject(frame.parentId)
      if (!parent) continue

      // ROS TF forward kinematics: worldPose = parentWorldPose * localTransform
      // worldPos  = parentWorldPos  + parentWorldQuat * frame.translation
      // worldQuat = parentWorldQuat * frame.rotation
      // (PHILOSOPHY #21, CODE_CONTRACTS architecture.md)
      /** @type {import('../types/spatial.js').WorldVector3|null} */
      let parentWorldPos  = null
      let parentWorldQuat = null
      if (parent instanceof CoordinateFrame) {
        const cached = this._worldPoseCache.get(parent.id)
        if (!cached) continue               // parent not yet resolved (shouldn't happen after sort)
        parentWorldPos  = cached.position.clone()
        parentWorldQuat = cached.quaternion.clone()
      } else {
        // Solid parent: ADR-040 _position is the authoritative exact centroid (PHILOSOPHY #24).
        // Clone so that downstream applyQuaternion / add calls never mutate the Solid's own Vector3.
        parentWorldPos  = /** @type {any} */ (parent._position.clone())
        parentWorldQuat = parent.orientation.clone()
      }

      // Local translation expressed in parent frame → rotate into world space
      /** @type {import('../types/spatial.js').WorldVector3} */
      const worldPos  = /** @type {any} */ (parentWorldPos.clone().add(
        frame.translation.clone().applyQuaternion(parentWorldQuat)
      ))
      const worldQuat = parentWorldQuat.clone().multiply(frame.rotation)

      // Cache was cleared at start of this method — always set fresh entries.
      this._worldPoseCache.set(frame.id, { position: worldPos, quaternion: worldQuat })

      // Update view
      frame.meshView.updatePosition(worldPos)
      frame.meshView.updateRotation(worldQuat)
      frame.meshView.updateConnectionLine(parentWorldPos)
    }

    // Re-resolve all anchored MeasureLine endpoints so they follow their
    // referenced geometry elements (ADR-028).
    this._updateAnchoredMeasures()

    // Reposition mounted Annotated* entities (ADR-032 Phase H-2).
    // Must run after all CoordinateFrame poses are resolved.
    this._updateMountedAnnotations()

    // Drive fastened CoordinateFrame pairs (ADR-032 §2, 'fastened').
    // Must run after all CoordinateFrame poses are resolved.
    this._updateFixedJointFrames()

    // Reposition SpatialLink dashed lines between entity world centroids (ADR-030).
    this._updateSpatialLinkViews()
  }

  /**
   * Recomputes the world position of every anchored MeasureLine vertex.
   * Called once per animation frame at the end of _updateWorldPoses().
   * If the referenced object or element no longer exists the vertex stays at
   * its last known position (no crash, silent degradation).
   */
  _updateAnchoredMeasures() {
    for (const obj of this._model.objects.values()) {
      if (!(obj instanceof MeasureLine)) continue
      let needsUpdate = false
      for (const vertex of obj.vertices) {
        if (!vertex.anchorRef) continue
        const anchored = this._model.getObject(vertex.anchorRef.objectId)
        if (!anchored) continue
        const newPos = this._resolveAnchorPosition(vertex.anchorRef, anchored)
        if (newPos) {
          vertex.position.copy(newPos)
          needsUpdate = true
        }
      }
      if (needsUpdate) obj.meshView.update(obj.p1, obj.p2)
    }
  }

  // ── Geometric Host Binding — mounts coordinate transform (ADR-032 Phase H-2) ─

  /**
   * Recomputes world-space vertex positions for all mounted Annotated* entities.
   * Called once per animation frame at the end of _updateWorldPoses(), after all
   * CoordinateFrame poses have been resolved into _worldPoseCache.
   *
   * For each mounts link:
   *   vertex.position[i] = H × localPositions[i]
   * where H is the host CoordinateFrame's world pose (position + quaternion).
   *
   * This keeps vertex.position in world coords at all times — the local positions
   * are stored separately in _mountLocalPositions.
   */
  _updateMountedAnnotations() {
    for (const [linkId, { sourceId, localPositions }] of this._mountLocalPositions) {
      const source = this._model.getObject(sourceId)
      const link   = this._model.getLink(linkId)
      if (!source || !link) continue

      const pose = this._worldPoseCache.get(link.targetId)
      if (!pose) continue  // host CF not yet resolved — skip this frame

      // Pack pose + local points into flat array for Wasm.
      // Layout: [px,py,pz, qx,qy,qz,qw, lx0,ly0,lz0, ...] = 7 + 3*n f32
      const n = localPositions.length
      const inputFlat = new Float32Array(7 + n * 3)
      inputFlat[0] = pose.position.x;    inputFlat[1] = pose.position.y;    inputFlat[2] = pose.position.z
      inputFlat[3] = pose.quaternion.x;  inputFlat[4] = pose.quaternion.y;  inputFlat[5] = pose.quaternion.z;  inputFlat[6] = pose.quaternion.w
      for (let j = 0; j < n; j++) {
        const lp = localPositions[j]
        inputFlat[7 + j * 3] = lp.x;  inputFlat[8 + j * 3] = lp.y;  inputFlat[9 + j * 3] = lp.z
      }

      // worldPos = H × localPos = q.rotate(localPos) + position  (Wasm or JS fallback)
      const worldPts = constraintSolver.applyPoseToPoints(inputFlat)

      // Build corners array and write world coords back to vertex.position
      const corners = []
      for (let j = 0; j < n; j++) {
        corners.push(new Vector3(worldPts[j * 3], worldPts[j * 3 + 1], worldPts[j * 3 + 2]))
      }
      source.vertices.forEach((v, i) => { if (corners[i]) v.position.copy(corners[i]) })
      source.meshView.updateGeometry(corners)
      if (source.meshView.boxHelper?.visible) source.meshView.updateBoxHelper()
    }
  }

  // ── Geometric Host Binding — mount / unmount operations (ADR-032 H-2/H-3) ──

  /**
   * Mounts an Annotated* entity onto a CoordinateFrame target.
   *
   * Coordinate transform (one-time):
   *   localPos = H⁻¹ × worldPos   (H = host frame's current world pose)
   * The local positions are stored in _mountLocalPositions and are used
   * every frame by _updateMountedAnnotations() to recompute world positions.
   *
   * Returns the created SpatialLink and the world positions before mounting
   * (needed by MountAnnotationCommand for undo).
   *
   * @param {string} sourceId   ID of an Annotated* entity
   * @param {string} targetCFId ID of a CoordinateFrame entity
   * @returns {{ link: SpatialLink, worldPositionsBefore: import('three').Vector3[] }|null}
   */
  mountAnnotation(sourceId, targetCFId) {
    const source = this._model.getObject(sourceId)
    const target = this._model.getObject(targetCFId)
    if (!source || !(target instanceof CoordinateFrame)) return null
    if (!(source instanceof AnnotatedLine) && !(source instanceof AnnotatedRegion) && !(source instanceof AnnotatedPoint)) return null

    const pose = this._worldPoseCache.get(targetCFId)
    if (!pose) return null  // host pose unknown — refuse to mount

    // Snapshot world positions before transform
    const worldPositionsBefore = source.vertices.map(v => v.position.clone())

    // H⁻¹: conjugate quaternion + adjusted translation
    const invQ = pose.quaternion.clone().conjugate()
    const localPositions = worldPositionsBefore.map(wp =>
      wp.clone().sub(pose.position).applyQuaternion(invQ),
    )

    // Create the mounts link
    const link = this.createSpatialLink(sourceId, targetCFId, 'fixed', 'mounts')

    // Store local positions for per-frame update
    this._mountLocalPositions.set(link.id, { sourceId, localPositions })

    return { link, worldPositionsBefore }
  }

  /**
   * Reverses a mount operation (undo / unmount UI).
   * Removes the local-position entry and the SpatialLink, then restores the
   * entity's vertex positions to the given world coords.
   *
   * @param {SpatialLink} link                      The mounts SpatialLink to remove
   * @param {import('three').Vector3[]} worldPositionsBefore  World positions before mount
   */
  unmountAnnotation(link, worldPositionsBefore) {
    const source = this._model.getObject(link.sourceId)
    this._mountLocalPositions.delete(link.id)
    this.detachSpatialLink(link.id)
    if (source) {
      source.vertices.forEach((v, i) => { if (worldPositionsBefore[i]) v.position.copy(worldPositionsBefore[i]) })
      source.meshView.updateGeometry(source.corners)
      if (source.meshView.boxHelper?.visible) source.meshView.updateBoxHelper()
    }
  }

  /**
   * Re-applies a mount after undo (redo path).
   * The entity's vertices are expected to be back at worldPositionsBefore.
   *
   * @param {SpatialLink} link                      The original mounts SpatialLink
   * @param {import('three').Vector3[]} worldPositionsBefore  World positions to re-transform from
   */
  remountAnnotation(link, worldPositionsBefore) {
    const target = this._model.getObject(link.targetId)
    if (!(target instanceof CoordinateFrame)) return

    const pose = this._worldPoseCache.get(link.targetId)
    if (!pose) return

    const invQ = pose.quaternion.clone().conjugate()
    const localPositions = worldPositionsBefore.map(wp =>
      wp.clone().sub(pose.position).applyQuaternion(invQ),
    )

    // Re-attach the link
    this.reattachSpatialLink(link)
    this._mountLocalPositions.set(link.id, { sourceId: link.sourceId, localPositions })
  }

  /**
   * Recomputes the mount local positions for a mounted entity from its current
   * world-space vertex positions.  Must be called after any direct modification
   * of vertex.position (e.g. MoveCommand undo/redo) to keep _mountLocalPositions
   * consistent with the entity's new world location.
   *
   * No-op if the entity has no mounts link or if the host pose is unknown.
   * @param {string} sourceId
   */
  syncMountedPosition(sourceId) {
    const mountLink = this._model.getMountsLink(sourceId)
    if (!mountLink) return
    const pose = this._worldPoseCache.get(mountLink.targetId)
    if (!pose) return
    const source = this._model.getObject(sourceId)
    if (!source) return
    const invQ = pose.quaternion.clone().conjugate()
    const localPositions = source.vertices.map(v =>
      v.position.clone().sub(pose.position).applyQuaternion(invQ),
    )
    this._mountLocalPositions.set(mountLink.id, { sourceId, localPositions })
  }

  // ── Geometric Host Binding — fastened constraint (ADR-032 §2, 'fastened') ──

  /**
   * Drives each fastened CoordinateFrame's world pose every animation frame.
   * Called after all parentId-chain poses are resolved in _updateWorldPoses().
   *
   * For each fastened link (source CF → target CF):
   *   sourceWorldPos  = targetPos + targetQuat.apply(relativeOffset)
   *   sourceWorldQuat = targetQuat × relativeQuat
   *
   * The derived world pose is written back to source.translation and source.rotation
   * so the existing cache / view update path remains correct.
   *
   * Limitation: if the source CF has CoordinateFrame children in the parentId tree,
   * those children's poses were already computed with the pre-constraint values.
   * Single-level fastening (no CF-of-CF chains) is the expected use case.
   */
  /**
   * Walks up the CoordinateFrame parent chain from the given CF and returns the
   * root Solid (first non-CF ancestor that has corners) and the ordered list of
   * intermediate CFs from the root-side child down to the CF's direct parent.
   *
   * chain[0] = direct child of rootSolid, chain[last] = direct parent of cfId CF.
   * When cfId's parent is directly the rootSolid, chain is empty.
   * rootSolid is null if the chain leads to an object without corners.
   *
   * @param {string} cfId
   * @returns {{ rootSolid: import('../domain/Solid.js').Solid|null, chain: CoordinateFrame[] }}
   */
  _findAncestorChain(cfId) {
    const cf = this._model.getObject(cfId)
    const chain = []
    let node = this._model.getObject(cf.parentId)
    while (node instanceof CoordinateFrame) {
      chain.unshift(node)
      node = this._model.getObject(node.parentId)
    }
    const rootSolid = (node instanceof Solid) ? node : null
    return { rootSolid, chain }
  }

  /**
   * Detects cycles in the Solid-to-Solid fastened constraint graph (ADR-035 §2).
   * Each fastened link is projected to an edge between root Solids; a DFS finds
   * back-edges and returns their linkIds.
   *
   * @param {Array<[string, {sourceId: string}]>} entries  validated fastened entries
   * @returns {Set<string>} linkIds that form back-edges (cyclic)
   */
  _detectFastenedCycles(entries) {
    const adj = new Map()  // solidId → [{to: solidId, linkId}]
    for (const [linkId, { sourceId }] of entries) {
      const link = this._model.getLink(linkId)
      if (!link) continue
      const { rootSolid: srcRoot } = this._findAncestorChain(sourceId)
      const { rootSolid: tgtRoot } = this._findAncestorChain(link.targetId)
      if (!srcRoot || !tgtRoot || srcRoot.id === tgtRoot.id) continue
      if (!adj.has(srcRoot.id)) adj.set(srcRoot.id, [])
      adj.get(srcRoot.id).push({ to: tgtRoot.id, linkId })
    }

    const visited = new Set()
    const stack   = new Set()
    const cyclic  = new Set()

    const dfs = (nodeId) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)
      stack.add(nodeId)
      for (const { to, linkId } of (adj.get(nodeId) || [])) {
        if (stack.has(to)) {
          cyclic.add(linkId)
        } else {
          dfs(to)
        }
      }
      stack.delete(nodeId)
    }

    for (const nodeId of adj.keys()) {
      if (!visited.has(nodeId)) dfs(nodeId)
    }
    return cyclic
  }

  _updateFixedJointFrames() {
    // Filter to valid, solvable constraints
    const entries = []
    for (const entry of this._fixedJointTransforms.entries()) {
      const [linkId, { sourceId }] = entry
      const link   = this._model.getLink(linkId)
      const source = this._model.getObject(sourceId)
      if (!link || !(source instanceof CoordinateFrame)) continue
      if (!this._worldPoseCache.has(link.targetId)) continue
      entries.push(entry)
    }
    if (entries.length === 0) return

    // § 2 — Cycle detection (ADR-035): skip cyclic links and notify once per change
    const cyclic = this._detectFastenedCycles(entries)
    const cyclicChanged =
      cyclic.size !== this._prevCyclicLinkIds.size ||
      [...cyclic].some(id => !this._prevCyclicLinkIds.has(id))
    if (cyclicChanged) {
      this._prevCyclicLinkIds = new Set(cyclic)
      if (cyclic.size > 0) {
        this.emit('constraintCycleDetected')
      }
    }
    const acyclicEntries = cyclic.size > 0 ? entries.filter(([id]) => !cyclic.has(id)) : entries
    if (acyclicEntries.length === 0) return

    // Pack math inputs into a flat Float32Array for Wasm (or JS fallback).
    // Layout per constraint: [relOffXYZ, relQxyzw, targetPosXYZ, targetQxyzw] = 14 f32
    const inputFlat = new Float32Array(acyclicEntries.length * 14)
    for (let i = 0; i < acyclicEntries.length; i++) {
      const [linkId, { relativeOffset, relativeQuat }] = acyclicEntries[i]
      const targetPose = this._worldPoseCache.get(this._model.getLink(linkId).targetId)
      const b = i * 14
      inputFlat[b]     = relativeOffset.x;    inputFlat[b + 1]  = relativeOffset.y;    inputFlat[b + 2]  = relativeOffset.z
      inputFlat[b + 3] = relativeQuat.x;      inputFlat[b + 4]  = relativeQuat.y;      inputFlat[b + 5]  = relativeQuat.z;     inputFlat[b + 6]  = relativeQuat.w
      inputFlat[b + 7] = targetPose.position.x; inputFlat[b + 8] = targetPose.position.y; inputFlat[b + 9] = targetPose.position.z
      inputFlat[b + 10] = targetPose.quaternion.x; inputFlat[b + 11] = targetPose.quaternion.y
      inputFlat[b + 12] = targetPose.quaternion.z; inputFlat[b + 13] = targetPose.quaternion.w
    }

    // Solve all constraint poses — pure math, no allocations inside
    const poses = constraintSolver.solveFixedJoints(inputFlat)

    // Apply results: view updates and parent mutations stay in JS
    for (let i = 0; i < acyclicEntries.length; i++) {
      const [, { sourceId }] = acyclicEntries[i]
      const o = i * 7
      const wpx = poses[o], wpy = poses[o + 1], wpz = poses[o + 2]
      const wqx = poses[o + 3], wqy = poses[o + 4], wqz = poses[o + 5], wqw = poses[o + 6]

      const source = this._model.getObject(sourceId)
      const parent = this._model.getObject(source.parentId)
      if (!parent) continue

      // § 1 — Chain propagation (ADR-035): walk up to the root Solid, move it by
      // the delta, then re-propagate the intermediate CF chain so every cached
      // world pose stays consistent.  When source's direct parent is the root Solid
      // (chain is empty), this is identical to the previous Solid-parent branch.
      const { rootSolid, chain } = this._findAncestorChain(sourceId)

      let parentWorldPos
      if (rootSolid) {
        // Accumulate body-frame → sourceCF offset using each CF's invariant local data.
        //   new_Q_s = W_cf_quat × solidLocalQuat⁻¹
        //   new_P_s = W_cf_pos  − new_Q_s × solidLocalOffset
        // PHILOSOPHY #24: start from exact zero — body-frame centroid IS _position by definition.
        // avg(localCorners) ≈ 0 but not exactly; seeding from it feeds FP error back each frame.
        const sourceCf         = this._model.getObject(sourceId)
        const fullChain        = [...chain, sourceCf]
        const solidLocalOffset = new Vector3()
        const solidLocalQuat   = new Quaternion()
        for (const cf of fullChain) {
          solidLocalOffset.add(cf.translation.clone().applyQuaternion(solidLocalQuat))
          solidLocalQuat.multiply(cf.rotation)
        }

        const newSolidQuat = new Quaternion(wqx, wqy, wqz, wqw)
          .multiply(solidLocalQuat.clone().conjugate())
          .normalize()
        const newSolidPos = new Vector3(wpx, wpy, wpz)
          .sub(solidLocalOffset.clone().applyQuaternion(newSolidQuat))

        rootSolid.restorePose(newSolidPos, newSolidQuat)
        rootSolid.meshView.updateGeometry(rootSolid.corners)
        if (rootSolid.meshView.boxHelper?.visible) rootSolid.meshView.updateBoxHelper()

        // Re-propagate intermediate CFs via ROS TF forward kinematics.
        // Local translations/rotations are UNCHANGED; recompute world poses from orientation.
        // PHILOSOPHY #24: clone _position/_orientation so the in-place loop never mutates the Solid.
        let pWorldPos  = rootSolid._position.clone()
        let pWorldQuat = rootSolid.orientation.clone()
        for (const cf of chain) {
          const cfWorldPos  = pWorldPos.clone().add(cf.translation.clone().applyQuaternion(pWorldQuat))
          const cfWorldQuat = pWorldQuat.clone().multiply(cf.rotation)
          // Always set a fresh entry — _worldPoseCache was cleared at the top of _updateWorldPoses,
          // then re-populated; any entry here was set by this method, so .copy() and .set() are both
          // safe.  Use .set() with clones to keep references isolated (PHILOSOPHY #24).
          this._worldPoseCache.set(cf.id, { position: cfWorldPos.clone(), quaternion: cfWorldQuat.clone() })
          cf.meshView.updatePosition(cfWorldPos)
          cf.meshView.updateRotation(cfWorldQuat)
          cf.meshView.updateConnectionLine(pWorldPos)
          pWorldPos  = cfWorldPos
          pWorldQuat = cfWorldQuat
        }

        parentWorldPos = pWorldPos
      } else {
        // Fallback: CF chain has no root Solid (orphaned chain); slide source within its parent CF
        const parentCached = this._worldPoseCache.get(parent.id)
        if (!parentCached) continue
        parentWorldPos = parentCached.position
      }

      const sourceWorldPos  = new Vector3(wpx, wpy, wpz)
      const sourceWorldQuat = new Quaternion(wqx, wqy, wqz, wqw)

      // When rootSolid was moved as a rigid body above, local coords (translation/rotation)
      // are invariant — skipping back-conversion prevents FP error from accumulating each frame.
      // For orphaned chains (no rootSolid), back-convert so the source CF slides within its parent.
      if (!rootSolid) {
        const parentWorldQuat = this._getParentWorldQuat(source)
        const invParentQuat   = parentWorldQuat.clone().conjugate()
        source.translation.copy(sourceWorldPos.clone().sub(parentWorldPos).applyQuaternion(invParentQuat))
        source.rotation.copy(invParentQuat.clone().multiply(sourceWorldQuat))
      }

      // Update cache with world pose — always set fresh to keep references isolated.
      this._worldPoseCache.set(sourceId, { position: sourceWorldPos.clone(), quaternion: sourceWorldQuat.clone() })

      // Update view
      source.meshView.updatePosition(sourceWorldPos)
      source.meshView.updateRotation(sourceWorldQuat)
      source.meshView.updateConnectionLine(parentWorldPos)
    }
  }

  /**
   * Rigidly fastens a source CoordinateFrame to a target CoordinateFrame.
   *
   * Computes the relative transform (source in target's local frame) once and
   * stores it in _fixedJointTransforms.  _updateFixedJointFrames() then drives the
   * source CF's world pose every animation frame.
   *
   * Returns the created link and the pre-bind state needed by the undo command.
   *
   * @param {string} sourceCFId  ID of the CoordinateFrame to constrain
   * @param {string} targetCFId  ID of the CoordinateFrame to bind to
   * @param {string} [semanticType='fastened']  Semantic annotation ('fastened'|'aligned')
   * @returns {{ link: SpatialLink, translationBefore: import('three').Vector3, rotationBefore: import('three').Quaternion, relativeOffset: import('three').Vector3, relativeQuat: import('three').Quaternion } | null}
   */
  fastenFrame(sourceCFId, targetCFId, semanticType = 'fastened') {
    const source = this._model.getObject(sourceCFId)
    const target = this._model.getObject(targetCFId)
    if (!(source instanceof CoordinateFrame) || !(target instanceof CoordinateFrame)) return null

    const sourcePose = this._worldPoseCache.get(sourceCFId)
    const targetPose = this._worldPoseCache.get(targetCFId)
    if (!sourcePose || !targetPose) return null

    // Snapshot pre-bind state for undo
    const translationBefore = source.translation.clone()
    const rotationBefore    = source.rotation.clone()

    // Relative transform: source expressed in target's local frame
    const invTargetQuat  = targetPose.quaternion.clone().conjugate()
    const relativeOffset = sourcePose.position.clone().sub(targetPose.position).applyQuaternion(invTargetQuat)
    const relativeQuat   = invTargetQuat.clone().multiply(sourcePose.quaternion)

    const link = this.createSpatialLink(sourceCFId, targetCFId, 'fixed', semanticType)
    this._fixedJointTransforms.set(link.id, { sourceId: sourceCFId, relativeOffset, relativeQuat })

    return { link, translationBefore, rotationBefore, relativeOffset, relativeQuat }
  }

  /**
   * Removes a fastened constraint and restores the source CF to the given pre-bind pose.
   *
   * For undo: pass the translationBefore / rotationBefore captured at bind time.
   * For forward unfasten ("stay in place"): pass the current translation / rotation.
   *
   * @param {SpatialLink}                link               The fastened SpatialLink to remove
   * @param {import('three').Vector3}    translationBefore  Translation to restore
   * @param {import('three').Quaternion} rotationBefore     Rotation to restore
   */
  unfastenFrame(link, translationBefore, rotationBefore) {
    this._fixedJointTransforms.delete(link.id)
    this.detachSpatialLink(link.id)
    const source = this._model.getObject(link.sourceId)
    if (source instanceof CoordinateFrame) {
      source.translation.copy(translationBefore)
      source.rotation.copy(rotationBefore)
      this._worldPoseCache.delete(link.sourceId)  // force recompute on next frame
    }
  }

  /**
   * Re-applies a fastened constraint (redo path).
   * Uses the previously computed relativeOffset / relativeQuat rather than
   * recomputing from current world poses (which may have changed during undo).
   *
   * @param {SpatialLink}                link           The fastened SpatialLink to restore
   * @param {import('three').Vector3}    relativeOffset Relative offset in target's local frame
   * @param {import('three').Quaternion} relativeQuat   Relative rotation in target's local frame
   */
  refastenFrame(link, relativeOffset, relativeQuat) {
    this.reattachSpatialLink(link)
    // Override the recomputed transform with the original one from bind time
    this._fixedJointTransforms.set(link.id, {
      sourceId: link.sourceId,
      relativeOffset: relativeOffset.clone(),
      relativeQuat:   relativeQuat.clone(),
    })
  }

  /**
   * Returns the stored relative transform for a fastened link, or null if unknown.
   * Used by the unfasten UI to reconstruct the undo command.
   * @param {string} linkId
   * @returns {{ relativeOffset: import('three').Vector3, relativeQuat: import('three').Quaternion } | null}
   */
  getFastenedTransform(linkId) {
    const entry = this._fixedJointTransforms.get(linkId)
    return entry ? { relativeOffset: entry.relativeOffset, relativeQuat: entry.relativeQuat } : null
  }

  // ── SpatialLink view helpers (ADR-030 Phase 3) ───────────────────────────

  /**
   * Computes the world-space centroid of any scene entity.
   * For CoordinateFrame: reads from _worldPoseCache.
   * For all others: averages the `corners` (WorldVector3[]).
   * Returns null when the entity is unknown or has no geometry yet.
   * @param {string} id
   * @returns {import('three').Vector3|null}
   */
  _entityWorldCentroid(id) {
    const obj = this._model.getObject(id)
    if (!obj) return null

    if (obj instanceof CoordinateFrame) {
      return this._worldPoseCache.get(id)?.position?.clone() ?? null
    }

    // Solid: use ADR-040 primary triple — never avg(corners) which accumulates FP error
    // (centroid is Validation-only; _position is the authoritative Verification source)
    if (obj instanceof Solid) {
      return obj._position.clone()
    }

    const corners = obj.corners
    if (!corners || corners.length === 0) return null

    const sum = new Vector3()
    for (const c of corners) sum.add(c)
    return sum.divideScalar(corners.length)
  }

  /**
   * Creates a SpatialLinkView and stores it in _linkViews.
   * @param {import('../domain/SpatialLink.js').SpatialLink} link
   */
  _createLinkView(link) {
    const src = this._entityWorldCentroid(link.sourceId) ?? new Vector3()
    const tgt = this._entityWorldCentroid(link.targetId) ?? new Vector3()
    const view = new SpatialLinkView(this._threeScene, src, tgt, link.semanticType)
    this._linkViews.set(link.id, view)
    // Apply current selection/drag highlight to the newly created view.
    const highlighted =
      this._dragEntityIds.has(link.sourceId) ||
      this._dragEntityIds.has(link.targetId) ||
      this._linkSelectedIds.has(link.sourceId) ||
      this._linkSelectedIds.has(link.targetId)
    view.setHighlighted(highlighted)
  }

  /**
   * Shows/hides a single SpatialLinkView. `_linkViews` is service-private, so
   * external staging (e.g. the Context DSL demo reveal) goes through this method.
   * @param {string} linkId
   * @param {boolean} visible
   */
  setLinkViewVisible(linkId, visible) {
    this._linkViews.get(linkId)?.setVisible(visible)
  }

  /**
   * Updates the line endpoints of every SpatialLinkView to follow entity centroids.
   * Drives rubber-band animation: marching ants dash scroll + tension color shift.
   * Called once per animation frame at the end of _updateWorldPoses().
   */
  _updateSpatialLinkViews() {
    const hasDrag = this._dragEntityIds.size > 0
    if (hasDrag) this._dashTimer += 0.018   // advance marching ants

    for (const [id, view] of this._linkViews) {
      const link = this._model.getLink(id)
      if (!link) continue
      const src = this._entityWorldCentroid(link.sourceId)
      const tgt = this._entityWorldCentroid(link.targetId)
      if (!src || !tgt) continue

      const isDragging = hasDrag && (
        this._dragEntityIds.has(link.sourceId) ||
        this._dragEntityIds.has(link.targetId)
      )

      let dashOffset = 0
      let tension    = 0
      if (isDragging) {
        dashOffset = -this._dashTimer
        const currentDist = src.distanceTo(tgt)
        // tension: 0 at rest, ramps to 1 at 50% stretch beyond rest distance
        tension = Math.max(0, (currentDist / view.restDistance) - 1) / 0.5
      }

      const severity = link.semanticType === 'bounded_by'
        ? (link.properties?.severity ?? 0) : 0
      view.update(src, tgt, dashOffset, tension, severity)
    }

    this._evaluateClearanceLinks()
  }

  /**
   * Evaluates runtime SpatialLink constraints each animation frame:
   *  - bounded_by: min 2D XY distance from polyline/polygon to Solid corners vs. clearance (mm)
   *  - contains: point-in-polygon test for all Solid corners inside AnnotatedRegion boundary
   *  - connects (with deadline): Route polyline length / speed vs. deadline (tact-time; ADR-043 Phase 3)
   * Pure computation: reads corners, writes link.violated / link.errorMessage / view violation state.
   */
  _evaluateClearanceLinks() {
    // Aggregate contains-link targets so multiple links to the same Solid compose correctly.
    const containsTargetIds   = new Set()
    const violatedContainsIds = new Set()
    // Bilateral: also track source Regions that have violated contains-links.
    const containsSourceIds         = new Set()
    const violatedContainsSourceIds = new Set()
    // Aggregate tact-time-link targets so Hub visual state is OR-composed across multiple routes.
    const tactTimeHubIds     = new Set()
    const violatedTactHubIds = new Set()
    // Bilateral: also track source Routes that have violated tact-time links.
    const tactTimeRouteIds     = new Set()
    const violatedTactRouteIds = new Set()
    // Aggregate tolerance-references targets (Anchor → CF) for OR-composed Anchor visual state.
    const toleranceAnchorIds        = new Set()
    const violatedToleranceAnchorIds = new Set()
    // Conflict detection: track all tolerances assigned to each CF by different Anchors.
    const cfToleranceMap = new Map()   // cfId → Set<number>

    for (const link of this._model.links.values()) {
      if (link.semanticType === 'bounded_by') {
        const source = this._model.getObject(link.sourceId)
        const target = this._model.getObject(link.targetId)
        if (!source || !target) { link.violated = false; continue }

        const srcCorners = source.corners
        const tgtCorners = target.corners
        if (!srcCorners?.length || !tgtCorners?.length || srcCorners.length < 2) {
          link.violated = false
          continue
        }

        const limit   = link.properties?.clearance ?? 0
        const minDist = _minDistPolylineToPoints(srcCorners, tgtCorners)

        link.violated     = minDist < limit
        link.errorMessage = link.violated
          ? `⚠️ Clearance too small: ${minDist.toFixed(0)}mm (required: ${limit}mm)`
          : ''
        link.properties.currentClearance = minDist
        // Severity: 0 at 2× clearance, 0.5 at 1.5×, 1.0 at threshold and beyond (one-frame lag is intentional).
        link.properties.severity = link.violated
          ? 1.0
          : (limit > 0 ? Math.max(0, 1 - (minDist / limit - 1)) : 0)

        this._linkViews.get(link.id)?.setViolated?.(link.violated)

      } else if (link.semanticType === 'contains') {
        const source = this._model.getObject(link.sourceId)
        const target = this._model.getObject(link.targetId)
        if (!source || !target) { link.violated = false; continue }

        const regionCorners = source.corners
        const solidCorners  = target.corners
        if (!regionCorners?.length || !solidCorners?.length || regionCorners.length < 3) {
          link.violated = false
          continue
        }

        const allInside = solidCorners.every(c => _xyPointInPolygon(c.x, c.y, regionCorners))
        link.violated     = !allInside
        link.errorMessage = link.violated ? '⚠️ Escaped outside the Zone' : ''

        this._linkViews.get(link.id)?.setViolated?.(link.violated)

        if (target instanceof Solid) {
          containsTargetIds.add(link.targetId)
          if (link.violated) violatedContainsIds.add(link.targetId)
        }
        // Bilateral: track Zone source for reverse alarm.
        containsSourceIds.add(link.sourceId)
        if (link.violated) violatedContainsSourceIds.add(link.sourceId)

      } else if (link.semanticType === 'connects' && link.properties?.deadline !== undefined) {
        // Tact-time evaluation: Route (AnnotatedLine) → Hub (AnnotatedPoint).
        // Checks whether route polyline length / speed exceeds the deadline.
        const source = this._model.getObject(link.sourceId)
        const target = this._model.getObject(link.targetId)
        if (!source || !target) { link.violated = false; continue }

        const routeCorners = source.corners
        if (!routeCorners?.length || routeCorners.length < 2) { link.violated = false; continue }

        let routeLength = 0
        for (let i = 1; i < routeCorners.length; i++) {
          routeLength += routeCorners[i - 1].distanceTo(routeCorners[i])
        }

        const speed       = link.properties.speed ?? 1.5          // m/s
        const deadline    = link.properties.deadline               // seconds
        const transitTime = routeLength / 1000 / speed             // mm → m → seconds

        link.violated     = transitTime > deadline
        link.errorMessage = link.violated
          ? `⚠️ Cycle time exceeded: ${transitTime.toFixed(1)}s (limit: ${deadline}s)`
          : ''
        link.properties.currentTransitTime = transitTime

        this._linkViews.get(link.id)?.setViolated?.(link.violated)

        tactTimeHubIds.add(link.targetId)
        if (link.violated) violatedTactHubIds.add(link.targetId)
        // Bilateral: track Route source for reverse alarm.
        tactTimeRouteIds.add(link.sourceId)
        if (link.violated) violatedTactRouteIds.add(link.sourceId)

      } else if (link.semanticType === 'references' && link.properties?.tolerance !== undefined) {
        // ADR-043 Phase 4: Anchor tolerance check — Anchor (AnnotatedPoint) → CoordinateFrame.
        // Validates that the CF world position is within `tolerance` mm of the Anchor position.
        const source = this._model.getObject(link.sourceId)
        const target = this._model.getObject(link.targetId)
        if (!source || !target || !(source instanceof AnnotatedPoint) || !(target instanceof CoordinateFrame)) {
          link.violated = false; continue
        }
        if (source.placeType !== 'Anchor') { link.violated = false; continue }

        const cfPose = this._worldPoseCache.get(link.targetId)
        if (!cfPose) { link.violated = false; continue }

        // Anchor position is in world space (mm); CF world position from the pose cache (m).
        // _worldPoseCache stores positions in the same world units as the scene (m).
        const anchorPos  = source.corners[0]
        const tolerance  = link.properties.tolerance          // mm
        const distanceM  = anchorPos.distanceTo(cfPose.position)
        const distanceMm = distanceM * 1000                   // m → mm

        link.properties.currentDistance = distanceMm
        link.violated     = distanceMm > tolerance
        link.errorMessage = link.violated
          ? `⚠️ Position error: ${distanceMm.toFixed(1)}mm (tolerance: ±${tolerance}mm)`
          : ''

        this._linkViews.get(link.id)?.setViolated?.(link.violated)

        toleranceAnchorIds.add(link.sourceId)
        // Store cfId on the anchor view so it can draw the error bridge line.
        const anchorObj = this._model.getObject(link.sourceId)
        if (anchorObj) anchorObj._toleranceCfId = link.violated ? link.targetId : null
        if (link.violated) violatedToleranceAnchorIds.add(link.sourceId)

        // Track all tolerances that reference this CF (for conflict detection).
        if (!cfToleranceMap.has(link.targetId)) cfToleranceMap.set(link.targetId, new Set())
        cfToleranceMap.get(link.targetId).add(tolerance)
      }
    }

    // Detect anchor-tolerance conflicts: same CF constrained by multiple Anchors with differing tolerances.
    const conflictingCfIds = new Set()
    for (const [cfId, tolerances] of cfToleranceMap) {
      if (tolerances.size > 1) conflictingCfIds.add(cfId)
    }
    if (conflictingCfIds.size > 0 && !this._lastConflictingCfIds) {
      this._lastConflictingCfIds = new Set()
    }
    if (this._lastConflictingCfIds) {
      const added = [...conflictingCfIds].filter(id => !this._lastConflictingCfIds.has(id))
      if (added.length > 0) {
        this.emit('anchorToleranceConflict', { cfIds: conflictingCfIds })
      }
      this._lastConflictingCfIds = conflictingCfIds
    }

    // Propagate violation tint to Solid targets of contains links.
    for (const id of containsTargetIds) {
      const obj = this._model.getObject(id)
      obj?.meshView?.setConstraintViolated?.(violatedContainsIds.has(id))
    }
    // Bilateral: propagate violation state to Zone sources of contains links.
    for (const id of containsSourceIds) {
      const obj = this._model.getObject(id)
      obj?.meshView?.setContainsViolated?.(violatedContainsSourceIds.has(id))
    }

    // Propagate tact-time violation state to Hub targets of connects links.
    for (const id of tactTimeHubIds) {
      const obj = this._model.getObject(id)
      obj?.meshView?.setTactTimeViolated?.(violatedTactHubIds.has(id))
    }
    // Bilateral: propagate tact-time violation state to Route sources of connects links.
    for (const id of tactTimeRouteIds) {
      const obj = this._model.getObject(id)
      obj?.meshView?.setTactViolated?.(violatedTactRouteIds.has(id))
    }

    // Propagate tolerance violation state to Anchor sources of references links (ADR-043 Phase 4).
    for (const id of toleranceAnchorIds) {
      const obj = this._model.getObject(id)
      const cfId = obj?._toleranceCfId ?? null
      obj?.meshView?.setToleranceViolated?.(violatedToleranceAnchorIds.has(id), cfId)
    }
  }

  // ── Rubber-band highlight API (called by AppController) ────────────────────

  /**
   * Updates which entity IDs are "selected" (but not dragging).
   * Link views connecting these entities are highlighted (full opacity, larger dashes).
   * @param {Set<string>} entityIds
   */
  updateLinkSelectionHighlight(entityIds) {
    this._linkSelectedIds = new Set(entityIds)
    this._applyLinkHighlights()
  }

  /**
   * Marks entities as actively being grabbed or released.
   * On drag start: snapshots rest distances for tension computation.
   * @param {Iterable<string>} entityIds
   * @param {boolean}          active
   */
  setLinkDragging(entityIds, active) {
    this._dragEntityIds.clear()
    if (active) {
      for (const id of entityIds) this._dragEntityIds.add(id)
      // Snapshot rest distances for all links connected to dragged entities.
      for (const [linkId, view] of this._linkViews) {
        const link = this._model.getLink(linkId)
        if (!link) continue
        if (this._dragEntityIds.has(link.sourceId) || this._dragEntityIds.has(link.targetId)) {
          const src = this._entityWorldCentroid(link.sourceId)
          const tgt = this._entityWorldCentroid(link.targetId)
          if (src && tgt) view.setRestDistance(src, tgt)
        }
      }
    } else {
      this._dashTimer = 0
    }
    this._applyLinkHighlights()
  }

  /** Applies highlight / idle opacity to all link views based on current selection/drag state. */
  _applyLinkHighlights() {
    for (const [id, view] of this._linkViews) {
      const link = this._model.getLink(id)
      if (!link) continue
      const highlighted =
        this._dragEntityIds.has(link.sourceId) ||
        this._dragEntityIds.has(link.targetId) ||
        this._linkSelectedIds.has(link.sourceId) ||
        this._linkSelectedIds.has(link.targetId)
      view.setHighlighted(highlighted)
    }
  }

  /**
   * Returns the maximum tension across all SpatialLinks connected to dragged entities.
   * Tension is 0 at rest distance and reaches 1 at 50% stretch beyond rest distance.
   * Used by AppController to compute drag-damping resistance during free movement.
   * @returns {number}
   */
  getLinkDragTension() {
    if (this._dragEntityIds.size === 0) return 0
    let maxTension = 0
    for (const [id, view] of this._linkViews) {
      const link = this._model.getLink(id)
      if (!link) continue
      if (!this._dragEntityIds.has(link.sourceId) && !this._dragEntityIds.has(link.targetId)) continue
      // Links with no kinematic joint have no physical resistance — skip tension (PHILOSOPHY #11).
      if (link.jointType === null) continue
      const src = this._entityWorldCentroid(link.sourceId)
      const tgt = this._entityWorldCentroid(link.targetId)
      if (!src || !tgt) continue
      const currentDist = src.distanceTo(tgt)
      const tension = Math.max(0, (currentDist / view.restDistance) - 1) / 0.5
      if (tension > maxTension) maxTension = tension
    }
    return maxTension
  }

  /**
   * Resolves the world position of a geometry element from an anchor reference.
   * Returns null when the element cannot be found on the given object.
   * @param {{ type: string, elementId: string }} anchorRef
   * @param {object} obj  the scene object that owns the element
   * @returns {import('three').Vector3|null}
   */
  _resolveAnchorPosition(anchorRef, obj) {
    const { type, elementId } = anchorRef
    if (type === 'vertex') {
      const v = obj.vertices?.find(v => v.id === elementId)
      return v ? v.position : null
    }
    if (type === 'edge') {
      const e = obj.edges?.find(e => e.id === elementId)
      if (!e) return null
      return e.v0.position.clone().add(e.v1.position).multiplyScalar(0.5)
    }
    if (type === 'face') {
      const f = obj.faces?.find(f => f.id === elementId)
      if (!f) return null
      const center = new Vector3()
      f.vertices.forEach(v => center.add(v.position))
      return center.divideScalar(f.vertices.length)
    }
    return null
  }

  /**
   * Returns a snapshot of the full scene connectivity graph (ADR-028).
   *
   * Nodes: every scene object (geometry + frames + annotations).
   * Edges:
   *   'frame'  — CoordinateFrame parentId chain (frame hierarchy)
   *   'anchor' — MeasureLine endpoint anchored to a geometry element
   *
   * Use this for connectivity analysis: build an undirected adjacency list
   * from edges and run BFS/DFS to find connected components (clusters).
   *
   * @returns {{
   *   nodes: { id: string, name: string, type: string, parentId: string|null }[],
   *   edges: { from: string, to: string, relation: string, vertexId?: string }[]
   * }}
   */
  /**
   * Changes the parent of a CoordinateFrame, maintaining its world position.
   *
   * The frame's `translation` is recomputed so that the frame stays at its
   * current world position relative to the new parent's centroid.
   * On undo, pass `forcedTranslation` to restore the exact prior translation
   * instead of recomputing from the current world pose cache.
   *
   * No-ops (returns false) when:
   *   - frameId is not a CoordinateFrame
   *   - frame.name === 'Origin' (locked to its geometry object)
   *   - newParentId is unknown, a MeasureLine, or an ImportedMesh
   *   - newParentId === frameId (self-reference)
   *   - newParentId is a descendant of frameId (would create a cycle)
   *
   * Emits: 'frameReparented' { id, newParentId }
   *
   * @param {string} frameId
   * @param {string} newParentId
   * @param {import('three').Vector3|null} [forcedTranslation]
   *   Undo path only — sets translation directly instead of recomputing.
   * @returns {boolean}
   */
  reparentFrame(frameId, newParentId, forcedTranslation = null) {
    const frame = this._model.getObject(frameId)
    if (!(frame instanceof CoordinateFrame)) return false
    if (frame.name === 'Origin') return false

    const newParent = this._model.getObject(newParentId)
    if (!newParent) return false
    if (newParent instanceof MeasureLine || newParent instanceof ImportedMesh) return false
    if (newParentId === frameId) return false
    if (this._isDescendant(frameId, newParentId)) return false

    if (forcedTranslation) {
      // Undo path: restore previously saved local translation directly
      frame.translation.copy(forcedTranslation)
    } else {
      // Maintain world position across reparent:
      // newLocalTranslation = newParentWorldQuat^-1 * (worldPos - newParentCentroid)
      const framePose = this._worldPoseCache.get(frameId)
      const worldPos  = framePose?.position
      const worldQuat = framePose?.quaternion
      const centroid  = this._computeObjectCentroid(newParent)
      const newParentQuat = newParent instanceof CoordinateFrame
        ? (this._worldPoseCache.get(newParent.id)?.quaternion ?? new Quaternion())
        : newParent.orientation
      if (worldPos && centroid) {
        const worldOffset = worldPos.clone().sub(centroid)
        frame.translation.copy(worldOffset.applyQuaternion(newParentQuat.clone().conjugate()))
        if (worldQuat) {
          frame.rotation.copy(newParentQuat.clone().conjugate().multiply(worldQuat))
        }
      } else {
        frame.translation.set(0, 0, 0)
      }
    }

    frame.parentId = newParentId
    this.emit('frameReparented', { id: frameId, newParentId })
    return true
  }

  /**
   * Returns true if candidateId is a strict descendant of ancestorId in the
   * CoordinateFrame parent chain. Used for cycle detection before re-parenting.
   * @param {string} ancestorId
   * @param {string} candidateId
   * @returns {boolean}
   */
  _isDescendant(ancestorId, candidateId) {
    let current = this._model.getObject(candidateId)
    while (current instanceof CoordinateFrame && current.parentId) {
      if (current.parentId === ancestorId) return true
      current = this._model.getObject(current.parentId)
    }
    return false
  }

  /**
   * Returns a clone of the world-space centroid of a scene object.
   * CoordinateFrame: reads from world pose cache.
   * Geometry objects: averages corners.
   * Returns null if the centroid cannot be determined.
   * @param {object} obj
   * @returns {import('three').Vector3|null}
   */
  _computeObjectCentroid(obj) {
    if (obj instanceof CoordinateFrame) {
      return this._worldPoseCache.get(obj.id)?.position?.clone() ?? null
    }
    if (obj.corners?.length > 0) {
      const c = new Vector3()
      obj.corners.forEach(corner => c.add(corner))
      return c.divideScalar(obj.corners.length)
    }
    return null
  }

  getSceneGraph() {
    const nodes = []
    const edges = []
    for (const [id, obj] of this._model.objects) {
      nodes.push({ id, name: obj.name, type: obj.constructor.name, parentId: obj.parentId ?? null })
      if (obj.parentId) {
        edges.push({ from: obj.parentId, to: id, relation: 'frame' })
      }
      if (obj instanceof MeasureLine) {
        for (const v of obj.vertices) {
          if (v.anchorRef) {
            edges.push({ from: v.anchorRef.objectId, to: id, relation: 'anchor', vertexId: v.id })
          }
        }
      }
    }
    for (const [, link] of this._model.links) {
      edges.push({ from: link.sourceId, to: link.targetId, relation: 'spatial', linkId: link.id, jointType: link.jointType, semanticType: link.semanticType })
    }
    return { nodes, edges }
  }

  // ── Use cases ──────────────────────────────────────────────────────────────

  /**
   * Public accessor for the next collision-free auto-name for a given prefix.
   * The single naming source: every "add" path (Solid, viewport/N-panel frame
   * placement, and the mobile Add-frame dialog seed) derives its default from
   * here, so no path invents a divergent literal that bypasses the numbering
   * (the mobile path formerly committed a bare `'Frame'`, duplicating names #9).
   * Pure derived read — scans existing names, mutates nothing (idempotent).
   * @param {string} prefix
   * @returns {string}
   */
  nextEntityName(prefix) {
    return this._nextEntityName(prefix)
  }

  _nextEntityName(prefix) {
    const pattern = new RegExp(`^${prefix}(?:\\.(\\d{3}))?$`)
    const used = new Set()
    for (const obj of this._model.objects.values()) {
      const m = pattern.exec(obj.name)
      if (!m) continue
      used.add(m[1] === undefined ? 0 : parseInt(m[1], 10))
    }
    if (!used.has(0)) return prefix
    for (let n = 1; ; n++) {
      if (!used.has(n)) return `${prefix}.${String(n).padStart(3, '0')}`
    }
  }

  /**
   * Creates a new Solid entity + MeshView, registers it in the scene, and returns it.
   * Offsets successive objects so they do not stack.
   * Emits: 'objectAdded'
   * @returns {import('../domain/Solid.js').Solid}
   */
  createSolid() {
    const idx  = this._model.objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = this._nextEntityName('Cube')

    const positions = createInitialCorners()
    if (idx > 0) {
      const step = idx * 0.5
      positions.forEach(c => { c.x += step; c.y += step })
    }

    const vertices = positions.map((pos, i) => new Vertex(`${id}_v${i}`, pos))
    const solid    = new Solid(id, name, vertices, this._newMeshView())
    solid.meshView.updateGeometry(solid.corners)
    this._syncIdentityVisuals(solid)
    this._model.addObject(solid)
    this.emit('objectAdded', solid)
    // Body frame: Origin CF always exists at Solid centroid (ADR-037)
    this.createCoordinateFrame(solid.id, 'Origin', null)
    return solid
  }

  /**
   * Creates a new Profile entity + MeshView (hidden until drawn), registers it,
   * and returns it.
   * Emits: 'objectAdded'
   * @returns {import('../domain/Profile.js').Profile}
   */
  createProfile() {
    const idx  = this._model.objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = this._nextEntityName('Sketch')

    const meshView = this._newMeshView()
    meshView.setVisible(false)  // no geometry until the profile is drawn

    const profile = new Profile(id, name, meshView)
    this._syncIdentityVisuals(profile)
    this._model.addObject(profile)
    this.emit('objectAdded', profile)
    return profile
  }

  /**
   * Disposes the entity's MeshView and removes it from the scene.
   * Child CoordinateFrames (including nested children) are cascade-deleted first.
   * No-ops if the id is unknown.
   * Emits: 'objectRemoved' (for the object and each cascaded child)
   * @param {string} id
   */
  deleteObject(id) {
    const obj = this._model.getObject(id)
    if (!obj) return

    // Cascade: recursively delete children before removing the parent.
    // Supports nested frame hierarchies (frame→frame chains, ADR-019).
    for (const child of this._model.getChildren(id)) {
      this.deleteObject(child.id)
    }

    obj.meshView.dispose(this._threeScene)
    this._model.removeObject(id)
    this._worldPoseCache.delete(id)
    this.emit('objectRemoved', id, obj)
  }

  /**
   * Renames an entity.
   * No-ops if id is unknown or name is empty.
   * Emits: 'objectRenamed'
   * @param {string} id
   * @param {string} name
   */
  renameObject(id, name) {
    const obj = this._model.getObject(id)
    if (!obj || !name) return
    obj.rename(name)
    this.emit('objectRenamed', id, name)
  }

  /**
   * Assigns an IFC4 class to a Solid or ImportedMesh entity.
   * Pass null to clear the classification.
   * No-ops if id is unknown or the entity type does not support classification.
   * Emits: 'objectIfcClassChanged'
   * @param {string} id
   * @param {string|null} ifcClass  e.g. 'IfcWall', or null to unclassify
   */
  setIfcClass(id, ifcClass) {
    const obj = this._model.getObject(id)
    if (!obj) return
    if (!(obj instanceof Solid) && !(obj instanceof ImportedMesh)) return
    obj.ifcClass = ifcClass ?? null
    // ADR-070 決定2-A: classification is a visible declaration — retint the
    // body + refresh the label badge through the view's owner methods (#4).
    this._syncIdentityVisuals(obj)
    this.emit('objectIfcClassChanged', id, obj.ifcClass)
  }

  // ── Spatial annotation place type (ADR-029) ──────────────────────────────

  /**
   * Assigns a place type to an AnnotatedLine, AnnotatedRegion, or AnnotatedPoint.
   * Pass null to clear the classification.
   * No-ops if id is unknown or the entity type does not support place types.
   * Emits: 'objectPlaceTypeChanged'
   * @param {string} id
   * @param {string|null} placeType  e.g. 'Route', 'Zone', 'Hub', or null to unclassify
   */
  setPlaceType(id, placeType) {
    const obj = this._model.getObject(id)
    if (!obj) return
    if (!(obj instanceof AnnotatedLine)   &&
        !(obj instanceof AnnotatedRegion) &&
        !(obj instanceof AnnotatedPoint)) return
    obj.placeType = placeType ?? null
    this.emit('objectPlaceTypeChanged', id, obj.placeType)
  }

  /**
   * Creates an AnnotatedLine from an ordered array of points and adds it to the scene.
   * Emits: 'objectAdded'
   * @param {import('three').Vector3[]} points  N ≥ 2 ordered points
   * @param {string} [name]
   * @param {{ camera?: import('three').Camera, renderer?: import('three').WebGLRenderer, container?: HTMLElement }} [viewContext]
   * @returns {AnnotatedLine}
   */
  createAnnotatedLine(points, name, viewContext = {}) {
    const id      = `annot_line_${Date.now()}`
    const lineName = name ?? 'Line'
    const { camera = null, renderer = null, container = document.body } = viewContext
    const meshView = new AnnotatedLineView(this._threeScene, points, null, renderer, camera, container, lineName)
    const obj     = AnnotatedLine.fromPoints(id, lineName, points, meshView)
    this._model.addObject(obj)
    this.emit('objectAdded', obj)
    return obj
  }

  /**
   * Creates an AnnotatedRegion from an ordered ring of points and adds it to the scene.
   * The polygon is implicitly closed; do NOT repeat the first point at the end.
   * Emits: 'objectAdded'
   * @param {import('three').Vector3[]} points  N ≥ 3 points in ring order
   * @param {string} [name]
   * @param {{ camera?: import('three').Camera, renderer?: import('three').WebGLRenderer, container?: HTMLElement }} [viewContext]
   * @returns {AnnotatedRegion}
   */
  createAnnotatedRegion(points, name, viewContext = {}) {
    const id      = `annot_region_${Date.now()}`
    const regionName = name ?? 'Region'
    const { camera = null, renderer = null, container = document.body } = viewContext
    const meshView = new AnnotatedRegionView(this._threeScene, points, null, renderer, camera, container, regionName)
    const obj     = AnnotatedRegion.fromPoints(id, regionName, points, meshView)
    this._model.addObject(obj)
    this.emit('objectAdded', obj)
    return obj
  }

  /**
   * Creates an AnnotatedPoint at the given anchor position and adds it to the scene.
   * Emits: 'objectAdded'
   * @param {import('three').Vector3} point  anchor position
   * @param {string} [name]
   * @param {{ camera?: import('three').Camera, renderer?: import('three').WebGLRenderer, container?: HTMLElement }} [viewContext]
   * @returns {AnnotatedPoint}
   */
  createAnnotatedPoint(point, name, viewContext = {}) {
    const id      = `annot_point_${Date.now()}`
    const pointName = name ?? 'Point'
    const { camera = null, renderer = null, container = document.body } = viewContext
    const meshView = new AnnotatedPointView(
      this._threeScene, camera, container, renderer, point, pointName, null,
    )
    const obj = AnnotatedPoint.fromPoint(id, pointName, point, meshView)
    this._model.addObject(obj)
    this.emit('objectAdded', obj)
    return obj
  }

  // ── Spatial links (ADR-030) ───────────────────────────────────────────────

  /**
   * Creates a SpatialLink between two scene entities and registers it.
   * No-ops if sourceId and targetId are identical.
   * Emits: 'spatialLinkAdded'
   * @param {string}                                              sourceId
   * @param {string}                                              targetId
   * @param {import('../domain/SpatialLink.js').JointType|null}   jointType
   * @param {import('../domain/SpatialLink.js').SemanticType}     semanticType
   * @returns {SpatialLink}
   */
  createSpatialLink(sourceId, targetId, jointType, semanticType, properties = {}) {
    const id   = `link_${Date.now()}`
    const link = new SpatialLink(id, sourceId, targetId, jointType, semanticType, properties)
    this._model.addLink(link)
    this._createLinkView(link)
    this.emit('spatialLinkAdded', link)
    return link
  }

  /**
   * Removes a SpatialLink from the model and disposes its view.
   * Used by both the hard-delete UI path and the undo/redo command path.
   * No-ops if the id is unknown.
   * For 'mounts' links: also cleans up _mountLocalPositions so the entity's
   * vertex.position (which is already in world coords thanks to the last
   * _updateMountedAnnotations() call) is used as-is going forward.
   * Emits: 'spatialLinkRemoved'
   * @param {string} id
   */
  detachSpatialLink(id) {
    const link = this._model.getLink(id)
    if (!link) return
    // Clear contains-link violation tint from the target Solid before removing the link.
    if (link.semanticType === 'contains') {
      const target = this._model.getObject(link.targetId)
      target?.meshView?.setConstraintViolated?.(false)
    }
    // Clear tact-time violation state from the Hub before removing the link.
    if (link.semanticType === 'connects' && link.properties?.deadline !== undefined) {
      const target = this._model.getObject(link.targetId)
      target?.meshView?.setTactTimeViolated?.(false)
    }
    // Clear tolerance violation state from the Anchor source before removing the link (ADR-043 Phase 4).
    if (link.semanticType === 'references' && link.properties?.tolerance !== undefined) {
      const source = this._model.getObject(link.sourceId)
      source?.meshView?.setToleranceViolated?.(false)
    }
    // Clean up mount / fasten data before removing the link record
    this._mountLocalPositions.delete(id)
    this._fixedJointTransforms.delete(id)
    this._model.removeLink(id)
    this._linkViews.get(id)?.dispose(this._threeScene)
    this._linkViews.delete(id)
    this.emit('spatialLinkRemoved', id)
  }

  /**
   * Reactivates all geometric SpatialLink constraints (fastened, mounts) for
   * every link currently in the model.  Must be called AFTER _updateWorldPoses()
   * has run so that _worldPoseCache is populated.
   *
   * Migration pass for scenes saved before ADR-037.
   * For each Solid in `solids` that has no direct child CF named 'Origin',
   * creates one at the centroid (translation=0, rotation=identity).
   * @param {import('../domain/Solid.js').Solid[]} solids
   */
  _ensureOriginFrames(solids) {
    for (const solid of solids) {
      const hasOrigin = [...this._model.getChildren(solid.id)]
        .some(o => o instanceof CoordinateFrame && o.name === 'Origin')
      if (!hasOrigin) this.createCoordinateFrame(solid.id, 'Origin', null)
    }
  }

  /**
   * Used at the end of loadScene() and importFromJson() to make constraints live
   * again after entities and links have been reconstructed from serialized data.
   */
  _reactivateLiveLinks() {
    for (const link of this._model.links.values()) {
      if (link.jointType === 'fixed' && link.semanticType !== 'mounts') {
        const sourcePose = this._worldPoseCache.get(link.sourceId)
        const targetPose = this._worldPoseCache.get(link.targetId)
        if (!sourcePose || !targetPose) continue
        const invTargetQuat  = targetPose.quaternion.clone().conjugate()
        const relativeOffset = sourcePose.position.clone().sub(targetPose.position).applyQuaternion(invTargetQuat)
        const relativeQuat   = invTargetQuat.clone().multiply(sourcePose.quaternion)
        this._fixedJointTransforms.set(link.id, { sourceId: link.sourceId, relativeOffset, relativeQuat })
      } else if (link.semanticType === 'mounts') {
        const source = this._model.getObject(link.sourceId)
        const pose   = this._worldPoseCache.get(link.targetId)
        if (!source || !pose) continue
        const invQ = pose.quaternion.clone().conjugate()
        const localPositions = source.vertices.map(v =>
          v.position.clone().sub(pose.position).applyQuaternion(invQ),
        )
        this._mountLocalPositions.set(link.id, { sourceId: link.sourceId, localPositions })
      }
    }
  }

  /**
   * Re-inserts a previously detached SpatialLink into the model and recreates its view.
   * Used by the undo/redo command path.
   * For 'mounts' links: recomputes local positions from the source entity's current
   * vertex.position (world coords) and the host CF's current world pose.
   * Emits: 'spatialLinkAdded'
   * @param {SpatialLink} link
   */
  reattachSpatialLink(link) {
    this._model.addLink(link)
    this._createLinkView(link)
    // For mounts links, re-establish the local position mapping so _updateMountedAnnotations
    // continues to drive the entity's position from the host frame.
    if (link.semanticType === 'mounts') {
      const source = this._model.getObject(link.sourceId)
      const pose   = this._worldPoseCache.get(link.targetId)
      if (source && pose) {
        const invQ = pose.quaternion.clone().conjugate()
        const localPositions = source.vertices.map(v =>
          v.position.clone().sub(pose.position).applyQuaternion(invQ),
        )
        this._mountLocalPositions.set(link.id, { sourceId: link.sourceId, localPositions })
      }
    }
    // For fixed joints (non-mounts), recompute the relative transform from current world poses.
    if (link.jointType === 'fixed' && link.semanticType !== 'mounts') {
      const sourcePose = this._worldPoseCache.get(link.sourceId)
      const targetPose = this._worldPoseCache.get(link.targetId)
      if (sourcePose && targetPose) {
        const invTargetQuat = targetPose.quaternion.clone().conjugate()
        const relativeOffset = sourcePose.position.clone().sub(targetPose.position).applyQuaternion(invTargetQuat)
        const relativeQuat   = invTargetQuat.clone().multiply(sourcePose.quaternion)
        this._fixedJointTransforms.set(link.id, { sourceId: link.sourceId, relativeOffset, relativeQuat })
      }
    }
    this.emit('spatialLinkAdded', link)
  }

  /**
   * Returns all SpatialLinks where sourceId or targetId matches the given entity id.
   * @param {string} entityId
   * @returns {SpatialLink[]}
   */
  getLinksOf(entityId) {
    return [...this._model.links.values()].filter(
      l => l.sourceId === entityId || l.targetId === entityId,
    )
  }

  /** Returns all SpatialLinks in the scene as an array. */
  getLinks() {
    return [...this._model.links.values()]
  }

  /**
   * Checks whether any entity in the selection has a semantic constraint
   * (fastened or mounts) linking it to an entity outside the selection.
   * Moving selected entities independently of their linked peers violates
   * the design intent encoded in those links.
   *
   * When the linked peer is also selected the constraint is not violated —
   * moving the whole assembly together is valid.
   *
   * @param {Set<string>} selectedIds
   * @returns {{ blocked: boolean, message: string }}
   */
  checkMoveGuardrail(selectedIds) {
    for (const id of selectedIds) {
      for (const link of this.getLinksOf(id)) {
        const peerId = link.sourceId === id ? link.targetId : link.sourceId
        if (selectedIds.has(peerId)) continue
        if (link.semanticType === 'fastened') {
          const name = this._model.getObject(peerId)?.name ?? 'another object'
          return {
            blocked: true,
            message: `Fastened to "${name}". Unfasten the link or include the linked object in your selection.`,
          }
        }
        if (link.semanticType === 'mounts') {
          const name = this._model.getObject(peerId)?.name ?? 'another object'
          return {
            blocked: true,
            message: `Mounted on "${name}". Remove the mount link to move independently.`,
          }
        }
      }
      // Fastened links live on child CF IDs, not the Solid ID — the link loop above misses them.
      // hasFastenedChild() walks the full CF ancestor chain so nested-CF topologies are covered.
      // Without this block, drag preview and _updateFixedJointFrames() fight every frame (oscillation).
      const obj = this._model.getObject(id)
      if (obj instanceof Solid && this.hasFastenedChild(id)) {
        return {
          blocked: true,
          message: 'This object has a fastened constraint. Unfasten the link or include the linked object in your selection.',
        }
      }
    }
    return { blocked: false, message: '' }
  }

  /**
   * Ground clearance predicate (ADR-071): reports whether any selected
   * entity's geometry currently dips below the ground plane (Z = 0).
   *
   * Pure read over current world corners — it never mutates or clamps. The
   * caller decides how to assist (warning toast, snap offer); keeping the
   * judgment here follows PHILOSOPHY #25 (guards live in named service
   * predicates, not inline handler returns). Entities without world corners
   * (CoordinateFrame, SpatialLink) are skipped.
   *
   * @param {Iterable<string>} selectedIds
   * @param {number} [tolerance=0.001]  1 mm — matches the stack-snap rest tolerance
   * @returns {{ belowGrade: boolean, lowestZ: number, suggestedLift: number }}
   *   suggestedLift is the +Z delta that would rest the lowest point on grade.
   */
  checkGroundClearance(selectedIds, tolerance = 0.001) {
    let lowestZ = Infinity
    for (const id of selectedIds) {
      const obj = this._model.getObject(id)
      if (!obj?.corners?.length) continue
      for (const c of obj.corners) {
        if (c.z < lowestZ) lowestZ = c.z
      }
    }
    if (!Number.isFinite(lowestZ)) return { belowGrade: false, lowestZ: 0, suggestedLift: 0 }
    return {
      belowGrade:    lowestZ < -tolerance,
      lowestZ,
      suggestedLift: Math.max(0, -lowestZ),
    }
  }

  /**
   * BFS over jointType === 'fixed' links starting from startEntityId.
   * Returns all reachable entity IDs including the start entity itself.
   * @param {string} startEntityId
   * @returns {Set<string>}
   */
  getConnectedAssembly(startEntityId) {
    const visited = new Set([startEntityId])
    const queue = [startEntityId]
    while (queue.length > 0) {
      const currentId = queue.shift()
      for (const link of this.getLinksOf(currentId)) {
        if (link.jointType !== 'fixed') continue
        const neighborId = link.sourceId === currentId ? link.targetId : link.sourceId
        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          queue.push(neighborId)
        }
      }
    }
    return visited
  }

  /**
   * Returns true if the given CoordinateFrame id is the SOURCE of any fastened link.
   * Used by AppController to block independent TC movement of constrained frames.
   * @param {string} cfId
   * @returns {boolean}
   */
  isFastenedSource(cfId) {
    for (const { sourceId } of this._fixedJointTransforms.values()) {
      if (sourceId === cfId) return true
    }
    return false
  }

  /** Returns true when any fastened-source CF has the given solid as its root ancestor. */
  hasFastenedChild(solidId) {
    for (const { sourceId } of this._fixedJointTransforms.values()) {
      const { rootSolid } = this._findAncestorChain(sourceId)
      if (rootSolid && rootSolid.id === solidId) return true
    }
    return false
  }

  /**
   * Returns true when cfId is the source CF of an active fixed joint, or is an ancestor
   * of one in the parentId chain (i.e., cfId is a JOINT_SOURCE or JOINT_SOURCE_ANCESTOR).
   *
   * Used by _startRotate() to block R-key on CFs whose rotation would conflict with
   * _updateFixedJointFrames(): that method applies a per-frame delta to the root Solid's
   * bodyRotation to enforce the constraint, but _applyRotate() reads bodyRotation live as
   * the parent world quaternion — creating a feedback loop that accumulates unboundedly.
   *
   * "Fixed joint" is the correct term (ADR-038 jointType='fixed'); this check operates
   * on _fixedJointTransforms which tracks all fixed CF-to-CF joints (not only semanticType
   * 'fastened' — any fixed joint activates the rigid body solver).
   *
   * @param {string} cfId
   * @returns {boolean}
   */
  isInFixedJointSourceChain(cfId) {
    for (const { sourceId } of this._fixedJointTransforms.values()) {
      let node = this._model.getObject(sourceId)
      while (node instanceof CoordinateFrame) {
        if (node.id === cfId) return true
        node = this._model.getObject(node.parentId)
      }
    }
    return false
  }

  /**
   * Returns true when cfId is itself a fixed-joint source, or an ancestor of one in the
   * parentId chain (JOINT_SOURCE or JOINT_SOURCE_ANCESTOR state per CF state machine).
   *
   * Used to block R-key rotation on CFs whose mutation would fight _updateFixedJointFrames()
   * every frame: _applyRotate() reads live Solid.bodyRotation, the constraint corrects it,
   * the next frame _applyRotate() reads the modified value → diverging feedback loop.
   *
   * Named after jointType='fixed' (ADR-038) — not semanticType='fastened'.
   * @param {string} cfId
   * @returns {boolean}
   */
  isInFixedJointSourceChain(cfId) {
    for (const { sourceId } of this._fixedJointTransforms.values()) {
      let node = this._model.getObject(sourceId)
      while (node instanceof CoordinateFrame) {
        if (node.id === cfId) return true
        node = this._model.getObject(node.parentId)
      }
    }
    return false
  }

  /**
   * Sets the active object id and emits 'activeChanged'.
   * Pass null to deselect.
   * Emits: 'activeChanged'
   * @param {string|null} id
   */
  setActiveObject(id) {
    this._model.setActiveId(id)
    this.emit('activeChanged', id)
  }

  // ── Preview operations (live drag / rotate) ───────────────────────────────

  /**
   * Applies a world-space translation to all objects in a selection snapshot during
   * a live drag (G-key Grab or mouse-drag preview). Dispatches by entity type:
   * CoordinateFrame receives a parent-local delta; Solid uses the primary triple
   * (_position snapshot + world delta); all other entities use their corners snapshot.
   * Mesh views are updated in the same call.
   * @param {Map<string, import('three').Vector3[]>} segStartCorners  per-entity snapshots
   * @param {Map<string, import('three').Vector3>|null} segStartPositions  per-Solid _position snapshots
   * @param {import('three').Vector3} worldDelta
   */
  applyPreviewTranslation(segStartCorners, segStartPositions, worldDelta) {
    for (const [id, startCorners] of segStartCorners) {
      const obj = this._model.getObject(id)
      if (!obj) continue
      if (obj instanceof CoordinateFrame) {
        const parentWorldQuat = this._getParentWorldQuat(obj)
        const localDelta = worldDelta.clone().applyQuaternion(parentWorldQuat.clone().conjugate())
        obj.move(startCorners, localDelta)
      } else if (obj instanceof Solid) {
        const segStartPos = segStartPositions?.get(id)
        if (segStartPos) obj.move(segStartPos, worldDelta)
      } else {
        obj.move(startCorners, worldDelta)
      }
      const handles = (obj instanceof CoordinateFrame) ? obj.localOffset : obj.corners
      obj.meshView?.updateGeometry(handles)
      obj.meshView?.updateBoxHelper()
    }
  }

  /**
   * Applies a rotation delta to an object during a live Rotate preview.
   * Dispatches by entity type: CoordinateFrame uses ROS TF local rotation;
   * Solid uses the primary triple snapshot. Mesh views are updated in the same call.
   * @param {import('../domain/Solid.js').Solid|import('../domain/CoordinateFrame.js').CoordinateFrame} obj
   * @param {{ segStartOrientation: import('three').Quaternion, segStartPos?: import('three').Vector3, pivot?: import('three').Vector3 }} snap
   * @param {import('three').Quaternion} deltaQ
   */
  applyPreviewRotation(obj, { segStartOrientation, segStartPos, pivot }, deltaQ) {
    if (obj instanceof CoordinateFrame) {
      const parentWorldQuat = this._getParentWorldQuat(obj)
      const startWorldQuat  = parentWorldQuat.clone().multiply(segStartOrientation)
      const newWorldQuat    = new Quaternion().copy(startWorldQuat).premultiply(deltaQ)
      obj.rotation.copy(parentWorldQuat.clone().conjugate().multiply(newWorldQuat))
      obj.meshView?.updateRotation(newWorldQuat)
    } else if (obj instanceof Solid) {
      if (segStartOrientation && segStartPos) {
        obj.rotate(segStartOrientation, segStartPos, pivot, deltaQ)
      }
      obj.meshView?.updateGeometry(obj.corners)
      obj.meshView?.updateBoxHelper()
    }
  }

  /**
   * Moves a single endpoint of a MeasureLine to an absolute world position
   * during a live 1D endpoint-drag preview. Updates the mesh view in the same call.
   * Owns the entity mutation so EndpointDragState stays pure input-computation.
   * @param {import('../domain/MeasureLine.js').MeasureLine} obj
   * @param {number} endpointIndex  0 or 1
   * @param {import('three').Vector3} worldPoint  target world-space position
   */
  applyPreviewEndpointMove(obj, endpointIndex, worldPoint) {
    if (!(obj instanceof MeasureLine)) return
    obj.vertices[endpointIndex].position.copy(worldPoint)
    obj.meshView?.update(obj.p1, obj.p2)
  }

  /**
   * Extrudes a Profile into a Solid and replaces it in the scene.
   * The Profile entity is discarded; the returned Solid reuses the same id,
   * name, and MeshView so the Outliner requires no update.
   * No-ops if the id does not refer to a Profile.
   * @param {string} id
   * @param {number} height  signed extrusion height in world Z units
   * @returns {import('../domain/Solid.js').Solid|null}
   */
  extrudeProfile(id, height) {
    const profile = this._model.getObject(id)
    if (!(profile instanceof Profile)) return null
    const solid = profile.extrude(height)
    this._syncIdentityVisuals(solid)
    this._model.removeObject(id)
    this._model.addObject(solid)
    this.emit('objectRemoved', id, profile)
    this.emit('objectAdded', solid)
    // Body frame: Origin CF always exists at Solid centroid (ADR-037)
    this.createCoordinateFrame(solid.id, 'Origin', null)
    return solid
  }

  /**
   * Removes the cached world pose for an entity, forcing recomputation on the
   * next animation frame.  Call after directly mutating a CoordinateFrame's
   * position/rotation without going through move() or rotate() (e.g. undo/redo).
   * @param {string} id
   */
  invalidateWorldPose(id) {
    this._worldPoseCache.delete(id)
  }

  /**
   * Removes an entity from the model WITHOUT disposing its meshView.
   * Used by undo/redo to detach an entity while keeping it alive for re-insertion.
   * Emits: 'objectRemoved'
   * @param {string} id
   */
  detachObject(id) {
    const obj = this._model.getObject(id)
    if (!obj) return
    this._model.removeObject(id)
    this._worldPoseCache.delete(id)
    this.emit('objectRemoved', id, obj)
  }

  /**
   * Re-inserts a previously detached entity into the model.
   * Does NOT re-add children — caller is responsible for re-inserting children if needed.
   * Emits: 'objectAdded'
   * @param {object} entity  A domain entity (Solid, Profile, etc.)
   */
  reattachObject(entity) {
    this._model.addObject(entity)
    this.emit('objectAdded', entity)
  }

  /**
   * Duplicates a Solid, giving it new ids and a slight XY offset.
   * No-ops if id is unknown or refers to a non-Solid.
   * Emits: 'objectAdded'
   * @param {string} id
   * @returns {import('../domain/Solid.js').Solid|null}
   */
  duplicateSolid(id) {
    const src = this._model.getObject(id)
    if (!(src instanceof Solid)) return null

    const idx    = this._model.objects.size
    const newId   = `obj_${idx}_${Date.now()}`
    const newName = `${src.name}.copy`

    const offset = 0.5
    const vertices = src.vertices.map((v, i) => {
      const pos = v.position.clone()
      pos.x += offset
      pos.y += offset
      return new Vertex(`${newId}_v${i}`, pos)
    })

    const solid = new Solid(newId, newName, vertices, this._newMeshView())
    solid.meshView.updateGeometry(solid.corners)
    this._syncIdentityVisuals(solid)
    this._model.addObject(solid)
    this.emit('objectAdded', solid)
    // Body frame: Origin CF always exists at Solid centroid (ADR-037)
    this.createCoordinateFrame(solid.id, 'Origin', null)
    return solid
  }

  /**
   * Creates a thin-client ImportedMesh entity + ImportedMeshView and registers
   * it in the scene. Used by _applyGeometryUpdate when the server references an
   * object that does not yet exist locally.
   *
   * Emits: 'objectAdded'
   * @param {string} id    object id (matches the server-side objectId)
   * @param {string} name  display name
   * @returns {import('../domain/ImportedMesh.js').ImportedMesh}
   */
  createImportedMesh(id, name) {
    const meshView = this._newImportedMeshView()
    const entity   = new ImportedMesh(id, name, meshView)
    this._syncIdentityVisuals(entity)
    this._model.addObject(entity)
    this.emit('objectAdded', entity)
    return entity
  }

  /**
   * Creates a MeasureLine entity + MeasureLineView and registers it in the scene.
   *
   * When an endpoint was snapped to a geometry element, pass the corresponding
   * anchor reference so the endpoint tracks the element as the object moves (ADR-028).
   *
   * @param {THREE.Vector3} p1         start endpoint (world space)
   * @param {THREE.Vector3} p2         end endpoint (world space)
   * @param {THREE.Camera}  camera     used by MeasureLineView for label projection
   * @param {THREE.WebGLRenderer} renderer  used for canvas bounds
   * @param {HTMLElement}   container  DOM element for the HTML label
   * @param {{ p1?: { objectId:string, type:string, elementId:string },
   *            p2?: { objectId:string, type:string, elementId:string } }} [anchorRefs={}]
   *   Optional anchor references for each endpoint. When provided, the vertex
   *   position is re-resolved from the referenced element every animation frame.
   * @returns {import('../domain/MeasureLine.js').MeasureLine}
   */
  createMeasureLine(p1, p2, camera, renderer, container, anchorRefs = {}) {
    const idx  = this._model.objects.size
    const id   = `ml_${idx}_${Date.now()}`
    const name = `Measure.${String(idx).padStart(3, '0')}`

    // Build Vertex + Edge graph before constructing the entity (ADR-021)
    const v0 = new Vertex(`${id}_v0`, p1.clone())
    const v1 = new Vertex(`${id}_v1`, p2.clone())
    // Set anchor references if the endpoint was snapped to a geometry element (ADR-028)
    if (anchorRefs.p1) v0.anchorRef = anchorRefs.p1
    if (anchorRefs.p2) v1.anchorRef = anchorRefs.p2
    const e0 = new Edge(`${id}_e0`, v0, v1)

    const meshView = new MeasureLineView(this._threeScene, container, camera, renderer)
    const entity   = new MeasureLine(id, name, [v0, v1], [e0], meshView)
    meshView.update(entity.p1, entity.p2)
    this._model.addObject(entity)
    this.emit('objectAdded', entity)
    return entity
  }

  /**
   * Creates a CoordinateFrame entity attached to the given parent object.
   *
   * The frame is positioned at the parent's centroid on creation.  Subsequent
   * position updates are performed by the AppController animation loop so the
   * frame tracks the parent even when it is grabbed/moved.
   *
   * Phase B (ADR-019): CoordinateFrame parents are allowed, enabling nested
   * frame hierarchies (frame→frame chains).  MeasureLine and ImportedMesh
   * are not valid parents (no spatial centroid suitable for a child frame).
   *
   * No-ops (returns null) if parentObjectId is unknown or refers to a
   * MeasureLine or ImportedMesh.
   *
   * Emits: 'objectAdded'
   * @param {string} parentObjectId
   * @returns {CoordinateFrame|null}
   */
  /**
   * @param {string} parentObjectId
   * @param {string|null} [overrideName]
   * @param {import('three').Vector3|null} [placedWorldPos]  If given, sets translation so the
   *   frame's world position equals this point (pick-sub-mode placement, ADR-034 §6).
   *   When null the frame starts at the parent centroid (translation = 0,0,0).
   */
  createCoordinateFrame(parentObjectId, overrideName = null, placedWorldPos = null) {
    const parent = this._model.getObject(parentObjectId)
    if (!parent || parent instanceof MeasureLine || parent instanceof ImportedMesh) return null

    const idx  = this._model.objects.size
    const id   = `frame_${idx}_${Date.now()}`
    const name = overrideName ?? this._nextEntityName('Frame')

    const { camera, renderer, container } = this._viewContext
    const meshView = new CoordinateFrameView(this._threeScene, camera ?? null, renderer ?? null, container ?? null)
    meshView.setLabelText(name)
    const frame    = new CoordinateFrame(id, name, parentObjectId, meshView)
    // Assign provenance from current role (ADR-034 §8.1, §8.2)
    frame.declaredBy = RoleService.getRole()

    // Compute parent centroid (world space) — used for both default placement and
    // computing the translation offset when placedWorldPos is given.
    // CoordinateFrame exposes `localOffset` (LocalVector3), NOT `corners`.
    // When the parent is a CoordinateFrame, use the world pose cache instead
    // (mirrors _updateWorldPoses logic, PHILOSOPHY #21 Phase 3, CODE_CONTRACTS architecture.md).
    /** @type {import('../types/spatial.js').WorldVector3|null} */
    let parentWorldPos = null
    if (parent instanceof CoordinateFrame) {
      const cached = this._worldPoseCache.get(parent.id)
      if (cached) parentWorldPos = /** @type {any} */ (cached.position.clone())
    } else {
      const corners = parent.corners
      if (corners.length > 0) {
        const centroid = new Vector3()
        for (const c of corners) centroid.add(c)
        centroid.divideScalar(corners.length)
        parentWorldPos = /** @type {any} */ (centroid)
      }
    }

    // Convert placed world position to parent-local translation (ROS TF style).
    // localTranslation = parentWorldQuat^-1 * (worldPos - parentWorldPos)
    if (placedWorldPos && parentWorldPos) {
      const parentWorldQuat = parent instanceof CoordinateFrame
        ? (this._worldPoseCache.get(parent.id)?.quaternion ?? new Quaternion())
        : parent.orientation
      const worldOffset = placedWorldPos.clone().sub(parentWorldPos)
      frame.translation.copy(worldOffset.applyQuaternion(parentWorldQuat.clone().conjugate()))
    }

    const initialWorldPos = placedWorldPos ?? parentWorldPos
    if (initialWorldPos) {
      // Cache stores world pose; initial rotation = parent's world rotation (frame.rotation = identity)
      const parentWorldQuat = parent instanceof CoordinateFrame
        ? (this._worldPoseCache.get(parent.id)?.quaternion?.clone() ?? new Quaternion())
        : parent.orientation.clone()
      this._worldPoseCache.set(frame.id, { position: initialWorldPos.clone(), quaternion: parentWorldQuat })
      meshView.updatePosition(initialWorldPos)
      meshView.updateRotation(parentWorldQuat)
    }

    this._model.addObject(frame)
    this.emit('objectAdded', frame)
    return frame
  }

  /**
   * Sets the visibility of an entity's mesh.
   * No-ops if id is unknown.
   * @param {string} id
   * @param {boolean} visible
   */
  setObjectVisible(id, visible) {
    const obj = this._model.getObject(id)
    if (!obj) return
    obj.meshView.setVisible(visible)
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Converts a flat positions array (from Geometry Service) to a corners array
 * compatible with MeshView.updateGeometry (expects THREE.Vector3[]).
 *
 * Only handles the 8-corner cuboid case (24 floats). For non-cuboid geometry
 * (STEP imports etc.) returns null; full BufferGeometry update is Phase C work.
 *
 * @param {number[]} positions  flat [x0,y0,z0, x1,y1,z1, ...]
 * @returns {import('three').Vector3[]|null}
 */
function _positionsToCorners(positions) {
  if (positions.length !== 24) return null
  const corners = []
  for (let i = 0; i < 8; i++) {
    corners.push(new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))
  }
  return corners
}
