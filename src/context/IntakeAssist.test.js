/**
 * IntakeAssist tests — pure helpers behind the playful intake surface
 * (ADR-058 "UX 具体化"). Bare `node --test`, THREE-free.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isInterval,
  refStatus,
  suggestRef,
  matchesSeed,
  actorGaps,
  variableGaps,
  requirementGaps,
  kpiCatalogChips,
  seedCardLines,
} from './IntakeAssist.js'
import { isInterval as validatorIsInterval } from './ContextValidator.js'
import { ROLE_KPI_CATALOG } from './RoleKpiCatalog.js'

// ── B-2: same-function-reference guarantee ────────────────────────────────────

test('isInterval IS the validator predicate (same function reference, ADR-058 §B-2)', () => {
  assert.equal(isInterval, validatorIsInterval)
})

// ── refStatus / suggestRef (A-3) ─────────────────────────────────────────────

test('refStatus: empty / free / taken', () => {
  assert.equal(refStatus(['a', 'b'], ''), 'empty')
  assert.equal(refStatus(['a', 'b'], '   '), 'empty')
  assert.equal(refStatus(['a', 'b'], 'c'), 'free')
  assert.equal(refStatus(['a', 'b'], ' a '), 'taken')
  assert.equal(refStatus(undefined, 'a'), 'free')
})

test('suggestRef: returns the stem when free, else the first free number', () => {
  assert.equal(suggestRef([], 'r_reach'), 'r_reach')
  assert.equal(suggestRef(['r_reach'], 'r_reach'), 'r_reach_2')
  assert.equal(suggestRef(['r_reach', 'r_reach_2'], 'r_reach'), 'r_reach_3')
})

test('suggestRef: strips _copy / _<n> scars before numbering', () => {
  assert.equal(suggestRef(['r_reach'], 'r_reach_copy'), 'r_reach_2')
  assert.equal(suggestRef(['r_reach', 'r_reach_2'], 'r_reach_2'), 'r_reach_3')
  assert.equal(suggestRef([], ''), '')
})

// ── matchesSeed (A-2) ────────────────────────────────────────────────────────

test('matchesSeed: normalized string comparison; null seed never matches', () => {
  assert.equal(matchesSeed('developer', 'developer'), true)
  assert.equal(matchesSeed(400, '400'), true)
  assert.equal(matchesSeed(400, ' 400 '), true)
  assert.equal(matchesSeed('developer', 'maintainer'), false)
  assert.equal(matchesSeed(null, ''), false)
  assert.equal(matchesSeed(undefined, 'undefined'), false)
})

// ── gaps functions (B-1: the submit predicate, printed as reasons) ───────────

test('actorGaps: empty ref is the only gap', () => {
  assert.deepEqual(actorGaps({ ref: '' }), ['ref is empty'])
  assert.deepEqual(actorGaps({ ref: 'a_robot' }), [])
})

test('variableGaps: covers ref, unit, numeric domain, and interval order', () => {
  assert.deepEqual(variableGaps({ ref: 'v', unit: 'mm', lo: '0', hi: '10' }), [])
  assert.ok(variableGaps({ ref: '', unit: 'mm', lo: '0', hi: '10' }).includes('ref is empty'))
  assert.ok(variableGaps({ ref: 'v', unit: '', lo: '0', hi: '10' }).includes('unit is empty'))
  assert.ok(variableGaps({ ref: 'v', unit: 'mm', lo: '', hi: '10' })
    .includes('domain lo / hi must be numbers'))
  // hi <= lo goes through the validator's isInterval — same rule as commit
  assert.ok(variableGaps({ ref: 'v', unit: 'mm', lo: '10', hi: '10' })
    .includes('domain hi must be greater than lo'))
})

test('requirementGaps: complete form has no gaps; each missing field is named', () => {
  const full = {
    ref: 'r', by: 'a', kpiName: 'reach', constrains: 'v',
    val: '400', admLo: '400', admHi: '800',
  }
  assert.deepEqual(requirementGaps(full), [])
  assert.ok(requirementGaps({ ...full, by: '' }).includes('by (actor) is not selected'))
  assert.ok(requirementGaps({ ...full, constrains: '' })
    .includes('constrains (variable) is not selected'))
  assert.ok(requirementGaps({ ...full, val: 'x' }).includes('threshold must be a number'))
  assert.ok(requirementGaps({ ...full, admLo: '900' })
    .includes('admissible hi must be greater than lo'))
})

// ── kpiCatalogChips (A-6) ────────────────────────────────────────────────────

test('kpiCatalogChips: flattens the catalog, discipline-grouped, no fabricated fields', () => {
  const chips = kpiCatalogChips()
  const total = Object.values(ROLE_KPI_CATALOG).reduce((n, a) => n + a.length, 0)
  assert.equal(chips.length, total)
  assert.deepEqual(chips.find(c => c.name === 'resolution'), { discipline: 'vision', name: 'resolution' })
  // custom catalog respected (ctx.kpiCatalog override path)
  assert.deepEqual(kpiCatalogChips({ sw: ['latency'] }), [{ discipline: 'sw', name: 'latency' }])
})

// ── seedCardLines (A-1) ──────────────────────────────────────────────────────

test('seedCardLines: lists only fields the entry has', () => {
  const lines = seedCardLines('requirement', {
    ref: 'r_reach', by: 'a_robot',
    kpi: { name: 'reach', unit: 'mm' },
    criterion: { op: '>=', value: 400 },
    constrains: ['v_reach'],
    admissible: { interval: [400, 800] },
  })
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l.value]))
  assert.equal(byLabel.ref, 'r_reach')
  assert.equal(byLabel.KPI, 'reach')
  assert.equal(byLabel.criterion, '>= 400')
  assert.equal(byLabel.admissible, '[400, 800]')
  assert.equal(byLabel.expr, undefined)          // absent field → no line
  assert.deepEqual(seedCardLines('actor', null), [])
})

test('seedCardLines: variable kind formats domain via the shared interval predicate', () => {
  const lines = seedCardLines('variable', { ref: 'v', unit: 'mm', domain: [0, 100] })
  assert.ok(lines.some(l => l.label === 'domain' && l.value === '[0, 100]'))
  // malformed domain → honestly omitted, not rendered broken
  const bad = seedCardLines('variable', { ref: 'v', unit: 'mm', domain: [100, 0] })
  assert.ok(!bad.some(l => l.label === 'domain'))
})
