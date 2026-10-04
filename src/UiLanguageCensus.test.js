/**
 * UiLanguageCensus.test.js — 「画面に日本語の文言が何個あるか」を機械に数えさせる
 * (ADR-161 · 原則 #31 · ADR-102 の母集団導出)
 *
 * ## この検査が答える問い
 *
 * UI の言語は英語 (ADR-161)。それまで言語は**決められていなかった**ので、
 * 書いた日の書き手の言語がそのまま画面に出ていた — ホーム画面・変数パネル・
 * テンプレのカード・サンプルシーンの実体名。設計散文 (ADR・コメント・`why`) を
 * 日本語で書くこの repo では、決めていない限り混入は毎回起きる。
 *
 * 数えるのは*在る UI 文言*ではなく **`src/**` で日本語が残っている箇所の個数**で、
 * 0 であるべきところに正当な非ゼロ (入力語彙) を**理由つきで宣言**させる。
 *
 * ## 母集団はどこから来るか (place-list を書かない)
 *
 *   - コード: `collectSources()` の全ファイル。開発者向けの散文 (コメント・
 *     `throw` / `…Error(` の引数・`why:` の値) は `census/uiText.js` が**構文で**
 *     落とす。残った日本語は UI に出うる文字列である。
 *   - データ: `examples/*.json` の全文字列 (テンプレを選ぶとそのままシーンの
 *     実体名・説明になる) と `LAYOUT_TEMPLATE_CATALOG` のカード。
 *
 * ## この証拠が構造的に見逃すもの (宣言)
 *
 *   - `why:` 以外の鍵に置かれた設計散文は UI 文言として数える (誤検知側に倒す)。
 *     逆に `why` の値を画面に描く経路を新しく作れば、その文は検査の外にある。
 *   - サーバ (`server/`) と判定エンジン (`core/`) が返す文は数えない — ワイヤに
 *     載るのはソルバが決定した事実で、提示文はクライアントで導出する (原則 #29)。
 *   - `templates/` はバックエンドの受け入れフィクスチャで、画面には出ない。
 *
 * @see docs/adr/ADR-161-the-ui-speaks-english.md
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { collectSources, readFileSync, relPath, repoPath } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'
import { JAPANESE, japaneseLines, userFacingSource } from './census/uiText.js'
import { LAYOUT_TEMPLATE_CATALOG } from './layout/LayoutTemplateCatalog.js'
import { narrateProvenance, narrateWhyTree } from './context/ProvenanceNarrative.js'

/**
 * 日本語が残ってよいファイルと理由。**画面に出す文言の除外はここに書けない** —
 * 書いた瞬間に ADR-161 を改訂する話になる。
 */
const NOT_UI_TEXT = [
  { key: 'src/context/SynonymQuotient.js',
    why: '入力の語彙 (キュレーション同義語商)。ユーザーが日本語で書いた要求を決定的に '
       + '正規形へ写すための辞書で、画面には出さない — 入力は日英どちらも受ける (ADR-161 D2)' },
  { key: 'src/context/NlIntake.js',
    why: '入力の語彙 (「約」「不明」等のぼかし語・接続詞)。日本語の入力を読むためのもので、'
       + '表示文言ではない (ADR-161 D2)' },
  { key: 'src/context/ProvenanceNarrative.js',
    why: "`lang: 'ja'` で明示的に求めたときだけの日本語版。既定は英語で、既定が英語で "
       + 'あることは下の test が問う (ADR-161 D3)' },
]

// ─── 道具そのものの検査 (空回りする検査は緑を出す) ─────────────────────────

test('道具: 開発者向けの散文は落ち、画面に出うる文字列は残る', () => {
  const src = [
    "// 日本語のコメント",
    "/* ブロック */ const url = 'https://example.com' // 行末の日本語",
    "throw new Error(`未宣言の種 ${k}` + '— 表に行を足すこと')",
    "throw new MalformedKinematics('UR は 6 軸')",
    "const T = { a: { label: 'A', why: '理由' + `も ${x}`, title: 'B' } }",
    "const ui = <span>{/* 注釈 */}画面の文言</span>",
    "const s = 'ラベル'",
  ].join('\n')
  const hits = japaneseLines(src).map(h => h.line)
  assert.deepEqual(hits, [6, 7], userFacingSource(src))
  // 落としたのは散文だけで、隣の UI 文言は残っている
  assert.match(userFacingSource(src), /title: 'B'/)
  assert.match(userFacingSource(src), /'https:\/\/example.com'/)
})

// ─── コード: src/** に残る日本語 ─────────────────────────────────────────────

test('src/** の UI に出うる文字列に日本語が無い (入力語彙は理由つきで宣言)', () => {
  const found = new Map()
  for (const abs of collectSources()) {
    const hits = japaneseLines(readFileSync(abs, 'utf8'))
    if (hits.length) found.set(relPath(abs), hits)
  }
  const declared = new Set(NOT_UI_TEXT.map(e => e.key))
  const undeclared = [...found]
    .filter(([file]) => !declared.has(file))
    .map(([file, hits]) => `  ${file}\n` + hits.slice(0, 5).map(h => `    ${h.line}: ${h.text}`).join('\n'))
  assert.deepEqual(undeclared, [],
    '\n[UI の言語] 画面に出うる文字列に日本語がある:\n' + undeclared.join('\n') + '\n\n' +
    '  → UI の文言は英語で書く (ADR-161)。開発者向けの文なら throw の引数か why: に置く。\n' +
    '    入力の語彙なら NOT_UI_TEXT に理由つきで宣言する。\n')

  assertCoversPopulation({
    what: 'UI の言語 (日本語が残るファイル)',
    population: [...found.keys()],
    declared: [],
    excluded: NOT_UI_TEXT,
    howDerived: 'collectSources() の各ファイルから census/uiText.js で散文を落とし、日本語が残るもの',
    onNew: 'UI の文言を英語にするか、入力語彙なら NOT_UI_TEXT に理由つきで宣言する',
  })
})

// ─── データ: テンプレとサンプルシーン ────────────────────────────────────────

/** JSON の全文字列を `[path, value]` で列挙する。 */
function* stringsOf(value, path = '') {
  if (typeof value === 'string') { yield [path, value]; return }
  if (Array.isArray(value)) { for (const [i, v] of value.entries()) yield* stringsOf(v, `${path}[${i}]`); return }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* stringsOf(v, `${path}.${k}`)
}

test('テンプレのカード (LAYOUT_TEMPLATE_CATALOG) は英語', () => {
  const bad = [...stringsOf(LAYOUT_TEMPLATE_CATALOG)].filter(([, v]) => JAPANESE.test(v))
  assert.deepEqual(bad, [])
})

test('examples/*.json の文字列は英語 — テンプレを選ぶとそのまま実体名・説明になる', () => {
  const files = readdirSync(repoPath('examples')).filter(f => f.endsWith('.json'))
  assert.ok(files.length > 0, 'examples/ が空 — 母集団 0 個の検査は何も問わない (原則 #31)')
  const bad = []
  for (const f of files) {
    const doc = JSON.parse(readFileSync(repoPath(`examples/${f}`), 'utf8'))
    for (const [path, v] of stringsOf(doc)) if (JAPANESE.test(v)) bad.push(`  ${f}${path}: ${v}`)
  }
  assert.deepEqual(bad, [], '\n[UI の言語] サンプルに日本語の文字列がある:\n' + bad.join('\n'))
})

// ─── 既定の言語 ──────────────────────────────────────────────────────────────

test('Why の語り手は、言語を指定しなければ英語で語る (ADR-161 D3)', () => {
  for (const text of [narrateProvenance(null), narrateWhyTree(null)]) {
    assert.ok(text.length > 0)
    assert.ok(!JAPANESE.test(text), `既定の語りに日本語がある: ${text}`)
  }
})
