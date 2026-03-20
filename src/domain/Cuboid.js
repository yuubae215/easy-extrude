/**
 * Cuboid — domain entity representing a 3D deformable box.
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Note: `meshView` is co-located on the entity for now.
 * View/model separation completes in Phase 4 (domain events).
 */
import { FACES } from '../model/CuboidModel.js'

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

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }

  /**
   * Translates all corners from `startCorners` by `delta`.
   * @param {import('three').Vector3[]} startCorners  snapshot taken before drag
   * @param {import('three').Vector3}  delta
   */
  move(startCorners, delta) {
    startCorners.forEach((c, i) => { this.corners[i].copy(c).add(delta) })
  }

  /**
   * Applies a face extrusion offset in-place.
   * @param {number} fi  face index (0–5)
   * @param {import('three').Vector3[]} savedFaceCorners  4 corners snapshot before drag
   * @param {import('three').Vector3}  normal  outward face normal (unit vector)
   * @param {number} dist  signed extrusion distance
   */
  extrudeFace(fi, savedFaceCorners, normal, dist) {
    const offset = normal.clone().multiplyScalar(dist)
    FACES[fi].corners.forEach((ci, i) => {
      this.corners[ci].copy(savedFaceCorners[i]).add(offset)
    })
  }
}
