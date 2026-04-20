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
import { SpatialLink } from '../domain/SpatialLink.js'
import { SpatialLinkView } from '../view/SpatialLinkView.js'
import { RoleService } from './RoleService.js'

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
          const link = new SpatialLink(dto.id, dto.sourceId, dto.targetId, dto.linkType)
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
        const vertices = dto.vertices.map(v =>
          new Vertex(v.id, new Vector3(v.x, v.y, v.z))
        )
        const solid = new Solid(dto.id, dto.name, vertices, new MeshView(this._threeScene))
        solid.description = dto.description ?? ''
        solid.ifcClass    = dto.ifcClass    ?? null
        // Geometry is rebuilt asynchronously by batchRebuildSolids() after all
        // entities are created — see loadScene() / importFromJson().
        entities.push(solid)
      // Accept both new ('Profile') and legacy ('Sketch') type strings
      } else if (dto.type === 'Profile' || dto.type === 'Sketch') {
        const meshView = new MeshView(this._threeScene)
        meshView.setVisible(false)
        const profile = new Profile(dto.id, dto.name, meshView)
        profile.description = dto.description ?? ''
        if (dto.sketchRect) {
          const p1 = new Vector3(dto.sketchRect.p1.x, dto.sketchRect.p1.y, dto.sketchRect.p1.z)
          const p2 = new Vector3(dto.sketchRect.p2.x, dto.sketchRect.p2.y, dto.sketchRect.p2.z)
          profile.setRect(p1, p2)
        }
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
        const meshView  = new ImportedMeshView(this._threeScene)
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
        entities.push(entity)
      } else if (dto.type === 'CoordinateFrame') {
        const meshView = new CoordinateFrameView(this._threeScene)
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
        const { renderer = null } = viewContext
        const points  = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
        const meshView = new AnnotatedLineView(this._threeScene, points, dto.placeType ?? null, renderer)
        const entity   = AnnotatedLine.fromPoints(dto.id, dto.name, points, meshView)
        entity.description = dto.description ?? ''
        entity.placeType   = dto.placeType   ?? null
        if (entity.placeType) meshView.setPlaceType(entity.placeType)
        entities.push(entity)
      } else if (dto.type === 'AnnotatedRegion') {
        const { renderer = null } = viewContext
        const points  = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
        const meshView = new AnnotatedRegionView(this._threeScene, points, dto.placeType ?? null, renderer)
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

    // Import SpatialLinks (v1.2+); silently skip on older exports.
    for (const dto of (parsed.links ?? [])) {
      try {
        const link = new SpatialLink(
          remapId(dto.id),
          remapId(dto.sourceId),
          remapId(dto.targetId),
          dto.linkType,
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
      const vertices = dto.vertices.map((v, i) =>
        new Vertex(remapId(v.id) || `${newId}_v${i}`, new Vector3(v.x, v.y, v.z))
      )
      const solid = new Solid(newId, dto.name ?? 'Solid', vertices, new MeshView(this._threeScene))
      solid.description = dto.description ?? ''
      solid.ifcClass    = dto.ifcClass    ?? null
      // Geometry is rebuilt asynchronously by batchRebuildSolids() — see importFromJson().
      return solid
    }

    if (dto.type === 'Profile') {
      const meshView = new MeshView(this._threeScene)
      meshView.setVisible(false)
      const profile = new Profile(newId, dto.name ?? 'Profile', meshView)
      profile.description = dto.description ?? ''
      if (dto.sketchRect) {
        const p1 = new Vector3(dto.sketchRect.p1.x, dto.sketchRect.p1.y, dto.sketchRect.p1.z)
        const p2 = new Vector3(dto.sketchRect.p2.x, dto.sketchRect.p2.y, dto.sketchRect.p2.z)
        profile.setRect(p1, p2)
      }
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
      const meshView  = new ImportedMeshView(this._threeScene)
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
      return entity
    }

    if (dto.type === 'CoordinateFrame') {
      const newParentId = remapId(dto.parentId)
      // Skip if parent is not present in the scene (e.g. ImportedMesh that was skipped)
      if (!this._model.getObject(newParentId)) return null
      const meshView = new CoordinateFrameView(this._threeScene)
      const frame    = new CoordinateFrame(newId, dto.name ?? 'Frame', newParentId, meshView)
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
      const { renderer = null } = viewContext
      const points   = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
      const meshView = new AnnotatedLineView(this._threeScene, points, dto.placeType ?? null, renderer)
      const entity   = AnnotatedLine.fromPoints(newId, dto.name ?? 'Line', points, meshView)
      entity.description = dto.description ?? ''
      entity.placeType   = dto.placeType   ?? null
      if (entity.placeType) meshView.setPlaceType(entity.placeType)
      return entity
    }

    if (dto.type === 'AnnotatedRegion') {
      const { renderer = null } = viewContext
      const points   = dto.vertices.map(v => new Vector3(v.x, v.y, v.z))
      const meshView = new AnnotatedRegionView(this._threeScene, points, dto.placeType ?? null, renderer)
      const entity   = AnnotatedRegion.fromPoints(newId, dto.name ?? 'Region', points, meshView)
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
      this.emit('objectRemoved', id)
    }
    for (const [id] of this._model.links) {
      this._linkViews.get(id)?.dispose(this._threeScene)
      this.emit('spatialLinkRemoved', id)
    }
    this._linkViews.clear()
    this._worldPoseCache.clear()
    this._mountLocalPositions.clear()
    this._model = new SceneModel()
  }

  // ── Aggregate root access ──────────────────────────────────────────────────

  /** Read access to the aggregate root (SceneModel). */
  get scene() { return this._model }

  // ── World pose query (ADR-020) ─────────────────────────────────────────────

  /**
   * Returns the cached world pose for a CoordinateFrame, or null if unknown.
   * The cache is populated by _updateWorldPoses() each animation frame.
   * @param {string} frameId
   * @returns {{ position: import('three').Vector3, quaternion: import('three').Quaternion }|null}
   */
  worldPoseOf(frameId) {
    return this._worldPoseCache.get(frameId) ?? null
  }

  /**
   * Recomputes and caches the world pose for every CoordinateFrame in the scene.
   * Must be called once per animation frame (from AppController animation loop).
   *
   * Position model: worldPos = parentCentroid + translation
   *
   * Frames are processed in topological order (shallow before deep) so nested
   * frame chains (ADR-019) propagate correctly in a single pass.
   * Since move() now directly updates `translation`, no grabbed/not-grabbed
   * branching is needed — worldPos is always derived from translation.
   */
  _updateWorldPoses() {
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

      // Resolve parent world position.
      // CoordinateFrame exposes `localOffset` (LocalVector3), NOT `corners`.
      // When the parent is a CoordinateFrame, use the world pose cache (already populated by the
      // topological sort above). When the parent is a geometry object, derive its centroid from
      // its world-space corners as before (PHILOSOPHY #21 Phase 3, CODE_CONTRACTS architecture.md).
      /** @type {import('../types/spatial.js').WorldVector3|null} */
      let parentWorldPos = null
      if (parent instanceof CoordinateFrame) {
        const cached = this._worldPoseCache.get(parent.id)
        if (!cached) continue               // parent not yet resolved (shouldn't happen after sort)
        parentWorldPos = cached.position
      } else {
        if (parent.corners.length === 0) continue
        const centroid = new Vector3()
        for (const c of parent.corners) centroid.add(c)
        centroid.divideScalar(parent.corners.length)
        /** @type {import('../types/spatial.js').WorldVector3} */
        parentWorldPos = /** @type {any} */ (centroid)
      }

      /** @type {import('../types/spatial.js').WorldVector3} */
      const worldPos = /** @type {any} */ (parentWorldPos.clone().add(frame.translation))

      // Update cache
      const entry = this._worldPoseCache.get(frame.id)
      if (entry) {
        entry.position.copy(worldPos)
        // quaternion is the same object as frame.rotation — no copy needed
      } else {
        this._worldPoseCache.set(frame.id, { position: worldPos.clone(), quaternion: frame.rotation })
      }

      // Update view
      frame.meshView.updatePosition(worldPos)
      frame.meshView.updateConnectionLine(parentWorldPos)
    }

    // Re-resolve all anchored MeasureLine endpoints so they follow their
    // referenced geometry elements (ADR-028).
    this._updateAnchoredMeasures()

    // Reposition mounted Annotated* entities (ADR-032 Phase H-2).
    // Must run after all CoordinateFrame poses are resolved.
    this._updateMountedAnnotations()

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

      // worldPos = H × localPos = q.rotate(localPos) + position
      const corners = localPositions.map(lp =>
        lp.clone().applyQuaternion(pose.quaternion).add(pose.position),
      )
      // Write world coords back to vertex.position so all other code sees world coords
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
    const link = this.createSpatialLink(sourceId, targetCFId, 'mounts')

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
    const view = new SpatialLinkView(this._threeScene, src, tgt, link.linkType)
    this._linkViews.set(link.id, view)
  }

  /**
   * Updates the line endpoints of every SpatialLinkView to follow entity centroids.
   * Called once per animation frame at the end of _updateWorldPoses().
   */
  _updateSpatialLinkViews() {
    for (const [id, view] of this._linkViews) {
      const link = this._model.getLink(id)
      if (!link) continue
      const src = this._entityWorldCentroid(link.sourceId)
      const tgt = this._entityWorldCentroid(link.targetId)
      if (src && tgt) view.update(src, tgt)
    }
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
      frame.translation.copy(forcedTranslation)
    } else {
      // Maintain world position: new translation = worldPos - newParentCentroid
      const worldPos = this._worldPoseCache.get(frameId)?.position
      const centroid  = this._computeObjectCentroid(newParent)
      if (worldPos && centroid) {
        frame.translation.copy(worldPos).sub(centroid)
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
      edges.push({ from: link.sourceId, to: link.targetId, relation: 'spatial', linkId: link.id, linkType: link.linkType })
    }
    return { nodes, edges }
  }

  // ── Use cases ──────────────────────────────────────────────────────────────

  /**
   * Creates a new Solid entity + MeshView, registers it in the scene, and returns it.
   * Offsets successive objects so they do not stack.
   * Emits: 'objectAdded'
   * @returns {import('../domain/Solid.js').Solid}
   */
  createSolid() {
    const idx  = this._model.objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = idx === 0 ? 'Cube' : `Cube.${String(idx).padStart(3, '0')}`

    const positions = createInitialCorners()
    if (idx > 0) {
      const step = idx * 0.5
      positions.forEach(c => { c.x += step; c.y += step })
    }

    const vertices = positions.map((pos, i) => new Vertex(`${id}_v${i}`, pos))
    const solid    = new Solid(id, name, vertices, new MeshView(this._threeScene))
    solid.meshView.updateGeometry(solid.corners)
    this._model.addObject(solid)
    this.emit('objectAdded', solid)
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
    const name = `Sketch.${String(idx).padStart(3, '0')}`

    const meshView = new MeshView(this._threeScene)
    meshView.setVisible(false)  // no geometry until the profile is drawn

    const profile = new Profile(id, name, meshView)
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
    this.emit('objectRemoved', id)
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
   * @param {import('three').WebGLRenderer} [renderer]
   * @returns {AnnotatedLine}
   */
  createAnnotatedLine(points, name, renderer) {
    const id      = `annot_line_${Date.now()}`
    const meshView = new AnnotatedLineView(this._threeScene, points, null, renderer ?? null)
    const obj     = AnnotatedLine.fromPoints(id, name ?? 'Line', points, meshView)
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
   * @param {import('three').WebGLRenderer} [renderer]
   * @returns {AnnotatedRegion}
   */
  createAnnotatedRegion(points, name, renderer) {
    const id      = `annot_region_${Date.now()}`
    const meshView = new AnnotatedRegionView(this._threeScene, points, null, renderer ?? null)
    const obj     = AnnotatedRegion.fromPoints(id, name ?? 'Region', points, meshView)
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
   * @param {string} sourceId
   * @param {string} targetId
   * @param {'references'|'connects'|'contains'|'adjacent'} linkType
   * @returns {SpatialLink}
   */
  createSpatialLink(sourceId, targetId, linkType) {
    const id   = `link_${Date.now()}`
    const link = new SpatialLink(id, sourceId, targetId, linkType)
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
    if (!this._model.getLink(id)) return
    // Clean up mount local positions before removing the link record
    this._mountLocalPositions.delete(id)
    this._model.removeLink(id)
    this._linkViews.get(id)?.dispose(this._threeScene)
    this._linkViews.delete(id)
    this.emit('spatialLinkRemoved', id)
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
    if (link.linkType === 'mounts') {
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
    this._model.removeObject(id)
    this._model.addObject(solid)
    this.emit('objectRemoved', id)
    this.emit('objectAdded', solid)
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
    this.emit('objectRemoved', id)
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

    const solid = new Solid(newId, newName, vertices, new MeshView(this._threeScene))
    solid.meshView.updateGeometry(solid.corners)
    this._model.addObject(solid)
    this.emit('objectAdded', solid)
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
    const meshView = new ImportedMeshView(this._threeScene)
    const entity   = new ImportedMesh(id, name, meshView)
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
    const name = overrideName ?? `Frame.${String(idx).padStart(3, '0')}`

    const meshView = new CoordinateFrameView(this._threeScene)
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

    // When a pick position is given, set translation = worldPos - parentCentroid.
    if (placedWorldPos && parentWorldPos) {
      frame.translation.copy(placedWorldPos).sub(parentWorldPos)
    }

    const initialWorldPos = placedWorldPos ?? parentWorldPos
    if (initialWorldPos) {
      this._worldPoseCache.set(frame.id, { position: initialWorldPos.clone(), quaternion: frame.rotation })
      meshView.updatePosition(initialWorldPos)
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
