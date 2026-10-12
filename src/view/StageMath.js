/**
 * StageMath — pure arithmetic for the viewport stage: the ONE stage light, the
 * radial work-cell backdrop, the light coming on as the boot flight lands, the
 * idle breath of the light pool, and the boot-reveal camera flight.
 *
 * ATMOSPHERE (ADR-166 M2 — the "アトモスフィア" axis of the motion identity in
 * CLAUDE.md): a Studio-type work cell. No fog, no dust. The ground is a radial
 * backdrop that is brightest where the work is, and a soft pool of warm light
 * lies on the cell floor under the grid. This replaced ADR-067's Void Grid
 * (vertical navy sky + FogExp2 + two dust layers), which the animation-fx
 * skill retired as the thoughtless default and which put the photographed
 * robots (ADR-149) in a sci-fi void instead of a room.
 *
 * ONE LIGHT (§1.1): `STAGE_LIGHT` is the single source of the stage light's
 * colour, direction and strengths. The light pool and the rim light read it
 * here, and the floor-light annotations of ADR-166 M3 will read it from here
 * too — nothing else reads `COLOR.stageLight` (`StageMath.test.js` counts).
 *
 * Pure and THREE-free (bare `node --test` lane): every function maps numbers
 * to numbers/records — `SceneStage`/`BootReveal` apply the results,
 * `AppController._animate` owns the clock. Deterministic (no Math.random): a
 * reloaded stage looks identical, and the unit lane can pin exact values.
 */
import { COLOR, DURATION } from '../theme/tokens.js'
import { clamp01, easeOutCubic, easeOutExpo } from './MotionMath.js'

/**
 * The one stage light (world units at grid scale 1 — `SceneStage.setScale`
 * multiplies the pool per PHILOSOPHY #27).
 *   color        — the third colour of the motion identity (warm work light)
 *   rimFrom      — where the rim light comes FROM (high, behind-left): it
 *                  separates MeshStandardMaterial bodies from the dark ground
 *   rimIntensity — DirectionalLight intensity once the light is on
 *   pool         — the light lying on the cell floor (additive radial disc)
 */
export const STAGE_LIGHT = Object.freeze({
  color: COLOR.stageLight,
  rimFrom: Object.freeze([-6, 5, 3]),
  rimIntensity: 0.45,
  pool: Object.freeze({ radius: 10.5, opacity: 0.16 }),
})

/**
 * Radial backdrop stops `[at, colour]`, centre → edge. The centre sits a
 * little above the middle of the frame, where the default camera puts the
 * cell — the ground is lit where the work is.
 */
export const BACKDROP = Object.freeze({
  center: Object.freeze([0.5, 0.42]),
  stops: Object.freeze([
    Object.freeze([0, COLOR.backdropCenter]),
    Object.freeze([1, COLOR.backdropEdge]),
  ]),
})

/**
 * The ground grid fades into the floor away from the light (ADR-166 M2). The
 * Void Grid's fog used to swallow the grid's far edge; with the fog gone the
 * edge would run sharp to the horizon, so the grid now carries its own
 * falloff — fully drawn inside `inner`, gone by `outer`, both as fractions of
 * the grid's half-span in the grid's LOCAL units (so it rides the
 * power-of-10 grid scale for free — PHILOSOPHY #27). The square's corners lie
 * beyond `outer`: the visible grid is a disc, like light on a floor.
 */
export const GRID_FADE = Object.freeze({ inner: 0.35, outer: 1.0 })

/**
 * Grid line alpha multiplier at local radius `r` (smoothstep — the same curve
 * the grid shader evaluates; `SceneView._setupGrid` builds the GLSL from
 * `GRID_FADE`, so this is its testable twin, not a second source of numbers).
 *
 * @param {number} r local radius from the grid centre
 * @param {number} halfSpan the grid's local half-span
 * @returns {number} ∈ [0,1]
 */
export function gridFade(r, halfSpan) {
  if (!Number.isFinite(r) || !(halfSpan > 0)) return 1
  const a = GRID_FADE.inner * halfSpan
  const b = GRID_FADE.outer * halfSpan
  const x = clamp01((Math.abs(r) - a) / (b - a))
  return 1 - x * x * (3 - 2 * x)
}

/**
 * Stage timing.
 *   lightOn — the light comes on as the boot flight LANDS (the boundary of the
 *             one opening occasion — quality gate 3), derived from the flight's
 *             own duration so the two cannot drift apart: it starts at 60% of
 *             the flight (where the expo dolly has all but arrived) and
 *             finishes on outExpo within the macro band.
 *   breath  — the idle life of the pool (quality gate 5): a slow inOutSine
 *             swell, shallow enough to read as a lit room, not a pulse.
 */
export const STAGE = Object.freeze({
  lightOn: Object.freeze({ delay: (DURATION.bootReveal / 1000) * 0.6, seconds: 0.9 }),
  breath: Object.freeze({ period: 6.0, depth: 0.06 }),
  /** Boot flight start pose relative to the final camera pose. */
  flight: Object.freeze({ dolly: 1.7, orbit: -0.55, lift: 0.45 }),
})

/**
 * How far the stage light is on, `tSinceStart` seconds after the stage was
 * created: 0 before `lightOn.delay`, exactly 1 after `delay + seconds`,
 * monotone (outExpo) in between. Malformed time → 1 (a broken clock must not
 * leave the room dark — #11 as honest presence).
 *
 * @param {number} tSinceStart
 * @returns {number} ∈ [0,1]
 */
export function lightOn(tSinceStart) {
  if (!Number.isFinite(tSinceStart)) return 1
  const { delay, seconds } = STAGE.lightOn
  if (tSinceStart >= delay + seconds) return 1 // exactly on — no float residue at the landing
  return easeOutExpo(clamp01((tSinceStart - delay) / seconds))
}

/**
 * The pool's idle breath as an opacity multiplier: 1 at rest, dipping to
 * `1 − depth` and back once per `period` along an inOutSine (the cosine
 * cycle). Malformed time → 1.
 *
 * @param {number} t seconds
 * @returns {number} ∈ [1 − depth, 1]
 */
export function poolBreath(t) {
  if (!Number.isFinite(t)) return 1
  const { period, depth } = STAGE.breath
  return 1 - depth * (1 - Math.cos((2 * Math.PI * t) / period)) / 2
}

/**
 * One frame of the stage light: pool opacity and rim intensity. Under reduced
 * motion the light is simply ON — no coming-on, no breath — the static lit
 * cell (a static styled cue, never nothing — #30).
 *
 * @param {number} tSinceStart seconds since the stage was created
 * @param {boolean} reduced
 * @returns {{poolOpacity:number, rimIntensity:number}}
 */
export function stageLightFrame(tSinceStart, reduced) {
  if (reduced) return { poolOpacity: STAGE_LIGHT.pool.opacity, rimIntensity: STAGE_LIGHT.rimIntensity }
  const on = lightOn(tSinceStart)
  return {
    poolOpacity: STAGE_LIGHT.pool.opacity * on * poolBreath(tSinceStart),
    rimIntensity: STAGE_LIGHT.rimIntensity * on,
  }
}

/**
 * One frame of the boot-reveal camera flight: progress → offsets that are all
 * ZERO at p ≥ 1, so the flight lands exactly on the untouched default camera
 * pose (the stage never owns the final pose — it only approaches it).
 * Attributes ease on different curves (dolly races in on expo, the orbital
 * swing and descent settle on cubic) so the approach feels composed, not
 * tweened (anti-vanilla gate 1: per-attribute easing).
 *
 * @param {number} p flight progress ∈ [0,1] (clamped; NaN → 0 = start pose)
 * @returns {{dolly:number, orbit:number, lift:number}}
 *   dolly: extra distance as a fraction of the final offset (0 = final)
 *   orbit: yaw around world +Z in radians (0 = final)
 *   lift:  extra height as a fraction of the final offset length (0 = final)
 */
export function flightFrame(p) {
  const t = clamp01(p)
  // `+ 0` normalises the -0 that a negative constant × 0 would produce at p=1.
  return {
    dolly: STAGE.flight.dolly * (1 - easeOutExpo(t)) + 0,
    orbit: STAGE.flight.orbit * (1 - easeOutCubic(t)) + 0,
    lift:  STAGE.flight.lift  * (1 - easeOutCubic(t)) + 0,
  }
}
