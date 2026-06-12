/**
 * ContextCompiler.test.js — golden test for the Context DSL MVP (ADR-046).
 *
 * Run with:  node --test src/context/
 *
 * Golden contract:
 *   compileContext(examples/factory_context.json).layoutDsl
 *     ≡ examples/factory_layout.json                      (deep equality)
 *   and the full chain compileLayout(∘ compileContext) yields the same scene
 *   as compileLayout applied to the hand-written golden layout.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compileContext, extractProvenance } from './ContextCompiler.js'
import { validateContext } from './ContextValidator.js'
import { validateLayoutDsl } from '../layout/LayoutValidator.js'
import { compileLayout, buildRefMap, linkIdForConstraint } from '../layout/LayoutCompiler.js'

const here = dirname(fileURLToPath(import.meta.url))

function loadJson(relPath) {
  return JSON.parse(readFileSync(join(here, relPath), 'utf8'))
}

const loadContext = () => loadJson('../../examples/factory_context.json')
const loadGolden  = () => loadJson('../../examples/factory_layout.json')

// ── 1. Golden equality ────────────────────────────────────────────────────────

test('golden: factory_context compiles to exactly factory_layout', () => {
  const { layoutDsl } = compileContext(loadContext())
  assert.deepStrictEqual(layoutDsl, loadGolden())
})

// ── 2. Full chain through the existing layout compiler ───────────────────────

test('chain: compiled layout is valid layout/1.0 and yields the same scene as the golden file', () => {
  const { layoutDsl } = compileContext(loadContext())

  const validation = validateLayoutDsl(layoutDsl)
  assert.equal(validation.valid, true, validation.errors.join('\n'))

  const sceneFromContext = compileLayout(layoutDsl)
  const sceneFromGolden  = compileLayout(loadGolden())
  assert.deepStrictEqual(sceneFromContext, sceneFromGolden)
})

// ── 3. OpenQuestions are generated, not authored ──────────────────────────────

test('validator emits the expected OpenQuestions for the scenario', () => {
  const { openQuestions } = compileContext(loadContext())
  const refs = openQuestions.map(oq => oq.ref)

  assert.ok(refs.includes('oq_unknown_f_outlet_ratedCurrent'),   'コンセント定格電流の未確認が検出されること')
  assert.ok(refs.includes('oq_unknown_f_outlet_circuitSharing'), '回路共有の未確認が検出されること')
  assert.ok(refs.includes('oq_unknown_f_bench_loadCapacity'),    '作業台耐荷重の未確認が検出されること')
  assert.ok(refs.includes('oq_unknown_f_cell_area_footprint'),   'セル専有面積の未実測が検出されること')
  assert.ok(refs.includes('oq_scope_o_power'),                   '給電工事の責任区分未合意が検出されること')
})

// ── 4. Blocked acceptance checks (invariant 3) ────────────────────────────────

test('acceptance checks depending on unknown/assumed facts are blocked', () => {
  const { blockedChecks } = compileContext(loadContext())
  const blockedRefs = blockedChecks.map(b => b.check)

  assert.ok(blockedRefs.includes('a_power'),  'a_power は定格電流不明によりブロックされること')
  assert.ok(blockedRefs.includes('a_torque'), 'a_torque はボルト仕様が assumed のためブロックされること')
  assert.ok(!blockedRefs.includes('a_depal_cycle'), 'a_depal_cycle はブロックされないこと')
  assert.ok(!blockedRefs.includes('a_plate_fit'),   'a_plate_fit はブロックされないこと')
})

// ── 5. Orphan spec detection (invariant 1) ────────────────────────────────────

test('removing a TraceLink makes the context invalid (no orphan spec)', () => {
  const ctx = loadContext()
  ctx.specification.trace = ctx.specification.trace.filter(link => link.to !== 'base_plate')

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('orphan spec') && e.includes('base_plate')))
  assert.throws(() => compileContext(ctx))
})

// ── 6. Intervals require an explicit Decision (invariant 2) ───────────────────

test('referencing an interval fact directly via $fact throws', () => {
  const ctx = loadContext()
  const workbench = ctx.specification.layout.entities.find(e => e.ref === 'workbench')
  workbench.position.x = { '$fact': 'f_outlet_to_bench.quantity' }

  assert.throws(() => compileContext(ctx), /interval/)
})

// ── 7. Unknown facts cannot flow into the spec ────────────────────────────────

test('referencing an "unknown" attribute via $fact throws', () => {
  const ctx = loadContext()
  const constraint = ctx.specification.layout.constraints.find(c => c.semanticType === 'connects')
  constraint.properties.ratedCurrent_A = { '$fact': 'f_outlet.attrs.ratedCurrent' }

  assert.throws(() => compileContext(ctx), /unknown/)
})

// ── 8a. Provenance extraction (uncertainty visualization input) ───────────────

test('provenance: workbench position.x is decision-driven and carries the source interval', () => {
  const { provenance } = compileContext(loadContext())

  const p = provenance.find(r => r.entityRef === 'workbench' && r.path === 'position.x')
  assert.ok(p, 'workbench position.x の provenance が存在すること')
  assert.equal(p.marker, 'decision')
  assert.equal(p.ref, 'd_bench_distance')
  assert.equal(p.nominal, 2800)
  assert.equal(p.resolvesFact, 'f_outlet_to_bench')
  assert.deepStrictEqual(p.interval, [2700, 3000])
  assert.equal(p.unit, 'mm')
  assert.equal(p.status, 'proposed')
})

test('provenance: exactly one decision marker targets a Solid position axis (demo precondition)', () => {
  const { provenance, layoutDsl } = compileContext(loadContext())
  const solidRefs = new Set(layoutDsl.entities.filter(e => e.type === 'Solid').map(e => e.ref))

  const hits = provenance.filter(r =>
    r.marker === 'decision' && solidRefs.has(r.entityRef) && r.path.startsWith('position.')
  )
  assert.equal(hits.length, 1)
})

test('provenance: fact and expr markers resolve to their concrete values', () => {
  const provenance = extractProvenance(loadContext())

  const dim = provenance.find(r => r.entityRef === 'workbench' && r.path === 'dimensions.x')
  assert.equal(dim.marker, 'fact')
  assert.equal(dim.value, 500)

  const z = provenance.find(r => r.entityRef === 'workbench' && r.path === 'position.z')
  assert.equal(z.marker, 'expr')
  assert.equal(z.value, 400)

  const conn = provenance.find(r => r.entityRef === 'constraint:floor_outlet→workbench_origin'
    && r.path === 'properties.distance_mm')
  assert.equal(conn.marker, 'decision')
})

// ── 8b. Ref map / link id contract (scene id resolution for trace) ────────────

test('buildRefMap and linkIdForConstraint expose deterministic scene ids', () => {
  const { layoutDsl } = compileContext(loadContext())
  const refMap = buildRefMap(layoutDsl.entities)

  assert.equal(refMap.get('workbench'),        'solid_workbench')
  assert.equal(refMap.get('workbench_origin'), 'cf_origin_workbench')
  assert.equal(refMap.get('workbench_top'),    'cf_workbench_workbench_top')
  assert.equal(refMap.get('floor_outlet'),     'ap_floor_outlet')
  assert.equal(refMap.get('cell_area'),        'ar_cell_area')

  const scene = compileLayout(layoutDsl)
  const c1 = layoutDsl.constraints[1]
  assert.equal(scene.links[1].id, linkIdForConstraint(1, c1))
})

// ── 8. Dangling trace sources are rejected ────────────────────────────────────

test('a trace.from pointing at a nonexistent requirement is rejected', () => {
  const ctx = loadContext()
  ctx.specification.trace.push({ from: 'f_ghost', to: 'workbench', kind: 'derives' })

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('f_ghost')))
})
