/**
 * FeedbackMath.test.js — pure proof-feedback snapshot comparisons (ADR-062).
 * Run via `pnpm test:context` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { refsSignature, listDelta, settledRefs, flashStyle, updateFlash } from './FeedbackMath.js'
import { COLOR, DURATION, EASING, rgba } from '../theme/tokens.js'
import { STAGE_LIGHT } from './StageMath.js'

const Q = (ref) => ({ ref, prompt: `p_${ref}` })

// ── refsSignature ─────────────────────────────────────────────────────────────

test('refsSignature is stable across array identity churn (re-projection)', () => {
  const a = [Q('oq_a'), Q('oq_b')]
  const b = [Q('oq_a'), Q('oq_b')]   // fresh objects, same facts
  assert.equal(refsSignature(a), refsSignature(b))
  assert.notEqual(refsSignature(a), refsSignature([Q('oq_a')]))
})

test('refsSignature accepts plain string lists and is order-sensitive', () => {
  assert.equal(refsSignature(['v_x', 'v_y']), refsSignature(['v_x', 'v_y']))
  assert.notEqual(refsSignature(['v_x', 'v_y']), refsSignature(['v_y', 'v_x']))
})

test('refsSignature degrades to null on non-lists and unkeyable entries', () => {
  assert.equal(refsSignature(null), null)
  assert.equal(refsSignature(undefined), null)
  assert.equal(refsSignature('oq_a'), null)
  assert.equal(refsSignature([{ prompt: 'no ref' }]), null)
  assert.equal(refsSignature([Q('oq_a'), { ref: '' }]), null)
})

// ── listDelta ─────────────────────────────────────────────────────────────────

test('listDelta subtracts counts (negative = fewer open items)', () => {
  assert.equal(listDelta([Q('a'), Q('b'), Q('c')], [Q('a')]), -2)
  assert.equal(listDelta([], [Q('a')]), 1)
  assert.equal(listDelta([Q('a')], [Q('a')]), 0)
})

test('listDelta is null without two comparable snapshots', () => {
  assert.equal(listDelta(null, []), null)
  assert.equal(listDelta([], undefined), null)
  assert.equal(listDelta(null, null), null)
})

// ── settledRefs ───────────────────────────────────────────────────────────────

test('settledRefs lists what the last change closed, in previous order', () => {
  const prev = [Q('oq_a'), Q('oq_b'), Q('oq_c')]
  const cur  = [Q('oq_b')]
  assert.deepEqual(settledRefs(prev, cur), ['oq_a', 'oq_c'])
})

test('settledRefs is empty when nothing closed (additions are not settlements)', () => {
  assert.deepEqual(settledRefs([Q('a')], [Q('a'), Q('b')]), [])
  assert.deepEqual(settledRefs([], []), [])
})

test('settledRefs degrades to null on unkeyable input, never a guessed identity', () => {
  assert.equal(settledRefs(null, []), null)
  assert.equal(settledRefs([{ prompt: 'x' }], []), null)
  assert.equal(settledRefs([], null), null)
})

test('settledRefs does not mutate its inputs', () => {
  const prev = [Q('a'), Q('b')]
  const cur  = [Q('b')]
  const prevCopy = structuredClone(prev)
  const curCopy  = structuredClone(cur)
  settledRefs(prev, cur)
  assert.deepEqual(prev, prevCopy)
  assert.deepEqual(cur, curCopy)
})

// ── flashStyle (ADR-064 Phase 4: reduced-motion degradation) ────────────────────

test('flashStyle animates by default (motion allowed)', () => {
  // ADR-166 M4d4: the curve is the identity's `fade`, not the browser's `ease-out`.
  assert.deepEqual(flashStyle('green', false), { animation: `eaFlashGreen ${DURATION.flash}ms ${EASING.fade}` })
  assert.deepEqual(flashStyle('amber', false), { animation: `eaFlashAmber ${DURATION.flash}ms ${EASING.fade}` })
  // default reduced flag is false → unchanged from the pre-Phase-4 behaviour
  assert.deepEqual(flashStyle('green'), { animation: `eaFlashGreen ${DURATION.flash}ms ${EASING.fade}` })
})

test('flashStyle degrades to a static tint under reduced motion (no animation, info kept)', () => {
  const green = flashStyle('green', true)
  const amber = flashStyle('amber', true)
  assert.equal(green.animation, undefined)
  assert.equal(amber.animation, undefined)
  // Derived from the tokens rather than re-typed as RGB triples: the claim is
  // "the static tint still carries the same MEANING", and a literal here would
  // be a second source that fails the day a token legitimately moves
  // (ADR-100 nudged cautionTone's hue and this assertion is what noticed).
  assert.equal(green.background, rgba(COLOR.factTone, 0.16))
  assert.equal(amber.background, rgba(COLOR.cautionTone, 0.18))
  assert.notEqual(green.background, amber.background)
})

test('flashStyle treats an unknown tone as green in both modes', () => {
  assert.deepEqual(flashStyle('bogus', false), flashStyle('green', false))
  assert.deepEqual(flashStyle('bogus', true), flashStyle('green', true))
})

// ── updateFlash (ADR-166 M4d4: a node update is its own fact, not a borrowed selection) ──

test('updateFlash is the stage light fading on `fade`, placed by elapsed time', () => {
  const f = updateFlash(0)
  assert.equal(f.fill, STAGE_LIGHT.color)
  assert.equal(f.animation, `eaLightOff ${DURATION.flash}ms ${EASING.fade} both`)
  // A redraw mid-flash continues the same light (negative delay), never restarts it.
  assert.equal(updateFlash(250).animationDelay, '-250ms')
})

test('updateFlash is gone at its end and never fabricates a flash from bad time', () => {
  assert.equal(updateFlash(DURATION.flash), null)
  assert.equal(updateFlash(-1), null)
  assert.equal(updateFlash(NaN), null)
})

test('updateFlash under reduced motion holds a static light for the same duration', () => {
  const f = updateFlash(100, true)
  assert.equal(f.animation, undefined)
  assert.equal(f.fill, STAGE_LIGHT.color)
  assert.ok(f.opacity > 0)
  assert.equal(updateFlash(DURATION.flash, true), null)
})
