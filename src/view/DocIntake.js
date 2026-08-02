/**
 * DocIntake — 文書の入口 (Wizard / Intake) の**暫定住所**の語彙 (ADR-106 D3)。
 *
 * ## 暫定であることを宣言する
 *
 * Wizard と Intake は「入力」であって「解消」ではないので、場のタブではない
 * (ADR-106 D3 の行き先表)。しかし**最終的な**住所は Phase 5 = ADR-108
 * (入口は動詞であって対象ではない) が決める — 入口の統合と同じ判断だからである。
 *
 * ADR-106 が決めるのは 2 点だけ:
 *   1. 場のタブではない
 *   2. Phase 5 まで **到達可能な暫定の住所を持つ** (原則 #16 — 発見可能性は
 *      成果物であって副作用ではない。行き先を名指ししない移設は無言の削除)
 *
 * `PROVISIONAL_UNTIL` はその宣言そのものである。**宣言しない暫定は恒久になる** ので、
 * 暫定であることをコードの中に置く。ADR-106 の GSN は
 * `ProvisionalAddressesStayProvisional` を反証されうる仮説として持っており、
 * 反証される形 (Phase 5 が着手されないまま暫定が既定の導線として定着する) も
 * そこに書いてある。
 *
 * ## なぜモーダルではないのか
 *
 * IntakePanel は `onIntakePreview` で 3D に不確かさバンドのゴーストを出す
 * (ADR-051 Entry D)。全面モーダルはそのゴーストを覆うので、「入力の検算 =
 * エコーバック」という 3D の責務 (ADR-106 D3 のゾーン表) が消える。したがって
 * 左側にドックする一時オーバーレイ — 3D と N パネルは見えたまま、Outliner だけを
 * 一時的に覆う (フォームを埋めているあいだ在るものの構造は要らない)。
 * **常設ではない**ので画面端の予算 (原則 #26) には入らない — TemplateGallery と
 * 同じ扱いで、これは ADR-050 が既に採っている区別である。
 */

/** 文書の入口が持つ 2 つの面 (誘導 ⊃ 熟練者)。 */
export const DOC_INTAKE_TAB = Object.freeze({
  WIZARD: 'wizard',
  INTAKE: 'intake',
})

/**
 * 面の宣言表。progressive disclosure: wizard ⊃ assisted forms ⊃ expert forms
 * (ADR-063 Phase 3 が「Wizard の隣が Intake」と設計した関係は不変 — 変わったのは
 * 器だけである)。
 */
export const DOC_INTAKE_TABS = Object.freeze([
  { id: DOC_INTAKE_TAB.WIZARD, label: 'Guided',
    blurb: 'Answer a few questions in order; each step commits what it collected.' },
  { id: DOC_INTAKE_TAB.INTAKE, label: 'Expert form',
    blurb: 'Type entries straight into the document — actors, facts, variables, requirements.' },
])

/**
 * この住所が暫定である期限。恒久化したかどうかを人の記憶に置かない。
 * @see docs/adr/ADR-108-entrances-are-verbs-not-objects.md
 */
export const PROVISIONAL_UNTIL = 'ADR-108 (IA Phase 5 — 入口の統合)'

const DOC_INTAKE_TAB_IDS = new Set(Object.values(DOC_INTAKE_TAB))

/**
 * 値域の guard。未宣言の面では throw する (原則 #31 — 既定へ落とさない)。
 * @param {string} id
 * @returns {string}
 */
export function docIntakeTabOrThrow(id) {
  if (!DOC_INTAKE_TAB_IDS.has(id)) {
    throw new Error(
      `DocIntake: 未宣言の文書入口の面 "${id}" — DOC_INTAKE_TAB に足すこと。` +
      `この住所は暫定 (${PROVISIONAL_UNTIL}) なので、面を増やす前に Phase 5 の入口統合と` +
      '衝突しないかを確認すること')
  }
  return id
}
