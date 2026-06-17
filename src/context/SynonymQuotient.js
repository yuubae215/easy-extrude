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
])

/** Operator-key → comparison symbol, for compact rendering when wanted. */
const OP_SYMBOL = Object.freeze({
  at_least: '≥', at_most: '≤', greater_than: '>', less_than: '<', equal_to: '=', within: '∈',
})

// Pre-compute the surface-term → key lookup once at module load (the quotient map).
const _termToKey = new Map()
const _entryByKey = new Map()
for (const entry of QUOTIENT_TABLE) {
  _entryByKey.set(entry.key, entry)
  for (const term of [entry.key, entry.en, entry.ja, ...entry.synonyms]) {
    const norm = _norm(term)
    if (norm) _termToKey.set(norm, entry.key)
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
