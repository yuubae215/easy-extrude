# 🏛️ easy-extrude — Core Architecture & Meta Mental Model

Voxel-based 3D modeling app built with Three.js + Vite. Deployed to GitHub Pages.
For project structure, MVC design, and features see `README.md`.

## Constitutional Rules (read before any code change)

1. **DDD Entity Core** — the design center is always the domain entities in
   `src/domain/`. All other layers depend inward; domain depends on nothing.
2. **Pure / Side-Effect Separation** — every function and class must be clearly
   categorised as either a *pure computation* (deterministic, no I/O) or a
   *side-effectful operation* (DOM, Three.js, network, state mutation). Never mix.
3. **MVC coordination** — the Controller is thin; it translates input events
   into Model/Service calls and View updates. Business logic lives in Domain;
   rendering in View.
4. **Concurrency strategy** — distinguish *optimistic* (real-time, non-blocking)
   from *pessimistic* (consistency-critical, blocking) locking before
   implementing any async or high-frequency operation. See `docs/CONCURRENCY.md`.

## Document navigation

Before writing or modifying any code, consult the relevant documents.

| Trigger in prompt | Read first |
|-------------------|-----------|
| philosophy / principles / why we do it this way | `docs/PHILOSOPHY.md` |
| architecture / design / why | `docs/ARCHITECTURE.md`, then `docs/adr/README.md` |
| state machine / mode transition / state | `docs/STATE_TRANSITIONS.md`, ADR-008 |
| StateMachine class / FSM / editorStates / operation state constants / _opState | `src/core/StateMachine.js`, `src/core/editorStates.js`, ADR-039 |
| cache / derived state / lifecycle / UNINIT / STALE / freshness | `docs/STATE_TRANSITIONS.md` § Internal Component State Machines |
| new feature / implementation plan | `docs/ROADMAP.md`, then related ADRs |
| screen / information architecture / UI screens / what shows on screen | `docs/SCREEN_DESIGN.md` |
| layout / dimensions / z-index / responsive / breakpoint / toolbar slots | `docs/LAYOUT_DESIGN.md` |
| Layout API / Layout DSL / compileLayout / LayoutCompiler / scene from CLI or API | ADR-045, `src/layout/LayoutCompiler.js` |
| Context DSL / requirement context / Fact / Decision / OpenQuestion / interval / compileContext | ADR-046, `src/context/`, `examples/factory_context.json` |
| Context demo / uncertainty ghost / Decision approval / StoryBar / Context Inspector | ADR-047, `src/controller/ContextDemoController.js`, `src/view/UncertaintyGhostView.js` |
| Requirement / Conflict / KPI / クライテリア / 許容領域 / 交渉クラスター / 共有設計変数 / Variable | ADR-049, `src/context/RequirementGraph.js`, `examples/cell_conflict_context.json` |
| 領域 Variable / AABB / footprint / フットプリント / 述語エンジン / predicate / no_overlap / reach_covers / swept volume / acceptance check | ADR-049 §8 Phase 3, `src/context/RegionGeometry.js`, `src/context/PredicateEngine.js`, `examples/cell_region_context.json` |
| 領域オーサリング / 双方向ゴースト / 3D authoring widget / ドラッグで衝突解消 / live conflict / RegionAuthoringWidget | ADR-049 §5.2/§8 Phase 3, `src/view/RegionAuthoringWidget.js`, `src/context/ContextEditModel.js`, `src/controller/ContextDemoController.js` (`enterAuthoring`) |
| 衝突マトリックス / 交渉クラスター DAG / 解消順序 / ペルソナ射影 / persona projection / DSM partitioning / actor × variable / conflict matrix / n-ary 承認 / approval gate / approvedRefs / proposed / 合同確定 / approveNegotiationDecision | ADR-049 §5.3/§8 Phase 4, `src/context/PersonaProjection.js`, `src/components/ContextDemo/ConflictMatrix.jsx`, `src/components/ContextDemo/NegotiationClusterView.jsx`, `src/controller/ContextDemoController.js` (`enterNegotiation`, `approveNegotiationDecision`) |
| 許容領域ゴースト / actor 別色分け / region ghost / 共通部分が空 / no-man's-land バンド / persona 色重畳 / projectRegionGhosts / RegionGhostView / enterRegionGhost | ADR-049 §5.3/§8 Phase 4, `src/context/PersonaProjection.js` (`projectRegionGhosts`), `src/view/RegionGhostView.js`, `src/controller/ContextDemoController.js` (`enterRegionGhost`) |
| Link Network / link graph / リンク図 / layered layout / node panel | ADR-048, `src/view/LinkNetworkView.js` |
| 5W1H / NL to code / function mapping / FunctionDescriptor / ExecutionPlan | ADR-044 |
| events / domain events / keyboard / pointer / touch / click | `docs/EVENTS.md` |
| controls / mouse / keyboard / orbit | ADR-003, ADR-006 |
| mode / edit mode / object mode / sketch | ADR-002, ADR-004, ADR-008 |
| object / hierarchy / 1D / 2D / 3D | ADR-005 |
| cuboid / shape / corners / geometry / extrude | ADR-007, ADR-002 |
| SceneModel / domain state / MVC / DDD | `docs/ARCHITECTURE.md` |
| mobile / touch / gesture / pointer / OrbitControls | ADR-023, `docs/code_contracts/interaction.md` |
| mobile toolbar / slot / spacer / UI layout | ADR-024, ADR-042, `docs/code_contracts/ui_layout.md` |
| unified entity transform / mental model / fixed-slot / grab rotate deselect add | ADR-042 |
| entity capability / instanceof / MeasureLine / ImportedMesh / CoordinateFrame | `docs/code_contracts/architecture.md` |
| visual flag / meshview / dispose / memory / Three.js cleanup | `docs/code_contracts/memory_management.md` |
| BFF / sceneStore / database / WebSocket / occt / STEP import | `docs/code_contracts/server_async.md` |
| concurrency / async / locking / isProcessing | `docs/CONCURRENCY.md` |
| validation / process / agent workflow / meta | `.claude/DEVELOPMENT.md` |

**`/adr <topic>`** — slash command to search the ADR index.

Create a new ADR when a design choice is non-obvious or hard to reverse.
Update `docs/adr/README.md` index whenever an ADR is added or superseded.

---

## Design change impact

When a new requirement arrives, update **all** documents marked ✅ below.
Documents marked ⚠️ need review but may not require changes.

| Requirement type | STATE_TRANSITIONS | SCREEN_DESIGN | LAYOUT_DESIGN | EVENTS | ARCHITECTURE | ADR | CODE_CONTRACTS | PHILOSOPHY |
|------------------|:-----------------:|:-------------:|:-------------:|:------:|:------------:|:---:|:--------------:|:----------:|
| **新しいモード / サブステートを追加** | ✅ | ✅ (全エリア) | ✅ (ツールバースロット) | ✅ (keyboard) | ⚠️ | ✅ ADR-008 更新 | ⚠️ §1 | — |
| **既存モードにサブ操作を追加** (grab, measure など) | ✅ (FSM §Formal Spec + `_opState` 遷移テーブル更新必須) | ✅ (ステータスバー・ツールバー行) | ⚠️ (スロット数変化なら ✅) | ✅ (pointer/keyboard 節) | — | ✅ ADR-039 参照 | ⚠️ §2 | — |
| **新しいエンティティ型を追加** (domain entity) | ⚠️ | ✅ (N パネル・アウトライナー行) | — | ✅ (objectAdded など) | ✅ (taxonomy 表) | ✅ 新 ADR | ✅ §1 | ⚠️ (§2 Type contract) |
| **新しい UI 画面 / パネルを追加** | ⚠️ | ✅ (画面 ID 追加) | ✅ (寸法・z-index) | ✅ (UI events 節) | — | ⚠️ | ⚠️ §3 | — |
| **キーボードショートカットを追加 / 変更** | — | ✅ (ステータスバー欄) | — | ✅ (keyboard 表) | — | — | — | — |
| **モバイル操作 / ジェスチャーを追加** | ✅ (touch FSM) | ✅ (モバイル差分表) | ✅ (ツールバースロット) | ✅ (touch 節) | — | ✅ ADR-023/024 更新 | ✅ §2, §3 | ⚠️ (§V Interaction) |
| **レイアウト寸法 / z-index 変更** | — | ⚠️ | ✅ | — | — | — | ✅ §3 | — |
| **新しいドメインイベントを追加** | — | — | — | ✅ (domain events 節) | ⚠️ | ⚠️ ADR-013 | — | — |
| **新しい Undo/Redo コマンドを追加** | — | — | — | ✅ (undo 表) | — | ⚠️ ADR-022 | ✅ §1 | — |
| **BFF API / WebSocket エンドポイント追加** | — | — | — | ⚠️ (wsConnected など) | ⚠️ | ✅ ADR-015/017 | ✅ §3.5 | — |
| **バグ修正** | ⚠️ | ⚠️ | ⚠️ | ⚠️ | — | — | ✅ (下記ルール参照) | ⚠️ (下記ルール参照) |

> **PHILOSOPHY column rule**: mark ⚠️ only when the same root value has been
> violated in **two or more unrelated contexts**. A single bug → CODE_CONTRACTS.
> A recurring pattern across contexts → extract or update a PHILOSOPHY principle.

### 更新チェックリスト (コードを書く前に実行)

```
1. 上の表で ✅ の列を確認
2. 各ドキュメントの対象セクションを読む (Document navigation 表を参照)
3. 非自明な設計選択 → 新 ADR を作成、docs/adr/README.md インデックスを更新
4. コード変更後 → ✅ ドキュメントを更新してから commit
```

---

## After fixing a bug

After every bug fix, **before committing**, ask these two questions in order:

**Q1 — Rule missing?**
> "Did this bug exist because an implicit rule was missing or misunderstood?"

If yes → add the rule to the relevant `docs/code_contracts/*.md` detail file,
then update the summary row in `docs/CODE_CONTRACTS.md` index.
Use the criteria in CODE_CONTRACTS's "What belongs here" section.
When in doubt, add it — stale entries are easier to clean up than missing ones.

**Q2 — Pattern repeating?**
> "Have we violated the same *underlying value* in two or more unrelated places?"

If yes → this signals a missing or under-specified principle in `docs/PHILOSOPHY.md`.
Either add a new principle or sharpen an existing one. Link it to the CODE_CONTRACTS
rules it underlies. See PHILOSOPHY's "When to update" table for exact triggers.

If **almost** (same value, but only 1 context so far) → add a row to the
**Yellow Cards** table in `docs/PHILOSOPHY.md`. A Yellow Card is a first strike:
it records the candidate principle and its first context so it can be found
when the second violation surfaces. Without this, single-context patterns are
forgotten and PHILOSOPHY never grows.

## Development commands

```bash
pnpm install   # install dependencies
pnpm dev       # dev server → http://localhost:5173
pnpm build     # production build → dist/
pnpm preview   # preview production build
```

## World coordinate system

**ROS world frame** (+X forward, +Y left, +Z up). Right-handed. Matches ROS REP-103.
Three.js `camera.up = (0,0,1)`. XY plane (Z=0) is the ground plane.

@docs/CODE_CONTRACTS.md

@docs/CLAUDE_FABLE5_BEHAVIOR.md

## Notes for changes

- `vite.config.js` `base` must match the repo name (`/easy-extrude/`)
- Three.js addons must be imported from `three/addons/...`

@docs/PHILOSOPHY.md

## Session history

Full log → `docs/SESSION_LOG.md`

- **2026-06-14** (4): Review/Feature — ADR-049 **再レビュー + §5.3 最終項目実装(Phase 4 完了)**。レビュー: Phases 1–4 が Accepted・90/90 通過を再確認、純粋層(`RequirementGraph`/`RegionGeometry`/`PredicateEngine`/`AdmissiblePromotion`/`PersonaProjection`)が `THREE`/DOM 非依存・入力不変・bare `node --test` 可を再検証。唯一の残課題 = ADR 自身の「次回送り」§5.3 **actor 別色分け許容領域ゴースト重畳**。**Slice A(純粋 `PersonaProjection.projectRegionGhosts`)**: 領域 Variable(`v.region`)について単一変数領域要求を actor ごとに集め、admissible ボックス群の共通部分を `RegionGeometry.intersectBoxes`(R6 と同一の半開・軸ごとロジックの単一の真実)で算出 — `intersection.empty`/`emptyAxes`/`gap` が R6 領域衝突結果そのもの。`state` はマトリックスと同型(`conflict`/`proposed`/`resolved`/`satisfied`、`approvedRefs` ゲート)。`ctx.actors` 順に regions をソートし決定的パレットインデックスを保証(色はビュー、純粋層は hex を持たない)。入力不変。**Slice B(読取専用ビュー + コントローラ)**: `RegionGhostView`(§5.2 の編集可 `RegionAuthoringWidget` = **入力**射影に対し ADR-047 ゴースト系譜の **出力**射影 = persona 色・読取専用)。各 actor フットプリントを persona 色半透明フィル+エッジで重畳、共通部分が非空→明るい「合意領域」(公称値ラベル)、空→束縛軸 gap を赤バンド+「✕ 共通部分なし=衝突」。`ContextDemoController.enterRegionGhost()` が `cell_region_context` を読み(authoring 同様シーン置換+zone 非表示)、**衝突マトリックス併置**(`demoSetMatrix`)し actor 列の `personaFilter` を `tick()` で 3D ゴースト dimming へミラー(2D グリッドと 3D 重畳が 1 つのペルソナ射影、`_ghostFilter` 最終値ガード)。ヘッダー「ゴースト」ボタン(PC+More)。`exit()` でゴースト dispose(PHILOSOPHY #4/#9)。テスト **94/94**(`projectRegionGhosts` 4 件追加)、`tsc --noEmit`・`vite build` クリーン。Docs: ADR-049 §8/Updated(Phase 4 完了)+ CLAUDE.md ナビ + CODE_CONTRACTS(PersonaProjection 行拡張)+ SCREEN_DESIGN [L] + EVENTS。**Phase 4 完了 — ADR-049 全フェーズ実装済**。
- **2026-06-14** (3): Review/Fix — ADR-049 **設計・実装レビュー** (adr-validate + code-review)。レビュー実施: RequirementGraph, PersonaProjection, RegionGeometry, PredicateEngine, AdmissiblePromotion, ContextValidator, ContextEditModel, ContextDemoController, ConflictMatrix.jsx, NegotiationClusterView.jsx, RegionAuthoringWidget.js の 13 ファイルを ADR-046/047/049 + PHILOSOPHY #3/#6/#11/#26 に対して検証。**結果**: violations 0 件、gap 1 件（承認状態の所有権がドキュメントに非明示）。**修正 2 件**: ① ADR-049 ステータスを `Draft (Proposed)` → `Accepted` へ昇格（本文 + README index — Phase 4 完了・90/90 テスト・`vite build` 通過済で "Draft" 継続は実態と乖離）。② `NegotiationClusterView` ボトムセクション（生クラスターリスト）に `personaFilter` 適用 — DAG セクションは `dim` していたが底部は未適用で、actor 列クリック時に片方だけ薄くなる不一致を解消。テスト 90/90 継続。**次回送り**: §5.3 の 3D actor 別色分け許容領域ゴースト重畳（ADR-049 本文に明記済）。
- **2026-06-14** (2): Feature — ADR-049 **Phase 4 n-ary Decision 承認インタラクション**（§8 Phase 4 次回送りの 1 つを実装、残るは 3D ゴースト重畳のみ）。**問題**: 交渉ビューは射影を 1 回だけ読取専用表示し、`validateContext` が承認と無関係に `resolvedBy` を立てるため開いた瞬間に全件 `resolved` 表示 → 不変条件8「解消順序を辿って単一→n-ary 合同 Decision を順に承認」の体験が出ない。**Slice A（純粋 `PersonaProjection.js`）**: 両射影に opt-in 第3引数 `{ approvedRefs:Set }` + 内部ヘルパー `resolutionState`。新セル状態 **`proposed`**（解消 Decision 提案済・未承認＝◐琥珀）を追加、承認済のみ `resolved`（✓緑）。**`approvedRefs` 省略時は従来どおり `resolvedBy`→`resolved`（後方互換の継ぎ目 — ストーリー/オーサリング呼び出し非破壊）**。`projectResolutionOrder` 各 step に additive `approved` フラグ。**Slice B**: `ContextDemoController.approveNegotiationDecision(ref)` が唯一の承認経路 — `demoApproveDecision`→`approvedRefs` 再構築→**再検証せず**キャッシュ `_negCtx`/`_negResult` で再射影（Decision 集合が変化、要求グラフは不変）+ 公称値 toast。`_startNegotiation` は `approvedRefs:空Set` で初期射影（全件 proposed で開く）。`NegotiationClusterView` に解消順序 DAG を辿る承認ボタン（single=「確定」/n-ary=「合同確定」）、**n-ary は上流の単一衝突が全承認のときのみ有効**（無効時「← 先に X を確定」、不変条件8）+ 全承認バナー。`ConflictMatrix` に `proposed`◐ セル + サマリ 3 状態バッジ。**モバイル対応（ユーザー要件）**: 交渉ビューは 3D 非依存データオーバーレイなので `ContextInspector` の `<768px` return null を `demo.conflictMatrix` 存在時のみ解除し全幅表示（PHILOSOPHY #26 一過性オーバーレイ）、Matrix/Cluster タブバッジを未承認数に。テスト 90/90（承認ゲート 5 件追加）、`tsc --noEmit`・`vite build` クリーン。Docs: ADR-049 §8/Updated + CODE_CONTRACTS（PersonaProjection 行拡張）+ SCREEN_DESIGN/EVENTS + CLAUDE.md ナビ。
- **2026-06-14**: Feature — ADR-049 **Phase 4 可視化**（ペルソナ射影 UI、n-ary 承認は次回送り）。**Slice A（純粋計算 `PersonaProjection.js`、`three` 非依存・入力不変 #6）**: ① `projectConflictMatrix(ctx, validatorResult)` — actor × variable グリッド。セル状態 `none|satisfied|conflict|resolved`（R6 `between` 参加の**未解決**衝突のみ `conflict`、Decision 解消済は `resolved`、多変数結合 `constrains.length≥2` は `between` に出ない＝`coupled` フラグ付き `satisfied`）+ 変数ごと `variableSummary`（gap/between/resolvedBy/actors）。② `projectResolutionOrder(ctx, validatorResult)` — DSM partitioning: クラスター縮約→DAG→決定的トポロジカルソート（Kahn、ready-set ref 昇順）。単一変数衝突は leaf、結合クラスターは自変数の衝突を `dependsOn`（D2 マージしない）。**実装中の気づき**: 正準 `cell_conflict_context` は両衝突とも Decision で解消済 → `resolved` 状態を追加（生 `detectConflicts` でなく `validateContext` の resolvedBy を読む点を CODE_CONTRACTS 追加）。**Slice B（UI 読取専用）**: uiStore demo に `conflictMatrix`/`negotiationClusters`/`resolutionOrder`/`personaFilter` + `demoSetMatrix`/`demoSetPersonaFilter`。`ContextDemoController.enterNegotiation()`（データのみオーバーレイ D3 — シーン非置換）。Context Inspector に **Matrix/Cluster タブ**追加（新エッジパネルを増やさず #26）、`ConflictMatrix.jsx`/`NegotiationClusterView.jsx` 新設、`Row`/`Badge`/`Ref` を Inspector から export。actor 列クリックでペルソナ射影（純粋 uiStore 状態 D4）。ヘッダー「交渉」ボタン（PC + More）。テスト 85/85（Phase4 13 件追加）、`vite build` 成功・`tsc --noEmit` クリーン。Docs: ADR-049 §8 + README + CODE_CONTRACTS + SCREEN_DESIGN/EVENTS + CLAUDE.md ナビ。
- **2026-06-13** (3): Feature — ADR-049 **Phase 3**（領域 Variable・近似述語・3D 双方向オーサリング）。**Slice A（純粋計算、`three` 非依存）**: `RegionGeometry.js`（AABB 区間/ボックス交差、半開判定 `intersectIntervals` を軸ごとに再利用、**Helly-2D 注意**: AABB のみ軸独立分解可・凸ポリゴンは R0' 却下）+ `PredicateEngine.js`（`no_overlap`/`reach_covers`/`swept_volume`、`{pass,violations}`、不正のみ `MalformedPredicate`）。R6 を領域へ拡張（空軸 1 つ以上で衝突、`gap` はスカラー `[hi,lo]` 配列・領域 `{axis:[hi,lo]}` マップ、混在バケットは skip）。R0' 領域形状検査 + R5 が非ブロック時に述語評価 → `checkResults` に `pass|fail|blocked`（全 return パス additive、ADR-046 §4.2 の述語エンジン実装済）。context/0.3、`examples/cell_region_context.json`。**Slice B（§5.2 双方向）**: `ContextEditModel.applyAdmissibleEdit`（純粋・新 ctx 書き戻し #6）+ `RegionAuthoringWidget.js`（地面 AABB をコーナー/中心ハンドルでドラッグ、緑↔赤）+ `ContextDemoController.enterAuthoring()`（ドラッグ毎に `applyAdmissibleEdit→validateContext` ライブ実行・R6 再着色・Inspector Conflict タブ）。AppController が authoring 時 pointer を `onAuthor*` へ委譲（ハンドルヒット時のみ消費）、契約はテキスト DSL のまま（invariant 9）。テスト 72/72、`vite build` 成功。Docs: ADR-049/ADR-046 + README + CODE_CONTRACTS ×4 + SCREEN_DESIGN/EVENTS + CLAUDE.md ナビ ×2。
- **2026-06-13** (2): Feature — ADR-049 **Phase 2**（純粋計算 3 モジュール、`src/context/` 内）。① `AdmissiblePromotion.js` — `stated→derived` 昇格: 閉形・単調な `kpi.expr` を制約変数 `domain` 上でクライテリア逆像（サンプリング + 二分法）し interval を導出、新 Map を返し入力不変（PHILOSOPHY #6）。不透明関数呼び出し/非単調/空集合は昇格せず原型を返す（R9 が支配）。**実バグ**: 評価器が遅延のため `NotPromotable` は `invertCriterion` 内で送出 → try/catch がコンパイル段だけを囲い Phase 1 全衝突テスト 18 件が throw → `compileMonotoneExpr`+`invertCriterion` 両方を囲み `return null`（CODE_CONTRACTS 追加）。② `RoleKpiCatalog.js` — discipline→必須 KPI のカタログ、Actor に additive `discipline` 追加、R8 を Validator 実装（欠落で `oq_rolekpi_*`、`ctx.kpiCatalog` 上書き可）。③ `FormProjection.js` — 未充足 OpenQuestion を質問へ射影、全問回答 = `projectForm()` が `[]`。Validator 順序確定（R0'→昇格→R6/R7/R9/R8、戻り値に `promoted[]`）。`examples/cell_phase2_context.json` + `ContextPhase2.test.js` 16 件、計 48/48。
- **2026-06-13**: Feature — ADR-049 Requirement / Conflict モデル + Phase 1 実装（context/0.2）。設計討議から ADR-049 起草: 要求 = (KPI, クライテリア)・許容領域は導出値（invariant 6）、Conflict / NegotiationCluster はバリデータが吐く（invariant 7）、交渉クラスターは単一 n-ary Decision で同時確定（invariant 8、循環はエラーでなく処方）、契約の正準形はテキスト DSL・3D スケッチは入力デバイス兼 evidence（invariant 9）。実装: `RequirementGraph.js` 新設 — R6 衝突検出（変数ごと interval 交差、半開規約、1 次元 Helly 性）+ R7 交渉クラスター（二部グラフの Hopcroft–Tarjan 双連結成分、橋は除外）；Validator に R0'/R9 + Decision 拡張検証（`resolves: conflict_*` 参照整合・`relaxes`・n-ary `nominals{}`）+ `resolvedBy` マーキング；`SUPPORTED_VERSIONS` で 0.1 後方互換（additive）。正準シナリオ `examples/cell_conflict_context.json`（WD 衝突 gap [350,380] + 4-サイクルクラスター + R9 発火）。テスト 32/32（新規 20）。