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
import { EventEmitter } from '../core/EventEmitter.js'
import { SceneModel } from '../model/SceneModel.js'
import { MeshView } from '../view/MeshView.js'
import { Cuboid } from '../domain/Cuboid.js'
import { Sketch } from '../domain/Sketch.js'
import { createInitialCorners } from '../model/CuboidModel.js'
import { Vertex } from '../graph/Vertex.js'
import { BffClient, BffUnavailableError } from './BffClient.js'
import { serializeScene, deserializeScene } from './SceneSerializer.js'

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
      const { entities } = deserializeScene(remote.data, this._threeScene)
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
