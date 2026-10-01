/**
 * targetLift (domain) — how a grasped object is LIFTED OUT: the declared `lift`
 * of a layout Solid (ADR-157 D5).
 *
 * ## A declaration, never a default
 *
 * `lift: { along, distance }` lives on the document's Solid entity, next to its
 * `graspFeature` / `mass`, and is joined onto the live body by `ref` (ADR-132).
 * Absent stays absent all the way to the wire: `core/` then reports the lift
 * phase as `unevaluated / liftUndeclared` and the panel says so. Filling in
 * "50 mm straight up" here would make "nobody declared a lift" and "a lift that
 * was judged and was fine" the same answer — the exact gap ADR-157 closes.
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
 * @typedef {object} ResolvedLift
 * @property {string} state             a `LIFT_STATE` member
 * @property {string|null} along        a `LIFT_ALONG` member, when declared
 * @property {number|null} distanceMm   when declared
 * @property {string[]} errors          why it is malformed
 */

/**
 * **The single resolution point** for a Solid's `lift` (§1.1). Never throws on
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
