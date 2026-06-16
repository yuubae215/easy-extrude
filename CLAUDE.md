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
| 領域オーサリング / 双方向ゴースト / 3D authoring widget / ドラッグで衝突解消 / live conflict / RegionAuthoringWidget | ADR-049 §5.2/§8 Phase 3, `src/view/RegionAuthoringWidget.js`, `src/context/ContextEditModel.js`, `src/controller/ContextController.js` (`enterAuthoring`) |
| 衝突マトリックス / 交渉クラスター DAG / 解消順序 / ペルソナ射影 / persona projection / DSM partitioning / actor × variable / conflict matrix / n-ary 承認 / approval gate / approvedRefs / proposed / 合同確定 / approveDecision | ADR-049 §5.3/§8 Phase 4, `src/context/PersonaProjection.js`, `src/components/ContextDemo/ConflictMatrix.jsx`, `src/components/ContextDemo/NegotiationClusterView.jsx`, `src/controller/ContextController.js` (`enterNegotiation`, `approveDecision`) |
| 許容領域ゴースト / actor 別色分け / region ghost / 共通部分が空 / no-man's-land バンド / persona 色重畳 / projectRegionGhosts / RegionGhostView / enterRegionGhost | ADR-049 §5.3/§8 Phase 4, `src/context/PersonaProjection.js` (`projectRegionGhosts`), `src/view/RegionGhostView.js`, `src/controller/ContextController.js` (`enterRegionGhost`) |
| Context-first project / 正準 context doc / シーンは導出射影 / loadContext / 承認=doc 変異 / ContextService / contextLoaded / .ctx.json / 本番機能化 / PoC → production | ADR-050, `src/service/ContextService.js`, `src/service/ContextService.test.js` |
| 本番 Negotiation / ContextController / 交渉設計(本番)/ context スライス / アンドゥ可能な承認 / ApproveDecisionCommand / Context ▾ メニュー / ContextLayer / prop 駆動 Matrix・Cluster | ADR-050 §4/§6 Phase 2, `src/controller/ContextController.js`, `src/command/ApproveDecisionCommand.js`, `src/components/Context/ContextLayer.jsx` |
| 本番 Authoring / 領域オーサリング(本番)/ ライブ recolor / ドラッグ終了で再生成 / アンドゥ可能な領域編集 / EditAdmissibleCommand / 本番 領域ゴースト / context mode (negotiate/author/ghost) | ADR-050 §4.5/§6 Phase 3, `src/controller/ContextController.js`, `src/command/EditAdmissibleCommand.js`, `src/view/RegionAuthoringWidget.js`, `src/view/RegionGhostView.js` |
| 動的フォーム / OpenQuestion intake / FormPanel / answerKind / AnswerQuestionCommand / .ctx.json import-save / applyQuestionAnswer | ADR-050 §4.4/§5/§6 Phase 4, `src/controller/ContextController.js`, `src/command/AnswerQuestionCommand.js`, `src/context/FormApplication.js`, `src/components/Context/FormPanel.jsx` |
| 要件入力 / requirement intake / あいまい要件の入口 / 複数入口 / blank-slate authoring / テンプレートギャラリー / 自然言語インテーク / NL→Fact / 入力UX / デモがどの例を読むか | ADR-051, ADR-050 §2/§5 (正準 doc), ADR-047 §7 (デモ挙動), ADR-044 (5W1H NL bridge) |
| blank doc / New Context / createBlankDoc / adoptDoc / addActor / addVariable / addRequirement / addFact / AddDocEntryCommand / IntakePanel / 要件直接追加 | ADR-051 §3 Phase 1, `src/context/DocBuilder.js`, `src/command/AddDocEntryCommand.js`, `src/components/Context/IntakePanel.jsx`, `src/controller/ContextController.js` (`newContext`, `addDocEntry`) |
| テンプレートギャラリー / starter テンプレート / TemplateCatalog / TemplateGallery / selectTemplate / テンプレートから開始 / スターター .ctx.json | ADR-051 §3 Phase 2, `src/context/TemplateCatalog.js`, `src/components/Context/TemplateGallery.jsx`, `src/controller/ContextController.js` (`openTemplateGallery`, `selectTemplate`) |
| 入力中ライブプレビュー / 不確実バンド即時表示 / intake preview / previewIntake / setIntervalPreview / 許容区間 3D ゴースト | ADR-051 §3 Phase 3, `src/view/UncertaintyGhostView.js` (`setIntervalPreview`), `src/controller/ContextController.js` (`previewIntake`), `src/components/Context/IntakePanel.jsx` (RequirementForm `onPreview`) |
| 自然言語インテーク / NL→Fact 抽出 / extractFacts / NlIntake / addNlFacts / 発話から要件 / status:unknown 保守的抽出 | ADR-051 §3 Phase 4, ADR-044 (準同型), `src/context/NlIntake.js`, `src/controller/ContextController.js` (`addNlFacts`), `src/components/Context/IntakePanel.jsx` (`NlIntakeForm`) |
| 5W1H ユビキタス言語 / Mutual / NL⇄データ準同型 / Why ルート / KPI-Gap-Acceptance ツリー / 同義語商上の構造同型 / φ⁻¹ 来歴復元 / なぜシーンは Why を落とすか / CFツリーと SpatialLink は What/How 射影 | ADR-052, ADR-044 (φ 準同型), ADR-046 (L2/L5), ADR-049 (KPI/criterion/gap), ADR-048 §2.2.1 (構造関係) |
| Link Network / link graph / リンク図 / layered layout / node panel / 複数親に見える / 包含 vs 制約エッジ | ADR-048 §2.2.1, `src/view/LinkNetworkView.js` |
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

- **2026-06-16** (6): Feature — **ADR-051 Phase 1 実装**（ブランク状態フォーム作成 — Entry A）。**DocBuilder.js** 新設（`src/context/DocBuilder.js`）= 純粋 doc-builder 関数群: `createBlankDoc(name)` / `addActor` / `addFact` / `addVariable` / `addRequirement`（入力不変・THREE-free・bare `node --test` 可）。**AddDocEntryCommand.js** 新設（`src/command/AddDocEntryCommand.js`）= `createAddDocEntryCommand(ctxService, beforeDoc, afterDoc, label, vc)` — before/after スナップショットパターン（PHILOSOPHY #6）、`regenerate:true` で `applyContextDoc` を呼ぶ。**IntakePanel.jsx** 新設（`src/components/Context/IntakePanel.jsx`）= Actor / Variable / Requirement 直接追加フォーム（コラプス可）、ContextLayer の 'intake' タブで表示。**ContextService.adoptDoc()** 追加 — blank doc 用: `loadContext` ではなく、empty scene JSON（`SCENE_JSON_VERSION`）で scene をクリア + validate + state 設定 + `contextLoaded` emit（`specification.layout` 不在で `compileContext` を呼ばない）。**ContextController**: `newContext()` = confirmダイアログ → `adoptDoc` → `_startNegotiation` / `addDocEntry(type, data)` = DocBuilder dispatch + `AddDocEntryCommand` push / `onNewContext`・`onAddDocEntry` コールバック登録。**_startNegotiation** に `variables` フィールド追加。**_reproject** に `contextSetActors`・`contextSetVars` 呼び出し追加（IntakePanel ドロップダウンが即時更新 — PHILOSOPHY #5）。blank doc 起動時の初期タブは `'intake'`（actors が空の場合）。**Header** の Context ▾（PC + mobile ⋯）に「New Context」メニュー項目追加。**ContextLayer** に `'intake'` タブ追加。**uiStore** に `context.variables` フィールド + `contextSetActors`・`contextSetVars` アクション追加。**DocBuilder.test.js** 21 件 + **AddDocEntryCommand.test.js** 4 件 = 新規 25 件、計 **143/143**、`vite build` クリーン。Docs: ADR-051 ステータス Accepted (Phase 1) + README.md インデックス + CLAUDE.md ナビ(blank doc行追加) + CODE_CONTRACTS(ContextController Phase 1 行追加)。残: Phase 2 (テンプレートギャラリー) / Phase 3 (3D ゴースト即時プレビュー) / Phase 4 (NL インテーク)。
- **2026-06-16** (5): Design/ADR — **ADR-052 起案 + ADR-051/048 更新**（要件入力UX の土台固め、ドキュメントのみ・コード未改変）。ユーザーとの設計対話で、当初 3 論点（デモ挙動・Link Network・要件入力UX）の根に基礎原理があると判明。**新規 ADR-052「5W1H ユビキタス言語 — NL ⇄ データの Mutual 構造」**（`docs/adr/ADR-052-5w1h-ubiquitous-language.md`、Status: Proposed）: 正準 doc を **Why（KPI/クライテリアと実測の Gap/及第点=Acceptance/Intent）をルートにした 5W1H ツリー**として構造契約化（ADR-046 L2/L5 + ADR-049 KPI/criterion/admissible/gap + ADR-044 Why/How/What の統合、新データ不要）。**Mutual の形式的定義 = 同義語商上の構造同型**: φ:NL→doc は多対一準同型（ADR-044）、φ⁻¹ は表層語を捨てるが 5W1H ツリー（Why 来歴）を完全復元（ADR-044 マクロ記録の文脈全体への一般化）。`scene`（CF ツリー＋SpatialLink）は **What/How 射影で Why を落とす**ため単独では lossy（ADR-049 不変条件9 再確認）。**ADR-051（要件入力）更新**: §2.0 に「Why ファースト（ADR-052 帰結）」を追加、Related に ADR-052。**ADR-048 §2.2.1 更新**: 構造関係の精密化（CF ツリー＝SE(3) TF 準同型 / CF ツリー ↪ SpatialLink は包含=運動学的全域木⊂制約グラフ・URDF 流 ADR-038 / 5W1H は逐次合成のモノイド準同型・ツリーではなく列＋小DAG / 三者は互いの準同型でなく同一 doc からの構造保存射の像）。`docs/adr/README.md` インデックスに ADR-052 行追加・ADR-051 Related 更新。ADR-044/046/049/050 の Related に ADR-051/052 相互参照追加。`CLAUDE.md` ナビ表に「5W1H ユビキタス言語 / Mutual / Why ルート」行追加。**実装（入口カタログ・φ⁻¹ 来歴復元・Link Network 凡例）は ADR 承認後の後続**。
- **2026-06-16** (4): Feature — ADR-050 **Phase 5**（チュートリアル分離 + Accepted 昇格）。`ContextDemoController` から Phases 2–4 で `ContextController` へ移行済みの本番コードを除去: `enterNegotiation`/`_startNegotiation`/`approveNegotiationDecision`（Phase 2）、`enterAuthoring`/`_startAuthoring`/`_revalidate`/`onAuthorPointerDown/Move/Up`（Phase 3）、`enterRegionGhost`/`_startRegionGhost`（Phase 3）— およびそれらが使用していた `applyAdmissibleEdit`/`projectConflictMatrix`/`projectResolutionOrder`/`projectRegionGhosts`/`validateContext`/`RegionAuthoringWidget`/`RegionGhostView`/`personaColor`/`regionContext`/`conflictContext` の import 群を削除。コントローラが登録するコールバックも tutorial 専用の 5 件（`onContextDemoClick`/`onDemoStepChange`/`onDemoApproveDecision`/`onDemoItemSelect`/`onDemoExit`）に絞り込み — Authoring/Negotiation/RegionGhost の 4 件（`onContextAuthorClick`/`onContextNegotiationClick`/`onContextRegionGhostClick`/`onApproveNegotiationDecision`）は `ContextController` が既に `onContextAuthor`/`onContextNegotiate`/`onContextRegionGhost`/`onApproveContextDecision` として登録済み。`exit()`・`setStep()`・`tick()` から対応するブランチを除去しストーリー専用コードのみ残す。`CLAUDE.md` ナビ表の Authoring/Negotiation/RegionGhost 参照先を `ContextDemoController` → `ContextController` に更新。ADR-050 ステータスを **Accepted** へ昇格、`docs/adr/README.md` インデックスも同期。計 **118/118**、`vite build` クリーン。**全 5 フェーズ完了。**
- **2026-06-16** (3): Feature — ADR-050 **Phase 4**（動的フォーム + `.ctx.json` 永続化）。**FormApplication** 新設（`src/context/FormApplication.js`）= 純粋 `applyQuestionAnswer(doc, question, answer)` — answerKind 別に doc を不変書き換え（quantity: `given.attrs[key] = {value, unit}` / actorRef: `obligation.responsible = ref` / kpiCriterion: `req.kpi/criterion 付与` / requirement: `requirements` 追加）。**AnswerQuestionCommand** 新設（`src/command/AnswerQuestionCommand.js`）= `createAnswerQuestionCommand(ctxService, qRef, beforeDoc, afterDoc, vc)` — execute/undo とも `applyContextDoc({regenerate:true})`（form 回答は derived geometry を変えうる）、before/after はドキュメント全体スナップショット（PHILOSOPHY #6）。**FormPanel** 新設（`src/components/Context/FormPanel.jsx`）= `context.form` を answerKind 別 widget で描画（quantity: 数値+単位入力 / actorRef: actor ドロップダウン / kpiCriterion: KPI 式+op+値 / requirement: ref+by+note フォーム）、回答ボタンが `onAnswerQuestion(qRef, question, answer)` callback を呼び出し、`ContextController.answerQuestion` が command push → 1 問消え完了機械判定(PHILOSOPHY #11)。**ContextLayer** を negotiate mode 時に `[Matrix | Cluster | Questions]` タブ化（`form.length > 0` のみ表示、バッジ付き、初期タブは form がある場合 'questions'）。**ContextController** に `answerQuestion` / `importContextFile` / `exportContextFile` を追加; `_startNegotiation()` が `form` + `actors` を context スライスへ射影; `_reproject()` が negotiate mode 時に `contextSetForm` で form を再描画(PHILOSOPHY #5)。**Header** の Context ▾ ドロップダウン + More ⋯ メニューに「Import Context…」「Save Context」を追加（Production セクション）。`importContextFile` はファイルピッカー → parse → `_loadThen(doc, _startNegotiation)` でシーン再生成 + undo クリア + negotiate mode 自動開始。`exportContextFile` は `getDoc()` → `.ctx.json` ダウンロード（doc が成果物 — §5）。`uiStore.context` に `form: [], actors: []` フィールドと `contextSetForm` アクションを追加。`AnswerQuestionCommand.test.js` 4 件（execute 再生成/undo 復元/入力不変/redo round-trip — THREE-free）、計 **118/118**、`vite build` クリーン。demo (`ContextDemoController`) は無改変（Phase 5 で除去）。Docs: ADR-050 進捗注記 + CLAUDE.md ナビ/履歴 + CODE_CONTRACTS（ContextController Phase 4 行 + AnswerQuestionCommand）。残: Phase 5。
- **2026-06-16** (2): Feature — ADR-050 **Phase 3**（本番 Authoring + 領域ゴースト・3D）。`ContextController` を拡張し `_mode: 'negotiate'|'author'|'ghost'` を導入。**領域オーサリング**（`enterAuthoring`）= `ContextService` の loaded doc の単一変数領域要求ごとに `RegionAuthoringWidget` を生成（領域要求が無ければ `cell_region_context.json` をブートストラップ）。**ライブドラッグは recolor のみ**（クローン `_editCtx` を `applyAdmissibleEdit→validateContext`、正準 doc 不変 — §7/PHILOSOPHY #6/#7）、**ドラッグ終了で 1 回だけ** 新設 `createEditAdmissibleCommand`（`src/command/EditAdmissibleCommand.js`）経由でコミット = アンドゥ可能な doc 変異 + シーン再生成（§3.5）。衝突を消す編集は decision を orphan させ `compileContext` が invariant 7 で reject → toast + ウィジェットロールバック（PHILOSOPHY #11）。**領域ゴースト**（`enterRegionGhost`）= `projectGhosts()` から actor 色 `RegionGhostView` を重畳し、マトリックスの actor 列 persona filter を `tick()` で 3D dimming へミラー（`_ghostFilter` ガード）。AppController に `_ctxCtrl.isAuthoring` pointer 委譲（`_demoCtrl` と並列）+ `_ctxCtrl.tick(t)` を配線。承認/領域編集/undo/redo は `ContextService.contextChanged` 購読の `_reproject()` 単一経路で再射影（PHILOSOPHY #5）。`ContextLayer.jsx` を `mode` 別レンダリング（negotiate: Matrix+Cluster / author: ライブ衝突リスト / ghost: Matrix のみ）。Header「Context ▾」を本番 3 項目（交渉設計/領域オーサリング/許容領域ゴースト）+ demo Tutorial に再編。`EditAdmissibleCommand.test.js` 4 件（`importFromJson` モックで **THREE-free**）、計 **114/114**、`tsc --noEmit`・`vite build` クリーン。demo (`ContextDemoController`) は無改変（Phase 5 で除去）。§4.5 の姿勢/視覚インジケータ authoring は設計のみ確定（pose 型 additive 拡張は後続）。Docs: ADR-050 進捗注記 + CLAUDE.md ナビ/履歴 + CODE_CONTRACTS（ContextController Phase 3 行）+ EVENTS + SCREEN_DESIGN + LAYOUT_DESIGN。残: Phase 4–5。
- **2026-06-16**: Feature — ADR-050 **Phase 2**（本番 Negotiation・データのみ・最低リスク）。新設 `src/controller/ContextController.js` — `ContextService` を消費する永続オーバーレイコーディネータ（`MapModeController` 同様、`setMode` FSM 状態ではない — §4.2/ADR-047 §2.1：orbit/select/grab を生かす）。`enterNegotiation()` は loaded doc で動作（Phase 2 は同梱 `cell_conflict_context.json` を `loadContext` でブートストラップ、実 `.ctx.json` import は Phase 4）し、衝突マトリックス + 解消順序を永続 `context` uiStore スライス（§4.3、`demo` と並列・新ペイロードで自動リセットしない）へ射影。**承認は新設 `createApproveDecisionCommand`（`src/command/ApproveDecisionCommand.js`）経由で単一 CommandStack 上でアンドゥ可能**（§3.5）: `execute`=`ctxService.approveDecision`（doc 変異 `proposed→agreed`）、`undo`=`unapproveDecision`。承認は doc 変異（§3.2）でジオメトリ不変のため再生成なし。コントローラは `ContextService.contextChanged` を購読し**そこから再射影**するため、承認/undo/redo がすべて同一経路で再射影される（PHILOSOPHY #5、ガード返り inline なし）。`ConflictMatrix`/`NegotiationClusterView` を **prop 駆動化**（§4.4、`{matrix,filter,onSetFilter}`/`{order,clusters,filter,onApprove}` — スライス非依存）し、demo（`demo` スライス）と新 `src/components/Context/ContextLayer.jsx`（`context` スライス、3D 非依存なのでモバイル全幅 — PHILOSOPHY #26）の双方が同一 presentational を再利用。Header の 4 デモボタンを単一「Context ▾」ドロップダウン（`交渉設計` 本番 + `Tutorial`/`Author`/`Region Ghosts` demo）へ集約（PC + モバイル ⋯ メニュー）。`ApproveDecisionCommand.test.js` 4 件（fake `sceneService` で **THREE-free** — execute 承認/undo 反転/ジオメトリ不変/redo round-trip）、計 **110/110**、`tsc --noEmit`・`vite build` クリーン。demo (`ContextDemoController`) は無改変。Docs: ADR-050 進捗注記 + CLAUDE.md ナビ/履歴 + CODE_CONTRACTS（ContextController 行）+ EVENTS（本番 context UI callbacks）+ SCREEN_DESIGN + LAYOUT_DESIGN。残: Phase 3–5。
- **2026-06-15**: Feature — ADR-050 **Phase 1**（Context-first 本番化の基盤、UI 無変更）。`src/service/ContextService.js` 新設 — 正準 Context DSL doc を所有し `compileContext→compileLayout→importFromJson` 連鎖でシーンを導出する副作用コーディネータ（純粋ロジックを持たず `src/context/*` 94 テストを無改変委譲、PHILOSOPHY #3）。`loadContext(doc, vc)` が doc 採用の**単一権威入口**（#1）: validate→compile→`importFromJson({clear:true})`→ref マップ（`_refToId`/`_traceByFrom`/`_constraintToLinkId`/`_linkIds`）再構築→`contextLoaded` emit、失敗は throw（サービスは UI を出さず caller が toast — #11）。**全 doc 変更は新 doc で入力不変**（#6）。**承認は一時セットでなく本物の doc 変異**（`decision.status: proposed→agreed`）— マトリックスの `resolved` 状態は `_approvedRefs()`（agreed/signed）由来で純粋射影の `{approvedRefs}` ゲートを駆動（ADR-049 Phase 4 後方互換シーム）。`approveDecision` はジオメトリ不変（`$decision`→`nominal` verbatim）で再生成せず、`applyAdmissible` は領域変化で再生成。`applyContextDoc` は変異**前**にコンパイルし失敗時に旧状態維持、conflict 署名差分時のみ `conflictsChanged`。アクセサが freshness 所有（#23）。`AppController._onContextLoaded` がシーン側後処理（undo/選択クリア・mm カメラフィット #27）。新ドメインイベント `contextLoaded`/`contextChanged`/`conflictsChanged`/`decisionApproved`（ADR-013）。`ContextService.test.js` 12 件（fake `sceneService` で **THREE-free** — 単一入口/doc 不変/承認 doc 変異/射影ゲート/簿記/イベント）、計 **106/106**、`tsc --noEmit`・`vite build` クリーン。PoC `ContextDemoController` は無改変（§4.1 `ContextController` 分割は Phase 2）。Docs: ADR-050 進捗注記 + CLAUDE.md ナビ + CODE_CONTRACTS（ContextService 所有権行）+ EVENTS [A2]。残: Phase 2–5。
- **2026-06-14** (4): Review/Feature — ADR-049 **再レビュー + §5.3 最終項目実装(Phase 4 完了)**。レビュー: Phases 1–4 が Accepted・90/90 通過を再確認、純粋層(`RequirementGraph`/`RegionGeometry`/`PredicateEngine`/`AdmissiblePromotion`/`PersonaProjection`)が `THREE`/DOM 非依存・入力不変・bare `node --test` 可を再検証。唯一の残課題 = ADR 自身の「次回送り」§5.3 **actor 別色分け許容領域ゴースト重畳**。**Slice A(純粋 `PersonaProjection.projectRegionGhosts`)**: 領域 Variable(`v.region`)について単一変数領域要求を actor ごとに集め、admissible ボックス群の共通部分を `RegionGeometry.intersectBoxes`(R6 と同一の半開・軸ごとロジックの単一の真実)で算出 — `intersection.empty`/`emptyAxes`/`gap` が R6 領域衝突結果そのもの。`state` はマトリックスと同型(`conflict`/`proposed`/`resolved`/`satisfied`、`approvedRefs` ゲート)。`ctx.actors` 順に regions をソートし決定的パレットインデックスを保証(色はビュー、純粋層は hex を持たない)。入力不変。**Slice B(読取専用ビュー + コントローラ)**: `RegionGhostView`(§5.2 の編集可 `RegionAuthoringWidget` = **入力**射影に対し ADR-047 ゴースト系譜の **出力**射影 = persona 色・読取専用)。各 actor フットプリントを persona 色半透明フィル+エッジで重畳、共通部分が非空→明るい「合意領域」(公称値ラベル)、空→束縛軸 gap を赤バンド+「✕ 共通部分なし=衝突」。`ContextDemoController.enterRegionGhost()` が `cell_region_context` を読み(authoring 同様シーン置換+zone 非表示)、**衝突マトリックス併置**(`demoSetMatrix`)し actor 列の `personaFilter` を `tick()` で 3D ゴースト dimming へミラー(2D グリッドと 3D 重畳が 1 つのペルソナ射影、`_ghostFilter` 最終値ガード)。ヘッダー「ゴースト」ボタン(PC+More)。`exit()` でゴースト dispose(PHILOSOPHY #4/#9)。テスト **94/94**(`projectRegionGhosts` 4 件追加)、`tsc --noEmit`・`vite build` クリーン。Docs: ADR-049 §8/Updated(Phase 4 完了)+ CLAUDE.md ナビ + CODE_CONTRACTS(PersonaProjection 行拡張)+ SCREEN_DESIGN [L] + EVENTS。**Phase 4 完了 — ADR-049 全フェーズ実装済**。
- **2026-06-14** (3): Review/Fix — ADR-049 **設計・実装レビュー** (adr-validate + code-review)。レビュー実施: RequirementGraph, PersonaProjection, RegionGeometry, PredicateEngine, AdmissiblePromotion, ContextValidator, ContextEditModel, ContextDemoController, ConflictMatrix.jsx, NegotiationClusterView.jsx, RegionAuthoringWidget.js の 13 ファイルを ADR-046/047/049 + PHILOSOPHY #3/#6/#11/#26 に対して検証。**結果**: violations 0 件、gap 1 件（承認状態の所有権がドキュメントに非明示）。**修正 2 件**: ① ADR-049 ステータスを `Draft (Proposed)` → `Accepted` へ昇格（本文 + README index — Phase 4 完了・90/90 テスト・`vite build` 通過済で "Draft" 継続は実態と乖離）。② `NegotiationClusterView` ボトムセクション（生クラスターリスト）に `personaFilter` 適用 — DAG セクションは `dim` していたが底部は未適用で、actor 列クリック時に片方だけ薄くなる不一致を解消。テスト 90/90 継続。**次回送り**: §5.3 の 3D actor 別色分け許容領域ゴースト重畳（ADR-049 本文に明記済）。