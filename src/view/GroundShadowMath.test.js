/**
 * GroundShadowMath — a body's contact shadow on the floor (ADR-166 M4d3b).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHADOW, footprintOf, groundShadowFrame, shadowFalloff } from './GroundShadowMath.js'
import { COLOR } from '../theme/tokens.js'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

/** 8 corners of a box w × d × h, rotated by `yaw` about Z, lifted to `z0`. */
function box(w, d, h, { yaw = 0, z0 = 0, cx = 0, cy = 0 } = {}) {
  const out = []
  const c = Math.cos(yaw), s = Math.sin(yaw)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [z0, z0 + h]) {
    const x = sx * w / 2, y = sy * d / 2
    out.push(cx + x * c - y * s, cy + x * s + y * c, z)
  }
  return out
}

test('the shadow is the floor with the light taken away — no new colour', () => {
  assert.equal(SHADOW.color, COLOR.backdropEdge)
})

test('footprint of an axis-aligned box', () => {
  const fp = footprintOf(box(400, 200, 300, { cx: 50, cy: -30 }))
  assert.ok(close(fp.cx, 50, 1e-6) && close(fp.cy, -30, 1e-6))
  assert.ok(close(Math.max(fp.w, fp.d), 400, 1e-6) && close(Math.min(fp.w, fp.d), 200, 1e-6))
  assert.equal(fp.zMin, 0); assert.equal(fp.zMax, 300)
})

test('a rotated box keeps a rotated footprint, not its larger AABB', () => {
  const fp = footprintOf(box(400, 200, 100, { yaw: Math.PI / 6 }))
  assert.ok(close(fp.w * fp.d, 400 * 200, 1e-6), `area ${fp.w * fp.d}`)
  // The footprint's long side lies along the box's long side (mod π/2 for which side is w).
  const long = fp.w >= fp.d ? fp.yaw : fp.yaw + Math.PI / 2
  const diff = Math.abs(Math.sin(long - Math.PI / 6))
  assert.ok(diff < 1e-6, `yaw ${fp.yaw}`)
})

test('duplicated vertices (a position attribute) do not change the footprint', () => {
  const b = box(100, 100, 100)
  assert.deepEqual(footprintOf([...b, ...b]), footprintOf(b))
})

test('no finite points → no footprint → no shadow', () => {
  assert.equal(footprintOf([]), null)
  assert.equal(groundShadowFrame(null).opacity, 0)
})

test('resting on the floor: full darkness, base softness', () => {
  const f = groundShadowFrame(footprintOf(box(400, 200, 300)))
  assert.equal(f.opacity, SHADOW.opacity)
  assert.ok(close(f.soft, 200 * SHADOW.soft))
})

test('lifting thins the shadow on `fade` (decay (1 − x)²) and spreads its edge', () => {
  const reach = SHADOW.reach * 400
  const half = groundShadowFrame(footprintOf(box(400, 200, 300, { z0: reach / 2 })))
  // (1 − ½)² = 0.25 — a linear decay would be 0.5.
  assert.ok(close(half.opacity, SHADOW.opacity * 0.25), `opacity ${half.opacity}`)
  assert.ok(half.soft > 200 * SHADOW.soft)
  assert.equal(groundShadowFrame(footprintOf(box(400, 200, 300, { z0: reach }))).opacity, 0)
})

test('the same picture in a mm cell and an m cell (原則 #27)', () => {
  const mm = groundShadowFrame(footprintOf(box(400, 200, 300, { z0: 150 })))
  const m = groundShadowFrame(footprintOf(box(0.4, 0.2, 0.3, { z0: 0.15 })))
  assert.ok(close(mm.opacity, m.opacity, 1e-9))
  assert.ok(close(mm.soft / 1000, m.soft, 1e-12))
})

test('a flat sketch casts nothing; a body below the floor casts nothing', () => {
  assert.equal(groundShadowFrame(footprintOf(box(400, 200, 0))).opacity, 0)
  assert.equal(groundShadowFrame(footprintOf(box(400, 200, 100, { z0: -300 }))).opacity, 0)
})

test('a body sunk partly into the floor rests on it', () => {
  assert.equal(groundShadowFrame(footprintOf(box(400, 200, 300, { z0: -100 }))).opacity, SHADOW.opacity)
})

test('the falloff (twin of the shader): dark inside, half at the edge, gone outside', () => {
  assert.equal(shadowFalloff(-10, 5), 1)
  assert.ok(close(shadowFalloff(0, 5), 0.5))
  assert.equal(shadowFalloff(10, 5), 0)
})
