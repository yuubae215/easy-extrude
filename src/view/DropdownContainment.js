/**
 * DropdownContainment — 「この click はこのドロップダウンのものか」の**唯一の述語**。
 *
 * ## なぜ 1 箇所でなければならないか
 *
 * この問いは repo に 2 つの実装を持っていた:
 *
 *   - `HeaderMenus.useDropdown` — `btnRef.current.contains(e.target)`
 *     (引金だけを見る)
 *   - `ModeDropdown` — `btnRef.current.closest('[data-mode-selector]').contains(e.target)`
 *     (引金を含む器を見る)
 *
 * 前者は **surface を勘定に入れていない**。パネルは `position:fixed` で描かれる
 * (ヘッダが `overflow:hidden` なので中に置けない) から、パネル内の click は
 * 引金の外側 = 「外側 click」と判定され、開いた瞬間に閉じる。デスクトップの
 * `VerbMenu` では症状が出ない — 行を選べばどのみち閉じるのが正しいから。
 * 出たのは 2 段の `⋯` で、**一段目の行を押すと閉じるだけで何も起きなかった**
 * (入力は消費されたのに何も起きない = 原則 #11 が名指しする最悪の失敗形)。
 *
 * つまり欠陥は「片方の実装が間違っていた」ではなく、**同じ問いに答える規則が
 * 2 つ在り、片方だけが surface を知っていた**ことである (§1.1)。導出規則の
 * 二重化はデータの二重化と違って grep で見えない — どちらも単体では妥当な
 * ローカル判断に見えるので、名前付き述語が無い限り n+1 個目のコピーが常に
 * 最小抵抗経路になる。`src/IdentityContainment.test.js` に登録して機械に守らせる。
 *
 * ## 呼ぶ**時点**も規則の一部 (述語だけでは足りなかった)
 *
 * 実装中に判明した二つ目の欠陥: surface を渡すようにしても `click` で判定すると
 * まだ閉じる。React は行の onClick で起きた state 変化を **`document` の click
 * リスナが走る前に** flush するので、押された行は既に DOM から外れている —
 * **切り離されたノードはどこにも含まれない**ので、述語がどれだけ正しくても
 * 「外側」と読む。したがって判定は `pointerdown` (再描画より前) で行う。
 * `ModalLayer` / `Onboarding` が `onPointerDown` で閉じているのと同じ理由。
 *
 * ## 純粋性
 *
 * DOM 要素を受け取るが読むのは `contains` だけで、store も document も window も
 * 触らない。node の test runner から偽ノードで検証できる (原則 #3)。
 *
 * @see docs/adr/ADR-113-one-claim-on-the-screen.md
 * @module view/DropdownContainment
 */

/**
 * click 対象がドロップダウンの**どこか**に属するか。
 *
 * 引金と surface を **両方**渡すことを型の形で要求する — 片方だけ渡す呼び方が
 * できると、そこから欠陥が再発する。要素が `null` (未マウント) の部分は
 * 「属さない」として扱い、throw しない: 開いていないドロップダウンの surface が
 * 無いのは正常で、そこで落ちると閉じている間の外側 click が全部例外になる。
 *
 * @param {EventTarget|null} target       `event.target`
 * @param {{trigger: Element|null, surface: Element|null}} parts
 *        `trigger` = 開閉ボタン、`surface` = 開いているパネル (閉なら null)
 * @returns {boolean} どちらかが `target` を含むなら true
 * @throws {Error} `parts` が 2 つの欄を持たないとき (片方だけ渡す呼び方の禁止)
 */
export function isInsideDropdown(target, parts) {
  if (!parts || !('trigger' in parts) || !('surface' in parts)) {
    throw new Error(
      '[DropdownContainment] isInsideDropdown(target, { trigger, surface }) — ' +
      '両方の欄を渡すこと。surface を省いた呼び方はパネル内の click を「外側」と ' +
      '判定し、開いた瞬間に閉じる欠陥をそのまま再現する (原則 #11)。',
    )
  }
  if (!target) return false
  const { trigger, surface } = parts
  return !!(trigger?.contains?.(target) || surface?.contains?.(target))
}
