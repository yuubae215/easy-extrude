/**
 * FeedbackMath.test.js — pure proof-feedback snapshot comparisons (ADR-062).
 * Run via `pnpm test:context` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { refsSignature, listDelta, settledRefs } from './FeedbackMath.js'

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
