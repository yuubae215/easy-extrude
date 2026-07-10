/**
 * ChromeMath — pure Tier A style derivations for the chrome refresh
 * (ADR-065 Phase 3).
 *
 * Tier A (affordance motion — PHILOSOPHY #30): every fragment here speaks
 * about *capability* ("you can press this / this tool is engaged / this
 * control is locked and why"), never about a judgment or result — that is
 * Tier F territory (FeedbackMath / CommandFeedbackMath). The one-sentence
 * test: if the motion stopped, the user could no longer tell that the
 * control is pressable / engaged / locked.
 *
 * DISCIPLINE:
 *   - Pure and THREE-free (`node --test` lane). Inputs are interaction state
 *     (hovered / pressed / active) × the `reduced` flag read at the single
 *     boundary (`src/theme/motion.js`); outputs are inline-style fragments —
 *     same shape as `FeedbackMath.flashStyle`.
 *   - Motion only: fragments carry transform / transition / animation, never
 *     colours — colour state (active tint, danger red) stays component-owned
 *     so Tier A motion cannot fake a Tier F judgment ("the glowing button
 *     must be the right answer").
 *   - Under reduced motion every fragment degrades to a *static styled cue*
 *     or to the component's own static colour state — information preserved,
 *     movement dropped, never a silent disappearance (#11).
 */
import { COLOR, DURATION, EASING, rgba } from '../theme/tokens.js'
import { breathe } from './MotionMath.js'

/**
 * Press/hover motion for a chrome button: press-down scale, spring-back on
 * release (`EASING.spring` = the CSS form of easeOutBack), subtle hover lift.
 * Colours are NOT set here — the component's own hover/active tints remain
 * the static cue, so under reduced motion this returns `{}` and the button
 * still reads as hovered/pressed through its colour state.
 *
 * @param {{hovered?: boolean, pressed?: boolean, reduced?: boolean}} s
 * @returns {object} inline-style fragment (transform + transition, or `{}`)
 */
export function tierAMotion({ hovered = false, pressed = false, reduced = false } = {}) {
  if (reduced) return {}
  const transform = pressed ? 'scale(0.94)' : hovered ? 'translateY(-1px)' : 'none'
  const transition = pressed
    ? `transform ${DURATION.press}ms ${EASING.out}`
    : `transform ${DURATION.pressRelease}ms ${EASING.spring}`
  return { transform, transition }
}

/**
 * Breathing glow for an ENGAGED tool (active toolbar mode, open dropdown) —
 * the Tier A "this mode is live" affordance. Motion allowed → the looping
 * `eaBreatheGlow` keyframes (built from MotionMath.breathe below); reduced →
 * the same glow held statically at its midpoint intensity. Inactive → `{}`.
 *
 * @param {boolean} active  the SAME gate/state that styles the control active
 * @param {boolean} reduced
 * @returns {object} inline-style fragment
 */
export function activeGlow(active, reduced = false) {
  if (!active) return {}
  if (reduced) return { boxShadow: breatheShadow(0.5) }
  return { animation: `eaBreatheGlow ${DURATION.breathe}ms ${EASING.inOut} infinite` }
}

/**
 * The stylized LOCKED state (disabled-as-quest, ADR-065 named rule 5):
 * a dashed border + help cursor says "locked — tap to learn why", replacing
 * the old mute `opacity:0.35`-only treatment. Static by design (a locked
 * control must not move), so it is identical under reduced motion.
 * The reason text itself comes from the gate predicate (ChromeGates).
 *
 * @returns {object} inline-style fragment
 */
export function lockedStyle() {
  return { borderStyle: 'dashed', cursor: 'help' }
}

/**
 * Entry motion for transient chrome (toast appearing, info-bar hints swapping
 * after a mode change): a short slide-fade that says "this content is new".
 * Reduced → `{}`: the new content simply appears (the information is the
 * content, not the slide).
 *
 * @param {boolean} reduced
 * @param {number} [duration] ms (defaults to the chromeEnter token)
 * @returns {object} inline-style fragment
 */
export function enterMotion(reduced, duration = DURATION.chromeEnter) {
  if (reduced) return {}
  return { animation: `eaChromeEnter ${duration}ms ${EASING.out}` }
}

/** Glow shadow at a given breathe intensity (0..1) — one shadow shape, one colour. */
function breatheShadow(intensity) {
  const a = 0.12 + 0.26 * intensity
  return `0 0 0 1px ${rgba(COLOR.accentActive, +a.toFixed(3))}, 0 0 10px ${rgba(COLOR.accentActive, +(a * 0.7).toFixed(3))}`
}

/**
 * Keyframe body for the breathing glow, generated from the pure
 * MotionMath.breathe curve so the CSS and the curve cannot drift.
 * @param {number} [steps] keyframe stops (steps+1 emitted, 0% and 100% equal)
 * @returns {string}
 */
export function breatheGlowKeyframes(steps = 8) {
  const stops = []
  for (let i = 0; i <= steps; i++) {
    const p = i / steps
    stops.push(`${+(p * 100).toFixed(2)}% { box-shadow: ${breatheShadow(breathe(p))}; }`)
  }
  return stops.join('\n  ')
}

/**
 * Keyframes shared by every Tier A chrome surface (inline styles cannot
 * express keyframes). Mounted once by `ChromeDefs` in UIShell.
 */
export const CHROME_CSS = `
@keyframes eaChromeEnter {
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: none; }
}
@keyframes eaBreatheGlow {
  ${breatheGlowKeyframes()}
}
`
