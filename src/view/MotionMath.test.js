import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clamp01, easeOutCubic, easeOutBack, springStep, staggerProgress } from './MotionMath.js'

test('clamp01 clamps and absorbs NaN', () => {
  assert.equal(clamp01(-1), 0)
  assert.equal(clamp01(0.5), 0.5)
  assert.equal(clamp01(2), 1)
  assert.equal(clamp01(NaN), 0)
})

test('easeOutCubic hits endpoints and is monotonic', () => {
  assert.equal(easeOutCubic(0), 0)
  assert.equal(easeOutCubic(1), 1)
  let prev = 0
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const v = easeOutCubic(p)
    assert.ok(v >= prev - 1e-12, `monotonic at p=${p}`)
    prev = v
  }
})

test('easeOutBack starts at 0, ends at 1, overshoots past 1 in between', () => {
  assert.ok(Math.abs(easeOutBack(0)) < 1e-9)
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9)
  const peak = Math.max(...Array.from({ length: 21 }, (_, k) => easeOutBack(k / 20)))
  assert.ok(peak > 1, 'must overshoot (the pop)')
})

test('springStep converges to target without oscillation', () => {
  let s = { x: 0, v: 0 }
  let crossed = 0
  let prevSide = Math.sign(s.x - 1)
  for (let i = 0; i < 600; i++) {
    s = springStep(s.x, s.v, 1, 12, 1 / 120)
    const side = Math.sign(s.x - 1)
    if (side !== 0 && side !== prevSide) { crossed++; prevSide = side }
  }
  assert.ok(Math.abs(s.x - 1) < 1e-3, `converged (x=${s.x})`)
  assert.ok(crossed <= 1, 'critically damped: at most one crossing from discretisation')
})

test('springStep degrades malformed input to rest at target', () => {
  assert.deepEqual(springStep(NaN, 0, 1, 12, 0.01), { x: 1, v: 0 })
  assert.deepEqual(springStep(0, 0, NaN, 12, 0.01), { x: 0, v: 0 })
  assert.deepEqual(springStep(0, 0, 1, -5, 0.01), { x: 1, v: 0 })
})

test('staggerProgress delays item i by i·step and clamps', () => {
  const opts = { step: 0.1, duration: 0.5 }
  assert.equal(staggerProgress(0, 1, opts), 0)          // not started yet
  assert.equal(staggerProgress(0.1, 1, opts), 0)        // starts exactly now
  assert.ok(Math.abs(staggerProgress(0.35, 1, opts) - 0.5) < 1e-9)
  assert.equal(staggerProgress(10, 3, opts), 1)         // long past → clamped
  assert.equal(staggerProgress(NaN, 0, opts), 0)
  assert.equal(staggerProgress(1, 0, { duration: 0 }), 0)
})
