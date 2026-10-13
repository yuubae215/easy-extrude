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
import { phaseFor } from './MapVisualMath.js'
import { BREACH_PERIOD } from './LinkMotionMath.js'
import { STAGE } from './StageMath.js'

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
    ? `transform ${DURATION.press}ms ${EASING.land}`
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
  return { animation: `eaBreatheGlow ${DURATION.breathe}ms ${EASING.loop} infinite` }
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
  return { animation: `eaChromeEnter ${duration}ms ${EASING.land}` }
}

/**
 * Exit motion for transient chrome (a toast leaving): the mirror of
 * `enterMotion` — a short fade-and-slide that says "this notification is done"
 * instead of popping out abruptly (ADR-068 polish). Reduced → `{ opacity: 0 }`
 * (the content is simply gone; the caller removes it immediately, no lingering
 * animation). `fill: both` holds the final (invisible) frame until unmount.
 *
 * @param {boolean} reduced
 * @param {number} [duration] ms (defaults to the toastOut token)
 * @returns {object} inline-style fragment
 */
export function exitMotion(reduced, duration = DURATION.toastOut) {
  if (reduced) return { opacity: 0 }
  return { animation: `eaChromeExit ${duration}ms ${EASING.exit} both` }
}

/**
 * Entry motion for a popover/menu container (AddMenu, ContextMenu,
 * ModeDropdown, LinkTypePicker — ADR-080 Phase 1): a short scale-fade that
 * GROWS FROM ITS ANCHOR, so the motion says "this menu came from where you
 * acted" (Tier A — stopped, you could no longer tell where it grew from).
 * The spring easing lands with a slight overshoot-settle. Visual only — the
 * menu is interactive from the first frame (the animation never gates input).
 * Reduced → `{}`: the menu simply appears (the information is its content).
 *
 * @param {boolean} reduced
 * @param {string} [origin] CSS transform-origin naming the anchor side
 * @returns {object} inline-style fragment
 */
export function popoverEnterMotion(reduced, origin = 'top left') {
  if (reduced) return {}
  return {
    transformOrigin: origin,
    animation: `eaPopoverEnter ${DURATION.popoverEnter}ms ${EASING.spring} both`,
  }
}

/**
 * Entry motion for ONE menu item: the shared `eaChromeEnter` slide-fade,
 * offset by an equal-interval stagger so items cascade instead of appearing
 * in lockstep (animation-fx quality gate 2 — no simultaneous motion).
 * `backwards` holds opacity 0 through the delay; hit-testing is unaffected.
 * NOT `both`: a forwards fill keeps the last keyframe's `transform: none`
 * winning over the item's own inline transform after the entrance, so a Home
 * card's hover lift never moved (found in ADR-166 M4c — the end state is the
 * natural state, so nothing is lost by letting go of it).
 * Reduced → `{}` (all items simply present).
 *
 * @param {number} index 0-based item position (non-finite/negative → 0)
 * @param {boolean} reduced
 * @returns {object} inline-style fragment
 */
export function itemEnterMotion(index, reduced) {
  if (reduced) return {}
  return {
    animation: `eaChromeEnter ${DURATION.chromeEnter}ms ${EASING.land} backwards`,
    animationDelay: `${itemEnterDelay(index)}ms`,
  }
}

/**
 * The stagger delay of item `index` (ms) — the one source for anything that
 * must start in step with an item's entrance (a Home card's plan lights after
 * its card, ADR-166 M4c).
 *
 * @param {number} index 0-based item position (non-finite/negative → 0)
 * @returns {number} ms
 */
export function itemEnterDelay(index) {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0
  return i * DURATION.menuStagger
}

/**
 * The breath of a marker that asks for attention until something is settled
 * (a conflict, an unknown, an unsettled proposal — the demo badges, ADR-166
 * M4c). The SAME breath as a violated link in the scene (M4b): `loop` curve,
 * `BREACH_PERIOD` — one fact, "unsettled breathes at 2 s", in DOM and 3D. The
 * phase comes from the marker's identity (`phaseFor`, ADR-093 D1), so N badges
 * in one panel never blink in lockstep; a negative delay starts each one part-
 * way through its cycle. It used to be `ease-in-out infinite` at 1.2 s, all in
 * phase — an alarm, not a breath.
 * Reduced → `{}`: the badge stays at full strength, still shown (#11).
 *
 * @param {string} key the marker's identity (the conflict ref, the variable…)
 * @param {boolean} reduced
 * @returns {object} inline-style fragment
 */
export function attentionBreath(key, reduced) {
  if (reduced) return {}
  const periodMs = BREACH_PERIOD * 1000
  return {
    animation: `eaAttentionBreath ${periodMs}ms ${EASING.loop} infinite`,
    animationDelay: `${-Math.round(phaseFor(key) * periodMs)}ms`,
  }
}

/** Glow shadow at a given breathe intensity (0..1) — one shadow shape, one colour. */
function breatheShadow(intensity) {
  const a = 0.12 + 0.26 * intensity
  return `0 0 0 1px ${rgba(COLOR.accent, +a.toFixed(3))}, 0 0 10px ${rgba(COLOR.accent, +(a * 0.7).toFixed(3))}`
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
@keyframes eaChromeExit {
  from { opacity: 1; transform: none; }
  to   { opacity: 0; transform: translateY(5px); }
}
@keyframes eaPopoverEnter {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: none; }
}
@keyframes eaBreatheGlow {
  ${breatheGlowKeyframes()}
}
@keyframes eaAttentionBreath {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
@keyframes eaLightOn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes eaPoolBreath {
  0%, 100% { opacity: 1; }
  50%      { opacity: ${1 - STAGE.breath.depth}; }
}
`
