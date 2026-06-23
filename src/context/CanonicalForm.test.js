/**
 * CanonicalForm unit tests (ADR-056) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 *
 * Validates the computable structural isomorphism on the synonym quotient:
 *   - `canonicalSignature` is deterministic, ref-name-invariant, and order-invariant,
 *     yet sensitive to genuine structural / identity changes (WL colour refinement).
 *   - `structuralDiff` reports per-layer added/removed/changed.
 *   - `reconcile` pairs same-colour nodes (refA ↔ refB) across renamed docs.
 * Inputs are never mutated (PHILOSOPHY #6).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { canonicalSignature, structuralDiff, reconcile } from './CanonicalForm.js'
import { PROVENANCE_LAYERS } from './ProvenanceTree.js'

const here = dirname(fileURLToPath(import.meta.url))
const loadExample = (name) =>
  JSON.parse(readFileSync(join(here, '../../examples', name), 'utf8'))

const factory = loadExample('factory_context.json')
const cell    = loadExample('cell_conflict_context.json')

// ── Synthetic docs: two structurally-isomorphic docs with different ref names ──
// Same shape (one variable constrained by one KPI requirement), but renamed refs,
// a synonym operator ('>=' vs '≥'), and a ref-renamed KPI expression.
const docA = {
  variables: [{ ref: 'v_standoff', description: 'camera standoff' }],
  requirements: [{
    ref: 'r_res',
    kpi: { name: 'resolution', expr: 'sensor(v_standoff) / fov_width(v_standoff)', unit: 'px/mm' },
    criterion: { op: '>=', value: 10 },
    constrains: ['v_standoff'],
  }],
  specification: { layout: { entities: [], constraints: [] } },
}
const docB = {
  variables: [{ ref: 'xQ', description: 'a different name' }],
  requirements: [{
    ref: 'rZZ',
    kpi: { name: 'resolution', expr: 'sensor(xQ)/fov_width(xQ)', unit: 'px/mm' },
    criterion: { op: '≥', value: 10 },          // synonym of '>='
    constrains: ['xQ'],
  }],
  specification: { layout: { entities: [], constraints: [] } },
}

const clone = (o) => JSON.parse(JSON.stringify(o))

describe('canonicalSignature — determinism & shape', () => {
  it('returns a stable docSignature across calls (same input)', () => {
    const a = canonicalSignature(factory)
    const b = canonicalSignature(factory)
    assert.equal(a.docSignature, b.docSignature)
    assert.equal(a.rootSignature, b.rootSignature)
  })

  it('assigns a colour to every node', () => {
    const sig = canonicalSignature(cell)
    assert.ok(sig.nodes.length > 0)
    for (const n of sig.nodes) assert.ok(sig.colorOf.get(n.id), `colour for ${n.id}`)
  })

  it('produces non-empty doc and root signatures', () => {
    const sig = canonicalSignature(cell)
    assert.ok(typeof sig.docSignature === 'string' && sig.docSignature.length > 0)
    assert.ok(typeof sig.rootSignature === 'string' && sig.rootSignature.length > 0)
  })
})

describe('canonicalSignature — ref-name & order invariance (the §2.2 property)', () => {
  it('two renamed-but-isomorphic docs have the same docSignature', () => {
    assert.equal(canonicalSignature(docA).docSignature, canonicalSignature(docB).docSignature)
  })

  it('is invariant under reordering of doc arrays', () => {
    const twoReq = {
      variables: [{ ref: 'vP' }, { ref: 'vQ' }],
      requirements: [
        { ref: 'rP', criterion: { op: '>=', value: 5 }, constrains: ['vP'] },
        { ref: 'rQ', criterion: { op: '<=', value: 9 }, constrains: ['vQ'] },
      ],
      specification: { layout: { entities: [], constraints: [] } },
    }
    const reordered = {
      variables: [{ ref: 'vQ' }, { ref: 'vP' }],
      requirements: [
        { ref: 'rQ', criterion: { op: '<=', value: 9 }, constrains: ['vQ'] },
        { ref: 'rP', criterion: { op: '>=', value: 5 }, constrains: ['vP'] },
      ],
      specification: { layout: { entities: [], constraints: [] } },
    }
    assert.equal(canonicalSignature(twoReq).docSignature, canonicalSignature(reordered).docSignature)
  })

  it('folds a synonym operator onto the same signature (quotient)', () => {
    const sym = clone(docA)
    sym.requirements[0].criterion.op = '以上'      // synonym of '>='
    assert.equal(canonicalSignature(sym).docSignature, canonicalSignature(docA).docSignature)
  })
})

describe('canonicalSignature — sensitivity to real change', () => {
  it('changes when a criterion value changes (identity payload)', () => {
    const changed = clone(docA)
    changed.requirements[0].criterion.value = 999
    assert.notEqual(canonicalSignature(changed).docSignature, canonicalSignature(docA).docSignature)
  })

  it('changes when a criterion operator crosses quotient classes', () => {
    const flipped = clone(docA)
    flipped.requirements[0].criterion.op = '<='    // at_most ≠ at_least
    assert.notEqual(canonicalSignature(flipped).docSignature, canonicalSignature(docA).docSignature)
  })

  it('changes when the structure grows (an extra constrained variable)', () => {
    const bigger = clone(docA)
    bigger.variables.push({ ref: 'v_extra' })
    bigger.requirements.push({ ref: 'r_extra', criterion: { op: '>=', value: 1 }, constrains: ['v_extra'] })
    assert.notEqual(canonicalSignature(bigger).docSignature, canonicalSignature(docA).docSignature)
  })
})

describe('structuralDiff', () => {
  it('reports no change between a doc and its clone', () => {
    const d = structuralDiff(cell, clone(cell))
    for (const layer of PROVENANCE_LAYERS) {
      assert.deepEqual(d[layer].added, [])
      assert.deepEqual(d[layer].removed, [])
      assert.deepEqual(d[layer].changed, [])
    }
  })

  it('reports a changed node (same ref, different criterion value)', () => {
    const after = clone(docA)
    after.requirements[0].criterion.value = 42
    const d = structuralDiff(docA, after)
    assert.equal(d.why.changed.length, 1)
    assert.equal(d.why.changed[0].ref, 'r_res')
    assert.notEqual(d.why.changed[0].fromColor, d.why.changed[0].toColor)
    assert.deepEqual(d.why.added, [])
    assert.deepEqual(d.why.removed, [])
  })

  it('reports added and removed nodes', () => {
    const after = clone(docA)
    after.variables.push({ ref: 'v_new' })
    after.requirements.push({ ref: 'r_new', criterion: { op: '>=', value: 3 }, constrains: ['v_new'] })
    const fwd = structuralDiff(docA, after)
    assert.ok(fwd.why.added.some(x => x.ref === 'r_new'))
    assert.ok(fwd.what.added.some(x => x.ref === 'v_new'))

    const back = structuralDiff(after, docA)
    assert.ok(back.why.removed.some(x => x.ref === 'r_new'))
    assert.ok(back.what.removed.some(x => x.ref === 'v_new'))
  })
})

describe('reconcile', () => {
  it('pairs every node with its twin when reconciling a doc with its clone', () => {
    const r = reconcile(cell, clone(cell))
    assert.deepEqual(r.unmatchedA, [])
    assert.deepEqual(r.unmatchedB, [])
    // Same refs on both sides → each pairs with itself.
    for (const p of r.pairs) assert.equal(p.refA, p.refB, `${p.refA} ↔ ${p.refB}`)
  })

  it('maps refA ↔ refB across renamed isomorphic docs', () => {
    const r = reconcile(docA, docB)
    assert.deepEqual(r.unmatchedA, [])
    assert.deepEqual(r.unmatchedB, [])
    const byA = new Map(r.pairs.map(p => [p.refA, p.refB]))
    assert.equal(byA.get('v_standoff'), 'xQ')
    assert.equal(byA.get('r_res'), 'rZZ')
  })

  it('leaves a structurally-unique node unmatched', () => {
    const bigger = clone(docA)
    bigger.variables.push({ ref: 'v_lone' })   // a variable with no requirement
    const r = reconcile(docA, bigger)
    assert.ok(r.unmatchedB.some(x => x.ref === 'v_lone'))
    assert.deepEqual(r.unmatchedA, [])
  })
})

describe('purity (PHILOSOPHY #6)', () => {
  it('does not mutate its inputs', () => {
    const a = clone(docA)
    const b = clone(docB)
    const snapA = JSON.stringify(a)
    const snapB = JSON.stringify(b)
    canonicalSignature(a)
    structuralDiff(a, b)
    reconcile(a, b)
    assert.equal(JSON.stringify(a), snapA)
    assert.equal(JSON.stringify(b), snapB)
  })

  it('runs on the real example docs without throwing', () => {
    for (const ex of [factory, cell]) {
      const before = JSON.stringify(ex)
      assert.ok(canonicalSignature(ex).docSignature)
      assert.equal(JSON.stringify(ex), before, 'example doc unchanged')
    }
  })
})
