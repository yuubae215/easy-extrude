/**
 * AnnotatedLine — domain entity for a 2D annotated linear element.
 *
 * Represents a linear spatial feature whose position carries semantic meaning.
 * Valid placeType values: 'Route' (movement channel) or 'Boundary' (separating edge).
 *
 * Scale-independent: usable at city scale (street, shoreline), building scale
 * (corridor, wall), or part scale (feed path, area boundary).
 *
 * Graph model (ADR-021):
 *   Implements the LocalGeometry interface.
 *   vertices: Vertex[N]   — ordered sequence of N ≥ 2 points
 *   edges:    Edge[N-1]   — sequential connections (v0→v1, v1→v2, …)
 *   faces:    []          — always empty (2D open linear entity)
 *
 * The entity lives in the XY plane (Z = 0 for ground-level elements).
 * The `placeType` field carries the semantic place classification ('Route' | 'Boundary').
 *
 * Type identity:
 *   `instanceof AnnotatedLine` → linear annotated element; move OK, no Edit Mode.
 *
 * @see ADR-029, ADR-021, ADR-020
 */
import { Vertex } from '../graph/Vertex.js'
import { Edge }   from '../graph/Edge.js'

export class AnnotatedLine {
  /**
   * @param {string}   id
   * @param {string}   name
   * @param {Vertex[]} vertices  ordered sequence, N ≥ 2
   * @param {Edge[]}   edges     N-1 sequential edges
   * @param {object}   meshView  rendering context (AnnotatedLineView)
   */
  constructor(id, name, vertices, edges, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /**
     * Semantic place type.
     * @type {'Route'|'Boundary'|null}
     * @see ADR-029, PlaceTypeRegistry
     */
    this.placeType   = null
    /** @type {Vertex[]} */
    this.vertices    = vertices
    /** @type {Edge[]} */
    this.edges       = edges
    /** @type {[]}  always empty — AnnotatedLine is a 2D open linear entity */
    this.faces       = []
    this.meshView    = meshView
  }

  // ── LocalGeometry interface ────────────────────────────────────────────────

  /**
   * Returns vertex positions as a plain Vector3 array.
   * Used by the grab/drag system.
   * @returns {import('three').Vector3[]}
   */
  get corners() { return this.vertices.map(v => v.position) }

  /** Renames the entity. */
  rename(name) { this.name = name }

  /**
   * Translates all vertices by delta.
   * @param {import('three').Vector3[]} startCorners  snapshot taken before drag
   * @param {import('three').Vector3}   delta
   */
  move(startCorners, delta) {
    this.vertices.forEach((v, i) => { v.position.copy(startCorners[i]).add(delta) })
  }

  // ── Factory helper ─────────────────────────────────────────────────────────

  /**
   * Builds an AnnotatedLine from an ordered array of Vector3 points.
   * Vertex and Edge ids are derived from the entity id.
   * @param {string}                    id
   * @param {string}                    name
   * @param {import('three').Vector3[]} points   N ≥ 2 ordered points
   * @param {object}                    meshView
   * @returns {AnnotatedLine}
   */
  static fromPoints(id, name, points, meshView) {
    const vertices = points.map((p, i) => new Vertex(`${id}_v${i}`, p.clone()))
    const edges = []
    for (let i = 0; i < vertices.length - 1; i++) {
      edges.push(new Edge(`${id}_e${i}`, vertices[i], vertices[i + 1]))
    }
    return new AnnotatedLine(id, name, vertices, edges, meshView)
  }
}
