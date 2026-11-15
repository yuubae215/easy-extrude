/**
 * GraspLadderMath.test.js — domain KPIs read from the contract v13 stage
 * verdicts, and the engine's fallback risks worded for display (ADR-172 D8 —
 * WHICH risk applies is core/'s; this module decides nothing). Run via
 * `pnpm test` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDER, RISK_REASON_TEXT, domainKpis, ladderRisks, rateText } from './GraspLadderMath.js'

const judged = (stage, entered, rejected) => ({ stage, kind: 'judged', entered, rejected,
  nearestMiss: rejected ? { kind: 'unmeasurable', reasons: ['noContactPair'] } : { kind: 'noRejection' } })
const asIs = (stage, entered, rejected) => ({ ...judged(stage, entered, rejected),
  nearestMiss: ['ik', 'interference'].includes(stage) ? { kind: 'noQuantity' } : judged(stage, entered, rejected).nearestMiss })

/** 20 → reach −2 → IK −1 → grasp −2 → visibility −4 → interference −1 = 10. */
const MIXED = Object.freeze({
  candidatesGenerated: 20, feasible: 10, returned: 5,
  stages: [asIs('reach', 20, 2), asIs('ik', 18, 1), asIs('grasp', 17, 2), asIs('visibility', 15, 4), asIs('interference', 11, 1)],
  bySource: [],
  fallbackRisks: [
    { kind: 'domain', domain: 'path', level: 4, reason: 'someUnreachable' },
    { kind: 'domain', domain: 'grasp', level: 4, reason: 'someUnclosable' },
    { kind: 'domain', domain: 'vision', level: 3, reason: 'someUnseen' },
  ],
})

test('domain rates are over the candidates that ENTERED each stage — the engine\'s entered, not a re-derivation', () => {
  const k = domainKpis(MIXED)
  assert.equal(k.generated, 20)
  assert.equal(k.feasibleRate, 0.5)
  assert.equal(k.vision.rejected, 4)
  assert.equal(k.vision.rate, 1 - 4 / 15)
  assert.equal(k.grasp.rate, 1 - 2 / 17)
  // path = the product of its three stages' pass rates (they are not adjacent)
  assert.equal(k.path.rejected, 4)
  assert.ok(Math.abs(k.path.rate - (18 / 20) * (17 / 18) * (10 / 11)) < 1e-12)
})

test('a stage that rejects everything it is asked reads 0 %, even after earlier stages took most', () => {
  const d = { candidatesGenerated: 36, feasible: 0, returned: 0, bySource: [], fallbackRisks: [],
    stages: [asIs('reach', 36, 30), asIs('ik', 6, 0), asIs('grasp', 6, 0), asIs('visibility', 6, 6), asIs('interference', 0, 0)] }
  assert.equal(rateText(domainKpis(d).vision), '0%')
})

test('a domain nobody asked has no rate — never a fabricated 100 % (#11 / #31)', () => {
  const d = { candidatesGenerated: 5, feasible: 5, returned: 5, bySource: [], fallbackRisks: [],
    stages: [asIs('reach', 5, 0), asIs('ik', 5, 0),
      { stage: 'grasp', kind: 'notAsked', reason: 'gripperUndeclared' },
      { stage: 'visibility', kind: 'notAsked', reason: 'cameraUndeclared' }, asIs('interference', 5, 0)] }
  const k = domainKpis(d)
  assert.deepEqual(k.vision, { asked: false })
  assert.equal(rateText(k.grasp), 'not asked')
  assert.equal(rateText(k.path), '100%')
})

test('a stage nobody reached has no rate either', () => {
  const d = { candidatesGenerated: 3, feasible: 0, returned: 0, bySource: [], fallbackRisks: [],
    stages: [asIs('reach', 3, 3), asIs('ik', 0, 0), asIs('grasp', 0, 0), asIs('visibility', 0, 0), asIs('interference', 0, 0)] }
  assert.equal(rateText(domainKpis(d).vision), 'not reached')
})

test('KPIs are null on malformed, pre-v13 or empty-generation input', () => {
  assert.equal(domainKpis(null), null)
  assert.equal(domainKpis({}), null)
  assert.equal(domainKpis({ ...MIXED, candidatesGenerated: 0 }), null)
})

// ── the engine's risks, worded ────────────────────────────────────────────────

test('ladderRisks words the engine\'s risks in the engine\'s order — it decides nothing', () => {
  const risks = ladderRisks(MIXED)
  assert.deepEqual(risks.map(r => [r.domain, r.level]), [['path', 4], ['grasp', 4], ['vision', 3]])
  for (const r of risks) {
    assert.equal(r.label, LADDER[r.level].label)
    assert.equal(r.cost, LADDER[r.level].cost)
  }
  assert.match(risks[2].reason, /vision retries/)
  assert.deepEqual(ladderRisks({ ...MIXED, fallbackRisks: [] }), [])
  assert.deepEqual(ladderRisks(null), [])
})

test('the together row names the domains that cannot hold at once (L6)', () => {
  const [r] = ladderRisks({ fallbackRisks: [{ kind: 'together', level: 6, domains: ['vision', 'grasp'] }] })
  assert.equal(r.level, 6)
  assert.match(r.reason, /vision \+ grasp together/)
})

test('an undeclared reason, kind or level throws rather than being shown as something else (#31)', () => {
  assert.throws(() => ladderRisks({ fallbackRisks: [{ kind: 'domain', domain: 'path', level: 4, reason: 'vibes' }] }), /undeclared risk reason/)
  assert.throws(() => ladderRisks({ fallbackRisks: [{ kind: 'maybe', level: 4 }] }), /undeclared risk kind/)
  assert.throws(() => ladderRisks({ fallbackRisks: [{ kind: 'domain', domain: 'path', level: 9, reason: 'someUnreachable' }] }), /undeclared ladder level/)
})

test('the reason words cover exactly the contract\'s closed reason vocabulary (population = the schema)', () => {
  const schema = JSON.parse(readFileSync(
    new URL('../../packages/grasp-contract/schema/grasp-search-response.schema.json', import.meta.url), 'utf8'))
  const domainBranch = schema.$defs.fallbackRisk.oneOf.find(b => b.properties.kind.const === 'domain')
  assert.deepEqual(Object.keys(RISK_REASON_TEXT).sort(), [...domainBranch.properties.reason.enum].sort())
})
