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
 * colour, direction and strengths. The light pool and the key light read it
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
 * multiplies the pool and the shadow's reach per PHILOSOPHY #27).
 *
 * ADR-166 M6: this is the light that LIGHTS the scene, not only a light drawn
 * on the floor. Before M6 the bodies and the robot were lit by a white ambient
 * and a white key from front-right (`SceneView`), while the warm stage light
 * lived only in the floor pool and a weak rim — the floor said one light, the
 * bodies said another (stakeholder: "it does not look like the same space as
 * the photographed robot"; the lab comparison chose one light + real shadows).
 *   color       — the third colour of the motion identity (warm work light)
 *   from        — where the light comes FROM (high, behind-left of the default
 *                 view), so its shadows fall toward the viewer and stay
 *                 readable. Fixed in the world: orbiting the camera moves the
 *                 shadow on screen, as a real light would
 *   intensity   — the key once the light is on
 *   fill        — a weak sky/ground fill so the faces turned away from the
 *                 light are dark but not black. Weaker than the key and with no
 *                 direction of its own: a fill that out-lights the key (the
 *                 lab's environment map) lit the faces the shadow said were in
 *                 shade, and read as wrong at once
 *   shadow      — reach: half-width of the shadowed square as a fraction of
 *                 the pool; softness: PCF radius; tiers: the shadow map's
 *                 texels per device tier (`shadowMapSize` — ADR-166 M6b)
 *   pool        — the light lying on the cell floor (additive radial disc)
 */
export const STAGE_LIGHT = Object.freeze({
  color: COLOR.stageLight,
  from: Object.freeze([-0.66, -0.23, 1.2]),
  intensity: 2.8,
  fill: Object.freeze({ ground: COLOR.backdropEdge, intensity: 0.7 }),
  shadow: Object.freeze({
    reach: 0.55,
    softness: 3,
    tiers: Object.freeze({ full: Object.freeze({ mapSize: 2048 }), lite: Object.freeze({ mapSize: 1024 }) }),
  }),
  pool: Object.freeze({ radius: 10.5, opacity: 0.16 }),
})

/**
 * The key light's placement for a stage scale: a directional light shines
 * along `position − target`, so only the direction is a fact; the distance and
 * the shadow box only have to contain the cell. Everything scales with the
 * grid (PHILOSOPHY #27 — the same picture in mm and m scenes).
 *
 * @param {number} scale the stage scale (power of 10, ≥ 1)
 * @returns {{position:[number,number,number], half:number, near:number, far:number, normalBias:number}}
 */
export function keyLightPlacement(scale) {
  const s = Number.isFinite(scale) && scale >= 1 ? scale : 1
  const [x, y, z] = STAGE_LIGHT.from
  const l = Math.hypot(x, y, z)
  const half = STAGE_LIGHT.pool.radius * STAGE_LIGHT.shadow.reach * s
  const dist = 3 * half
  return {
    position: [(x / l) * dist, (y / l) * dist, (z / l) * dist],
    half,
    near: 0.05 * half,
    far: 6 * half,
    normalBias: 0.0012 * half,
  }
}

/**
 * The floor rectangle that can receive the casters' shadows (ADR-166 M6):
 * their footprint, stretched away from the light by the length of the tallest
 * shadow, plus a margin for the soft edge. The receiving floor is sized to
 * this instead of the whole cell — under software GL every receiving pixel
 * pays for the shadow lookup, and a cell-wide floor cost ~20% of the frame.
 *
 * @param {{minX:number, minY:number, maxX:number, maxY:number, maxZ:number}|null} casters
 *   world bounds of everything that casts (null = nothing casts)
 * @returns {{cx:number, cy:number, w:number, h:number}|null} null = no floor (0 casters, 0 shadows)
 */
export function shadowFloorRect(casters) {
  if (!casters || ![casters.minX, casters.minY, casters.maxX, casters.maxY, casters.maxZ].every(Number.isFinite)) return null
  const [x, y, z] = STAGE_LIGHT.from
  const height = Math.max(casters.maxZ, 0)
  // The shadow of a point at height h lands h·(x,y)/z away from it, opposite the light.
  const dx = -(x / z) * height, dy = -(y / z) * height
  let minX = casters.minX, maxX = casters.maxX, minY = casters.minY, maxY = casters.maxY
  if (dx < 0) minX += dx; else maxX += dx
  if (dy < 0) minY += dy; else maxY += dy
  const margin = 0.1 * Math.max(maxX - minX, maxY - minY, height, 1e-9)
  return {
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    w: maxX - minX + 2 * margin, h: maxY - minY + 2 * margin,
  }
}

/**
 * The device tier of the shadow (ADR-166 M6b): `lite` on a device whose
 * primary pointer is coarse (a phone or tablet — the GPUs that pay most for
 * the map's fill and memory), `full` otherwise. Decided once at boot from the
 * device, not from a measured frame rate: a quality that follows the frame
 * rate feeds its own result back into its input (原則 #24) and would make the
 * same scene look different from run to run.
 *
 * @param {{coarsePointer:boolean}} device
 * @returns {'full'|'lite'}
 */
export function shadowTier({ coarsePointer }) {
  return coarsePointer ? 'lite' : 'full'
}

/**
 * Shadow map texels for a tier. An undeclared tier throws (原則 #31 — a
 * fall-through default would hide a tier nobody decided).
 * @param {string} tier
 */
export function shadowMapSize(tier) {
  const t = Object.hasOwn(STAGE_LIGHT.shadow.tiers, tier) ? STAGE_LIGHT.shadow.tiers[tier] : null
  if (!t) throw new Error(`shadowMapSize: undeclared shadow tier "${tier}"`)
  return t.mapSize
}

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
 * One frame of the stage light: pool opacity and key intensity. Under reduced
 * motion the light is simply ON — no coming-on, no breath — the static lit
 * cell (a static styled cue, never nothing — #30).
 *
 * @param {number} tSinceStart seconds since the stage was created
 * @param {boolean} reduced
 * The fill does not come on — it is there from the first frame, so the cell is
 * readable before the work light lands (the light coming on is the key).
 *
 * @returns {{poolOpacity:number, keyIntensity:number}}
 */
export function stageLightFrame(tSinceStart, reduced) {
  if (reduced) return { poolOpacity: STAGE_LIGHT.pool.opacity, keyIntensity: STAGE_LIGHT.intensity }
  const on = lightOn(tSinceStart)
  return {
    poolOpacity: STAGE_LIGHT.pool.opacity * on * poolBreath(tSinceStart),
    keyIntensity: STAGE_LIGHT.intensity * on,
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
