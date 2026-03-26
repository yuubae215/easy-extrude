/**
 * Profile — domain entity representing a transient 2D rectangular cross-section.
 *
 * Renamed from `Sketch` (ADR-020): `Profile` names the artifact (a 2D contour)
 * rather than the act of drawing it. The editor interaction mode retains the
 * name "sketch mode" in UI strings — only the domain entity is renamed.
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Graph model (ADR-021):
 *   `setRect(p1, p2)` populates `vertices: Vertex[4]` and `edges: Edge[4]`.
 *   `sketchRect` is retained as a @deprecated backward-compatible getter.
 *   `extrude()` no longer mutates this entity. It returns a new Solid,
 *   and SceneService.extrudeProfile() replaces the Profile in the scene.
 *
 * Lifecycle: transient — replaced by Solid on extrude; not persistent.
 *
 * @see ADR-020, ADR-021, ADR-009
 */
import * as THREE                    from 'three'
import { buildCuboidFromRect }       from '../model/CuboidModel.js'
import { Solid }                     from './Solid.js'
import { Vertex }                    from '../graph/Vertex.js'
import { Edge }                      from '../graph/Edge.js'

export class Profile {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('../view/MeshView.js').MeshView} meshView
   */
  constructor(id, name, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''

    /** @type {import('../graph/Vertex.js').Vertex[]}  4 corners; empty until setRect() */
    this.vertices = []
    /** @type {import('../graph/Edge.js').Edge[]}  4 edges; empty until setRect() */
    this.edges    = []
    /** @type {[]}  always empty — Profile is 2D (no faces) */
    this.faces    = []

    /** @type {import('../view/MeshView.js').MeshView} */
    this.meshView = meshView
  }

  /**
   * Stores the rectangle as a graph (4 Vertex + 4 Edge).
   * Replaces direct `obj.sketchRect = {p1, p2}` assignment.
   * @param {import('three').Vector3} p1  one corner (ground plane)
   * @param {import('three').Vector3} p2  opposite corner (ground plane)
   */
  setRect(p1, p2) {
    const v0 = new Vertex(`${this.id}_v0`, p1.clone())
    const v1 = new Vertex(`${this.id}_v1`, new THREE.Vector3(p2.x, p1.y, 0))
    const v2 = new Vertex(`${this.id}_v2`, p2.clone())
    const v3 = new Vertex(`${this.id}_v3`, new THREE.Vector3(p1.x, p2.y, 0))
    this.vertices = [v0, v1, v2, v3]
    this.edges = [
      new Edge(`${this.id}_e0`, v0, v1),
      new Edge(`${this.id}_e1`, v1, v2),
      new Edge(`${this.id}_e2`, v2, v3),
      new Edge(`${this.id}_e3`, v3, v0),
    ]
  }

  /**
   * Backward-compatible getter for the rectangle corners.
   * @deprecated Use `vertices[0].position` / `vertices[2].position` directly.
   * @returns {{ p1: import('three').Vector3, p2: import('three').Vector3 } | null}
   */
  get sketchRect() {
    if (this.vertices.length < 4) return null
    return { p1: this.vertices[0].position, p2: this.vertices[2].position }
  }

  /**
   * Returns vertex positions as Vector3[]; empty array before setRect().
   * Satisfies the LocalGeometry `corners` interface.
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
   * Creates a new Solid from the current rect extruded by `height`.
   * The Profile itself is NOT mutated; SceneService replaces it in the scene.
   * Requires `setRect()` to have been called before calling.
   * @param {number} height  signed extrusion height in world Z units
   * @returns {import('./Solid.js').Solid}
   */
  extrude(height) {
    const { p1, p2 } = this.sketchRect
    const positions  = buildCuboidFromRect(p1, p2, height)
    const vertices   = positions.map((pos, i) => new Vertex(`${this.id}_v${i}`, pos))
    return new Solid(this.id, this.name, vertices, this.meshView)
  }
}
