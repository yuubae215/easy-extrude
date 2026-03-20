/**
 * Edge - a line segment connecting two vertices.
 *
 * Graph model (ADR-012, Phase 5-3): explicit edge representation,
 * replaces the implicit edge relationships encoded in FACES[i].corners.
 */

export class Edge {
  /**
   * @param {string} id
   * @param {import('./Vertex.js').Vertex} v0
   * @param {import('./Vertex.js').Vertex} v1
   */
  constructor(id, v0, v1) {
    this.id = id
    this.v0 = v0
    this.v1 = v1
  }
}
