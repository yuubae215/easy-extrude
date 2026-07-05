/**
 * TemplatePreviewMath unit tests (ADR-062 Phase 5) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { structurePreview } from './TemplatePreviewMath.js'
import { canonicalForm } from '../context/CanonicalForm.js'
import { PROVENANCE_LAYERS } from '../context/ProvenanceTree.js'

const here = dirname(fileURLToPath(import.meta.url))
const load = name => JSON.parse(readFileSync(join(here, '../../examples', name), 'utf8'))

describe('structurePreview', () => {
  it('derives layer counts + signature prefix from a real canonicalForm output', () => {
    const cf = canonicalForm(load('cell_conflict_context.json'))
    const p = structurePreview(cf)

    assert.ok(p)
    assert.equal(p.signature, cf.docSignature.slice(0, 8))
    assert.equal(p.total, cf.nodes.length)
    assert.equal(p.rootCount, cf.roots.length)
    assert.deepEqual(p.layers.map(l => l.layer), PROVENANCE_LAYERS)   // Why→How→What order
    assert.equal(p.layers.reduce((s, l) => s + l.count, 0), p.total)  // counts partition the nodes
    for (const l of p.layers) {
      assert.ok(l.fraction >= 0 && l.fraction <= 1)
    }
  })

  it('is a display projection only — the signature prefix comes from the decided docSignature', () => {
    const a = structurePreview(canonicalForm(load('cell_region_context.json')))
    const b = structurePreview(canonicalForm(load('cell_region_context.json')))
    assert.deepEqual(a, b)                          // deterministic (same doc, same preview)
  })

  it('degrades to null on malformed input — never a guessed preview (#11)', () => {
    assert.equal(structurePreview(null), null)
    assert.equal(structurePreview({}), null)
    assert.equal(structurePreview({ docSignature: '', nodes: [], roots: [] }), null)
    assert.equal(structurePreview({ docSignature: 'x', nodes: [{ layer: 'nonsense' }], roots: [] }), null)
    assert.equal(structurePreview({ docSignature: 'x', nodes: 'not-a-list', roots: [] }), null)
  })

  it('an empty (blank-doc) form yields zero counts, not NaN fractions', () => {
    const p = structurePreview({ docSignature: 'abcdef0123456789', nodes: [], roots: [] })
    assert.ok(p)
    assert.equal(p.total, 0)
    for (const l of p.layers) assert.equal(l.fraction, 0)
  })
})
