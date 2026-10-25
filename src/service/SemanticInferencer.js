/**
 * SemanticInferencer — what to offer after a Solid is moved (ADR-041, ADR-168 S2-1).
 *
 * Pure computation: no DOM, no Three.js scene mutations, no I/O.
 * All inputs are read-only; no argument is mutated.
 *
 * Two kinds of suggestion, neither scored nor ranked (ADR-146 axis 1 — a
 * graded preference is an idea and lives in core/):
 *
 *   arrangement  the moved Solid TOUCHES another: offered as a claim in the
 *                speaker's name — `{contact: touching, toward: <the face>}` —
 *                read by the domain's own closed form (`observeContact`), so
 *                what is offered is what the relation's status will read. The
 *                face is said only when exactly one is touched (an edge touches
 *                two; saying either would choose). Offered only while someone
 *                is speaking and both things are in the document; a claim
 *                needs a claimant (ADR-168 D5) and a subject the document has.
 *   link         the moved Solid's centre lies in an AnnotatedRegion: a
 *                `contains` SpatialLink, as before (heuristic C).
 *
 * Until S2-1 the first kind was SpatialLinks `above` / `adjacent` with a
 * confidence — two words that each carried two facts (ADR-168 力学 1); those
 * heuristics (A / B) and their metre-era 0.15 threshold are gone.
 *
 * Order is deterministic (arrangements by partner ref, then links by region
 * id); a caller showing one shows the first.
 *
 * @see ADR-041
 * @see docs/adr/ADR-168-a-spatial-relation-is-three-axes-and-three-slots.md
 */
import { Box3, Vector3 } from 'three'
import { Solid }           from '../domain/Solid.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { observeContact, CONTACT_TOLERANCE_MM, OBSERVED_CONTACT } from '../domain/arrangementGeometry.js'
import { sizeOfCorners } from '../domain/hollowBody.js'
import { cellOfSide } from '../domain/relationCells.js'
import { PHRASE_TABLE, phraseKind } from '../context/SynonymQuotient.js'

/**
 * Each carries `key`: the same offer on consecutive drag frames has the same
 * key, so a preview is kept rather than rebuilt (the drag states compare keys
 * and stay dependency-free).
 *
 * @typedef {{kind: 'arrangement', key: string, subjectId: string, partnerId: string,
 *            subjectRef: string, partnerRef: string, by: string,
 *            side: {of: string, contact: 'touching', toward?: string}, cell: string, label: string}} ArrangementSuggestion
 * @typedef {{kind: 'link', key: string, sourceId: string, targetId: string, jointType: null,
 *            semanticType: 'contains', label: string}} LinkSuggestion
 * @typedef {ArrangementSuggestion | LinkSuggestion} Suggestion
 */

/**
 * The geometry body of a live Solid, in the shape `domain/arrangementGeometry`
 * reads (the same fields `layout/ArrangementReport` takes from a compiled one).
 * @param {Solid} solid
 */
export function bodyOfSolid(solid) {
  const p = solid._position
  const q = solid.orientation
  return {
    center:   { x: p.x, y: p.y, z: p.z },
    size:     sizeOfCorners(solid.localCorners),
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
    inner:    solid.innerDimensions ?? null,
  }
}

/** The words a suggested side is shown in: a combination's name if the cell has one. */
function sideLabel(side) {
  const cell = cellOfSide(side)
  const combo = PHRASE_TABLE.find(p => phraseKind(p) === 'combination' && p.cells[0] === cell)
  if (combo) return combo.en[0].toUpperCase() + combo.en.slice(1)
  return side.toward ? `Touching ${side.toward}` : 'Touching'
}

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
 * What to offer for the moved entity against the other scene objects.
 *
 * @param {Solid} moved                 entity that was just repositioned
 * @param {Iterable<any>} sceneObjects  all scene entities (read-only)
 * @param {{
 *   existingPairs: Set<string>,          "sourceId|targetId" of existing SpatialLinks
 *   refOf: (sceneId: string) => string|null,  the document ref of a scene object (null = not in the document)
 *   speaker: string|null,                who is speaking (an actor ref) — null offers no arrangement
 *   claimedPairs: Set<string>,           "subjectRef|ofRef" the speaker already claims (either order is checked)
 * }} ctx
 * @returns {Suggestion[]}
 */
export function inferSuggestions(moved, sceneObjects, { existingPairs, refOf, speaker, claimedPairs }) {
  if (!(moved instanceof Solid)) return []
  const movedRef = speaker ? refOf(moved.id) : null
  const mBody = movedRef ? bodyOfSolid(moved) : null
  const mBox = _solidBox(moved)
  /** @type {ArrangementSuggestion[]} */
  const arrangements = []
  /** @type {LinkSuggestion[]} */
  const links = []

  for (const entity of sceneObjects) {
    if (entity.id === moved.id) continue

    if (entity instanceof Solid && mBody) {
      const ref = refOf(entity.id)
      if (ref && !claimedPairs.has(`${movedRef}|${ref}`) && !claimedPairs.has(`${ref}|${movedRef}`)) {
        const c = observeContact(mBody, bodyOfSolid(entity))
        if (c.contact === OBSERVED_CONTACT.TOUCHING) {
          // A complete, declarable side — what is offered is what gets written.
          /** @type {{of: string, contact: 'touching', toward?: string}} */
          const side = c.faces.length === 1 ? { of: ref, contact: 'touching', toward: c.faces[0] } : { of: ref, contact: 'touching' }
          const cell = cellOfSide(side)
          arrangements.push({
            kind: 'arrangement', key: `arrangement|${entity.id}|${cell}`, subjectId: moved.id, partnerId: entity.id,
            subjectRef: movedRef, partnerRef: ref, by: speaker, side, cell, label: sideLabel(side),
          })
        }
      }
    }

    // ── "contains" (AnnotatedRegion) — region (source) contains solid (target) ──
    if (entity instanceof AnnotatedRegion
        && !existingPairs.has(`${entity.id}|${moved.id}`) && !existingPairs.has(`${moved.id}|${entity.id}`)) {
      const center = mBox.getCenter(new Vector3())
      if (_xyPointInPolygon(center.x, center.y, entity.corners)) {
        links.push({
          kind: 'link', key: `link|contains|${entity.id}`, sourceId: entity.id, targetId: moved.id,
          jointType: null, semanticType: 'contains', label: 'Contains',
        })
      }
    }
  }

  const byKey = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)
  return [...arrangements.sort(byKey('partnerRef')), ...links.sort(byKey('sourceId'))]
}

/** Outer radius (mm) for approach warmth visualization — 3× the one contact tolerance. */
const APPROACH_RADIUS = CONTACT_TOLERANCE_MM * 3

/**
 * Computes continuous warmth values (0..1) for Solid entities near the moved Solid.
 * Used to show a pre-threshold "getting warmer" effect on wireframes.
 * Pure computation; no side effects.
 *
 * @param {Solid} moved
 * @param {Iterable<any>} sceneObjects
 * @returns {Array<{ targetId: string, warmth: number }>}
 */
export function computeApproachWarmth(moved, sceneObjects) {
  if (!(moved instanceof Solid)) return []
  const mBox = _solidBox(moved)
  const result = []
  for (const entity of sceneObjects) {
    if (entity.id === moved.id || !(entity instanceof Solid)) continue
    const tBox = _solidBox(entity)
    // Minimum positive gap across all six axis-aligned face pairs.
    const gaps = [
      mBox.min.z - tBox.max.z, tBox.min.z - mBox.max.z,
      mBox.min.x - tBox.max.x, tBox.min.x - mBox.max.x,
      mBox.min.y - tBox.max.y, tBox.min.y - mBox.max.y,
    ].filter(g => g > 0)
    const minGap = gaps.length ? Math.min(...gaps) : 0
    if (minGap < APPROACH_RADIUS) {
      result.push({ targetId: entity.id, warmth: Math.max(0, 1 - minGap / APPROACH_RADIUS) })
    }
  }
  return result
}

