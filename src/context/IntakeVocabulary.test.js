/**
 * IntakeVocabulary tests — closed selection lists for the intake surfaces
 * (ADR-063 Phase 2, 白紙撲滅). Bare `node --test`, THREE-free.
 *
 * The load-bearing assertions are the single-source ones: the schema enums and
 * the KPI catalog FEED the vocabulary — a drifted UI copy is exactly the bug
 * class this module exists to remove (§1.1 / ADR-058 §B-2 same-reference rule).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, NEGOTIABILITY, CRITERION_OPS, DISCIPLINES, UNITS } from './IntakeVocabulary.js'
import { VALID_ROLES, VALID_NEGOTIABILITY } from './ContextDslSchema.js'
import { ROLE_KPI_CATALOG } from './RoleKpiCatalog.js'

test('ROLES / NEGOTIABILITY are THE schema enums (same array reference)', () => {
  assert.equal(ROLES, VALID_ROLES)
  assert.equal(NEGOTIABILITY, VALID_NEGOTIABILITY)
})

test('DISCIPLINES covers every KPI-catalog discipline (an R8-obligated discipline must be selectable)', () => {
  for (const discipline of Object.keys(ROLE_KPI_CATALOG)) {
    assert.ok(DISCIPLINES.includes(discipline), `missing "${discipline}"`)
  }
  // the pre-vocabulary inline UI list silently lacked 'eoat' — pin the fix
  assert.ok(DISCIPLINES.includes('eoat'))
  assert.equal(new Set(DISCIPLINES).size, DISCIPLINES.length, 'no duplicates')
})

test('UNITS covers every unit the KPI expression assets declare', () => {
  for (const entries of Object.values(ROLE_KPI_CATALOG)) {
    for (const asset of entries) {
      if (typeof asset === 'object' && asset.unit) {
        assert.ok(UNITS.includes(asset.unit), `missing "${asset.unit}"`)
      }
    }
  }
  assert.equal(new Set(UNITS).size, UNITS.length, 'no duplicates')
  assert.ok(UNITS.every(u => typeof u === 'string' && u.length > 0))
})

test('CRITERION_OPS is exactly the invertible/evaluable operator set', () => {
  assert.deepEqual([...CRITERION_OPS].sort(), ['<', '<=', '==', '>', '>='].sort())
})
