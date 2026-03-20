/**
 * Cuboid — domain entity representing a 3D deformable box.
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Graph model (ADR-012):
 *   Phase 5-1: geometry stored as Vertex[8]; `get corners()` provides backward compat.
 *   Phase 5-3: explicit Face[6] and Edge[12] objects; `dimension` field removed —
 *              entity type (instanceof Cuboid) now carries the dimensional identity.
 *
 * Note: `meshView` is co-located on the entity for now.
 */
import { FACES } from '../model/CuboidModel.js'
import { Face }  from '../graph/Face.js'
import { Edge }  from '../graph/Edge.js'

// 12 unique edges of a cuboid (vertex index pairs).
// Order: 4 bottom ring, 4 top ring, 4 vertical pillars.
const EDGE_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 0],  // bottom ring
  [4, 5], [5, 6], [6, 7], [7, 4],  // top ring
  [0, 4], [1, 5], [2, 6], [3, 7],  // vertical
]

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
    /** @type {import('../graph/Vertex.js').Vertex[]} */
    this.vertices    = vertices

    /** @type {import('../graph/Face.js').Face[]}  6 faces in FACES order */
    this.faces = FACES.map((f, fi) =>
      new Face(`${id}_f${fi}`, f.corners.map(ci => vertices[ci]), f.name, fi)
    )

    /** @type {import('../graph/Edge.js').Edge[]}  12 edges */
    this.edges = EDGE_PAIRS.map(([a, b], ei) =>
      new Edge(`${id}_e${ei}`, vertices[a], vertices[b])
    )

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
   * @param {import('../graph/Face.js').Face} face  the face to extrude
   * @param {import('three').Vector3[]} savedFaceCorners  4 corner snapshots before drag
   * @param {import('three').Vector3}  normal  outward face normal (unit vector)
   * @param {number} dist  signed extrusion distance
   */
  extrudeFace(face, savedFaceCorners, normal, dist) {
    const offset = normal.clone().multiplyScalar(dist)
    face.vertices.forEach((v, i) => {
      v.position.copy(savedFaceCorners[i]).add(offset)
    })
  }
}
