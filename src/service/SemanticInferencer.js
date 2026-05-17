/**
 * SemanticInferencer — geometric-heuristic SpatialLink suggestion engine.
 *
 * Analyzes spatial proximity between a moved Solid and other scene entities
 * after a grab/drag operation, returning ranked SpatialLink suggestions.
 *
 * Pure computation: no DOM, no Three.js scene mutations, no I/O.
 * All inputs are read-only; no argument is mutated.
 *
 * Heuristics (in priority order):
 *   A. "above"    — moved bottom face ≈ target top face with XY footprint overlap
 *   B. "adjacent" — moved side face ≈ target side face with perpendicular overlap
 *   C. "contains" — moved Solid's XY centroid is inside an AnnotatedRegion polygon
 *
 * @see ADR-041
 */
import { Box3, Vector3 } from 'three'
import { Solid }           from '../domain/Solid.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'

/** Face-gap (units) below which two faces are considered "touching". */
const CONTACT_THRESHOLD = 0.15

/**
 * @typedef {{
 *   sourceId:     string,
 *   targetId:     string,
 *   jointType:    string|null,
 *   semanticType: string,
 *   label:        string,
 *   confidence:   number,
 * }} Suggestion
 */

/**
 * Compute the world-space AABB of a Solid from its 8 world-space corners.
 * @param {Solid} solid
 * @returns {Box3}
 */
function _solidBox(solid) {
  const box = new Box3()
  for (const c of solid.corners) box.expandByPoint(c)
  return box
}

function _xOverlap(a, b) { return a.max.x > b.min.x && a.min.x < b.max.x }
function _yOverlap(a, b) { return a.max.y > b.min.y && a.min.y < b.max.y }
function _zOverlap(a, b) { return a.max.z > b.min.z && a.min.z < b.max.z }
function _xyOverlap(a, b) { return _xOverlap(a, b) && _yOverlap(a, b) }

/**
 * Ray-casting point-in-polygon test on the XY plane.
 * @param {number} px
 * @param {number} py
 * @param {import('three').Vector3[]} poly  ordered ring of polygon vertices
 * @returns {boolean}
 */
function _xyPointInPolygon(px, py, poly) {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Infers SpatialLink suggestions for the moved entity against all scene objects.
 *
 * Returns at most 3 suggestions sorted by confidence (highest first).
 * Pairs that already have a link are silently skipped.
 *
 * @param {Solid} moved          Entity that was just repositioned
 * @param {Iterable<any>} sceneObjects  All scene entities (read-only)
 * @param {Set<string>} existingPairs  "sourceId|targetId" strings for existing links
 * @returns {Suggestion[]}
 */
export function inferSemanticRelationships(moved, sceneObjects, existingPairs) {
  if (!(moved instanceof Solid)) return []

  const mBox = _solidBox(moved)
  const suggestions = []

  for (const entity of sceneObjects) {
    if (entity.id === moved.id) continue

    // Skip pairs that already have a SpatialLink in either direction.
    if (existingPairs.has(`${moved.id}|${entity.id}`)) continue
    if (existingPairs.has(`${entity.id}|${moved.id}`)) continue

    if (entity instanceof Solid) {
      const tBox = _solidBox(entity)

      // ── Heuristic A: "above" ────────────────────────────────────────────
      // moved's bottom face (-Z) is near target's top face (+Z), with XY overlap.
      const zGapAbove = Math.abs(mBox.min.z - tBox.max.z)
      if (zGapAbove < CONTACT_THRESHOLD && _xyOverlap(mBox, tBox)) {
        suggestions.push({
          sourceId:     moved.id,
          targetId:     entity.id,
          jointType:    null,
          semanticType: 'above',
          label:        'Above',
          confidence:   1 - zGapAbove / CONTACT_THRESHOLD,
        })
        continue  // skip "adjacent" check for the same pair
      }

      // ── Heuristic B: "adjacent" (side faces) ───────────────────────────
      // Checks four axis-aligned side-face pairs with perpendicular overlap.
      const x_L = Math.abs(mBox.min.x - tBox.max.x)
      const x_R = Math.abs(mBox.max.x - tBox.min.x)
      const y_L = Math.abs(mBox.min.y - tBox.max.y)
      const y_R = Math.abs(mBox.max.y - tBox.min.y)

      let minDist = Infinity
      if (x_L < CONTACT_THRESHOLD && _yOverlap(mBox, tBox) && _zOverlap(mBox, tBox)) minDist = Math.min(minDist, x_L)
      if (x_R < CONTACT_THRESHOLD && _yOverlap(mBox, tBox) && _zOverlap(mBox, tBox)) minDist = Math.min(minDist, x_R)
      if (y_L < CONTACT_THRESHOLD && _xOverlap(mBox, tBox) && _zOverlap(mBox, tBox)) minDist = Math.min(minDist, y_L)
      if (y_R < CONTACT_THRESHOLD && _xOverlap(mBox, tBox) && _zOverlap(mBox, tBox)) minDist = Math.min(minDist, y_R)

      if (minDist < Infinity) {
        suggestions.push({
          sourceId:     moved.id,
          targetId:     entity.id,
          jointType:    null,
          semanticType: 'adjacent',
          label:        'Adjacent',
          confidence:   0.7 * (1 - minDist / CONTACT_THRESHOLD),
        })
      }
    }

    // ── Heuristic C: "contains" (AnnotatedRegion) ─────────────────────────
    // moved Solid's XY centroid is inside the region's polygon.
    // Link direction: region (source) contains solid (target).
    if (entity instanceof AnnotatedRegion) {
      const center = mBox.getCenter(new Vector3())
      if (_xyPointInPolygon(center.x, center.y, entity.corners)) {
        suggestions.push({
          sourceId:     entity.id,
          targetId:     moved.id,
          jointType:    null,
          semanticType: 'contains',
          label:        'Contains',
          confidence:   0.85,
        })
      }
    }
  }

  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
}
