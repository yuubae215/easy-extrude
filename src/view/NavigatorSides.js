/**
 * NavigatorSides — 左のナビゲータの**側**と、選択可能種の住所 (ADR-111)。
 *
 * ## なぜ側が要るのか
 *
 * ADR-107 が選択集合の要素を 2 種に広げた (`entities` / `variables`)。その日から
 * `d_ref` は **選べるのに、どのナビゲータにも載っていない実体**になった —
 * 選ぶ窓は場の行列の変数見出しだけなので、場を閉じると変数を選ぶ手段が画面から
 * 消える。「場に入らないと場の中のものが触れない」という循環が、ADR-105 が器の
 * 側で断ったのと同じ形で選択の側に生き残っていた。
 *
 * 幾何の木に混ぜないのは、**体を持たないから**である (ADR-111 §力学 3)。ADR-103 が
 * Lynch 5 種を Map から `+ 追加` へ移せたのは、それらが体を持つからであって
 * 「文書由来だから意味側」ではない — 基準は住所の層である。体を持たない住人を
 * 幾何の木に混ぜると、木の意味が「在るものの構造」から「選べるものの一覧」へ
 * 静かに変わる = 同じ 1 つの木が 2 つの意味を持つ (§1.1)。
 *
 * ## 数えるのは行ではない (原則 #31)
 *
 * 「意味側に何行あるか」は在るものを辿る数え方で、今日の欠陥を素通りする。
 * 数えるのは **選択可能な種のうち、ナビゲータに住所を持たない種の個数**であり、
 * 母集団は `SELECTABLE_KINDS` の枝から導出する (`src/NavigatorAddressCensus.test.js`)。
 * 3 種目の選択可能種が来た日に、住所を決めるまで落ちる。
 *
 * 純粋: THREE も DOM も React も読まない — node の test runner が直接読める。
 *
 * @see docs/adr/ADR-111-the-outliner-has-a-semantic-side.md
 * @see docs/gsn/adr-111-the-outliner-has-a-semantic-side.gsn
 * @module view/NavigatorSides
 */

import { SELECTION_KIND, SELECTABLE_KINDS } from '../domain/selection.js'

// ── 側 (基数は常に 1 — 側を持たないナビゲータは無い) ───────────────────────

/** 左のナビゲータの 2 つの側。 */
export const NAVIGATOR_SIDE = Object.freeze({
  /** 体を持つ実体の階層 (既定 — 初期頻度)。 */
  GEOMETRY: 'geometry',
  /** 文書の住人 (共有変数)。 */
  SEMANTIC: 'semantic',
})

/**
 * 一時オーバーレイから見た**面の役割** (ADR-112 D2 が引く)。
 *
 * 覆ってよいかを面の *名前* で書くと、同じ Outliner の中で幾何側は覆えて意味側は
 * 覆えない、という規則が表せない。役割で書けば表せる — ここは役割の語彙だけを
 * 持ち、「その役割を覆ってよいか」は `view/DocIntake.js` が宣言する (§1.1)。
 */
export const SURFACE_ROLE = Object.freeze({
  /** 在るものの構造。入力中に見えている必要はない。 */
  STRUCTURE: 'structure-of-what-exists',
  /** いま入力しているものを映す面 (エコーバック)。覆うと検算が消える。 */
  INPUT_MIRROR: 'mirrors-the-current-input',
})

/**
 * **宣言表** — 側ごとの見た目と役割。未宣言の側で throw する
 * (`EXPLICIT_DEFAULTS` / `SELECTION_SHAPE_BY_KIND` と同じ既定表の規律)。
 */
export const NAVIGATOR_SIDES = Object.freeze({
  [NAVIGATOR_SIDE.GEOMETRY]: Object.freeze({
    // 幾何側の名前は変えない。`Scene Collection` は既に ubiquitous language で、
    // ツアーの文面 (`TourMath`) と CODE_CONTRACTS の e2e 節がこの名前を指している。
    // 側を足したことを理由に既存の概念を改名すると、同じものに 2 つ目の名前が
    // 生まれる (§1.1 — 一概念一名)。
    label: 'Scene Collection',
    title: 'What exists in the scene — entities with a body',
    role:  SURFACE_ROLE.STRUCTURE,
    why:   '体を持つ実体の階層。文書を採らない使い方でも常に住人が居るので既定 (初期頻度)。',
  }),
  [NAVIGATOR_SIDE.SEMANTIC]: Object.freeze({
    label: 'Document',
    title: 'What the context document declares — shared design variables',
    role:  SURFACE_ROLE.INPUT_MIRROR,
    why:   '文書の住人。**いま入力している文書を映す面**なので、文書の入力オーバーレイは '
         + 'これを覆えない (ADR-112 D2 — 3D のゴーストを覆えないのと同じ理屈)。',
  }),
})

/** 宣言された側 (検査と UI がここから並びを導出する — 手書きの並びを持たない)。 */
export const DECLARED_NAVIGATOR_SIDES = Object.freeze(Object.keys(NAVIGATOR_SIDES))

/**
 * ナビゲータが**見せうる**面の役割の集合 (いま見せている面の役割ではない)。
 *
 * ADR-112 D2 は覆う可否を「いま入力しているものを映しているか」で決めたが、
 * 実装して初めて分かったことがある: **側を切り替える操作そのものが、覆われる側に
 * 住んでいる。** いま幾何側だからと覆うと、切替そのものが押せなくなり、意味側へは
 * 二度と行けない — 規則が「覆ってよい」と言った瞬間に、規則を発動させる手段が
 * 消える (原則 #16 — 到達できない機能は消えたのと同じ)。
 *
 * したがって覆う可否は**器の性質**であって、器が今どちらを向いているかではない。
 * 「この器は覆えない面を見せうるか」を問い、見せうるなら覆わない。器が構造しか
 * 見せない (= 全部の役割が覆ってよい) なら、従来どおり覆える。
 *
 * 副作用として、描き手は `outlinerSide` を読まなくなる — 現在の側で分岐しない
 * ことが、規則が描き手へ写っていないことの証拠にもなる。
 */
export const NAVIGATOR_ROLES = Object.freeze(
  [...new Set(Object.values(NAVIGATOR_SIDES).map(s => s.role))],
)

/**
 * 側の値域 guard。未宣言の側では throw する (原則 #31 — 既定へ落とさない)。
 *
 * @param {string} side
 * @returns {string} 同じ side
 * @throws {Error} 未宣言の側
 */
export function navigatorSideOrThrow(side) {
  if (!Object.hasOwn(NAVIGATOR_SIDES, side)) {
    throw new Error(
      `[NavigatorSides] 未宣言のナビゲータの側 "${side}"。NAVIGATOR_SIDES に行を足すこと — ` +
      'fall-through は「宣言された既定」と「誰も考えなかった側」を区別不能にする (原則 #31)。',
    )
  }
  return side
}

/**
 * 側の宣言 (ラベル・役割)。
 * @param {string} side
 * @returns {{label: string, title: string, role: string, why: string}}
 * @throws {Error} 未宣言の側
 */
export function navigatorSideDeclaration(side) {
  return NAVIGATOR_SIDES[navigatorSideOrThrow(side)]
}

// ── 住所表 (原則 #31 の本体 — 住所を持たない選択可能種を 0 個に保つ) ────────

/**
 * **住所表** — 選択できる種は、どちらの側に載るか。
 *
 * ADR-111 の Goal (*選べるものは、どれかのナビゲータに載っている*) を機械が
 * 問える形にしたもの。母集団は `SELECTABLE_KINDS` なので、3 種目を足して行を
 * 足さなければ検査が落ちる — 「どのナビゲータに載るか」を決めずに種を広げられない。
 *
 * `empty` は居ない: 選択が無いことは「選べる物の種」ではない (`SELECTABLE_KINDS`
 * が既に `empty` を外している理由と同じ)。
 */
export const NAVIGATOR_SIDE_BY_SELECTION_KIND = Object.freeze({
  [SELECTION_KIND.ENTITIES]: Object.freeze({
    side: NAVIGATOR_SIDE.GEOMETRY,
    why:  '体を持つので幾何側。ADR-103 が Lynch 5 種を幾何側に置けたのと同じ基準。',
  }),
  [SELECTION_KIND.VARIABLES]: Object.freeze({
    side: NAVIGATOR_SIDE.SEMANTIC,
    why:  '文書の宣言であって体ではない。3D の姿 (未確定帯) は**投影**であって体では '
        + 'ないので、幾何の木に混ぜると木の意味が 2 つになる (ADR-111 §力学 3)。',
  }),
})

/**
 * その選択可能種が住むナビゲータの側。**未宣言の種で throw する** — 住所を
 * 持たない選択可能種は「選べるのにどこにも載っていない」であり、それが
 * ADR-111 の起票理由そのものである。
 *
 * @param {string} kind `SELECTABLE_KINDS` の値
 * @returns {string} `NAVIGATOR_SIDE` の値
 * @throws {Error} 住所を宣言していない種
 */
export function navigatorSideForKind(kind) {
  const decl = NAVIGATOR_SIDE_BY_SELECTION_KIND[kind]
  if (!decl) {
    throw new Error(
      `[NavigatorSides] 選択可能種 "${kind}" にナビゲータの住所が無い。` +
      'NAVIGATOR_SIDE_BY_SELECTION_KIND に行を足すこと — 住所を持たない選択可能種は ' +
      '「選べるのにどこにも載っていない」であり、それが ADR-111 の起票理由である。',
    )
  }
  return decl.side
}

/** 住所を宣言された選択可能種 (検査が母集団と突き合わせる)。 */
export const KINDS_WITH_AN_ADDRESS = Object.freeze(
  SELECTABLE_KINDS.filter(k => Object.hasOwn(NAVIGATOR_SIDE_BY_SELECTION_KIND, k)),
)

// ── 意味側の中身 (0 は 1 種類ではない) ─────────────────────────────────────

/**
 * 意味側が取りうる状態の種。**0 が 2 種ある** (ADR-111 D4)。
 *
 * 「文書がまだ無い」と「文書は在るが共有変数を宣言していない」は違う事実であり、
 * 次の一手も違う (前者は文書を採る / 後者は変数を宣言する)。1 つの「空」で両方を
 * 賄うと、片方の人に嘘の道案内をすることになる — ADR-105 が発見の 0 を 4 種に
 * 割ったのと同じ規律 (原則 #31)。
 */
export const SEMANTIC_SIDE_KIND = Object.freeze({
  /** 文脈文書をまだ採っていない。**失敗ではない** (起動直後の通常状態)。 */
  NO_DOCUMENT:  'no-document',
  /** 文書は在るが `variables[]` が空。 */
  NO_VARIABLES: 'no-variables',
  /** 住人が 1 人以上居る。 */
  VARIABLES:    'variables',
})

/**
 * 種ごとの文言と出口。**未宣言の種で throw する。**
 *
 * `exit` は「次の一手がどこに在るか」で、null は「ここから先の一手は無い」と
 * いう宣言である (無いことを既定で埋めない)。
 */
const SEMANTIC_SIDE_DECLARATION = Object.freeze({
  [SEMANTIC_SIDE_KIND.NO_DOCUMENT]: Object.freeze({
    headline: 'No context document yet',
    detail:   'Shared design variables live in a context document. Start one to give this side residents.',
    exit:     'Start from a template',
    exitCallback: 'onOpenTemplateGallery',
  }),
  [SEMANTIC_SIDE_KIND.NO_VARIABLES]: Object.freeze({
    headline: 'This document declares no shared variables',
    detail:   'The document exists, but nothing in it is negotiated as a shared number yet.',
    exit:     'Add one in the document intake',
    exitCallback: 'onWizardStart',
  }),
  [SEMANTIC_SIDE_KIND.VARIABLES]: Object.freeze({
    headline: 'Shared design variables',
    detail:   'Selecting one swaps the right panel and draws its undecided band in 3-D (ADR-107).',
    exit:     null,
    exitCallback: null,
  }),
})

/** 宣言された意味側の種 (検査が母集団として引く)。 */
export const DECLARED_SEMANTIC_SIDE_KINDS = Object.freeze(Object.keys(SEMANTIC_SIDE_DECLARATION))

/**
 * 意味側の中身を組み立てる。**「空」を 1 つに畳まない。**
 *
 * `docPresent` は「場が開いているか」では**ない** — 意味側の住人が居るかどうかは
 * 場の開閉と無関係だからである (ADR-111 §却下案 B が断った循環)。依存する軸は
 * 「文書を採ったか」と「その文書が変数を宣言しているか」の 2 つだけ。
 *
 * @param {object} input
 * @param {boolean} input.docPresent   文書を採ったか
 * @param {Array<{ref: string, unit?: string, description?: string}>} [input.variables]
 *        `doc.variables`。`docPresent` のとき**必須** (0 件は空配列で渡す)
 * @returns {{kind: 'no-document'} | {kind: 'no-variables'} |
 *           {kind: 'variables', rows: Array<{ref: string, unit: string|null, description: string|null}>}}
 */
export function semanticSideSummary({ docPresent = false, variables = null } = {}) {
  if (!docPresent) return { kind: SEMANTIC_SIDE_KIND.NO_DOCUMENT }
  if (!Array.isArray(variables)) {
    // 文書は在るのに変数の配列が来ていない = 配線がまだ来ていない。ここで [] を
    // 埋めると「文書が宣言した 0 個」と「配線が来ていない 0 個」が区別不能になる
    // — それが ADR-105 / 原則 #31 が名指しする欠陥そのものである。
    throw new Error(
      '[NavigatorSides] semanticSideSummary: docPresent なのに variables が配列でない。' +
      '0 件は [] で渡すこと — 既定で埋めると「宣言された 0」と「配線の来ていない 0」が ' +
      '区別不能になる (原則 #31 / ADR-105 D2 と同じ規律)。',
    )
  }
  if (variables.length === 0) return { kind: SEMANTIC_SIDE_KIND.NO_VARIABLES }
  return {
    kind: SEMANTIC_SIDE_KIND.VARIABLES,
    rows: variables.map(v => ({
      ref:         v.ref,
      unit:        v.unit ?? null,
      description: v.description ?? null,
    })),
  }
}

/**
 * 意味側の種 → 文言と出口。未宣言の種で throw する。
 *
 * @param {{kind: string}} summary `semanticSideSummary()` の返り値
 * @returns {{headline: string, detail: string, exit: string|null, exitCallback: string|null}}
 * @throws {Error} 未宣言の種
 */
export function semanticSideDeclaration(summary) {
  const decl = SEMANTIC_SIDE_DECLARATION[summary?.kind]
  if (!decl) {
    throw new Error(
      `[NavigatorSides] 未宣言の意味側の種 "${summary?.kind}"。` +
      'SEMANTIC_SIDE_DECLARATION に行を足すこと — fall-through は「宣言された既定」と ' +
      '「誰も考えなかった種」を区別不能にする (原則 #31)。',
    )
  }
  return decl
}
