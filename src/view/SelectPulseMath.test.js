/**
 * SelectPulseMath.test.js — the selection tap cue has two curves (ADR-166 M4d2,
 * ADR-093 D2): size lands, opacity fades, and the pulse is brightest while small.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectPulseFrame, PULSE_OPACITY, PULSE_GROWTH, PULSE_REDUCED } from './SelectPulseMath.js'

const STEPS = Array.from({ length: 21 }, (_, i) => i / 20)

test('starts at the body at full brightness and ends grown and gone', () => {
  assert.deepEqual(selectPulseFrame(0), { scale: 1, opacity: PULSE_OPACITY })
  const end = selectPulseFrame(1)
  assert.equal(end.scale, 1 + PULSE_GROWTH)
  assert.equal(end.opacity, 0)
})

test('brightest while small — opacity falls and size grows monotonically', () => {
  for (let i = 1; i < STEPS.length; i++) {
    const a = selectPulseFrame(STEPS[i - 1]), b = selectPulseFrame(STEPS[i])
    assert.ok(b.scale >= a.scale, `size shrank at p=${STEPS[i]}`)
    assert.ok(b.opacity <= a.opacity, `opacity rose at p=${STEPS[i]}`)
  }
})

test('size and opacity are two curves, not one progress wearing two roles', () => {
  // With one curve, grown-fraction and faded-fraction would be equal at every p.
  const differs = STEPS.slice(1, -1).some(p => {
    const f = selectPulseFrame(p)
    const grown = (f.scale - 1) / PULSE_GROWTH
    const faded = 1 - f.opacity / PULSE_OPACITY
    return Math.abs(grown - faded) > 0.05
  })
  assert.ok(differs)
  // Size is the land role: it is mostly grown before the light is mostly gone.
  const f = selectPulseFrame(0.25)
  assert.ok((f.scale - 1) / PULSE_GROWTH > 1 - f.opacity / PULSE_OPACITY)
})

test('reduced motion holds a still outline for every progress', () => {
  for (const p of [0, 0.3, 1]) assert.deepEqual(selectPulseFrame(p, true), { ...PULSE_REDUCED })
})

test('a malformed progress reads as the start, never NaN on screen', () => {
  for (const p of [NaN, Infinity, -1]) {
    const f = selectPulseFrame(p)
    assert.ok(Number.isFinite(f.scale) && Number.isFinite(f.opacity))
  }
  assert.deepEqual(selectPulseFrame(NaN), selectPulseFrame(0))
})
