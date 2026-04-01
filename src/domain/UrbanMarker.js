/**
 * UrbanMarker — domain entity for a 2D urban point element.
 *
 * Represents Kevin Lynch's point-like elements at city/map scale:
 *   - Node     (ノード)         : strategic focal points — junctions, squares, concentrations
 *   - Landmark (ランドマーク)   : memorable external reference points — towers, monuments
 *
 * Graph model (ADR-021):
 *   Implements the LocalGeometry interface.
 *   vertices: Vertex[1]   — single anchor point
 *   edges:    []          — none (0D topology)
 *   faces:    []          — none
 *
 * The `lynchClass` field carries the semantic Lynch classification
 * ('Node' | 'Landmark').
 *
 * Type identity:
 *   `instanceof UrbanMarker` → point urban element; move OK, no Edit Mode.
 *
 * @see ADR-026, ADR-021, ADR-020
 */
import { Vertex } from '../graph/Vertex.js'

export class UrbanMarker {
  /**
   * @param {string}   id
   * @param {string}   name
   * @param {Vertex[]} vertices  [v0] — single anchor vertex
   * @param {object}   meshView  rendering context (UrbanMarkerView, future)
   */
  constructor(id, name, vertices, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /**
     * Lynch semantic class.
     * @type {'Node'|'Landmark'|null}
     * @see ADR-026, LynchClassRegistry
     */
    this.lynchClass  = null
    /** @type {Vertex[]}  single-element array — the anchor point */
    this.vertices    = vertices
    /** @type {[]}  always empty — UrbanMarker is a 0D point entity */
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
   * Builds an UrbanMarker from a single Vector3 anchor point.
   * @param {string}                   id
   * @param {string}                   name
   * @param {import('three').Vector3}  point   anchor position
   * @param {object}                   meshView
   * @returns {UrbanMarker}
   */
  static fromPoint(id, name, point, meshView) {
    const v = new Vertex(`${id}_v0`)
    v.position.copy(point)
    return new UrbanMarker(id, name, [v], meshView)
  }
}
