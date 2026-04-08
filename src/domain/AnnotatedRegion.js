/**
 * AnnotatedRegion — domain entity for a 2D annotated areal element.
 *
 * Represents an areal spatial feature whose position and extent carry semantic meaning.
 * Valid placeType value: 'Zone' (bounded area with identifiable character).
 *
 * Scale-independent: usable at city scale (neighbourhood), building scale
 * (room, department), or part scale (work area, manufacturing cell).
 *
 * Graph model (ADR-021):
 *   Implements the LocalGeometry interface.
 *   vertices: Vertex[N]  — ordered ring of N ≥ 3 points (CCW from above)
 *   edges:    Edge[N]    — closed ring (v0→v1, …, v[N-2]→v[N-1], v[N-1]→v0)
 *   faces:    []         — always empty (2D planar entity; interior is implicit)
 *
 * The polygon is implicitly closed: the last edge connects the final vertex
 * back to the first.  No duplicate vertex is stored.
 *
 * The `placeType` field carries the semantic place classification ('Zone').
 *
 * Type identity:
 *   `instanceof AnnotatedRegion` → areal annotated element; move OK, no Edit Mode.
 *
 * @see ADR-029, ADR-021, ADR-020
 */
import { Vertex } from '../graph/Vertex.js'
import { Edge }   from '../graph/Edge.js'

export class AnnotatedRegion {
  /**
   * @param {string}   id
   * @param {string}   name
   * @param {Vertex[]} vertices  ordered ring, N ≥ 3
   * @param {Edge[]}   edges     N closing edges
   * @param {object}   meshView  rendering context (AnnotatedRegionView)
   */
  constructor(id, name, vertices, edges, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /**
     * Semantic place type.
     * @type {'Zone'|null}
     * @see ADR-029, PlaceTypeRegistry
     */
    this.placeType   = null
    /** @type {Vertex[]} */
    this.vertices    = vertices
    /** @type {Edge[]} */
    this.edges       = edges
    /** @type {[]}  always empty — AnnotatedRegion is a 2D planar entity */
    this.faces       = []
    this.meshView    = meshView
  }

  // ── LocalGeometry interface ────────────────────────────────────────────────

  /**
   * Returns vertex positions as a plain Vector3 array.
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
   * Builds an AnnotatedRegion from an ordered ring of Vector3 points.
   * The polygon is implicitly closed; do NOT pass the first point again at the end.
   * @param {string}                    id
   * @param {string}                    name
   * @param {import('three').Vector3[]} points   N ≥ 3 points in ring order (CCW from +Z)
   * @param {object}                    meshView
   * @returns {AnnotatedRegion}
   */
  static fromPoints(id, name, points, meshView) {
    const vertices = points.map((p, i) => new Vertex(`${id}_v${i}`, p.clone()))
    const n = vertices.length
    const edges = vertices.map((v, i) =>
      new Edge(`${id}_e${i}`, v, vertices[(i + 1) % n])
    )
    return new AnnotatedRegion(id, name, vertices, edges, meshView)
  }
}
