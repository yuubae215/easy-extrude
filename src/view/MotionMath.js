/**
 * MotionMath — pure motion arithmetic for the play layer (ADR-065 Phase 1).
 *
 * Easing curves, a critically-damped spring step, and stagger scheduling.
 * Pure and THREE-free (runs under bare `node --test`): every function maps
 * numbers to numbers — views apply the results as style/scale/opacity, the
 * MotionGovernor owns the clock. This is the hand-written DOM/3D motion
 * kernel chosen over framer-motion (Options B rejection — boundary grounds);
 * the escape-hatch trigger (`@react-spring/web`) is evaluated at Phase 3, not
 * here (ADR-065 § Library selection).
 */

/** Clamp to [0, 1]. NaN clamps to 0 (a malformed progress must not propagate). */
export function clamp01(x) {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
}

/** Cubic ease-out: fast start, gentle landing. p ∈ [0,1] → [0,1]. */
export function easeOutCubic(p) {
  const t = clamp01(p)
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Exponential ease-out: a near-instant launch that coasts to rest — the
 * "snappy" curve for burst/convergence distance (a fragment shoots out, then
 * drifts). f(0)=0, f(1)=1, steeper than cubic at the start. p ∈ [0,1] → [0,1].
 * @param {number} p
 */
export function easeOutExpo(p) {
  const t = clamp01(p)
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/**
 * Back ease-out: overshoots past 1 then settles — the "pop" curve for spawn
 * effects. p ∈ [0,1] → [0, ~1.1] with f(0)=0, f(1)=1.
 * @param {number} p
 * @param {number} [s] overshoot amount (default ≈ 10% overshoot)
 */
export function easeOutBack(p, s = 1.70158) {
  const t = clamp01(p)
  const c = s + 1
  return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
}

/**
 * One breathing cycle — the Tier A idle-affordance curve (ADR-065 Phase 3):
 * a smooth swell-and-release with zero velocity at both endpoints, so a
 * looping animation built on it has no seam. sin²(π·p): f(0)=f(1)=0, f(½)=1,
 * symmetric about the peak. Consumed by ChromeMath's breathing-glow keyframes.
 * @param {number} p cycle progress ∈ [0,1] (clamped; NaN → 0)
 * @returns {number} intensity ∈ [0,1]
 */
export function breathe(p) {
  const s = Math.sin(Math.PI * clamp01(p))
  return s * s
}

/**
 * One integration step of a critically-damped spring (no oscillation, no
 * overshoot — the "settle" primitive for interruptible/reversible motion).
 * Semi-implicit Euler, stable for the dt range of a rAF loop.
 *
 * @param {number} x      current value
 * @param {number} v      current velocity
 * @param {number} target rest value
 * @param {number} omega  angular frequency (rad/s) — stiffness; ~8–20 feels snappy
 * @param {number} dt     timestep in seconds
 * @returns {{x: number, v: number}} next value and velocity
 */
export function springStep(x, v, target, omega, dt) {
  if (![x, v, target, omega, dt].every(Number.isFinite) || omega <= 0 || dt <= 0) {
    return { x: Number.isFinite(target) ? target : 0, v: 0 }
  }
  // critically damped: a = −ω²·(x−target) − 2ω·v
  const a = -omega * omega * (x - target) - 2 * omega * v
  const nv = v + a * dt
  return { x: x + nv * dt, v: nv }
}

/**
 * Per-item progress of a staggered sequence: item `i` starts `step` seconds
 * after item `i−1` and animates for `duration` seconds.
 *
 * @param {number} t        seconds since the sequence started
 * @param {number} i        item index (0-based)
 * @param {{step?: number, duration: number}} opts
 * @returns {number} clamped progress ∈ [0,1] for that item (0 = not started)
 */
export function staggerProgress(t, i, { step = 0.06, duration }) {
  if (!Number.isFinite(t) || !Number.isFinite(duration) || duration <= 0) return 0
  return clamp01((t - i * step) / duration)
}
