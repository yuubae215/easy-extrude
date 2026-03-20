/**
 * Vertex - a point in 3D space with a stable identity.
 *
 * The `id` enables vertex-level selection (G-V) in future phases.
 * `position` is the mutable THREE.Vector3 used by all geometry operations.
 *
 * Graph model (ADR-012, Phase 5-1): replaces plain Vector3 entries in
 * Cuboid.corners / Sketch.corners.
 */

export class Vertex {
  /**
   * @param {string} id
   * @param {import('three').Vector3} position
   */
  constructor(id, position) {
    this.id       = id
    this.position = position
  }

  /** Returns a new Vertex with the same id and a cloned position. */
  clone() {
    return new Vertex(this.id, this.position.clone())
  }
}
