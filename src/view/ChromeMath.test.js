import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tierAMotion, activeGlow, lockedStyle, enterMotion,
  popoverEnterMotion, itemEnterMotion,
  breatheGlowKeyframes, CHROME_CSS,
} from './ChromeMath.js'

test('tierAMotion: press scales down fast, release springs back, hover lifts', () => {
  const pressed = tierAMotion({ pressed: true })
  assert.equal(pressed.transform, 'scale(0.94)')
  assert.match(pressed.transition, /ease-out/)

  const released = tierAMotion({ hovered: true })
  assert.equal(released.transform, 'translateY(-1px)')
  assert.match(released.transition, /cubic-bezier/, 'release uses the spring curve')

  assert.equal(tierAMotion({}).transform, 'none')
})

test('tierAMotion: reduced motion drops movement entirely (colour cues remain component-owned)', () => {
  assert.deepEqual(tierAMotion({ hovered: true, pressed: true, reduced: true }), {})
})

test('tierAMotion carries no colour — Tier A must not fake a Tier F judgment', () => {
  for (const s of [{ pressed: true }, { hovered: true }, {}]) {
    const keys = Object.keys(tierAMotion(s))
    assert.ok(keys.every(k => k === 'transform' || k === 'transition'), `only motion keys, got ${keys}`)
  }
})

test('activeGlow: animated when engaged, static held cue when reduced, nothing when inactive', () => {
  assert.match(activeGlow(true, false).animation, /eaBreatheGlow/)
  const reduced = activeGlow(true, true)
  assert.ok(reduced.boxShadow, 'reduced keeps a static glow — information preserved (#11)')
  assert.equal(reduced.animation, undefined)
  assert.deepEqual(activeGlow(false, false), {})
  assert.deepEqual(activeGlow(false, true), {})
})

test('lockedStyle is the static quest affordance (dashed + help cursor)', () => {
  assert.deepEqual(lockedStyle(), { borderStyle: 'dashed', cursor: 'help' })
})

test('enterMotion: slide-fade when motion allowed, plain appearance when reduced', () => {
  assert.match(enterMotion(false).animation, /eaChromeEnter/)
  assert.match(enterMotion(false, 300).animation, /300ms/)
  assert.deepEqual(enterMotion(true), {})
})

test('popoverEnterMotion: scale-fade from the given anchor, plain appearance when reduced (ADR-080)', () => {
  const fx = popoverEnterMotion(false, 'center bottom')
  assert.match(fx.animation, /eaPopoverEnter/)
  assert.match(fx.animation, /cubic-bezier/, 'lands on the spring curve (overshoot-settle)')
  assert.equal(fx.transformOrigin, 'center bottom')
  assert.equal(popoverEnterMotion(false).transformOrigin, 'top left', 'default anchor')
  assert.deepEqual(popoverEnterMotion(true), {})
  assert.deepEqual(popoverEnterMotion(true, 'center bottom'), {})
})

test('itemEnterMotion: equal-interval stagger, strictly monotone in index, reduced drops it (ADR-080)', () => {
  const delayOf = (i) => parseFloat(itemEnterMotion(i, false).animationDelay)
  assert.equal(delayOf(0), 0)
  const step = delayOf(1)
  assert.ok(step > 0, 'a real per-item offset')
  for (let i = 1; i < 6; i++) {
    assert.ok(delayOf(i) > delayOf(i - 1), `monotone at ${i}`)
    assert.equal(delayOf(i) - delayOf(i - 1), step, 'equal intervals')
  }
  assert.match(itemEnterMotion(0, false).animation, /eaChromeEnter/, 'reuses the shared entry vocabulary')
  assert.match(itemEnterMotion(0, false).animation, /both/, 'holds opacity 0 through the delay')
  assert.deepEqual(itemEnterMotion(3, true), {})
})

test('itemEnterMotion: malformed index degrades to zero delay, never NaN (#12 robustness)', () => {
  for (const bad of [NaN, Infinity, -2, undefined]) {
    assert.equal(itemEnterMotion(bad, false).animationDelay, '0ms')
  }
})

test('breathing keyframes are seamless (0% and 100% stops equal) and peak mid-cycle', () => {
  const kf = breatheGlowKeyframes(8)
  const stops = kf.split('\n').map(s => s.trim()).filter(Boolean)
  assert.equal(stops.length, 9)
  const shadowOf = (s) => s.replace(/^[\d.]+% /, '')
  assert.equal(shadowOf(stops[0]), shadowOf(stops[8]), 'loop has no seam')
  assert.match(stops[4], /^50% /, 'midpoint stop present')
  assert.notEqual(shadowOf(stops[4]), shadowOf(stops[0]), 'the glow actually swells')
})

test('CHROME_CSS defines exactly the keyframes the fragments reference', () => {
  assert.match(CHROME_CSS, /@keyframes eaChromeEnter/)
  assert.match(CHROME_CSS, /@keyframes eaBreatheGlow/)
  assert.match(CHROME_CSS, /@keyframes eaPopoverEnter/)
})
