/**
 * StageMath — pure arithmetic for the viewport stage: ambient dust drift,
 * fog depth scaling, dust-layer entry envelope, and the boot-reveal camera
 * flight (ADR-067, the first Tier D "delight" application after ADR-066).
 *
 * Pure and THREE-free (bare `node --test` lane): every function maps numbers
 * to numbers/records — `SceneStage`/`BootReveal` apply the results as
 * positions/opacity/camera params, `AppController._animate` owns the clock.
 * Everything is DETERMINISTIC (no Math.random — same discipline as
 * `CommandFeedbackMath`): a reloaded stage looks identical, and the unit lane
 * can pin exact values.
 */
import { clamp01, easeOutCubic, easeOutExpo } from './MotionMath.js'

/**
 * Stage constants (world units at grid scale 1 — the default 20-unit grid;
 * `SceneStage.setScale` multiplies the whole stage per PHILOSOPHY #27).
 * Two dust layers with different size/speed/opacity give cheap parallax and
 * break lockstep (anti-vanilla gate: no mass-synchronised motion).
 */
export const STAGE = Object.freeze({
  dust: Object.freeze([
    // near layer: fewer, larger, brighter, faster
    Object.freeze({ count: 48, radius: 9.5,  height: 3.4, size: 0.10, opacity: 0.42, drift: 1.0,  entryDelay: 0.0 }),
    // far layer: more, smaller, dimmer, slower
    Object.freeze({ count: 84, radius: 13.0, height: 5.2, size: 0.055, opacity: 0.26, drift: 0.6, entryDelay: 0.7 }),
  ]),
  /** FogExp2 density at grid scale 1 — ≈20% attenuation at the grid edge. */
  fogDensity: 0.024,
  /** Dust fade-in window after boot (seconds, before per-layer entryDelay). */
  entrySeconds: 2.2,
  /** Boot flight start pose relative to the final camera pose. */
  flight: Object.freeze({ dolly: 1.7, orbit: -0.55, lift: 0.45 }),
})

/**
 * Deterministic pseudo-random in [0,1) from an integer index — the golden /
 * plastic-ratio lattice idiom shared with `CommandFeedbackMath.voxelJitter`.
 * Two salts give two independent-looking sequences from one index.
 * @param {number} index
 * @param {number} [salt]
 * @returns {number}
 */
export function hash01(index, salt = 0) {
  const x = index * 0.6180339887 + salt * 0.7548776662 + 0.1127
  return x - Math.floor(x)
}

/**
 * Lay out one dust layer: a deterministic disc of particles above the ground
 * plane (Z up). Radial positions use a sqrt-distributed golden-angle spiral
 * (even disc fill, no clumping, no Math.random); each particle carries its own
 * phase/rate so the layer never moves in lockstep (anti-vanilla gate 2).
 *
 * @param {{count:number, radius:number, height:number, drift:number}} layer
 * @returns {Array<{x:number, y:number, z:number, phase:number, rate:number, amp:number}>}
 */
export function dustField(layer) {
  const pts = []
  const GA = Math.PI * (3 - Math.sqrt(5)) // golden angle
  for (let i = 0; i < layer.count; i++) {
    const r = layer.radius * Math.sqrt((i + 0.5) / layer.count)
    const a = i * GA + hash01(i, 3) * 0.7
    pts.push({
      x: r * Math.cos(a),
      y: r * Math.sin(a),
      z: 0.15 + hash01(i, 1) * layer.height,
      phase: hash01(i, 2) * Math.PI * 2,
      rate: layer.drift * (0.6 + 0.8 * hash01(i, 4)),
      amp: 0.25 + 0.55 * hash01(i, 5),
    })
  }
  return pts
}

/**
 * Drift offset of one dust particle at time `t` (seconds). Two incommensurate
 * frequencies per axis kill the loop feel (motion-language §4 — organic idle);
 * vertical bob dominates, lateral drift stays subtle so dust reads as
 * suspended atmosphere, not weather. Bounded by ±1.6·amp per axis.
 *
 * @param {number} t seconds (any real; NaN → 0 offset)
 * @param {{phase:number, rate:number, amp:number}} p from `dustField`
 * @returns {{dx:number, dy:number, dz:number}}
 */
export function dustDrift(t, p) {
  if (!Number.isFinite(t)) return { dx: 0, dy: 0, dz: 0 }
  const w = t * p.rate
  return {
    dx: (Math.sin(w * 0.23 + p.phase) + 0.5 * Math.sin(w * 0.61 + p.phase * 2.3)) * p.amp * 0.5,
    dy: (Math.cos(w * 0.19 + p.phase * 1.7) + 0.5 * Math.sin(w * 0.53 + p.phase)) * p.amp * 0.5,
    dz: (Math.sin(w * 0.31 + p.phase) + 0.4 * Math.sin(w * 0.83 + p.phase * 3.1)) * p.amp,
  }
}

/**
 * Dust-layer entry envelope: opacity multiplier for the fade-in after boot.
 * Layers arrive staggered (`entryDelay`), easing out — the stage breathes in
 * rather than popping on. 0 before the layer's window opens, exactly 1 after
 * `entrySeconds`, monotone in between. Malformed time → 1 (settled stage —
 * a broken clock must not hide the dust, #11 as honest presence).
 *
 * @param {number} tSinceStart seconds since the stage was created
 * @param {number} entryDelay per-layer stagger delay (seconds)
 * @returns {number} ∈ [0,1]
 */
export function entryEnvelope(tSinceStart, entryDelay) {
  if (!Number.isFinite(tSinceStart)) return 1
  return easeOutCubic((tSinceStart - entryDelay) / STAGE.entrySeconds)
}

/**
 * FogExp2 density for a stage scale factor (the ground-grid power-of-10 scale
 * from `SceneView._updateGridScale`). Density scales inversely with world
 * size so the *relative* depth fade is identical in m-scale and mm-scale
 * scenes (PHILOSOPHY #27). Malformed/zero scale → the scale-1 density.
 *
 * @param {number} scale ≥ 1
 * @returns {number}
 */
export function fogDensityFor(scale) {
  const s = Number.isFinite(scale) && scale >= 1 ? scale : 1
  return STAGE.fogDensity / s
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
