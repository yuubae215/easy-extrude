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
| Context-first project / 正準 context doc / シーンは導出射影 / loadContext / 承認=doc 変異 / ContextService / contextLoaded / .ctx.json / 本番機能化 / PoC → production | ADR-050, `src/service/ContextService.js`, `src/service/ContextService.test.js` |
| 本番 Negotiation / ContextController / 交渉設計(本番)/ context スライス / アンドゥ可能な承認 / ApproveDecisionCommand / Context ▾ メニュー / ContextLayer / prop 駆動 Matrix・Cluster | ADR-050 §4/§6 Phase 2, `src/controller/ContextController.js`, `src/command/ApproveDecisionCommand.js`, `src/components/Context/ContextLayer.jsx` |
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

- **2026-06-16**: Feature — ADR-050 **Phase 2**（本番 Negotiation・データのみ・最低リスク）。新設 `src/controller/ContextController.js` — `ContextService` を消費する永続オーバーレイコーディネータ（`MapModeController` 同様、`setMode` FSM 状態ではない — §4.2/ADR-047 §2.1：orbit/select/grab を生かす）。`enterNegotiation()` は loaded doc で動作（Phase 2 は同梱 `cell_conflict_context.json` を `loadContext` でブートストラップ、実 `.ctx.json` import は Phase 4）し、衝突マトリックス + 解消順序を永続 `context` uiStore スライス（§4.3、`demo` と並列・新ペイロードで自動リセットしない）へ射影。**承認は新設 `createApproveDecisionCommand`（`src/command/ApproveDecisionCommand.js`）経由で単一 CommandStack 上でアンドゥ可能**（§3.5）: `execute`=`ctxService.approveDecision`（doc 変異 `proposed→agreed`）、`undo`=`unapproveDecision`。承認は doc 変異（§3.2）でジオメトリ不変のため再生成なし。コントローラは `ContextService.contextChanged` を購読し**そこから再射影**するため、承認/undo/redo がすべて同一経路で再射影される（PHILOSOPHY #5、ガード返り inline なし）。`ConflictMatrix`/`NegotiationClusterView` を **prop 駆動化**（§4.4、`{matrix,filter,onSetFilter}`/`{order,clusters,filter,onApprove}` — スライス非依存）し、demo（`demo` スライス）と新 `src/components/Context/ContextLayer.jsx`（`context` スライス、3D 非依存なのでモバイル全幅 — PHILOSOPHY #26）の双方が同一 presentational を再利用。Header の 4 デモボタンを単一「Context ▾」ドロップダウン（`交渉設計` 本番 + `Tutorial`/`Author`/`Region Ghosts` demo）へ集約（PC + モバイル ⋯ メニュー）。`ApproveDecisionCommand.test.js` 4 件（fake `sceneService` で **THREE-free** — execute 承認/undo 反転/ジオメトリ不変/redo round-trip）、計 **110/110**、`tsc --noEmit`・`vite build` クリーン。demo (`ContextDemoController`) は無改変。Docs: ADR-050 進捗注記 + CLAUDE.md ナビ/履歴 + CODE_CONTRACTS（ContextController 行）+ EVENTS（本番 context UI callbacks）+ SCREEN_DESIGN + LAYOUT_DESIGN。残: Phase 3–5。
- **2026-06-15**: Feature — ADR-050 **Phase 1**（Context-first 本番化の基盤、UI 無変更）。`src/service/ContextService.js` 新設 — 正準 Context DSL doc を所有し `compileContext→compileLayout→importFromJson` 連鎖でシーンを導出する副作用コーディネータ（純粋ロジックを持たず `src/context/*` 94 テストを無改変委譲、PHILOSOPHY #3）。`loadContext(doc, vc)` が doc 採用の**単一権威入口**（#1）: validate→compile→`importFromJson({clear:true})`→ref マップ（`_refToId`/`_traceByFrom`/`_constraintToLinkId`/`_linkIds`）再構築→`contextLoaded` emit、失敗は throw（サービスは UI を出さず caller が toast — #11）。**全 doc 変更は新 doc で入力不変**（#6）。**承認は一時セットでなく本物の doc 変異**（`decision.status: proposed→agreed`）— マトリックスの `resolved` 状態は `_approvedRefs()`（agreed/signed）由来で純粋射影の `{approvedRefs}` ゲートを駆動（ADR-049 Phase 4 後方互換シーム）。`approveDecision` はジオメトリ不変（`$decision`→`nominal` verbatim）で再生成せず、`applyAdmissible` は領域変化で再生成。`applyContextDoc` は変異**前**にコンパイルし失敗時に旧状態維持、conflict 署名差分時のみ `conflictsChanged`。アクセサが freshness 所有（#23）。`AppController._onContextLoaded` がシーン側後処理（undo/選択クリア・mm カメラフィット #27）。新ドメインイベント `contextLoaded`/`contextChanged`/`conflictsChanged`/`decisionApproved`（ADR-013）。`ContextService.test.js` 12 件（fake `sceneService` で **THREE-free** — 単一入口/doc 不変/承認 doc 変異/射影ゲート/簿記/イベント）、計 **106/106**、`tsc --noEmit`・`vite build` クリーン。PoC `ContextDemoController` は無改変（§4.1 `ContextController` 分割は Phase 2）。Docs: ADR-050 進捗注記 + CLAUDE.md ナビ + CODE_CONTRACTS（ContextService 所有権行）+ EVENTS [A2]。残: Phase 2–5。
- **2026-06-14** (4): Review/Feature — ADR-049 **再レビュー + §5.3 最終項目実装(Phase 4 完了)**。レビュー: Phases 1–4 が Accepted・90/90 通過を再確認、純粋層(`RequirementGraph`/`RegionGeometry`/`PredicateEngine`/`AdmissiblePromotion`/`PersonaProjection`)が `THREE`/DOM 非依存・入力不変・bare `node --test` 可を再検証。唯一の残課題 = ADR 自身の「次回送り」§5.3 **actor 別色分け許容領域ゴースト重畳**。**Slice A(純粋 `PersonaProjection.projectRegionGhosts`)**: 領域 Variable(`v.region`)について単一変数領域要求を actor ごとに集め、admissible ボックス群の共通部分を `RegionGeometry.intersectBoxes`(R6 と同一の半開・軸ごとロジックの単一の真実)で算出 — `intersection.empty`/`emptyAxes`/`gap` が R6 領域衝突結果そのもの。`state` はマトリックスと同型(`conflict`/`proposed`/`resolved`/`satisfied`、`approvedRefs` ゲート)。`ctx.actors` 順に regions をソートし決定的パレットインデックスを保証(色はビュー、純粋層は hex を持たない)。入力不変。**Slice B(読取専用ビュー + コントローラ)**: `RegionGhostView`(§5.2 の編集可 `RegionAuthoringWidget` = **入力**射影に対し ADR-047 ゴースト系譜の **出力**射影 = persona 色・読取専用)。各 actor フットプリントを persona 色半透明フィル+エッジで重畳、共通部分が非空→明るい「合意領域」(公称値ラベル)、空→束縛軸 gap を赤バンド+「✕ 共通部分なし=衝突」。`ContextDemoController.enterRegionGhost()` が `cell_region_context` を読み(authoring 同様シーン置換+zone 非表示)、**衝突マトリックス併置**(`demoSetMatrix`)し actor 列の `personaFilter` を `tick()` で 3D ゴースト dimming へミラー(2D グリッドと 3D 重畳が 1 つのペルソナ射影、`_ghostFilter` 最終値ガード)。ヘッダー「ゴースト」ボタン(PC+More)。`exit()` でゴースト dispose(PHILOSOPHY #4/#9)。テスト **94/94**(`projectRegionGhosts` 4 件追加)、`tsc --noEmit`・`vite build` クリーン。Docs: ADR-049 §8/Updated(Phase 4 完了)+ CLAUDE.md ナビ + CODE_CONTRACTS(PersonaProjection 行拡張)+ SCREEN_DESIGN [L] + EVENTS。**Phase 4 完了 — ADR-049 全フェーズ実装済**。
- **2026-06-14** (3): Review/Fix — ADR-049 **設計・実装レビュー** (adr-validate + code-review)。レビュー実施: RequirementGraph, PersonaProjection, RegionGeometry, PredicateEngine, AdmissiblePromotion, ContextValidator, ContextEditModel, ContextDemoController, ConflictMatrix.jsx, NegotiationClusterView.jsx, RegionAuthoringWidget.js の 13 ファイルを ADR-046/047/049 + PHILOSOPHY #3/#6/#11/#26 に対して検証。**結果**: violations 0 件、gap 1 件（承認状態の所有権がドキュメントに非明示）。**修正 2 件**: ① ADR-049 ステータスを `Draft (Proposed)` → `Accepted` へ昇格（本文 + README index — Phase 4 完了・90/90 テスト・`vite build` 通過済で "Draft" 継続は実態と乖離）。② `NegotiationClusterView` ボトムセクション（生クラスターリスト）に `personaFilter` 適用 — DAG セクションは `dim` していたが底部は未適用で、actor 列クリック時に片方だけ薄くなる不一致を解消。テスト 90/90 継続。**次回送り**: §5.3 の 3D actor 別色分け許容領域ゴースト重畳（ADR-049 本文に明記済）。