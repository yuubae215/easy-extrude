/**
 * RobotRevealMath — how an arm that is still loading says WHERE it will stand,
 * and how it arrives (ADR-166 M4d3b).
 *
 * A new arm stays hidden until its declared style has been drawn once (ADR-150
 * D2 — the skeleton must not flash first). Before M4d3b nothing in the 3D view
 * marked the spot: the DOM notice said WHY the base was empty, never WHERE. Now:
 *
 *   - WAITING: a point of the ONE stage light (`STAGE_LIGHT.color`) lies on the
 *     floor of the arm's base frame — the pedestal — and breathes on the
 *     `unresolved` idle period (4 s — "not decided yet" is the slowest loop),
 *     phase from the robot's id (ADR-093 D1: N arms loading at once never
 *     breathe together). Reduced motion: still, at the middle of its range.
 *   - LANDING: the arm comes in on `fade` (it is an opacity) over `REVEAL_SECONDS`,
 *     and in the same instant the light goes out on `exit` (it holds, then
 *     leaves) — the light hands the spot over to the arm. Reduced motion: at once.
 *
 * Both are cue segments (`CueFollowMath`): the TARGET is the stage's first-look
 * fact (`awaitingFirstLook`, written only by `_endFirstLook`), the LEVEL is
 * derived from the clock. The logical state stays two (waiting / shown); the
 * landing is a drawn degree, not a third state (STATE_LEDGER 腕の初見).
 *
 * Pure and THREE-free (bare `node --test`).
 */

import { easeInCubic, easeOutQuad } from './MotionMath.js'
import { IDLE_PERIOD, idleLevel } from './IdleMotionMath.js'
import { cueLevel } from './CueFollowMath.js'
import { STAGE_LIGHT } from './StageMath.js'

/** How long the arm takes to come in, and the light to go out (seconds — the ≤ 300 ms response band). */
export const REVEAL_SECONDS = 0.3

/** The arm's opacity degree: arrives on `fade`. Never let go (a shown arm stays shown — one-way). */
export const ARM_REVEAL_CUE = Object.freeze({
  rise: Object.freeze({ curve: easeOutQuad, duration: REVEAL_SECONDS }),
  fall: Object.freeze({ curve: easeOutQuad, duration: 0 }),
})

/** The waiting light's presence: there from the stage's birth, leaves on `exit`. */
export const BEACON_CUE = Object.freeze({
  rise: Object.freeze({ curve: easeOutQuad, duration: 0 }),
  fall: Object.freeze({ curve: easeInCubic, duration: REVEAL_SECONDS }),
})

/**
 * The UR5e base's diameter (world mm — Universal Robots' published Ø149 mm
 * mounting flange, rounded). What the arm stands on: the size of the waiting
 * light and of the arm's ground shadow both derive from it.
 */
export const BASE_DIAMETER = 150

/**
 * The waiting light. Twice the pedestal across, so it reads as "the spot",
 * not as part of the arm. Its colour is the stage light — read here, never copied.
 */
export const BEACON = Object.freeze({
  color: STAGE_LIGHT.color,
  radius: BASE_DIAMETER,
  /** additive opacity range of the breath */
  lo: 0.18,
  hi: 0.42,
  /** scale the light shrinks to as it leaves (the annotation exit's 0.85 — M3b) */
  exitScale: 0.85,
})

/**
 * One frame of the waiting light.
 * @param {number} t loop clock (seconds)
 * @param {string|null|undefined} key the robot's id (phase from identity)
 * @param {import('./CueFollowMath.js').CueSegment} seg the light's presence segment
 * @param {boolean} [reduced]
 * @returns {{opacity:number, scale:number, present:number}} `present` ∈ [0,1] —
 *   0 means the light is gone and its meshes may be released.
 */
export function beaconFrame(t, key, seg, reduced = false) {
  const present = cueLevel(t, seg, BEACON_CUE, reduced)
  const breath = idleLevel(t, key, IDLE_PERIOD.unresolved, BEACON.lo, BEACON.hi, reduced)
  return {
    opacity: breath * present,
    scale: BEACON.exitScale + (1 - BEACON.exitScale) * present,
    present,
  }
}

/**
 * The arm's opacity degree at clock `t` ∈ [0,1].
 * @param {number} t
 * @param {import('./CueFollowMath.js').CueSegment} seg
 * @param {boolean} [reduced]
 */
export function armReveal(t, seg, reduced = false) {
  return cueLevel(t, seg, ARM_REVEAL_CUE, reduced)
}

/**
 * The arm's footprint for its ground shadow (`GroundShadowMath`): the round
 * pedestal at the base frame's position. Only the pedestal's BOTTOM matters to
 * a contact shadow, so the top is nominal (one diameter up) — it only has to
 * say "this has volume".
 * @param {number} x base frame world position (mm)
 * @param {number} y
 * @param {number} z
 * @returns {{cx:number, cy:number, w:number, d:number, yaw:number, zMin:number, zMax:number}}
 */
export function robotFootprint(x, y, z) {
  return { cx: x, cy: y, w: BASE_DIAMETER, d: BASE_DIAMETER, yaw: 0, zMin: z, zMax: z + BASE_DIAMETER }
}
