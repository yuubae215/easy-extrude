/**
 * Face - a planar polygon defined by an ordered list of vertices.
 *
 * Graph model (ADR-012, Phase 5-3): explicit face representation,
 * replaces the implicit face definitions in CuboidModel.FACES.
 *
 * `index` is the 0-based position in the owning Cuboid.faces array (0-5).
 * It is stored on the Face so that callers can pass Face objects to methods
 * that still accept a face index (e.g. MeshView.setFaceHighlight).
 */

export class Face {
  /**
   * @param {string} id
   * @param {import('./Vertex.js').Vertex[]} vertices  4 vertex objects in CCW order (as seen from outside)
   * @param {string} name  human-readable label, e.g. 'Front (+X)'
   * @param {number} index  0-based index in the owning Cuboid.faces array
   */
  constructor(id, vertices, name, index) {
    this.id       = id
    this.vertices = vertices
    this.name     = name
    this.index    = index
  }

  /**
   * Returns the vertex positions as a plain Vector3 array.
   * Convenience accessor compatible with CuboidModel pure functions.
   * @returns {import('three').Vector3[]}
   */
  get corners() {
    return this.vertices.map(v => v.position)
  }
}
