/**
 * ParametricAssets unit tests (ADR-063 Phase 4) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PARAMETRIC_CATALOG, PARAMETRIC_CATALOG_VERSION,
  getParametricAsset, clampParams, instantiateAsset,
  assetCommitEntries, applyAssetCommit, assetVariableRef, assetFactRef,
} from './ParametricAssets.js'
import { compileLayout } from '../layout/LayoutCompiler.js'
import { validateContext } from './ContextValidator.js'
import { createBlankDoc, addActor } from './DocBuilder.js'

describe('PARAMETRIC_CATALOG integrity', () => {
  it('every asset has the required fields and version', () => {
    assert.ok(PARAMETRIC_CATALOG.length >= 2)
    for (const a of PARAMETRIC_CATALOG) {
      assert.equal(a.version, PARAMETRIC_CATALOG_VERSION, a.id)
      assert.ok(a.name.length > 0 && a.description.length > 0, a.id)
      assert.ok(a.params.length > 0, a.id)
      assert.equal(typeof a.fragment, 'function', a.id)
    }
  })

  it('ids and per-asset param keys are unique', () => {
    const ids = PARAMETRIC_CATALOG.map(a => a.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const a of PARAMETRIC_CATALOG) {
      const keys = a.params.map(p => p.key)
      assert.equal(new Set(keys).size, keys.length, a.id)
    }
  })

  it('every param default lies inside its [min, max] and step is positive', () => {
    for (const a of PARAMETRIC_CATALOG) {
      for (const p of a.params) {
        assert.ok(p.min < p.max, `${a.id}.${p.key} min<max`)
        assert.ok(p.default >= p.min && p.default <= p.max, `${a.id}.${p.key} default in range`)
        assert.ok(p.step > 0, `${a.id}.${p.key} step`)
        assert.ok(p.unit.length > 0 && p.label.length > 0, `${a.id}.${p.key} labels`)
      }
    }
  })

  it('every asset compiles through compileLayout at defaults AND both extremes', () => {
    for (const a of PARAMETRIC_CATALOG) {
      const extremes = [
        {},                                                                  // defaults
        Object.fromEntries(a.params.map(p => [p.key, p.min])),               // all-min
        Object.fromEntries(a.params.map(p => [p.key, p.max])),               // all-max
      ]
      for (const values of extremes) {
        const dsl = instantiateAsset(a, values)
        const scene = compileLayout(dsl)   // throws on an invalid fragment
        assert.ok(scene.objects.length > 0, a.id)
      }
    }
  })
})

describe('clampParams', () => {
  const asset = getParametricAsset('robot_pedestal')

  it('fills missing values with defaults', () => {
    const v = clampParams(asset, {})
    for (const p of asset.params) assert.equal(v[p.key], p.default)
  })

  it('clamps out-of-range and replaces non-finite values', () => {
    const v = clampParams(asset, { base_size: 1e9, mount_height: NaN })
    assert.equal(v.base_size, asset.params.find(p => p.key === 'base_size').max)
    assert.equal(v.mount_height, asset.params.find(p => p.key === 'mount_height').default)
  })

  it('drops keys not in the schema and never mutates the input', () => {
    const input = { base_size: 400, junk: 1 }
    const snapshot = JSON.stringify(input)
    const v = clampParams(asset, input)
    assert.equal(v.junk, undefined)
    assert.equal(JSON.stringify(input), snapshot)
  })
})

describe('instantiateAsset', () => {
  const asset = getParametricAsset('conveyor')

  it('is deterministic for the same values', () => {
    const a = instantiateAsset(asset, { length: 1500 })
    const b = instantiateAsset(asset, { length: 1500 })
    assert.deepEqual(a, b)
  })

  it('responds to a parameter change (the preview actually moves)', () => {
    const short = instantiateAsset(asset, { length: 1000 })
    const long  = instantiateAsset(asset, { length: 3000 })
    const bed = dsl => dsl.entities.find(e => e.ref === 'conveyor_bed')
    assert.notEqual(bed(short).dimensions.x, bed(long).dimensions.x)
  })
})

describe('assetCommitEntries / applyAssetCommit', () => {
  const asset = getParametricAsset('robot_pedestal')

  it('records one variable per param (schema range as domain) and one asserted fact', () => {
    const { variables, fact } = assetCommitEntries(asset, { mount_height: 900 })
    assert.equal(variables.length, asset.params.length)
    for (const p of asset.params) {
      const v = variables.find(x => x.ref === assetVariableRef(asset, p))
      assert.ok(v, p.key)
      assert.deepEqual(v.domain, [p.min, p.max])
      assert.equal(v.unit, p.unit)
    }
    assert.equal(fact.ref, assetFactRef(asset))
    assert.equal(fact.status, 'asserted')
    assert.equal(fact.attrs.mount_height.value, 900)
  })

  it('commit into a blank doc passes validateContext', () => {
    const doc = addActor(createBlankDoc('t'), { ref: 'a_me', role: 'engineer' })
    const after = applyAssetCommit(doc, asset, {})
    const result = validateContext(after)
    assert.ok(result.valid, JSON.stringify(result.errors))
    assert.equal(after.variables.length, asset.params.length)
    assert.equal(after.given.length, 1)
  })

  it('recommit upserts — no duplicate variables or facts', () => {
    const doc = createBlankDoc('t')
    const once  = applyAssetCommit(doc, asset, { mount_height: 700 })
    const twice = applyAssetCommit(once, asset, { mount_height: 900 })
    assert.equal(twice.variables.length, asset.params.length)
    assert.equal(twice.given.length, 1)
    assert.equal(twice.given[0].attrs.mount_height.value, 900)
  })

  it('never mutates the input doc (PHILOSOPHY #6)', () => {
    const doc = createBlankDoc('t')
    const snapshot = JSON.stringify(doc)
    applyAssetCommit(doc, asset, {})
    assert.equal(JSON.stringify(doc), snapshot)
  })
})
