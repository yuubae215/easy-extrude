/**
 * GroundShadowMath — the soft shadow a body lays on the floor (ADR-166 M4d3b,
 * the M2 leftover "実体ごとの接地影").
 *
 * WHY: with the fog gone (M2) the cell is a lit room, and in a lit room a body
 * that does not touch the floor must look like it does not. Without a shadow a
 * box resting on the floor and the same box floating 200 mm above it draw the
 * same picture from most views — the height was a fact with no pixel.
 *
 * ONE LIGHT (CLAUDE.md「モーション・アイデンティティ」— アトモスフィア): the cell is
 * lit by exactly one light, the stage light, whose pool lies on the floor from
 * above. So the shadow falls STRAIGHT DOWN, under the body (a contact shadow),
 * and is the floor's own unlit colour (`backdropEdge` — the ground with the
 * light taken away), never a new colour. The rim is a back light that only
 * separates silhouettes; it casts nothing, so it is not a second shadow source.
 *
 * SHAPE: the body's footprint — the minimum-area rectangle around its points
 * projected onto Z=0 (a rotated box keeps a rotated shadow, not its AABB) —
 * softened at the edge. As the body lifts, the shadow thins on `fade` (read as
 * a decay, (1 − x)², the same reading M4d3a gave every fading opacity) and its
 * edge spreads. Every length is proportional to the footprint, so the shadow is
 * the same picture in a mm cell and an m cell (原則 #27 — world-sized, because
 * it is part of the body).
 *
 * A flat thing (a Profile sketch, height ≈ 0) casts nothing — it has no volume
 * to stand on the floor with. A body wholly below the floor casts nothing.
 *
 * Pure and THREE-free (bare `node --test`). `GroundShadow.js` applies it.
 */

import { COLOR } from '../theme/tokens.js'
import { clamp01 } from './MotionMath.js'

/**
 * The shadow's constants, all relative to the footprint.
 *   opacity — darkness of a body resting on the floor
 *   reach   — height (× the footprint's larger side) at which the shadow is gone
 *   soft    — edge softness at rest (× the footprint's smaller side)
 *   spread  — extra softness gained by the time it is gone (× the same)
 */
export const SHADOW = Object.freeze({
  color: COLOR.backdropEdge,
  opacity: 0.5,
  reach: 1.5,
  soft: 0.12,
  spread: 0.5,
})

/** A body thinner than this (world units) is flat and casts nothing. */
const FLAT = 1e-6

/**
 * 2-D convex hull (monotone chain), counter-clockwise, no collinear points.
 * @param {Array<[number, number]>} pts
 * @returns {Array<[number, number]>}
 */
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * The footprint of a body: its points' minimum-area enclosing rectangle on the
 * floor (a hull edge is always one of its sides), plus the body's vertical
 * extent. `null` when there are no finite points.
 *
 * @param {ArrayLike<number>} xyz flat [x, y, z, x, y, z, …] (a position attribute's array)
 * @returns {{cx:number, cy:number, w:number, d:number, yaw:number, zMin:number, zMax:number}|null}
 *   `w` lies along `yaw`, `d` across it
 */
export function footprintOf(xyz) {
  /** @type {Array<[number, number]>} */
  const pts = []
  let zMin = Infinity, zMax = -Infinity
  for (let i = 0; i + 2 < xyz.length; i += 3) {
    const x = xyz[i], y = xyz[i + 1], z = xyz[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    pts.push([x, y])
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
  }
  if (pts.length === 0) return null
  const h = hull(pts)
  let best = null
  const n = h.length
  for (let i = 0; i < Math.max(n, 1); i++) {
    const a = h[i], b = h[(i + 1) % n] ?? a
    let ux = b[0] - a[0], uy = b[1] - a[1]
    const len = Math.hypot(ux, uy)
    if (len > 0) { ux /= len; uy /= len } else { ux = 1; uy = 0 }
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity
    for (const q of h) {
      const s = q[0] * ux + q[1] * uy
      const t = -q[0] * uy + q[1] * ux
      if (s < s0) s0 = s
      if (s > s1) s1 = s
      if (t < t0) t0 = t
      if (t > t1) t1 = t
    }
    const area = (s1 - s0) * (t1 - t0)
    if (!best || area < best.area - 1e-9) {
      const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2
      best = { area, cx: sc * ux - tc * uy, cy: sc * uy + tc * ux, w: s1 - s0, d: t1 - t0, yaw: Math.atan2(uy, ux) }
    }
  }
  return { cx: best.cx, cy: best.cy, w: best.w, d: best.d, yaw: best.yaw, zMin, zMax }
}

/**
 * One body's shadow on the floor.
 * @param {{w:number, d:number, zMin:number, zMax:number}|null} fp the footprint (`footprintOf`)
 * @returns {{opacity:number, soft:number}} `opacity` 0 → draw nothing; `soft`
 *   is the edge softness in world units
 */
export function groundShadowFrame(fp) {
  if (!fp || !(fp.w > 0) || !(fp.d > 0)) return { opacity: 0, soft: 0 }
  if (!(fp.zMax - fp.zMin > FLAT) || !(fp.zMax > 0)) return { opacity: 0, soft: 0 }
  const lift = Math.max(0, fp.zMin)
  const x = clamp01(lift / (SHADOW.reach * Math.max(fp.w, fp.d)))
  const minSide = Math.min(fp.w, fp.d)
  return {
    opacity: SHADOW.opacity * (1 - x) * (1 - x),
    soft: minSide * (SHADOW.soft + SHADOW.spread * x),
  }
}

/**
 * The shadow's alpha at signed distance `dist` from the footprint's edge
 * (negative inside) — the twin of the fragment shader `GroundShadow.js` builds,
 * so the falloff is testable here and not a second source of numbers.
 * Smoothstep from fully dark at `−soft` to nothing at `+soft`.
 * @param {number} dist
 * @param {number} soft
 * @returns {number} ∈ [0,1]
 */
export function shadowFalloff(dist, soft) {
  if (!(soft > 0)) return dist <= 0 ? 1 : 0
  const x = clamp01((dist + soft) / (2 * soft))
  return 1 - x * x * (3 - 2 * x)
}
