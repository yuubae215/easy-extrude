/**
 * MapVisualMath — pure per-frame derivation for the map annotation visual
 * language (ADR-093 motion, ADR-166 M3 floor light). Consumed by AnnotatedPointView / AnnotatedLineView /
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
 *   - Tier A affordance — Hub ping, Route flow, Boundary light crest, Zone rim:
 *     each asserts the place type's semantics (broadcasting junction / flow
 *     channel / barrier / bounded area). Reading the animation IS reading the
 *     classification, which is why they must never all animate identically.
 *   - Tier D delight — the entry pop and the additive halo breathe:
 *     non-propositional life. They carry no fact, so reduced motion drops them
 *     to a static styled cue.
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
import { clamp01, easeOutCubic, easeOutBack, easeOutExpo, easeInCubic, breathe } from './MotionMath.js'
import { STAGE_LIGHT } from './StageMath.js'
import { CUE_REST, SELECT_LAND, ANNOTATION_SELECTION_CUE, cueLevel, retargetCue } from './CueFollowMath.js'

// ── Floor light — the light, the view angle, the role (ADR-166 M3) ──────────
//
// ADR-093 D3 dressed the annotations as a drafting table (diagonal hatch,
// corner registration marks, graduated survey crosshair, perpendicular wall
// ticks). That device assumed a camera looking straight down; ADR-103 made Map
// a viewpoint, so the annotations live in perspective 3D next to photographed
// robots, where a hatch collapses to stripes at a glancing angle. ADR-166 M3
// retires the device: an annotation is LIGHT ON THE FLOOR, lit by the one
// stage light (`StageMath.STAGE_LIGHT`), and three numbers decide how it reads:
//   - the TINT  — the place-type colour (the fact) warmed toward the stage light
//   - the ANGLE — how far the camera looks down (`viewElevation`)
//   - the ROLE  — how loud this kind of place may be (`EMPHASIS_BY_PLACE_TYPE`)
// None of these is a function of time, so they have no reduced-motion branch:
// they are helpers, not frames (the census in `MapVisualMath.test.js` lists
// them as such).

/**
 * How far the camera looks down at the floor: |forward · +Z| ∈ [0,1]. 1 =
 * straight down (the Map viewpoint), → 0 = skimming the floor. Takes the
 * forward vector's Z only, so the caller can read it from the camera's world
 * matrix without allocating (`Math.abs(camera.matrixWorld.elements[10])` — the
 * camera's local +Z axis is −forward, and the sign is discarded here).
 * Non-finite → 1: a broken camera must not hide the floor light (#11).
 *
 * @param {number} forwardZ world-Z component of the camera's view direction
 * @returns {number} elevation ∈ [0,1]
 */
export function viewElevation(forwardZ) {
  if (!Number.isFinite(forwardZ)) return 1
  return clamp01(Math.abs(forwardZ))
}

/** Floor-light gains at the two extremes of the view angle. */
export const FLOOR_LIGHT = Object.freeze({
  floorMin:   0.35,   // the floor pool seen edge-on — dimmed, never gone
  curtainMin: 0.15,   // the light curtain seen from straight above (edge-on)
})

/**
 * How much of the reading the floor pool and the light curtain each carry at
 * this view angle. They are complementary by construction: the floor pool
 * compresses as the camera drops (a decal seen edge-on), the curtain stands up
 * into view; their sum never falls below 1, so the CLASSIFICATION is legible
 * from every angle — the property the Blueprint hatch lacked (ADR-166 Goal).
 *
 * @param {number} elevation ∈ [0,1] from `viewElevation` (non-finite → 1)
 * @returns {{floor: number, curtain: number}} both ∈ (0,1]
 */
export function floorLightGains(elevation) {
  const e = Number.isFinite(elevation) ? clamp01(elevation) : 1
  return {
    floor:   FLOOR_LIGHT.floorMin   + (1 - FLOOR_LIGHT.floorMin)   * e,
    curtain: FLOOR_LIGHT.curtainMin + (1 - FLOOR_LIGHT.curtainMin) * (1 - e),
  }
}

/**
 * How loud each kind of place may be — the ROLE, not the area. A Zone is used
 * as "the floor of the cell" (templates), so it is the biggest thing on screen
 * and must be the quietest: it is GROUND. Every other kind is a MARK.
 *
 * Undeclared kinds THROW (PHILOSOPHY #31 — a fall-through default would make
 * "a declared emphasis" and "a kind nobody thought about" indistinguishable;
 * same shape as `PLACEMENT_BY_KIND`). Unclassified annotations are a declared
 * row, keyed `unclassified`.
 */
export const EMPHASIS_BY_PLACE_TYPE = Object.freeze({
  Zone:         'ground',
  Route:        'mark',
  Boundary:     'mark',
  Hub:          'mark',
  Anchor:       'mark',
  unclassified: 'mark',
})

/** Gain per emphasis tier, and the two modifiers that override it. */
export const EMPHASIS_GAIN = Object.freeze({
  ground:   0.5,
  mark:     1.0,
  selected: 1.4,    // × the tier gain
  urgent:   1.6,    // absolute — a violation outranks every role (Tier F)
})

/**
 * Light gain for one annotation: its role, raised by selection, overridden by
 * a violation. Urgent is ABSOLUTE and above every non-urgent value, so a
 * violated Zone (ground) still outshines a selected Hub (mark) — the fact
 * outranks the role.
 *
 * @param {string|null} placeType registry name, or null for unclassified
 * @param {{selected?: boolean, urgent?: boolean}} [mods]
 * @returns {number}
 * @throws {Error} for a place type with no declared emphasis
 */
export function emphasisFor(placeType, { selected = false, urgent = false } = {}) {
  const key = placeType ?? 'unclassified'
  const tier = Object.hasOwn(EMPHASIS_BY_PLACE_TYPE, key) ? EMPHASIS_BY_PLACE_TYPE[key] : undefined
  if (!tier) {
    throw new Error(`MapVisualMath: no emphasis declared for place type "${key}" — add a row to EMPHASIS_BY_PLACE_TYPE`)
  }
  if (urgent) return EMPHASIS_GAIN.urgent
  const g = EMPHASIS_GAIN[tier]
  return selected ? g * EMPHASIS_GAIN.selected : g
}

/** How far the light's core is warmed from the type colour toward the stage light. */
export const LIGHT_WARMTH = 0.3

/**
 * The colour of an annotation's light: the place-type colour (the fact — the
 * hue must still say Zone / Route / …) mixed `LIGHT_WARMTH` of the way toward
 * the ONE stage light. This is what makes the annotations lit by the same
 * light as the cell floor instead of glowing in their own private colour
 * (ADR-166 M2 — "光源はちょうど 1 つ").
 *
 * @param {number} typeHex 0xRRGGBB
 * @param {number} [k] mix ∈ [0,1] (0 = the type colour, 1 = the stage light)
 * @returns {number} 0xRRGGBB
 */
export function lightTint(typeHex, k = LIGHT_WARMTH) {
  const light = parseInt(STAGE_LIGHT.color.slice(1), 16)
  const w = Number.isFinite(k) ? clamp01(k) : LIGHT_WARMTH
  const h = Number.isFinite(typeHex) ? typeHex : 0
  let out = 0
  for (const shift of [16, 8, 0]) {
    const a = (h >> shift) & 0xff
    const b = (light >> shift) & 0xff
    out |= Math.round(a + (b - a) * w) << shift
  }
  return out
}

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

// ── Lifecycle — entering / idle / exiting / hidden (ADR-166 M3b) ────────────
//
// Before M3b one field answered two questions. `visible` meant both "this
// annotation exists for the user (pickable, counted)" and "its meshes are
// drawn", so a soft delete could only blink the light off — there was no
// frame in which the annotation was gone logically but still leaving visually
// (P9: an entrance with no matching exit). The record below splits the two:
// `present` is the logical fact (the view's `visible` getter, read by
// hit-testing), and the DRAWN state is derived from the phase. The state
// machine is drawn in STATE_TRANSITIONS §Map annotation motion; the reducers
// here are the only writers, and the views hold the record.
//
// Clocks: the setters (`setVisible`) have no clock, so a hide ARMS the exit
// (`exitPending`) and the view's next tick stamps it (`lifecycleStamp`) — the
// same "first tick stamps the time" shape as the entry pop's `bornAt`.

/** Exit length (seconds) — the light going out; inside the ≤ 300 ms band. */
export const EXIT_FADE = 0.22
/** How far the light contracts while it goes out (scale at the end of the exit). */
export const EXIT_SHRINK = 0.85

/** The four phases, in lifecycle order. */
export const LIFECYCLE_PHASES = Object.freeze(['entering', 'idle', 'exiting', 'hidden'])

/**
 * What each phase means to the rest of the app — declared per phase, and an
 * undeclared phase THROWS (PHILOSOPHY #31: the exit is exactly the phase a
 * fall-through default would have quietly made pickable).
 *   pickable — hit-testing may return it (the logical fact)
 *   drawn    — its meshes are on screen
 */
export const PHASE_TRAITS = Object.freeze({
  entering: Object.freeze({ pickable: true,  drawn: true }),
  idle:     Object.freeze({ pickable: true,  drawn: true }),
  exiting:  Object.freeze({ pickable: false, drawn: true }),
  hidden:   Object.freeze({ pickable: false, drawn: false }),
})

/**
 * @param {string} phase one of `LIFECYCLE_PHASES`
 * @returns {{pickable: boolean, drawn: boolean}}
 * @throws {Error} for an undeclared phase
 */
export function phaseTraits(phase) {
  const tr = Object.hasOwn(PHASE_TRAITS, phase) ? PHASE_TRAITS[phase] : undefined
  if (!tr) throw new Error(`MapVisualMath: no traits declared for lifecycle phase "${phase}"`)
  return tr
}

/**
 * @typedef {{present: boolean, bornAt: number|null, exitAt: number|null, exitPending: boolean}} Lifecycle
 */

/** A freshly constructed annotation: present, its entry not yet stamped. */
export const INITIAL_LIFECYCLE = Object.freeze({ present: true, bornAt: null, exitAt: null, exitPending: false })

/**
 * `setVisible(true)`. Already present → unchanged: re-showing something that
 * is on screen is not a boundary moment, so it must not re-pop (the context
 * overlays call setVisible(true) on every entity on the way out). Hidden or
 * exiting → a fresh entry (an undo mid-exit restarts the entry — one path,
 * not a reversal; ADR-166 M3b).
 * @param {Lifecycle} life
 * @returns {Lifecycle}
 */
export function lifecycleShow(life) {
  if (life?.present) return life
  return { present: true, bornAt: null, exitAt: null, exitPending: false }
}

/**
 * `setVisible(false)`. An annotation that was SEEN (its entry was stamped)
 * arms its exit; one that never reached a frame hides at once — there is no
 * light on screen to put out.
 * @param {Lifecycle} life
 * @returns {Lifecycle}
 */
export function lifecycleHide(life) {
  if (!life?.present) return life
  const seen = life.bornAt !== null
  return { present: false, bornAt: life.bornAt, exitAt: null, exitPending: seen }
}

/**
 * The tick's clock stamp: the first tick of a present annotation stamps its
 * entry, the first tick after a hide stamps its exit. Unchanged otherwise (the
 * same object comes back — no per-frame allocation).
 * @param {Lifecycle} life
 * @param {number} t loop clock (seconds)
 * @returns {Lifecycle}
 */
export function lifecycleStamp(life, t) {
  if (!Number.isFinite(t)) return life
  if (life.present && life.bornAt === null) return { ...life, bornAt: t }
  if (!life.present && life.exitPending) return { ...life, exitAt: t, exitPending: false }
  return life
}

/**
 * The phase at clock `t`. Reduced motion has no in-between phases: an entry
 * is already idle, an exit is already hidden (the information — present or
 * gone — is kept; only the movement between them is dropped, #30). A
 * malformed clock lands on the settled phase of the same side (#11).
 * @param {number} t loop clock (seconds)
 * @param {Lifecycle} life
 * @param {boolean} [reduced]
 * @returns {'entering'|'idle'|'exiting'|'hidden'}
 */
export function lifecyclePhase(t, life, reduced = false) {
  if (life.present) {
    if (reduced) return 'idle'
    if (life.bornAt === null) return 'entering'
    if (badClock(t) || badClock(life.bornAt)) return 'idle'
    const e = t - life.bornAt
    return e >= 0 && e < ENTRY_POP ? 'entering' : 'idle'
  }
  if (life.exitPending) return reduced ? 'hidden' : 'exiting'
  if (reduced || life.exitAt === null || badClock(t) || badClock(life.exitAt)) return 'hidden'
  // A clock that steps BACK past the stamp is the start of the exit, not its
  // end: treating e < 0 as "over" skipped the exit outright under Playwright's
  // fake clock (found recording the M3 clip — performance.now went 8150 → 8148
  // between two frames). The envelope clamps the progress to 0 to match.
  return t - life.exitAt < EXIT_FADE ? 'exiting' : 'hidden'
}

/**
 * The scale/opacity envelope every part of an annotation rides: the entry pop
 * while entering, identity while idle, the light going out while exiting. The
 * exit runs on the motion identity's `exit` curve (inCubic): the light lingers
 * for a beat, then goes — and contracts slightly as it does, so it reads as a
 * light being put out rather than a sticker being peeled.
 *
 * @param {number} t loop clock (seconds)
 * @param {Lifecycle} life
 * @param {boolean} [reduced]
 * @returns {{scale: number, opacity: number}}
 */
export function lifecycleEnvelope(t, life, reduced = false) {
  const phase = lifecyclePhase(t, life, reduced)
  if (phase === 'entering') return life.bornAt === null ? { scale: 0.001, opacity: 0 } : entryFrame(t, life.bornAt, reduced)
  if (phase === 'idle') return { scale: 1, opacity: 1 }
  if (phase === 'hidden') return { scale: EXIT_SHRINK, opacity: 0 }
  const p = life.exitAt === null ? 0 : clamp01((t - life.exitAt) / EXIT_FADE)
  const k = easeInCubic(p)
  return { scale: 1 - (1 - EXIT_SHRINK) * k, opacity: 1 - k }
}

// ── Selection — the light rises and lands (ADR-166 M3b) ─────────────────────
//
// The white BoxHelper was a second way of saying "selected" that belonged to
// no visual language here (a wireframe box around light on the floor). M3b
// retires it: selection is the role's light rising to `EMPHASIS_GAIN.selected`
// and the pool growing to `SELECT_GROW`, on the motion identity's `land` curve
// (outExpo). The level is a segment — where the light was when the request
// changed, plus the target — so a reversal mid-flight continues from the light
// on screen instead of jumping (#24: the segment start is a snapshot taken at
// the change, never re-read from the frame it produced).

/**
 * Selection landing length (seconds). The source is `CueFollowMath` (ADR-166
 * M4a moved the segment there so the cube and the annotations land together);
 * re-exported under the name M3b gave it.
 */
export { SELECT_LAND }
/** How much the floor light grows when selected (× its resting size). */
export const SELECT_GROW = 1.15

/**
 * @typedef {import('./CueFollowMath.js').CueSegment} SelectionSegment
 */

/** Not selected, settled. */
export const UNSELECTED = CUE_REST

/**
 * Selection level ∈ [0,1] at clock `t` (0 = resting, 1 = fully selected).
 * Reduced motion and malformed clocks land on the target at once.
 * An adapter over `cueLevel` with the annotations' profile.
 * @param {number} t loop clock (seconds)
 * @param {SelectionSegment} seg
 * @param {boolean} [reduced]
 * @returns {number}
 */
export function selectionLevel(t, seg, reduced = false) {
  return cueLevel(t, seg, ANNOTATION_SELECTION_CUE, reduced)
}

/**
 * A selection request at clock `t`. The SAME request again returns the same
 * segment (no restart — a re-selection must not replay the landing). A changed
 * request starts a new segment from the level on screen right now.
 * @param {number} t loop clock (seconds)
 * @param {SelectionSegment} seg current segment
 * @param {boolean} selected requested state
 * @param {boolean} [reduced]
 * @returns {SelectionSegment}
 */
export function retargetSelection(t, seg, selected, reduced = false) {
  return retargetCue(t, seg, selected ? 1 : 0, ANNOTATION_SELECTION_CUE, reduced)
}

/**
 * The role's light gain at a selection level: the resting gain blended toward
 * the selected gain. A violation is absolute at every level (Tier F outranks
 * every role and every selection — `emphasisFor`).
 * @param {string|null} placeType
 * @param {number} level ∈ [0,1] from `selectionLevel`
 * @param {{urgent?: boolean}} [mods]
 * @returns {number}
 */
export function selectedEmphasis(placeType, level, { urgent = false } = {}) {
  const lo = emphasisFor(placeType, { urgent })
  const hi = emphasisFor(placeType, { selected: true, urgent })
  return lo + (hi - lo) * clamp01(level)
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
 * — a datum being re-seated, its tight spot of light flaring with the kick
 * (P4: the interesting moment gets the detail). ADR-166 M3 retired the
 * graduation ticks and the 45° datum square this kick used to fade in; the
 * hold-and-kick rhythm, which is what says "pinned", stays.
 *
 * @param {number} t loop clock (seconds)
 * @param {number} phase ∈ [0,1)
 * @param {{urgent?: boolean, reduced?: boolean}} [opts]
 * @returns {{scale: number, haloOpacity: number}}
 */
export function anchorFrame(t, phase, { urgent = false, reduced = false } = {}) {
  if (reduced || badClock(t)) return { scale: 1, haloOpacity: urgent ? 0.4 : 0.22 }
  const period = urgent ? ANCHOR_PERIOD_URGENT : ANCHOR_PERIOD
  const p = cycle(t, period, phase)
  const KICK = 0.42                        // fraction of the cycle spent moving
  const amp  = urgent ? 0.30 : 0.18
  if (p >= KICK) {
    // The hold: dead still at rest size.
    return { scale: 1, haloOpacity: urgent ? 0.4 : 0.22 }
  }
  const k = clamp01(p / KICK)
  // Out and back within the kick: a bell built from the overshoot curve, so the
  // return is slower than the departure (follow-through, motion-language §3).
  const bell = k < 0.5 ? easeOutBack(k * 2) : easeOutCubic(1 - (k - 0.5) * 2)
  return {
    scale:       1 + amp * bell,
    haloOpacity: (urgent ? 0.4 : 0.22) * (1 + 0.5 * bell),
  }
}

// ── Zone — bounded area (Tier A rim + Tier D floor light) ─────────────────────

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
 * a wash that heavy only hid the geometry underneath (P11 抑制). Since ADR-166
 * M3 this is the BREATH of the floor light — the view scales it by the role
 * (`emphasisFor`) and the view angle (`floorLightGains`).
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

const BOUNDARY_WAVE_PERIOD = 5.2            // seconds for one pass along the wall
const BOUNDARY_WAVE_WIDTH  = 0.22           // arc-fraction lit at once

/**
 * Brightness of the Boundary's light wall at one point along it. A soft crest
 * travels along the wall and lifts the light as it passes — a spatial stagger
 * (P3) that turns ADR-031 §8's explicitly static "barrier" into something
 * present without making it shout (P11). ADR-093 D4 drew this on perpendicular
 * hatch ticks; ADR-166 M3 retired the ticks (a drafting device) and the crest
 * now runs along the light curtain standing on the wall. The line itself keeps
 * its slow marching dashes.
 *
 * @param {number} t loop clock (seconds)
 * @param {number} arcFrac position along the polyline ∈ [0,1]
 * @param {number} phase ∈ [0,1)
 * @param {boolean} [reduced]
 * @returns {number} intensity ∈ [0.25, 1] — never 0, so the wall (the
 *   information: "this is a barrier") is legible in every frame, including
 *   under reduced motion.
 */
export function boundaryLightFrame(t, arcFrac, phase, reduced = false) {
  const a = Number.isFinite(arcFrac) ? arcFrac : 0
  if (reduced || badClock(t)) return 0.55
  const crest = cycle(t, BOUNDARY_WAVE_PERIOD, phase)
  let d = Math.abs(a - crest)
  if (d > 0.5) d = 1 - d                     // the wall wraps: nearest crest wins
  const lit = d < BOUNDARY_WAVE_WIDTH ? easeOutCubic(1 - d / BOUNDARY_WAVE_WIDTH) : 0
  return 0.25 + 0.75 * lit
}
