/**
 * DocIntake — 文書の入口 (Wizard / Intake) の**恒久住所**の語彙 (ADR-112)。
 *
 * ## 留保は延長ではなく決着で畳んだ
 *
 * Wizard と Intake は「入力」であって「解消」ではないので、場のタブではない
 * (ADR-106 D3 の行き先表)。ADR-106 はそこまでを決め、**最終的な住所は別の判断が
 * 決める**として期限つきの宣言を 1 つ置いた。その満期は空振りした — ADR-108
 * (Phase 5) は入口 (動詞 × 対象) を決めたが、**器の住所はその直積に現れない**ので
 * 決めなかった。満期は 2026-08-03 に無言で過ぎた。
 *
 * ADR-112 がその決着である。見直す理由を探して**出てこなかった**ので、今日の住所を
 * 恒久とした — 決めきらずにいたのは住所が疑わしかったからではなく「Phase 5 が入口を
 * 決めるとき一緒に見直すべきかもしれない」という手続き上の留保だったからで、
 * 留保は果たされた。したがって期限の宣言は**更新ではなく削除**された
 * (決着した留保の宣言を残すと「まだ残っている」という嘘を出し続ける — ADR-109 §力学 2)。
 *
 * 教訓は一般形で残る: **満期は他人の判断に相乗りせず、自分の問いが決着する事象に置く。**
 *
 * ## なぜモーダルではないのか (根拠は今日も有効)
 *
 * IntakePanel は `onIntakePreview` で 3D に不確かさバンドのゴーストを出す
 * (ADR-051 Entry D)。全面モーダルはそのゴーストを覆うので、「入力の検算 =
 * エコーバック」という 3D の責務 (ADR-106 D3 のゾーン表) が消える。したがって
 * 左側にドックする一時オーバーレイ — 3D と N パネルは見えたまま。
 * **常設ではない**ので画面端の予算 (原則 #26) には入らない — TemplateGallery と
 * 同じ扱いで、これは ADR-050 が既に採っている区別である。
 *
 * ## 覆ってよい面は、面の名前ではなく**役割**で決まる (ADR-112 D2)
 *
 * 初版は「Outliner を覆う」と*面の名前*で書かれていた。それが安全だったのは
 * Outliner が幾何の木で、文書と関係が無かったからである。ADR-111 が意味側を
 * 置いた瞬間にその前提は崩れる — 同じ Outliner の中で、幾何側は覆ってよく
 * 意味側は覆えない。**面の名前では規則を表せない。**
 *
 * したがって規則は役割 (`SURFACE_ROLE`) で書く。「いま入力しているものを映して
 * いない面」だけを覆ってよい — 3D のゴーストを覆えないのと**同じ 1 つの理由**で
 * あり、それが規則を 2 つに増やさずに済む理由でもある。
 */

import { SURFACE_ROLE } from './NavigatorSides.js'

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
 * **覆う範囲の規則** (ADR-112 D2) — 一時オーバーレイが役割ごとに覆ってよいか。
 *
 * 所有者は 1 つ。呼び出し箇所ごとにパッチを当てない (原則 #26 と同じ規律で、
 * こちらは端ではなく*重なり*の側)。**未宣言の役割では throw する** — 3 つ目の
 * 役割が生まれた日に既定へ落ちると、「宣言された既定」と「誰も考えなかった役割」が
 * 区別不能になる (原則 #31 / ADR-096 の既定表の規律)。
 */
const OVERLAY_COVERAGE_BY_ROLE = Object.freeze({
  [SURFACE_ROLE.STRUCTURE]: Object.freeze({
    mayCover: true,
    why: 'フォームを埋めているあいだ「在るものの構造」は要らない。覆っても検算は消えない。',
  }),
  [SURFACE_ROLE.INPUT_MIRROR]: Object.freeze({
    mayCover: false,
    why: 'いま入力している当のものを映す面。覆うとエコーバックが 1 つ消える — '
       + '全面モーダルが 3D のゴーストを覆うのを断ったのと**同じ 1 つの理由**であり、'
       + '規則を 2 つに増やさずに済むのはそのためである (ADR-051 Entry D / ADR-112 D2)。',
  }),
})

/**
 * その役割の面を一時オーバーレイが覆ってよいか。
 *
 * @param {string} role `SURFACE_ROLE` の値
 * @returns {boolean}
 * @throws {Error} 未宣言の役割
 */
export function mayCoverRole(role) {
  const rule = OVERLAY_COVERAGE_BY_ROLE[role]
  if (!rule) {
    throw new Error(
      `DocIntake: 未宣言の面の役割 "${role}" — OVERLAY_COVERAGE_BY_ROLE に行を足すこと。` +
      'fall-through は「覆ってよいと決めた面」と「誰も考えなかった面」を区別不能にする ' +
      '(原則 #31 / ADR-112 D2)。',
    )
  }
  return rule.mayCover
}

/** 覆う規則が宣言している役割 (検査が母集団と突き合わせる)。 */
export const DECLARED_COVERAGE_ROLES = Object.freeze(Object.keys(OVERLAY_COVERAGE_BY_ROLE))

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
      'progressive disclosure の関係 (wizard ⊃ assisted ⊃ expert) に位置づけられない面は、' +
      'この器の住人ではない — 住所を決め直すこと (ADR-106 D3 の行き先表が正本)')
  }
  return id
}
