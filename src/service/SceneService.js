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

export class SceneService extends EventEmitter {
  /**
   * @param {import('three').Scene} threeScene  Three.js scene used for MeshView creation/disposal
   */
  constructor(threeScene) {
    super()
    this._threeScene = threeScene
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

    const corners = createInitialCorners()
    if (idx > 0) {
      const step = idx * 0.5
      corners.forEach(c => { c.x += step; c.y += step })
    }

    const meshView = new MeshView(this._threeScene)
    meshView.updateGeometry(corners)

    const cuboid = new Cuboid(id, name, corners, meshView)
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
