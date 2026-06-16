/**
 * NlIntake unit tests (ADR-051 Phase 4) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractFacts } from './NlIntake.js'

describe('extractFacts — definite quantities', () => {
  it('extracts a definite Japanese quantity as an asserted {value, unit} fact', () => {
    const { facts, unparsed } = extractFacts('カメラの解像度は2448px')
    assert.equal(facts.length, 1)
    assert.equal(unparsed.length, 0)
    const f = facts[0]
    assert.equal(f.status, 'asserted')
    assert.equal(f.subject, 'カメラ')
    assert.deepEqual(f.attrs['解像度'], { value: 2448, unit: 'px' })
    assert.deepEqual(f.evidence, [])
  })

  it('extracts an English "<subject> <attr> is <n><unit>" statement', () => {
    const { facts } = extractFacts('robot reach is 850mm')
    assert.equal(facts.length, 1)
    assert.equal(facts[0].status, 'asserted')
    assert.equal(facts[0].subject, 'robot')
    assert.deepEqual(facts[0].attrs['reach'], { value: 850, unit: 'mm' })
  })

  it('handles a decimal value', () => {
    const { facts } = extractFacts('レンズの焦点距離は16.5mm')
    assert.deepEqual(facts[0].attrs['焦点距離'], { value: 16.5, unit: 'mm' })
  })
})

describe('extractFacts — conservative (vague / range / unknown)', () => {
  it('downgrades a hedged number (約) to an unknown-valued fact', () => {
    const { facts } = extractFacts('ロボットのリーチは約800mm')
    assert.equal(facts.length, 1)
    const f = facts[0]
    assert.equal(f.status, 'unknown')
    assert.equal(f.attrs['リーチ'], 'unknown')
    assert.ok(/800/.test(f.note), 'note preserves the raw estimate for traceability')
  })

  it('downgrades an "about" hedge in English', () => {
    const { facts } = extractFacts('cell width is about 3000mm')
    assert.equal(facts[0].status, 'unknown')
    assert.equal(facts[0].attrs['width'], 'unknown')
  })

  it('treats a range as unknown with the interval recorded in the note', () => {
    const { facts } = extractFacts('ロボットのリーチは400〜800mm')
    const f = facts[0]
    assert.equal(f.status, 'unknown')
    assert.equal(f.attrs['リーチ'], 'unknown')
    assert.ok(/400/.test(f.note) && /800/.test(f.note))
  })

  it('parses an English "between A and B" range', () => {
    const { facts } = extractFacts('standoff is between 100 and 200 mm')
    assert.equal(facts[0].status, 'unknown')
    assert.ok(/100/.test(facts[0].note) && /200/.test(facts[0].note))
  })

  it('emits an unknown fact for an explicit unknown marker with no number', () => {
    const { facts } = extractFacts('搬送装置の重量は不明')
    assert.equal(facts.length, 1)
    assert.equal(facts[0].status, 'unknown')
    assert.equal(facts[0].attrs['重量'], 'unknown')
  })
})

describe('extractFacts — segmentation & robustness', () => {
  it('splits multiple statements on newlines and 。', () => {
    const { facts } = extractFacts('カメラの解像度は2448px\nロボットのリーチは約800mm。架台の高さは不明')
    assert.equal(facts.length, 3)
    assert.equal(facts[0].status, 'asserted')
    assert.equal(facts[1].status, 'unknown')
    assert.equal(facts[2].status, 'unknown')
  })

  it('assigns unique refs across extracted facts', () => {
    const { facts } = extractFacts('Aの幅は10mm\nBの幅は20mm')
    const refs = facts.map(f => f.ref)
    assert.equal(new Set(refs).size, refs.length)
  })

  it('returns un-parseable segments in unparsed (never silently dropped)', () => {
    const { facts, unparsed } = extractFacts('これは普通の文章です')
    assert.equal(facts.length, 0)
    assert.deepEqual(unparsed, ['これは普通の文章です'])
  })

  it('attribute keys never contain a dot (FormApplication splits target on ".")', () => {
    const { facts } = extractFacts('the sensor pixel.count is 2448px')
    for (const f of facts) {
      for (const key of Object.keys(f.attrs)) assert.ok(!key.includes('.'), key)
    }
  })

  it('returns empty result for non-string / empty input', () => {
    assert.deepEqual(extractFacts(''), { facts: [], unparsed: [] })
    assert.deepEqual(extractFacts(null), { facts: [], unparsed: [] })
    assert.deepEqual(extractFacts(undefined), { facts: [], unparsed: [] })
  })

  it('does not mutate or depend on external state (pure)', () => {
    const a = extractFacts('カメラの解像度は2448px')
    const b = extractFacts('カメラの解像度は2448px')
    assert.deepEqual(a, b)
  })
})
