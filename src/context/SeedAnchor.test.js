/**
 * SeedAnchor unit tests (ADR-058 Phase 1) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSeedIndex,
  seedEntry,
  seedIsEmpty,
  describeSeedRequirement,
  describeSeedActor,
  describeSeedVariable,
} from './SeedAnchor.js'

const SEED = {
  version: 'context/0.4',
  actors: [
    { ref: 'a_robot', role: 'agent', discipline: 'robot' },
    { ref: 'a_vision', role: 'agent', discipline: 'vision' },
  ],
  variables: [
    { ref: 'v_reach', unit: 'mm', domain: [0, 1000] },
  ],
  requirements: [
    {
      ref: 'r_reach', by: 'a_robot',
      kpi: { name: 'reach', expr: 'arm_length', unit: 'mm' },
      criterion: { op: '>=', value: 400 },
      constrains: ['v_reach'], negotiability: 'must',
      admissible: { interval: [400, 800], source: 'stated' },
    },
  ],
  given: [
    { ref: 'g_payload', subject: 'payload', attrs: {}, status: 'asserted' },
  ],
}

describe('buildSeedIndex', () => {
  it('indexes every kind by ref', () => {
    const idx = buildSeedIndex(SEED)
    assert.equal(idx.actors.length, 2)
    assert.equal(idx.variables.length, 1)
    assert.equal(idx.requirements.length, 1)
    assert.equal(idx.facts.length, 1)
    assert.equal(idx.byRef.actor['a_robot'].discipline, 'robot')
    assert.equal(idx.byRef.requirement['r_reach'].criterion.value, 400)
    assert.equal(idx.byRef.fact['g_payload'].subject, 'payload')
  })

  it('returns an empty index for null / non-object seed', () => {
    for (const bad of [null, undefined, 42, 'x']) {
      const idx = buildSeedIndex(bad)
      assert.equal(idx.actors.length, 0)
      assert.deepEqual(idx.byRef.requirement, {})
      assert.ok(seedIsEmpty(idx))
    }
  })

  it('skips entries without a string ref (never fabricates an anchor)', () => {
    const idx = buildSeedIndex({ actors: [{ role: 'agent' }, { ref: 'a_ok', role: 'agent' }] })
    assert.equal(idx.actors.length, 1)
    assert.equal(idx.actors[0].ref, 'a_ok')
  })

  it('does not mutate the input seed (PHILOSOPHY #6)', () => {
    const snapshot = JSON.parse(JSON.stringify(SEED))
    buildSeedIndex(SEED)
    assert.deepEqual(SEED, snapshot)
  })

  it('last ref wins on duplicate refs (matches doc override convention)', () => {
    const idx = buildSeedIndex({
      variables: [{ ref: 'v', unit: 'mm' }, { ref: 'v', unit: 'm' }],
    })
    assert.equal(idx.byRef.variable['v'].unit, 'm')
  })
})

describe('seedEntry', () => {
  it('returns the matching entry or null', () => {
    const idx = buildSeedIndex(SEED)
    assert.equal(seedEntry(idx, 'requirement', 'r_reach').by, 'a_robot')
    assert.equal(seedEntry(idx, 'requirement', 'nope'), null)
    assert.equal(seedEntry(idx, 'actor', 'a_vision').discipline, 'vision')
  })

  it('is null-safe on a malformed index', () => {
    assert.equal(seedEntry(null, 'actor', 'x'), null)
    assert.equal(seedEntry({}, 'actor', 'x'), null)
  })
})

describe('seedIsEmpty', () => {
  it('is true for an empty / missing seed, false otherwise', () => {
    assert.ok(seedIsEmpty(buildSeedIndex(null)))
    assert.ok(seedIsEmpty(buildSeedIndex({})))
    assert.equal(seedIsEmpty(buildSeedIndex(SEED)), false)
  })
})

describe('describeSeedRequirement', () => {
  it('formats the KPI criterion and admissible interval', () => {
    assert.equal(describeSeedRequirement(SEED.requirements[0]), 'reach >= 400 · [400, 800]')
  })

  it('degrades gracefully on partial / missing fields', () => {
    assert.equal(describeSeedRequirement(null), '')
    assert.equal(describeSeedRequirement({ kpi: { name: 'k' } }), 'k')
    assert.equal(
      describeSeedRequirement({ admissible: { interval: [1, 2] } }),
      '[1, 2]',
    )
  })
})

describe('describeSeedActor', () => {
  it('formats role and discipline', () => {
    assert.equal(describeSeedActor(SEED.actors[0]), 'agent · robot')
  })

  it('degrades gracefully on partial / missing fields', () => {
    assert.equal(describeSeedActor(null), '')
    assert.equal(describeSeedActor({ role: 'agent' }), 'agent')
    assert.equal(describeSeedActor({}), '')
  })
})

describe('describeSeedVariable', () => {
  it('formats the domain interval and unit', () => {
    assert.equal(describeSeedVariable(SEED.variables[0]), '[0, 1000] mm')
  })

  it('degrades gracefully on partial / missing fields', () => {
    assert.equal(describeSeedVariable(null), '')
    assert.equal(describeSeedVariable({ unit: 'mm' }), 'mm')
    assert.equal(describeSeedVariable({ domain: [1, 2] }), '[1, 2]')
  })
})
