/**
 * SynonymQuotient — the synonym-quotient normalisation dictionary (ADR-052
 * Phase 4), generalising ADR-044 `why.keywords` from per-operation verbs to the
 * whole 5W1H vocabulary.
 *
 * Pure computation: input-immutable, no I/O, no THREE/DOM — loads under bare
 * `node --test` (PHILOSOPHY #3/#6).
 *
 * ADR-052 §2.2 defines *Mutual* as a **structural isomorphism on the quotient by
 * synonyms**: φ : NL → doc is a many-to-one homomorphism that folds a whole class
 * of surface synonyms ("move" / "配置" / "drag", or ">=" / "以上" / "minimum")
 * onto a single canonical key. This module IS that quotient map:
 *
 *   - `canonicalize(term)` projects any surface term onto its equivalence-class
 *     representative (the canonical key). This is φ restricted to the lexicon.
 *   - `localize(key, lang)` picks ONE representative surface form back out — never
 *     the full preimage, which φ⁻¹ provably cannot restore (synonym information is
 *     discarded; ADR-044 §φ⁻¹). Choosing one representative per class is exactly
 *     what "structural isomorphism on the quotient" permits.
 *
 * The narrator (`ProvenanceNarrative`) renders the recovered Why back to natural
 * language by `localize`-ing the canonical keys it walks — so the round-trip
 * NL → doc (NlIntake) ⟷ doc → NL (narrator) is mediated by this one dictionary,
 * and is faithful *up to synonym* (the contract ADR-052 promises, not more).
 *
 * @module context/SynonymQuotient
 */

/**
 * The synonym-quotient table. Each entry is one equivalence class:
 *   - `key`  — the canonical, language-neutral representative (stable id)
 *   - `en` / `ja` — the chosen representative surface form per language
 *   - `cat`  — 5W1H category, for callers that group by role
 *   - `synonyms` — every surface term (any language) that folds onto this class
 *
 * English is canonical-leaning (matches doc field names); Japanese is additive.
 * The list is intentionally small and domain-scoped (the Why vocabulary of
 * ADR-046/049): comparison operators, the 5W1H node kinds, and the handful of
 * relation verbs the narrator needs. It is an extension point — adding a row
 * widens the quotient without touching either bridge.
 *
 * ## Which lookup reaches a category (`CATEGORY_SCOPE`, ADR-168)
 *
 * A surface term folds onto one key **within its lookup scope**, not across the
 * whole table. The 5W1H categories share the one category-free lookup
 * (`canonicalKey`) as they always did. A category whose words collide with
 * theirs is declared `scoped` and is reached only by `canonicalKeyIn(term, cat)`:
 * the spatial words of ADR-168 say `above` / `below` too, and folding them into
 * the shared lookup would silently change how the operators read — and every
 * `CanonicalForm` signature that hashes those keys.
 *
 * Inside one scope a term that two keys claim is a load-time error, not a
 * last-write-wins overwrite: a collision is caught in the dictionary, where it is
 * made, rather than downstream where it reads as a wrong answer.
 *
 * ## Words the dictionary refuses on purpose (spatial)
 *
 * 「上」「横」「載っている」 are NOT synonyms of any spatial key: each says two
 * facts or chooses between two (上 = above apart, or the +z face touching?
 * 載っている = touching AND on the +z face). Folding them would decide for the
 * speaker. They stay outside the quotient (canonicalKeyIn → null), so a caller
 * must ask which was meant (docs/SPATIAL_RELATION_MODEL.md §3).
 *
 * @type {ReadonlyArray<{key:string, en:string, ja:string, cat:string, synonyms:string[]}>}
 */
export const QUOTIENT_TABLE = Object.freeze([
  // ── Comparison operators (criterion.op ⇄ NL) ──────────────────────────────
  { key: 'at_least', en: 'at least', ja: '以上', cat: 'operator',
    synonyms: ['>=', '≥', '以上', 'min', 'minimum', 'no less than', 'not below', '下回らない'] },
  { key: 'at_most', en: 'at most', ja: '以下', cat: 'operator',
    synonyms: ['<=', '≤', '以下', 'max', 'maximum', 'no more than', 'not above', '超えない', '上回らない'] },
  { key: 'greater_than', en: 'greater than', ja: 'より大きい', cat: 'operator',
    synonyms: ['>', '超', 'over', 'above', 'exceeds', 'より大きい', '超える'] },
  { key: 'less_than', en: 'less than', ja: 'より小さい', cat: 'operator',
    synonyms: ['<', '未満', 'under', 'below', 'より小さい', '満たない'] },
  { key: 'equal_to', en: 'equal to', ja: 'に等しい', cat: 'operator',
    synonyms: ['==', '=', '等しい', 'equals', 'equal', 'exactly', 'ちょうど', 'に等しい'] },
  { key: 'within', en: 'within', ja: 'の範囲内', cat: 'operator',
    synonyms: ['in', 'between', 'range', 'interval', '範囲', '範囲内', '区間', 'の間'] },

  // ── 5W1H node kinds (ProvenanceTree node.kind ⇄ NL) ───────────────────────
  { key: 'intent', en: 'intent', ja: '目的', cat: 'why',
    synonyms: ['intent', 'goal', 'aim', 'objective', '目的', '意図', 'ねらい', 'ゴール'] },
  { key: 'requirement', en: 'requirement', ja: '要求', cat: 'why',
    synonyms: ['requirement', 'req', 'spec', 'requisite', '要求', '要件', '仕様'] },
  { key: 'kpi', en: 'KPI', ja: '評価指標', cat: 'why',
    synonyms: ['kpi', 'metric', 'measure', 'indicator', '評価指標', '指標', 'メトリクス'] },
  { key: 'criterion', en: 'criterion', ja: '判定基準', cat: 'why',
    synonyms: ['criterion', 'criteria', 'threshold', 'target', '判定基準', '基準', 'クライテリア', '目標値'] },
  { key: 'acceptance', en: 'acceptance', ja: '受入条件', cat: 'why',
    synonyms: ['acceptance', 'accept', 'pass condition', '受入条件', '受け入れ', '及第', '合格条件'] },
  { key: 'gap', en: 'gap', ja: '差分', cat: 'why',
    synonyms: ['gap', 'shortfall', 'deficit', '差分', '差', 'ギャップ', '未達'] },
  { key: 'decision', en: 'decision', ja: '決定', cat: 'how',
    synonyms: ['decision', 'agreement', 'resolution', '決定', '合意', '取り決め', '決め事'] },
  { key: 'obligation', en: 'obligation', ja: '責務', cat: 'how',
    synonyms: ['obligation', 'duty', 'responsibility', 'deliverable', '責務', '責任', '義務', '成果物'] },
  { key: 'constraint', en: 'constraint', ja: '制約', cat: 'how',
    synonyms: ['constraint', 'restriction', 'limit', '制約', '拘束', '制限'] },
  { key: 'conflict', en: 'conflict', ja: '衝突', cat: 'how',
    synonyms: ['conflict', 'clash', 'contention', '衝突', '競合', '矛盾'] },
  { key: 'entity', en: 'entity', ja: 'エンティティ', cat: 'what',
    synonyms: ['entity', 'object', 'element', 'エンティティ', '要素', '物体'] },
  { key: 'fact', en: 'fact', ja: '事実', cat: 'what',
    synonyms: ['fact', 'given', 'datum', 'measurement', '事実', '所与', '実測', '与件'] },
  { key: 'variable', en: 'variable', ja: '設計変数', cat: 'what',
    synonyms: ['variable', 'var', 'design variable', 'parameter', '設計変数', '変数', 'パラメータ', '共有変数'] },

  // ── Relation verbs (edge.relation / Decision verbs ⇄ NL) ──────────────────
  { key: 'place', en: 'place', ja: '配置する', cat: 'verb',
    synonyms: ['place', 'move', 'grab', 'drag', 'position', 'put', '配置', '移動', '置く', 'グラブ', '位置決め'] },
  { key: 'resolve', en: 'resolve', ja: '解消する', cat: 'verb',
    synonyms: ['resolve', 'settle', 'fix', 'solve', '解消', '解決', '調停', '収束'] },
  { key: 'relax', en: 'relax', ja: '緩和する', cat: 'verb',
    synonyms: ['relax', 'loosen', 'ease', 'soften', '緩和', '緩める', '見直す'] },
  { key: 'constrain', en: 'constrain', ja: '制約する', cat: 'verb',
    synonyms: ['constrain', 'restrict', 'bound', '制約する', '束縛', '拘束する'] },
  { key: 'depend_on', en: 'depends on', ja: 'に依存する', cat: 'verb',
    synonyms: ['depend', 'depends on', 'dependsOn', 'requires', 'needs', '依存', '依存する', '必要とする'] },

  // ── Spatial relation (ADR-168 — Arrangement axis values ⇄ NL) ─────────────
  // key === the domain's declarable value (domain/arrangement.js), pinned both
  // ways by src/SpatialRelationModelDoc.test.js. Scoped: never reached by the
  // category-free lookup (see CATEGORY_SCOPE).
  { key: 'touching', en: 'touching', ja: 'くっついている', cat: 'spatial',
    synonyms: ['touching', 'touch', 'in contact', 'contact', 'くっついている', 'くっついてる', 'くっつく', '接している', '接触', '接触している', '触れている', '密着'] },
  { key: 'apart', en: 'apart', ja: '離れている', cat: 'spatial',
    synonyms: ['apart', 'separated', 'not touching', 'with a gap', '離れている', '離れてる', '離れて', '離す', '非接触', '隙間がある'] },
  { key: 'above', en: 'above', ja: '上方', cat: 'spatial',
    synonyms: ['above', 'over', 'higher than', '上方', '上方にある', '上空'] },
  { key: 'below', en: 'below', ja: '下方', cat: 'spatial',
    synonyms: ['below', 'under', 'beneath', 'lower than', '下方', '下方にある'] },
  { key: 'front', en: 'in front', ja: '手前', cat: 'spatial',
    synonyms: ['front', 'in front', 'in front of', 'nearer', '手前', '前', '前方', '前側'] },
  { key: 'back', en: 'behind', ja: '奥', cat: 'spatial',
    synonyms: ['back', 'behind', 'farther', '奥', '後ろ', '後方', '向こう', '奥側'] },
  { key: 'left', en: 'left', ja: '左', cat: 'spatial',
    synonyms: ['left', 'to the left', 'left of', '左', '左側', '左手'] },
  { key: 'right', en: 'right', ja: '右', cat: 'spatial',
    synonyms: ['right', 'to the right', 'right of', '右', '右側', '右手'] },
  { key: '+z', en: 'top face', ja: '上面', cat: 'spatial',
    synonyms: ['+z', 'top', 'top face', 'top surface', '上面', '天面', '天'] },
  { key: '-z', en: 'bottom face', ja: '底面', cat: 'spatial',
    synonyms: ['-z', 'bottom', 'bottom face', 'underside', '底面', '下面', '底'] },
  { key: '+x', en: '+x face', ja: '+x 面', cat: 'spatial', synonyms: ['+x', '+x面', '+x 面'] },
  { key: '-x', en: '-x face', ja: '-x 面', cat: 'spatial', synonyms: ['-x', '-x面', '-x 面'] },
  { key: '+y', en: '+y face', ja: '+y 面', cat: 'spatial', synonyms: ['+y', '+y面', '+y 面'] },
  { key: '-y', en: '-y face', ja: '-y 面', cat: 'spatial', synonyms: ['-y', '-y面', '-y 面'] },
])

/**
 * Which lookup reaches each category (ADR-168). `global` = the category-free
 * `canonicalKey` (and `canonicalKeyIn`); `scoped` = `canonicalKeyIn` only.
 * A category missing here throws at module load (原則 #31 — "global by default"
 * would be a decision nobody made, and the next colliding category would
 * silently rewrite the shared lookup).
 */
export const CATEGORY_SCOPE = Object.freeze({
  operator: 'global',
  why:      'global',
  how:      'global',
  what:     'global',
  verb:     'global',
  spatial:  'scoped',
})

/** Operator-key → comparison symbol, for compact rendering when wanted. */
const OP_SYMBOL = Object.freeze({
  at_least: '≥', at_most: '≤', greater_than: '>', less_than: '<', equal_to: '=', within: '∈',
})

// Pre-compute the surface-term → key lookups once at module load (the quotient
// maps): the shared one, and one per category.
const _termToKey = new Map()
/** @type {Map<string, Map<string, string>>} */
const _termToKeyByCat = new Map()
const _entryByKey = new Map()
for (const entry of QUOTIENT_TABLE) {
  const scope = CATEGORY_SCOPE[entry.cat]
  if (!scope) {
    throw new Error(`SynonymQuotient: category "${entry.cat}" (key "${entry.key}") has no declared lookup scope in CATEGORY_SCOPE`)
  }
  if (_entryByKey.has(entry.key)) throw new Error(`SynonymQuotient: key "${entry.key}" is declared twice`)
  _entryByKey.set(entry.key, entry)
  if (!_termToKeyByCat.has(entry.cat)) _termToKeyByCat.set(entry.cat, new Map())
  const maps = scope === 'global' ? [_termToKey, _termToKeyByCat.get(entry.cat)] : [_termToKeyByCat.get(entry.cat)]
  for (const term of [entry.key, entry.en, entry.ja, ...entry.synonyms]) {
    const norm = _norm(term)
    if (!norm) continue
    for (const map of maps) {
      const prior = map.get(norm)
      if (prior && prior !== entry.key) {
        throw new Error(`SynonymQuotient: "${term}" is claimed by both "${prior}" and "${entry.key}" in one lookup — a term folds onto one key per scope`)
      }
      map.set(norm, entry.key)
    }
  }
}

/** Normalise a surface term for lookup (lower-case, trim, strip stray spaces). */
function _norm(term) {
  return typeof term === 'string' ? term.trim().toLowerCase() : ''
}

/**
 * Project a surface term onto its equivalence-class representative (φ on the
 * lexicon). Returns the canonical entry, or `null` when the term is outside the
 * quotient (no synonym class claims it — the caller keeps the surface term).
 *
 * @param {string} term
 * @returns {{key:string, en:string, ja:string, cat:string, synonyms:string[]}|null}
 */
export function canonicalize(term) {
  const key = _termToKey.get(_norm(term))
  return key ? _entryByKey.get(key) : null
}

/** The canonical key for a term, or `null` if outside the quotient. */
export function canonicalKey(term) {
  return _termToKey.get(_norm(term)) ?? null
}

/**
 * The canonical key for a term **within one category**, or `null` when the
 * category does not claim it. The only way to reach a `scoped` category
 * (ADR-168 — the spatial words). Throws on a category that is not declared:
 * asking an undeclared category for a word is a typo, not an empty answer.
 *
 * @param {string} term
 * @param {string} cat  a key of CATEGORY_SCOPE
 * @returns {string|null}
 */
export function canonicalKeyIn(term, cat) {
  if (!CATEGORY_SCOPE[cat]) throw new Error(`SynonymQuotient: category "${cat}" is not declared in CATEGORY_SCOPE`)
  return _termToKeyByCat.get(cat)?.get(_norm(term)) ?? null
}

/**
 * Pick the representative surface form of a canonical key in one language. Falls
 * back to the key itself when unknown. This is the one-representative-per-class
 * map φ⁻¹ is allowed to produce (it cannot restore the original synonym).
 *
 * @param {string} key — a canonical key
 * @param {'ja'|'en'} [lang]
 * @returns {string}
 */
export function localize(key, lang = 'ja') {
  const entry = _entryByKey.get(key)
  if (!entry) return key
  return lang === 'en' ? entry.en : entry.ja
}

/**
 * Render a comparison operator (criterion.op or a canonical operator key) as NL.
 * `'>='` / `'at_least'` → "以上" (ja) / "at least" (en). Unknown ops fall through
 * verbatim so a malformed criterion never crashes the narrator (PHILOSOPHY #11).
 *
 * @param {string} op
 * @param {'ja'|'en'} [lang]
 * @returns {string}
 */
export function localizeOperator(op, lang = 'ja') {
  const key = canonicalKey(op)
  if (key && _entryByKey.get(key)?.cat === 'operator') return localize(key, lang)
  return typeof op === 'string' ? op : ''
}

/** The comparison symbol for an operator key/term (≥ ≤ > < = ∈), or the input. */
export function operatorSymbol(op) {
  const key = canonicalKey(op)
  return (key && OP_SYMBOL[key]) || (typeof op === 'string' ? op : '')
}

/**
 * The full equivalence class (every surface synonym) of a key — the preimage φ⁻¹
 * cannot pick a single element of. Exposed for tooling/tests that need to show
 * "these all mean the same thing"; the narrator never uses the whole class.
 *
 * @param {string} key
 * @returns {string[]}
 */
export function synonymsOf(key) {
  const entry = _entryByKey.get(key)
  return entry ? [...entry.synonyms] : []
}
