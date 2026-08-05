/**
 * DiscoveryOutsideTheFloor.test.js — 発見の集約が**場の外**に居ることを個数で問う
 * (ADR-105 / 原則 #31 / ADR-102 の母集団規律)
 *
 * ## この検査が答える問い
 *
 * ADR-105 が閉じた欠陥は「描き手が場の中にしか居ない」ことだった。ところが
 * *在る描き手*を辿る数え方では、**10 個目の描き手が場の中に生まれた日**を見逃す —
 * 誰かが表に足すまで、その描き手は検査対象のノードを持たないからである。
 *
 * したがって母集団を**構文から導出**する:
 *
 *   母集団 = `src/**` のうち、発見の集約 (`context.discovery` /
 *            `context.checksSummary` / `discoverySummary` / `checksSummary`) を読むファイル
 *
 * その集合と「`ctx.active` (場が開いているか) を読むファイル」の**交わりが 0 個**で
 * あることを問う。新しい描き手が明日生まれても、母集団に自動で入る。
 *
 * ## 3 つの問い (ADR-105 §Consequences「数える形」)
 *
 * 1. 発見の集約を描く箇所のうち、`ctx.active` に依存するものが **0 個**
 * 2. 集約スライスを書くストア入口が **1 個** (ADR-105 以前は 2 個: `contextSetAgenda` と退出リデューサ)
 * 3. `kind` を分岐せずに集約を読む消費者が **0 個**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, relPath, stripCommentsFlat, repoPath } from './census/sources.js'
import { assertCoversPopulation, assertDeclarationsExist } from './census/partition.js'
import { graspEntryFor, DECLARED_NPANEL_KINDS } from './view/EntityScopeChecks.js'

// ── 形の宣言 (禁じられた形 / 母集団を切り出す形) ────────────────────────────

/**
 * 「発見の集約を読んでいる」と認める形。ストア経由と純粋関数経由の両方を拾う。
 * ここに載っていない読み方が生まれたら行を足す — それが母集団の定義である。
 */
const AGGREGATE_READS = [
  /\bcontext\.discovery\b/,
  /\bcontext\.checksSummary\b/,
  /\bs\.context\.discovery\b/,
  /\bs\.context\.checksSummary\b/,
  /\bdiscoverySummary\s*\(/,
  /\bchecksSummary\s*\(/,
  /\bdiscoveryDeclaration\s*\(/,
  /\bchecksDeclaration\s*\(/,
]

/** 「場が開いているか」を読んでいる形 — 集約の描き手がこれに触れたら落ちる。 */
const FLOOR_GATES = [
  /\bctx\.active\b/,
  /\bcontext\.active\b/,
  /\bs\.context\.active\b/,
  /\bisNegotiation\b/,
]

/**
 * 集約の**書き手**として認める形 (ストアの代入)。
 * `contextSetDiscovery` ただ 1 つであることを問う。
 */
const AGGREGATE_WRITES = [
  /\bdiscovery\s*,\s*checksSummary\s*\}/,   // set(...) のオブジェクトリテラルへの代入
  /\bagendaCounters:\s*\{/,                 // ADR-105 以前の形 — 復活したら落ちる
]

/**
 * **対象外の宣言** — 集約を読むが「描き手ではない」ファイル。
 * 理由の無い除外は、忘れられた除外と区別がつかない (原則 #31)。
 */
const NOT_A_RENDERER = [
  { key: 'src/context/DiscoverySummary.js',
    why: '集約の型と宣言表そのもの。純粋関数で、場も画面も知らない' },
  { key: 'src/service/ContextService.js',
    why: '集約を組み立てる service glue。ドメインと描き手のあいだで、場を参照しない' },
  { key: 'src/controller/ContextController.js',
    why: '唯一の書き手への配線 (_refreshDocReadModels)。場の開閉とは別の辺 (contextLoaded / contextChanged) に繋いである' },
  { key: 'src/view/DocPresence.js',
    why: '「文書を採ったか」を答える唯一の述語 (ADR-111)。集約の 1 欄を読むだけの純粋関数で、'
       + '場も画面も知らない。ここに畳んだことで、同じ導出が 2 箇所に書かれる形が消えた (§1.1)' },
  // `src/store/uiStore.js` はここに**居ない**。初回実行でこの逆向き検査が空回りを
  // 検出した — ストアは集約を *読まない* (スライスを宣言し、値を受け取って代入する
  // だけ) ので母集団に入らず、除外の宣言は最初から空回りしていた。書き手としての
  // uiStore は「集約スライスを書くストア入口が 1 個」の側が数えている。
]

/**
 * **退役した形の宣言** — ADR-105 が消した形が、消えたままであることを問う。
 * 退役の腐敗は違反を見逃すのではなく **緑を出す** (ADR-103 の教訓) ので、
 * 消したこと自体を数える。
 */
const RETIRED_FORMS = [
  { key: 'context.agendaCounters',
    why: '3 数の生スライス。kind 判別の union (context.discovery) へ置き換えた (ADR-105 D2)' },
  { key: 'contextSetAgenda(this._ctxService.projectAgenda(), ',
    why: '集約を場のリプロジェクションに相乗りさせていた形。集約は文書の辺に繋がる (D1)' },
]

// ── 母集団の導出 ────────────────────────────────────────────────────────────

const SOURCES = collectSources().map(abs => ({
  file: relPath(abs),
  body: stripCommentsFlat(readFileSync(abs, 'utf8')),
}))

/** 集約を読むファイル (= 母集団)。**在る描き手のリストは持たない。** */
const AGGREGATE_READERS = SOURCES
  .filter(s => AGGREGATE_READS.some(re => re.test(s.body)))
  .map(s => s.file)

// ── 問い 1: 集約の描き手は場に依存しない ────────────────────────────────────

test('発見の集約を読むファイルは、母集団として導出できている (空回りしていない)', () => {
  assert.ok(AGGREGATE_READERS.length >= 4,
    `集約を読むファイルが ${AGGREGATE_READERS.length} 個しか見つからない。読み方の形が変わったなら ` +
    'AGGREGATE_READS に足すこと — 母集団が空の検査は「緑」を出し続ける (原則 #31 の同型)。')
})

test('集約を描く箇所のうち ctx.active に依存するものが 0 個', () => {
  const renderers = AGGREGATE_READERS.filter(
    f => !NOT_A_RENDERER.some(x => x.key === f),
  )
  const bodies = new Map(SOURCES.map(s => [s.file, s.body]))

  const gated = renderers
    .filter(f => FLOOR_GATES.some(re => re.test(bodies.get(f))))
    .map(f => `  ${f}`)

  assert.deepEqual(gated, [],
    `\n発見の集約を、場が開いているかで隠している描き手がある:\n${gated.join('\n')}\n\n` +
    '  母集団の導出: src/** のうち集約を読むファイル (AGGREGATE_READS) から、\n' +
    '  「描き手ではない」と宣言したものを除いた集合。\n' +
    '  → 場に入る必要があるかを教えるものが、場に入らないと存在しない形に戻っている。\n' +
    '  ADR-105 D1: 集約は Context オーバーレイの外に住み、場の開閉と独立に存在する。\n')
})

test('「描き手ではない」の宣言が空回りしていない', () => {
  assertCoversPopulation({
    what:       '発見の集約を読むファイル',
    population: AGGREGATE_READERS,
    // 描き手は宣言せず、母集団から除外だけを宣言する — 描き手の側を手で並べると
    // 「10 個目の描き手」が表に載るまで数えられない (ADR-102)。
    declared:   AGGREGATE_READERS.filter(f => !NOT_A_RENDERER.some(x => x.key === f)),
    excluded:   NOT_A_RENDERER,
    howDerived: 'src/** を走査し AGGREGATE_READS のいずれかに一致するファイル',
    onNew:      '新しい読み手が描き手なら ctx.active を読まないこと。描き手でないなら NOT_A_RENDERER に理由つきで宣言すること',
  })
})

// ── 問い 2: 導出値の書き手は 1 個 ───────────────────────────────────────────

test('集約スライスを書くストア入口が 1 個', () => {
  const store = stripCommentsFlat(readFileSync(repoPath('src/store/uiStore.js'), 'utf8'))
  const lines = store.split('\n')

  const writers = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => AGGREGATE_WRITES.some(re => re.test(line)))
    .map(({ line, n }) => `  uiStore.js:${n}  ${line.trim().slice(0, 90)}`)

  assert.equal(writers.length, 1,
    `\n集約スライスの書き手が ${writers.length} 個ある (期待 1):\n${writers.join('\n')}\n\n` +
    '  ADR-105 D4: 「Context を抜けた」は集約が変わる理由ではない — 抜けても衝突は 3 件のままである。\n' +
    '  UI の遷移が導出されたドメインの事実を書き換えられる限り、その事実は導出値ではなく第二の源である\n' +
    '  (原則 #4 / #24)。文書を手放したなら unexamined へ*遷移*させること — 0 で埋めない。\n')
})

test('退役した形が復活していない', () => {
  const all = SOURCES.map(s => s.body).join('\n')
  assertDeclarationsExist({
    what:         'ADR-105 が退役させた形',
    declarations: RETIRED_FORMS,
    // 「実在するか」を反転して使う: 退役形は *実在しない* ことが正しいので、
    // ここでは「宣言が有効か」= その形が src/** に無いことを問う。
    exists:       key => !all.includes(key),
    onStale:      '退役させた形が src/** に戻っている。ADR-105 D2/D4 を読み直すこと ' +
                  '(退役の腐敗は違反を見逃すのではなく緑を出す — ADR-103 の教訓)',
  })
})

// ── 問い 3: kind を分岐せずに集約を読む消費者が 0 個 ────────────────────────

test('kind を分岐せずに集約を読む消費者が 0 個', () => {
  const bodies = new Map(SOURCES.map(s => [s.file, s.body]))
  const consumers = AGGREGATE_READERS.filter(
    f => !NOT_A_RENDERER.some(x => x.key === f),
  )

  const blind = consumers
    .filter(f => {
      const body = bodies.get(f)
      // `kind` を明示的に分岐しているか、宣言表 (未宣言の種で throw する) を引いているか。
      return !/\bDISCOVERY_KIND\b|\bCHECKS_KIND\b|\.kind\b|\bdiscoveryDeclaration\s*\(|\bchecksDeclaration\s*\(/.test(body)
    })
    .map(f => `  ${f}`)

  assert.deepEqual(blind, [],
    `\nkind を見ずに集約を読んでいる消費者がある:\n${blind.join('\n')}\n\n` +
    '  ADR-105 D2/D3: 0 は 3 種類あり、次の一手が全部違う。kind を分岐せずに数だけ読むと、\n' +
    '  「調べて無かった」と「まだ調べていない」が同じ 0 に潰れる — union を入れた意味が消える。\n')
})

// ── D5: エンティティスコープの検証は選択に従う ──────────────────────────────

test('N パネルの entity-scope 検証は、選択以外の軸で可用性を決めない', () => {
  const body = stripCommentsFlat(
    readFileSync(repoPath('src/view/EntityScopeChecks.js'), 'utf8'))

  const gated = FLOOR_GATES.filter(re => re.test(body)).map(re => `  ${re}`)
  assert.deepEqual(gated, [],
    `\nentity-scope の検証が場の開閉を読んでいる:\n${gated.join('\n')}\n\n` +
    '  ADR-105 D5: 可用性は「その実体が選ばれているか」で決まる。`置く → 届くか見る → 置き直す`\n' +
    '  のループは、場への往復を挟むと閉じない。\n')

  assert.ok(/\bnPanelData\b/.test(body),
    'entity-scope の判定が選択 (nPanelData) を読んでいない — 何の隣に居るのか決まっていない')
})

test('entity-scope の宣言表が、N パネルが描き分ける実体種を全部覆っている', () => {
  // 母集団は **NPanel.jsx の構文から導出**する — 「今は 3 種」は事実であって規則ではない。
  // 4 種目が描き分けられた日に、宣言表へ足すまでここが落ちる (原則 #31 / ADR-102)。
  const panel = stripCommentsFlat(readFileSync(repoPath('src/components/NPanel/NPanel.jsx'), 'utf8'))
  const population = [...new Set(
    [...panel.matchAll(/nPanelData\?\.type\s*===\s*'([a-z-]+)'/g)].map(m => m[1]),
  )]

  assertCoversPopulation({
    what:       'N パネルが描き分ける実体種',
    population,
    declared:   [...DECLARED_NPANEL_KINDS],
    howDerived: "src/components/NPanel/NPanel.jsx の `nPanelData?.type === '…'` 分岐",
    onNew:      'EntityScopeChecks.js の ENTITY_SCOPE_BY_KIND に行を足すこと — ' +
                '未宣言の種は throw するので、足さなければ N パネルがその種で開かない (原則 #31)',
  })
})

test('未宣言の実体種では throw する — fall-through で既定を返さない', () => {
  assert.throws(() => graspEntryFor({ type: 'something-new' }), /未宣言の実体種/)
  // 選択が無いのは「種が無い」ことなので、throw ではなく理由つきの不可用 (#11)。
  // 理由は 1 種ではない — シーンのロボットの基数が決める (ADR-110 D4 / ADR-090)。
  // その基数を渡さない呼びだけが throw する: 既定へ倒すと 0 台の人に嘘が出る。
  const blocked = graspEntryFor(null, { robotCardinality: 'single' })
  assert.equal(blocked.available, false)
  assert.ok(blocked.reason?.length > 0, '選択が無いときの不可用に理由が無い')
})

test('grasp の入口は宣言された役割で決まる — 名前では決まらない', () => {
  // 名前はロボット間で一意ではない (ADR-090 D1) ので、名前一致では 2 台目を識別できない。
  assert.equal(graspEntryFor({ type: 'frame', robotRole: 'base' }).available, true)
  assert.equal(graspEntryFor({ type: 'frame', robotRole: 'tcp' }).available, true)
  assert.equal(graspEntryFor({ type: 'frame', name: 'robot_base', robotRole: null }).available, false)
  // 不可用な入口は必ず理由を運ぶ (原則 #11 — 無言の no-op を作らない)。
  for (const sel of [{ type: 'generic' }, { type: 'link' }, { type: 'frame', robotRole: null }]) {
    const r = graspEntryFor(sel)
    assert.equal(r.available, false)
    assert.ok(r.reason && r.reason.length > 0, `${sel.type} の不可用に理由が無い`)
  }
})
