# ADR-051 — 要件入力（Requirement Intake）: あいまい要件を起点化する複数入口アーキテクチャ

**Status**: Accepted (Phase 1 実装済 — Phase 2/3/4 未実装)
**Date**: 2026-06-16
**Related**: ADR-052 (5W1H ユビキタス言語 — 土台), ADR-050 (Context-First Project Model), ADR-049 (Requirement/Conflict モデル), ADR-047 (Context Demo Layer), ADR-046 (Context DSL), ADR-044 (5W1H Function Mapping), ADR-022 (Undo/Redo), ADR-013 (Domain Events)
**Implementation**: 段階導入（§6）。Phase 1 完了 (2026-06-16):
- `src/context/DocBuilder.js` — `createBlankDoc` / `addActor` / `addFact` / `addVariable` / `addRequirement`（純粋、入力不変）
- `src/command/AddDocEntryCommand.js` — `createAddDocEntryCommand`（before/after スナップショット、undo 可）
- `src/components/Context/IntakePanel.jsx` — Actor/Variable/Requirement 直接追加ウィジェット（ContextLayer の 'intake' タブ）
- `src/service/ContextService.js` — `adoptDoc()` メソッド追加（blank doc 用 — compile/layout スキップ、scene クリア）
- `src/controller/ContextController.js` — `newContext()` / `addDocEntry()` / `onNewContext`・`onAddDocEntry` コールバック
- `src/components/Header/Header.jsx` — Context ▾ に「New Context」追加（PC + mobile ⋯）
- `src/store/uiStore.js` — `context.variables` フィールド + `contextSetActors` / `contextSetVars` アクション
- Phase 2 (テンプレートギャラリー) / Phase 3 (3D ゴースト即時プレビュー) / Phase 4 (NL インテーク) 未実装。

---

## 1. Context — 「あいまい要件を入れる」入口が存在しない

ADR-050 で context ドキュメントを正準アーティファクト化し、シーンを導出射影とする本番モデルを確立した。
しかし**要件を最初にシステムへ入れる経路**は 2 つしかない:

1. **外部で `.ctx.json` を手書き → インポート**（`ContextController.importContextFile`）。
   あいまいさは Fact の `interval:[lo,hi]` + `status:"unknown"/"assumed"` で表現し、`Decision` が公称値に
   確定する（ADR-046 不変条件2）。だが doc を書くのはアプリ外のテキストエディタ作業。
2. **バリデータ駆動のリアクティブなフォーム回答**（ADR-050 Phase 4）。`validateContext` が出した
   `OpenQuestion` を `FormPanel` が answerKind 別ウィジェットで埋めるが、これは**既に読み込まれた doc が
   足りない項目を聞き返す**仕組みで、ゼロから要件を起こす入口ではない。

探索で確認した構造的ギャップ:

- **ブランクからの起点が無い。** 空のプロジェクトに最初の Fact / Decision / OpenQuestion を入れる UI が無い。
- **発話→要件の橋が production に無い。** ADR-044（5W1H NL→code）は Draft のまま、context への接続も未配線。
- **デモは入口に見えるが起点ではない。** `ContextDemoController` は `examples/*.json` を静的 import し
  `importFromJson({clear:true})` でシーンごと差し替えるだけ（入口ごとに読む例が異なり混乱を招く — §7）。

このリポジトリの使命は**あいまい要件の入力を良い体験にすること**である。要件捕捉（上流）が JSON 手書きに
依存している限り、下流の検証・交渉がいくら洗練されても価値が届かない。

## 2. Decision — 入口は複数あってよい。ただし全入口は唯一の権威経路に集約し、優先順位を本 ADR が定める

このアプリは**さまざまなドメイン**（工場セル、都市、設備…）へのサービスたりうる。ドメインごとに
自然な要件の入れ方は異なる（発話、表計算、テンプレート、3D 直接操作）。よって**入口を 1 つに絞らない**。

> 要件入力の表層 UI は複数あってよい。だが**すべての入口は唯一の権威入口
> `ContextService.loadContext` / `applyContextDoc`（PHILOSOPHY #1）を通じて正準 doc を生む**。
> 入口は doc を組み立てる手段にすぎず、新しい権威経路・新しい成果物を増やさない
> （ADR-050 §2/§5「doc が唯一の成果物」と一貫）。

あいまいさの表現は既存を踏襲する（新概念を作らない）: Fact の `interval` + `status`、確定は `Decision`、
3D 可視化は `UncertaintyGhostView`（入力デバイス、ADR-049 不変条件9）。入口が増えても**ドメインモデルと
正準形は不変**。

### 2.0 Why ファースト（ADR-052 の直接の帰結）

正準 doc は **Why（KPI / クライテリアと実測の Gap / 及第点の達成）をルートにした 5W1H ツリー**である
（ADR-052 §2.1）。したがって全入口は **Why を先に捕捉し、幾何（What/How）は導出する**よう doc を
組み立てる。特に入口 A（ブランクフォーム）と C（NL インテーク）は、最初に「何を、どのクライテリアで、
どれだけの Gap を許して達成するか」を問う導線にする。これにより NL 文脈と doc が同義語商上で Mutual に
保たれ（ADR-052 §2.2）、入力した要件の来歴がデータから機械的に復元可能になる。

### 2.1 採択した代替案と棄却した代替案

| 代替案 | 採否 | 理由 |
|---|---|---|
| **複数入口 → 単一権威経路に集約**（本決定） | ✅ 採択 | ドメイン多様性に対応しつつ正準が 1 つ。各入口は薄い doc ビルダー |
| 入口を 1 つ（例: NL のみ）に標準化 | ❌ 棄却 | ドメインにより最適入口が異なる。早すぎる固定化 |
| 各入口が独自の中間表現を持つ | ❌ 棄却 | 正準が複数化し ADR-050 の導出関係（doc→scene）を壊す |

## 3. 入口カタログ（4 種、すべて additive・既存資産を再利用）

| 入口 | 何を生むか | 再利用する既存資産 | 新規 |
|---|---|---|---|
| **A. ブランク状態フォーム作成** | 空 doc に Fact / Decision / OpenQuestion を直接追加 | `FormApplication.applyQuestionAnswer`, `FormPanel.jsx`, `AnswerQuestionCommand`, `ContextService.applyContextDoc` | 「新規 context」起動 + 追加用ウィジェット |
| **B. テンプレートギャラリー** | スターター `.ctx.json` を起点化（単一アクター / 多者衝突 / 領域…） | `ContextController.importContextFile`, `examples/*.ctx.json` | ギャラリー UI + starter 群 |
| **C. 自然言語インテーク** | 発話 → Fact + `interval` + `status:unknown` | ADR-044 (5W1H), `ContextService.applyContextDoc` | 抽出ブリッジ（NL→doc 断片） |
| **D. 3D ゴースト即時プレビュー強化** | 入力中の不確実区間を即時可視化、Decision 確定で収束 | `UncertaintyGhostView`, `ContextController` | 入力中ライブ駆動 |

いずれも doc を組み立てて `applyContextDoc` / `loadContext` に渡す薄い層に徹する。コマンド化（ADR-022）で
入力はアンドゥ可能（`AnswerQuestionCommand` 系譜、入力不変 doc スナップショット PHILOSOPHY #6）。

## 4. 優先順位（本 ADR が定める — リスク昇順 × 体験価値）

1. **A. ブランク状態フォーム作成** — 既存純粋層＋コマンドの拡張のみ。THREE-free テスト可。最小リスクで
   「ゼロから入れられる」ギャップを直接埋める。
2. **B. テンプレートギャラリー** — import 経路の薄い拡張。オンボーディングを高速化。
3. **D. 3D ゴースト即時プレビュー強化** — 既存 View の駆動拡張。入力と結果の因果を体験化。
4. **C. 自然言語インテーク** — 体験価値は最大だが抽出器（ADR-044 連携）を要し最もリスクが高い。基盤
   （A/B）の上に載せる。

優先順位は「価値が低い」順ではなく「依存・リスク」順。C は最重要だが A/B の正準経路が固まってから載せる。

## 5. 純粋/副作用の分離（PHILOSOPHY #3）

- doc 断片生成（NL 抽出、フォーム→doc 適用、テンプレート選択→doc）は**純粋関数**として `src/context/` 配下に置き、
  THREE/DOM 非依存・入力不変・bare `node --test` 可とする（`FormApplication` と同型）。
- シーン再生成・ファイル I/O・3D ゴースト描画は `ContextService` / `ContextController` / View の**副作用**側。

## 6. 段階導入（各フェーズ独立にテスト可能）

- **Phase 1**: 入口 A（ブランクフォーム作成）。空 doc 起動 + Fact/Decision/OpenQuestion 追加ウィジェット +
  純粋 doc-builder + コマンド。THREE-free 単体テスト。
- **Phase 2**: 入口 B（テンプレートギャラリー）。starter `.ctx.json` 群 + 選択 UI。
- **Phase 3**: 入口 D（3D ゴースト即時プレビュー）。入力中ライブ駆動。
- **Phase 4**: 入口 C（NL インテーク）。ADR-044 抽出ブリッジを context へ配線。

## 7. デモ/初期シーン挙動の透明化（本 ADR の付随決定）

ユーザー観察「初期キューブしかないのにデモがカメラ精度データを生成する」は誤解で、実際は入口ごとに
**別の例 JSON を読みシーンを差し替える**挙動である（Tutorial=`factory_context.json` カメラ無し / 交渉設計・
領域オーサリング=`cell_conflict_context.json`・`cell_region_context.json` カメラ要件あり）。

**決定**: どの入口がどの例を読み、シーンを差し替えるかを UI で明示する（確認ダイアログに「現在のシーンを
差し替えます／読み込む例: …」を表示）。データは現シーンから派生しない旨を体験として明確化する。文言の
実装は ADR-047（Context Demo Layer）側に追記。

## 8. Consequences

### Positive
- あいまい要件の捕捉が JSON 手書きから解放され、ドメインに応じた入口を選べる。
- 入口が増えても正準 doc は 1 つ（ADR-050 の導出関係を維持）。トレーサビリティ・diff・署名は不変。
- 既存純粋層・コマンド・View の再利用が大きく、追加は薄い層に閉じる。

### Negative / Trade-offs
- 入口 UI が増えるとヘッダー/メニューの情報量が増える（Context ▾ の整理が必要）。
- NL インテーク（C）は抽出の曖昧性・誤抽出のリスクを伴う。Fact を `status:unknown` で保守的に出し、
  確定は必ず Decision を介す（silent な区間潰しを禁ずる、ADR-046 不変条件2 / PHILOSOPHY #11）。

## 9. Design change impact（CLAUDE.md 表に従う更新対象）

新 UI 画面/パネル追加に該当 → SCREEN_DESIGN（入口画面 ID）、LAYOUT_DESIGN（寸法・z-index）、EVENTS
（入力 UI callbacks）、CODE_CONTRACTS（doc-builder 純粋層・新コマンド）を実装フェーズで更新。本 ADR 段階では
README index・CLAUDE.md ナビ・関連 ADR の References のみ同期。
