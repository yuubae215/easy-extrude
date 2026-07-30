/**
 * colorMath.test.js — the predicates ADR-100's palette rules are judged by.
 *
 * These are tested independently of the palette because `tokens.test.js` uses
 * them to make ASSERTIONS: a silently-wrong `hueDistance` would let two
 * colliding meanings ship while the suite stayed green. A check is only as
 * trustworthy as the arithmetic under it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rgbOf, hslOf, hueDistance, relativeLuminance, contrastRatio, isNeutral } from './colorMath.js'

const near = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual.toFixed(4)}`)

test('rgbOf parses #rrggbb and rejects anything else loudly', () => {
  assert.deepEqual(rgbOf('#ff7d2e'), { r: 255, g: 125, b: 46 })
  assert.deepEqual(rgbOf('#000000'), { r: 0, g: 0, b: 0 })
  // Throwing beats returning a guess: a silently-parsed colour would make every
  // downstream threshold report a number about a colour nobody wrote.
  for (const bad of ['#fff', 'ff7d2e', 'rgb(1,2,3)', '', null, undefined, 0x00ff00]) {
    assert.throws(() => rgbOf(bad), TypeError, `rgbOf(${JSON.stringify(bad)}) should throw`)
  }
})

test('hslOf places the primaries on the wheel', () => {
  near(hslOf('#ff0000').hue,   0, 0.01, 'red')
  near(hslOf('#00ff00').hue, 120, 0.01, 'green')
  near(hslOf('#0000ff').hue, 240, 0.01, 'blue')
  near(hslOf('#ffff00').hue,  60, 0.01, 'yellow')
  near(hslOf('#00ffff').hue, 180, 0.01, 'cyan')
  near(hslOf('#ff00ff').hue, 300, 0.01, 'magenta')
})

test('hslOf reports a grey as having NO hue, not hue 0', () => {
  // A grey with `hue: 0` would be indistinguishable from red to any caller that
  // forgot to check saturation — the same shape as ADR-096's default table,
  // where an undeclared kind must not read as a declared one.
  for (const grey of ['#000000', '#808080', '#ffffff', '#242424']) {
    assert.equal(hslOf(grey).hue, null, `${grey} must report hue null`)
    assert.equal(hslOf(grey).saturation, 0)
  }
  assert.notEqual(hslOf('#ff0000').hue, null)
})

test('hslOf saturation and lightness match HSL definitions', () => {
  near(hslOf('#ff0000').saturation, 1,   0.001, 'pure red saturation')
  near(hslOf('#ff0000').lightness,  0.5, 0.001, 'pure red lightness')
  near(hslOf('#ffffff').lightness,  1,   0.001, 'white lightness')
  near(hslOf('#000000').lightness,  0,   0.001, 'black lightness')
  // A near-neutral: the entity default's whole claim is that this stays small.
  near(hslOf('#b9bcc0').saturation, 0.053, 0.005, 'near-neutral saturation')
})

test('hueDistance wraps around the wheel', () => {
  assert.equal(hueDistance(10, 30), 20)
  assert.equal(hueDistance(30, 10), 20)
  // The wrap is the load-bearing case: red at 355° and orange at 15° are 20°
  // apart, and a subtraction that forgot the wheel would report 340° and wave
  // a genuine collision straight through.
  assert.equal(hueDistance(355, 15), 20)
  assert.equal(hueDistance(15, 355), 20)
  assert.equal(hueDistance(0, 180), 180)
  assert.equal(hueDistance(0, 181), 179)   // never exceeds 180
  assert.equal(hueDistance(0, 360), 0)
  assert.equal(hueDistance(-10, 10), 20)   // normalises negatives
})

test('relativeLuminance matches the WCAG anchors', () => {
  near(relativeLuminance('#ffffff'), 1, 0.0001, 'white')
  near(relativeLuminance('#000000'), 0, 0.0001, 'black')
  near(relativeLuminance('#808080'), 0.2159, 0.001, 'mid grey')
})

test('contrastRatio is order-independent and spans 1..21', () => {
  near(contrastRatio('#ffffff', '#000000'), 21, 0.01, 'max contrast')
  near(contrastRatio('#000000', '#ffffff'), 21, 0.01, 'reversed is identical')
  assert.equal(contrastRatio('#3a7bd5', '#3a7bd5'), 1)
})

test('isNeutral is a threshold, not an opinion', () => {
  assert.ok(isNeutral('#b9bcc0', 0.12))
  assert.ok(isNeutral('#242424', 0.12))
  assert.ok(!isNeutral('#ff7d2e', 0.12))
  assert.ok(!isNeutral('#22c55e', 0.12))
  // Boundary: `<=` so a colour sitting exactly on the budget passes.
  assert.ok(isNeutral('#b9bcc0', hslOf('#b9bcc0').saturation))
})
