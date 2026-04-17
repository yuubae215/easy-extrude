/**
 * MeasureLine — domain entity for a 1D measurement line.
 *
 * Graph model (ADR-021):
 *   Implements the LocalGeometry interface: vertices: Vertex[2], edges: Edge[1].
 *   `p1` / `p2` / `distance` are retained as @deprecated backward-compatible
 *   getters to avoid breaking existing call sites at once.
 *
 * The line can be moved as a whole via Grab (G key) or repositioned endpoint-
 * by-endpoint via Edit Mode (Tab key → drag endpoint).
 *
 * Type identity:
 *   `instanceof MeasureLine` → 1D measurement; move OK, Edit Mode (endpoint drag).
 *   `instanceof Solid`       → locally-editable deformable 3D solid.
 *   `instanceof Profile`     → 2D cross-section awaiting extrusion.
 *   `instanceof ImportedMesh`→ server-side geometry; move OK, no Edit Mode.
 *
 * @see ADR-021, ADR-012
 */
import { Vertex } from '../graph/Vertex.js'
import { Edge }   from '../graph/Edge.js'

export class MeasureLine {
  /**
   * @param {string}        id
   * @param {string}        name
   * @param {import('../graph/Vertex.js').Vertex[]} vertices  [v0, v1] — two endpoints
   * @param {import('../graph/Edge.js').Edge[]}     edges     [e0] — single edge
   * @param {import('../view/MeasureLineView.js').MeasureLineView} meshView
   */
  constructor(id, name, vertices, edges, meshView) {
    this.id       = id
    this.name     = name
    /** @type {import('../graph/Vertex.js').Vertex[]}  2 endpoint vertices */
    this.vertices = vertices
    /** @type {import('../graph/Edge.js').Edge[]}  1 edge connecting the endpoints */
    this.edges    = edges
    /** @type {[]}  always empty — MeasureLine is 1D (no faces) */
    this.faces    = []
    this.meshView = meshView
  }

  // ── Backward-compatible getters (@deprecated — use vertices[i].position directly) ──

  /** @deprecated Use `vertices[0].position` */
  get p1() { return this.vertices[0].position }
  /** @deprecated Use `vertices[1].position` */
  get p2() { return this.vertices[1].position }
  /** World-space distance between the two endpoints (metres). */
  get distance() { return this.p1.distanceTo(this.p2) }

  // ── LocalGeometry interface ────────────────────────────────────────────────

  /**
   * Returns [p1, p2] as the canonical "corners" used by the grab/drag system.
   * The Vector3 instances are the Vertex positions directly (not copies), so the
   * cancel-grab restore path (`corners[i].copy(saved)`) works correctly.
   * @returns {import('three').Vector3[]}
   */
  get corners() { return this.vertices.map(v => v.position) }

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }

  /**
   * Translates both endpoints by delta (same API as Solid.move).
   * AppController calls meshView.updateGeometry() separately after this.
   * @param {import('three').Vector3[]} startCorners  [p1_snap, p2_snap] taken at drag start
   * @param {import('three').Vector3}   delta         displacement from start
   */
  move(startCorners, delta) {
    this.vertices.forEach((v, i) => { v.position.copy(startCorners[i]).add(delta) })
  }

  /**
   * Updates both endpoints and refreshes the view.
   * @param {import('three').Vector3} p1
   * @param {import('three').Vector3} p2
   */
  setEndpoints(p1, p2) {
    this.vertices[0].position.copy(p1)
    this.vertices[1].position.copy(p2)
    this.meshView?.update(this.p1, this.p2)
  }
}
