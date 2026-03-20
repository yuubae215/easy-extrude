/**
 * Sketch — domain entity representing a 2D rectangular sketch.
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Graph model (ADR-012, Phase 5-1): geometry is stored as Vertex[] instead of
 * plain Vector3[]. The `get corners()` accessor returns a Vector3[] projection
 * for backward compatibility with CuboidModel pure functions and MeshView.
 *
 * Note: `meshView` is co-located on the entity for now.
 */
import { buildCuboidFromRect, FACES } from '../model/CuboidModel.js'
import { Vertex } from '../graph/Vertex.js'

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
    /** @type {2|3} - promoted to 3 after extrusion */
    this.dimension   = 2
    /** @type {import('../graph/Vertex.js').Vertex[]} - populated after extrusion */
    this.vertices    = []
    /** @type {{ p1: import('three').Vector3, p2: import('three').Vector3 } | null} */
    this.sketchRect  = null
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
   * Available once the sketch has been extruded (dimension === 3).
   * @param {import('three').Vector3[]} startCorners  snapshot taken before drag
   * @param {import('three').Vector3}  delta
   */
  move(startCorners, delta) {
    startCorners.forEach((c, i) => { this.vertices[i].position.copy(c).add(delta) })
  }

  /**
   * Applies a face extrusion offset in-place.
   * Available once the sketch has been extruded (dimension === 3).
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

  /**
   * Extrudes the current `sketchRect` to a cuboid in-place.
   * Promotes `dimension` to 3 and populates `vertices`.
   * Requires `sketchRect` to be set before calling.
   * @param {number} height  signed extrusion height in world Z units
   * @returns {import('three').Vector3[]}  corner positions for backward compatibility
   */
  extrude(height) {
    const positions = buildCuboidFromRect(this.sketchRect.p1, this.sketchRect.p2, height)
    this.vertices  = positions.map((pos, i) => new Vertex(`${this.id}_v${i}`, pos))
    this.dimension = 3
    return this.corners
  }
}
