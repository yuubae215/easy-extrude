/**
 * AnnotatedPoint — domain entity for a 2D annotated point element.
 *
 * Represents a point spatial feature whose position carries semantic meaning.
 * Valid placeType values:
 *   - 'Hub'    : junction / focal concentration / datum hole / fixture point
 *   - 'Anchor' : external reference / memorable feature / root datum of a tolerance chain
 *
 * Scale-independent: usable at city scale (intersection, monument),
 * building scale (doorway, column), or part scale (datum hole, reference feature).
 *
 * Graph model (ADR-021):
 *   Implements the LocalGeometry interface.
 *   vertices: Vertex[1]   — single anchor point
 *   edges:    []          — none (0D topology)
 *   faces:    []          — none
 *
 * The `placeType` field carries the semantic place classification ('Hub' | 'Anchor').
 *
 * Type identity:
 *   `instanceof AnnotatedPoint` → point annotated element; move OK, no Edit Mode.
 *
 * @see ADR-029, ADR-021, ADR-020
 */
import { Vertex } from '../graph/Vertex.js'

export class AnnotatedPoint {
  /**
   * @param {string}   id
   * @param {string}   name
   * @param {Vertex[]} vertices  [v0] — single anchor vertex
   * @param {object}   meshView  rendering context (AnnotatedPointView)
   */
  constructor(id, name, vertices, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /**
     * Semantic place type.
     * @type {'Hub'|'Anchor'|null}
     * @see ADR-029, PlaceTypeRegistry
     */
    this.placeType   = null
    /** @type {Vertex[]}  single-element array — the anchor point */
    this.vertices    = vertices
    /** @type {[]}  always empty — AnnotatedPoint is a 0D point entity */
    this.edges       = []
    /** @type {[]}  always empty */
    this.faces       = []
    this.meshView    = meshView
  }

  // ── Convenience accessor ───────────────────────────────────────────────────

  /** The anchor position. */
  get position() { return this.vertices[0].position }

  // ── LocalGeometry interface ────────────────────────────────────────────────

  /**
   * Returns [position] as the single-element corners array.
   * @returns {import('three').Vector3[]}
   */
  get corners() { return [this.vertices[0].position] }

  /** Renames the entity. */
  rename(name) { this.name = name }

  /**
   * Translates the anchor point by delta.
   * @param {import('three').Vector3[]} startCorners  [p0_snap] taken at drag start
   * @param {import('three').Vector3}   delta
   */
  move(startCorners, delta) {
    this.vertices[0].position.copy(startCorners[0]).add(delta)
  }

  // ── Factory helper ─────────────────────────────────────────────────────────

  /**
   * Builds an AnnotatedPoint from a single Vector3 anchor position.
   * @param {string}                   id
   * @param {string}                   name
   * @param {import('three').Vector3}  point   anchor position
   * @param {object}                   meshView
   * @returns {AnnotatedPoint}
   */
  static fromPoint(id, name, point, meshView) {
    return new AnnotatedPoint(id, name, [new Vertex(`${id}_v0`, point.clone())], meshView)
  }
}
