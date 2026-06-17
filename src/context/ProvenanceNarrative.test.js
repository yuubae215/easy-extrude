/**
 * ProvenanceNarrative unit tests (ADR-052 Phase 4) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 *
 * These exercise the doc → NL return leg of the round-trip, on top of the real
 * φ⁻¹ climb (`recoverProvenance`) so the two modules are verified end-to-end.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { recoverProvenance, buildWhyTree } from './ProvenanceTree.js'
import { narrateProvenance, narrateWhyTree } from './ProvenanceNarrative.js'
import { extractFacts } from './NlIntake.js'

const here = dirname(fileURLToPath(import.meta.url))
const loadExample = (name) =>
  JSON.parse(readFileSync(join(here, '../../examples', name), 'utf8'))

const factory = loadExample('factory_context.json')
const cell    = loadExample('cell_conflict_context.json')

describe('narrateProvenance — per-entity Why in NL', () => {
  it('renders the intent chain for a factory entity (ja)', () => {
    const prov = recoverProvenance(factory, 'container_a')
    const text = narrateProvenance(prov, { lang: 'ja' })
    assert.ok(text.includes('container_a') || text.includes(prov.node.label), 'names the subject')
    assert.ok(/存在します/.test(text), 'frames it as a Why')
    assert.ok(text.includes('g_depal') || text.includes('g_automate'), 'reaches an intent')
  })

  it('renders a KPI requirement with its criterion through the synonym quotient', () => {
    const doc = {
      version: 'context/0.2',
      actors: [{ ref: 'v', role: 'developer' }],
      variables: [{ ref: 'v_d', unit: 'mm', domain: [0, 1000] }],
      requirements: [{
        ref: 'r_res', by: 'v',
        kpi: { name: 'resolution', expr: 'k(v_d)', unit: 'px/mm' },
        criterion: { op: '>=', value: 10 },
        constrains: ['v_d'],
        admissible: { interval: [200, 350], source: 'stated' },
      }],
      specification: {
        layout: { version: 'layout/1.0', strategy: 'manual', entities: [{ ref: 'zone', type: 'AnnotatedRegion', placeType: 'Zone', vertices: [] }], constraints: [] },
        trace: [{ from: 'r_res', to: 'zone', kind: 'constrains' }],
      },
      acceptance: [],
    }
    const prov = recoverProvenance(doc, 'zone')
    const ja = narrateProvenance(prov, { lang: 'ja' })
    assert.ok(ja.includes('resolution'), 'names the KPI')
    assert.ok(ja.includes('以上'), 'criterion op localised to 以上 (>= → at_least)')
    assert.ok(ja.includes('10'), 'criterion value present')

    const en = narrateProvenance(prov, { lang: 'en' })
    assert.ok(en.includes('at least 10'), `en op localised, got: ${en}`)
  })

  it('mentions a live gap when the service joined an unresolved conflict', () => {
    const prov = { found: true, node: { label: 'cam zone' }, entityRef: 'z',
      kpis: [], why: [], how: [], intents: [],
      gaps: [{ variable: 'v_camera_standoff', gap: [350, 400], resolved: false }] }
    const text = narrateProvenance(prov, { lang: 'ja' })
    assert.ok(text.includes('未解消') && text.includes('v_camera_standoff'))
  })

  it('acknowledges a resolved gap distinctly', () => {
    const prov = { found: true, node: { label: 'z' }, entityRef: 'z',
      kpis: [], why: [], how: [], intents: [],
      gaps: [{ variable: 'v_x', gap: [1, 2], resolved: true }] }
    const text = narrateProvenance(prov, { lang: 'ja' })
    assert.ok(text.includes('解消済'))
  })

  it('handles a non-derived entity gracefully', () => {
    const prov = recoverProvenance(factory, 'no_such')
    const text = narrateProvenance(prov, { lang: 'ja' })
    assert.ok(/導出されていない/.test(text))
    assert.ok(narrateProvenance(null).length > 0, 'null is safe')
  })
})

describe('narrateWhyTree — whole-doc overview', () => {
  it('summarises the factory tree (intent-rooted)', () => {
    const tree = buildWhyTree(factory)
    const text = narrateWhyTree(tree, { lang: 'ja' })
    assert.ok(/Why ルート/.test(text))
    assert.ok(/目的/.test(text), 'factory apex is intents')
  })

  it('summarises the cell tree (requirement-rooted) in English', () => {
    const tree = buildWhyTree(cell)
    const text = narrateWhyTree(tree, { lang: 'en' })
    assert.ok(/Why root/.test(text))
    assert.ok(/requirement/.test(text), 'cell apex is requirements')
  })

  it('handles an empty tree', () => {
    assert.ok(narrateWhyTree(buildWhyTree({})).length > 0)
    assert.ok(narrateWhyTree(null).length > 0)
  })
})

describe('round-trip — NL → doc (NlIntake) ⟷ doc → NL (narrator)', () => {
  it('a fact extracted from NL is recoverable and narratable up to synonym', () => {
    // φ: NL → doc (the Fact), then build a minimal doc that derives an entity
    // constrained by a requirement reading that fact, then φ⁻¹ → NL.
    const { facts } = extractFacts('camera resolution is 2448px')
    assert.equal(facts.length, 1)
    assert.equal(facts[0].status, 'asserted')

    const doc = {
      version: 'context/0.2',
      actors: [{ ref: 'v', role: 'developer' }],
      given: facts,
      variables: [{ ref: 'v_d', unit: 'mm', domain: [0, 1000] }],
      requirements: [{
        ref: 'r_res', by: 'v',
        kpi: { name: 'resolution', expr: 'k(v_d)', unit: 'px/mm' },
        criterion: { op: '>=', value: 10 },
        constrains: ['v_d'],
        admissible: { interval: [200, 350], source: 'stated' },
      }],
      specification: {
        layout: { version: 'layout/1.0', strategy: 'manual', entities: [{ ref: 'zone', type: 'AnnotatedRegion', placeType: 'Zone', vertices: [] }], constraints: [] },
        trace: [{ from: 'r_res', to: 'zone', kind: 'constrains' }],
      },
      acceptance: [],
    }
    const prov = recoverProvenance(doc, 'zone')
    const text = narrateProvenance(prov, { lang: 'en' })
    // structure preserved (KPI + criterion) even though surface synonyms were dropped
    assert.ok(text.includes('resolution') && text.includes('at least 10'))
  })

  it('is deterministic / pure (same input → same prose)', () => {
    const prov = recoverProvenance(cell, 'robot_base_zone')
    assert.equal(narrateProvenance(prov, { lang: 'ja' }), narrateProvenance(prov, { lang: 'ja' }))
  })
})
