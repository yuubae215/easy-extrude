/**
 * DocPresence — 「文脈文書を採ったか」を答える**唯一の述語** (原則 #25 / §1.1)。
 *
 * ## なぜ 1 行の比較に名前を付けるのか
 *
 * 権威は `ContextService.loaded` ただ 1 つで、UI 側はそれを ADR-105 の発見の union
 * 経由で読む (`discovery.kind !== 'unexamined'`)。ADR-106 D4 が `context.loaded` の
 * 写しを退役させたのは、*読者を持たない第二の源は、最初の読者を得た瞬間にドリフト
 * する*からだった。
 *
 * その読者は既に 2 人になっている — ヘッダの `requires` gate と、ADR-111 の
 * ナビゲータ意味側。**同じ導出を 2 箇所に書けば、それ自体が第二の源である** (§1.1)。
 * union の枝が 3 つになった日に、片方だけが直る形になる。だから比較は 1 箇所が持つ。
 *
 * ## 副作用として: 集約の描き手の母集団から出る
 *
 * `DiscoveryOutsideTheFloor.test.js` は「集約を読むファイル」を母集団として導出し、
 * その中に場の開閉を読むものが 0 個であることを問う。Outliner は下端の占有量を
 * 引くために場の開閉を読む (原則 #26 — 正当) ので、集約を直に読むと**正当な 2 つの
 * 読みが交差して**落ちる。述語に畳むと Outliner は集約を読まなくなり、交差が消える。
 * これは検査を回避したのではなく、検査が「同じ導出が散っている」ことを先に
 * 見つけたのである (ADR-111 実装で分かったこと)。
 *
 * ストアの**形**を知る述語なので `src/view/` に住む (`floorIsOpen` と同じ位置づけ)。
 * union の語彙そのものは `src/context/DiscoverySummary.js` が持つ。
 *
 * @see docs/adr/ADR-111-the-outliner-has-a-semantic-side.md
 * @module view/DocPresence
 */

import { DISCOVERY_KIND } from '../context/DiscoverySummary.js'

/**
 * 文脈文書を採ったか。
 *
 * `context.active` (場が開いているか) では**ない** — 文書の有無は場の開閉と
 * 独立した事実であり、混ぜると ADR-105 が断った循環 (場に入らないと場に入る要否が
 * 分からない) が戻る。
 *
 * @param {{context: {discovery: {kind: string}}}} state uiStore の state
 * @returns {boolean}
 */
export function documentAdopted(state) {
  return state.context.discovery.kind !== DISCOVERY_KIND.UNEXAMINED
}
