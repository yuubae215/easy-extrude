/**
 * SynonymQuotient unit tests (ADR-052 Phase 4) — THREE-free, bare `node --test`.
 *
 * Run with: pnpm test:context
 *
 * The dictionary is the quotient map of ADR-052 §2.2: φ folds synonyms onto one
 * canonical key; φ⁻¹ picks one representative back out (never the full preimage).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUOTIENT_TABLE, canonicalize, canonicalKey, localize,
  localizeOperator, operatorSymbol, synonymsOf,
} from './SynonymQuotient.js'

describe('canonicalize — surface term → equivalence class', () => {
  it('folds a class of synonyms onto one canonical key (many-to-one φ)', () => {
    const keys = ['move', '配置', 'drag', 'place', 'グラブ'].map(canonicalKey)
    assert.ok(keys.every(k => k === 'place'), `all → place, got ${keys}`)
  })

  it('folds operator synonyms across languages onto one key', () => {
    for (const t of ['>=', '≥', '以上', 'minimum', 'no less than']) {
      assert.equal(canonicalKey(t), 'at_least', t)
    }
    for (const t of ['<=', '以下', 'max', 'not above']) {
      assert.equal(canonicalKey(t), 'at_most', t)
    }
  })

  it('is case-insensitive and trims whitespace', () => {
    assert.equal(canonicalKey('  Requirement  '), 'requirement')
    assert.equal(canonicalKey('KPI'), 'kpi')
  })

  it('returns null for a term outside the quotient (caller keeps surface term)', () => {
    assert.equal(canonicalize('バナナ'), null)
    assert.equal(canonicalKey('quux'), null)
  })

  it('returns the full entry with category', () => {
    const e = canonicalize('決定')
    assert.equal(e.key, 'decision')
    assert.equal(e.cat, 'how')
  })
})

describe('localize — one representative per class (φ⁻¹ on the lexicon)', () => {
  it('renders a key in each language', () => {
    assert.equal(localize('requirement', 'ja'), '要求')
    assert.equal(localize('requirement', 'en'), 'requirement')
    assert.equal(localize('kpi', 'ja'), '評価指標')
  })

  it('defaults to Japanese and falls back to the key when unknown', () => {
    assert.equal(localize('constraint'), '制約')
    assert.equal(localize('no_such_key'), 'no_such_key')
  })
})

describe('operator rendering', () => {
  it('localizeOperator turns a criterion op into NL', () => {
    assert.equal(localizeOperator('>=', 'ja'), '以上')
    assert.equal(localizeOperator('>=', 'en'), 'at least')
    assert.equal(localizeOperator('<=', 'ja'), '以下')
  })

  it('passes an unknown op through verbatim (never crashes — PHILOSOPHY #11)', () => {
    assert.equal(localizeOperator('≈'), '≈')
    assert.equal(localizeOperator(undefined), '')
  })

  it('operatorSymbol maps to a comparison glyph', () => {
    assert.equal(operatorSymbol('>='), '≥')
    assert.equal(operatorSymbol('at_most'), '≤')
  })
})

describe('quotient structure', () => {
  it('every key is unique and every synonym resolves back to its own key', () => {
    const keys = QUOTIENT_TABLE.map(e => e.key)
    assert.equal(new Set(keys).size, keys.length, 'keys unique')
    for (const e of QUOTIENT_TABLE) {
      for (const syn of e.synonyms) {
        assert.equal(canonicalKey(syn), e.key, `${syn} → ${e.key}`)
      }
    }
  })

  it('synonymsOf returns the full equivalence class', () => {
    const syns = synonymsOf('resolve')
    assert.ok(syns.includes('解消') && syns.includes('settle'))
  })

  it('the table is frozen (immutable dictionary)', () => {
    assert.ok(Object.isFrozen(QUOTIENT_TABLE))
  })
})
