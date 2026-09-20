/**
 * VisibilityAxes.test.js — the machine-side asking point for ADR-096 / ADR-142.
 *
 * Three things are asked here, and each maps to one of the four symptoms the
 * ADR opens with:
 *
 *  1. The truth table (2 × 3 = 6, ALL of them). The composition being a pure
 *     function is what makes "the composition lives in one place" checkable at
 *     all — leave it inside a DOM-holding view and no test can reach it
 *     (the same reason ADR-094 extracted computeLayout).
 *  2. Every kind has a DECLARED default, asserted by enumerating the kinds and
 *     counting rows — not by walking the rows that happen to exist (原則 #31:
 *     a missing row has no node to visit, so walking *what is there* always
 *     passes). An undeclared kind must throw, never read as `false`.
 *  3. `robot_base`'s default is keyed by the ENTRY POINT, not by the kind —
 *     `visibilityKindOf` still splits `SEED` from `USER_ADDED` into two kinds
 *     (ADR-090), but as of ADR-142 both kinds declare the SAME default
 *     (`true`): the boot-seed path that used to justify a lower default for
 *     `SEED` was removed in ADR-132 D5, so `SEED` today only means "arrived
 *     inside a loaded scene (Home template / .ctx.json import)", and hiding
 *     that reproduces the silent no-op ADR-096 removes (原則 #11).
 *
 * Run with:  node --test src/view/VisibilityAxes.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTEXTUAL,
  VISIBILITY_ENTRY,
  VISIBILITY_KIND,
  EXPLICIT_DEFAULTS,
  visibilityKindOf,
  defaultExplicit,
  composeVisibility,
} from './VisibilityAxes.js'

// ── 1. The truth table ───────────────────────────────────────────────────────

test('composeVisibility covers all 6 axis combinations', () => {
  /** @type {[boolean, string|null, boolean, boolean, string][]} */
  const table = [
    // explicit, contextual,           visible, dimmed, why
    [false, null,               false, false, '誰も何も言っていない → 描かない (これが起動直後の CF)'],
    [false, CONTEXTUAL.FULL,    true,  false, '選択された当人 → 文脈表示のフル'],
    [false, CONTEXTUAL.DIMMED,  true,  true,  '同じ木の他フレーム → 文脈表示の薄字'],
    [true,  null,               true,  false, 'eye だけ開いている → 選択と無関係に描く (症状 4 の回帰)'],
    [true,  CONTEXTUAL.FULL,    true,  false, '両方 → フル'],
    [true,  CONTEXTUAL.DIMMED,  true,  false, 'eye が開いていれば他人の選択で薄くされない'],
  ]

  assert.equal(table.length, 6, '2 軸 (boolean × 3 値) を全部書く — 抜けた行が症状になる')

  for (const [explicit, contextual, visible, dimmed, why] of table) {
    assert.deepEqual(
      composeVisibility({ explicit, contextual }),
      { visible, dimmed },
      `explicit=${explicit} contextual=${contextual}: ${why}`,
    )
  }
})

test('composeVisibility treats a missing contextual axis as "no request"', () => {
  assert.deepEqual(composeVisibility({ explicit: false }), { visible: false, dimmed: false })
  assert.deepEqual(composeVisibility({ explicit: true  }), { visible: true,  dimmed: false })
})

// ── 2. Every kind DECLARES its default (原則 #31) ────────────────────────────

test('every declared kind has exactly one row in the default table (個数検査)', () => {
  const kinds = Object.values(VISIBILITY_KIND)
  const rows  = Object.keys(EXPLICIT_DEFAULTS)

  // Enumerate the kinds and count — walking the rows that exist would pass with
  // a kind whose row was never written (the absence has no node to visit).
  assert.equal(
    rows.length, kinds.length,
    `既定表の行数 (${rows.length}) と種の数 (${kinds.length}) が一致しない — ` +
    '種を足したら既定を宣言すること (未宣言の種は 0 個でなければならない)',
  )
  const undeclared = kinds.filter(k => !Object.hasOwn(EXPLICIT_DEFAULTS, k))
  assert.deepEqual(undeclared, [], '既定が未宣言の種')

  for (const kind of kinds) {
    assert.equal(typeof defaultExplicit(kind), 'boolean', `${kind} の既定が boolean でない`)
  }
})

test('an undeclared kind throws instead of reading as hidden', () => {
  assert.throws(
    () => defaultExplicit('somethingNobodyDeclared'),
    /no declared explicit-visibility default/,
    '未宣言の種を黙って false に落とすと、ADR-096 が消した「誰も決めていない既定」が戻る',
  )
})

test('the declared defaults are the ones ADR-096 §Decision 3 / ADR-142 state', () => {
  assert.equal(defaultExplicit(VISIBILITY_KIND.GEOMETRY),          true)
  assert.equal(defaultExplicit(VISIBILITY_KIND.COORDINATE_FRAME),  false)
  assert.equal(defaultExplicit(VISIBILITY_KIND.ROBOT_BASE_SEEDED), true)
  assert.equal(defaultExplicit(VISIBILITY_KIND.ROBOT_BASE_ADDED),  true)
})

// ── 3. The entry point still decides the KIND, even where the default agrees ─

test('visibilityKindOf splits robot_base by the entry point it was born through', () => {
  const seeded = visibilityKindOf({ isFrame: true, isRobotBase: true, entry: VISIBILITY_ENTRY.SEED })
  const added  = visibilityKindOf({ isFrame: true, isRobotBase: true, entry: VISIBILITY_ENTRY.USER_ADDED })

  assert.equal(seeded, VISIBILITY_KIND.ROBOT_BASE_SEEDED)
  assert.equal(added,  VISIBILITY_KIND.ROBOT_BASE_ADDED)
  assert.notEqual(
    seeded, added,
    '入口は今も別の kind へ分岐する (ADR-090) — ADR-142 で既定の値が揃っただけで、区別できる経路そのものは残る',
  )
  assert.equal(
    defaultExplicit(seeded), defaultExplicit(added),
    'テンプレート/import 由来のロボットと、ユーザーが今足したロボットは既定が揃っている (ADR-142)',
  )
})

test('visibilityKindOf: non-frames are geometry, frames default to the CF kind', () => {
  assert.equal(visibilityKindOf({ isFrame: false }), VISIBILITY_KIND.GEOMETRY)
  assert.equal(visibilityKindOf({ isFrame: false, isRobotBase: false, entry: VISIBILITY_ENTRY.USER_ADDED }),
    VISIBILITY_KIND.GEOMETRY, '入口はロボット base の既定にしか効かない')
  assert.equal(visibilityKindOf({ isFrame: true }), VISIBILITY_KIND.COORDINATE_FRAME)
  assert.equal(visibilityKindOf({ isFrame: true, entry: VISIBILITY_ENTRY.USER_ADDED }),
    VISIBILITY_KIND.COORDINATE_FRAME,
    'ユーザーが足した普通の CF も軸は既定で伏せる — 出るのは選択の文脈軸のほう')
})

test('テンプレート/import 由来のロボット 1 台は base だけ見える — tcp は CF の既定に従う (ADR-142)', () => {
  // 「ロボット 1 台」を構成する CF の種を**列挙**して、explicit が真のものを数える。
  // base (ROBOT_BASE_SEEDED) は ADR-142 で既定 true。tcp は robot_base とは別の
  // COORDINATE_FRAME kind (既定 false — 選択で開く文脈表示が既定の担当) のままで、
  // 本 ADR は robot_base の既定だけを動かす。種を列挙して個数を検査する形なら、
  // どちらの既定が動いてどちらが動いていないかを取りこぼさない (原則 #31)。
  const base = visibilityKindOf({ isFrame: true, isRobotBase: true, entry: VISIBILITY_ENTRY.SEED })
  const tcp  = visibilityKindOf({ isFrame: true, isRobotBase: false })

  assert.equal(defaultExplicit(base), true,  'テンプレート/import 由来の base は既定で見える')
  assert.equal(defaultExplicit(tcp),  false, 'tcp は CF の既定 (選択の文脈表示が既定) のまま')
})

test('ユーザーが足したロボットは base が現れる — 何も起きない Add は最悪の失敗 (原則 #11)', () => {
  assert.equal(
    defaultExplicit(visibilityKindOf({ isFrame: true, isRobotBase: true, entry: VISIBILITY_ENTRY.USER_ADDED })),
    true)
})

// ── The symptoms, stated as the composition sees them ────────────────────────

test('起動直後の CF は「eye 閉・文脈なし」= 描かれない、で行と一致する (症状 1/2)', () => {
  const explicit = defaultExplicit(VISIBILITY_KIND.COORDINATE_FRAME)
  assert.equal(explicit, false, '行の初期値は種の宣言そのもの — ハードコードした true ではない')
  assert.equal(composeVisibility({ explicit, contextual: null }).visible, false)

  // トグルは軸を反転する = 必ず何かが動く (G2)。「非表示のものを非表示にする」経路が無い。
  assert.equal(composeVisibility({ explicit: !explicit, contextual: null }).visible, true)
})

test('明示表示した CF は、他の実体を選んで文脈が消えても描かれ続ける (症状 4)', () => {
  const shown = composeVisibility({ explicit: true, contextual: CONTEXTUAL.FULL })
  assert.equal(shown.visible, true)
  // 別の実体を選択 → contextual が null に戻る。explicit は他人の選択では動かない。
  const afterDeselect = composeVisibility({ explicit: true, contextual: null })
  assert.equal(afterDeselect.visible, true, 'eye で開けた軸が選択変更で消えてはならない')
})
