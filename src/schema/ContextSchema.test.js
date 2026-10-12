/**
 * Context DSL schema conformance + drift binding (ADR-064 Phase 2).
 *
 * The schema (schema/context-0.6.schema.json) is the SHAPE contract for the
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
  ACCEPTED_ROLE_VALUES,
  LEGACY_END_USER_ROLE,
  VALID_FACT_STATUS,
  VALID_CHECK_MODES,
  VALID_TRACE_KINDS,
  VALID_DECISION_STATUS,
  VALID_NEGOTIABILITY,
  VALID_ADMISSIBLE_SOURCE,
  VALID_REGION_KINDS,
  VALID_PREDICATE_KINDS,
  VALID_PROPOSAL_STATE,
  VALID_AGENDA_STATE,
} from '../context/ContextDslSchema.js'
import { TARGET_KIND } from '../context/Ownership.js'
import { CRITERIA_CATEGORIES } from '../context/CriteriaCatalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))

const schema = readJson('schema/context-0.6.schema.json')
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
  test(`${f} conforms to context-0.6 schema`, () => {
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

test('schema role enum matches VALID_ROLES plus the legacy stance value it still reads', () => {
  assert.deepEqual(schema.$defs.actor.properties.role.enum, [...ACCEPTED_ROLE_VALUES])
  assert.deepEqual(ACCEPTED_ROLE_VALUES, [...VALID_ROLES, LEGACY_END_USER_ROLE])
  assert.ok(!VALID_ROLES.includes(LEGACY_END_USER_ROLE), '立場は職能の列挙に居ない (ADR-165 D1)')
})

// ── ADR-165 PR1: stance, mix and weight (context/0.6) ────────────────────────

test('schema mix keys match CRITERIA_CATEGORIES', () => {
  assert.deepEqual(Object.keys(schema.$defs.actor.properties.mix.properties), [...CRITERIA_CATEGORIES])
})

test('a context/0.6 end user with a mix and a weighted expectation conforms', () => {
  assert.equal(validate({
    version: 'context/0.6',
    actors: [{ ref: 'm', role: 'maintainer', endUser: true, mix: { D: 3, Q: 2, C: 1, S: 4 } }],
    requirements: [{ ref: 'crit_m_takt', by: 'm', owner: 'm', kpi: { name: 'takt', unit: 's' },
      criterion: { op: '<=', value: 6 }, weight: 2 }],
  }), true, JSON.stringify(validate.errors))
})

test('a mix key outside QCD + S, or a negative weight, is rejected', () => {
  assert.equal(validate({ version: 'context/0.6', actors: [{ ref: 'm', endUser: true, mix: { E: 1 } }] }), false)
  assert.equal(validate({ version: 'context/0.6', requirements: [{ ref: 'r', weight: -1 }] }), false)
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

// ── ADR-104: ownership / proposal / agenda (context/0.5) ─────────────────────

test('schema proposal state enum matches VALID_PROPOSAL_STATE', () => {
  assert.deepEqual(schema.$defs.proposal.properties.state.enum, [...VALID_PROPOSAL_STATE])
})

test('schema agenda state enum matches VALID_AGENDA_STATE', () => {
  assert.deepEqual(schema.$defs.agendaItem.properties.state.enum, [...VALID_AGENDA_STATE])
})

test('schema claim-target kind enum matches TARGET_KIND', () => {
  assert.deepEqual(schema.$defs.claimTarget.properties.kind.enum, Object.values(TARGET_KIND))
})

test('a context/0.5 doc with ownership, a proposal and an agenda item conforms', () => {
  assert.equal(validate({
    version: 'context/0.5',
    actors: [{ ref: 'mech', role: 'developer' }, { ref: 'vision', role: 'developer' }],
    requirements: [{ ref: 'r_a', by: 'vision', owner: 'vision' }, { ref: 'r_b', by: 'mech', owner: 'none' }],
    proposals: [{
      ref: 'prop_1', by: 'mech', target: { kind: 'requirement.admissible', ref: 'r_a' },
      from: { interval: [200, 350] }, to: { interval: [300, 450] },
      rationale: 'lens change moves the working distance', state: 'proposed',
    }],
    agenda: [{ ref: 'ag_1', conflict: 'conflict_v_standoff', by: 'mech', state: 'open' }],
  }), true, JSON.stringify(validate.errors))
})

test('a proposal without a diff is still SHAPE-valid — the refusal is a meaning rule', () => {
  // The schema is the shape contract; "from must differ from to" is R11 in the
  // validator (and `makeProposal` refuses to build one at all). Asserting the
  // split keeps the two layers from silently swapping responsibilities.
  assert.equal(validate({
    version: 'context/0.5',
    proposals: [{
      ref: 'prop_1', by: 'mech', target: { kind: 'requirement.admissible', ref: 'r_a' },
      from: { interval: [1, 2] }, to: { interval: [1, 2] }, rationale: 'x', state: 'proposed',
    }],
  }), true, JSON.stringify(validate.errors))
})

test('a smuggled proposal field is rejected', () => {
  assert.equal(validate({
    version: 'context/0.5',
    proposals: [{
      ref: 'prop_1', by: 'mech', target: { kind: 'requirement.admissible', ref: 'r_a' },
      from: 1, to: 2, rationale: 'x', state: 'proposed', stale: true,
    }],
  }), false, 'a `stale` field must not be storable — staleness is derived (ADR-104 U2)')
})

test('a context/0.6 doc with an agreed criteria line and an approved line change conforms (ADR-165 D5)', () => {
  const line = { a: { mix: { D: 1, Q: 1, C: 1, S: 1 }, elements: { takt: { criterion: { op: '<=', value: 10 }, weight: 1 } } } }
  assert.equal(validate({
    version: 'context/0.6',
    actors: [{ ref: 'a', role: 'maintainer', endUser: true }, { ref: 'b', role: 'ehs', endUser: true }],
    requirements: [{ ref: 'crit_a_takt', by: 'a', owner: 'a', kpi: { name: 'takt' }, criterion: { op: '<=', value: 12 }, weight: 1 }],
    proposals: [{
      ref: 'prop_1', by: 'a', target: { kind: 'requirement.criterion', ref: 'crit_a_takt' },
      from: { op: '<=', value: 10 }, to: { op: '<=', value: 12 }, rationale: 'takt', state: 'approved',
      approvals: ['b'], decidedBy: ['b'], approversRequired: ['b'], lineVersion: 2,
    }, {
      ref: 'prop_2', by: 'b', target: { kind: 'actor.mix', ref: 'b' },
      from: { D: 1 }, to: { D: 2 }, rationale: 'mix', state: 'rejected', rejectedBy: ['a'],
    }],
    criteriaAgreement: { agreed: { line, version: 1, by: ['a', 'b'] }, pending: { line, by: ['a'] } },
  }), true, JSON.stringify(validate.errors))
})

test('a stored line status is rejected — the status is derived (ADR-165 D5)', () => {
  assert.equal(validate({
    version: 'context/0.6',
    criteriaAgreement: { agreed: { line: {}, version: 1, by: [] }, status: 'agreed' },
  }), false)
})

test('a context/0.6 doc with hearing trials conforms; a stored "afterTrial" is rejected — rounds are derived (ADR-165 D4)', () => {
  const line = { mix: { D: 1, Q: 1, C: 1, S: 1 }, elements: { takt: { criterion: { op: '<=', value: 10 }, weight: 1 } } }
  assert.equal(validate({
    version: 'context/0.6',
    actors: [{ ref: 'a', role: 'ehs', endUser: true }],
    criteriaHearing: { trials: [{ actor: 'a', line, seen: [] }, { actor: 'a', line, seen: ['cand_b'] }] },
  }), true, JSON.stringify(validate.errors))
  assert.equal(validate({
    version: 'context/0.6',
    criteriaHearing: { trials: [{ actor: 'a', line, seen: [], afterTrial: 1 }] },
  }), false, 'what changed after trial n is a diff of two trials, never a stored field')
  assert.equal(validate({
    version: 'context/0.6',
    criteriaHearing: { trials: [{ actor: 'a', line }] },
  }), false, '`seen` is required — no candidates shown is a declared [] (原則 #31)')
})
