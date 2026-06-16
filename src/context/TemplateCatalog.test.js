/**
 * TemplateCatalog unit tests (ADR-051 Phase 2) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATE_CATALOG, getTemplateMeta, exampleFiles } from './TemplateCatalog.js'

describe('TEMPLATE_CATALOG', () => {
  it('has at least the blank starter plus example templates', () => {
    assert.ok(TEMPLATE_CATALOG.length >= 2)
    assert.ok(TEMPLATE_CATALOG.some(t => t.source.kind === 'blank'))
    assert.ok(TEMPLATE_CATALOG.some(t => t.source.kind === 'example'))
  })

  it('every entry has the required display fields', () => {
    for (const t of TEMPLATE_CATALOG) {
      assert.equal(typeof t.id, 'string')
      assert.ok(t.id.length > 0)
      assert.ok(t.name.length > 0,        `${t.id} name`)
      assert.ok(t.description.length > 0, `${t.id} description`)
      assert.ok(t.category.length > 0,    `${t.id} category`)
    }
  })

  it('ids are unique (gallery keys / callback args)', () => {
    const ids = TEMPLATE_CATALOG.map(t => t.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('every source is blank or an example with a .json file', () => {
    for (const t of TEMPLATE_CATALOG) {
      if (t.source.kind === 'blank') continue
      assert.equal(t.source.kind, 'example', `${t.id} source.kind`)
      assert.ok(/\.json$/.test(t.source.file), `${t.id} source.file must be JSON`)
    }
  })
})

describe('getTemplateMeta', () => {
  it('returns the matching entry', () => {
    const meta = getTemplateMeta('blank')
    assert.ok(meta)
    assert.equal(meta.source.kind, 'blank')
  })

  it('returns undefined for an unknown id', () => {
    assert.equal(getTemplateMeta('nope'), undefined)
  })
})

describe('exampleFiles', () => {
  it('lists exactly the example-template files (deduped from the catalog)', () => {
    const files = exampleFiles()
    const expected = TEMPLATE_CATALOG
      .filter(t => t.source.kind === 'example')
      .map(t => t.source.file)
    assert.deepEqual(files, expected)
    assert.ok(files.every(f => /\.json$/.test(f)))
  })
})
