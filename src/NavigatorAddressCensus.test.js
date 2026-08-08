/**
 * NavigatorAddressCensus.test.js — 「選べるのに、どこにも載っていない実体は
 * 何個あるか」を機械に数えさせる (ADR-111 / 原則 #31 / ADR-102 の母集団規律)
 *
 * ## この検査が答える問い
 *
 * ADR-107 は選択集合の要素を 2 種に広げた。広げた**その日から** `d_ref` は
 * 「選べるのに左のナビゲータに存在しない」状態になったが、当時の検査はどれも
 * 落ちなかった — 検査は *在る行* (Outliner の行・選択の入口・N パネルの分岐) を
 * 辿っており、**載っていないもの**は定義上そこに現れないからである。
 *
 * これは原則 #31 が名指しする形そのもの: 不在は検査対象のノードを持たない。
 * したがってここで数えるのは「意味側に何行あるか」ではなく
 *
 *   **選択可能な種のうち、ナビゲータに住所を持たない種の個数** (= 0 でなければならない)
 *
 * であり、母集団は `SELECTABLE_KINDS` の枝から導出する。3 種目の選択可能種を
 * 足した人は、住所を決めるまでここで止まる。
 *
 * ## もう 1 つ数えるもの — 0 の種
 *
 * 意味側の「空」は 1 種ではない (文書が無い / 文書が変数を宣言していない)。
 * 1 つの空で両方を賄うと、片方の人に嘘の道案内を出す。宣言された 0 の種が
 * すべて**到達可能**であることを逆向きに問う (空回りする宣言は緑を出し続ける)。
 *
 * ## この検査が構造的に見逃すもの (宣言)
 *
 * 「意味側の行を押したら本当に選択が入れ替わるか」は静的には見えない — 窓が
 * 正しい callback を呼ぶことまでは数えるが、`selectOnly` が走ったかは実行時の
 * 事実である。そこは e2e が焼く。境界は宣言であって推論ではない。
 *
 * @see docs/adr/ADR-111-the-outliner-has-a-semantic-side.md
 * @see docs/gsn/adr-111-the-outliner-has-a-semantic-side.gsn
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectSources, relPath, stripCommentsFlat, repoPath, readFileSync } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'
import { SELECTABLE_KINDS, SELECTION_KIND } from './domain/selection.js'
import {
  NAVIGATOR_SIDE, NAVIGATOR_SIDES, DECLARED_NAVIGATOR_SIDES,
  NAVIGATOR_SIDE_BY_SELECTION_KIND, navigatorSideForKind, navigatorSideOrThrow,
  navigatorSideDeclaration, SURFACE_ROLE,
  SEMANTIC_SIDE_KIND, DECLARED_SEMANTIC_SIDE_KINDS,
  semanticSideSummary, semanticSideDeclaration,
} from './view/NavigatorSides.js'

/** ナビゲータを描くファイル (窓の検査の対象)。 */
const NAVIGATOR_FILE = 'src/components/Outliner/Outliner.jsx'

/**
 * 選択可能種のうち、ナビゲータに住所を**持たないと宣言した**もの。
 *
 * 今日は空である。**空であることの宣言も宣言である** (原則 #31) — 除外を
 * 書ける場所が無いと、次の人は住所表のほうを黙って歪めることになる。
 */
const KINDS_WITHOUT_AN_ADDRESS = []

// ─── G1: 住所を持たない選択可能種は 0 個 ─────────────────────────────────────

test('選択できる種はすべてどれかのナビゲータに住所を持つ — 住所なしは 0 個 (ADR-111)', () => {
  assertCoversPopulation({
    what:       '選択可能な種',
    population: [...SELECTABLE_KINDS],
    declared:   Object.keys(NAVIGATOR_SIDE_BY_SELECTION_KIND),
    excluded:   KINDS_WITHOUT_AN_ADDRESS,
    howDerived: 'src/domain/selection.js の SELECTABLE_KINDS (選択の union の枝から導出)',
    onNew:      'view/NavigatorSides.js の NAVIGATOR_SIDE_BY_SELECTION_KIND に行を足し、'
              + '幾何側 (体を持つ) か意味側 (文書の宣言) かを決めること。'
              + '住所を持たない選択可能種は「選べるのにどこにも載っていない」であり、'
              + 'それが ADR-111 の起票理由そのものである',
  })
})

test('住所は宣言された側だけを指す — 未宣言の側は throw する', () => {
  for (const kind of SELECTABLE_KINDS) {
    // 未宣言の側を指した住所は「載せたつもり」で載っていない状態を作る。
    assert.doesNotThrow(() => navigatorSideOrThrow(navigatorSideForKind(kind)),
      `${kind} の住所が未宣言の側を指している`)
  }
  assert.throws(() => navigatorSideForKind('vibes'), /ナビゲータの住所が無い/)
  assert.throws(() => navigatorSideOrThrow('vibes'), /未宣言のナビゲータの側/)
  assert.throws(() => navigatorSideDeclaration('vibes'), /未宣言のナビゲータの側/)
})

test('体を持つ種と持たない種が同じ側に同居していない (ADR-111 §力学 3)', () => {
  // 同じ木に 2 つの意味を持たせないことが、案 A を却下した理由だった。
  assert.equal(navigatorSideForKind(SELECTION_KIND.ENTITIES),  NAVIGATOR_SIDE.GEOMETRY)
  assert.equal(navigatorSideForKind(SELECTION_KIND.VARIABLES), NAVIGATOR_SIDE.SEMANTIC)
})

// ─── G2: 側は 2 つとも役割を宣言している (ADR-112 が引く) ────────────────────

test('すべての側が覆われ方の役割を宣言している — 未宣言の役割は 0 個', () => {
  // ADR-112 D2 の覆う範囲の規則は面の**役割**で引く。役割を持たない側が生まれると
  // その規則が既定へ落ちるので、ここで先に 0 個を保つ。
  const roles = new Set(Object.values(SURFACE_ROLE))
  const missing = DECLARED_NAVIGATOR_SIDES.filter(id => !roles.has(NAVIGATOR_SIDES[id].role))
  assert.deepEqual(missing, [],
    `\n役割を宣言していないナビゲータの側: ${missing.join(', ')}\n` +
    '  一時オーバーレイが覆ってよいかは面の名前ではなく役割で決まる (ADR-112 D2)。\n' +
    '  役割の無い側は、その規則にとって「誰も考えなかった面」になる (原則 #31)。\n')
})

// ─── G3: 意味側の 0 は 2 種に割れている ──────────────────────────────────────

test('意味側の 0 は 2 種に割れ、別々の文言を出す (ADR-111 D4)', () => {
  const noDoc  = semanticSideSummary({ docPresent: false })
  const noVars = semanticSideSummary({ docPresent: true, variables: [] })

  assert.equal(noDoc.kind,  SEMANTIC_SIDE_KIND.NO_DOCUMENT)
  assert.equal(noVars.kind, SEMANTIC_SIDE_KIND.NO_VARIABLES)

  const a = semanticSideDeclaration(noDoc)
  const b = semanticSideDeclaration(noVars)
  assert.notEqual(a.headline, b.headline,
    '2 種の 0 が同じ見出しを出している — 1 つの「空」で両方を賄っている (原則 #31)')
  assert.notEqual(a.detail, b.detail, '2 種の 0 が同じ説明を出している')
  // どちらの 0 にも次の一手がある (行き止まりにしない — 原則 #11 / #16)。
  for (const decl of [a, b]) {
    assert.ok(decl.exit && decl.exitCallback, `0 の種に出口が無い: ${decl.headline}`)
  }
})

test('文書が在るのに変数の配列が来ていない呼びは throw する — 0 を既定で埋めない', () => {
  // 「文書が宣言した 0 個」と「配線が来ていない 0 個」を区別不能にしないため。
  assert.throws(() => semanticSideSummary({ docPresent: true }), /variables が配列でない/)
  assert.throws(() => semanticSideDeclaration({ kind: 'vibes' }), /未宣言の意味側の種/)
})

test('宣言された意味側の種はすべて到達可能 (空回りする宣言は緑を出す)', () => {
  const reachable = new Set([
    semanticSideSummary({ docPresent: false }).kind,
    semanticSideSummary({ docPresent: true, variables: [] }).kind,
    semanticSideSummary({ docPresent: true, variables: [{ ref: 'd_ref' }] }).kind,
  ])
  assert.deepEqual([...reachable].sort(), [...DECLARED_SEMANTIC_SIDE_KINDS].sort(),
    '宣言された種のうち到達できないものがある / 到達するのに宣言の無い種がある')
})

test('住人の投影は doc の欄をそのまま運ぶ — 欠けた欄は null であって既定値ではない', () => {
  const { rows } = semanticSideSummary({
    docPresent: true,
    variables: [{ ref: 'd_ref', unit: 'm', description: 'clearance' }, { ref: 'cycle' }],
  })
  assert.deepEqual(rows, [
    { ref: 'd_ref', unit: 'm',  description: 'clearance' },
    { ref: 'cycle', unit: null, description: null },
  ])
})

// ─── G4: 意味側の行は窓であって入口ではない ─────────────────────────────────

test('意味側の行は既存の窓を通る — 選択の verb を直に呼ばない (ADR-111 D2 / ADR-099 D1)', () => {
  const source = stripCommentsFlat(readFileSync(repoPath(NAVIGATOR_FILE), 'utf8'))
  // 窓は callback を呼ぶだけ。ここで `selMgr.selectOnly(` を書けば入口が 6 つ目に
  // なる — その個数を数えているのは SelectionOwnership.test.js で、あちらの母集団の
  // 作り方を**変えずに**通ることが ADR-107 / ADR-111 の検算である。
  assert.ok(source.includes('callbacks.onSelectVariable'),
    `${NAVIGATOR_FILE} が既存の窓 (onSelectVariable) を通っていない`)
  for (const verb of ['selectOnly(', 'addToSelection(', 'toggleSelection(', 'clearSelection(', 'selectMany(']) {
    assert.ok(!source.includes(verb),
      `${NAVIGATOR_FILE} が選択の verb "${verb}" を直に呼んでいる — 窓ではなく 6 つ目の入口になっている`)
  }
})

test('意味側の窓の callback は src/ のどこかで 1 度登録されている', () => {
  // 文字列の配線は typo がクリックの瞬間まで出ない。押しても何も起きない窓は
  // 無言の no-op (原則 #11)。
  const all = collectSources().map(f => stripCommentsFlat(readFileSync(f, 'utf8'))).join('\n')
  for (const cb of ['onSelectVariable', 'onOpenTemplateGallery', 'onWizardStart']) {
    assert.ok(all.includes(`registerCallback('${cb}'`),
      `意味側が呼ぶ callback "${cb}" が src/ のどこにも登録されていない`)
  }
})

// ─── G5: 側の書き手は 1 つ ──────────────────────────────────────────────────

test('outliner.side を書く入口が 1 個 — 値域は書き込みで守られる (原則 #4 / #31)', () => {
  const writers = []
  for (const abs of collectSources()) {
    const rel  = relPath(abs)
    const body = stripCommentsFlat(readFileSync(abs, 'utf8'))
    if (/\boutlinerSide\s*:/.test(body) && rel !== 'src/store/uiStore.js') writers.push(rel)
  }
  assert.deepEqual(writers, [],
    `\noutlinerSide をストアの外で代入している: ${writers.join(', ')}\n` +
    '  書き手は uiStore の outlinerSetSide ただ 1 つ。値域 guard を迂回する経路を作らないこと。\n')

  const store = stripCommentsFlat(readFileSync(repoPath('src/store/uiStore.js'), 'utf8'))
  assert.ok(/outlinerSetSide:\s*\(side\)\s*=>\s*set\(\{\s*outlinerSide:\s*navigatorSideOrThrow\(side\)/.test(store),
    'outlinerSetSide が値域 guard を通していない — JSDoc の union は散文であって検査ではない')
})

test('走査が空回りしていない (母数の liveness)', () => {
  assert.ok(SELECTABLE_KINDS.length >= 2, '選択可能種の導出が壊れている')
  assert.ok(DECLARED_NAVIGATOR_SIDES.length === 2, `ナビゲータの側が ${DECLARED_NAVIGATOR_SIDES.length} 個`)
  assert.ok(collectSources().length > 50, 'src/ の走査に失敗している')
})
