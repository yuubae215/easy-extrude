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
    /**
     * Optional anchor to a geometry element of another scene object (ADR-028).
     * When set, SceneService._updateAnchoredMeasures() recomputes this vertex's
     * world position from the referenced element every animation frame, so the
     * MeasureLine endpoint follows the anchored object when it moves.
     *
     * null  = free-floating vertex (default)
     * @type {{ objectId: string, type: 'vertex'|'edge'|'face', elementId: string }|null}
     */
    this.anchorRef = null
  }

  /** Returns a new Vertex with the same id and a cloned position. */
  clone() {
    return new Vertex(this.id, this.position.clone())
  }
}
