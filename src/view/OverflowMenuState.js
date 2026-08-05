/**
 * OverflowMenuState — モバイル `⋯` の**階層を含む 1 つの状態** (原則 #31 / 核 §1.4)。
 *
 * ## この module が消している不正状態
 *
 * `MoreMenu` は状態を 2 欄に分けて持っていた: `open` (boolean) と `verb`
 * (今どの動詞の中に居るか)。この形は `{ open:false, verb:'export' }` を
 * **表現できてしまう** — そして実際にそれが画面に出た:
 *
 *   1. `⋯` を押す → 動詞 4 行 (`Start` `Export` `Import` `Context`)
 *   2. `Export ›` を押す → `verb` は立つが、同じ click が外側 click として
 *      `open` を false にする → **メニューが閉じるだけで何も起きない**
 *   3. もう一度 `⋯` を押す → `verb` が残っているので、動詞一覧ではなく
 *      **`Export` の中身**が出る = 「同じボタンを押したのに違うものが出る」
 *
 * 2 は `isInsideDropdown` の欠落 (`view/DropdownContainment.js`) が原因だが、
 * 3 は**それとは独立した欠陥**である。閉じる経路が増えるたびに「閉じるときに
 * `verb` も戻す」を思い出す必要があり、思い出さなかった経路が 1 つでもあれば
 * 再発する。答えは規律ではなく形 — **閉じた状態が階層を持てないようにする**。
 *
 * ```
 * null                          閉 (階層を持たない — これが本体)
 * { level:'verbs' }             一段目: 動詞を選ぶ
 * { level:'objects', verb }     二段目: その動詞の対象を選ぶ
 * ```
 *
 * 遷移はここに閉じる (原則 #1 — 状態遷移の入口はちょうど一つ)。`MoreMenu` は
 * `useState` の値をこれらの関数に通すだけで、`{...state, level:'objects'}` の
 * ような部分更新を書かない。
 *
 * ## 純粋性
 *
 * store も DOM も React も読まない。node の test runner が直接読める (原則 #3)。
 *
 * @see docs/adr/ADR-113-one-claim-on-the-screen.md
 * @see src/view/OverflowMenuState.test.js
 * @module view/OverflowMenuState
 */

/** 開いているときの段。閉には段が**無い** (null がその表現)。 */
export const MENU_LEVEL = Object.freeze({
  /** 動詞を選ぶ一段目。`⋯` を開いた直後は必ずここ。 */
  VERBS:   'verbs',
  /** 選んだ動詞の対象を選ぶ二段目。 */
  OBJECTS: 'objects',
})

/**
 * 段ごとの**宣言表**。未宣言の段で throw する — fall-through は
 * 「宣言された既定」と「誰も考えなかった段」を区別不能にする (原則 #31)。
 */
const LEVEL_DECLARATION = Object.freeze({
  [MENU_LEVEL.VERBS]: Object.freeze({
    /** この段が対象 (verb) を持つか。 */
    carriesVerb: false,
    why: '`OVERFLOW_VERBS` を並べるだけの段。対象はまだ選ばれていないので verb を持たない。',
  }),
  [MENU_LEVEL.OBJECTS]: Object.freeze({
    carriesVerb: true,
    why: '選ばれた動詞の引数を並べる段。verb 無しでは「何の対象か」が決まらないので必須。',
  }),
})

/**
 * 段の宣言を引く。**未宣言の段で throw**。
 *
 * @param {string} level `MENU_LEVEL` の値
 * @returns {{carriesVerb: boolean, why: string}}
 * @throws {Error} 未宣言の段
 */
export function levelDeclaration(level) {
  const decl = LEVEL_DECLARATION[level]
  if (!decl) {
    throw new Error(
      `[OverflowMenuState] undeclared level "${level}". ` +
      'MENU_LEVEL に枝を足したら LEVEL_DECLARATION にも行を足すこと — ' +
      '段が増えても「閉は段を持たない」不変条件は変わらない (原則 #31)。',
    )
  }
  return decl
}

/** 宣言表が覆っている段 (検査が母集団として引く)。 */
export const DECLARED_MENU_LEVELS = Object.freeze(Object.keys(LEVEL_DECLARATION))

/** 閉。**階層を持たない**ことが型で保証される唯一の値。 */
export const CLOSED = null

/**
 * 状態が妥当か (不変条件の名前付き述語 — 原則 #25)。
 *
 * 検査と遷移の両方がこの 1 つを引く。呼び手が `state && state.level` を
 * 並べ直すと、そこが第二の源になる (§1.1)。
 *
 * @param {null|{level: string, verb?: string}} state
 * @returns {boolean}
 */
export function isValidMenuState(state) {
  if (state === CLOSED) return true
  if (typeof state !== 'object' || state === null) return false
  const decl = LEVEL_DECLARATION[state.level]
  if (!decl) return false
  return decl.carriesVerb ? typeof state.verb === 'string' && state.verb.length > 0
                          : !('verb' in state)
}

/** 開いているか。`state !== null` を呼び手で書き直さないための述語。 */
export function isMenuOpen(state) {
  return state !== CLOSED
}

/**
 * 開く。**必ず一段目から** — 前回どこまで潜ったかは持ち越さない。
 *
 * これが 3 の症状 (「もう一度 `⋯` を押すと違うものが出る」) を構造的に消す本体で、
 * 「閉じるときに戻す」ではなく「開くときに決まる」形にしてある: 閉じ方が何通り
 * 増えても (外側 click / Esc / 行の選択 / 画面回転) 再発しない。
 *
 * @returns {{level: 'verbs'}}
 */
export function openMenu() {
  return { level: MENU_LEVEL.VERBS }
}

/** 閉じる。段を捨てる以外のことをしない。 */
export function closeMenu() {
  return CLOSED
}

/**
 * 一段目 → 二段目 (動詞を選ぶ)。
 *
 * @param {null|{level: string}} state 現在の状態
 * @param {string} verb `HEADER_VERB` の値
 * @returns {{level: 'objects', verb: string}}
 * @throws {Error} 閉じた状態から潜ろうとしたとき / verb が空のとき
 */
export function descendTo(state, verb) {
  if (!isMenuOpen(state)) {
    throw new Error(
      '[OverflowMenuState] descendTo() called while closed. ' +
      '閉から二段目へ跳ぶ経路は存在しない — 開いてから潜ること (原則 #1)。',
    )
  }
  if (typeof verb !== 'string' || verb === '') {
    throw new Error(
      '[OverflowMenuState] descendTo() needs a verb. ' +
      '対象の段は「何の対象か」を持たねば意味を持たない (原則 #31 — 既定で埋めない)。',
    )
  }
  return { level: MENU_LEVEL.OBJECTS, verb }
}

/**
 * 二段目 → 一段目 (戻る)。一段目で呼ばれても一段目のまま (冪等)。
 *
 * @param {null|{level: string}} state
 * @returns {{level: 'verbs'}}
 * @throws {Error} 閉じた状態から戻ろうとしたとき
 */
export function ascend(state) {
  if (!isMenuOpen(state)) {
    throw new Error(
      '[OverflowMenuState] ascend() called while closed. ' +
      '閉には段が無いので「戻る」先も無い (閉が段を持たないことが本 module の不変条件)。',
    )
  }
  return { level: MENU_LEVEL.VERBS }
}

/**
 * 引金を押したときの遷移 — 閉なら開き (一段目)、開いていれば閉じる。
 *
 * `MoreMenu` が `setOpen(o => !o)` を書かずに済ませるための唯一の入口。
 *
 * @param {null|{level: string}} state
 * @returns {null|{level: 'verbs'}}
 */
export function toggleMenu(state) {
  return isMenuOpen(state) ? closeMenu() : openMenu()
}

/**
 * 今どの動詞の中に居るか。一段目・閉では `null`。
 *
 * @param {null|{level: string, verb?: string}} state
 * @returns {string|null}
 */
export function verbOf(state) {
  if (!isMenuOpen(state)) return null
  return levelDeclaration(state.level).carriesVerb ? state.verb : null
}
