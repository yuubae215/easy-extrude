import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tierAMotion, activeGlow, lockedStyle, enterMotion,
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
})
