/**
 * IdleMotionMath — the governed idle loop: what a waiting thing does while it
 * waits (ADR-166 M4d1).
 *
 * Every idle loop in the app says "this is live / not decided yet" and nothing
 * else, so every one of them obeys the same three rules (CLAUDE.md
 * 「モーション・アイデンティティ」— 時間スケール / 振付パターン, 原則 #30):
 *
 *   - CLOCK, NOT FRAMES. The value is a function of the loop clock `t` alone, so
 *     the same `t` always draws the same frame — at 30 or 144 fps, and however
 *     many times a frame is asked for. (The marching ants of a grabbed link used
 *     to advance `+= 0.018` per CALL: their speed was the frame rate, and an
 *     extra off-loop call stepped them twice.)
 *   - PHASE FROM IDENTITY. The phase is `phaseFor(key)` (ADR-093 D1), so N
 *     waiting things never breathe in lockstep, deterministically.
 *   - THE `loop` ROLE IN THE IDLE BAND. The curve is `breathe` (inOutSine
 *     round trip) and the period is one of the declared periods below, all
 *     inside 2–6 s. Under reduced motion the loop stops at the MIDDLE of its
 *     range — the static value the thing would show on average, not an extreme
 *     (the fact "this is live" stays, the movement goes).
 *
 * Before M4d1 three views wrote `base + a·sin(k·t)` by hand (3 periods: 2 s,
 * π s, π s), one of them for N fills in the same phase, and two of them never
 * read the reduced-motion boundary (docs/motion/inventory.md).
 *
 * Pure and THREE-free (bare `node --test`).
 */

import { breathe } from './MotionMath.js'
import { phaseFor } from './MapVisualMath.js'

/**
 * The declared idle periods (seconds). A waiting thing picks its row by what it
 * says; urgency shortens the period (a breach is faster than a draft).
 */
export const IDLE_PERIOD = Object.freeze({
  /** A broken limit — the most urgent loop (SpatialLinkView, ADR-166 M4b). */
  breach:     2.0,
  /** A live, uncommitted shape the hand is editing (parametric preview, region authoring). */
  draft:      3.0,
  /** A value still undecided — an interval, not a number (uncertainty band). */
  unresolved: 4.0,
})

/**
 * The breath of a waiting thing at clock `t`, ∈ [0,1].
 * 0 under reduced motion or a malformed clock/period.
 * @param {number} t loop clock (seconds)
 * @param {string|null|undefined} key the waiting thing's identity
 * @param {number} period seconds — one of IDLE_PERIOD
 * @param {boolean} [reduced]
 */
export function idleBreath(t, key, period, reduced = false) {
  if (reduced || !Number.isFinite(t) || !(period > 0)) return 0
  const cycle = t / period + phaseFor(key)
  return breathe(cycle - Math.floor(cycle))
}

/**
 * A value breathing between `lo` and `hi`; the middle under reduced motion.
 * @param {number} t
 * @param {string|null|undefined} key
 * @param {number} period
 * @param {number} lo
 * @param {number} hi
 * @param {boolean} [reduced]
 */
export function idleLevel(t, key, period, lo, hi, reduced = false) {
  if (reduced || !Number.isFinite(t)) return (lo + hi) / 2
  return lo + (hi - lo) * idleBreath(t, key, period)
}

/** Marching-ant speed of a grabbed link's dashes (dash units / second — the old 0.018 × 60 fps). */
export const DASH_MARCH_SPEED = 1.08

/**
 * Dash offset of a grabbed link, `elapsed` seconds into the grab. Negative
 * scrolls source → target. 0 under reduced motion or before the clock is known
 * (the tension colour still says "stretched" — the march is only its echo).
 * @param {number} elapsed seconds since the grab began
 * @param {boolean} [reduced]
 */
export function dashMarch(elapsed, reduced = false) {
  if (reduced || !Number.isFinite(elapsed) || elapsed <= 0) return 0
  return -DASH_MARCH_SPEED * elapsed
}
