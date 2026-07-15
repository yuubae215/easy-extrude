# 070. エンティティ同一性 — ラベルの充実と IFC クラスの活性化

- Status: **Proposed**(ユーザ承認待ち — 特に §決定2 の IFC 深度を確定してから実装)
- Date: 2026-07-15
- Deciders: yuubae215, Claude
- 関連: ADR-069(UX パリティ・パス Phase 2)、ADR-025(IFC 意味分類)、ADR-034/037(CF)、
  PHILOSOPHY #4(視覚状態の単一所有者)/#27(スクリーン空間サイズ・ワールド上限)/#11/#30、
  スコープ境界(CLAUDE.md「宣言とスキーマ、解法は外部」)

## Context — Goal と力学(§1.2 Goal)

ユーザ観察(UX 評価 #1, #7, #8):
- 「CF がシンプルすぎる、ラベル表記も面白くない」
- 「CF にはラベル付けできるけど、ソリッドとかメッシュにもできて良いのかもしれない」
- 「IFC CLASS ってもっと有効活用できない？産業用にカスタムするとか」

現状(Explore で確認):
- **CF ラベル**: `CoordinateFrameView` の HTML `<div>` = monospace の名前文字列 + 左の青バー
  のみ。軸文字(X/Y/Z)も姿勢も役割グリフも無い。3D 表現は円柱 3 本 + 白球(矢印/3D 文字は
  意図的に除去済)。
- **Solid/Mesh の 3D ラベル**: **無い**。名前は Outliner と N パネルにのみ存在。3D 空間の
  浮遊ラベル機構は `CoordinateFrameView` にしか無い。
- **IFC クラス**: `IFCClassRegistry`(24 の IFC4 クラス・`{name,label,group,color}`)、
  `Solid`/`ImportedMesh` に `ifcClass` フィールド、N パネルのピッカー、Outliner バッジ、
  undo(`SetIfcClassCommand`)まで**完備**。しかし**実 3D メッシュの見た目・挙動・検証を
  一切駆動せず、2 つのバッジ止まり = inert**。

**Goal**: *エンティティが 3D の中で「自分が何者か」を十分に表現する — 名前・種別・役割・
(CF は)姿勢が読め、IFC 分類が捕捉済みデータから実際に見えて効く declaration になること。*

## 決定 1 — 3D ラベル機構を一般化し、CF ラベルを情報化する(#1 + #7)

**現状の非対称**: 浮遊ラベルは CF 専用。Solid/Mesh は Outliner 依存で、3D を見ながら
どれが何か分からない。

**判断**:
- `CoordinateFrameView` のラベル部分機構(div 生成 + `updateLabelPosition` の NDC 射影 +
  毎フレーム更新 + ジッタ抑制キャッシュ)を **共有可能な小さなラベルヘルパ**に抽出し、
  `MeshView`/`ImportedMeshView` が消費できるようにする。Solid/Mesh に名前ラベルが付く。
- CF ラベルを **情報化**: 名前だけでなく軸文字 or 役割グリフ、任意で姿勢(RPY)読み出しを
  出す。トークン(`COLOR`/`Z.sceneLabel`)でスタイル。
- 契約(#4 単一所有者): ラベルのテキスト/可視性は **1 つの owner メソッド**が書く。
  HTML Overlay は `SceneView.activeCamera` を使う(既存 CODE_CONTRACTS ルール)。サイズは
  スクリーン空間 + ワールド上限のペア(#27 — mm スケールで消えない/巨大化しない)。
- 密度対策: すべての Solid に常時ラベルを出すと煩雑。**選択/ホバー時、または任意トグル**で
  表示する段階開示(Link Network の focus+context と同じ思想)。既定の煩雑さを避ける。
- Motion Tier: ラベル出現は Tier A/D、reduced-motion は静的(#30)。

## 決定 2 — IFC クラスを inert から可視・有効な declaration へ(#8)

IFC は完備インフラなのに 2 バッジ止まり。「もっと活用」には 2 段階ある:

**A. 視覚 + 軽い意味(推奨 Phase 2 スコープ)**:
- IFC クラスの `color` で **実 3D メッシュをティント**(基調色)し、決定 1 のラベル/バッジに
  クラスを出す。inert なタグが「見える declaration」になる。
- **所有権の要注意点(#4)**: `cuboidMat.emissive` は `_syncEmissive`(選択/違反/ホバー、
  ADR-068)の専有。IFC ティントは **emissive でなく基調色/専用フラグ**として、emissive
  キューの **下**に合成する **1 つの新 owner メソッド**が書く。IFC から emissive を書かない。
- スコープ境界: 純粋に宣言(分類 → 見た目)。新しい *解法*(IK/干渉/リーチ)を持たない。
  → **in-scope**。

**B. フル産業(ユーザの「産業用にカスタム」が指すかもしれない、後続 ADR 候補)**:
- 編集可能/カスタムなクラスセット、IFC 駆動のグルーピング/フィルタ/分類検証
  (例「Column は Beam に接続すべき」)、クラス別の配置補助。
- **境界の線引き(要慎重・本 ADR で確定しない)**: 分類・フィルタ・**分類の**検証は
  スキーマ/宣言の範疇で in-scope の余地がある。一方、IFC が **幾何解法**(干渉回避・
  自動配置ソルブ)や **曖昧な意味マッピングのレコメンド**を駆動し始めたら
  スコープ外(ADR-056 §3 / grasp-search service の担当)。フル産業をやるなら **専用 ADR**で
  この線を引いてからにする。

**判断(推奨)**: Phase 2 は **A(視覚 + 軽い意味)**で確定。B はユーザが本当に望むなら
**別 ADR(ADR-073 候補)**として、declaration/solving 境界を明示してから着手する。
理由: A は低リスク・完備インフラの自然な活性化・スコープ境界内。「産業用にカスタム」の
具体像(何を custom したいか)が未確定なまま B を実装すると境界を踏み越えやすい。

## Strategy(実装方針 — Accepted 後に着手)

- ラベルヘルパ抽出(`CoordinateFrameView` から純射影/DOM 部分を共有化)→ `MeshView`/
  `ImportedMeshView` に配線。owner メソッド 1 つ、`activeCamera` 使用、#27 サイズ規律。
- CF ラベル情報化(軸/役割/姿勢)+ トークンスタイル。
- IFC ティント: `MeshView` に基調色 owner メソッド追加(emissive 非干渉・#4)。ラベル/
  バッジにクラス名。
- 段階開示(選択/ホバー/トグル)で既定の煩雑さ回避。
- docs: `docs/SCREEN_DESIGN.md`(N パネル/ラベル)、CODE_CONTRACTS(ラベル owner + IFC
  基調色 owner)、必要なら EVENTS(ラベルトグル)、本 ADR を Accepted 化。

## Consequences

- 3D を見ながらエンティティの名前・種別・IFC 分類が読める。IFC が「効いて見える」。
- ラベル/ティントの owner を各 1 メソッドに限定 = #4 の視覚状態単一所有者を維持。
- 契約・schema・DSL 版・BFF 無改変(純クライアント表示層)。B を将来やる場合のみ
  スコープ境界の再検討が要る(別 ADR)。

## Open questions(ユーザ確認 = 本 ADR を Accepted にする条件)

1. **IFC 深度**: A(視覚 + 軽い意味)で確定してよいか。B(フル産業)を望む場合、
   *何を* custom したいか(カスタムクラス? 分類検証? グルーピング?)を教えてほしい —
   それを別 ADR で境界付きに設計する。
2. **ラベル表示の既定**: 常時表示は煩雑になりうるため「選択/ホバー時 + トグル」を推奨。
   常時表示を望むか。
