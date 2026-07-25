/**
 * MapVisualMath — pure per-frame derivation for the Map Mode annotation visual
 * language (ADR-093). Consumed by AnnotatedPointView / AnnotatedLineView /
 * AnnotatedRegionView; those views only apply the returned numbers to
 * scale/opacity/colour.
 *
 * WHY THIS MODULE EXISTS (the root defect it fixes — PHILOSOPHY #31):
 * the ADR-031 §8 animations derived every phase from the RAW loop clock, so
 * they were correct for ONE annotation and wrong for N: every Hub pinged on the
 * same frame, every Zone breathed in the same direction, every Route started its
 * particles at the same offsets. Lockstep across a population is the single
 * loudest "machine, not alive" signal — and it is invisible while testing with a
 * single entity, exactly the cardinality blind spot #31 names. The fix is
 * structural, not cosmetic: every cycle here takes a per-entity `phase` derived
 * from the entity's OWN identity (`phaseFor(id)`), so the population de-syncs
 * permanently and deterministically.
 *
 * TIER ROUTING (PHILOSOPHY #30 / ADR-066):
 *   - Tier A affordance — Hub ping, Route flow, Boundary tick wave, Zone rim:
 *     each asserts the place type's semantics (broadcasting junction / flow
 *     channel / barrier / bounded area). Reading the animation IS reading the
 *     classification, which is why they must never all animate identically.
 *   - Tier D delight — the entry pop, the additive halo breathe, and the Zone
 *     hatch drift: non-propositional life. They carry no fact, so reduced motion
 *     drops them to a static styled cue.
 *   - Tier F fact — the violation-urgent variants (`urgent: true`) narrow the
 *     period and are the ONLY thing here that changes meaning; they stay
 *     perceivable (colour + a held cue) under reduced motion.
 *
 * DISCIPLINE (same as StageMath / CommandFeedbackMath / MapPreviewMath):
 * pure and THREE-free (runs under bare `node --test`), no `Math.random` (a
 * reloaded scene animates identically), never reads `matchMedia` — the caller
 * samples the single boundary (`src/theme/motion.js`) and passes `reduced` in.
 * Malformed clocks collapse to the静 (static) frame rather than NaN geometry:
 * honest stillness over a corrupted transform (#11 / P12).
 */
import { clamp01, easeOutCubic, easeOutBack, breathe } from './MotionMath.js'

// ── Identity → phase ────────────────────────────────────────────────────────

/**
 * Stable per-entity phase offset in [0, 1) derived from the entity's identity
 * string: FNV-1a 32-bit followed by a MurmurHash3 `fmix32` avalanche.
 *
 * The avalanche is NOT decoration. Raw FNV-1a differs by roughly its prime for
 * inputs differing in the last character, so the ids this app actually mints —
 * `annot_point_<epoch ms>`, drawn seconds apart — landed within ~0.4 % of each
 * other in phase, i.e. still in visible lockstep. The de-sync test in
 * `MapVisualMath.test.js` caught it; fmix32 spreads sibling ids across the whole
 * cycle.
 *
 * Identity, NOT position or name: a phase seeded from geometry would jump every
 * drag frame, and one seeded from the name would jump on rename. The entity id
 * is the only stable identity, and `SceneService` owns it (§1.1) — this function
 * never invents one; callers with no id fall back to phase 0 (single-entity
 * scenes look exactly as before).
 *
 * @param {string|null|undefined} key entity id
 * @returns {number} phase ∈ [0, 1)
 */
export function phaseFor(key) {
  if (typeof key !== 'string' || key.length === 0) return 0
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // fmix32 avalanche — every input bit reaches every output bit.
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return (h >>> 8) / 0x01000000   // top 24 bits → [0, 1)
}

/**
 * Cycle progress ∈ [0,1) for a period, offset by the entity's phase.
 * @param {number} t seconds
 * @param {number} period seconds (> 0)
 * @param {number} phase ∈ [0,1)
 */
function cycle(t, period, phase) {
  const p = (t / period + phase) % 1
  return p < 0 ? p + 1 : p
}

/**
 * Bounded two-frequency swell — the anti-metronome idle (P8). Two
 * non-integer-ratio sines never realign, so the loop point is imperceptible.
 * Same device as `MapPreviewMath`'s cursor breathe, seeded per entity here.
 * @param {number} t seconds
 * @param {number} phase ∈ [0,1)
 * @param {{a1: number, f1: number, a2: number, f2: number}} def
 * @returns {number} ∈ [-(a1+a2), a1+a2]
 */
export function livePulse(t, phase, { a1, f1, a2, f2 }) {
  const o = phase * Math.PI * 2
  return a1 * Math.sin(t * f1 + o) + a2 * Math.sin(t * f2 + o * 1.7)
}

/** True when the clock is unusable — callers hold the static frame (#11). */
function badClock(t) { return !Number.isFinite(t) }

// ── Entry pop (Tier D — the boundary moment of "this now exists") ────────────

/** Entry pop length (seconds) — element-entry band, ≤ 300 ms. */
export const ENTRY_POP = 0.28

/**
 * Scale/opacity envelope for an annotation's first moments. An annotation used
 * to blink into existence at full opacity with no transition at all — the
 * boundary between "not there" and "there" carried no演出 (P4).
 *
 * @param {number} t loop clock (seconds)
 * @param {number} bornAt clock value at the view's first tick
 * @param {boolean} [reduced]
 * @returns {{scale: number, opacity: number}} identity frame (1, 1) once the pop
 *   is over, under reduced motion, or on a malformed clock.
 */
export function entryFrame(t, bornAt, reduced = false) {
  if (reduced || badClock(t) || badClock(bornAt)) return { scale: 1, opacity: 1 }
  const e = t - bornAt
  if (e >= ENTRY_POP || e < 0) return { scale: 1, opacity: 1 }
  const p = clamp01(e / ENTRY_POP)
  return {
    // Scale overshoots (outBack) while opacity rises gently (outQuad-ish cubic):
    // the same element animating two attributes on two curves is the cheapest
    // real richness there is (motion-language §1 選定原則).
    scale:   Math.max(easeOutBack(p), 0.001),
    opacity: easeOutCubic(p),
  }
}

// ── Hub — sonar ping (Tier A: "broadcasting junction") ───────────────────────

export const HUB_PING_PERIOD        = 2.6   // calm beacon
export const HUB_PING_PERIOD_URGENT = 0.7   // tact-time violated (Tier F)
export const HUB_PING_RINGS         = 2     // half-cycle offset → continuous wave
const HUB_PING_REACH        = 2.0           // ring grows to 1 + REACH × marker radius
const HUB_PING_PEAK         = 0.42
const HUB_PING_PEAK_URGENT  = 0.70

/**
 * One expanding sonar ring. Both curves are eased, and they are eased
 * DIFFERENTLY: distance is `easeOutCubic` (leaves fast, coasts out) while alpha
 * is a cubic tail so the ring has spent most of its brightness by the time it is
 * large. The ADR-031 §8 version ramped both linearly, which reads as a metronome
 * sweep instead of an emission (P1).
 *
 * The two curves are BALANCED, and the balance is the whole design: the first
 * build paired `easeOutExpo` distance with a slow `(1-p)^2.2` alpha, so every
 * ring reached full radius almost immediately and then lingered there fading —
 * four Hubs became four fat grey donuts covering the map (verified in the
 * browser, not reasoned about). A ping must be brightest where it is SMALL.
 *
 * `index` selects one of `HUB_PING_RINGS` rings spaced evenly through the cycle,
 * so a Hub emits a continuous train rather than one lonely ring per period (P3
 * applied inside a single entity).
 *
 * @param {number} t loop clock (seconds)
 * @param {number} phase ∈ [0,1) from `phaseFor(entityId)`
 * @param {number} index ring index (0 … HUB_PING_RINGS-1)
 * @param {{urgent?: boolean, reduced?: boolean}} [opts]
 * @returns {{scale: number, opacity: number}} `scale` is a multiplier on the
 *   marker's own view scale; reduced motion returns a single held ring (the
 *   "there is a broadcast here" cue survives, the movement does not — #30/#11).
 */
export function hubPingFrame(t, phase, index, { urgent = false, reduced = false } = {}) {
  const peak = urgent ? HUB_PING_PEAK_URGENT : HUB_PING_PEAK
  if (reduced || badClock(t)) {
    // Held frame: the outermost ring parked mid-flight, dimmer for the calm case.
    return index === 0 ? { scale: 1 + HUB_PING_REACH * 0.45, opacity: peak * 0.42 } : { scale: 1, opacity: 0 }
  }
  const period = urgent ? HUB_PING_PERIOD_URGENT : HUB_PING_PERIOD
  const p = cycle(t, period, phase + index / HUB_PING_RINGS)
  return {
    scale:   1 + HUB_PING_REACH * easeOutCubic(p),
    opacity: peak * Math.pow(1 - p, 3),
  }
}

/**
 * The Hub's core: a bounded breathe on the disc plus an additive ground halo
 * that swells with it (Tier D — the "lit floor" that ties the marker to the
 * stage's own accent glow, P7). Urgency raises the halo floor so a violated Hub
 * is hotter, not just faster.
 *
 * @param {number} t loop clock (seconds)
 * @param {number} phase ∈ [0,1)
 * @param {{urgent?: boolean, reduced?: boolean}} [opts]
 * @returns {{scale: number, haloOpacity: number, haloScale: number}}
 */
export function hubCoreFrame(t, phase, { urgent = false, reduced = false } = {}) {
  const base = urgent ? 0.34 : 0.17
  if (reduced || badClock(t)) return { scale: 1, haloOpacity: base, haloScale: 1 }
  const s = livePulse(t, phase, { a1: 0.035, f1: 1.7, a2: 0.02, f2: 2.9 })
  const g = livePulse(t, phase, { a1: 0.10,  f1: 1.3, a2: 0.05, f2: 2.3 })
  return {
    scale:       1 + s,
    haloOpacity: Math.max(base + g * 0.5, 0),
    haloScale:   1 + g,
  }
}

// ── Anchor — survey datum (Tier A: "pinned, does not move") ──────────────────

export const ANCHOR_PERIOD        = 4.2
export const ANCHOR_PERIOD_URGENT = 1.0

/**
 * The Anchor's crosshair frame. Deliberately NOT a sine: a datum marker that
 * glides up and down reads as floating, the opposite of what it asserts. The
 * cycle is a long HOLD followed by a short `easeOutBack` kick that settles back
 * — a survey mark being re-seated. `tickOpacity` fades the graduation ticks in
 * with the kick so the arms appear to be re-measured (P4: the interesting moment
 * gets the detail).
 *
 * @param {number} t loop clock (seconds)
 * @param {number} phase ∈ [0,1)
 * @param {{urgent?: boolean, reduced?: boolean}} [opts]
 * @returns {{scale: number, tickOpacity: number, haloOpacity: number}}
 */
export function anchorFrame(t, phase, { urgent = false, reduced = false } = {}) {
  if (reduced || badClock(t)) return { scale: 1, tickOpacity: 0.75, haloOpacity: urgent ? 0.4 : 0.22 }
  const period = urgent ? ANCHOR_PERIOD_URGENT : ANCHOR_PERIOD
  const p = cycle(t, period, phase)
  const KICK = 0.42                        // fraction of the cycle spent moving
  const amp  = urgent ? 0.30 : 0.18
  if (p >= KICK) {
    // The hold: dead still at rest size, ticks at full contrast.
    return { scale: 1, tickOpacity: 0.9, haloOpacity: urgent ? 0.4 : 0.22 }
  }
  const k = clamp01(p / KICK)
  // Out and back within the kick: a bell built from the overshoot curve, so the
  // return is slower than the departure (follow-through, motion-language §3).
  const bell = k < 0.5 ? easeOutBack(k * 2) : easeOutCubic(1 - (k - 0.5) * 2)
  return {
    scale:       1 + amp * bell,
    tickOpacity: 0.55 + 0.35 * bell,
    haloOpacity: (urgent ? 0.4 : 0.22) * (1 + 0.5 * bell),
  }
}

// ── Zone — bounded area (Tier A rim + Tier D fill/hatch) ─────────────────────

export const ZONE_FILL_MIN     = 0.16
export const ZONE_FILL_MAX     = 0.46
export const ZONE_BREATH_CYCLE = 6.4       // seconds; selected zones breathe faster
export const ZONE_RIM_PERIOD   = 3.0
export const ZONE_RIM_RINGS    = 2
const ZONE_RIM_PEAK   = 0.42
const ZONE_RIM_REACH  = 0.11               // rim grows 1.0 → 1.11 ×

/**
 * Zone fill opacity. Built on `breathe()` (sin², zero velocity at both ends) so
 * the loop has no seam, and offset per entity so two adjacent Zones are never
 * bright at the same instant. The upper bound is lower than ADR-031 §8's 0.65:
 * with the hatch layer and the eased rim now carrying the "area" reading, a wash
 * that heavy only hid the geometry underneath (P11 抑制).
 *
 * @param {number} t loop clock (seconds)
 * @param {number} phase ∈ [0,1)
 * @param {{selected?: boolean, reduced?: boolean}} [opts]
 * @returns {{opacity: number}}
 */
export function zoneFillFrame(t, phase, { selected = false, reduced = false } = {}) {
  const lo = selected ? ZONE_FILL_MIN + 0.08 : ZONE_FILL_MIN
  if (reduced || badClock(t)) return { opacity: (lo + ZONE_FILL_MAX) * 0.5 }
  const period = selected ? ZONE_BREATH_CYCLE * 0.45 : ZONE_BREATH_CYCLE
  return { opacity: lo + breathe(cycle(t, period, phase)) * (ZONE_FILL_MAX - lo) }
}

/**
 * One outward rim pulse. `easeOutCubic` on the radius (the wave leaves the
 * boundary and slows) against a quadratic alpha tail — ADR-031 §8 ramped the
 * radius linearly, which is what made the "living aura" read as a mechanical
 * scanner.
 *
 * @param {number} t loop clock (seconds)
 * @param {number} phase ∈ [0,1)
 * @param {number} index ring index (0 … ZONE_RIM_RINGS-1)
 * @param {{period?: number, reduced?: boolean}} [opts] `period` is narrowed by
 *   the caller when a contains-link is violated (Tier F).
 * @returns {{scale: number, opacity: number}}
 */
export function zoneRimFrame(t, phase, index, { period = ZONE_RIM_PERIOD, reduced = false } = {}) {
  if (reduced || badClock(t)) {
    return index === 0 ? { scale: 1 + ZONE_RIM_REACH * 0.5, opacity: ZONE_RIM_PEAK * 0.45 } : { scale: 1, opacity: 0 }
  }
  const per = Number.isFinite(period) && period > 0 ? period : ZONE_RIM_PERIOD
  const p = cycle(t, per, phase + index / ZONE_RIM_RINGS)
  return {
    scale:   1 + ZONE_RIM_REACH * easeOutCubic(p),
    opacity: ZONE_RIM_PEAK * Math.pow(1 - p, 2),
  }
}

/** Hatch drift speed (texture units/second) — a slow crawl, never a scroll. */
const HATCH_DRIFT = 0.014

/**
 * Texture offset for the Zone's drafting hatch (Tier D). The drift is what makes
 * a filled area feel authored instead of poured, and being an offset (not an
 * opacity) it never competes with the fill's breathe for the same channel
 * (原則 #4 — one owner per visual channel).
 *
 * @param {number} t loop clock (seconds)
 * @param {number} phase ∈ [0,1)
 * @param {boolean} [reduced]
 * @returns {{u: number, v: number}} both 0 under reduced motion (static hatch —
 *   the drafting texture stays, only the crawl stops).
 */
export function hatchOffset(t, phase, reduced = false) {
  if (reduced || badClock(t)) return { u: phase, v: phase * 0.5 }
  return { u: phase + t * HATCH_DRIFT, v: phase * 0.5 + t * HATCH_DRIFT * 0.6 }
}

// ── Route — flow channel (Tier A) ────────────────────────────────────────────

export const ROUTE_HEADS      = 5    // comets per Route
export const ROUTE_TRAIL      = 3    // trail beads behind each head
export const ROUTE_INSTANCES  = ROUTE_HEADS * (1 + ROUTE_TRAIL)
const ROUTE_SPEED      = 0.20        // fraction of total length per second
const ROUTE_WOBBLE     = 0.022       // ± arc-fraction of bounded spacing wobble
const ROUTE_TRAIL_GAP  = 0.016       // arc-fraction between trail beads

/**
 * Position/size/alpha of one flow bead. `seg === 0` is the comet head; higher
 * `seg` are trail beads lagging behind it, shrinking and fading — the 余韻 (P2)
 * that a uniform dot has none of.
 *
 * The convoy is broken by a BOUNDED positional wobble, not by per-head speed
 * offsets. Differing speeds looked right for a few seconds and then failed: the
 * offsets integrate, so after half a minute every bead had drifted into one
 * clump and half the Route was empty (verified in the browser). A wobble on
 * POSITION keeps the average spacing exactly even forever while no two beads
 * ever sit at their nominal offset — the ADR-031 §8 particles were evenly spaced
 * AND identically paced, which is what read as a rotating gear rather than
 * traffic. Heads also breathe in size along the path, so a Route is never a
 * still image even when the beads happen to align.
 *
 * @param {number} t loop clock (seconds)
 * @param {number} head head index (0 … ROUTE_HEADS-1)
 * @param {number} seg 0 = head, 1..ROUTE_TRAIL = trail bead
 * @param {number} phase ∈ [0,1)
 * @param {{direction?: number, reduced?: boolean}} [opts] `direction` -1 reverses
 *   the flow (tact-time violated — the fact, Tier F).
 * @returns {{frac: number, scale: number, opacity: number}} `frac` ∈ [0,1) is the
 *   arc-length fraction along the polyline. Reduced motion parks the beads at
 *   their spawn offsets (the channel still reads as populated and directional).
 */
export function routeFlowFrame(t, head, seg, phase, { direction = 1, reduced = false } = {}) {
  const dir  = direction < 0 ? -1 : 1
  const base = (head / ROUTE_HEADS + phase) % 1
  const lag  = seg * ROUTE_TRAIL_GAP * dir
  const taper = seg === 0 ? 1 : Math.max(1 - seg / (ROUTE_TRAIL + 1), 0.15)
  if (reduced || badClock(t)) {
    const frac = ((base - lag) % 1 + 1) % 1
    return { frac, scale: taper, opacity: 0.85 * taper }
  }
  // Bounded wobble on POSITION (never integrated into the speed — see above).
  const wobble = ROUTE_WOBBLE * Math.sin(t * 0.83 + head * 2.399 + phase * Math.PI * 2)
  const frac = (((base + (t * ROUTE_SPEED + wobble) * dir - lag) % 1) + 1) % 1
  // Size breathe along the path — non-integer ratio against the travel period.
  const swell = 1 + 0.14 * Math.sin(t * 2.3 + head * 1.9 + phase * Math.PI * 2)
  return {
    frac,
    scale:   Math.max(taper * swell, 0.001),
    opacity: 0.9 * taper,
  }
}

// ── Boundary — barrier (Tier A) ──────────────────────────────────────────────

export const BOUNDARY_TICK_SPACING = 0.055  // arc-fraction between hatch ticks
const BOUNDARY_WAVE_PERIOD = 5.2            // seconds for one pass along the wall
const BOUNDARY_WAVE_WIDTH  = 0.22           // arc-fraction lit at once

/**
 * Brightness of one perpendicular hatch tick on a Boundary. A soft crest travels
 * along the wall and lifts each tick as it passes — a spatial stagger (P3) that
 * costs one number per tick and turns ADR-031 §8's explicitly static "barrier"
 * into something present without making it shout (P11). The line itself keeps
 * its slow marching dashes; the ticks are the new layer.
 *
 * @param {number} t loop clock (seconds)
 * @param {number} arcFrac tick position along the polyline ∈ [0,1]
 * @param {number} phase ∈ [0,1)
 * @param {boolean} [reduced]
 * @returns {number} intensity ∈ [0.25, 1] — never 0, so the hatch pattern (the
 *   information: "this is a barrier") is legible in every frame, including
 *   under reduced motion.
 */
export function boundaryTickFrame(t, arcFrac, phase, reduced = false) {
  const a = Number.isFinite(arcFrac) ? arcFrac : 0
  if (reduced || badClock(t)) return 0.55
  const crest = cycle(t, BOUNDARY_WAVE_PERIOD, phase)
  let d = Math.abs(a - crest)
  if (d > 0.5) d = 1 - d                     // the wall wraps: nearest crest wins
  const lit = d < BOUNDARY_WAVE_WIDTH ? easeOutCubic(1 - d / BOUNDARY_WAVE_WIDTH) : 0
  return 0.25 + 0.75 * lit
}
