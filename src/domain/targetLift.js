/**
 * targetLift (domain) — how a grasped object is LIFTED OUT: the declared `lift`
 * of the grasp RELATION (ADR-157 D5, moved by ADR-164 D4).
 *
 * ## A declaration, never a default
 *
 * `lift: { along, distance }` is a fact of the grasp relation (object × hand) and
 * lives on the document's grasp declaration, `graspFeature.lift` — one per
 * relation, not per spec (a relation with no spec may still lift; the wire's
 * `target.lift` is one). Absent stays absent all the way to the wire: `core/`
 * then reports the lift phase as `unevaluated / liftUndeclared` and the panel
 * says so. Filling in "50 mm straight up" here would make "nobody declared a
 * lift" and "a lift that was judged and was fine" the same answer — the exact gap
 * ADR-157 closes.
 *
 * ## The old address is read, never written
 *
 * Before ADR-164 D4 the lift sat on the Solid itself (`entity.lift`). That is
 * still READ — `resolveDeclaredLift` migrates it on load and marks where it came
 * from (`source: 'legacy'`) so the panel can say so (the `faces` → specs
 * etiquette of ADR-152). The one writer (`DocBuilder.setEntityGraspLift`) moves
 * it on the first edit. Both addresses declared with DIFFERENT values is
 * MALFORMED: picking one would be a silent choice (原則 #11).
 *
 *   along: 'reverseApproach' — retrace the approach (each candidate its own axis)
 *          'worldUp'         — world +Z (ROS REP-103)
 *   distance: mm (> 0)
 *
 * Whether the lifted object or hand hits anything is solved in `core/` — nothing
 * here judges. Pure (no THREE / no DOM).
 *
 * @module domain/targetLift
 */

import { mmToM } from './worldUnits.js'

/** The declared directions — the contract's closed vocabulary (`target.lift.along`). */
export const LIFT_ALONG = Object.freeze({
  REVERSE_APPROACH: 'reverseApproach',
  WORLD_UP:         'worldUp',
})

/** Every declared direction — the enumeration a census counts against. */
export const DECLARED_LIFT_DIRECTIONS = Object.freeze(Object.values(LIFT_ALONG))

/** Resolved state of the declaration (原則 #31 — absence is a state). */
export const LIFT_STATE = Object.freeze({
  UNDECLARED: 'undeclared',
  DECLARED:   'declared',
  MALFORMED:  'malformed',
})

/**
 * Where a declared lift was read from (ADR-164 D4). Closed: a new address must
 * say itself here, not inherit the nearest one.
 */
export const LIFT_SOURCE = Object.freeze({
  RELATION: 'relation', // graspFeature.lift — the address since ADR-164 D4
  LEGACY:   'legacy',   // entity.lift — read and migrated, never written
})

/**
 * @typedef {object} ResolvedLift
 * @property {string} state             a `LIFT_STATE` member
 * @property {string|null} along        a `LIFT_ALONG` member, when declared
 * @property {number|null} distanceMm   when declared
 * @property {string[]} errors          why it is malformed
 * @property {string|null} [source]     a `LIFT_SOURCE` member, when read from an
 *                                      entity by `resolveDeclaredLift` (null = undeclared)
 */

/**
 * The VALUE parser for one `lift` object. Entities are read through
 * `resolveDeclaredLift`, which decides WHICH address the value comes from. Never throws on
 * stored content — a broken value comes back MALFORMED with its reason, so the
 * run stops and says why instead of dropping it (原則 #11: dropped looks exactly
 * like undeclared).
 *
 * @param {any} raw  the entity's `lift`
 * @returns {ResolvedLift}
 */
export function resolveLift(raw) {
  if (raw === undefined || raw === null) {
    return { state: LIFT_STATE.UNDECLARED, along: null, distanceMm: null, errors: [] }
  }
  const malformed = (e) => ({ state: LIFT_STATE.MALFORMED, along: null, distanceMm: null, errors: [e] })
  if (typeof raw !== 'object') return malformed('lift must be an object {along, distance}')
  if (!DECLARED_LIFT_DIRECTIONS.includes(raw.along)) {
    return malformed(`lift.along must be one of ${DECLARED_LIFT_DIRECTIONS.join(' / ')}`)
  }
  const d = raw.distance
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) {
    return malformed('lift.distance must be a number > 0 (mm)')
  }
  return { state: LIFT_STATE.DECLARED, along: raw.along, distanceMm: d, errors: [] }
}

/** Same declaration, compared by value (both addresses may legally say the same thing). */
function sameLift(a, b) {
  return a?.along === b?.along && a?.distance === b?.distance
}

/**
 * **The single resolution point** for "how is this object lifted out once
 * grasped" (§1.1, ADR-164 D4) — the relation's `graspFeature.lift`, or the
 * pre-D4 `entity.lift` migrated on read. Every consumer (targets, wire, panel)
 * asks this; none reads either key itself.
 *
 * @param {any} entity  a Layout DSL entity (or anything, including null)
 * @returns {ResolvedLift}
 */
export function resolveDeclaredLift(entity) {
  const feature = entity?.graspFeature
  const rel = (feature && typeof feature === 'object' && !Array.isArray(feature)) ? feature.lift : undefined
  const old = entity?.lift
  const hasRel = rel !== undefined && rel !== null
  const hasOld = old !== undefined && old !== null
  if (!hasRel && !hasOld) return { ...resolveLift(undefined), source: null }
  if (hasRel && hasOld && !sameLift(rel, old)) {
    return {
      state: LIFT_STATE.MALFORMED, along: null, distanceMm: null, source: null,
      errors: ['lift is declared twice with different values — on the grasp (graspFeature.lift) and at the old place on the object (lift); keep one'],
    }
  }
  return { ...resolveLift(hasRel ? rel : old), source: hasRel ? LIFT_SOURCE.RELATION : LIFT_SOURCE.LEGACY }
}

/**
 * Why a target's lift declaration cannot be sent (empty = sendable or undeclared).
 * @param {{lift?: ResolvedLift}} target  a resolved grasp target
 * @returns {string[]}
 */
export function liftDeclarationGaps(target) {
  return target?.lift?.errors ?? []
}

/**
 * The wire field (contract request `target.lift`, ADR-157 D5): the direction and
 * the distance in metres (ADR-136 — the one mm→m boundary). Only a DECLARED lift
 * rides; absence stays absence.
 *
 * @param {{lift?: ResolvedLift}} target
 * @returns {{lift?: {along: string, distance: number}}}
 */
export function wireLiftFor(target) {
  const l = target?.lift
  if (l?.state !== LIFT_STATE.DECLARED) return {}
  return { lift: { along: l.along, distance: mmToM(l.distanceMm) } }
}
