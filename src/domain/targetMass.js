/**
 * targetMass (domain) — what a grasp target WEIGHS and WHERE that weight sits:
 * the declared `mass` and `centerOfMass` of a layout Solid (ADR-121 / ADR-156).
 *
 * ## Declared facts, never defaults (ADR-121 D2)
 *
 * Both are DECLARATIONS that live on the document's Solid entity, next to its
 * `graspFeature`, and are joined onto the live body by `ref` (ADR-132). An absent
 * one stays absent all the way to the wire: `core/` then does not evaluate the
 * objectives that need it (their key is absent — ADR-120) and the panel says
 * "not measured". Filling the centre of mass with the centroid on read would turn
 * an assumption into a value the screen could no longer tell from a measurement —
 * the ghost-robot shape of ADR-090.
 *
 * ## Provenance rides with the value (ADR-121 D1)
 *
 *   measured            — `point` is the object's LOCAL frame, mm (origin = the
 *                         Solid's centre, axes = its own), so the centre of mass
 *                         moves and turns with the object.
 *   assumedHomogeneous  — an EXPLICITLY chosen assumption with no point: the
 *                         centroid is derived here (the box centre — ADR-121
 *                         "only trivial for boxes"), never stored.
 *
 * Estimating a centre of mass or a mass from material / size / similarity is a
 * proposal (ADR-121 D3 — `core/recommendation/`), and nothing here does it.
 *
 * Pure (no THREE / no DOM).
 *
 * @module domain/targetMass
 */

import { rotateVec3 } from './rotateVec3.js'
import { mmPointToM } from './worldUnits.js'

/** The provenance kinds — the contract's closed union (`target.centerOfMass.kind`). */
export const CENTER_OF_MASS_KIND = Object.freeze({
  MEASURED:            'measured',
  ASSUMED_HOMOGENEOUS: 'assumedHomogeneous',
})

/** Every declared provenance — the enumeration a census counts against. */
export const DECLARED_CENTER_OF_MASS_KINDS = Object.freeze(Object.values(CENTER_OF_MASS_KIND))

/** Resolved state of one declaration (mass or centre of mass) — 原則 #31. */
export const MASS_DECLARATION_STATE = Object.freeze({
  UNDECLARED: 'undeclared',
  DECLARED:   'declared',
  MALFORMED:  'malformed',
})

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * @typedef {object} ResolvedMass
 * @property {string} state         a `MASS_DECLARATION_STATE` member
 * @property {number|null} kg        the mass, when declared
 * @property {string[]} errors
 */

/**
 * @typedef {object} ResolvedCenterOfMass
 * @property {string} state                     a `MASS_DECLARATION_STATE` member
 * @property {string|null} kind                 a `CENTER_OF_MASS_KIND` member, when declared
 * @property {{x:number,y:number,z:number}|null} local  local-frame point, mm (derived for assumedHomogeneous)
 * @property {string[]} errors
 */

/**
 * **The single resolution point** for a Solid's `mass` (§1.1). Never throws on
 * stored content — a broken value comes back MALFORMED with reasons (原則 #11).
 * @param {any} raw  the entity's `mass` (kg)
 * @returns {ResolvedMass}
 */
export function resolveMass(raw) {
  if (raw === undefined || raw === null) return { state: MASS_DECLARATION_STATE.UNDECLARED, kg: null, errors: [] }
  if (!isFiniteNum(raw) || raw <= 0) {
    return { state: MASS_DECLARATION_STATE.MALFORMED, kg: null, errors: ['mass must be a number > 0 (kg)'] }
  }
  return { state: MASS_DECLARATION_STATE.DECLARED, kg: raw, errors: [] }
}

/**
 * **The single resolution point** for a Solid's `centerOfMass` (§1.1).
 * @param {any} raw  the entity's `centerOfMass`
 * @returns {ResolvedCenterOfMass}
 */
export function resolveCenterOfMass(raw) {
  const malformed = (e) => ({ state: MASS_DECLARATION_STATE.MALFORMED, kind: null, local: null, errors: [e] })
  if (raw === undefined || raw === null) {
    return { state: MASS_DECLARATION_STATE.UNDECLARED, kind: null, local: null, errors: [] }
  }
  if (typeof raw !== 'object') return malformed('centerOfMass must be an object')
  if (raw.kind === CENTER_OF_MASS_KIND.ASSUMED_HOMOGENEOUS) {
    // The centroid of a box is its centre — derived, never stored (a stored copy
    // would drift from the dimensions it was computed from — §1.1).
    return { state: MASS_DECLARATION_STATE.DECLARED, kind: raw.kind, local: { x: 0, y: 0, z: 0 }, errors: [] }
  }
  if (raw.kind === CENTER_OF_MASS_KIND.MEASURED) {
    const p = raw.point
    const ok = Array.isArray(p) && p.length === 3 && p.every(isFiniteNum)
    if (!ok) return malformed('centerOfMass.point must be [x, y, z] in the object frame (mm)')
    return { state: MASS_DECLARATION_STATE.DECLARED, kind: raw.kind, local: { x: p[0], y: p[1], z: p[2] }, errors: [] }
  }
  return malformed(`centerOfMass.kind must be one of ${DECLARED_CENTER_OF_MASS_KINDS.join(' / ')}`)
}

/**
 * Both declarations of an entity, resolved.
 * @param {{mass?: any, centerOfMass?: any}} entity
 * @returns {{mass: ResolvedMass, centerOfMass: ResolvedCenterOfMass}}
 */
export function resolveMassProperties(entity) {
  return { mass: resolveMass(entity?.mass), centerOfMass: resolveCenterOfMass(entity?.centerOfMass) }
}

/**
 * The centre of mass in WORLD coordinates (mm) for a target — derived from the
 * local declaration and the body's current pose on every call, never stored.
 * Null when not declared (never the centroid by default).
 *
 * @param {{position:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number},
 *          massProperties?: {centerOfMass: ResolvedCenterOfMass}}} target
 * @returns {{x:number,y:number,z:number}|null}
 */
export function centerOfMassWorld(target) {
  const com = target?.massProperties?.centerOfMass
  if (com?.state !== MASS_DECLARATION_STATE.DECLARED) return null
  const w = rotateVec3(com.local, target.rotation)
  return { x: target.position.x + w.x, y: target.position.y + w.y, z: target.position.z + w.z }
}

/**
 * Why the declarations cannot be sent — only MALFORMED ones. An UNDECLARED one
 * is a state, not a gap: it is simply not sent and the objective reads "not
 * measured". A malformed one blocks the run with its reason instead of being
 * silently dropped (原則 #11 — dropping it would look exactly like undeclared).
 *
 * @param {{massProperties?: {mass: ResolvedMass, centerOfMass: ResolvedCenterOfMass}}} target
 * @returns {string[]}
 */
export function massDeclarationGaps(target) {
  const mp = target?.massProperties
  if (!mp) return []
  return [...mp.mass.errors, ...mp.centerOfMass.errors]
}

/**
 * The wire fields for a target (contract request, ADR-121 D1 / ADR-156 D1):
 * `mass` in kg, `centerOfMass` as `{kind, point}` in world metres (ADR-136).
 * Only DECLARED ones ride; absence stays absence.
 *
 * @param {object} target  a resolved grasp target
 * @returns {{mass?: number, centerOfMass?: {kind: string, point: [number, number, number]}}}
 */
export function wireMassFor(target) {
  const mp = target?.massProperties
  const out = {}
  if (mp?.mass.state === MASS_DECLARATION_STATE.DECLARED) out.mass = mp.mass.kg
  const world = centerOfMassWorld(target)
  if (world) out.centerOfMass = { kind: mp.centerOfMass.kind, point: mmPointToM([world.x, world.y, world.z]) }
  return out
}

/**
 * What this client did NOT send that `suction_hold` needs — the reason its key
 * will be absent, derived from the request side (ADR-156 D4: the wire carries no
 * reason, the client knows what it omitted). The kinds are enumerated in the
 * same order as ADR-156 D4's table; an empty list means all inputs ride.
 *
 * @param {{hand: object|null, massProperties: object|null}} args
 * @returns {string[]}  words for the panel ('a suction hand', 'mass', …)
 */
export function suctionHoldMissing({ hand, massProperties }) {
  const missing = []
  if (hand?.kind !== 'suction') missing.push('a suction hand')
  else if (!hand.hold) missing.push('the hand’s hold (force, friction)')
  if (massProperties?.mass?.state !== MASS_DECLARATION_STATE.DECLARED) missing.push('mass')
  if (massProperties?.centerOfMass?.state !== MASS_DECLARATION_STATE.DECLARED) missing.push('centre of mass')
  return missing
}
