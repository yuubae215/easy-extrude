import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  intensityStep, frontFrame,
  FRONT_BASE, FRONT_STATIC,
} from './ExtrudeFrontMath.js'

test('intensityStep: speed pushes the rim up, clamped at 1', () => {
  const slow = intensityStep(FRONT_BASE, 0.1, 1 / 60)
  const fast = intensityStep(FRONT_BASE, 2.0, 1 / 60)
  assert.ok(slow > FRONT_BASE, 'any motion brightens the front')
  assert.ok(fast > slow, 'faster growth glows harder')
  assert.equal(intensityStep(FRONT_BASE, 1e6, 1 / 60), 1, 'clamped at full intensity')
})

test('intensityStep: stillness decays monotonically toward the resting base (P2)', () => {
  let i = 1
  let prev = i
  for (let f = 0; f < 120; f++) {
    i = intensityStep(i, 0, 1 / 60)
    assert.ok(i <= prev, 'monotone decay')
    assert.ok(i >= FRONT_BASE, 'never below the resting base — the rim stays live')
    prev = i
  }
  assert.ok(i < FRONT_BASE + 0.01, 'settles at the base after ~2s')
})

test('intensityStep: malformed inputs degrade to plain decay, never NaN (#12)', () => {
  for (const bad of [NaN, Infinity, -1, undefined]) {
    assert.ok(Number.isFinite(intensityStep(0.5, bad, 1 / 60)), `velocity ${bad}`)
    assert.ok(Number.isFinite(intensityStep(0.5, 1, bad)), `dt ${bad}`)
    assert.ok(Number.isFinite(intensityStep(bad, 1, 1 / 60)), `prev ${bad}`)
  }
  assert.equal(intensityStep(NaN, 0, 0), FRONT_BASE)
})

test('frontFrame: opacity and white flash scale with intensity, both bounded', () => {
  const rest = frontFrame(FRONT_BASE)
  const full = frontFrame(1)
  assert.ok(full.opacity > rest.opacity)
  assert.equal(rest.whiteLerp, 0, 'no flash at rest — the flash means momentum (P4)')
  assert.ok(full.whiteLerp > 0)
  for (const i of [0, 0.3, 0.7, 1, 2, -1]) {
    const f = frontFrame(i)
    assert.ok(f.opacity >= 0 && f.opacity <= 1)
    assert.ok(f.whiteLerp >= 0 && f.whiteLerp <= 1)
  }
})

test('frontFrame: reduced motion is a static held cue — information preserved (#30/#11)', () => {
  const a = frontFrame(0.1, true)
  const b = frontFrame(1, true)
  assert.deepEqual(a, b, 'intensity is ignored — nothing moves')
  assert.equal(a.opacity, FRONT_STATIC)
  assert.equal(a.whiteLerp, 0)
})
