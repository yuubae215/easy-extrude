/**
 * ContextPhase2.test.js — ADR-049 Phase 2:
 *   - stated → derived auto-promotion (AdmissiblePromotion)
 *   - R8 role-KPI catalog (ContextValidator + RoleKpiCatalog)
 *   - form projection (FormProjection)
 *
 * Run with:  pnpm test:context
 *
 * Scenario: examples/cell_phase2_context.json
 *   - r_resolution: closed-form monotonic KPI (resolution = 3500/WD) ≥ 10
 *     → promotes stated [200,350] to derived [100,350] over domain [100,1000]
 *   - r_wd_floor: stated [400,600], no KPI → stays stated, R9 fires, and after
 *     promotion conflicts with r_resolution (gap [350,400])
 *   - robot discipline is missing its catalog-mandatory KPIs → R8 fires
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compileContext } from './ContextCompiler.js'
import { validateContext } from './ContextValidator.js'
import { promoteAdmissible } from './AdmissiblePromotion.js'
import { projectForm, ANSWER_KIND } from './FormProjection.js'

const here = dirname(fileURLToPath(import.meta.url))
const loadScenario = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_phase2_context.json'), 'utf8'))

// ── stated → derived auto-promotion ───────────────────────────────────────────

test('promotion: a closed-form monotonic KPI promotes a stated interval to derived', () => {
  const ctx = loadScenario()
  const result = validateContext(ctx)
  assert.equal(result.valid, true, result.errors.join('\n'))

  assert.deepStrictEqual(result.promoted, ['r_resolution'])
})

test('promotion: the derived interval is the preimage of the criterion over the domain', () => {
  const variables = new Map([['v_wd', { ref: 'v_wd', unit: 'mm', domain: [100, 1000] }]])
  const requirements = new Map([
    ['r', { ref: 'r', by: 'a', constrains: ['v_wd'],
            kpi: { name: 'resolution', expr: '3500 / v_wd' },
            criterion: { op: '>=', value: 10 },
            admissible: { interval: [200, 350], source: 'stated' } }],
  ])
  const { requirements: out, promoted } = promoteAdmissible(requirements, variables, new Map())

  assert.deepStrictEqual(promoted, ['r'])
  const adm = out.get('r').admissible
  assert.equal(adm.source, 'derived')
  assert.equal(adm.promotedFrom, 'stated')
  assert.ok(Math.abs(adm.interval[0] - 100) < 1e-3, `lo ≈ 100, got ${adm.interval[0]}`)
  assert.ok(Math.abs(adm.interval[1] - 350) < 1e-3, `hi ≈ 350, got ${adm.interval[1]}`)
})

test('promotion: input requirements Map is never mutated (returns a new instance)', () => {
  const ctx = loadScenario()
  const requirements = new Map((ctx.requirements ?? []).map(r => [r.ref, r]))
  const variables    = new Map((ctx.variables    ?? []).map(v => [v.ref, v]))
  const before = JSON.stringify(requirements.get('r_resolution'))

  const { requirements: out } = promoteAdmissible(requirements, variables, new Map())

  assert.equal(JSON.stringify(requirements.get('r_resolution')), before, '入力は不変であること')
  assert.notEqual(out.get('r_resolution'), requirements.get('r_resolution'), '昇格分は新インスタンス')
})

test('promotion: an opaque function-call KPI is NOT promotable (stays stated)', () => {
  const variables = new Map([['v_wd', { ref: 'v_wd', unit: 'mm', domain: [100, 1000] }]])
  const requirements = new Map([
    ['r', { ref: 'r', by: 'a', constrains: ['v_wd'],
            kpi: { name: 'margin', expr: 'wrist_margin(v_wd)' },
            criterion: { op: '>=', value: 15 },
            admissible: { interval: [380, 600], source: 'stated' } }],
  ])
  const { promoted, requirements: out } = promoteAdmissible(requirements, variables, new Map())

  assert.deepStrictEqual(promoted, [])
  assert.equal(out.get('r').admissible.source, 'stated')
})

test('promotion: a non-monotonic KPI over the domain is NOT promotable', () => {
  const variables = new Map([['v_wd', { ref: 'v_wd', unit: 'mm', domain: [100, 1000] }]])
  const requirements = new Map([
    ['r', { ref: 'r', by: 'a', constrains: ['v_wd'],
            kpi: { name: 'parabola', expr: 'v_wd * (1000 - v_wd)' }, // vertex at 500 ∈ domain
            criterion: { op: '>=', value: 1 },
            admissible: { interval: [200, 800], source: 'stated' } }],
  ])
  assert.deepStrictEqual(promoteAdmissible(requirements, variables, new Map()).promoted, [])
})

test('promotion: identifiers resolve to numeric fact values', () => {
  const variables = new Map([['v_wd', { ref: 'v_wd', unit: 'mm', domain: [100, 1000] }]])
  const facts = new Map([['f_cam', { ref: 'f_cam', sensor: { px: { value: 3500 } } }]])
  const requirements = new Map([
    ['r', { ref: 'r', by: 'a', constrains: ['v_wd'],
            kpi: { name: 'resolution', expr: 'f_cam.sensor.px.value / v_wd' },
            criterion: { op: '>=', value: 10 },
            admissible: { interval: [200, 350], source: 'stated' } }],
  ])
  const { requirements: out, promoted } = promoteAdmissible(requirements, variables, facts)
  assert.deepStrictEqual(promoted, ['r'])
  assert.ok(Math.abs(out.get('r').admissible.interval[1] - 350) < 1e-3)
})

test('promotion: a stated region without a KPI is left for R9 (not promoted)', () => {
  const ctx = loadScenario()
  const result = validateContext(ctx)
  assert.ok(!result.promoted.includes('r_wd_floor'))
  assert.ok(result.openQuestions.some(oq => oq.ref === 'oq_kpi_r_wd_floor'))
})

// ── promoted interval feeds R6 ────────────────────────────────────────────────

test('R6 uses the derived (promoted) interval, not the original stated one', () => {
  const { conflicts } = validateContext(loadScenario())
  const conflict = conflicts.find(c => c.ref === 'conflict_v_working_distance')
  assert.ok(conflict, 'derived [100,350] vs stated [400,600] が衝突すること')
  assert.deepStrictEqual(conflict.admissibleSets.r_resolution, [100, 350])
  assert.deepStrictEqual(conflict.gap, [350, 400])
})

// ── R8 role-KPI catalog ───────────────────────────────────────────────────────

test('R8: a discipline missing its catalog-mandatory KPI raises an OpenQuestion', () => {
  const { openQuestions } = validateContext(loadScenario())
  const refs = openQuestions.map(oq => oq.ref)
  assert.ok(refs.includes('oq_rolekpi_robot_singularityMargin'))
  assert.ok(refs.includes('oq_rolekpi_robot_cycleTime'))
})

test('R8: a discipline that contributes its mandatory KPI raises no OpenQuestion', () => {
  // vision requires "resolution"; r_resolution (by vision_engineer) supplies it
  const { openQuestions } = validateContext(loadScenario())
  assert.ok(!openQuestions.some(oq => oq.ref.startsWith('oq_rolekpi_vision_')))
})

test('R8: ctx.kpiCatalog overrides the default catalog', () => {
  const ctx = loadScenario()
  ctx.kpiCatalog = { robot: [], vision: ['resolution', 'mtf'] }

  const { openQuestions } = validateContext(ctx)
  const refs = openQuestions.map(oq => oq.ref)
  assert.ok(refs.includes('oq_rolekpi_vision_mtf'), '上書きしたカタログの未充足 KPI が問われること')
  assert.ok(!refs.some(r => r.startsWith('oq_rolekpi_robot_')), '空にした robot は問われないこと')
})

// ── form projection ───────────────────────────────────────────────────────────

test('form projection: every OpenQuestion becomes a sorted form question', () => {
  const result = validateContext(loadScenario())
  const form = projectForm(result)

  assert.equal(form.length, result.openQuestions.length)
  const refs = form.map(q => q.ref)
  assert.deepStrictEqual(refs, [...refs].sort(), 'ref でソートされていること')
})

test('form projection: answer kinds map per raising rule', () => {
  const form = projectForm(validateContext(loadScenario()))
  const byRef = new Map(form.map(q => [q.ref, q]))

  assert.equal(byRef.get('oq_kpi_r_wd_floor').answerKind, ANSWER_KIND.KPI_CRITERION)
  assert.equal(byRef.get('oq_rolekpi_robot_cycleTime').answerKind, ANSWER_KIND.REQUIREMENT)
})

test('form projection: answering every question empties the form (machine-checkable completion)', () => {
  const ctx = loadScenario()
  // answer R9: give r_wd_floor a KPI backing (and let it auto-promote)
  const wdFloor = ctx.requirements.find(r => r.ref === 'r_wd_floor')
  wdFloor.kpi = { name: 'reach', expr: 'v_working_distance', unit: 'mm' }
  wdFloor.criterion = { op: '>=', value: 400 }
  // answer R8: robot contributes its mandatory KPIs
  ctx.requirements.push(
    { ref: 'r_sing', by: 'robot_engineer', constrains: ['v_working_distance'],
      kpi: { name: 'singularityMargin', expr: 'v_working_distance', unit: 'deg' },
      criterion: { op: '>=', value: 0 }, admissible: { interval: [100, 1000], source: 'stated' } },
    { ref: 'r_cycle', by: 'robot_engineer', constrains: ['v_working_distance'],
      kpi: { name: 'cycleTime', expr: 'v_working_distance', unit: 's' },
      criterion: { op: '<=', value: 1000 }, admissible: { interval: [100, 1000], source: 'stated' } },
  )

  const form = projectForm(validateContext(ctx))
  assert.deepStrictEqual(form, [], '全問に答えるとフォームが空になること')
})

// ── determinism ───────────────────────────────────────────────────────────────

test('Phase 2 validator output is deterministic across runs', () => {
  assert.deepStrictEqual(validateContext(loadScenario()), validateContext(loadScenario()))
})

test('compileContext surfaces the promoted refs', () => {
  const out = compileContext(loadScenario())
  assert.deepStrictEqual(out.promoted, ['r_resolution'])
})
