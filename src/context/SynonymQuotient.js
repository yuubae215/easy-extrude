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
import { cellById, bothAxesSaid } from '../domain/relationCells.js'

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
 * ## Words that are not one value (spatial)
 *
 * A word here is ONE axis value. Two other kinds of saying exist, and both are
 * rows of PHRASE_TABLE, laid onto the grid of cells (domain/relationCells.js):
 *
 * - a COMBINATION fixes two values at once — 載っている = `touching:+z`. It
 *   folds: nothing is chosen for the speaker.
 * - a CHOICE has two readings or more — 上 = `touching:+z` or `apart:above`;
 *   横・beside; on (which face?); 前・後ろ・左手・右手・in front of・behind・
 *   left of・right of (the speaker's front, or the partner's own?). It does not
 *   fold: the caller asks, offering exactly the readings the row names.
 *
 * Neither reaches canonicalKeyIn (→ null); phraseIn answers them. Until
 * 2026-10-25 a choice was only an ABSENT row, which cannot tell "decided to be
 * a choice" from "nobody thought of it" (原則 #31) — now it is declared.
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
    synonyms: ['touching', 'touch', 'in contact', 'contact', 'くっついている', 'くっついてる', 'くっつく', '接している', '接触', '接触している', '触れている', '密着'],
    gloss: { says: '接している — 2 つの面の距離が許容値 (CONTACT_TOLERANCE_MM) 以内', notSays: 'どの面で接しているか・どちらが上か (向きは別の語)' },
    example: { ja: 'ビンが作業台にくっついている', term: 'くっついている' }, contrast: { ja: 'ビンが作業台から離れている', term: '離れている' } },
  { key: 'apart', en: 'apart', ja: '離れている', cat: 'spatial',
    synonyms: ['apart', 'separated', 'not touching', 'with a gap', '離れている', '離れてる', '離れて', '離す', '非接触', '隙間がある'],
    gloss: { says: '離れている — どの面どうしも許容値より遠い', notSays: 'どちらの方向か・どれだけ離れているか (隙間の宣言は DEF-072)' },
    example: { ja: 'ビンは作業台から離れている', term: '離れている' }, contrast: { ja: 'ビンは作業台に接している', term: '接している' } },
  { key: 'above', en: 'above', ja: '上方', cat: 'spatial',
    synonyms: ['above', 'over', 'higher than', '上方', '上方にある', '上空'],
    gloss: { says: '離れていて、重力で見て上方にある', notSays: '接しているか (接していれば above ではない)・真上かどうか' },
    example: { ja: '照明は作業台の上方にある', term: '上方' }, contrast: { ja: '照明は作業台の下方にある', term: '下方' } },
  { key: 'below', en: 'below', ja: '下方', cat: 'spatial',
    synonyms: ['below', 'under', 'beneath', 'lower than', '下方', '下方にある'],
    gloss: { says: '離れていて、重力で見て下方にある', notSays: '接しているか (接していれば below ではない)・真下かどうか' },
    example: { ja: '作業台は照明の下方にある', term: '下方' }, contrast: { ja: '作業台は照明の上方にある', term: '上方' } },
  // front / back / left / right are a declared VIEWER's (relative). Only the
  // words that are always the speaker's own are here: 手前 / 奥 (near / far from
  // whoever speaks). 前・後ろ・左手・in front of・behind・left of are refused —
  // "the robot's front" is the robot's own (intrinsic), see the note above.
  { key: 'front', en: 'nearer', ja: '手前', cat: 'spatial',
    synonyms: ['front', 'nearer', 'closer', '手前', '手前側'],
    gloss: { says: '宣言した見る人から見て手前 (相手より見る人に近い)', notSays: '相手自身の正面 (それは面の語 — 前・in front of は二択なので辞書に入れない)' },
    example: { ja: '工具は箱の手前にある', term: '手前' }, contrast: { ja: '工具は箱の奥にある', term: '奥' } },
  { key: 'back', en: 'farther', ja: '奥', cat: 'spatial',
    synonyms: ['back', 'farther', 'further away', '奥', '奥側', '向こう'],
    gloss: { says: '宣言した見る人から見て奥 (相手より見る人から遠い)', notSays: '相手自身の背面 (それは面の語 — 後ろ・behind は二択)' },
    example: { ja: '工具は箱の奥にある', term: '奥' }, contrast: { ja: '工具は箱の手前にある', term: '手前' } },
  { key: 'left', en: 'left', ja: '左', cat: 'spatial',
    synonyms: ['left', 'to the left', '左', '左側'],
    gloss: { says: '宣言した見る人から見て左', notSays: '相手自身の左 (それは面の語 — 左手・left of は二択)' },
    example: { ja: '工具は箱の左にある', term: '左' }, contrast: { ja: '工具は箱の右にある', term: '右' } },
  { key: 'right', en: 'right', ja: '右', cat: 'spatial',
    synonyms: ['right', 'to the right', '右', '右側'],
    gloss: { says: '宣言した見る人から見て右', notSays: '相手自身の右 (それは面の語 — 右手・right of は二択)' },
    example: { ja: '工具は箱の右にある', term: '右' }, contrast: { ja: '工具は箱の左にある', term: '左' } },
  { key: '+z', en: 'top face', ja: '上面', cat: 'spatial',
    synonyms: ['+z', 'top', 'top face', 'top surface', '上面', '天面', '天'],
    gloss: { says: '相手自身の +z 面 — 接していればその面に、離れていればその面より先の側に', notSays: '世界の上下 (相手が傾けば変わる)・容器の中か外か' },
    example: { ja: 'ビンは作業台の上面に接している', term: '上面' }, contrast: { ja: 'ビンは作業台の底面に接している', term: '底面' } },
  { key: '-z', en: 'bottom face', ja: '底面', cat: 'spatial',
    synonyms: ['-z', 'bottom', 'bottom face', 'underside', '底面', '下面', '底'],
    gloss: { says: '相手自身の -z 面 — 接していればその面に、離れていればその面より先の側に', notSays: '世界の上下 (相手が傾けば変わる)' },
    example: { ja: '作業台はビンの底面に接している', term: '底面' }, contrast: { ja: '作業台はビンの上面に接している', term: '上面' } },
  { key: '+x', en: '+x face', ja: '+x 面', cat: 'spatial', synonyms: ['+x', '+x面', '+x 面'],
    gloss: { says: '相手自身の +x 面 — 接していればその面に、離れていればその面より先の側に', notSays: '世界の向き (相手を回せば回る)・相手の正面かどうか' },
    example: { ja: 'トレイはロボットの +x 面に接している', term: '+x 面' }, contrast: { ja: 'トレイはロボットの -x 面に接している', term: '-x 面' } },
  { key: '-x', en: '-x face', ja: '-x 面', cat: 'spatial', synonyms: ['-x', '-x面', '-x 面'],
    gloss: { says: '相手自身の -x 面 — 接していればその面に、離れていればその面より先の側に', notSays: '世界の向き (相手を回せば回る)' },
    example: { ja: 'トレイはロボットの -x 面に接している', term: '-x 面' }, contrast: { ja: 'トレイはロボットの +x 面に接している', term: '+x 面' } },
  { key: '+y', en: '+y face', ja: '+y 面', cat: 'spatial', synonyms: ['+y', '+y面', '+y 面'],
    gloss: { says: '相手自身の +y 面 — 接していればその面に、離れていればその面より先の側に', notSays: '世界の向き (相手を回せば回る)' },
    example: { ja: 'トレイはロボットの +y 面に接している', term: '+y 面' }, contrast: { ja: 'トレイはロボットの -y 面に接している', term: '-y 面' } },
  { key: '-y', en: '-y face', ja: '-y 面', cat: 'spatial', synonyms: ['-y', '-y面', '-y 面'],
    gloss: { says: '相手自身の -y 面 — 接していればその面に、離れていればその面より先の側に', notSays: '世界の向き (相手を回せば回る)' },
    example: { ja: 'トレイはロボットの -y 面に接している', term: '-y 面' }, contrast: { ja: 'トレイはロボットの +y 面に接している', term: '+y 面' } },
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

/**
 * Categories whose every entry carries its CORE IMAGE and its EXAMPLES
 * (当事者 2026-10-25 — 辞書には語・意味・例文が必ず在る):
 *
 *   gloss    { says, notSays } — the one fact the word says, and what it does
 *            NOT say. The "not" line is what keeps a word from carrying a second
 *            fact (原則 #33-1).
 *   example  { ja, term } — a sentence and the surface term in it that folds
 *            onto this entry.
 *   contrast { ja, term } — the minimal pair: one word changed, a different
 *            entry. A word is understood by what it is NOT next to it.
 *
 * Every example is executable: `src/context/SpatialExamples.test.js` checks the
 * term folds onto the entry, the contrast onto another, and grounds both in a
 * small layout read by the domain's own geometry (原則 #33-4).
 * Not retroactive: the 5W1H categories and the operators have no gloss yet.
 */
export const GLOSSED_CATEGORIES = Object.freeze(['spatial'])

/**
 * PHRASES — ways of saying that are not one axis value, laid onto the grid of
 * cells (`domain/relationCells.js` — contact × direction; 当事者 2026-10-25:
 * 「組み合わせ表を先に作って、辞書を後で当てはめる」). A phrase names the cells it
 * can mean; what KIND of phrase it is follows from how many readings it has —
 * derived, never stored (`phraseKind`):
 *
 *   combination (組)  one cell, both axes said — 載っている = `touching:+z`.
 *                     Nothing is chosen for the speaker; it folds.
 *   choice (二択)     two readings or more — 上 = `touching:+z` or `apart:above`.
 *                     Folding would choose for the speaker; the caller asks,
 *                     and can offer exactly these readings.
 *
 * A one-axis value is a WORD (QUOTIENT_TABLE), not a phrase: a phrase whose one
 * cell leaves an axis unsaid throws at load.
 *
 *   cells  — cell IDs of the grid (throws on an ID outside it or a cell the
 *            validator refuses)
 *   notYet — readings that have no cell yet, each naming the deferral that
 *            holds it (「機械の前」 = the machine's own front: DEF-073). Counted as
 *            readings, so 前 is a choice even though only one of its readings
 *            is a cell today.
 *
 * @type {ReadonlyArray<{key:string, en:string, ja:string, cat:string, cells:string[],
 *                       notYet?:string[], synonyms:string[], gloss:{says:string, notSays:string},
 *                       example:{ja:string, term:string}, contrast:{ja:string, term:string}}>}
 */
export const PHRASE_TABLE = Object.freeze([
  // ── combinations (組) ──
  { key: 'resting_on', en: 'resting on', ja: '載っている', cat: 'spatial',
    cells: ['touching:+z'],
    synonyms: ['載っている', '載ってる', '載せてある', 'resting on', 'sitting on', 'on top of'],
    gloss: { says: '接していて、相手自身の +z 面の側にある (touching + +z)', notSays: '固定されているか (可動性は jointType)・容器の中か上か' },
    example: { ja: 'ビンは作業台に載っている', term: '載っている' }, contrast: { ja: 'ビンは作業台の上方にある', term: '上方' } },
  // ── choices (二択) ──
  { key: 'up_choice', en: 'up', ja: '上', cat: 'spatial',
    cells: ['touching:+z', 'apart:above'],
    synonyms: ['上', '上に', 'up'],
    gloss: { says: '相手より上のどこか — 載っているか、離れて上方か', notSays: 'そのどちらか (話し手に問う)' },
    example: { ja: 'ビンは作業台の上にある', term: '上' }, contrast: { ja: 'ビンは作業台の下方にある', term: '下方' } },
  { key: 'down_choice', en: 'down', ja: '下', cat: 'spatial',
    cells: ['touching:-z', 'apart:below'],
    synonyms: ['下', '下に', 'down'],
    gloss: { says: '相手より下のどこか — 底面に接しているか、離れて下方か', notSays: 'そのどちらか (話し手に問う)' },
    example: { ja: '作業台は照明の下にある', term: '下' }, contrast: { ja: '作業台は照明の上方にある', term: '上方' } },
  { key: 'beside_choice', en: 'beside', ja: '横', cat: 'spatial',
    cells: ['touching:+x', 'touching:-x', 'touching:+y', 'touching:-y',
            'apart:+x', 'apart:-x', 'apart:+y', 'apart:-y', 'apart:left', 'apart:right'],
    synonyms: ['横', '横に', 'そば', 'beside', 'next to', 'by'],
    gloss: { says: '相手の側面のどこか — 接しているか離れているか、どちらの側か', notSays: '接触も、どの側かも (話し手に問う)' },
    example: { ja: 'トレイはロボットの横にある', term: '横' }, contrast: { ja: 'トレイはロボットの上方にある', term: '上方' } },
  { key: 'on_choice', en: 'on', ja: 'on', cat: 'spatial',
    cells: ['touching:+x', 'touching:-x', 'touching:+y', 'touching:-y', 'touching:+z', 'touching:-z'],
    synonyms: ['on'],
    gloss: { says: '接している (on the table / on the wall)', notSays: 'どの面か (話し手に問う)・支えているか (支えはまだ軸が無い)' },
    example: { ja: 'the bin is on the workbench', term: 'on' }, contrast: { ja: 'the bin is apart from the workbench', term: 'apart' } },
  { key: 'front_choice', en: 'in front of', ja: '前', cat: 'spatial',
    cells: ['apart:front'], notYet: ['相手自身の正面 (DEF-073)'],
    synonyms: ['前', '前方', '前側', 'in front of'],
    gloss: { says: '話し手 (見る人) の手前か、相手自身の正面か', notSays: 'そのどちらか (話し手に問う)。相手自身の正面はまだマスが無い' },
    example: { ja: '工具は箱の前にある', term: '前' }, contrast: { ja: '工具は箱の奥にある', term: '奥' } },
  { key: 'behind_choice', en: 'behind', ja: '後ろ', cat: 'spatial',
    cells: ['apart:back'], notYet: ['相手自身の背面 (DEF-073)'],
    synonyms: ['後ろ', '後方', 'behind'],
    gloss: { says: '話し手 (見る人) から見て奥か、相手自身の背面の側か', notSays: 'そのどちらか (話し手に問う)。相手自身の背面はまだマスが無い' },
    example: { ja: '工具は箱の後ろにある', term: '後ろ' }, contrast: { ja: '工具は箱の手前にある', term: '手前' } },
  { key: 'left_choice', en: 'left of', ja: '左手', cat: 'spatial',
    cells: ['apart:left'], notYet: ['相手自身の左 (DEF-073)'],
    synonyms: ['左手', 'left of'],
    gloss: { says: '話し手 (見る人) から見て左か、相手自身の左か', notSays: 'そのどちらか (話し手に問う)。相手自身の左はまだマスが無い' },
    example: { ja: '工具は箱の左手にある', term: '左手' }, contrast: { ja: '工具は箱の右にある', term: '右' } },
  { key: 'right_choice', en: 'right of', ja: '右手', cat: 'spatial',
    cells: ['apart:right'], notYet: ['相手自身の右 (DEF-073)'],
    synonyms: ['右手', 'right of'],
    gloss: { says: '話し手 (見る人) から見て右か、相手自身の右か', notSays: 'そのどちらか (話し手に問う)。相手自身の右はまだマスが無い' },
    example: { ja: '工具は箱の右手にある', term: '右手' }, contrast: { ja: '工具は箱の左にある', term: '左' } },
])

/** What kind of phrase a row is — derived from its readings, never stored. */
export function phraseKind(phrase) {
  const readings = phrase.cells.length + (phrase.notYet?.length ?? 0)
  return readings === 1 ? 'combination' : 'choice'
}

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

function _requireGloss(entry, table) {
  if (!GLOSSED_CATEGORIES.includes(entry.cat)) return
  const ok = (o, ...ks) => o && ks.every(k => typeof o[k] === 'string' && o[k] !== '')
  if (!ok(entry.gloss, 'says', 'notSays')) throw new Error(`SynonymQuotient: ${table} "${entry.key}" has no gloss { says, notSays } — category "${entry.cat}" carries its core image`)
  for (const k of ['example', 'contrast']) {
    if (!ok(entry[k], 'ja', 'term')) throw new Error(`SynonymQuotient: ${table} "${entry.key}" has no ${k} { ja, term }`)
    if (!entry[k].ja.includes(entry[k].term)) throw new Error(`SynonymQuotient: ${table} "${entry.key}" ${k}: "${entry[k].term}" is not in "${entry[k].ja}"`)
  }
}
for (const entry of QUOTIENT_TABLE) _requireGloss(entry, 'QUOTIENT_TABLE')

/** @type {Map<string, Map<string, object>>} */
const _phraseByCat = new Map()
for (const phrase of PHRASE_TABLE) {
  if (CATEGORY_SCOPE[phrase.cat] !== 'scoped') throw new Error(`SynonymQuotient: phrase "${phrase.key}" is in category "${phrase.cat}", which is not a declared scoped category`)
  if (_entryByKey.has(phrase.key)) throw new Error(`SynonymQuotient: phrase key "${phrase.key}" is also a word key`)
  if (!Array.isArray(phrase.cells) || phrase.cells.length === 0) throw new Error(`SynonymQuotient: phrase "${phrase.key}" names no cell — a phrase that means nothing on the grid is not a phrase`)
  const cells = phrase.cells.map(id => {
    const cell = cellById(id)   // throws outside the grid
    if (!cell.declarable) throw new Error(`SynonymQuotient: phrase "${phrase.key}" names the cell ${id}, which cannot be declared: ${cell.reason}`)
    return cell
  })
  if (new Set(phrase.cells).size !== phrase.cells.length) throw new Error(`SynonymQuotient: phrase "${phrase.key}" names a cell twice`)
  if (phraseKind(phrase) === 'combination' && !bothAxesSaid(cells[0])) {
    throw new Error(`SynonymQuotient: phrase "${phrase.key}" has one reading (${cells[0].id}) that leaves an axis unsaid — that is a word, not a combination`)
  }
  _requireGloss(phrase, 'PHRASE_TABLE')
  if (!_phraseByCat.has(phrase.cat)) _phraseByCat.set(phrase.cat, new Map())
  const words = _termToKeyByCat.get(phrase.cat) ?? new Map()
  const phrases = _phraseByCat.get(phrase.cat)
  const answer = Object.freeze({
    key: phrase.key,
    kind: phraseKind(phrase),
    cells: Object.freeze(cells),
    notYet: Object.freeze([...(phrase.notYet ?? [])]),
  })
  for (const term of [phrase.key, phrase.en, phrase.ja, ...phrase.synonyms]) {
    const norm = _norm(term)
    if (!norm) continue
    if (words.has(norm)) throw new Error(`SynonymQuotient: "${term}" is both the word "${words.get(norm)}" and the phrase "${phrase.key}" — a term folds onto one thing per scope`)
    const prior = phrases.get(norm)
    if (prior && prior.key !== phrase.key) throw new Error(`SynonymQuotient: "${term}" is claimed by phrases "${prior.key}" and "${phrase.key}"`)
    phrases.set(norm, answer)
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
 * What a term means **as a phrase** within one category: its kind (combination
 * or choice), the cells it can mean, and the readings that have no cell yet —
 * or `null` when no phrase claims it. A word (`canonicalKeyIn`) and a phrase
 * never share a term. Throws on an undeclared category, as `canonicalKeyIn` does.
 *
 *   phraseIn('載っている', 'spatial') → { key: 'resting_on', kind: 'combination', cells: [touching:+z] }
 *   phraseIn('上', 'spatial')        → { key: 'up_choice', kind: 'choice', cells: [touching:+z, apart:above] }
 *
 * @param {string} term
 * @param {string} cat
 * @returns {{key: string, kind: 'combination'|'choice', cells: ReadonlyArray<object>, notYet: ReadonlyArray<string>}|null}
 */
export function phraseIn(term, cat) {
  if (!CATEGORY_SCOPE[cat]) throw new Error(`SynonymQuotient: category "${cat}" is not declared in CATEGORY_SCOPE`)
  return _phraseByCat.get(cat)?.get(_norm(term)) ?? null
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
