# ADR-047 — Context Demo Layer: 要求文脈の可視化オーバーレイ

**Status**: Accepted
**Date**: 2026-06-11
**Related**: ADR-046 (Context DSL), ADR-045 (External Layout API), ADR-040 (Solid Primary Triple), ADR-041 (RippleEffect 前例), ADR-037 (Origin CF), ADR-050 (Context-First 本番機能化 — demo→production 分離), ADR-051 (要件入力 — デモ挙動の透明化)

> **注記 (2026-06-16, ADR-051 §7)** — 各入口（Tutorial / 交渉設計 / 領域オーサリング）は
> **別の例 JSON を読みシーンを `importFromJson({clear:true})` で差し替える**（Tutorial=`factory_context.json`
> カメラ無し、本番フロー=`cell_conflict_context.json`/`cell_region_context.json` カメラ要件あり）。
> データは現シーン（初期キューブ等）から派生しない。確認ダイアログに「現在のシーンを差し替えます／
> 読み込む例: …」を表示し、入口ごとの読み込み対象を明示すること。
**Implementation**: `src/controller/ContextDemoController.js`, `src/view/UncertaintyGhostView.js`, `src/components/ContextDemo/`, `uiStore` demo slice

---

## 1. Context

ADR-046 の Context DSL MVP は純粋コンパイル層としてゴールデンテストで実現可能性を示したが、CLI/テストでしか動かず価値が伝わらない。核心価値は2点:

1. **区間は Decision でしか潰せない**(invariant 2)— 「3m弱」が [2700, 3000] mm のまま保持され、確定は明示的な承認行為として記録される
2. **トレーサビリティは機械検証される**(invariant 1, 4)— OpenQuestion / blockedChecks はバリデータが生成し、全仕様要素は要求に遡れる

これを 3D ビューポートで体感させるデモが必要。対象は非エンジニア(ストーリー演出)とエンジニア(詳細パネル)の両方。

## 2. Decision

### 2.1 デモは FSM の新モードではなく「通常シーン上のオーバーレイ」

`ContextDemoController.enter()` は本物の二段コンパイルチェーン
(`compileContext → compileLayout → importFromJson({clear:true})`)で通常のシーンをロードし、
エンティティ/リンクの**可視性だけ**をストーリーステップに従ってステージングする。

- `_opState` / `setMode()` に新状態を追加しない。オービット・選択・G ドラッグは demo 中もすべて生きる
  (ステップ⑤で robot をドラッグすると fastened ガードレールが実際に発火する — 制約が本物である証明)
- `exit()` は可視性を全復元するだけ。シーンはそのまま編集可能な通常シーンとして残る
  (復元ロジック不要 = 「通常編集を壊さない」を構造で満たす)
- デモロードは `commandStack.clear()` で undo 履歴から除外(コンストラクタの初期 Solid と同じ契約)

### 2.2 ストーリーステップ(6段、宣言的テーブル)

| # | タイトル | 3D | Inspector タブ |
|---|---------|----|---------------|
| 0 | ①顧客発話 | 空グリッド | 閉 |
| 1 | ②Fact化 | outlet 点 + cell zone + **不確実性ゴースト** | Given |
| 2 | ③OpenQuestions | 変化なし | OpenQuestions |
| 3 | ④Decision承認 | DecisionCard。承認 → ゴースト収束 → workbench 出現 | Decisions |
| 4 | ⑤コンパイル | base_plate→robot→containers の staggered reveal + links | Trace |
| 5 | ⑥Acceptance | フルシーン | Acceptance |

**ステップ③→④は承認をゲートに Next を disable**(StoryBar)し、コントローラ側でも二重ガード
+ 警告トースト(PHILOSOPHY #11)。「区間は silent に潰せない」を UI 構造で表現する。

### 2.3 UncertaintyGhostView — 区間の3D表現

decision 由来の位置軸を持つ Solid を、区間掃引体積の半透明アンバーバンド + 両端ワイヤーフレーム
+ HTML ラベル(`2700–3000 mm · 未確定`)で表示する。承認時に公称値へ収束するアニメーション
(0.8s cubic ease + 0.25s fade)を再生し、収束完了時点で実 Solid を表示する。

- ライフサイクルは `RippleEffect` と同型: constructor add / `tick(t)` / 所有者が dispose(PHILOSOPHY #9)
- 所有者は `ContextDemoController` のみ(PHILOSOPHY #4)
- マテリアルは `depthTest: true, depthWrite: false`(Annotation depthTest 契約)
- 両端枠は `LineSegments + EdgesGeometry`(BoxHelper は契約で禁止)
- HTML ラベルは `SceneView.activeCamera` で投影(HTML Overlay Active Camera 契約)

### 2.4 provenance は純粋コンパイラ出力

「どのエンティティのどの軸が decision 由来で、元の区間は何か」は UI が推測するのではなく、
`compileContext()` の戻り値に追加した `provenance[]`(`extractProvenance(ctx)`、read-only walk)
が唯一の情報源。ゴーストはこのレコードから構築される。
golden テストはキー追加に影響されない(additive)。

### 2.5 ref → scene id 解決は LayoutCompiler の export

`buildRefMap()` / `linkIdForConstraint()` を export し、trace の `to`
(エンティティ ref / `constraint:src→tgt`)をライブシーンの entity id / link id に解決する。
`importFromJson({clear:true})` は元 ID を保持するため、コンパイル時の ID 規約がそのまま生きる。
ID 規約を UI 側で複製しない。

### 2.6 Decision 承認は MVP では UI 状態のみ

シーンは最初から nominal でコンパイル済みであり、承認はゴーストの解放 +
`approvedDecisions[ref]=true`(uiStore)のみ。ドメインの Decision ライフサイクル
(proposed → agreed → signed、baseline diff)は ADR-046 §8 の Phase 2 スコープ。

### 2.7 エントリポイント

1. ヘッダー **Demo** ボタン(デスクトップ)/ MoreMenu 項目(モバイル)
2. `window.__easyExtrude.demoContext()`
3. `?demo=context` URL パラメータ

3経路とも `ContextDemoController.enter()` に合流。シーン置換前に confirm modal を出す。

## 3. 発見されたバグ(同コミットで修正)

`compileLayout()` は Solid を v1.3 primary triple(`position`/`orientation`/`localCorners`、
`vertices` なし)で出力するが、`importFromJson` 経由の `SceneService._reconstructEntity()` は
`dto.vertices` を無条件参照しており全 Solid が silent skip されていた(BFF 経由の
`_deserializeEntities` のみ対応済みだった)。ADR-045 の「importFromJson でロード可能」は
Solid について偽だった。`_deserializeEntities` をミラーする v1.3 branch を追加して修正。
→ CODE_CONTRACTS「importFromJson Solid v1.3 Coverage」

## 4. Rejected Alternatives

- **デモ専用 FSM モード** — `_opState` への状態追加はすべての操作ガードに波及する。可視性オーバーレイなら既存操作が全部そのまま動き、「制約が本物」をデモ自体が証明できる。
- **シーンを 1/1000 スケールでロード**(mm→m)— golden データと乖離し「コンパイル結果がそのまま出ている」という説得力を失う。grid との見た目の不整合は許容。
- **ステップごとに部分ロード** — `importFromJson` は clear/merge の2モードしかなく、部分ロードは ID 再配布と Origin CF 移行を複雑化する。一括ロード + 可視性ステージングが単純。
- **ゴーストを複数インスタンスのゴースト Solid で表現** — 掃引体積バンド1個+両端枠の方が「区間」のメンタルモデルに直結し、リソースも軽い。

## 5. 次の一手

1. Decision 承認をドメインイベント化し、ADR-046 Phase 2 の Decision ライフサイクルに接続
2. acceptance static 述語(`footprint_within` 等)の実行エンジンと結果の live 表示
3. 任意の context/0.1 ファイルをドロップしてデモ化(現状は `examples/factory_context.json` 固定)
4. モバイル対応(現状 Inspector は <768px 非表示、StoryBar/DecisionCard は表示のみ対応)
