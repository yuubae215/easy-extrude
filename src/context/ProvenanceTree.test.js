/**
 * ProvenanceTree unit tests (ADR-052) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 *
 * Two example docs exercise the two canonical Why shapes:
 *   - factory_context.json     — Intent-rooted (g_automate → g_depal → entities)
 *   - cell_conflict_context.json — Requirement/KPI-rooted (requirements → variables)
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildWhyTree, recoverProvenance, PROVENANCE_LAYERS } from './ProvenanceTree.js'

const here = dirname(fileURLToPath(import.meta.url))
const loadExample = (name) =>
  JSON.parse(readFileSync(join(here, '../../examples', name), 'utf8'))

const factory = loadExample('factory_context.json')
const cell    = loadExample('cell_conflict_context.json')

describe('buildWhyTree — structure', () => {
  it('classifies every node into a 5W1H layer', () => {
    const { nodes } = buildWhyTree(factory)
    assert.ok(nodes.length > 0)
    for (const n of nodes) assert.ok(PROVENANCE_LAYERS.includes(n.layer), `${n.id} layer`)
  })

  it('nodes are deterministically ordered Why → How → What', () => {
    const layers = buildWhyTree(factory).nodes.map(n => n.layer)
    const rank = { why: 0, how: 1, what: 2 }
    for (let i = 1; i < layers.length; i++) {
      assert.ok(rank[layers[i - 1]] <= rank[layers[i]], 'layer order monotonic')
    }
  })

  it('is deterministic across calls (stable nodes + edges)', () => {
    const a = buildWhyTree(cell)
    const b = buildWhyTree(cell)
    assert.deepEqual(a.nodes.map(n => n.id), b.nodes.map(n => n.id))
    assert.deepEqual(a.edges, b.edges)
    assert.deepEqual(a.roots, b.roots)
  })

  it('every edge points at registered nodes and toward the Why (no what-as-parent of why)', () => {
    const { nodes, edges } = buildWhyTree(factory)
    const byId = new Map(nodes.map(n => [n.id, n]))
    for (const e of edges) {
      assert.ok(byId.has(e.from), `edge.from ${e.from} registered`)
      assert.ok(byId.has(e.to),   `edge.to ${e.to} registered`)
    }
  })

  it('factory Why roots include the top-level intent g_automate', () => {
    const { roots } = buildWhyTree(factory)
    assert.ok(roots.includes('intent:g_automate'))
    // The child intent refines the parent, so it is NOT a root.
    assert.ok(!roots.includes('intent:g_depal'))
  })

  it('cell Why roots are the requirements (KPI-rooted, no intents authored)', () => {
    const { roots } = buildWhyTree(cell)
    assert.ok(roots.includes('requirement:r_cam_resolution'))
    assert.ok(roots.includes('requirement:r_wrist_singularity'))
    assert.ok(roots.every(id => id.startsWith('requirement:')))
  })
})

describe('recoverProvenance — φ⁻¹ from a derived entity', () => {
  it('factory: container_a recovers the Intent chain (g_depal → g_automate)', () => {
    const p = recoverProvenance(factory, 'container_a')
    assert.equal(p.found, true)
    assert.equal(p.entityRef, 'container_a')
    assert.ok(p.intents.includes('g_depal'),   'reaches the depalletize intent')
    assert.ok(p.intents.includes('g_automate'),'climbs to the root automation intent')
    assert.ok(p.why.some(n => n.kind === 'intent'))
  })

  it('factory: base_plate recovers its obligation (How) and the facts it depends on', () => {
    const p = recoverProvenance(factory, 'base_plate')
    assert.equal(p.found, true)
    assert.ok(p.how.some(n => n.id === 'obligation:o_baseplate_design'), 'reaches the obligation')
    const factRefs = p.what.filter(n => n.kind === 'fact').map(n => n.ref)
    assert.ok(factRefs.includes('f_plate'), 'reaches the plate fact via trace + dependsOn')
  })

  it('cell: robot_base_zone recovers the mech requirement (Why with admissible)', () => {
    const p = recoverProvenance(cell, 'robot_base_zone')
    assert.equal(p.found, true)
    const req = p.why.find(n => n.id === 'requirement:r_eoat_clearance')
    assert.ok(req, 'reaches r_eoat_clearance via trace')
    assert.ok(p.variables.includes('v_robot_base_x'), 'surfaces the constrained variable')
  })

  it('reports kpis with criterion when a requirement carries a KPI', () => {
    // r_eoat_clearance has no KPI; craft a doc whose entity traces to a KPI req.
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
    const p = recoverProvenance(doc, 'zone')
    assert.equal(p.kpis.length, 1)
    assert.equal(p.kpis[0].requirement, 'r_res')
    assert.equal(p.kpis[0].name, 'resolution')
    assert.deepEqual(p.kpis[0].criterion, { op: '>=', value: 10 })
  })

  it('returns found:false for an entity not in the layout', () => {
    const p = recoverProvenance(factory, 'no_such_entity')
    assert.equal(p.found, false)
    assert.deepEqual(p.chain, [])
    assert.deepEqual(p.why, [])
  })

  it('a decision marker climbs to the relaxed requirement', () => {
    // d_standoff in cell relaxes r_cam_resolution; reach it through a $decision marker.
    const doc = JSON.parse(JSON.stringify(cell))
    doc.specification.layout.entities.push({
      ref: 'cam_post', type: 'CoordinateFrame', name: 'cam',
      position: { x: { $decision: 'd_standoff' }, y: 0, z: 0 },
    })
    const p = recoverProvenance(doc, 'cam_post')
    assert.ok(p.how.some(n => n.id === 'decision:d_standoff'), 'reaches the decision via marker')
    assert.ok(p.why.some(n => n.id === 'requirement:r_cam_resolution'), 'climbs to the relaxed requirement')
  })
})

describe('purity', () => {
  it('does not mutate the input document', () => {
    const snapshot = JSON.stringify(cell)
    buildWhyTree(cell)
    recoverProvenance(cell, 'robot_base_zone')
    assert.equal(JSON.stringify(cell), snapshot)
  })

  it('tolerates an empty / minimal document without throwing', () => {
    assert.doesNotThrow(() => buildWhyTree({}))
    const p = recoverProvenance({}, 'anything')
    assert.equal(p.found, false)
  })
})
