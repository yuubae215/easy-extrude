/**
 * UrbanPolyline — domain entity for a 2D urban linear element.
 *
 * Represents Kevin Lynch's linear elements at city/map scale:
 *   - Path  (パス)  : channels of movement — streets, walkways, transit lines
 *   - Edge  (エッジ) : linear boundaries — shorelines, walls, fences, railroad cuts
 *
 * Graph model (ADR-021):
 *   Implements the LocalGeometry interface.
 *   vertices: Vertex[N]   — ordered sequence of N ≥ 2 points
 *   edges:    Edge[N-1]   — sequential connections (v0→v1, v1→v2, …, v[N-2]→v[N-1])
 *   faces:    []          — always empty (2D / open linear entity)
 *
 * The entity lives in the XY plane (Z = 0 for ground-level urban elements).
 * The `lynchClass` field carries the semantic Lynch classification ('Path' | 'Edge').
 *
 * Type identity:
 *   `instanceof UrbanPolyline` → linear urban element; move OK, no Edit Mode (planned).
 *
 * @see ADR-026, ADR-021, ADR-020
 */
import { Vertex } from '../graph/Vertex.js'
import { Edge }   from '../graph/Edge.js'

export class UrbanPolyline {
  /**
   * @param {string}   id
   * @param {string}   name
   * @param {Vertex[]} vertices  ordered sequence, N ≥ 2
   * @param {Edge[]}   edges     N-1 sequential edges
   * @param {object}   meshView  rendering context (UrbanPolylineView, future)
   */
  constructor(id, name, vertices, edges, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /**
     * Lynch semantic class.
     * @type {'Path'|'Edge'|null}
     * @see ADR-026, LynchClassRegistry
     */
    this.lynchClass  = null
    /** @type {Vertex[]} */
    this.vertices    = vertices
    /** @type {Edge[]} */
    this.edges       = edges
    /** @type {[]}  always empty — UrbanPolyline is a 2D open linear entity */
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
   * Builds an UrbanPolyline from an ordered array of Vector3 points.
   * Vertex and Edge ids are derived from the entity id.
   * @param {string}                    id
   * @param {string}                    name
   * @param {import('three').Vector3[]} points   N ≥ 2 ordered points
   * @param {object}                    meshView
   * @returns {UrbanPolyline}
   */
  static fromPoints(id, name, points, meshView) {
    const vertices = points.map((p, i) => {
      const v = new Vertex(`${id}_v${i}`)
      v.position.copy(p)
      return v
    })
    const edges = []
    for (let i = 0; i < vertices.length - 1; i++) {
      edges.push(new Edge(`${id}_e${i}`, vertices[i], vertices[i + 1]))
    }
    return new UrbanPolyline(id, name, vertices, edges, meshView)
  }
}
