/**
 * GraspFunnelMath.test.js — pure funnel presentation derivations (contract v4
 * domain-staged diagnostics, ADR-081). Run via `pnpm test:context` (bare
 * node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { funnelStages, dominantStage, funnelDelta, nearMissCloseness } from './GraspFunnelMath.js'

/** A conforming v4 fixture (invariant: 12 = 4 + 2 + 1 + 1 + 1 + 3). */
const D = Object.freeze({
  candidatesGenerated: 12,
  rejectedByReach: 4,
  rejectedByVisibility: 1,
  rejectedByIk: 2,
  rejectedByInterference: 1,
  rejectedByGrasp: 1,
  feasible: 3,
  returned: 2,
  reachNearestMiss: 0.05,
  occlusionNearestMiss: 0.008,
  openingNearestMiss: null,
})

// ── funnelStages ──────────────────────────────────────────────────────────────

test('funnelStages walks the engine stage order with sequential remainders', () => {
  const f = funnelStages(D)
  assert.equal(f.generated, 12)
  assert.equal(f.feasible, 3)
  assert.equal(f.returned, 2)
  // Engine's measured cheapest-first order (v4): reach → IK → grasp →
  // visibility → interference.
  assert.deepEqual(f.stages.map(s => [s.key, s.entered, s.rejected, s.remaining]), [
    ['reach', 12, 4, 8],
    ['ik', 8, 2, 6],
    ['grasp', 6, 1, 5],
    ['visibility', 5, 1, 4],
    ['interference', 4, 1, 3],
  ])
  // last remainder equals feasible (the contract invariant, displayed not re-judged)
  assert.equal(f.stages[4].remaining, D.feasible)
})

test('funnelStages: zero generation yields fraction 0 rows, never NaN', () => {
  const f = funnelStages({ ...D, candidatesGenerated: 0, rejectedByReach: 0, rejectedByVisibility: 0, rejectedByIk: 0, rejectedByInterference: 0, rejectedByGrasp: 0, feasible: 0, returned: 0 })
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
  // A v3 funnel (missing the ADR-081 stages) is not fabricated into a v4 one.
  const { rejectedByVisibility, rejectedByGrasp, ...v3 } = D
  assert.equal(funnelStages(v3), null)
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
  // the ADR-081 stages participate
  assert.equal(dominantStage({ ...D, rejectedByVisibility: 9 }), 'visibility')
  assert.equal(dominantStage({ ...D, rejectedByGrasp: 9 }), 'grasp')
})

test('dominantStage is null when nothing was rejected', () => {
  assert.equal(dominantStage({ ...D, rejectedByReach: 0, rejectedByVisibility: 0, rejectedByIk: 0, rejectedByInterference: 0, rejectedByGrasp: 0 }), null)
  assert.equal(dominantStage(null), null)
})

// ── funnelDelta ───────────────────────────────────────────────────────────────

test('funnelDelta subtracts per stage (negative rejection delta = improvement)', () => {
  const cur = { ...D, rejectedByReach: 1, rejectedByVisibility: 0, feasible: 7, returned: 5 }
  assert.deepEqual(funnelDelta(D, cur), {
    generated: 0, reach: -3, ik: 0, grasp: 0, visibility: -1, interference: 0, feasible: 4, returned: 3,
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
