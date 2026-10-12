/**
 * LinkMotionMath — how a SpatialLink is seen to bind, strain and break (ADR-166 M4b).
 *
 * Three things a link line says, each with the motion identity's vocabulary
 * (CLAUDE.md「モーション・アイデンティティ」):
 *
 *   - BOUND (Tier F, a transient): light leaves both ends, the two beads meet at
 *     the midpoint at the SAME instant (by construction — one progress drives
 *     both), flash there, and the line keeps an afterglow that fades.
 *     Travel = `land` (position), the flash's size = `land`, every opacity =
 *     `fade`. Before M4b this was a wireframe sphere growing and fading on two
 *     LINEAR ramps, plus a separate linear opacity flash on the line itself —
 *     the oldest motion in the app (docs/motion/inventory.md).
 *   - STRAINED (continuous): tension and `bounded_by` severity are distances,
 *     not times, so they are NOT followed in time (a following colour would lag
 *     the hand — the same call as the cube's approach warmth, M4a). Their
 *     colours are the declared tones: strain = `cautionTone`, breach =
 *     `dangerTone`.
 *   - BROKEN (Tier F, a loop): a violated link breathes on the `loop` role
 *     (inOutSine round trip = `breathe`), with a 2 s period inside the idle band
 *     (2–6 s). The phase comes from the link's IDENTITY (`phaseFor(link.id)` —
 *     ADR-093 D1), so N violated links never blink in lockstep. Under reduced
 *     motion the breath stops and the line holds the breach colour — the fact
 *     stays, the movement goes (原則 #30).
 *
 * A fourth, unlinked cue lives here because it was split off the link's own
 * (1 語 1 事実): `rippleFrame` — the point ripple that now only says "something
 * arrived here" (the Context DSL demo), rebuilt on the same curves.
 *
 * The highlight (selection/drag) and the violation's arrival follow their
 * targets through `CueFollowMath` (SELECTION_CUE / VIOLATION_CUE) — the same
 * segments as the cube; this module only composes the levels into a frame.
 *
 * Pure and THREE-free (bare `node --test`). Colours are 0xRRGGBB numbers in,
 * [r, g, b] ∈ [0,1] out (the view calls `setRGB`).
 */

import { clamp01, easeOutExpo, easeOutQuad, breathe } from './MotionMath.js'
import { SELECT_LAND } from './CueFollowMath.js'
import { phaseFor, lightTint } from './MapVisualMath.js'
import { COLOR } from '../theme/tokens.js'

const hexNumber = hex => parseInt(hex.slice(1), 16)

/**
 * The link's declared tones. Before M4b the line drew five colours no token
 * declared (an orange for tension, an amber and a red for severity, a pink for
 * the pulse, a grey for an unknown type).
 */
export const LINK_TONES = Object.freeze({
  /** Being stretched / nearing a limit — "take care". */
  strain:    hexNumber(COLOR.cautionTone),
  /** A limit is broken. */
  breach:    hexNumber(COLOR.dangerTone),
  /** The breath's bright side: the breach lit by the ONE stage light (as M3a's floor light). */
  breachLit: lightTint(hexNumber(COLOR.dangerTone), 0.5),
  /** A link type the palette does not know — neutral, reports nothing. */
  unknown:   hexNumber(COLOR.entityDefault),
})

// ── Bound: the binding light ────────────────────────────────────────────────

/** Beads run from both ends to the midpoint (seconds) — the selection landing, one tempo. */
export const BIND_TRAVEL = SELECT_LAND
/** The flash and the line's afterglow once the beads meet (seconds). */
export const BIND_AFTERGLOW = 0.3
/** Whole binding cue (seconds). */
export const BIND_TOTAL = BIND_TRAVEL + BIND_AFTERGLOW

/**
 * The bead's radius from the link's own span (scene-derived, 原則 #27): the cue
 * scales with the scene whatever its unit. The binding ripple it replaces used
 * a fixed 0.15 — in the default mm scene that is 0.15 mm, so the ceremony was
 * never visible there (found by the M4b real-browser check).
 * @param {number} span distance between the two centroids (world units)
 * @returns {number} radius > 0
 */
export function bindRadius(span) {
  return Number.isFinite(span) && span > 0 ? span * 0.05 : 1e-3
}

/**
 * @typedef {{
 *   done: boolean,
 *   travel: number,        // 0..1 — each bead's progress from its end to the midpoint
 *   beadOpacity: number,
 *   flashScale: number,    // × base radius
 *   flashOpacity: number,
 *   lineGlow: number,      // 0..1 — the overlay line's opacity
 * }} BindFrame
 */

/**
 * One frame of the binding light.
 * @param {number} elapsed seconds since the link was bound (a clock that steps
 *   back is read as the start, never as "finished")
 * @param {boolean} [reduced]
 * @returns {BindFrame}
 */
export function bindFrame(elapsed, reduced = false) {
  const e = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0
  const done = e >= BIND_TOTAL
  if (reduced) {
    // A static confirmation: the meeting point lit, the line lit, held for the
    // same duration — information preserved, movement dropped.
    return { done, travel: 1, beadOpacity: 0, flashScale: 1.5, flashOpacity: 0.5, lineGlow: 0.6 }
  }
  if (e < BIND_TRAVEL) {
    const p = e / BIND_TRAVEL
    return {
      done,
      travel: easeOutExpo(p),
      beadOpacity: 1,
      flashScale: 0,
      flashOpacity: 0,
      lineGlow: 0.35 * easeOutQuad(p),   // the line warms as the light runs along it
    }
  }
  // The meeting is the boundary (G3): the flash and the full glow begin there,
  // then fade together — the afterglow is the line remembering it was bound.
  const q = clamp01((e - BIND_TRAVEL) / BIND_AFTERGLOW)
  const fall = 1 - easeOutQuad(q)
  return {
    done,
    travel: 1,
    beadOpacity: 0,
    flashScale: 1 + 1.5 * easeOutExpo(q),
    flashOpacity: fall,
    lineGlow: fall,
  }
}

// ── Broken: the violation's breath ──────────────────────────────────────────

/** Period of a violated link's breath (seconds) — inside the idle band (2–6 s). */
export const BREACH_PERIOD = 2.0

/**
 * The breath of a violated link at clock `t`, ∈ [0,1]. Phase from identity, so
 * N links de-sync; 0 under reduced motion or a malformed clock (the line then
 * holds the breach colour).
 * @param {number} t loop clock (seconds)
 * @param {string|null|undefined} linkId
 * @param {boolean} [reduced]
 */
export function breachPulse(t, linkId, reduced = false) {
  if (reduced || !Number.isFinite(t)) return 0
  const cycle = t / BREACH_PERIOD + phaseFor(linkId)
  return breathe(cycle - Math.floor(cycle))
}

// ── The line's frame ────────────────────────────────────────────────────────

/** @param {number} hex @returns {number[]} */
export function hexToRgb(hex) {
  const h = Number.isFinite(hex) ? hex : 0
  return [((h >> 16) & 0xff) / 255, ((h >> 8) & 0xff) / 255, (h & 0xff) / 255]
}

function mix(a, b, k) {
  const w = clamp01(k)
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]
}

const lerp = (a, b, k) => a + (b - a) * clamp01(k)

const IDLE      = Object.freeze({ opacity: 0.4, dashSize: 0.35, gapSize: 0.18 })
const LIT       = Object.freeze({ opacity: 1.0, dashSize: 0.45, gapSize: 0.15 })
const BREACHED  = Object.freeze({ dashSize: 0.15, gapSize: 0.08 })

/**
 * @typedef {{rgb: number[], opacity: number, dashSize: number, gapSize: number}} LineFrame
 */

/**
 * Compose the line's look from its levels. Priority (strongest wins when full,
 * continuous in between): broken > strained > highlighted > idle. Severity
 * (`bounded_by`'s graded distance) replaces the binary violation for the links
 * that have it.
 *
 * @param {{
 *   base: number,        // 0xRRGGBB — the link type's colour
 *   highlight?: number,  // 0..1 — selection/drag level (followed)
 *   tension?: number,    // ≥ 0 — stretch beyond rest (continuous, not followed)
 *   severity?: number,   // 0..1 — bounded_by proximity (continuous)
 *   violation?: number,  // 0..1 — violation level (followed: immediate + afterglow)
 *   pulse?: number,      // 0..1 — `breachPulse`
 * }} s
 * @returns {LineFrame}
 */
export function linkLineFrame({ base, highlight = 0, tension = 0, severity = 0, violation = 0, pulse = 0 }) {
  const h = clamp01(highlight)
  const baseRgb = hexToRgb(base)
  const strain = hexToRgb(LINK_TONES.strain)
  const breach = hexToRgb(LINK_TONES.breach)
  const lit    = hexToRgb(LINK_TONES.breachLit)
  const beat   = clamp01(pulse)

  let rgb = baseRgb
  let opacity  = lerp(IDLE.opacity,  LIT.opacity,  h)
  let dashSize = lerp(IDLE.dashSize, LIT.dashSize, h)
  let gapSize  = lerp(IDLE.gapSize,  LIT.gapSize,  h)

  // Strained: a distance mapped to colour — squared so the first stretch stays quiet.
  if (tension > 0) {
    const k = Math.min(tension, 1)
    rgb = mix(rgb, strain, k * k)
  }

  if (severity > 0) {
    const s = clamp01(severity)
    rgb = s < 0.5 ? mix(baseRgb, strain, s * 2) : mix(strain, breach, (s - 0.5) * 2)
    dashSize = IDLE.dashSize - s * 0.20
    gapSize  = IDLE.gapSize  - s * 0.10
    opacity  = Math.max(opacity, 0.4 + s * 0.4)
    if (s > 0.8) {
      rgb = mix(rgb, lit, beat * 0.4)
      opacity = Math.max(opacity, 0.8 + beat * 0.2)
    }
  } else if (violation > 0) {
    const v = clamp01(violation)
    rgb      = mix(rgb, mix(breach, lit, beat * 0.4), v)
    opacity  = lerp(opacity, 0.8 + beat * 0.2, v)
    dashSize = lerp(dashSize, BREACHED.dashSize, v)
    gapSize  = lerp(gapSize,  BREACHED.gapSize,  v)
  }

  return { rgb, opacity, dashSize, gapSize }
}

// ── Arrived: the point ripple (RippleEffect) ────────────────────────────────

/**
 * One frame of the point ripple ("something arrived here"): size on `land`
 * (1× → 4×), opacity on `fade` (0.8 → 0). Before M4b both were linear.
 * Reduced: a static mid-scale cue.
 * @param {number} progress 0..1 over `DURATION.ripple`
 * @param {boolean} [reduced]
 * @returns {{scale: number, opacity: number}}
 */
export function rippleFrame(progress, reduced = false) {
  if (reduced) return { scale: 2, opacity: 0.35 }
  const p = clamp01(progress)
  return { scale: 1 + 3 * easeOutExpo(p), opacity: 0.8 * (1 - easeOutQuad(p)) }
}
