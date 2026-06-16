/**
 * DocBuilder unit tests (ADR-051 Phase 1) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBlankDoc,
  addActor,
  addFact,
  addVariable,
  addRequirement,
} from './DocBuilder.js'
import { CONTEXT_DSL_VERSION, SUPPORTED_VERSIONS } from './ContextDslSchema.js'

// ── createBlankDoc ─────────────────────────────────────────────────────────────

describe('createBlankDoc', () => {
  it('produces a doc at the current CONTEXT_DSL_VERSION', () => {
    const doc = createBlankDoc()
    assert.equal(doc.version, CONTEXT_DSL_VERSION)
    assert.ok(SUPPORTED_VERSIONS.includes(doc.version))
  })

  it('uses the provided name', () => {
    const doc = createBlankDoc('Test Project')
    assert.equal(doc.meta.name, 'Test Project')
  })

  it('defaults to a non-empty name when omitted', () => {
    const doc = createBlankDoc()
    assert.ok(typeof doc.meta.name === 'string' && doc.meta.name.length > 0)
  })

  it('all entity arrays are empty', () => {
    const doc = createBlankDoc()
    for (const key of ['actors', 'sources', 'given', 'variables', 'requirements', 'obligations', 'decisions']) {
      assert.deepEqual(doc[key], [], `expected ${key} to be empty`)
    }
  })

  it('does not include a specification.layout (blank — no entities to compile)', () => {
    const doc = createBlankDoc()
    assert.equal(doc.specification, undefined)
  })
})

// ── addActor ──────────────────────────────────────────────────────────────────

describe('addActor', () => {
  it('returns a new doc with the actor appended', () => {
    const doc  = createBlankDoc()
    const actor = { ref: 'a_robot', role: 'agent', discipline: 'robot' }
    const next  = addActor(doc, actor)
    assert.equal(next.actors.length, 1)
    assert.deepEqual(next.actors[0], actor)
  })

  it('does not mutate the source doc', () => {
    const doc = createBlankDoc()
    addActor(doc, { ref: 'a_x', role: 'developer' })
    assert.equal(doc.actors.length, 0, 'source doc must be unchanged')
  })

  it('appends to existing actors preserving order', () => {
    let doc = createBlankDoc()
    doc = addActor(doc, { ref: 'a_1', role: 'developer' })
    doc = addActor(doc, { ref: 'a_2', role: 'agent' })
    assert.equal(doc.actors.length, 2)
    assert.equal(doc.actors[0].ref, 'a_1')
    assert.equal(doc.actors[1].ref, 'a_2')
  })

  it('preserves all other top-level arrays unchanged', () => {
    const doc  = createBlankDoc()
    const next = addActor(doc, { ref: 'a_x', role: 'customer' })
    assert.deepEqual(next.given,        [])
    assert.deepEqual(next.variables,    [])
    assert.deepEqual(next.requirements, [])
    assert.deepEqual(next.decisions,    [])
  })
})

// ── addFact ───────────────────────────────────────────────────────────────────

describe('addFact', () => {
  const fact = {
    ref:      'f_room',
    subject:  'room',
    attrs:    { width: { value: 5, unit: 'm' } },
    status:   'measured',
    evidence: [],
  }

  it('returns a new doc with the fact appended', () => {
    const doc  = createBlankDoc()
    const next = addFact(doc, fact)
    assert.equal(next.given.length, 1)
    assert.deepEqual(next.given[0], fact)
  })

  it('does not mutate the source doc', () => {
    const doc = createBlankDoc()
    addFact(doc, fact)
    assert.equal(doc.given.length, 0, 'source doc must be unchanged')
  })

  it('appends to existing given facts', () => {
    let doc = createBlankDoc()
    doc = addFact(doc, { ...fact, ref: 'f_1' })
    doc = addFact(doc, { ...fact, ref: 'f_2' })
    assert.equal(doc.given.length, 2)
    assert.equal(doc.given[1].ref, 'f_2')
  })
})

// ── addVariable ───────────────────────────────────────────────────────────────

describe('addVariable', () => {
  const variable = { ref: 'v_arm', unit: 'mm', domain: [200, 800], description: 'arm reach' }

  it('returns a new doc with the variable appended', () => {
    const doc  = createBlankDoc()
    const next = addVariable(doc, variable)
    assert.equal(next.variables.length, 1)
    assert.deepEqual(next.variables[0], variable)
  })

  it('does not mutate the source doc', () => {
    const doc = createBlankDoc()
    addVariable(doc, variable)
    assert.equal(doc.variables.length, 0, 'source doc must be unchanged')
  })

  it('appends to existing variables preserving order', () => {
    let doc = createBlankDoc()
    doc = addVariable(doc, { ...variable, ref: 'v_1' })
    doc = addVariable(doc, { ...variable, ref: 'v_2' })
    assert.equal(doc.variables.length, 2)
    assert.equal(doc.variables[1].ref, 'v_2')
  })
})

// ── addRequirement ────────────────────────────────────────────────────────────

describe('addRequirement', () => {
  const req = {
    ref:          'r_reach',
    by:           'a_robot',
    kpi:          { name: 'reach', expr: 'arm_length', unit: 'mm' },
    criterion:    { op: '>=', value: 400 },
    constrains:   ['v_arm'],
    negotiability:'must',
    admissible:   { interval: [400, 800], source: 'stated' },
    evidence:     [],
  }

  it('returns a new doc with the requirement appended', () => {
    const doc  = createBlankDoc()
    const next = addRequirement(doc, req)
    assert.equal(next.requirements.length, 1)
    assert.deepEqual(next.requirements[0], req)
  })

  it('does not mutate the source doc', () => {
    const doc = createBlankDoc()
    addRequirement(doc, req)
    assert.equal(doc.requirements.length, 0, 'source doc must be unchanged')
  })

  it('appends to existing requirements', () => {
    let doc = createBlankDoc()
    doc = addRequirement(doc, { ...req, ref: 'r_1' })
    doc = addRequirement(doc, { ...req, ref: 'r_2' })
    assert.equal(doc.requirements.length, 2)
    assert.equal(doc.requirements[1].ref, 'r_2')
  })

  it('preserves other arrays unchanged', () => {
    const doc  = createBlankDoc()
    const next = addRequirement(doc, req)
    assert.deepEqual(next.actors,   [])
    assert.deepEqual(next.given,    [])
    assert.deepEqual(next.variables,[])
    assert.deepEqual(next.decisions,[])
  })
})

// ── composition ───────────────────────────────────────────────────────────────

describe('composition — build a doc from scratch', () => {
  it('addActor + addVariable + addRequirement compose correctly', () => {
    let doc = createBlankDoc('Factory Cell')
    doc = addActor(doc, { ref: 'a_robot', role: 'agent', discipline: 'robot' })
    doc = addVariable(doc, { ref: 'v_reach', unit: 'mm', domain: [100, 1000] })
    doc = addRequirement(doc, {
      ref: 'r_reach', by: 'a_robot',
      kpi: { name: 'reach', expr: 'v_reach', unit: 'mm' },
      criterion: { op: '>=', value: 500 },
      constrains: ['v_reach'], negotiability: 'must',
      admissible: { interval: [500, 1000], source: 'stated' },
      evidence: [],
    })

    assert.equal(doc.meta.name, 'Factory Cell')
    assert.equal(doc.actors.length, 1)
    assert.equal(doc.variables.length, 1)
    assert.equal(doc.requirements.length, 1)
    assert.equal(doc.requirements[0].constrains[0], 'v_reach')
  })

  it('each step returns a new doc object (structural sharing)', () => {
    const doc0 = createBlankDoc()
    const doc1 = addActor(doc0, { ref: 'a_x', role: 'developer' })
    const doc2 = addVariable(doc1, { ref: 'v_x', unit: 'mm', domain: [0, 100] })
    assert.notEqual(doc0, doc1)
    assert.notEqual(doc1, doc2)
    assert.equal(doc0.actors.length, 0)
    assert.equal(doc1.actors.length, 1)
    assert.equal(doc2.actors.length, 1)
    assert.equal(doc2.variables.length, 1)
  })
})
