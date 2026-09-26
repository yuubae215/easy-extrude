/**
 * robotHand (domain) — WHAT the robot grasps with: the hand's kind, its gate
 * parameters and its SHAPE, declared once on the robot's tcp entity (ADR-152 D3).
 *
 * ## Why the tcp
 *
 * ADR-151 left the tcp as the one entity the robot and the gripper share (its
 * transform IS the tool mount). The hand is the gripper's other fact, so it lives
 * beside the mount on the same entity. Three readers derive from it (§1.1):
 *
 *   - the wire `gripper` (kind + gate params + body/fingers/cupHeight, in m);
 *   - the arm's drawn tool (`robotTool.toolParts`) — the housing and fingers
 *     the viewer sees are the ones core/ judges;
 *   - the hand preview on the object (ADR-152 D6).
 *
 * ## Three states (原則 #31)
 *
 *   undeclared — no `hand` on the tcp (a pre-ADR-152 scene). Never filled in with
 *                a default on read: "nobody said" stays visible, the grasp gate has
 *                no hand, and the arm draws a bare flange→TCP rod (a shape nobody
 *                judged is not drawn — ADR-152 D3).
 *   declared   — readable. Its SHAPE may itself be absent (`body` omitted): then
 *                core/ judges the flange→TCP segment and the arm draws the rod.
 *   malformed  — a hand is there but cannot be read; printable reasons.
 *
 * ## The mount is not derived from the shape
 *
 * `toolLength` (the mount, ADR-151) and the shape are separate facts. Neither is
 * computed from the other; `handMountGap` only says when they CONTRADICT (the
 * TCP outside the fingers, or off the cup face), and the search stops with that
 * reason instead of quietly correcting one of them.
 *
 * Units: the scene's (mm, ADR-136). Pure (no THREE) — node --test and the view
 * read the same numbers.
 *
 * @module domain/robotHand
 */

import { GRIPPER_KIND, DECLARED_GRIPPER_KINDS } from '../context/GraspDeclarationCatalog.js'
import { mmToM } from './worldUnits.js'
import { isFlangeMountedTcp } from './robotFrames.js'

/** Resolved state of a tcp's hand declaration. */
export const HAND_STATE = Object.freeze({
  UNDECLARED: 'undeclared',
  DECLARED:   'declared',
  MALFORMED:  'malformed',
})

/** Housing shapes — a closed union; a mesh would be a new kind (ADR-152 案 C). */
export const HAND_BODY_KIND = Object.freeze({ CYLINDER: 'cylinder', BOX: 'box' })

/**
 * The hand a newly added robot is born with, per kind, in mm — numbers, not
 * fractions of the tool length (the `0.21 * L` formulas this replaces made the
 * drawn hand a function of the mount, so a longer mount drew a fatter gripper).
 * Both agree with the default 150 mm mount (`DEFAULT_TOOL_MOUNT`): the jaw's
 * fingertips end at 78 + 72 = 150, the cup face at 130 + 20 = 150.
 */
export const DEFAULT_HAND_BY_KIND = Object.freeze({
  [GRIPPER_KIND.PARALLEL_JAW]: Object.freeze({
    kind: GRIPPER_KIND.PARALLEL_JAW,
    maxOpening: 60,
    fingerClearance: 10,
    body:    Object.freeze({ kind: HAND_BODY_KIND.CYLINDER, radius: 32, length: 78 }),
    fingers: Object.freeze({ length: 72, thickness: 12, width: 21 }),
  }),
  [GRIPPER_KIND.SUCTION]: Object.freeze({
    kind: GRIPPER_KIND.SUCTION,
    cupDiameter: 40,
    sealTiltTolerance: 0.35,
    body:      Object.freeze({ kind: HAND_BODY_KIND.CYLINDER, radius: 32, length: 130 }),
    cupHeight: 20,
  }),
})

/** The default hand for a kind. Throws on an undeclared kind (原則 #31). */
export function defaultHandFor(kind) {
  const h = DEFAULT_HAND_BY_KIND[kind]
  if (!h) throw new Error(`robotHand: 未宣言のハンド種別 "${kind}" — DEFAULT_HAND_BY_KIND に行を足すこと`)
  return h
}

const isPos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
const isNonNeg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

function readBody(body, errors) {
  if (body === undefined || body === null) return null
  if (body.kind === HAND_BODY_KIND.CYLINDER) {
    if (!isPos(body.radius) || !isPos(body.length)) errors.push('hand.body: a cylinder needs radius > 0 and length > 0 (mm)')
    return { kind: body.kind, radius: body.radius, length: body.length }
  }
  if (body.kind === HAND_BODY_KIND.BOX) {
    const ok = Array.isArray(body.size) && body.size.length === 3 && body.size.every(isPos)
    if (!ok) errors.push('hand.body: a box needs size [x, y, z] > 0 (mm)')
    return { kind: body.kind, size: ok ? [...body.size] : body.size }
  }
  errors.push(`hand.body.kind must be one of ${Object.values(HAND_BODY_KIND).join(' / ')}`)
  return null
}

/**
 * **The single resolution point** for "which hand does this tcp carry" (§1.1).
 * Never throws on stored content — a broken hand comes back MALFORMED with
 * reasons (原則 #11).
 *
 * @param {any} raw  the tcp entity's `hand`
 * @returns {{state: string, hand: object|null, errors: string[]}}
 */
export function resolveHand(raw) {
  if (raw === undefined || raw === null) return { state: HAND_STATE.UNDECLARED, hand: null, errors: [] }
  if (typeof raw !== 'object') return { state: HAND_STATE.MALFORMED, hand: null, errors: ['hand must be an object'] }
  const errors = []
  if (!DECLARED_GRIPPER_KINDS.includes(raw.kind)) {
    return { state: HAND_STATE.MALFORMED, hand: null, errors: [`hand.kind must be one of ${DECLARED_GRIPPER_KINDS.join(' / ')}`] }
  }
  const body = readBody(raw.body, errors)
  let hand
  if (raw.kind === GRIPPER_KIND.PARALLEL_JAW) {
    if (!isNonNeg(raw.maxOpening)) errors.push('hand.maxOpening must be a number ≥ 0 (mm)')
    if (raw.fingerClearance != null && !isNonNeg(raw.fingerClearance)) errors.push('hand.fingerClearance must be a number ≥ 0 (mm)')
    let fingers = null
    if (raw.fingers != null) {
      const f = raw.fingers
      if (!isPos(f.length) || !isPos(f.thickness) || !isPos(f.width)) errors.push('hand.fingers needs length, thickness, width > 0 (mm)')
      fingers = { length: f.length, thickness: f.thickness, width: f.width }
    }
    if ((body === null) !== (fingers === null)) errors.push('hand: declare body and fingers together (or neither) — half a shape cannot be placed')
    hand = { kind: raw.kind, maxOpening: raw.maxOpening, ...(raw.fingerClearance != null ? { fingerClearance: raw.fingerClearance } : {}),
      ...(body ? { body } : {}), ...(fingers ? { fingers } : {}) }
  } else {
    if (!isPos(raw.cupDiameter)) errors.push('hand.cupDiameter must be a number > 0 (mm)')
    if (raw.sealTiltTolerance != null && !isNonNeg(raw.sealTiltTolerance)) errors.push('hand.sealTiltTolerance must be a number ≥ 0 (rad)')
    if (raw.cupHeight != null && !isPos(raw.cupHeight)) errors.push('hand.cupHeight must be a number > 0 (mm)')
    if ((body === null) !== (raw.cupHeight == null)) errors.push('hand: declare body and cupHeight together (or neither)')
    hand = { kind: raw.kind, cupDiameter: raw.cupDiameter,
      ...(raw.sealTiltTolerance != null ? { sealTiltTolerance: raw.sealTiltTolerance } : {}),
      ...(body ? { body } : {}), ...(raw.cupHeight != null ? { cupHeight: raw.cupHeight } : {}) }
  }
  if (errors.length) return { state: HAND_STATE.MALFORMED, hand: null, errors }
  return { state: HAND_STATE.DECLARED, hand, errors: [] }
}

/** True when the declared hand carries a SHAPE (housing + fingers / cup). */
export function hasShape(hand) {
  return !!hand?.body
}

/** Length of the housing along the flange +Z (mm): flange face → palm. */
export function bodyLength(body) {
  return body.kind === HAND_BODY_KIND.CYLINDER ? body.length : body.size[2]
}

/** Where the hand ends along the flange +Z (mm): the fingertips, or the cup face. */
export function handTipZ(hand) {
  const palm = bodyLength(hand.body)
  return hand.kind === GRIPPER_KIND.SUCTION ? palm + hand.cupHeight : palm + hand.fingers.length
}

/** Relative tolerance for "the mount agrees with the shape" — the same number core/ uses. */
const MOUNT_REL_TOL = 1e-6

/**
 * Why this hand's shape contradicts the tool mount, or null when it does not
 * (ADR-152 D3). Jaw: the TCP must lie on the fingers,
 * `body.length ≤ toolLength ≤ body.length + fingers.length`. Cup: the TCP is the
 * cup face, `toolLength = body.length + cupHeight`. Stops the search with the
 * reason; never corrects either fact.
 *
 * @param {object|null} hand  a resolved hand
 * @param {number|null} toolLengthMm  the mount's axial length (mm), or null when not axial
 * @returns {string|null}
 */
export function handMountGap(hand, toolLengthMm) {
  if (!hasShape(hand) || toolLengthMm == null) return null
  const palm = bodyLength(hand.body)
  const tip  = handTipZ(hand)
  const tol  = MOUNT_REL_TOL * Math.max(1, Math.abs(toolLengthMm))
  if (hand.kind === GRIPPER_KIND.SUCTION) {
    if (Math.abs(toolLengthMm - tip) > tol) {
      return `The TCP (${round(toolLengthMm)} mm from the flange) is not on the cup face (${round(tip)} mm = housing ${round(palm)} + cup ${round(hand.cupHeight)}). Change the cup height or the tool mount.`
    }
    return null
  }
  if (toolLengthMm < palm - tol || toolLengthMm > tip + tol) {
    return `The TCP (${round(toolLengthMm)} mm from the flange) is off the fingers (${round(palm)}–${round(tip)} mm). Change the finger length, the housing or the tool mount.`
  }
  return null
}

const round = (v) => Math.round(v * 10) / 10

/**
 * The wire `gripper` for a declared hand (contract v7), mm → m. Shape keys ride
 * only when declared — an undeclared shape stays absent and core/ judges the
 * segment, exactly as before (ADR-084 §3: behaviour changes only where a
 * declaration appears).
 *
 * @param {object} hand  a resolved (DECLARED) hand
 * @returns {object}
 */
export function wireGripperFromHand(hand) {
  const body = hand.body
    ? (hand.body.kind === HAND_BODY_KIND.CYLINDER
      ? { kind: 'cylinder', radius: mmToM(hand.body.radius), length: mmToM(hand.body.length) }
      : { kind: 'box', size: hand.body.size.map(mmToM) })
    : null
  if (hand.kind === GRIPPER_KIND.PARALLEL_JAW) {
    return {
      kind: hand.kind,
      maxOpening: mmToM(hand.maxOpening),
      ...(hand.fingerClearance != null ? { fingerClearance: mmToM(hand.fingerClearance) } : {}),
      ...(body ? {
        body,
        fingers: {
          length: mmToM(hand.fingers.length),
          thickness: mmToM(hand.fingers.thickness),
          width: mmToM(hand.fingers.width),
        },
      } : {}),
    }
  }
  return {
    kind: hand.kind,
    cupDiameter: mmToM(hand.cupDiameter),
    ...(hand.sealTiltTolerance != null ? { sealTiltTolerance: hand.sealTiltTolerance } : {}),
    ...(body ? { body, cupHeight: mmToM(hand.cupHeight) } : {}),
  }
}

/**
 * The hand a robot declares — its flange-mounted tcp's `hand`, resolved — the ONE
 * reader shared by the grasp request, the arm's drawn tool and the panel (§1.1),
 * the twin of `robotTool.toolMountOf`. A robot with no tcp has no hand
 * (UNDECLARED): there is no interface to carry one.
 *
 * @param {{tcpFrame?: object|null}|null|undefined} robot
 * @returns {{state: string, hand: object|null, errors: string[]}}
 */
export function handOf(robot) {
  const tcp = robot?.tcpFrame ?? null
  return resolveHand(isFlangeMountedTcp(tcp) ? tcp.hand : undefined)
}
