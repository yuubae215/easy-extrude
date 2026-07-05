/**
 * RoleKpiCatalog tests — role-kpi/2.0 expression assets (ADR-063 Phase 1).
 * Bare `node --test`, THREE-free.
 *
 * The two contracts under test:
 *   1. R8 compatibility — `requiredKpis` reads the SAME catalog (one source)
 *      and accepts both 2.0 asset objects and legacy 1.0 name arrays.
 *   2. Instantiation honesty — `instantiateKpiExpr` substitutes what it can
 *      and leaves unresolved placeholders verbatim (PHILOSOPHY #11).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_KPI_CATALOG,
  ROLE_KPI_CATALOG_VERSION,
  requiredKpis,
  kpiEntryName,
  instantiateKpiExpr,
} from './RoleKpiCatalog.js'

test('catalog version is role-kpi/2.0', () => {
  assert.equal(ROLE_KPI_CATALOG_VERSION, 'role-kpi/2.0')
})

test('every 2.0 asset is well-formed: name/unit/exprTemplate/description strings, params array', () => {
  for (const [discipline, entries] of Object.entries(ROLE_KPI_CATALOG)) {
    assert.ok(entries.length > 0, `${discipline} has at least one asset`)
    for (const asset of entries) {
      assert.equal(typeof asset.name, 'string')
      assert.equal(typeof asset.unit, 'string')
      assert.equal(typeof asset.exprTemplate, 'string')
      assert.ok(asset.exprTemplate.includes('{var}'),
        `${asset.name}: exprTemplate must reference the constrained variable`)
      assert.ok(Array.isArray(asset.params))
      for (const p of asset.params) {
        assert.equal(typeof p.key, 'string')
        assert.ok(asset.exprTemplate.includes(`{${p.key}}`),
          `${asset.name}: param "${p.key}" must appear in the template`)
      }
      assert.equal(typeof asset.description, 'string')
      assert.ok(['>=', '<=', '>', '<', '=='].includes(asset.suggestedOp))
    }
  }
})

test('requiredKpis: 2.0 default catalog yields the ADR-049 mandatory names (R8 semantics unchanged)', () => {
  assert.deepEqual(requiredKpis('vision'), ['resolution'])
  assert.deepEqual(requiredKpis('robot'), ['singularityMargin', 'cycleTime'])
  assert.deepEqual(requiredKpis('mech'), ['installClearance'])
  assert.deepEqual(requiredKpis('eoat'), ['tcpClearance'])
  assert.deepEqual(requiredKpis('unknown'), [])
})

test('requiredKpis: a legacy 1.0 name-array override still validates (additive)', () => {
  const legacy = { robot: [], vision: ['resolution', 'mtf'] }
  assert.deepEqual(requiredKpis('vision', legacy), ['resolution', 'mtf'])
  assert.deepEqual(requiredKpis('robot', legacy), [])
  // mixed shapes tolerated; nameless junk is skipped, never fabricated
  assert.deepEqual(requiredKpis('x', { x: ['a', { name: 'b' }, {}, 42] }), ['a', 'b'])
})

test('kpiEntryName: string → itself, asset → .name, junk → null', () => {
  assert.equal(kpiEntryName('cycleTime'), 'cycleTime')
  assert.equal(kpiEntryName({ name: 'resolution' }), 'resolution')
  assert.equal(kpiEntryName({}), null)
  assert.equal(kpiEntryName(null), null)
})

test('instantiateKpiExpr: substitutes {var} and curated param examples', () => {
  const asset = ROLE_KPI_CATALOG.vision[0]
  assert.equal(instantiateKpiExpr(asset, 'v_working_distance'), '3500 / v_working_distance')
})

test('instantiateKpiExpr: unresolved placeholders stay verbatim — never guessed (PHILOSOPHY #11)', () => {
  const asset = ROLE_KPI_CATALOG.vision[0]
  assert.equal(instantiateKpiExpr(asset, ''), '3500 / {var}')
  const noExample = { exprTemplate: '{a} + {var}', params: [{ key: 'a' }] }
  assert.equal(instantiateKpiExpr(noExample, 'v'), '{a} + v')
  assert.equal(instantiateKpiExpr({}, 'v'), '')
})

test('instantiateKpiExpr: does not mutate the asset (input-immutable)', () => {
  const asset = ROLE_KPI_CATALOG.mech[0]
  const before = JSON.stringify(asset)
  instantiateKpiExpr(asset, 'v_envelope')
  assert.equal(JSON.stringify(asset), before)
})
