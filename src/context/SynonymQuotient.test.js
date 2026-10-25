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
  QUOTIENT_TABLE, CATEGORY_SCOPE, canonicalize, canonicalKey, canonicalKeyIn, combinationIn, localize,
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
        assert.equal(canonicalKeyIn(syn, e.cat), e.key, `${syn} → ${e.key} (in ${e.cat})`)
        if (CATEGORY_SCOPE[e.cat] === 'global') assert.equal(canonicalKey(syn), e.key, `${syn} → ${e.key}`)
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

describe('lookup scope per category (ADR-168)', () => {
  it('every category of the table declares its scope', () => {
    for (const e of QUOTIENT_TABLE) assert.ok(CATEGORY_SCOPE[e.cat], `${e.cat} has no scope`)
  })

  it('the spatial words never reach the category-free lookup — the operators read as before', () => {
    assert.equal(canonicalKey('above'), 'greater_than')
    assert.equal(canonicalKey('below'), 'less_than')
    assert.equal(canonicalKey('between'), 'within')
    for (const e of QUOTIENT_TABLE.filter(x => x.cat === 'spatial')) {
      assert.notEqual(canonicalKey(e.key), e.key, `spatial key "${e.key}" leaked into the shared lookup`)
    }
  })

  it('a person\'s own words fold onto the spatial values', () => {
    assert.equal(canonicalKeyIn('奥', 'spatial'), 'back')
    assert.equal(canonicalKeyIn('手前', 'spatial'), 'front')
    assert.equal(canonicalKeyIn('くっついてる', 'spatial'), 'touching')
    assert.equal(canonicalKeyIn('離れて', 'spatial'), 'apart')
    assert.equal(canonicalKeyIn('上方', 'spatial'), 'above')
    assert.equal(canonicalKeyIn('上面', 'spatial'), '+z')
    assert.equal(localize('back', 'ja'), '奥')
  })

  it('words that say two facts are refused, not decided for the speaker', () => {
    for (const w of ['上', '横', '載っている', '下']) assert.equal(canonicalKeyIn(w, 'spatial'), null, w)
  })

  it('front/back/left/right words that may be the partner\'s own (intrinsic) are refused — only the speaker\'s own fold (2026-10-25)', () => {
    for (const w of ['前', '前方', '後ろ', '後方', '左手', '右手', 'in front of', 'behind', 'left of', 'right of', 'beside', 'next to', 'on']) {
      assert.equal(canonicalKeyIn(w, 'spatial'), null, w)
    }
    assert.equal(canonicalKeyIn('手前', 'spatial'), 'front')
    assert.equal(canonicalKeyIn('向こう', 'spatial'), 'back')
    assert.equal(localize('front', 'en'), 'nearer')
  })

  it('asking an undeclared category is an error, not an empty answer', () => {
    assert.throws(() => canonicalKeyIn('above', 'spacial'), /not declared/)
    assert.throws(() => combinationIn('載っている', 'spacial'), /not declared/)
  })

  it('a combination folds onto BOTH values it fixes; a choice folds onto nothing in either table (2026-10-25)', () => {
    assert.deepEqual({ ...combinationIn('載っている', 'spatial').axes }, { contact: 'touching', toward: '+z' })
    assert.equal(combinationIn('on top of', 'spatial').key, 'resting_on')
    assert.equal(canonicalKeyIn('載っている', 'spatial'), null, 'a combination is not a word')
    for (const w of ['上', '横', 'on', '前', '置いてある']) {
      assert.equal(canonicalKeyIn(w, 'spatial'), null, w)
      assert.equal(combinationIn(w, 'spatial'), null, w)
    }
    assert.equal(combinationIn('上方', 'spatial'), null, 'a word is not a combination')
  })
})
