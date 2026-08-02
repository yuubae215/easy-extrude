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

import { isRobotRole } from '../domain/robotFrames.js'

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
 * @param {{type?: string, robotRole?: string|null}|null} nPanelData
 * @returns {{available: boolean, reason: string|null}}
 */
export function graspEntryFor(nPanelData) {
  if (!nPanelData) return { available: false, reason: 'Nothing is selected.' }
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
