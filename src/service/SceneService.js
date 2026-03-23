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
 *  - SceneService is the ONLY place that calls new Cuboid / new Sketch / new MeshView.
 *  - SceneService is the ONLY place that calls SceneModel.addObject / removeObject.
 *  - Callers (AppController) interact with domain state through `service.scene`
 *    for reads and through service methods for writes.
 */
import { Vector3 } from 'three'
import { EventEmitter } from '../core/EventEmitter.js'
import { SceneModel } from '../model/SceneModel.js'
import { MeshView } from '../view/MeshView.js'
import { Cuboid } from '../domain/Cuboid.js'
import { Sketch } from '../domain/Sketch.js'
import { createInitialCorners } from '../model/CuboidModel.js'
import { Vertex } from '../graph/Vertex.js'
import { BffClient, BffUnavailableError, WsChannel } from './BffClient.js'
import { serializeScene } from './SceneSerializer.js'
import { ImportedMesh } from '../domain/ImportedMesh.js'
import { ImportedMeshView } from '../view/ImportedMeshView.js'
import { MeasureLine } from '../domain/MeasureLine.js'
import { MeasureLineView } from '../view/MeasureLineView.js'

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
   * @returns {Promise<boolean>}  true on success
   */
  async loadScene(sceneId) {
    if (!this._bff) return false
    try {
      const remote = await this._bff.getScene(sceneId)
      this._clearScene()
      const entities = this._deserializeEntities(remote.data)
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
   * Kept in SceneService so entity creation (new Cuboid/Sketch/MeshView)
   * stays within the service boundary (ADR-011).
   * @param {object} data  Parsed `data` field from BFF
   * @returns {(Cuboid|Sketch)[]}
   */
  _deserializeEntities(data) {
    const entities = []
    for (const dto of (data.objects ?? [])) {
      if (dto.type === 'Cuboid') {
        const vertices = dto.vertices.map(v =>
          new Vertex(v.id, new Vector3(v.x, v.y, v.z))
        )
        const cuboid = new Cuboid(dto.id, dto.name, vertices, new MeshView(this._threeScene))
        cuboid.description = dto.description ?? ''
        cuboid.meshView.updateGeometry(cuboid.corners)
        entities.push(cuboid)
      } else if (dto.type === 'Sketch') {
        const meshView = new MeshView(this._threeScene)
        meshView.setVisible(false)
        const sketch = new Sketch(dto.id, dto.name, meshView)
        sketch.description = dto.description ?? ''
        if (dto.sketchRect) {
          sketch.sketchRect = {
            p1: new Vector3(dto.sketchRect.p1.x, dto.sketchRect.p1.y, dto.sketchRect.p1.z),
            p2: new Vector3(dto.sketchRect.p2.x, dto.sketchRect.p2.y, dto.sketchRect.p2.z),
          }
        }
        entities.push(sketch)
      }
    }
    return entities
  }

  /** Disposes all objects and resets the model (local). */
  _clearScene() {
    for (const obj of this._model.objects.values()) {
      obj.meshView.dispose(this._threeScene)
    }
    this._model = new SceneModel()
  }

  // ── Aggregate root access ──────────────────────────────────────────────────

  /** Read access to the aggregate root (SceneModel). */
  get scene() { return this._model }

  // ── Use cases ──────────────────────────────────────────────────────────────

  /**
   * Creates a new Cuboid entity + MeshView, registers it in the scene, and returns it.
   * Offsets successive objects so they do not stack.
   * Emits: 'objectAdded'
   * @returns {import('../domain/Cuboid.js').Cuboid}
   */
  createCuboid() {
    const idx  = this._model.objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = idx === 0 ? 'Cube' : `Cube.${String(idx).padStart(3, '0')}`

    const positions = createInitialCorners()
    if (idx > 0) {
      const step = idx * 0.5
      positions.forEach(c => { c.x += step; c.y += step })
    }

    const vertices = positions.map((pos, i) => new Vertex(`${id}_v${i}`, pos))
    const cuboid   = new Cuboid(id, name, vertices, new MeshView(this._threeScene))
    cuboid.meshView.updateGeometry(cuboid.corners)
    this._model.addObject(cuboid)
    this.emit('objectAdded', cuboid)
    return cuboid
  }

  /**
   * Creates a new Sketch entity + MeshView (hidden until drawn), registers it,
   * and returns it.
   * Emits: 'objectAdded'
   * @returns {import('../domain/Sketch.js').Sketch}
   */
  createSketch() {
    const idx  = this._model.objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = `Sketch.${String(idx).padStart(3, '0')}`

    const meshView = new MeshView(this._threeScene)
    meshView.setVisible(false)  // no geometry until the sketch is drawn

    const sketch = new Sketch(id, name, meshView)
    this._model.addObject(sketch)
    this.emit('objectAdded', sketch)
    return sketch
  }

  /**
   * Disposes the entity's MeshView and removes it from the scene.
   * No-ops if the id is unknown.
   * Emits: 'objectRemoved'
   * @param {string} id
   */
  deleteObject(id) {
    const obj = this._model.getObject(id)
    if (!obj) return
    obj.meshView.dispose(this._threeScene)
    this._model.removeObject(id)
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
   * Extrudes a Sketch into a Cuboid and replaces it in the scene.
   * The Sketch entity is discarded; the returned Cuboid reuses the same id,
   * name, and MeshView so the Outliner requires no update.
   * No-ops if the id does not refer to a Sketch.
   * @param {string} id
   * @param {number} height  signed extrusion height in world Z units
   * @returns {import('../domain/Cuboid.js').Cuboid|null}
   */
  extrudeSketch(id, height) {
    const sketch = this._model.getObject(id)
    if (!(sketch instanceof Sketch)) return null
    const cuboid = sketch.extrude(height)
    this._model.removeObject(id)
    this._model.addObject(cuboid)
    return cuboid
  }

  /**
   * Duplicates a Cuboid, giving it new ids and a slight XY offset.
   * No-ops if id is unknown or refers to a Sketch.
   * Emits: 'objectAdded'
   * @param {string} id
   * @returns {import('../domain/Cuboid.js').Cuboid|null}
   */
  duplicateCuboid(id) {
    const src = this._model.getObject(id)
    if (!(src instanceof Cuboid)) return null

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

    const cuboid = new Cuboid(newId, newName, vertices, new MeshView(this._threeScene))
    cuboid.meshView.updateGeometry(cuboid.corners)
    this._model.addObject(cuboid)
    this.emit('objectAdded', cuboid)
    return cuboid
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

    const meshView = new MeasureLineView(this._threeScene, container, camera, renderer)
    const entity   = new MeasureLine(id, name, p1, p2, meshView)
    meshView.update(p1, p2)
    this._model.addObject(entity)
    this.emit('objectAdded', entity)
    return entity
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
