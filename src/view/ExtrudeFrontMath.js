/**
 * ExtrudeFrontMath — pure intensity dynamics for the face-extrude growth
 * front (ADR-080 Phase 2, Tier A).
 *
 * The growth front is the glowing rim of the face being extruded: it speaks
 * about *the operation being live and its momentum* ("this face is growing,
 * this fast, right now") — the boundary-of-change accent (animation-fx P4)
 * for the app's namesake operation. It never speaks magnitude — the numeric
 * authority stays the ExtrusionLabel / status bar (a Tier A affordance must
 * not fake a Tier F judgment).
 *
 * DISCIPLINE (same lane as ChromeMath / CommandFeedbackMath):
 *   - Pure and THREE-free (`node --test`): inputs are numbers, outputs are
 *     numbers/fragments. The view (`ExtrudeFrontView`) renders them.
 *   - Deterministic — no Math.random, no wall-clock reads.
 *   - Robust (#12): non-finite velocity/dt degrade to plain decay, never NaN.
 *   - Reduced motion: a STATIC held rim — the information ("this face is
 *     being extruded") is preserved, the velocity glow is dropped (#30/#11).
 */
import { clamp01 } from './MotionMath.js'

/** Resting rim intensity while the operation is live — never fully dark. */
export const FRONT_BASE = 0.22
/** Intensity gained per (world-unit/second) of extrusion speed, pre-clamp. */
export const FRONT_GAIN = 1.8
/** Exponential release rate (per second) once the drag goes still (P2 余韻). */
export const FRONT_RELEASE = 3.5
/** Static intensity of the reduced-motion held cue. */
export const FRONT_STATIC = 0.5

/**
 * Advance the rim intensity by one step: speed pushes it up instantly
 * (attack is immediate — the front must answer the hand), stillness lets it
 * decay exponentially toward the resting base (the trailing glow that says
 * "you just moved" — P2).
 *
 * @param {number} prev previous intensity ∈ [FRONT_BASE, 1]
 * @param {number} velocity |d(dist)/dt| in world-units/second (this frame)
 * @param {number} dt seconds since the previous step
 * @returns {number} next intensity ∈ [FRONT_BASE, 1]
 */
export function intensityStep(prev, velocity, dt) {
  const p = Number.isFinite(prev) ? Math.min(Math.max(prev, FRONT_BASE), 1) : FRONT_BASE
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0
  const decayed = FRONT_BASE + (p - FRONT_BASE) * Math.exp(-FRONT_RELEASE * step)
  const v = Number.isFinite(velocity) && velocity > 0 ? velocity : 0
  const target = clamp01(FRONT_BASE + v * FRONT_GAIN)
  return Math.max(decayed, target)
}

/**
 * Render fragment for one frame of the rim at a given intensity.
 * `whiteLerp` is how far the view lerps the rim colour toward white — the
 * boundary flash that scales with momentum (P4); opacity carries presence.
 * Reduced → the static held cue (no flash, fixed presence).
 *
 * @param {number} intensity ∈ [0,1]
 * @param {boolean} [reduced]
 * @returns {{opacity: number, whiteLerp: number}}
 */
export function frontFrame(intensity, reduced = false) {
  if (reduced) return { opacity: FRONT_STATIC, whiteLerp: 0 }
  const i = clamp01(intensity)
  return {
    opacity: 0.35 + 0.65 * i,
    whiteLerp: Math.max(0, (i - FRONT_BASE) / (1 - FRONT_BASE)) * 0.85,
  }
}
