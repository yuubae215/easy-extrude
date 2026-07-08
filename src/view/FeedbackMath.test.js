/**
 * FeedbackMath.test.js — pure proof-feedback snapshot comparisons (ADR-062).
 * Run via `pnpm test:context` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { refsSignature, listDelta, settledRefs, flashStyle } from './FeedbackMath.js'

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
  assert.deepEqual(flashStyle('green', false), { animation: 'eaFlashGreen 700ms ease-out' })
  assert.deepEqual(flashStyle('amber', false), { animation: 'eaFlashAmber 700ms ease-out' })
  // default reduced flag is false → unchanged from the pre-Phase-4 behaviour
  assert.deepEqual(flashStyle('green'), { animation: 'eaFlashGreen 700ms ease-out' })
})

test('flashStyle degrades to a static tint under reduced motion (no animation, info kept)', () => {
  const green = flashStyle('green', true)
  const amber = flashStyle('amber', true)
  assert.equal(green.animation, undefined)
  assert.equal(amber.animation, undefined)
  assert.match(green.background, /34,197,94/)   // green family retained
  assert.match(amber.background, /213,162,58/)  // amber family retained
  assert.notEqual(green.background, amber.background)
})

test('flashStyle treats an unknown tone as green in both modes', () => {
  assert.deepEqual(flashStyle('bogus', false), { animation: 'eaFlashGreen 700ms ease-out' })
  assert.deepEqual(flashStyle('bogus', true), flashStyle('green', true))
})
