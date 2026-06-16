# ADR-048 — Link Network 決定的階層レイアウト

**Status**: Accepted
**Date**: 2026-06-12
**Related**: ADR-030 (SpatialLink architecture), ADR-037 (Auto Origin Frame), ADR-038 (Two-Layer Taxonomy)
**Implementation**: `src/view/LinkNetworkView.js`, `src/controller/AppController.js` (`_updateLinkNetwork`)

---

## 1. Context

LINK NETWORK パネルは Fruchterman-Reingold 力学レイアウト＋ランダム初期配置で
ノードを散布していた。ユーザーフィードバック:「要素集合が散らばっていて分かりづらい。
もっとヒエラルキー的な表現にできないか」。

実際の構造は本質的に階層的である — Solid → Origin CF → 子 CF (ADR-037) — が、
パネルには `parentId` が渡されておらず、力学レイアウトはこの構造を完全に無視していた。
さらにランダム初期化のため同じシーンでも毎回違う絵になり、`prevPos` 引き継ぎという
補助機構で誤魔化していた。

## 2. Decision

### 2.1 力学レイアウト → 決定的レイヤー型レイアウト

- **レイヤー** = `parentId` 深さ(集合内)。ルート(Solid・注釈エンティティ)が
  レイヤー 0、CF は親の 1 段下。
- **ノード集合** = SpatialLink 端点 + その**祖先チェーン全体**。リンク端点 CF の親
  Solid はリンクを持たなくてもノード化する(例: `robot_base` CF が fastened 端点
  のとき Solid「robot」と Origin CF を含める)— 木構造の表示が成立する条件。
- **X 順序**: ルートは `(name, id)` 安定ソート → SpatialLink 相手のルート祖先
  barycenter で 1 パス再ソート。子は親の x 直下にグループ配置 → min-gap 16px の
  左右スイープ。
- **完全決定的**: 同一シーン状態 → 同一ピクセル。`prevPos` 引き継ぎとランダム
  初期化は削除(決定性そのものが安定機構)。

却下した代替案: (a) 力学レイアウト + Solid ごとのクラスタ枠 — 構造は見えるが
散布・非決定性は残る。(b) 将来力学に戻す改修 — 本 ADR が明示的に排除する
(散らばり・非決定性の苦情が再発するだけ)。

### 2.2 エッジの視覚言語

| 種類 | スタイル | 意味 |
|------|---------|------|
| 親子(新規) | `rgba(255,255,255,0.18)`・実線・幅 1・アニメなし・矢印なし | 構造の足場 |
| SpatialLink | 従来どおり semanticType 色・破線・marching-ants・矢印 | 意味的関係 (ADR-030/038) |
| 同一レイヤー間 SpatialLink | 14px 湾曲ベジェ(レイヤー 0 は上、他は下) | 直線だと同じ行の兄弟ノードを貫通するため |

marching-ants を親子線に使わないのは意図的 — アニメーションは意味的・運動学的
関係の符号であり、含有構造に使うと信号が薄まる。

#### 2.2.1 「複数親に見える」混乱の解消（仕様の明確化）

ユーザーから「ノードが複数の親を持っているように見える。単一親のツリー/DAG を期待していた。
テンプレートかモデルの問題か」という指摘があった。**これは不具合ではなく、2 種類の辺の重畳である。**

- **包含階層（`parentId`）は厳密に単一親のツリー**。各 CoordinateFrame は親をちょうど 1 つだけ持つ
  （`LayoutCompiler.js` の CF 生成、`_runLayout()` のレイヤ計算は `parentId` チェーンのみ辿る）。
  例 JSON にも複数 `parentId` は存在しない（テンプレートにもモデルにも欠陥は無い）。
- **SpatialLink 制約は包含とは独立した DAG**。1 ノードに複数の制約端点が刺さるのは正常で、別色矢印
  （semanticType 色・破線・marching-ants）として描かれる。「複数親」に見えるのはこの制約矢印である。

**決定**: 包含線（足場・単一親）と制約矢印（DAG・意味）の視覚差を強め、凡例（legend）を提示して
両者が別レイヤーであることを一目で分からせる。後続の最小実装は `LinkNetworkView` への凡例描画と
線種/太さ/色のコントラスト強化（本 ADR では決定のみ、コードは別途）。

##### 構造関係の精密化 — 「準同型」の正確な定式化

「CF ツリー・SpatialLink・5W1H NL ツリーは準同型か」という問いに対し、緩い "homomorphic" 断言は
避け（PHILOSOPHY #19）、正確には次の通り:

- **CF ツリーは SE(3) への TF 準同型を持つ**: パス合成 → 剛体変換合成（`bodyRotation` /
  `_updateWorldPoses()` が実装する ROS TF 前進運動学）。これはモノイド/groupoid 準同型として厳密。
- **CF ツリー ↪ SpatialLink グラフは包含（単射）準同型**: CF ツリーは運動学的**全域木（spanning
  tree）**、SpatialLink はループを閉じる辺を含む完全な制約グラフ（URDF 流、ADR-038）。木の辺は制約辺の
  部分集合なので包含は成り立つが、含有辺 ≠ 意味辺ゆえ**同型ではない**。「複数親に見える」のはこの
  全域木の上に DAG の制約辺が重畳した像である。
- **5W1H は逐次合成のモノイド準同型 φ**（ADR-044、`φ(A∘B)=φ(A);φ(B)`、多対一・全射）。厳密には
  「NL ツリー」ではなく、各操作が Why→How→What の小 DAG、プログラム全体は列（自由モノイド）。
- **三者は互いの準同型ではない**。正しい統合像は「**同一の正準 context doc からの構造保存射の像**」で
  ある（`compileLayout` が doc→(CF ツリー, SpatialLink) の What/How 射影、φ が NL→操作）。CF ツリーと
  SpatialLink は **What/How 射影にすぎず Why（KPI/Gap/Acceptance）を持たない** — このため両者だけでは
  正準 doc の情報が欠落する。詳細は **ADR-052**（5W1H ユビキタス言語 / Mutual 構造）を参照。

### 2.3 パネル寸法

- **幅 220px 固定**。左エッジ占有契約(CODE_CONTRACTS「Edge-Anchored Panels Must
  Coordinate Occupancy」)により横拡大しない。
- **SVG 高さ 152px、3 レイヤー以上で 160px**。上限 160 の根拠: パネルは
  `bottom:34px` から上に伸び、同じ `left:188px` 列の Map 縦ツールバー
  (`top:50%`・実測高 259px・下端 ≈490px @720px ビューポート)と重なってはならない。
  192px 案は実測で 23.5px 重なり、160px で 8.5px クリアランス(Playwright 実測)。
- **過密縮退**: 行スロット幅 < 22px でラベルは選択ノードのみ表示(ドット列に退化、
  クリック選択は維持)。スクロール・ズームは MVP 外。

### 2.4 データ契約

`AppController._updateLinkNetwork()` の `entityInfos` に `parentId` を 1 フィールド
追加するのみ(`{ name, type, parentId }`)。祖先展開・レイヤー計算はすべて view 側
(`LinkNetworkView.update()` / `_runLayout()`)— Controller は thin のまま
(Constitutional Rule 3)。`update(entityInfos, links)` シグネチャ不変。

## 3. Consequences

- 同じシーンは常に同じ絵 — スクリーンショット回帰テストが可能になった
- ノード数が増えるとレイヤー 0 が先に過密になる(縮退モードで吸収)。
  本格的な大規模シーンにはパネル拡大/ズームが必要になるが、それは
  オーバービューウィジェットという本パネルの役割を超える
- ラベル衝突回避(greedy)はレイアウト非依存のため無変更で動作。行レイアウトでは
  衝突が決定的に解決される(挿入順をレイアウト順に固定)
