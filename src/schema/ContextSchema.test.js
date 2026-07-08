/**
 * Context DSL schema conformance + drift binding (ADR-064 Phase 2).
 *
 * The schema (schema/context-0.4.schema.json) is the SHAPE contract for the
 * Context DSL — a closed, versioned JSON Schema artifact (PHILOSOPHY #29).
 * This suite proves:
 *
 *   1. Conformance — every bundled context example (0.1-0.4) conforms.
 *   2. additionalProperties:false — smuggled fields are rejected (negative).
 *   3. Drift binding — the schema's enum vocabularies are pinned to the
 *      ContextDslSchema.js constants the ContextValidator uses (§1.1).
 *
 * The MEANING contract (R1-R9: orphan-spec, conflicts, negotiation clusters,
 * blocked acceptance, stated->derived promotion, role-KPI obligations) stays
 * in ContextValidator.js and is exercised by the ContextCompiler/Conflict/
 * Phase2-4 suites — the schema is the shape, the validator is the meaning.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

import {
  SUPPORTED_VERSIONS,
  VALID_ROLES,
  VALID_FACT_STATUS,
  VALID_CHECK_MODES,
  VALID_TRACE_KINDS,
  VALID_DECISION_STATUS,
  VALID_NEGOTIABILITY,
  VALID_ADMISSIBLE_SOURCE,
  VALID_REGION_KINDS,
  VALID_PREDICATE_KINDS,
} from '../context/ContextDslSchema.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))

const schema = readJson('schema/context-0.4.schema.json')
const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

const EXAMPLES = [
  'factory_context.json',        // context/0.1
  'cell_phase2_context.json',    // context/0.2
  'cell_conflict_context.json',  // context/0.2
  'cell_region_context.json',    // context/0.3
  'cell_robotics_context.json',  // context/0.4
]

// ── 1. Conformance: every bundled context example passes ─────────────────────

for (const f of EXAMPLES) {
  test(`${f} conforms to context-0.4 schema`, () => {
    const valid = validate(readJson(`examples/${f}`))
    assert.equal(valid, true, JSON.stringify(validate.errors, null, 2))
  })
}

// ── 2. additionalProperties:false — smuggled fields are rejected ─────────────

test('an unknown top-level field is rejected', () => {
  assert.equal(validate({ version: 'context/0.4', solverHint: 'rrt' }), false)
})

test('an unknown actor field is rejected', () => {
  assert.equal(validate({
    version: 'context/0.4',
    actors: [{ ref: 'a', role: 'developer', seniority: 'lead' }],
  }), false)
})

test('an unknown requirement field is rejected', () => {
  assert.equal(validate({
    version: 'context/0.4',
    requirements: [{ ref: 'r', priority: 9 }],
  }), false)
})

test('a bad version is rejected', () => {
  assert.equal(validate({ version: 'context/9.9' }), false)
})

test('an unknown fact status enum value is rejected', () => {
  assert.equal(validate({
    version: 'context/0.4',
    given: [{ ref: 'g', status: 'rumored' }],
  }), false)
})

test('an unknown predicate kind enum value is rejected', () => {
  assert.equal(validate({
    version: 'context/0.4',
    acceptance: [{ ref: 'a', predicate: { kind: 'teleport' } }],
  }), false)
})

test('a smuggled predicate operand field is rejected', () => {
  assert.equal(validate({
    version: 'context/0.4',
    acceptance: [{ ref: 'a', predicate: { kind: 'no_overlap', meterColor: '#f00' } }],
  }), false)
})

test('a bare requirements-only doc (no specification) still conforms', () => {
  // Authoring-stage docs derive no scene; the schema must accept them
  // (ADR-051 Entry A / the "requirements-only doc" contract).
  assert.equal(validate({
    version: 'context/0.4',
    actors: [{ ref: 'a', role: 'developer' }],
    requirements: [{ ref: 'r', by: 'a' }],
  }), true, JSON.stringify(validate.errors))
})

test('a hydrated {$fact} ref leaf in specification.layout is accepted', () => {
  assert.equal(validate({
    version: 'context/0.4',
    specification: {
      layout: {
        version: 'layout/1.0',
        entities: [{ ref: 'e', type: 'Solid', dimensions: { x: { $fact: 'g_dim' }, y: 100, z: 50 } }],
      },
    },
  }), true, JSON.stringify(validate.errors))
})

// ── 3. Drift binding: schema enums === ContextDslSchema.js constants ─────────

test('schema version enum matches SUPPORTED_VERSIONS', () => {
  assert.deepEqual(schema.properties.version.enum, SUPPORTED_VERSIONS)
})

test('schema role enum matches VALID_ROLES', () => {
  assert.deepEqual(schema.$defs.actor.properties.role.enum, VALID_ROLES)
})

test('schema fact status enum matches VALID_FACT_STATUS', () => {
  assert.deepEqual(schema.$defs.fact.properties.status.enum, VALID_FACT_STATUS)
})

test('schema check mode enum matches VALID_CHECK_MODES', () => {
  assert.deepEqual(schema.$defs.acceptance.properties.mode.enum, VALID_CHECK_MODES)
})

test('schema trace kind enum matches VALID_TRACE_KINDS', () => {
  assert.deepEqual(schema.$defs.trace.properties.kind.enum, VALID_TRACE_KINDS)
})

test('schema decision status enum matches VALID_DECISION_STATUS', () => {
  assert.deepEqual(schema.$defs.decision.properties.status.enum, VALID_DECISION_STATUS)
})

test('schema negotiability enum matches VALID_NEGOTIABILITY', () => {
  assert.deepEqual(schema.$defs.requirement.properties.negotiability.enum, VALID_NEGOTIABILITY)
})

test('schema admissible source enum matches VALID_ADMISSIBLE_SOURCE', () => {
  assert.deepEqual(schema.$defs.requirement.properties.admissible.properties.source.enum, VALID_ADMISSIBLE_SOURCE)
})

test('schema region kind enum matches VALID_REGION_KINDS', () => {
  assert.deepEqual(schema.$defs.variable.properties.region.properties.kind.enum, VALID_REGION_KINDS)
})

test('schema predicate kind enum matches VALID_PREDICATE_KINDS', () => {
  assert.deepEqual(schema.$defs.predicateObject.properties.kind.enum, VALID_PREDICATE_KINDS)
})
