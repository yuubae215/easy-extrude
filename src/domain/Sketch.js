/**
 * Sketch — domain entity representing a 2D rectangular sketch.
 *
 * After extrusion, `dimension` is promoted to 3 and `corners`/`sketchRect`
 * are populated in-place (Phase 1 behaviour).
 * Phase 2 will introduce an explicit `extrude()` method that returns a Cuboid.
 *
 * DDD Phase 1: typed entity with guaranteed field shape.
 *
 * Note: `meshView` is co-located on the entity for now.
 * View/model separation completes in Phase 4 (domain events).
 */
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
}
