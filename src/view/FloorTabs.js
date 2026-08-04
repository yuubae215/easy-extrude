/**
 * FloorTabs — 下部の場 (解消の器) が持つタブの**有界な値域** (ADR-106 D3 / D5)。
 *
 * ## なぜ値域を宣言にしたか
 *
 * `context.inspectorTab` は文字列で、値域は JSDoc の union コメントにしか無かった。
 * 数えられない形は数える前に直す必要がある — ADR-106 の GSN が
 * `RetirementCensusIsPlanned` の反証形として先に書いていた通りで、実測するとその
 * 反証形のほうが正しかった (宣言そのものが存在しなかった)。
 *
 * 退役の腐敗は違反を**見逃す**のではなく**緑を出す** (ADR-103 — `DS_PENDING` は
 * 廃止後も 3 リリース enum に残り、その間ずっとテストは緑だった)。だから消したこと
 * 自体を数える: `RETIRED_FLOOR_TABS` が `src/**` に 0 個であることを
 * `FloorContainerCensus.test.js` が問う。
 *
 * ## 器に残る責務は 2 種だけ (ADR-106 D3)
 *
 * **解消** (所有者が複数 — 合意が要る) と、**その記録** (場の産物)。
 * それ以外の 4 種目 — 発見 (所有者は単数 = 戻り値) と入力 (そもそも検証ではない) —
 * は器の外へ出た。同居の理由は歴史であって設計ではなかった。
 */

/**
 * 場のタブ (= `context.inspectorTab` の値域)。
 *
 * `CONFLICTS` は author モードの読み出しで、タブ列としては描かれない (author は
 * タブを持たない) — 値域には居るが `FLOOR_TABS` には現れない。「タブ列に出る」と
 * 「値域に在る」は別の事実なので、同じ表で兼ねない (§1.1)。
 */
export const FLOOR_TAB = Object.freeze({
  MATRIX:    'matrix',
  CLUSTER:   'cluster',
  AGENDA:    'agenda',
  QUESTIONS: 'questions',
  WHY:       'why',
  TREE:      'tree',
  CONFLICTS: 'conflicts',
})

/**
 * negotiate モードで描かれるタブと、その責務。
 *
 * 責務は 2 値 (`resolve` / `record`) しか取らない。3 値目を足したくなったら、それは
 * 器に 4 種目が戻ってきたということなので、タブではなく**住所**を決め直すこと
 * (ADR-106 D3 の行き先表がその判断の正本)。
 */
export const FLOOR_TABS = Object.freeze([
  { id: FLOOR_TAB.MATRIX,    label: 'Matrix',    duty: 'resolve' },
  { id: FLOOR_TAB.CLUSTER,   label: 'Cluster',   duty: 'resolve' },
  // The floor proper (ADR-104): keys held, what is on the table, what the record
  // says. Always present — an empty floor is a result worth stating, not a reason
  // to remove the tab (PHILOSOPHY #15).
  { id: FLOOR_TAB.AGENDA,    label: 'Floor',     duty: 'resolve' },
  { id: FLOOR_TAB.QUESTIONS, label: 'Questions', duty: 'resolve', when: 'hasForm' },
  { id: FLOOR_TAB.WHY,       label: 'Why',       duty: 'record' },
  { id: FLOOR_TAB.TREE,      label: 'Overview',  duty: 'record' },
])

/**
 * **退役したタブと、その行き先** (ADR-106 D3)。
 *
 * 行き先を名指ししない退役は無言の削除であり、機能が到達不能になる
 * (原則 #11 / #16 — 発見可能性は成果物であって副作用ではない)。したがって
 * ここは「消した一覧」ではなく「**引っ越し先の台帳**」である。
 */
export const RETIRED_FLOOR_TABS = Object.freeze([
  { id: 'checks', movedTo: 'src/components/Chrome/SceneChecksHud.jsx',
    why: '発見 (シーンスコープの共有 KPI)。場に入らないと場に入る要否が分からない循環を断つ — ADR-105 D3' },
  { id: 'grasp',  movedTo: 'src/components/NPanel/NPanel.jsx',
    why: '発見 (エンティティスコープ)。「置く → 届くか見る → 置き直す」は選択の隣で閉じる — ADR-105 D5' },
  { id: 'assets', movedTo: 'src/components/AddMenu/AddMenu.jsx',
    why: '入力 = モデリング。架台・コンベア・セル床を作る行為は他のオブジェクト追加と同じ (ADR-103 が Lynch 5 種を AddMenu へ移した先例と同型)' },
  { id: 'wizard', movedTo: 'src/components/Doc/DocIntakeLayer.jsx',
    why: '入力 (誘導・順序あり = BPMN 側)。文書の入口であって場ではない。**暫定住所** — 最終的な住所は **ADR-112** が決める (満期は 2026-08-04 に ADR-108 から張り替え — ADR-109 §力学 2)' },
  { id: 'intake', movedTo: 'src/components/Doc/DocIntakeLayer.jsx',
    why: '入力 (熟練者のフォーム)。同上 — **暫定住所**' },
])

/**
 * **下端の器が開いているか** — 下端の占有量を尋ねる全員が読む唯一の述語。
 *
 * production の場 (`context.active`) とチュートリアルの Inspector
 * (`demo.inspectorTab`) は **同じ住所**を共有する (ADR-106 D2) ので、下端から見れば
 * 1 つの事実である。5 箇所に `s.context.active || !!s.demo.inspectorTab` と書くと、
 * その事実に 5 つの写しができる — 3 人目の器が生まれた日に 4 箇所しか直らない形
 * であり、それは本 ADR が右端で潰した病気そのもの (§1.1)。
 *
 * 占有量そのものは `EdgeOccupancy` が計算する。ここが答えるのは
 * 「占有しているか」だけで、`EdgeOccupancy` は uiStore の形を知らない。
 *
 * @param {{context: {active: boolean}, demo: {inspectorTab: string|null}}} state
 * @returns {boolean}
 */
export const floorIsOpen = state => state.context.active || !!state.demo.inspectorTab

/** 値域の集合 (検査と guard が同じ源を読む — §1.1)。 */
const FLOOR_TAB_IDS = new Set(Object.values(FLOOR_TAB))

/**
 * 値域の guard。未宣言のタブでは **throw する** — fall-through は「宣言された既定」
 * と「誰も考えなかったタブ」を区別不能にする (原則 #31)。
 *
 * これは器の外へ出た 5 タブを**書き戻せなくする**ためのものでもある: 退役した値で
 * `contextSetTab` を呼ぶコードは、実行した瞬間に名指しで落ちる。
 *
 * @param {string} id
 * @returns {string} 同じ id (呼び出し式にそのまま挟める)
 */
export function floorTabOrThrow(id) {
  if (!FLOOR_TAB_IDS.has(id)) {
    const retired = RETIRED_FLOOR_TABS.find(t => t.id === id)
    throw new Error(
      `FloorTabs: 未宣言の場のタブ "${id}"。` +
      (retired
        ? ` このタブは ADR-106 D3 で退役し、住所は ${retired.movedTo} になった (${retired.why})。`
        : ' 器に残るのは「解消」と「その記録」の 2 種だけ (ADR-106 D3) — ' +
          '4 種目を足す前に、その責務の住所を行き先表で決めること。'))
  }
  return id
}
