# 099. 選択の往復を 1 つの入口へ — hover が click を殺す再構築の閉路を断ち、選択を「見えること」まで含む 1 つの決定にする

- Status: Proposed
- Date: 2026-07-26
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: なし (ADR-094/095 が定めた LINK NETWORK の往復契約を、実際に閉じる)

## Context — Goal と力学 (§1.2 Goal)

当事者の観測:

> ・LINK NETWORK の項目を選択してもビューポート側がハイライトされない。逆は有効なのに。
> 片方向は有効なのに、もう片方向は有効でないのは違和感があります。SSOT が
> 上手く設計できていないかもしれません。

持ち上げた Goal:

- **G1 — パネルとビューポートは「1 つの選択」の 2 つの窓である。** どちらから
  触っても同じ 1 つの事実が動き、両方の窓が同じように追従する。
- **G2 — 選択という決定は、その結果が*見える*ところまでを含む。** 選択できたが
  何も変化しない、は無言の失敗 (原則 #11)。
- **G3 — 入力を受け取る要素の寿命は、それを狙うジェスチャより長い。**

### 力学 1 — 実測: click は**一度も発火していない**

再現手順 (Chromium / playwright、既定シーン): Cube を選択 → `L` → `robot_base` →
リンク種 `Adjacent` を確定 → LINK NETWORK パネルが 3 ノードで開く → パネルの
`robot_base` 行へポインタを移動し、押下・離上する。

観測 (パネルの `<svg>` に capture フェーズで境界イベントを仕掛け、
`MutationObserver` で子要素の変異を数えた):

| 観測項目 | 実測値 |
|---------|-------|
| `mouseover` / `mouseenter` | **76 件** (19 + 57) — 行に触れているあいだ止まらない |
| SVG 子要素の変異 | **114〜120 件** (実行ごとに揺れる = 有界でない) |
| `mousedown` / `mouseup` / `click` | **0 件** |
| ステータスバーの選択表示 | 前後とも `Cube · selected` (変化なし) |

原因は `LinkNetworkView._renderRows()` の 2 行:

```js
g.addEventListener('click',      () => this._onSelect?.(id))
g.addEventListener('mouseenter', () => { this._hoveredId = id; this._renderSVG() })
```

`_renderSVG()` は SVG の子を**全部作り直す**。ポインタ下の `<g>` が破棄され新しい
`<g>` が同じ場所に生まれると、ブラウザは hover 対象の変化として `mouseover` /
`mouseenter` を**再び**投げる → また `_renderSVG()` → …。`mouseleave` 側には
`if (this._hoveredId === id)` の冪等ガードがあるのに、`mouseenter` 側には無い。

これは**原則 #24 (導出値を自身の入力に戻さない) が DOM の上に現れた形**である。
「どの行が hover されているか」は *DOM の hit target から導出される値*であり、その値が
*hit target を作り直す入力*に戻っている。数値なら誤差が毎周期蓄積するところ、DOM では
**要素の同一性が毎周期失われる**。`click` は押下と離上が同じ要素 (少なくとも共通祖先)
に届いたときにしか合成されないので、閉路が回っているあいだ click は永久に成立しない。

当事者の「片方向は有効なのに」は正確な観測だった: 3D → パネルは
`_switchActiveObject()` → `setSelection()` で届き、パネル → 3D は
**イベントがハンドラに到達していない**。

### 力学 2 — 到達しても、パネルの経路は他の入口と違う

閉路を断って `click` が発火するようになっても、`_onSelect` の先は他の選択入口と
**同じ手続きではない**。選択を書ける経路を数えると:

| 入口 | 事前の `clearObjectSelection()` | mode の正規化 | `_selectedIds` への追加 |
|------|:---:|:---:|:---:|
| Outliner の行 (`_onOutlinerSelect`) | — | あり (`edit` → `object`) | `_switchActiveObject` 内 |
| ビューポートのピック (`pointerdown`) | あり | — | 呼び出し側で `add` |
| ダブルクリック (`_onDblClick`) | あり | — | 呼び出し側で `add` |
| 矩形選択 (`finalizeRectSelection`) | あり | — | 呼び出し側で `add` |
| **LINK NETWORK の行** | **なし** | **なし** | `_switchActiveObject` 内 |

`_selectedIds` を書く行は `AppController` だけで 8 箇所あり、可視ハイライトの
書き手も 3 つ (`meshView.setObjectSelected` の直接呼び / `SelectionManager
.setObjectSelected` / `clearObjectSelection`) に分かれている。**選択には唯一の権威ある
入口が無い** (原則 #1) ので、窓を 1 つ足すたびに手続きの部分集合が書かれ、
書かれなかった部分が症状になる。パネルは最後に足された窓であり、最小の部分集合を
持っている。ADR-097 が pose について見つけた構造が、選択について未解決のまま残って
いる。

### 力学 3 — 「選択された」が見えない種がある

パネルに並ぶノードの多くは CoordinateFrame である (LINK NETWORK の行は
SpatialLink の端点とその祖先から作られる)。CF の選択ハイライトは
`CoordinateFrameView.setObjectSelected()` = **原点球を金色にして 1.6 倍にする**だけで、
その CF の軸が描かれていなければ画面には何も起きない。選択は
`SelectionManager.showFrameChain()` 経由で contextual 可視性を主張する (ADR-096) が、
**主張の宛先は frame chain であって、選ばれた実体そのものの explicit 軸ではない**。
`explicit` で消されている実体を選ぶと、選択は成立し、画面は沈黙する。

G2 が問うているのはここで、閉路を直すだけでは「クリックしたのに何も起きない」の
一部しか消えない可能性がある。

### 位置

View (`LinkNetworkView`) + Controller (`AppController` / `SelectionManager`)。
ドメイン・契約・コアAPI には触れない。

## Options considered

- **A: `mouseenter` に冪等ガードを 1 行足す** — tradeoff: 実測された閉路は止まり、
  click は発火するようになる。5 分で終わり、症状も消える。しかし「hover のたびに
  DOM を全部作り直す」設計はそのまま残り、次に `_renderSVG()` を呼ぶ状態が
  増えたとき (選択・スクロール・レイアウト更新) 同じ閉路が別の入口で再発する。
  力学 2・3 は手つかず。
- **B: 行の DOM を再構築ではなく更新にする (focus/context は属性の書き換え)** —
  要素の同一性がジェスチャより長く生きる。tradeoff: `_renderSVG()` の全再構築は
  ADR-095 の実装単純さの源だったので、差分更新の責務が増える。
- **C: 選択の唯一の権威ある入口を作り、全窓をそこへ寄せる** — 力学 2 を根から
  消す。tradeoff: 8 箇所の書き換えと、`_selectedIds` / `_objSelected` /
  可視ハイライトの所有権整理。
- **D: 選択に「見えることの要求」を含める (reveal-on-select)** — 力学 3 を消す。
  tradeoff: 「選んだら勝手に表示が変わる」は ADR-096 が分離した explicit 軸への
  介入になりうるので、どちらの軸を触るかを決めないと二重書き込みが復活する。
- **E: 現状維持** — tradeoff: G1〜G3 すべて未達。

## Decision — Strategy (§1.2 Strategy)

**B + C + D を採る。A は B に含まれるので単独では採らない。**

3 つは別々の症状に見えるが、いずれも「**選択という 1 つの事実が、それを表示する
仕組みの都合で分裂している**」の現れなので、1 決定として扱う。

### 1. 行の同一性をジェスチャより長く保つ (G3)

`LinkNetworkView` の focus/context 表現を、**再構築から属性更新へ**変える:

- ノード・辺の DOM は「レイアウトが変わったとき」だけ作り直す
  (`computeLayout()` の結果が変わったとき = 実体・リンクの増減)。
- hover / selection は既存要素の `fill` `stroke` `opacity` を書き換えるだけ。
- 併せて `mouseenter` を冪等にする (`if (this._hoveredId === id) return`) —
  ガードは閉路の**再発防止**であって、閉路を断つ主体は上の分離。

**なぜ両方やるか:** ガードだけでは「hover 以外の理由で再構築が起きた瞬間に
ポインタ下の行が入れ替わる」が残る。同一性はガードではなく構造で守る。

### 2. 選択の唯一の権威ある入口 (G1 / 原則 #1)

`SelectionManager` に**選択の公開 API** を置き、`_selectedIds` / `_objSelected` /
可視ハイライトの 3 つを**そこだけが書く**:

```
selectOnly(id)          // 単一選択 — 既存選択を落として 1 つにする
addToSelection(id)      // 追加選択
clearSelection()        // 全解除
```

全窓 (Outliner / ビューポートピック / ダブルクリック / 矩形選択 / LINK NETWORK)
はこの API を呼ぶだけになる。`_switchActiveObject()` は「active の切替 + 副作用」に
縮み、選択集合を触らない。mode の正規化 (`edit` → `object`) は入口が持つので、
今日 Outliner だけが持っている 1 行が全窓に効く。

**書く瞬間に問われる形にする (Q3):** `_selectedIds` を `AppController` から直接
書く行が **0 個**であることを、`PosePolicyOwnership.test.js` と同じ形の個数検査で
問う。*在るもの*を辿るのではなく、**選択を書きうる形を列挙して所有者の外にある
個数を数える** (原則 #31)。今回の欠陥は「新しい窓が部分集合を書いた」ことであり、
実装を読んでも見えなかった — 数えなければ次の窓でも同じことが起きる。

### 3. 選択は「見えること」を要求する (G2 / ADR-096 との接続)

`selectOnly()` / `addToSelection()` は、選ばれた実体の **contextual 軸**に
「選択されているので見せる」を主張する (explicit 軸には触らない — ADR-096 の
所有者は eye のまま)。ADR-096 の合成規則がそのまま効くので、書き手は増えない。

帰結: `explicit` で消してある `tcp` をパネルから選ぶと、選択中だけ軸が現れ、
選択を外すと eye の宣言どおり消える。「選べたのに何も起きない」が構造的に
なくなる (原則 #11)。

### 4. 契約は変えない

`computeLayout()` の `nodeIdByEntity` による「融合ノードは両メンバの選択で光る」
非対称 (ADR-094) は正しい設計なので**そのまま**。本 ADR が直すのは、その契約が
到達する前にイベントが消えていたこと。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- **肯定的:**
  - G1 — 往復が閉じる。パネルの行をクリックするとビューポートが追従し、
    ビューポートで選ぶとパネルが光る (後者は既に動いている)。
  - G2 — 見えない実体を選んだときに画面が沈黙しない。
  - G3 — 行の DOM 同一性が安定し、hover による無限再構築 (実測 114〜120 変異/接触)
    が消える。副次的に、パネル上でポインタを止めているだけで走り続けていた
    再描画コストが無くなる。
  - 選択の書き手が 1 つになり、次に「選択できる窓」を足すときに部分集合を
    書けなくなる。
- **受け入れるコスト / 否定的:**
  - `LinkNetworkView` に「レイアウト再構築」と「状態更新」の 2 経路ができる。
    ADR-095 が意図的に選んだ全再構築の単純さを一部手放す。境界を誤ると
    「レイアウトが変わったのに DOM が古い」が新しい欠陥として入りうる —
    レイアウト結果の同値判定を純粋関数側 (`LinkNetworkLayout`) に置いて
    テストで固定する。
  - `_switchActiveObject()` の呼び出し 12 箇所すべてが影響を受ける。移行中は
    「選択集合は新 API、active は旧経路」の二重状態が生じるので、1 PR で
    通しきる (途中で止めると第二の源が残る)。
  - reveal-on-select は「選択しただけで画面が変わる」ので、多数選択時に
    大量の軸が現れうる。contextual 軸の DIMMED を使い、選択本体だけ FULL に
    する (`showFrameChain` の既存の強度規則を再利用)。
- **検証 (証拠):** 論証木は `docs/gsn/adr-099-selection-round-trip.gsn`
  (goal ごとの支えの正本はそちら)。**診断の証拠は実測済み**だが、決定を支える
  証拠は**すべて未来形**であり、そう宣言する。実装時に閉じる予定の検査:
  - **閉路の回帰 (e2e、実測手順そのまま)**: パネルの行にポインタを置いて 300ms
    待ち、SVG 子要素の変異数が **有界** (例: ≤ 数件) であること。今日は
    114〜120 件で、しかも実行ごとに揺れる = 有界でないことが証拠になっている。
  - **往復の回帰 (e2e、当事者の報告に 1:1)**: パネルの `robot_base` 行をクリック
    → ステータスバーが `robot_base · selected` になる。**差分ペア**にする —
    逆向き (3D で選んでパネルが光る) も同じ 1 本で見て、片方向だけ通って
    「テストが何も動かしていない」状態と区別する。
  - **入口の個数検査 (単体)**: `_selectedIds` / `_objSelected` を
    `SelectionManager` の外から書く行が 0 個。宣言された例外は表に持ち、
    宣言の無い例外が 0 個であることを逆向きにも数える。
  - **可視性の合成 (単体)**: `VisibilityAxes` に「選択されている」を渡したときの
    合成結果の表テスト (explicit × contextual × selected)。ADR-096 の既存表の拡張。
  - 当事者による dogfooding (`docs/dogfooding/`) — 「往復が自然か」は主観なので
    テストでは閉じない。証拠は当事者の記録であり、そう宣言する。
- **波及 (blast radius):** `src/view/LinkNetworkView.js` (描画と入力)、
  `src/view/LinkNetworkLayout.js` (レイアウト同値判定を足す場合)、
  `src/controller/SelectionManager.js` (公開 API・唯一の書き手)、
  `src/controller/AppController.js` (`_switchActiveObject` と 8 箇所の
  `_selectedIds` 書き込み、4 つの選択入口)、`src/view/OutlinerBridge.js` /
  `OutlinerView.js` (行ハイライトの追従)、`src/service/SceneService.js`
  (contextual 軸の主張)、`e2e/smoke.spec.js`、`docs/STATE_LEDGER.md`
  (選択集合の**基数 0·1·N** — 今日この行が無い。0 個選択と N 個選択は
  `_objSelected` という boolean では表現できず、まさに原則 #31 の盲点)。
  契約・BFF・`core/` は不変。

## Lens notes

- **グラフ:** blast radius は「選択を読む側」ではなく「**選択を書く側**」の集合。
  読み手 (`_refreshObjectModeStatus` / `_updateNPanel` / `updateLinkSelectionHighlight` /
  パネル / Outliner) は既にイベント的に追従できているので、直すのは書き手側。
- **層 + 契約:** View → Controller の入力契約は「id を 1 つ渡す」で正しい。
  壊れていたのは契約ではなく、**契約の手前の DOM イベント経路**だった。
  層の内側を疑う前にイベントが到達しているかを測ったのが、この診断の分かれ目。
- **黒箱:** `LinkNetworkView` の特性を「入力: レイアウト + 選択集合 / 出力:
  描画 + `onSelect` 発火」と言語化すると、hover が出力ではなく**内部状態**である
  ことがはっきりする。内部状態が入力の到達を壊していたのが欠陥。
- **状態機械 (§1.4):** 選択は `0 個 / 1 個 / N 個` の基数を持つ実体状態で、
  今日の表現は `_objSelected: boolean` + `_selectedIds: Set` の 2 つに分裂して
  いる (不正状態 `_objSelected === true && _selectedIds.size === 0` が表現可能)。
  台帳へ行を起こし、公開 API の設計と同じコミットで不正状態を表現不能にする。
- **原則 #24 の系:** 数値の閉路 (毎周期の誤差蓄積) と DOM の閉路 (毎周期の同一性
  喪失) は同じ形で、後者は「入力が届かない」という別の顔で出る。
  実装時に PHILOSOPHY の Yellow Card へ 1 行足す (2 例目で原則へ昇格)。

## References

- ADR-094 (LINK NETWORK を TF ツリーへ) — 融合ノードの往復契約 (`nodeIdByEntity` による非対称) の出どころ。本 ADR はその契約を変えず、契約の手前で消えていたイベントを直す
- ADR-095 (インデントアウトライン) — 全再構築 (`_renderSVG`) の単純さを選んだ ADR。本 ADR はその一部を手放す
- ADR-096 (可視性の 2 軸) — 選択が主張するのは contextual 軸であり explicit 軸の所有者は eye のまま、という根拠
- ADR-097 (接地を実体の状態へ) — 「入口ごとに実装したものは入口ごとに壊れる」という同型の診断と、個数検査という証拠の形の先例
- ADR-090 / ADR-093 — 「列挙して個数を検査する」形の先例 (0 台のロボット / N 個の lockstep)
- PHILOSOPHY #1 (唯一の権威ある入口), #4 (表示フラグの単一所有者), #11 (無言の失敗の禁止), #24 (導出値を入力へ戻さない — 本 ADR はその DOM 版), #31 (基数ゼロ)
