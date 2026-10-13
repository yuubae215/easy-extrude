/**
 * SelectPulseMath — the selection "tap" cue's frame (ADR-068 → ADR-166 M4d2).
 *
 * Two curves, one per role (ADR-093 D2 / the motion identity): the outline's
 * SIZE lands (`land` = outExpo — the response to the click), its OPACITY fades
 * (`fade` = outQuad, read as 1 → 0, i.e. (1 − p)²). Before M4d2 both came from
 * one `easeOutCubic` progress, so the pulse was as bright at full size as the
 * shrinking alpha allowed — one curve wearing two roles. Now it is brightest
 * while it is small and quiet by the time it has grown: the cue says "this
 * one", then gets out of the way of the steady outline, which lands on
 * `SELECTION_CUE` in the same instant (`MeshView`).
 *
 * Pure and THREE-free (bare `node --test`). Under reduced motion the frame is
 * a held outline (the cue's meaning stays, only the movement goes — 原則 #30).
 */

import { clamp01, easeOutExpo, easeOutQuad } from './MotionMath.js'

/** Peak opacity of the pulse (at the instant of selection). */
export const PULSE_OPACITY = 0.9
/** How far the outline grows past the body (scale − 1 at the end). */
export const PULSE_GROWTH = 0.35
/** The held outline under reduced motion: a still ring, a touch outside the body. */
export const PULSE_REDUCED = Object.freeze({ scale: 1.15, opacity: 0.5 })

/**
 * @param {number} progress elapsed / duration (clamped to [0,1]; NaN reads as the start)
 * @param {boolean} [reduced]
 * @returns {{scale: number, opacity: number}}
 */
export function selectPulseFrame(progress, reduced = false) {
  if (reduced) return { scale: PULSE_REDUCED.scale, opacity: PULSE_REDUCED.opacity }
  const p = Number.isFinite(progress) ? clamp01(progress) : 0
  return {
    scale:   1 + PULSE_GROWTH * easeOutExpo(p),
    opacity: PULSE_OPACITY * (1 - easeOutQuad(p)),
  }
}
