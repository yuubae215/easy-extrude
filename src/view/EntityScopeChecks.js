/**
 * EntityScopeChecks — 選択された実体に対して、どの entity-scope 検証が使えるかを
 * 決める**純粋**な判定 (ADR-105 D5 / 原則 #3)。
 *
 * `.jsx` から切り出してあるのは、これが検査対象だからである — 種の宣言表と
 * 「未宣言の種で throw する」規律は node の test runner から直接呼べる必要がある
 * (`.jsx` は runner が読めない)。描画は `components/NPanel/EntityChecks.jsx`。
 *
 * ## 軸は選択であって文書ではない
 *
 * 「届くか / ぶつかるか / 掴めるか」は、いま置いた物についての問いであり、属する
 * ループは `置く → 届くか見る → 置き直す` である。可用性が「まず文書を採れ」の
 * 後ろに在ると、このループは閉じない。したがってここは `ctx.active` も文書の有無も
 * 読まない (`DiscoveryOutsideTheFloor.test.js` が個数で問う)。
 */

import { isRobotRole, ROBOT_CARDINALITY } from '../domain/robotFrames.js'

/**
 * **選択が無いときの 0 の種** (ADR-110 D2 / D4 の「正直な限界」)。
 *
 * ADR-110 が把持探索をヘッダの `場を開く` から外し、選択の無い状態からの経路を
 * この入口 1 つに畳んだ。そのとき残る不可用の理由は **1 種ではない**:
 *
 *   - ロボットは在るが誰も選んでいない → 選べば開く (可逆な一手)
 *   - シーンにロボットが 0 台 → 選ぶ対象そのものが無い (ADR-090 の 0 台問題)
 *
 * 1 つの理由文で両方を賄うと、0 台の人には**嘘**になる (「ロボットを選べ」と
 * 言われても選ぶものが無い)。原則 #31 が名指しするとおり、0 は 1 種類ではない。
 */
export const GRASP_BLOCKED_KIND = Object.freeze({
  /** ロボットは在る (1 台以上) が、選択が無い / 別のものを選んでいる。 */
  NO_SELECTION: 'no-selection',
  /** シーンにロボットが 1 台も無い (`ROBOT_CARDINALITY.NONE`)。 */
  NO_ROBOT:     'no-robot',
})

/**
 * 0 の種ごとの理由文。**未宣言の種で throw する** — 理由を持たない不可用は
 * 「無言で押せないボタン」であり、原則 #11 が名指しする最悪の形になる。
 */
const GRASP_BLOCKED_REASON = Object.freeze({
  [GRASP_BLOCKED_KIND.NO_SELECTION]:
    'Select a robot (its base or TCP frame) to search grasps for it.',
  [GRASP_BLOCKED_KIND.NO_ROBOT]:
    'No robot in the scene — add one (Shift+A → Robot) before searching for a grasp.',
})

/** 宣言された 0 の種 (検査が母集団として引く)。 */
export const DECLARED_GRASP_BLOCKED_KINDS = Object.freeze(Object.keys(GRASP_BLOCKED_REASON))

/**
 * 0 の種 → 人が読む理由。
 *
 * @param {string} kind `GRASP_BLOCKED_KIND` の値
 * @returns {string}
 * @throws {Error} 未宣言の種
 */
export function graspBlockedReason(kind) {
  const reason = GRASP_BLOCKED_REASON[kind]
  if (!reason) {
    throw new Error(
      `EntityChecks: 未宣言の不可用の種 "${kind}"。GRASP_BLOCKED_REASON に行を足すこと ` +
      '— 理由を持たない gate は無言の no-op になる (原則 #11 / ADR-110 D4)。',
    )
  }
  return reason
}

/**
 * **宣言表** — N パネルに出る実体種ごとの entity-scope 検証 (原則 #31 / ADR-096 の既定表規律)。
 *
 * 未宣言の種で **throw** する。「今の 3 種は宣言を持つ」は事実であって規則ではない —
 * fall-through は「宣言された既定」と「誰も考えなかった種」を区別不能にする。
 *
 * 母集団は `setNPanelData` が書く `type` の集合で、`NPanel.jsx` の分岐から導出できる。
 */
const ENTITY_SCOPE_BY_KIND = Object.freeze({
  generic: Object.freeze({
    // A solid / profile / measure — it can be reached at and collided with, but it
    // is not the thing that does the grasping.
    grasp: false,
    why:   'Grasp candidates are solved for a robot; select a robot frame to run one.',
  }),
  frame: Object.freeze({
    // Decided per-selection below: a robot base / tcp frame IS the robot.
    grasp: 'robot-role',
    why:   'Only a robot frame (base / tcp) identifies which robot to solve for.',
  }),
  link: Object.freeze({
    grasp: false,
    why:   'A spatial link is a relation, not a body — nothing to reach for.',
  }),
  variable: Object.freeze({
    // The second selectable kind (ADR-107). A shared design variable is a number
    // under negotiation, not a body — but the entry does NOT disappear: a slot
    // that vanishes teaches nothing, while a disabled one carrying its reason
    // says what to select instead (原則 #15 / #11, and 原則 #17 — the member
    // exists on every kind, `false` included).
    grasp: false,
    why:   'A shared design variable is a number under negotiation, not a body. ' +
           'Select one of the entities it constrains to run a grasp search.',
  }),
})

/** 宣言表が覆っている実体種 (検査が母集団として引く)。 */
export const DECLARED_NPANEL_KINDS = Object.freeze(Object.keys(ENTITY_SCOPE_BY_KIND))

/**
 * この選択で grasp の入口が使えるか、および使えない場合の理由。
 * 判定と**理由**が同じ述語の返り値から出る (原則 #11 / ADR-104 `editPermission` と同じ形)。
 *
 * ## 選択が無いときは、ロボットの基数を**宣言させる** (ADR-110 D4 / ADR-090)
 *
 * `nPanelData` が null のとき、理由は 2 種に割れる (`GRASP_BLOCKED_KIND`)。どちらか
 * を決めるのはシーンのロボットの基数なので、呼び手はそれを渡さねばならない。
 * 渡されなければ **throw する** — 既定を「ロボットは在る」に倒すと、0 台のシーンで
 * 「ロボットを選べ」という嘘を出す。それは ADR-090 が潰した「原点に立つ無限リーチの
 * 幽霊ロボット」と同じ、*欠けた入力を既定値で埋める*欠陥である。
 *
 * @param {{type?: string, robotRole?: string|null}|null} nPanelData
 * @param {{robotCardinality?: string}} [facts] 選択が無いときに**必須** —
 *   `ROBOT_CARDINALITY` の値 (`context.robots.cardinality`)
 * @returns {{available: boolean, reason: string|null}}
 */
export function graspEntryFor(nPanelData, facts) {
  if (!nPanelData) {
    const cardinality = facts?.robotCardinality
    if (!cardinality) {
      throw new Error(
        'graspEntryFor: 選択が無いときは robotCardinality が要る (ADR-110 D4)。' +
        '既定値で埋めない — 0 台のシーンに「ロボットを選べ」と出すのは嘘であり、' +
        '欠けた入力に既定を与える形は ADR-090 の幽霊ロボットと同じ欠陥 (原則 #31)。',
      )
    }
    return {
      available: false,
      reason: graspBlockedReason(cardinality === ROBOT_CARDINALITY.NONE
        ? GRASP_BLOCKED_KIND.NO_ROBOT
        : GRASP_BLOCKED_KIND.NO_SELECTION),
    }
  }
  const decl = ENTITY_SCOPE_BY_KIND[nPanelData.type]
  if (!decl) {
    throw new Error(
      `EntityChecks: 未宣言の実体種 "${nPanelData.type}"。ENTITY_SCOPE_BY_KIND に行を足すこと ` +
      '— fall-through は「宣言された既定」と「誰も考えなかった種」を区別不能にする (原則 #31)。',
    )
  }
  if (decl.grasp === true)  return { available: true,  reason: null }
  if (decl.grasp === false) return { available: false, reason: decl.why }
  // 'robot-role' — the declared role decides (never the name: it is not unique).
  return isRobotRole(nPanelData.robotRole)
    ? { available: true, reason: null }
    : { available: false, reason: decl.why }
}
