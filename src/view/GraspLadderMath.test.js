/**
 * GraspLadderMath.test.js — deterministic KPI derivation + ladder-risk table
 * lookup (ADR-081 Decision 3, presentation layer). Run via `pnpm test:context`
 * (bare node --test, THREE-free).
 *
 * Governance under test: KPIs are pure derivations of the v4 wire facts (no
 * second source), the ladder mapping is a single-owner table lookup, and
 * malformed / empty input degrades to null / [] — never a fabricated forecast.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { LADDER, domainKpis, ladderRisks } from './GraspLadderMath.js'

/** Clean run: every domain passes everything (20 generated, 20 feasible). */
const CLEAN = Object.freeze({
  candidatesGenerated: 20,
  rejectedByReach: 0,
  rejectedByVisibility: 0,
  rejectedByIk: 0,
  rejectedByInterference: 0,
  rejectedByGrasp: 0,
  feasible: 20,
  returned: 5,
  reachNearestMiss: null,
  occlusionNearestMiss: null,
  openingNearestMiss: null,
})

/** Mixed run (invariant: 20 = 2+4+1+1+2+10). */
const MIXED = Object.freeze({
  ...CLEAN,
  rejectedByReach: 2,
  rejectedByVisibility: 4,
  rejectedByIk: 1,
  rejectedByInterference: 1,
  rejectedByGrasp: 2,
  feasible: 10,
  reachNearestMiss: 0.02,
  occlusionNearestMiss: 0.008,
  openingNearestMiss: 0.012,
})

// ── domainKpis ────────────────────────────────────────────────────────────────

test('domainKpis derives per-domain rates from the exclusive stage counts', () => {
  const k = domainKpis(MIXED)
  assert.equal(k.generated, 20)
  assert.equal(k.feasibleRate, 0.5)
  assert.equal(k.vision.rejected, 4)
  assert.equal(k.vision.rate, 1 - 4 / 20)
  // path aggregates its three stages (reach + IK + interference)
  assert.equal(k.path.rejected, 4)
  assert.equal(k.path.rate, 1 - 4 / 20)
  assert.equal(k.grasp.rate, 1 - 2 / 20)
  // near-misses are passed through as facts (nulls stay null)
  assert.equal(k.vision.nearestMiss, 0.008)
  assert.equal(k.path.nearestMiss, 0.02)
  assert.equal(k.grasp.nearestMiss, 0.012)
  assert.equal(domainKpis(CLEAN).vision.nearestMiss, null)
})

test('domainKpis is null on malformed or empty-generation input', () => {
  assert.equal(domainKpis(null), null)
  assert.equal(domainKpis({}), null)
  assert.equal(domainKpis({ ...CLEAN, candidatesGenerated: 0, feasible: 0, returned: 0 }), null)
  // v3-shaped diagnostics (missing ADR-081 stages) are not silently upgraded
  const { rejectedByVisibility, rejectedByGrasp, ...v3 } = MIXED
  assert.equal(domainKpis(v3), null)
})

// ── ladderRisks ───────────────────────────────────────────────────────────────

test('ladderRisks is empty for a clean run', () => {
  assert.deepEqual(ladderRisks(domainKpis(CLEAN)), [])
  assert.deepEqual(ladderRisks(null), [])
})

test('partial rejections map to the shallow risk levels (L3/L4)', () => {
  const risks = ladderRisks(domainKpis(MIXED))
  const byDomain = Object.fromEntries(risks.map(r => [r.domain, r.level]))
  assert.equal(byDomain.vision, 3) // unseen points → vision-retry takt loss
  assert.equal(byDomain.path, 4)   // reach/IK/clearance → re-teach motion
  assert.equal(byDomain.grasp, 4)  // grasp geometry → re-teach grasp
  // feasible > 0 → no L6 row
  assert.ok(!risks.some(r => r.level === 6))
})

test('a total domain loss deepens the risk to L5', () => {
  // every candidate visibility-rejected (the template L3-repro fixture shape)
  const blind = {
    ...CLEAN,
    rejectedByVisibility: 20,
    feasible: 0,
    returned: 0,
    occlusionNearestMiss: 0.0077,
  }
  const risks = ladderRisks(domainKpis(blind))
  assert.deepEqual(risks.map(r => [r.domain, r.level]), [['vision', 5]])
  assert.equal(risks[0].label, LADDER[5].label)
})

test('zero feasible with rejections in 2+ domains raises the L6 row deepest-first', () => {
  const deadlock = {
    ...CLEAN,
    rejectedByVisibility: 10,
    rejectedByGrasp: 10,
    feasible: 0,
    returned: 0,
  }
  const risks = ladderRisks(domainKpis(deadlock))
  assert.equal(risks[0].level, 6)
  assert.match(risks[0].reason, /vision \+ grasp/)
  // deepest-first ordering
  const levels = risks.map(r => r.level)
  assert.deepEqual(levels, [...levels].sort((a, b) => b - a))
})

test('the ladder table is the single owner: rows carry its labels verbatim', () => {
  const risks = ladderRisks(domainKpis(MIXED))
  for (const r of risks) {
    assert.equal(r.label, LADDER[r.level].label)
    assert.equal(r.cost, LADDER[r.level].cost)
  }
})
