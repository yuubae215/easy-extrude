/**
 * Cuboid — domain entity representing a 3D deformable box.
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Graph model (ADR-012, Phase 5-1): geometry is stored as Vertex[8] instead of
 * plain Vector3[8]. The `get corners()` accessor returns a Vector3[] projection
 * for backward compatibility with CuboidModel pure functions and MeshView.
 *
 * Note: `meshView` is co-located on the entity for now.
 */
import { FACES } from '../model/CuboidModel.js'

export class Cuboid {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('../graph/Vertex.js').Vertex[]} vertices  8 vertex objects
   * @param {import('../view/MeshView.js').MeshView} meshView
   */
  constructor(id, name, vertices, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /** @type {3} */
    this.dimension   = 3
    /** @type {import('../graph/Vertex.js').Vertex[]} */
    this.vertices    = vertices
    /** @type {import('../view/MeshView.js').MeshView} */
    this.meshView    = meshView
  }

  /**
   * Returns the vertex positions as a plain Vector3 array.
   * Used by CuboidModel pure functions, MeshView, and AppController.
   * @returns {import('three').Vector3[]}
   */
  get corners() {
    return this.vertices.map(v => v.position)
  }

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }

  /**
   * Translates all vertices from `startCorners` by `delta`.
   * @param {import('three').Vector3[]} startCorners  snapshot taken before drag
   * @param {import('three').Vector3}  delta
   */
  move(startCorners, delta) {
    startCorners.forEach((c, i) => { this.vertices[i].position.copy(c).add(delta) })
  }

  /**
   * Applies a face extrusion offset in-place.
   * @param {number} fi  face index (0-5)
   * @param {import('three').Vector3[]} savedFaceCorners  4 corners snapshot before drag
   * @param {import('three').Vector3}  normal  outward face normal (unit vector)
   * @param {number} dist  signed extrusion distance
   */
  extrudeFace(fi, savedFaceCorners, normal, dist) {
    const offset = normal.clone().multiplyScalar(dist)
    FACES[fi].corners.forEach((ci, i) => {
      this.vertices[ci].position.copy(savedFaceCorners[i]).add(offset)
    })
  }
}
