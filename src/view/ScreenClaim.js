/**
 * ScreenClaim — **画面を占める主張は同時に何個在ってよいか**の唯一の所有者
 * (ADR-113 · 原則 #31 · 原則 #26 の全画面版)。
 *
 * ## この module が答える問い
 *
 * 全画面オーバーレイは 4 つ在り、それぞれが**自分の flag だけ**を持っていた:
 *
 *   | 面 | flag | z-index | 書き手 |
 *   |---|---|---|---|
 *   | 起動ホーム (レイアウトテンプレ) | `home` | 300 | `AppController` |
 *   | New Project (Context テンプレ) | `templateGalleryOpen` | 300 | `ContextController` |
 *   | rename / confirm / import      | `modal` | 500 | `uiStore.openModal` |
 *   | 初回ジェスチャヒント (touch)   | `onboardingVisible` | 500 | `UIViewBridge` |
 *
 * 「**いま画面を占めているのは何枚か**」を持つ欄はどこにも無い。個々の flag は
 * どれも状態として認識されるのに、*枚数*には欄が無い — 原則 #31 が名指しする
 * 「基数は状態だが状態に見えない」形そのものである。実費も出ていた: 起動ホームと
 * New Project は **同じ z-index 300** で、同時に立ったときの勝者は
 * `UIShell.jsx` の**マウント順**という、どちらのファイルにも書かれていない
 * 事実が決めていた。勝者が暗黙なら、負けた側は*無言で*見えなくなる (原則 #11)。
 *
 * ## 形 (段は 3 つ、各段の基数は 0..1)
 *
 * 4 面を 1 スロットに押し込むのは嘘である — confirm ダイアログは「いま見ている
 * ものについて」問う面なので、下の面を*消して*はいけない。したがって**段**で
 * 割り、段ごとに 0..1 とする:
 *
 * ```
 * STAGE   0..1   起動ホーム | New Project   ← 相互排他な「始め方」。1 欄に統合した
 * COACH   0..1   初回ジェスチャヒント        ← 一時的・自動で消える (stage の上)
 * DIALOG  0..1   rename / confirm / import   ← 下の面**について**問う (最前面)
 * ```
 *
 * `STAGE` だけが構造の変更を要した (衝突が実在したのはここだから)。`stage` は
 * **1 つの欄**になったので、2 枚同時に立つ状態が**表現不能**になり、順序が
 * 暗黙に勝者を決める余地も消えた。`COACH` / `DIALOG` は元から単一欄なので
 * 宣言だけを与え、実装は動かしていない — 動かす理由が無いのに動かすのは
 * 過剰モデリング (核 §5)。**宣言はしておく**: 宣言の無い面は「対象外」ではなく
 * 「誰も数えていない面」になる。
 *
 * ## 純粋性
 *
 * store も DOM も React も読まない。node の test runner が直接読める (原則 #3)。
 *
 * @see docs/adr/ADR-113-one-claim-on-the-screen.md
 * @see docs/STATE_LEDGER.md (基数の台帳)
 * @see src/ScreenClaimCensus.test.js (面の個数を問う所)
 * @module view/ScreenClaim
 */

/** 画面を占める面の**段**。段ごとに基数 0..1。 */
export const SCREEN_TIER = Object.freeze({
  /** 「何から始めるか」— 相互排他。1 欄なので 2 枚同時が表現不能。 */
  STAGE:  'stage',
  /** 一時的な指導 (自動で消える)。stage の上に乗る。 */
  COACH:  'coach',
  /** 下の面**について**問うダイアログ。最前面。 */
  DIALOG: 'dialog',
})

/**
 * 段ごとの z-index。**面が自分で z を選ばない** — 選ばせた結果が
 * 「起動ホームと New Project が同じ 300」だった (原則 #26 と同じ規律:
 * 共有資源の占有量は 1 箇所で計算する)。
 */
const TIER_Z = Object.freeze({
  [SCREEN_TIER.STAGE]:  300,
  [SCREEN_TIER.COACH]:  400,
  [SCREEN_TIER.DIALOG]: 500,
})

/**
 * 段の z-index。**未宣言の段で throw** する。
 *
 * @param {string} tier `SCREEN_TIER` の値
 * @returns {number}
 * @throws {Error} 未宣言の段
 */
export function tierZIndex(tier) {
  const z = TIER_Z[tier]
  if (z === undefined) {
    throw new Error(
      `[ScreenClaim] undeclared tier "${tier}". ` +
      'SCREEN_TIER に段を足したら TIER_Z にも行を足すこと — 段の順序を面の側で ' +
      '決めさせると、同じ z を選んだ 2 枚の勝者がマウント順になる (ADR-113 §力学 2)。',
    )
  }
  return z
}

/** 画面を占める面 (= 主張)。 */
export const SCREEN_CLAIM = Object.freeze({
  /** 起動ホーム — Layout DSL テンプレの選択 (ADR-089)。 */
  LAUNCH_HOME:              'launch-home',
  /** New Project — Context DSL テンプレの選択 (ADR-051 Phase 2)。 */
  CONTEXT_TEMPLATE_GALLERY: 'context-template-gallery',
  /** 初回ジェスチャヒント (touch のみ、4 秒で自動退場)。 */
  GESTURE_HINT:             'gesture-hint',
  /** rename / confirm / import ダイアログ (`uiStore.modal` の union)。 */
  DIALOG:                   'dialog',
})

/**
 * **宣言表** — 面ごとの段・住所・なぜそこか。未宣言の面で throw する
 * (`EXPLICIT_DEFAULTS` (ADR-096) / `START_ENTRY_BY_KIND` (ADR-108) と同じ規律)。
 *
 * `component` は `src/ScreenClaimCensus.test.js` が母集団と突き合わせる住所で、
 * 手書きの面リストにしないための鍵である — 全画面オーバーレイを新しく描いた
 * ファイルは、その日から母集団に入る。
 */
export const CLAIM_DECLARATION = Object.freeze({
  [SCREEN_CLAIM.LAUNCH_HOME]: Object.freeze({
    tier: SCREEN_TIER.STAGE,
    component: 'src/components/Home/HomeScreen.jsx',
    why: '「何から始めるか」の一方 (工程レイアウト)。New Project と同時に立つ意味が無いので同じ欄に住む。',
  }),
  [SCREEN_CLAIM.CONTEXT_TEMPLATE_GALLERY]: Object.freeze({
    tier: SCREEN_TIER.STAGE,
    component: 'src/components/Context/TemplateGallery.jsx',
    why: '「何から始めるか」のもう一方 (Context 文書)。起動ホームと**同じ z-index 300** で、'
       + '勝者は UIShell のマウント順が決めていた — それが ADR-113 の出発点。',
  }),
  [SCREEN_CLAIM.GESTURE_HINT]: Object.freeze({
    tier: SCREEN_TIER.COACH,
    component: 'src/components/Onboarding/Onboarding.jsx',
    why: '始め方ではなく**操作の指導**で、4 秒で自動退場する。stage と排他にすると '
       + '起動時 (mobile) にホームが指導に食われて戻ってこない — 段が別である理由。',
  }),
  [SCREEN_CLAIM.DIALOG]: Object.freeze({
    tier: SCREEN_TIER.DIALOG,
    component: 'src/components/Modal/ModalLayer.jsx',
    why: '下の面**について**問う面 (「この名前でよいか」)。下を消してはならないので最前面の別段。'
       + '`uiStore.modal` が元から判別 union なので基数 0..1 は既に構造で保証されている。',
  }),
})

/**
 * 面の宣言を引く。**未宣言の面で throw**。
 *
 * @param {string} claim `SCREEN_CLAIM` の値
 * @returns {{tier: string, component: string, why: string}}
 * @throws {Error} 未宣言の面
 */
export function claimDeclaration(claim) {
  const decl = CLAIM_DECLARATION[claim]
  if (!decl) {
    throw new Error(
      `[ScreenClaim] undeclared screen claim "${claim}". ` +
      'CLAIM_DECLARATION に行を足すこと — 宣言の無い全画面オーバーレイは ' +
      '「対象外」ではなく「誰も枚数を数えていない面」になる (原則 #31)。',
    )
  }
  return decl
}

/** 宣言表が覆っている面 (検査が母集団として引く)。 */
export const DECLARED_CLAIMS = Object.freeze(Object.keys(CLAIM_DECLARATION))

/** 段 → その段に住む面。宣言表から**導出**する (第二の源にしない)。 */
export function claimsInTier(tier) {
  tierZIndex(tier)   // 未宣言の段はここで throw する
  return DECLARED_CLAIMS.filter(c => CLAIM_DECLARATION[c].tier === tier)
}

// ── STAGE 段の状態 (1 欄 = 基数 0..1 が構造で保証される) ─────────────────────

/**
 * stage の主張を作る。**stage 段の面でなければ throw** する。
 *
 * 1 欄しか無いので「2 枚同時」を作る手段が存在しない — これが ADR-113 の本体で
 * あり、「開くときに他を閉じる」という規律 (= 書き忘れうるもの) を要らなくする。
 *
 * @param {string} claim `SCREEN_CLAIM` の値 (stage 段のもの)
 * @returns {{claim: string}}
 * @throws {Error} 未宣言の面 / stage 段でない面
 */
export function claimStage(claim) {
  const decl = claimDeclaration(claim)
  if (decl.tier !== SCREEN_TIER.STAGE) {
    throw new Error(
      `[ScreenClaim] "${claim}" は ${decl.tier} 段の面なので stage スロットに入らない。` +
      '段を跨いで 1 欄に押し込むと、下の面について問うダイアログが下の面を消す。',
    )
  }
  return { claim }
}

/** stage が空であること。0 は既定値ではなく**値**である (原則 #31)。 */
export const NO_STAGE_CLAIM = null

/**
 * いま stage を占めている面 (無ければ null)。
 *
 * @param {null|{claim: string}} stage `uiStore.stage`
 * @returns {string|null}
 * @throws {Error} 未宣言の面が入っているとき
 */
export function stageClaim(stage) {
  if (stage === NO_STAGE_CLAIM || stage === undefined) return null
  claimDeclaration(stage.claim)   // 未宣言の面で throw
  return stage.claim
}

/**
 * この面が **いま stage を占めているか**。各面はこの述語だけを読む —
 * 自分の flag を読む形に戻すと、そこから枚数の所有者がまた消える (§1.1)。
 *
 * @param {null|{claim: string}} stage
 * @param {string} claim
 * @returns {boolean}
 */
export function stageIs(stage, claim) {
  claimDeclaration(claim)         // 綴り間違いを黙って false にしない
  return stageClaim(stage) === claim
}

/**
 * 解放。**自分が占めているときだけ**空になる。
 *
 * 誰の主張かを見ずに `null` を書くと、後から来た面の主張を古い close が消す
 * (「閉じたつもりが別の面を閉じていた」) — 非同期に閉じる経路が増えるほど
 * 起きやすくなる形なので、解放は主張の同一性つきで行う。
 *
 * @param {null|{claim: string}} stage
 * @param {string} claim
 * @returns {null|{claim: string}} 占めていなければ現状のまま
 */
export function releaseStage(stage, claim) {
  return stageIs(stage, claim) ? NO_STAGE_CLAIM : stage
}
