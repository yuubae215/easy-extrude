/**
 * GraspFunnelMath.test.js — pure funnel presentation derivations (contract v3
 * diagnostics). Run via `pnpm test:context` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { funnelStages, dominantStage, funnelDelta, nearMissCloseness } from './GraspFunnelMath.js'

/** A conforming diagnostics fixture (invariant: 10 = 4 + 2 + 1 + 3). */
const D = Object.freeze({
  candidatesGenerated: 10,
  rejectedByReach: 4,
  rejectedByIk: 2,
  rejectedByInterference: 1,
  feasible: 3,
  returned: 2,
  reachNearestMiss: 0.05,
})

// ── funnelStages ──────────────────────────────────────────────────────────────

test('funnelStages walks the contract stage order with sequential remainders', () => {
  const f = funnelStages(D)
  assert.equal(f.generated, 10)
  assert.equal(f.feasible, 3)
  assert.equal(f.returned, 2)
  assert.deepEqual(f.stages.map(s => [s.key, s.entered, s.rejected, s.remaining]), [
    ['reach', 10, 4, 6],
    ['ik', 6, 2, 4],
    ['interference', 4, 1, 3],
  ])
  // last remainder equals feasible (the contract invariant, displayed not re-judged)
  assert.equal(f.stages[2].remaining, D.feasible)
})

test('funnelStages: zero generation yields fraction 0 rows, never NaN', () => {
  const f = funnelStages({ ...D, candidatesGenerated: 0, rejectedByReach: 0, rejectedByIk: 0, rejectedByInterference: 0, feasible: 0, returned: 0 })
  assert.equal(f.generated, 0)
  for (const s of f.stages) {
    assert.equal(s.fraction, 0)
    assert.ok(Number.isFinite(s.fraction))
  }
})

test('funnelStages degrades to null on malformed input (no fabricated funnel)', () => {
  assert.equal(funnelStages(null), null)
  assert.equal(funnelStages(undefined), null)
  assert.equal(funnelStages({}), null)
  assert.equal(funnelStages({ ...D, feasible: 'three' }), null)
})

test('funnelStages does not mutate its input', () => {
  const d = { ...D }
  funnelStages(d)
  assert.deepEqual(d, D)
})

// ── dominantStage ─────────────────────────────────────────────────────────────

test('dominantStage picks the largest rejector; ties go to the earlier stage', () => {
  assert.equal(dominantStage(D), 'reach')
  assert.equal(dominantStage({ ...D, rejectedByReach: 1, rejectedByIk: 5 }), 'ik')
  // tie reach=ik → reach filtered first
  assert.equal(dominantStage({ ...D, rejectedByReach: 3, rejectedByIk: 3, rejectedByInterference: 1 }), 'reach')
})

test('dominantStage is null when nothing was rejected', () => {
  assert.equal(dominantStage({ ...D, rejectedByReach: 0, rejectedByIk: 0, rejectedByInterference: 0 }), null)
  assert.equal(dominantStage(null), null)
})

// ── funnelDelta ───────────────────────────────────────────────────────────────

test('funnelDelta subtracts per stage (negative rejection delta = improvement)', () => {
  const cur = { ...D, rejectedByReach: 1, feasible: 6, returned: 5 }
  assert.deepEqual(funnelDelta(D, cur), {
    generated: 0, reach: -3, ik: 0, interference: 0, feasible: 3, returned: 3,
  })
})

test('funnelDelta is null without a comparable previous run', () => {
  assert.equal(funnelDelta(null, D), null)
  assert.equal(funnelDelta(D, null), null)
  assert.equal(funnelDelta(undefined, undefined), null)
})

// ── nearMissCloseness ─────────────────────────────────────────────────────────

test('nearMissCloseness: 1 at zero miss, monotone toward 0, null on null/invalid', () => {
  assert.equal(nearMissCloseness(0), 1)
  const a = nearMissCloseness(0.05)
  const b = nearMissCloseness(0.5)
  assert.ok(a > b && b > 0)
  assert.equal(nearMissCloseness(null), null)
  assert.equal(nearMissCloseness(undefined), null)
  assert.equal(nearMissCloseness(-1), null)
  assert.equal(nearMissCloseness(NaN), null)
})
