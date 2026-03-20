/**
 * Cuboid — domain entity representing a 3D deformable box.
 *
 * DDD Phase 1: typed entity with guaranteed field shape.
 * Phase 2 will add behaviour methods (extrude, move, rename, etc.).
 *
 * Note: `meshView` is co-located on the entity for now.
 * View/model separation completes in Phase 4 (domain events).
 */
export class Cuboid {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('three').Vector3[]} corners  8 corner vectors
   * @param {import('../view/MeshView.js').MeshView} meshView
   */
  constructor(id, name, corners, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /** @type {3} */
    this.dimension   = 3
    /** @type {import('three').Vector3[]} */
    this.corners     = corners
    /** @type {import('../view/MeshView.js').MeshView} */
    this.meshView    = meshView
  }
}
