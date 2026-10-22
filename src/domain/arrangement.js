/**
 * arrangement (domain) — the vocabulary of a relation between things (ADR-168).
 *
 * The concept model this file implements has its own living document:
 * `docs/SPATIAL_RELATION_MODEL.md` (the words, the entities, who claims what).
 * The reasons are ADR-168. This file is the machine-read half of the same model.
 *
 * ## The shape (ADR-168 D3)
 *
 *   Arrangement {
 *     ref, by (actor ref — WHO claims it, D5), subject (Solid ref),
 *     sides: 1..2 × { of (Solid ref), contact?, toward? }
 *   }
 *
 * Each axis is optional, and an omitted axis is "not declared" — never filled
 * in with a default (原則 #31). Mobility is NOT a field: it is the `jointType`
 * of the SpatialLinks between subject and side, looked up (`mobilityBetween`),
 * so the same fact is never written in two places (ADR-168 D1, §1.1).
 *
 * ## Which frame of reference a direction uses (ADR-168 D1 / 力学 3)
 *
 *   touching → the partner's face (`+x … -z`, ADR-152 — intrinsic)
 *   apart    → `above` / `below` (gravity — absolute), or
 *              `{dir: front|back|left|right, viewer}` (a declared viewer — relative)
 *
 * ## The three slots (ADR-168 D4)
 *
 *   state  — derived from the layout (domain/arrangementGeometry.js), never stored
 *   claim  — this shape, in the document, one per (pair × claimant)
 *   status — per axis: match | mismatch | undeclared. No score, no total: a
 *            graded "how far off" is an idea and lives in core/ (ADR-146 axis 1).
 *
 * Claims by different people are kept side by side. When two of them say
 * different things on the same axis in the same frame of reference, that is a
 * CLAIM CONFLICT (`claimConflicts`) — a separate fact from the status against the
 * layout, and nothing here decides which claim is right.
 *
 * Pure, THREE-free, input-immutable.
 *
 * @module domain/arrangement
 */
import { DECLARABLE_FACES } from './graspFeature.js'
import { OBSERVED_CONTACT } from './arrangementGeometry.js'

/** Declarable contact values. (`overlapping` is observed, never declared.) */
export const CONTACT = Object.freeze({ TOUCHING: 'touching', APART: 'apart' })
export const CONTACTS = Object.freeze(Object.values(CONTACT))

/** Absolute (gravity) directions — said when apart. */
export const ABSOLUTE_TOWARD = Object.freeze(['above', 'below'])

/** Relative directions — said when apart, always with a viewer. */
export const RELATIVE_DIRS = Object.freeze(['front', 'back', 'left', 'right'])

/** Intrinsic directions — the partner's faces, said when touching (ADR-152). */
export const FACE_TOWARD = DECLARABLE_FACES

/** How many sides an arrangement has: 1 (two things) or 2 (between / clamped). */
export const MIN_SIDES = 1
export const MAX_SIDES = 2

/** Per-axis status values (ADR-168 D4). Three, and no score. */
export const AXIS_STATUS = Object.freeze({
  MATCH:      'match',
  MISMATCH:   'mismatch',
  UNDECLARED: 'undeclared',
})

/** What `mobilityBetween` can say. */
export const MOBILITY = Object.freeze({
  UNDECLARED:    'undeclared',     // no kinematic link between the two
  DECLARED:      'declared',       // exactly one — its jointType is the answer
  CONTRADICTION: 'contradiction',  // two or more — the document says two things
})

const OPPOSITE = Object.freeze({
  above: 'below', below: 'above', front: 'back', back: 'front', left: 'right', right: 'left',
  '+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y', '+z': '-z', '-z': '+z',
})

/**
 * Which frame of reference a declared `toward` uses. Throws on a value outside
 * the vocabulary (原則 #31 — a fall-through would make "never declared" and
 * "nobody thought of this word" the same answer).
 * @param {unknown} toward
 * @returns {'intrinsic'|'absolute'|'relative'}
 */
export function frameOfToward(toward) {
  if (typeof toward === 'string' && FACE_TOWARD.includes(toward)) return 'intrinsic'
  if (typeof toward === 'string' && ABSOLUTE_TOWARD.includes(toward)) return 'absolute'
  if (toward && typeof toward === 'object' && RELATIVE_DIRS.includes(/** @type {any} */ (toward).dir)) return 'relative'
  throw new Error(`arrangement: "${JSON.stringify(toward)}" is not a declarable direction (ADR-168 D1)`)
}

/** Is `toward` inside the vocabulary? */
function isToward(toward) {
  try { frameOfToward(toward); return true } catch { return false }
}

/** A comparable key for a declared direction: same key ⇔ same claim. */
function towardKey(toward) {
  return frameOfToward(toward) === 'relative' ? `${toward.dir}@${toward.viewer}` : toward
}

/** The direction word of a `toward` (a face, above/below, or the relative dir). */
function towardWord(toward) {
  return frameOfToward(toward) === 'relative' ? toward.dir : toward
}

/**
 * Are two directions opposite — the condition for a two-sided arrangement to
 * say "between" (ADR-168 D3)? Two relative directions must also share a viewer.
 */
export function areOpposite(a, b) {
  if (!isToward(a) || !isToward(b)) return false
  if (frameOfToward(a) !== frameOfToward(b)) return false
  if (frameOfToward(a) === 'relative' && a.viewer !== b.viewer) return false
  return OPPOSITE[towardWord(a)] === towardWord(b)
}

/**
 * The mobility of `a` relative to `b`, LOOKED UP from the kinematic links (those
 * with a jointType) whose endpoints resolve to the two. Order of the pair does
 * not matter.
 *
 * @param {Array<{a: string, b: string, jointType: unknown}>} kinematicLinks  endpoints already resolved to their host entity
 * @param {string} a
 * @param {string} b
 * @returns {{kind: 'undeclared'} | {kind: 'declared', jointType: unknown} | {kind: 'contradiction', count: number}}
 */
export function mobilityBetween(kinematicLinks, a, b) {
  const hits = (kinematicLinks ?? []).filter(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))
  if (hits.length === 0) return { kind: MOBILITY.UNDECLARED }
  if (hits.length === 1) return { kind: MOBILITY.DECLARED, jointType: hits[0].jointType }
  return { kind: MOBILITY.CONTRADICTION, count: hits.length }
}

/**
 * Every reason the declared arrangements cannot stand, as error strings. Named
 * preconditions (原則 #25), one place — the Context validator (R15) asks this.
 *
 * @param {object[]} arrangements
 * @param {{actorRefs: Set<string>, solidRefs: Set<string>,
 *          viewers: Map<string, object>, kinematicLinks: Array<{a:string,b:string,jointType:unknown}>,
 *          viewerGap?: (entity: object) => string|null}} world
 * @returns {string[]}
 */
export function arrangementIssues(arrangements, world) {
  const errors = []
  const seenRefs = new Set()
  const claimed = new Map()   // `${by}|${subject}|${of}` → arrangement ref
  for (const [i, arr] of (arrangements ?? []).entries()) {
    const where = `arrangement "${arr?.ref ?? `#${i}`}"`
    if (typeof arr?.ref !== 'string' || arr.ref === '') { errors.push(`arrangements[${i}]: ref is required`); continue }
    if (seenRefs.has(arr.ref)) errors.push(`${where}: ref is used twice`)
    seenRefs.add(arr.ref)

    // D5 — who claims it. Never inferred, not even with one actor in the room.
    if (typeof arr.by !== 'string') errors.push(`${where}: by (who claims it) is required — a claim with no claimant cannot be told apart from a fact (ADR-168 D5)`)
    else if (!world.actorRefs.has(arr.by)) errors.push(`${where}: by "${arr.by}" does not reference any actor`)

    if (!world.solidRefs.has(arr.subject)) errors.push(`${where}: subject "${arr.subject}" does not reference a Solid of specification.layout`)

    const sides = Array.isArray(arr.sides) ? arr.sides : []
    if (sides.length < MIN_SIDES || sides.length > MAX_SIDES) {
      errors.push(`${where}: has ${sides.length} sides — an arrangement has 1 (two things) or 2 (between); 0 is not a relation and 3 or more is not decided yet (ADR-168 D3)`)
    }
    const ofs = new Set()
    for (const [j, side] of sides.entries()) {
      const at = `${where} side ${j}`
      if (!world.solidRefs.has(side?.of)) errors.push(`${at}: of "${side?.of}" does not reference a Solid of specification.layout`)
      if (side?.of === arr.subject) errors.push(`${at}: of is the subject itself`)
      if (ofs.has(side?.of)) errors.push(`${at}: "${side?.of}" appears on both sides`)
      ofs.add(side?.of)

      if (side?.contact !== undefined && !CONTACTS.includes(side.contact)) {
        errors.push(`${at}: contact "${side.contact}" is not one of ${CONTACTS.join(', ')}`)
      }
      if (side?.toward !== undefined) {
        if (!isToward(side.toward)) {
          errors.push(`${at}: toward ${JSON.stringify(side.toward)} is not a face (${FACE_TOWARD.join(' ')}), above/below, or {dir: ${RELATIVE_DIRS.join('|')}, viewer}`)
        } else {
          const frame = frameOfToward(side.toward)
          if (frame === 'intrinsic' && side.contact === CONTACT.APART) {
            errors.push(`${at}: a face (${side.toward}) is said only of a thing touching it — apart, say above/below or a direction seen by a viewer (ADR-168 D1)`)
          }
          if (frame !== 'intrinsic' && side.contact === CONTACT.TOUCHING) {
            errors.push(`${at}: touching, the direction is the partner's face (${FACE_TOWARD.join(' ')}), not ${JSON.stringify(towardWord(side.toward))} (ADR-168 D1)`)
          }
          if (frame === 'relative') {
            const viewer = world.viewers.get(side.toward.viewer)
            if (typeof side.toward.viewer !== 'string') {
              errors.push(`${at}: "${side.toward.dir}" needs the viewer it is seen from — front/back/left/right are someone's (ADR-168 D2)`)
            } else if (!viewer) {
              errors.push(`${at}: viewer "${side.toward.viewer}" is not a CoordinateFrame with frameRole "viewer"`)
            } else {
              const gap = world.viewerGap?.(viewer)
              if (gap) errors.push(`${at}: ${gap}`)
            }
          }
        }
      }

      // Mobility is looked up, not declared — but a document that says two
      // things about it is still an error worth naming here.
      if (world.solidRefs.has(arr.subject) && world.solidRefs.has(side?.of)) {
        const m = mobilityBetween(world.kinematicLinks, arr.subject, side.of)
        if (m.kind === MOBILITY.CONTRADICTION) {
          errors.push(`${at}: ${m.count} kinematic links join "${arr.subject}" and "${side.of}" — mobility between two things is one fact (ADR-168 D1)`)
        }
      }

      // One claim per (pair × claimant) — a second one would overwrite the
      // first in the reader's head without saying so.
      if (typeof arr.by === 'string') {
        const key = `${arr.by}|${arr.subject}|${side?.of}`
        if (claimed.has(key)) errors.push(`${at}: "${arr.by}" already claims the relation of "${arr.subject}" to "${side?.of}" in arrangement "${claimed.get(key)}" — one claim per person per pair (ADR-168 D5)`)
        else claimed.set(key, arr.ref)
      }
    }

    if (sides.length === 2) {
      const [a, b] = sides
      if (a?.toward === undefined || b?.toward === undefined) {
        errors.push(`${where}: a two-sided arrangement says where each side is — "between" needs both directions (ADR-168 D3)`)
      } else if (isToward(a.toward) && isToward(b.toward) && !areOpposite(a.toward, b.toward)) {
        errors.push(`${where}: the two sides (${JSON.stringify(towardWord(a.toward))}, ${JSON.stringify(towardWord(b.toward))}) are not opposite — "between" needs one on each side (ADR-168 D3)`)
      }
    }
  }
  return errors
}

/**
 * Claim conflicts: two claimants saying different things about the same pair on
 * the same axis. For `toward`, only claims in the same frame of reference can
 * disagree — "left as seen from A" and "right as seen from B" can both be true,
 * which is exactly why the viewer is part of the word (ADR-168 D2).
 *
 * Deterministic: ordered by (subject, of, axis), `between` sorted.
 *
 * @param {object[]} arrangements  shape-valid ones
 * @returns {Array<{subject: string, of: string, axis: 'contact'|'toward',
 *                  between: string[], claims: Array<{ref: string, by: string, value: unknown}>}>}
 */
export function claimConflicts(arrangements) {
  /** @type {Map<string, Array<{ref: string, by: string, side: object}>>} */
  const byPair = new Map()
  for (const arr of arrangements ?? []) {
    for (const side of arr.sides ?? []) {
      const key = `${arr.subject}\u0000${side.of}`
      if (!byPair.has(key)) byPair.set(key, [])
      byPair.get(key).push({ ref: arr.ref, by: arr.by, side })
    }
  }
  const out = []
  for (const [key, claims] of [...byPair].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [subject, of] = key.split('\u0000')
    const contact = claims.filter(c => c.side.contact !== undefined)
    if (new Set(contact.map(c => c.side.contact)).size > 1) {
      out.push(conflictOf(subject, of, 'contact', contact, c => c.side.contact))
    }
    const toward = claims.filter(c => c.side.toward !== undefined && isToward(c.side.toward))
    /** @type {Map<string, typeof toward>} */
    const byFrame = new Map()
    for (const c of toward) {
      const t = c.side.toward
      const frame = frameOfToward(t) === 'relative' ? `relative@${t.viewer}` : frameOfToward(t)
      if (!byFrame.has(frame)) byFrame.set(frame, [])
      byFrame.get(frame).push(c)
    }
    for (const [, group] of [...byFrame].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (new Set(group.map(c => towardKey(c.side.toward))).size > 1) {
        out.push(conflictOf(subject, of, 'toward', group, c => c.side.toward))
      }
    }
  }
  return out
}

function conflictOf(subject, of, axis, claims, valueOf) {
  const sorted = [...claims].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return {
    subject, of, axis,
    between: sorted.map(c => c.ref),
    claims: sorted.map(c => ({ ref: c.ref, by: c.by, value: valueOf(c) })),
  }
}

/**
 * @typedef {{contact: 'touching'|'apart'|'overlapping', faces: string[], gap: number|null,
 *            vertical: 'above'|'below'|null, relative: (viewerRef: string) => string[]}} SideState
 */

/**
 * The status of one declared side against its observed state (ADR-168 D4).
 *
 * @param {{contact?: string, toward?: unknown}} side  a shape-valid declared side
 * @param {SideState} state
 * @returns {{contact: string, toward: string}}  each one of AXIS_STATUS
 */
export function sideStatus(side, state) {
  const contact = side.contact === undefined
    ? AXIS_STATUS.UNDECLARED
    : (side.contact === state.contact ? AXIS_STATUS.MATCH : AXIS_STATUS.MISMATCH)

  /** @type {string} */
  let toward = AXIS_STATUS.UNDECLARED
  if (side.toward !== undefined) {
    /** @type {any} */
    const t = side.toward
    const frame = frameOfToward(t)
    const holds =
      frame === 'intrinsic' ? state.contact === OBSERVED_CONTACT.TOUCHING && state.faces.includes(t)
      : frame === 'absolute' ? state.contact !== OBSERVED_CONTACT.TOUCHING && state.vertical === t
      : state.contact !== OBSERVED_CONTACT.TOUCHING && state.relative(t.viewer).includes(t.dir)
    toward = holds ? AXIS_STATUS.MATCH : AXIS_STATUS.MISMATCH
  }
  return { contact, toward }
}
