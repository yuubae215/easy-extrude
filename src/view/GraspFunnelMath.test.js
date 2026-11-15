/**
 * GraspFunnelMath.test.js — funnel presentation over the contract v13 stage
 * verdicts (ADR-172). Run via `pnpm test` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  funnelStages, dominantStage, funnelDelta, nearMissCloseness, nearMissMeters, specResultRows, isFunnel,
} from './GraspFunnelMath.js'

const judged = (stage, entered, rejected, nearestMiss) => ({ stage, kind: 'judged', entered, rejected, nearestMiss })
const NO_QTY = { kind: 'noQuantity' }
const NONE = { kind: 'noRejection' }

/** A conforming v13 fixture: 12 → reach −4 → IK −2 → grasp −1 → visibility −1 → interference −1 = 3. */
const D = Object.freeze({
  candidatesGenerated: 12,
  feasible: 3,
  returned: 2,
  stages: [
    judged('reach', 12, 4, { kind: 'measured', quantity: 'reachDistance', value: 0.05 }),
    judged('ik', 8, 2, NO_QTY),
    judged('grasp', 6, 1, { kind: 'unmeasurable', reasons: ['noContactPair'] }),
    judged('visibility', 5, 1, { kind: 'measured', quantity: 'occlusionDepth', value: 0.008 }),
    judged('interference', 4, 1, NO_QTY),
  ],
  bySource: [],
  fallbackRisks: [],
})

/** The same search with no camera and no hand: two stages nobody asked. */
const UNASKED = Object.freeze({
  candidatesGenerated: 12,
  feasible: 6,
  returned: 5,
  stages: [
    judged('reach', 12, 4, { kind: 'measured', quantity: 'reachDistance', value: 0.05 }),
    judged('ik', 8, 2, NO_QTY),
    { stage: 'grasp', kind: 'notAsked', reason: 'gripperUndeclared' },
    { stage: 'visibility', kind: 'notAsked', reason: 'cameraUndeclared' },
    judged('interference', 6, 0, NO_QTY),
  ],
  bySource: [],
  fallbackRisks: [],
})

const withStage = (d, key, patch) => ({ ...d, stages: d.stages.map(v => (v.stage === key ? { ...v, ...patch } : v)) })

// ── funnelStages ──────────────────────────────────────────────────────────────

test('funnelStages reads the engine\'s entered / rejected — nothing is re-derived from the order', () => {
  const f = funnelStages(D)
  assert.equal(f.generated, 12)
  assert.equal(f.feasible, 3)
  assert.equal(f.returned, 2)
  assert.deepEqual(f.stages.map(s => [s.key, s.entered, s.rejected, s.remaining]), [
    ['reach', 12, 4, 8],
    ['ik', 8, 2, 6],
    ['grasp', 6, 1, 5],
    ['visibility', 5, 1, 4],
    ['interference', 4, 1, 3],
  ])
  assert.equal(f.stages[4].remaining, D.feasible)
})

test('funnelStages: a stage nobody asked is a row with its reason and no count — never "−0" (ADR-172 D2)', () => {
  const f = funnelStages(UNASKED)
  assert.deepEqual(f.stages.map(s => [s.key, s.asked]), [
    ['reach', true], ['ik', true], ['grasp', false], ['visibility', false], ['interference', true]])
  const grasp = f.stages[2]
  assert.equal(grasp.reason, 'gripperUndeclared')
  assert.equal('rejected' in grasp, false)
  // an unasked stage passes everyone through: its bar is the previous one's
  assert.equal(grasp.fraction, f.stages[1].fraction)
})

test('funnelStages: zero generation yields fraction 0 rows, never NaN', () => {
  const zero = { ...D, candidatesGenerated: 0, feasible: 0, returned: 0,
    stages: D.stages.map(v => ({ ...v, entered: 0, rejected: 0, nearestMiss: v.nearestMiss.kind === 'noQuantity' ? NO_QTY : NONE })) }
  const f = funnelStages(zero)
  assert.equal(f.generated, 0)
  for (const s of f.stages) {
    assert.equal(s.fraction, 0)
    assert.ok(Number.isFinite(s.fraction))
  }
})

test('funnelStages degrades to null on malformed or pre-v13 input (no fabricated funnel)', () => {
  assert.equal(funnelStages(null), null)
  assert.equal(funnelStages({}), null)
  assert.equal(funnelStages({ ...D, feasible: 'three' }), null)
  assert.equal(funnelStages({ ...D, stages: D.stages.slice(1) }), null)
  // a v12 funnel (flat rejectedBy* counts) is not read as a v13 one
  const v12 = { candidatesGenerated: 3, rejectedByReach: 3, rejectedByVisibility: 0, rejectedByIk: 0,
    rejectedByInterference: 0, rejectedByGrasp: 0, feasible: 0, returned: 0 }
  assert.equal(isFunnel(v12), false)
})

test('funnelStages does not mutate its input', () => {
  const d = structuredClone(D)
  funnelStages(d)
  assert.deepEqual(d, D)
})

// ── dominantStage ─────────────────────────────────────────────────────────────

test('dominantStage picks the largest rejector; ties go to the earlier stage', () => {
  assert.equal(dominantStage(D), 'reach')
  assert.equal(dominantStage(withStage(D, 'ik', { rejected: 9 })), 'ik')
  assert.equal(dominantStage(withStage(D, 'ik', { rejected: 4 })), 'reach')
  assert.equal(dominantStage(withStage(D, 'visibility', { rejected: 9 })), 'visibility')
})

test('dominantStage is null when nothing was rejected, and an unasked stage never wins', () => {
  const clean = { ...D, stages: D.stages.map(v => ({ ...v, rejected: 0 })) }
  assert.equal(dominantStage(clean), null)
  assert.equal(dominantStage(null), null)
  assert.equal(dominantStage(UNASKED), 'reach')
})

// ── funnelDelta ───────────────────────────────────────────────────────────────

test('funnelDelta subtracts per stage (negative rejection delta = improvement)', () => {
  const cur = { ...withStage(withStage(D, 'reach', { rejected: 1 }), 'visibility', { rejected: 0 }), feasible: 7, returned: 5 }
  assert.deepEqual(funnelDelta(D, cur), {
    generated: 0, reach: -3, ik: 0, grasp: 0, visibility: -1, interference: 0, feasible: 4, returned: 3,
  })
})

test('funnelDelta: a stage asked in only one of the two runs has no delta — not the same question', () => {
  const delta = funnelDelta(D, UNASKED)
  assert.equal(delta.grasp, null)
  assert.equal(delta.visibility, null)
  assert.equal(delta.reach, 0)
})

test('funnelDelta is null without a comparable previous run', () => {
  assert.equal(funnelDelta(null, D), null)
  assert.equal(funnelDelta(D, null), null)
})

// ── near misses ───────────────────────────────────────────────────────────────

test('nearMissMeters: measured stages get a meter, unmeasurable ones say why, the rest draw nothing (ADR-172 D3)', () => {
  const m = nearMissMeters(D)
  assert.deepEqual(m.map(x => [x.key, x.measured]), [['reach', true], ['grasp', false], ['visibility', true]])
  assert.equal(m[0].what, 'missed reach by')
  assert.equal(m[0].value, 0.05)
  assert.deepEqual(m[1].reasons, ['noContactPair'])
  assert.throws(() => nearMissMeters(withStage(D, 'reach', { nearestMiss: { kind: 'measured', quantity: 'vibes', value: 1 } })),
    /undeclared shortfall quantity/)
})

test('nearMissCloseness: 1 at zero miss, monotone toward 0, null on null/invalid', () => {
  assert.equal(nearMissCloseness(0), 1)
  const a = nearMissCloseness(0.05)
  const b = nearMissCloseness(0.5)
  assert.ok(a > b && b > 0)
  assert.equal(nearMissCloseness(null), null)
  assert.equal(nearMissCloseness(-1), null)
  assert.equal(nearMissCloseness(NaN), null)
})

// ── source rows (ADR-172 D4 — DEF-048) ───────────────────────────────────────

test('source rows: a spec not returned, a spec with nothing, and the derived row are separate rows that add up', () => {
  const st = (n, reach = 0) => [
    judged('reach', n, reach, reach ? { kind: 'measured', quantity: 'reachDistance', value: 0.1 } : NONE),
    judged('ik', n - reach, 0, NO_QTY),
    { stage: 'grasp', kind: 'notAsked', reason: 'gripperUndeclared' },
    { stage: 'visibility', kind: 'notAsked', reason: 'cameraUndeclared' },
    judged('interference', n - reach, 0, NO_QTY),
  ]
  const rows = specResultRows(
    { bySource: [
      { source: { kind: 'spec', id: 'top pinch' }, candidatesGenerated: 18, feasible: 4, stages: st(18, 14) },
      { source: { kind: 'spec', id: 'side' }, candidatesGenerated: 9, feasible: 0, stages: st(9, 9) },
      { source: { kind: 'derived' }, candidatesGenerated: 6, feasible: 6, stages: st(6) },
    ] },
    [{ graspSpecId: 'top pinch' }, { graspSpecId: 'top pinch' }, { graspSpecId: null }],
  )
  assert.deepEqual(rows.map(r => [r.id, r.label, r.feasible, r.returned]), [
    ['top pinch', 'top pinch', 4, 2], ['side', 'side', 0, 0], [null, 'derived faces', 6, 1]])
  assert.equal(rows[1].stages[0].rejected, 9, 'where each source fell out rides on its row')
  // the only source being derived adds nothing to the funnel above
  assert.equal(specResultRows({ bySource: [{ source: { kind: 'derived' }, candidatesGenerated: 6, feasible: 6, stages: st(6) }] }, []), null)
  assert.equal(specResultRows({}, []), null, 'pre-v13 diagnostics: nothing to show')
})
