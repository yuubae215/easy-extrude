/**
 * CueFollowMath — a state cue follows its target instead of swapping (ADR-166 M4a).
 *
 * A body's hover / selection / violation cue, a frame's context dimming, a
 * persona filter's de-emphasis: each is a TARGET (a boolean the app decides)
 * and a LEVEL on screen. Before M4a every one of them wrote the target straight
 * into the pixels, so the boundary between two states had no shape (quality
 * gate G3). The level here is a SEGMENT — the level on screen when the request
 * changed, the clock at that moment, and the target — so:
 *
 *   - the SAME request again returns the same segment (a re-hover never
 *     replays the landing — the input of an idempotent caller is not a restart);
 *   - a reversal mid-flight continues from the level on screen, never jumps;
 *   - the segment start is a snapshot taken at the change, never re-read from
 *     the frame it produced (原則 #24).
 *
 * This is the shape M3b wrote for the map annotations' selection
 * (`retargetSelection` / `selectionLevel`); M4a MOVED it here so the cube, the
 * frames, the persona ghosts and the annotations share one source (§1.1) —
 * `MapVisualMath` keeps its names as adapters over these functions.
 *
 * Curves are picked by ROLE, per the motion identity (CLAUDE.md
 * 「モーション・アイデンティティ」): a cue ARRIVING is the response to an input,
 * so it lands (`land` = outExpo — a near-instant launch inside the ≤300 ms
 * response band); a cue being LET GO fades (`fade` = outQuad — quiet, never
 * louder than the arrival). A profile names both legs. A leg of length 0 is
 * immediate — the violation cue arrives that way (Tier F outranks the
 * landing: a fact is not eased in).
 *
 * Pure and THREE-free (bare `node --test`). Reduced motion lands on the target
 * at once — the cue's meaning stays, only the movement goes (原則 #30).
 */

import { clamp01, easeOutExpo, easeOutQuad } from './MotionMath.js'
import { DURATION } from '../theme/tokens.js'

/**
 * @typedef {{curve: (p: number) => number, duration: number}} CueLeg
 * @typedef {{rise: CueLeg, fall: CueLeg}} CueMotion
 * @typedef {{from: number, at: number|null, target: number}} CueSegment
 */

function badClock(t) { return !Number.isFinite(t) }

/**
 * At rest at 0 — the segment every cue starts from.
 * @type {Readonly<CueSegment>}
 */
export const CUE_REST = Object.freeze({ from: 0, at: null, target: 0 })

/**
 * A segment already settled at `target` (no motion pending) — for a view that
 * is being (re)built and must not animate into its first state.
 * @param {number} target ∈ [0,1]
 * @returns {CueSegment}
 */
export function settledCue(target) {
  const v = clamp01(target)
  return { from: v, at: null, target: v }
}

/**
 * Level ∈ [0,1] at clock `t`. Reduced motion and malformed clocks land on the
 * target at once.
 * @param {number} t loop clock (seconds)
 * @param {CueSegment} seg
 * @param {CueMotion} motion
 * @param {boolean} [reduced]
 * @returns {number}
 */
export function cueLevel(t, seg, motion, reduced = false) {
  if (!seg) return 0
  const target = clamp01(seg.target)
  if (reduced || seg.at === null || badClock(t) || badClock(seg.at)) return target
  const from = clamp01(seg.from)
  const leg = target >= from ? motion.rise : motion.fall
  if (!(leg.duration > 0)) return target
  const e = t - seg.at
  if (e >= leg.duration) return target
  if (e <= 0) return from
  return from + (target - from) * leg.curve(e / leg.duration)
}

/**
 * A request at clock `t`. The SAME target returns the same segment; a changed
 * target starts a new segment from the level on screen right now.
 * @param {number} t loop clock (seconds)
 * @param {CueSegment} seg current segment
 * @param {number|boolean} target requested level (a boolean reads as 0/1)
 * @param {CueMotion} motion
 * @param {boolean} [reduced]
 * @returns {CueSegment}
 */
export function retargetCue(t, seg, target, motion, reduced = false) {
  const next = clamp01(Number(target))
  const cur = seg ?? CUE_REST
  if (cur.target === next) return cur
  return { from: cueLevel(t, cur, motion, reduced), at: badClock(t) ? null : t, target: next }
}

// ── Lengths and profiles (the response band of the motion identity: ≤ 300 ms) ──

/** Selection landing length (seconds) — one fact for every selected thing. */
export const SELECT_LAND = 0.24
/** Hover arrival (seconds) — the DOM hover ease, so the 3D cue keeps the same tempo. */
export const HOVER_LAND = DURATION.hover / 1000
/** A cue being let go (seconds). */
export const CUE_RELEASE = 0.2
/** A violation's afterglow once it clears (seconds) — the fact leaves a beat behind. */
export const VIOLATION_AFTERGLOW = 0.3

const land = duration => ({ curve: easeOutExpo, duration })
const fade = duration => ({ curve: easeOutQuad, duration })
const IMMEDIATE = Object.freeze({ curve: easeOutQuad, duration: 0 })

/** Hover: arrives on `land`, lets go on `fade`. */
export const HOVER_CUE = Object.freeze({ rise: land(HOVER_LAND), fall: fade(CUE_RELEASE) })
/** Selection: lands with the annotations' `SELECT_LAND`, lets go on `fade`. */
export const SELECTION_CUE = Object.freeze({ rise: land(SELECT_LAND), fall: fade(CUE_RELEASE) })
/** Violation (Tier F): arrives at once, leaves an afterglow. */
export const VIOLATION_CUE = Object.freeze({ rise: IMMEDIATE, fall: fade(VIOLATION_AFTERGLOW) })
/** De-emphasis (an opacity in both directions): `fade` both ways. */
export const DIM_CUE = Object.freeze({ rise: fade(CUE_RELEASE), fall: fade(CUE_RELEASE) })
/**
 * The map annotations' selection (ADR-166 M3b): the light AND the pool's size
 * move together, so both legs are `land` — size is a `land` role. Kept as M3b
 * shipped it; only its source moved.
 */
export const ANNOTATION_SELECTION_CUE = Object.freeze({ rise: land(SELECT_LAND), fall: land(SELECT_LAND) })

/**
 * Layered colour blend: `base`, then each layer in rising priority, each pulled
 * in by its level. At full level the highest layer wins outright (violation >
 * selection > hover), and in between the cue on screen is continuous — the
 * priority composition stays, it just gains a shape.
 * @param {number[]} out   [r, g, b] written in place and returned
 * @param {number[]} base  [r, g, b]
 * @param {Array<[number[], number]>} layers  [[rgb, level], …] lowest priority first
 * @returns {number[]}
 */
export function blendLayers(out, base, layers) {
  out[0] = base[0]; out[1] = base[1]; out[2] = base[2]
  for (const [rgb, level] of layers) {
    const k = clamp01(level)
    out[0] += (rgb[0] - out[0]) * k
    out[1] += (rgb[1] - out[1]) * k
    out[2] += (rgb[2] - out[2]) * k
  }
  return out
}
