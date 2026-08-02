/**
 * SelectionKindDeclarations.test.js — 「選択可能な種のうち、姿と分岐を宣言して
 * いないものが 0 個」を機械に問わせる (ADR-107 D4 / D6 / 原則 #31 / #11)
 *
 * ## なぜ *在る種* を辿る検査では足りないのか
 *
 * ADR-107 まで、選択できるものは全部 3D に姿を持っていた。だから「選ぶと何かが
 * 見える」は**規則ではなく、母集団の偶然**だった。種が 1 → 2 になったこの変更で
 * 規則にしておかないと、3 種目を足した人が無言 (原則 #11 — 入力は消費されたのに
 * 何も起きない) を再導入し、**しかもテストは緑のまま**になる。
 *
 * したがって母集団は手書きの種リストではなく **union の枝から導出**する
 * (`SELECTION_KIND` / `SELECTABLE_KINDS`)。枝を足して表に行を足さなければ落ちる —
 * 「今日の 2 種」を写した表なら、明日の 3 種目は検査対象のノードを持たない。
 *
 * ## 逆向きも問う
 *
 * 対象が 0 個になったことと規則が守られていることは区別がつかない (原則 #31 の
 * 同型)。だから宣言 → 実装 (painter が実在するか) も数える。宣言だけ在って誰も
 * 描かない `paint` 名は、退役の腐敗と同じで**緑を出す**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { repoPath, stripComments } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'
import { SELECTION_KIND, SELECTABLE_KINDS } from './domain/selection.js'
import {
  SELECTION_SHAPE_BY_KIND, NPANEL_BY_SELECTION_KIND,
  DECLARED_PAINTERS, shapeForKind, npanelBodyFor,
} from './view/SelectionKinds.js'
import { DECLARED_NPANEL_KINDS } from './view/EntityScopeChecks.js'

/** 選択の唯一の入口 — painter の実装を持つ側。 */
const SELECTION_ENTRY = 'src/controller/SelectionManager.js'
/** N パネルの描き分け (種 → body の消費者)。 */
const NPANEL_VIEW = 'src/components/NPanel/NPanel.jsx'

/**
 * `empty` を 3D の姿の宣言から**対象外**にする理由。
 * 「何も選ばれていない」は種ではなく種の不在であり、姿を持たないことが正しい。
 * 理由なき除外は忘れられた除外と区別がつかないので、ここに書く (原則 #31)。
 */
const SHAPE_EXCLUDED = [
  { key: SELECTION_KIND.EMPTY,
    why: '種の無い状態。選ばれたものが無いので姿も無く、それは無言ではない '
       + '(無言とは「選んだのに何も起きない」であって「選んでいない」ではない)' },
]

test('選択可能な種のうち、3D の姿を宣言していないものは 0 個 (D4 / 原則 #11)', () => {
  assertCoversPopulation({
    what:       '選択の種 → 3D の姿',
    population: Object.values(SELECTION_KIND),
    declared:   Object.keys(SELECTION_SHAPE_BY_KIND),
    excluded:   SHAPE_EXCLUDED,
    howDerived: 'src/domain/selection.js の SELECTION_KIND の枝 (手書きの種リストではない)',
    onNew:      'SELECTION_SHAPE_BY_KIND に行を足すこと — 選べるのに 3D が無反応な種は '
              + '原則 #11 の「入力は消費されたのに何も起きない」そのもの',
  })
  // 宣言の中身が空でないこと (行だけ足して中身が無い = 宣言していないのと同じ)。
  for (const kind of SELECTABLE_KINDS) {
    const decl = shapeForKind(kind)
    assert.ok(decl.paint?.length > 0, `${kind} の paint が空`)
    assert.ok(decl.shape?.length > 0, `${kind} の shape 記述が空`)
    assert.ok(decl.why?.length   > 0, `${kind} の why が空`)
  }
})

test('未宣言の種で 3D の姿の表は throw する (fall-through が 0 個)', () => {
  assert.throws(() => shapeForKind('gestures'), /no declared 3-D shape/)
  // empty は「選択可能な種」ではないので、姿を訊くこと自体が誤り。
  assert.throws(() => shapeForKind(SELECTION_KIND.EMPTY), /no declared 3-D shape/)
})

test('宣言された painter は実在し、実在する painter は宣言されている (両向き)', () => {
  const src = stripComments(readFileSync(repoPath(SELECTION_ENTRY), 'utf8')).join('\n')
  // 実装側の母集団は `_painters` の初期化ブロックのキー — 構文から導出する。
  const block = src.slice(src.indexOf('this._painters = {'))
  const implemented = [...block.slice(0, block.indexOf('\n    }')).matchAll(/^\s{6}(\w+):/gm)]
    .map(m => m[1])

  assert.ok(implemented.length > 0, '_painters の実装を読み取れていない (形が変わった?)')
  assert.deepEqual(implemented.sort(), [...DECLARED_PAINTERS].sort(),
    '宣言 (SELECTION_SHAPE_BY_KIND の paint) と実装 (_painters) がずれている。\n' +
    '  誰も描かない宣言も、宣言の無い描き手も、どちらも緑を出す形である。')
})

test('選択の種すべてが N パネルの body を宣言している (D6 / 原則 #17)', () => {
  assertCoversPopulation({
    what:       '選択の種 → N パネルの body',
    population: Object.values(SELECTION_KIND),
    declared:   Object.keys(NPANEL_BY_SELECTION_KIND),
    howDerived: 'src/domain/selection.js の SELECTION_KIND の枝',
    onNew:      'NPANEL_BY_SELECTION_KIND に行を足すこと — 右パネルが「何も出さない」を '
              + '既定として選ぶのは、決定の不在を既定値で埋める形 (原則 #31)',
  })
  assert.throws(() => npanelBodyFor('gestures'), /no declared N-panel body/)
  // `empty` にも答えが要る: 選択 0 個でもパネルは直前の active を語り続ける
  // (ADR-099 clearSelection の契約) — 「消える」ではない (原則 #15)。
  assert.equal(npanelBodyFor(SELECTION_KIND.EMPTY).body, 'activeEntity')
})

test('宣言された body は NPanel が実際に描き分けている (宣言が空回りしていない)', () => {
  const view = stripComments(readFileSync(repoPath(NPANEL_VIEW), 'utf8')).join('\n')
  const bodies = new Set(Object.values(NPANEL_BY_SELECTION_KIND).map(d => d.body))
  // `variable` body は type='variable' の分岐として実在しなければならない。
  assert.ok(bodies.has('variable'))
  assert.match(view, /nPanelData\?\.type === 'variable'/,
    'NPanel が variable の body を描いていない — 宣言だけが在る状態は緑を出す')
})

test('N パネルに出る種はすべて entity-scope の可用性を宣言している (原則 #17)', () => {
  // ADR-105 の宣言表は「N パネルに出る種」を母集団に取る。種が 1 つ増えた以上、
  // その表にも行が要る — 多態的に呼ばれるメソッドは全実装型に在ること。
  assert.ok(DECLARED_NPANEL_KINDS.includes('variable'),
    'ENTITY_SCOPE_BY_KIND に variable の行が無い — graspEntryFor() が throw する')
})
