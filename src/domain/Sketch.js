/**
 * Sketch — domain entity representing a 2D rectangular sketch.
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Note: `meshView` is co-located on the entity for now.
 * View/model separation completes in Phase 4 (domain events).
 */
import { buildCuboidFromRect } from '../model/CuboidModel.js'

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
    /** @type {2|3} — promoted to 3 after extrusion */
    this.dimension   = 2
    /** @type {import('three').Vector3[]} — populated after extrusion */
    this.corners     = []
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
   * Extrudes the current `sketchRect` to a cuboid in-place.
   * Promotes `dimension` to 3 and populates `corners`.
   * Requires `sketchRect` to be set before calling.
   * @param {number} height  signed extrusion height in world Z units
   * @returns {import('three').Vector3[]}  the new corners array
   */
  extrude(height) {
    const corners = buildCuboidFromRect(this.sketchRect.p1, this.sketchRect.p2, height)
    this.corners   = corners
    this.dimension = 3
    return corners
  }
}
