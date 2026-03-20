/**
 * Sketch — domain entity representing a 2D rectangular sketch.
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Note: `meshView` is co-located on the entity for now.
 * View/model separation completes in Phase 4 (domain events).
 */
import { buildCuboidFromRect, FACES } from '../model/CuboidModel.js'

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
   * Translates all corners from `startCorners` by `delta`.
   * Available once the sketch has been extruded (dimension === 3).
   * @param {import('three').Vector3[]} startCorners  snapshot taken before drag
   * @param {import('three').Vector3}  delta
   */
  move(startCorners, delta) {
    startCorners.forEach((c, i) => { this.corners[i].copy(c).add(delta) })
  }

  /**
   * Applies a face extrusion offset in-place.
   * Available once the sketch has been extruded (dimension === 3).
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
