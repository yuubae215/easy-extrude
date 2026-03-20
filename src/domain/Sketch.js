/**
 * Sketch — domain entity representing a 2D rectangular sketch (unextruded).
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Graph model (ADR-012, Phase 5-3):
 *   - `dimension` field removed; entity type (instanceof Sketch) carries the
 *     dimensional identity.
 *   - `extrude()` no longer mutates this entity. It returns a new Cuboid,
 *     and SceneService.extrudeSketch() replaces the Sketch in the scene.
 *
 * Note: `meshView` is co-located on the entity for now.
 */
import { buildCuboidFromRect } from '../model/CuboidModel.js'
import { Cuboid }              from './Cuboid.js'
import { Vertex }              from '../graph/Vertex.js'

export class Sketch {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('../view/MeshView.js').MeshView} meshView
   */
  constructor(id, name, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /** @type {{ p1: import('three').Vector3, p2: import('three').Vector3 } | null} */
    this.sketchRect  = null
    /** @type {import('../view/MeshView.js').MeshView} */
    this.meshView    = meshView
  }

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }

  /**
   * Creates a new Cuboid from the current `sketchRect` extruded by `height`.
   * The Sketch itself is NOT mutated; SceneService replaces it in the scene.
   * Requires `sketchRect` to be set before calling.
   * @param {number} height  signed extrusion height in world Z units
   * @returns {import('./Cuboid.js').Cuboid}
   */
  extrude(height) {
    const positions = buildCuboidFromRect(this.sketchRect.p1, this.sketchRect.p2, height)
    const vertices  = positions.map((pos, i) => new Vertex(`${this.id}_v${i}`, pos))
    return new Cuboid(this.id, this.name, vertices, this.meshView)
  }
}
