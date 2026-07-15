/**
 * MapPreviewMath — pure per-frame derivation for the Map Mode drawing
 * preview's idle/entry motion (ADR-072 refinement pass).
 *
 * TIER ROUTING (PHILOSOPHY #30): both cues are Tier A affordance —
 *   - the cursor dot's breathe says "draw mode is live here", the exact
 *     sibling of the chrome active-tool breathing glow (ADR-065 Phase 3);
 *   - the snap ring's entry pop marks the boundary moment the persistent
 *     lock indicator appears (the transient SnapFlash narrates the EVENT;
 *     the pop is the persistent state's entrance — they compose, not
 *     duplicate: the ring never re-pops on retarget, the position jump IS
 *     the fact and smoothing/re-popping it would blur the lock point).
 *
 * Anti-lockstep: the breathe composes two non-integer-ratio sine
 * frequencies so the idle never reads as a metronome loop. Deterministic —
 * no Math.random, replay-identical (same discipline as StageMath/voxelJitter).
 *
 * Reduced motion: scale is EXACTLY 1 — the dot/ring stay as static cues,
 * only the movement is dropped (#30/#11). The caller samples
 * `prefersReducedMotion()` once per map session (per-spawn discipline,
 * ADR-065 Phase 5) and passes it in; this module never reads matchMedia.
 *
 * Pure and THREE-free (`node --test`); malformed clocks → identity scale 1,
 * honest stillness (#11).
 */
import { clamp01, easeOutBack } from './MotionMath.js'

/** Entry pop lengths (seconds) — micro-transition band (≤ 300 ms). */
export const CURSOR_POP = 0.22
export const RING_POP   = 0.18

/** Breathe amplitude/frequencies — two non-integer-ratio sines (no loop feel). */
const BREATHE_A1 = 0.06,  BREATHE_F1 = 1.9
const BREATHE_A2 = 0.035, BREATHE_F2 = 3.1

/**
 * Per-frame scale of the drawing cursor dot: an easeOutBack entry pop
 * multiplied by a bounded two-frequency breathe.
 *
 * @param {number} t       loop clock (seconds)
 * @param {number} bornAt  clock value when the dot appeared
 * @param {boolean} [reduced]
 * @returns {{scale: number}} scale 1 exactly under reduced motion or
 *   malformed clocks; otherwise bounded within (0, 1 + amplitudes].
 */
export function cursorFrame(t, bornAt, reduced = false) {
  if (reduced || !Number.isFinite(t) || !Number.isFinite(bornAt)) return { scale: 1 }
  const e   = Math.max(t - bornAt, 0)
  const pop = e >= CURSOR_POP ? 1 : easeOutBack(clamp01(e / CURSOR_POP))
  const breathe = 1 + BREATHE_A1 * Math.sin(t * BREATHE_F1)
                    + BREATHE_A2 * Math.sin(t * BREATHE_F2)
  return { scale: Math.max(pop * breathe, 0.001) }
}

/**
 * Per-frame scale of the endpoint-snap ring: an easeOutBack settle on
 * appearance, then steady 1 — a lock indicator must not breathe (a pulsing
 * lock reads as instability, the opposite of what it asserts).
 *
 * @param {number} t       loop clock (seconds)
 * @param {number} bornAt  clock value when the ring became visible
 * @param {boolean} [reduced]
 * @returns {{scale: number}}
 */
export function ringFrame(t, bornAt, reduced = false) {
  if (reduced || !Number.isFinite(t) || !Number.isFinite(bornAt)) return { scale: 1 }
  const e = Math.max(t - bornAt, 0)
  if (e >= RING_POP) return { scale: 1 }
  return { scale: Math.max(easeOutBack(clamp01(e / RING_POP)), 0.001) }
}
