/**
 * Layout DSL schema conformance + drift binding (ADR-064 Phase 2).
 *
 * The schema (schema/layout-1.0.schema.json) is the SHAPE contract for the
 * Layout DSL — a closed, versioned JSON Schema artifact given the same
 * treatment grasp-contract received (PHILOSOPHY #29). This suite proves:
 *
 *   1. Conformance — the bundled examples/*.json conform to the schema.
 *   2. additionalProperties:false — a smuggled field is rejected (negative).
 *   3. Drift binding — the schema's enum vocabularies are pinned to the
 *      LayoutDslSchema.js constants used by the JS validator, so a second
 *      definition cannot silently drift (§1.1: one source, machine-checked).
 *
 * The MEANING contract (ref resolution, ref uniqueness) stays in
 * LayoutValidator.js and is exercised by its own tests.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

import {
  LAYOUT_DSL_VERSION,
  VALID_STRATEGIES,
  VALID_AXES,
  VALID_ENTITY_TYPES,
  VALID_JOINT_TYPES,
  VALID_SEMANTIC_TYPES,
} from '../layout/LayoutDslSchema.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))

const schema = readJson('schema/layout-1.0.schema.json')
const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

// ── 1. Conformance: bundled examples pass ────────────────────────────────────

test('factory_layout.json conforms to layout-1.0 schema', () => {
  const valid = validate(readJson('examples/factory_layout.json'))
  assert.equal(valid, true, JSON.stringify(validate.errors, null, 2))
})

// ── 2. additionalProperties:false — smuggled fields are rejected ─────────────

test('an unknown top-level field is rejected', () => {
  assert.equal(validate({
    version: 'layout/1.0',
    entities: [{ ref: 'a', type: 'Solid', name: 'A' }],
    solverHint: 'rrt', // not in the contract
  }), false)
})

test('an unknown entity field is rejected', () => {
  assert.equal(validate({
    version: 'layout/1.0',
    entities: [{ ref: 'a', type: 'Solid', name: 'A', color: '#f00' }],
  }), false)
})

test('a bad version is rejected', () => {
  assert.equal(validate({ version: 'layout/9.9', entities: [] }), false)
})

test('an unknown strategy enum value is rejected', () => {
  assert.equal(validate({
    version: 'layout/1.0',
    strategy: 'spiral',
    entities: [{ ref: 'a', type: 'Solid', name: 'A' }],
  }), false)
})

test('an unknown entity type enum value is rejected', () => {
  assert.equal(validate({
    version: 'layout/1.0',
    entities: [{ ref: 'a', type: 'Torus', name: 'A' }],
  }), false)
})

test('a null jointType (topological link) is accepted', () => {
  assert.equal(validate({
    version: 'layout/1.0',
    entities: [{ ref: 'a', type: 'Solid', name: 'A' }, { ref: 'b', type: 'Solid', name: 'B' }],
    constraints: [{ source: 'a', target: 'b', jointType: null, semanticType: 'adjacent' }],
  }), true, JSON.stringify(validate.errors))
})

// ── 3. Drift binding: schema enums === LayoutDslSchema.js constants ──────────
// If a constant gains a value the schema does not, CI fails here — the two
// definitions cannot diverge unnoticed (§1.1).

test('schema version const is pinned to LAYOUT_DSL_VERSION', () => {
  assert.equal(schema.properties.version.const, LAYOUT_DSL_VERSION)
})

test('schema strategy enum matches VALID_STRATEGIES', () => {
  assert.deepEqual(schema.properties.strategy.enum, VALID_STRATEGIES)
})

test('schema axis enum matches VALID_AXES', () => {
  assert.deepEqual(schema.$defs.strategyOptions.properties.axis.enum, VALID_AXES)
})

test('schema entity type enum matches VALID_ENTITY_TYPES', () => {
  assert.deepEqual(schema.$defs.entity.properties.type.enum, VALID_ENTITY_TYPES)
})

test('schema jointType enum matches VALID_JOINT_TYPES', () => {
  const jt = schema.$defs.constraint.properties.jointType.oneOf.find((s) => s.enum)
  assert.deepEqual(jt.enum, VALID_JOINT_TYPES)
})

test('schema semanticType enum matches VALID_SEMANTIC_TYPES', () => {
  assert.deepEqual(schema.$defs.constraint.properties.semanticType.enum, VALID_SEMANTIC_TYPES)
})
