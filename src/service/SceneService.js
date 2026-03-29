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
 *   'objectAdded'   (obj: SceneObject)
 *   'objectRemoved' (id: string)
 *   'objectRenamed' (id: string, name: string)
 *   'activeChanged' (id: string|null)
 *
 * Rules:
 *  - SceneService is the ONLY place that calls new Solid / new Profile / new MeshView.
 *  - SceneService is the ONLY place that calls SceneModel.addObject / removeObject.
 *  - Callers (AppController) interact with domain state through `service.scene`
 *    for reads and through service methods for writes.
 */
import { Vector3 } from 'three'
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
     * @type {Map<string, { position: import('three').Vector3, quaternion: import('three').Quaternion }>}
     */
    this._worldPoseCache = new Map()
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
   * Phase C: If the objectId is not yet registered in the SceneModel, an
   * ImportedMesh is auto-created (thin-client entity for server-side geometry).
   *
   * @param {{ objectId: string, positions: number[], normals: number[], indices: number[] }} payload
   */
  _applyGeometryUpdate({ objectId, positions, normals, indices }) {
    if (!objectId || !positions?.length) return

    let obj = this._model.getObject(objectId)

    // Auto-create an ImportedMesh when the server references an unknown object
    if (!obj) {
      obj = this.createImportedMesh(objectId, `Import_${objectId}`)
    }

    if (obj instanceof ImportedMesh) {
      try {
        obj.meshView.updateGeometryBuffers(positions, normals, indices)
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
    const corners = _positionsToCorners(positions)
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
      this._remoteId = sceneId
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
        solid.meshView.updateGeometry(solid.corners)
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
        const e0 = new Edge(`${dto.id}_e0`, v0, v1)
        const meshView = new MeasureLineView(this._threeScene, container, camera, renderer)
        const entity   = new MeasureLine(dto.id, dto.name, [v0, v1], [e0], meshView)
        meshView.update(entity.p1, entity.p2)
        entities.push(entity)
      } else if (dto.type === 'ImportedMesh') {
        const meshView  = new ImportedMeshView(this._threeScene)
        const entity    = new ImportedMesh(dto.id, dto.name, meshView)
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
        entities.push(frame)
      }
    }
    return entities
  }

  /** Disposes all objects and resets the model (local). Emits objectRemoved for each. */
  _clearScene() {
    for (const [id, obj] of this._model.objects) {
      obj.meshView.dispose(this._threeScene)
      this.emit('objectRemoved', id)
    }
    this._worldPoseCache.clear()
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
      if (!parent || parent.corners.length === 0) continue

      // Compute parent centroid inline (parent.corners may be from any LocalGeometry type)
      const parentCentroid = new Vector3()
      for (const c of parent.corners) parentCentroid.add(c)
      parentCentroid.divideScalar(parent.corners.length)

      const worldPos = parentCentroid.clone().add(frame.translation)

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
      frame.meshView.updateConnectionLine(parentCentroid)
    }
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
    this.createCoordinateFrame(id, 'Origin')
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
    this.createCoordinateFrame(id, 'Origin')
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
    this.createCoordinateFrame(newId, 'Origin')
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
   * @param {THREE.Vector3} p1         start endpoint (world space)
   * @param {THREE.Vector3} p2         end endpoint (world space)
   * @param {THREE.Camera}  camera     used by MeasureLineView for label projection
   * @param {THREE.WebGLRenderer} renderer  used for canvas bounds
   * @param {HTMLElement}   container  DOM element for the HTML label
   * @returns {import('../domain/MeasureLine.js').MeasureLine}
   */
  createMeasureLine(p1, p2, camera, renderer, container) {
    const idx  = this._model.objects.size
    const id   = `ml_${idx}_${Date.now()}`
    const name = `Measure.${String(idx).padStart(3, '0')}`

    // Build Vertex + Edge graph before constructing the entity (ADR-021)
    const v0 = new Vertex(`${id}_v0`, p1.clone())
    const v1 = new Vertex(`${id}_v1`, p2.clone())
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
  createCoordinateFrame(parentObjectId, overrideName = null) {
    const parent = this._model.getObject(parentObjectId)
    if (!parent || parent instanceof MeasureLine || parent instanceof ImportedMesh) return null

    const idx  = this._model.objects.size
    const id   = `frame_${idx}_${Date.now()}`
    const name = overrideName ?? `Frame.${String(idx).padStart(3, '0')}`

    const meshView = new CoordinateFrameView(this._threeScene)
    const frame    = new CoordinateFrame(id, name, parentObjectId, meshView)

    // Initialise the world pose cache and visual position at parent centroid.
    // translation = (0,0,0) so the frame starts exactly at the parent origin.
    const corners = parent.corners
    if (corners.length > 0) {
      const centroid = new Vector3()
      for (const c of corners) centroid.add(c)
      centroid.divideScalar(corners.length)
      this._worldPoseCache.set(frame.id, { position: centroid.clone(), quaternion: frame.rotation })
      meshView.updatePosition(centroid)
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
