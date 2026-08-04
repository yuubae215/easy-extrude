/**
 * DocIntake — 文書の入口 (Wizard / Intake) の**暫定住所**の語彙 (ADR-106 D3)。
 *
 * ## 暫定であることを宣言する
 *
 * Wizard と Intake は「入力」であって「解消」ではないので、場のタブではない
 * (ADR-106 D3 の行き先表)。しかし**最終的な**住所は別の判断が決める。
 *
 * **満期の付け替え (2026-08-04):** ADR-106 は満期を Phase 5 = ADR-108 に置いたが、
 * ADR-108 は入口 (動詞 × 対象) を決めて**器の住所を決めなかった** — 器の住所はその
 * 直積に現れないからである。満期は 2026-08-03 に無言で過ぎ、この定数は人が読む文字列で
 * あって機械が読む期限ではないため、何も落ちなかった。満期は **ADR-112 (この問いを
 * 決着させる ADR)** へ張り替えた。教訓は ADR-109 §力学 2 が持つ —
 * **満期は他人の判断に相乗りせず、自分の問いが決着する事象に置く。**
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
 *
 * **満期は「この問いを決着させる ADR が Accepted になること」** であって、日付でも
 * 「次の段」でもない (ADR-109 D3 / 却下案 D)。ADR-112 が Accepted になった時点で
 * `scripts/check-deferrals.mjs` が落ち、そのとき本定数は**更新ではなく削除**される
 * (決着した暫定の宣言を残すと「まだ残っている」という嘘を出し続ける)。
 *
 * @see docs/adr/ADR-112-the-document-intake-address-becomes-permanent.md
 * @see docs/adr/ADR-109-a-deferral-is-a-declaration-not-a-memory.md
 */
export const PROVISIONAL_UNTIL = 'ADR-112 (文書の入口の恒久住所 — IA Phase 5.2)'

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
