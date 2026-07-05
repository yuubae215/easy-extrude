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

## スコープ境界 (このリポジトリの責務)

このリポジトリは「宣言とスキーマ」の層であり、制約の **解法 (solving)** は持たない。

- ブラウザ 3D エディタ / 基本ジオメトリ操作 / JSON エクスポート
- Layout DSL の **公開スキーマ** と **基本コンパイラ** / バリデータ
- サンプル数個 / ローカル単体動作

制約を **解く処理** はこのリポジトリのスコープ外で、外部サービス
(grasp-search service) が担当する。

- DSL は `ik_solvable` / `no_collision` / `within_reach` などの **参照名** を
  宣言してよい。
- それらを **解く実装** (IK ソルバ / 干渉チェッカ / リーチ計算 / wrench cone /
  把持安定性スコア等) はここに書かない = 外部サービス側の責務。

同じ線引きが **意味マッピング/レコメンド** にも適用される (ADR-056)。

- **決定的 core は in-scope (= スキーマ/契約)**: キュレーション同義語商
  (`SynonymQuotient`/`QUOTIENT_TABLE`) ＋ 正規形シグネチャ ＋ 構造 diff ＋
  exact-color reconcile (`CanonicalForm`, 後続実装)。これらは等価/対応を **決定** する。
- **曖昧マッピングの提案・ランキング層は out-of-scope**: 商で解決できない語を
  **embedding / コーパス / 外部知** で対応付ける、類似度で並べる処理はここに書かない =
  外部サービス/システムの責務 (grasp-search service と同じパターン)。外部レコメンダは
  *提案する* だけで、決定的 core の内部判定には入らない。辞書に行を足せば商が広がり、
  その語は決定的 core へ昇格する (= 正攻法の拡張点)。

## BFF と契約 (越境防止)

契約 (BFF と外部サービスの I/O) の正本は JSON Schema パッケージ
(`@easy-extrude/grasp-contract`) 側にある。BFF では Schema から型を *導出* する
だけで、契約を *定義/拡張* しない。契約の変更は Schema 側で行い `contractVersion`
を上げる。

統治 (ADR-060 / PHILOSOPHY #29): ワイヤに載せるのは *ソルバが決定した事実* のみ
(score 層は閉 `additionalProperties:false`、pose は **kind 判別の有界 union**)。
演出 (接近ベクトル・ゴースト色・アニメ) はクライアントで *導出* し、契約に足さない
(`optional` 兄弟を生やさない = 無限成長の防止)。新しい姿勢表現は kind を 1 つ足す =
版を上げる意図的行為。

## AI 向けガード

このリポジトリで「制約の解法」に当たるコード (IK / 干渉 / リーチ / 安定性の
解き方) を依頼/生成しようとしたら、**作業を中断**し「それはこのリポジトリの
スコープ外 (外部の grasp-search service が担当) です」と促すこと。

同様に、**曖昧な意味マッピングを embedding / コーパス / 外部知で *提案・ランキング*
するレコメンド層** をこのリポジトリ内に実装しようとしたら、**作業を中断**し「それは
外部サービスの責務 (本リポジトリは決定的な正規形＋契約まで — ADR-056) です」と促すこと。
キュレーション辞書 (`QUOTIENT_TABLE`) への行追加と決定的な `CanonicalForm` は in-scope。

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
| Scene ⇄ DSL Mutual / decompileLayout / scene→DSL inverse / reverse compile / round-trip / scene fixpoint / 正規形までの相互変換 / Solid rotation additive / unconvertible warnings | ADR-055, `src/layout/LayoutDecompiler.js`, `src/layout/LayoutDecompiler.test.js` |
| Computable structural isomorphism / canonical form / 正規形シグネチャ / 出力形 / canonicalForm / CANONICAL_FORM_VERSION / verify / 往復検証 / docSignature / rootSignature / canonicalSignature / color refinement / Weisfeiler–Leman / WL_ROUNDS / identityPayload / structuralDiff / reconcile / 商上の構造同型を計算可能化 / 等価判定 / 突き合わせ / レコメンド基盤 / 曖昧マッピングは外部 (embedding は out-of-scope) | ADR-056 (Accepted, 実装済), `src/context/CanonicalForm.js`, `src/context/CanonicalForm.test.js`, `src/context/ProvenanceTree.js`, `src/context/SynonymQuotient.js` |
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
| 例を土台に編集 / fork & tweak / fork example / 類推オーサリング / シード・アンカー / authorSeed / forkExample / buildSeedIndex / seed chip / 埋まった手本 / onForkTemplate / in-place 編集 / クリックで編集 / EntryCard / editDocEntry / removeDocEntry / updateActor / updateVariable / updateRequirement / createDocEditCommand / エントリ編集 / 保存フラッシュ | ADR-058 (Accepted, Phase 1 + Phase 2 in-place 編集 実装済), `src/context/SeedAnchor.js`, `src/context/DocBuilder.js` (`updateActor`/`updateVariable`/`updateRequirement`/`removeDocEntry`), `src/command/DocEditCommand.js`, `src/controller/ContextController.js` (`forkExample`/`editDocEntry`/`removeDocEntry`), `src/components/Context/TemplateGallery.jsx` (fork action), `src/components/Context/IntakePanel.jsx` (dual-mode forms・EntryCard・Reveal・seed anchor), uiStore `context.authorSeed`/`contextSetSeed`/`context.requirements`/`contextSetRequirements` |
| 遊びの入力面 / IntakeAssist / seed-diff tint / ref 空き番提案 / refStatus / suggestRef / matchesSeed / 不足理由 / actorGaps / requirementGaps / GapNote / 無言 disabled 廃止 / KPI カタログ chips / kpiCatalogChips / dual-handle スライダ / DualRange / Why-first トレイル / validator 述語の同一関数参照 / isInterval export | ADR-058 「UX 具体化」節 (実装済), `src/context/IntakeAssist.js`, `src/context/IntakeAssist.test.js`, `src/context/ContextValidator.js` (`isInterval` export), `src/components/Context/IntakePanel.jsx`, uiStore `context.requirements`/`contextSetRequirements` |
| 自然言語インテーク / NL→Fact 抽出 / extractFacts / NlIntake / addNlFacts / 発話から要件 / status:unknown 保守的抽出 / additive canonical 正規化 (NL→doc φ 脚) | ADR-051 §3 Phase 4, ADR-044 (準同型), ADR-052 §2.2 (canonical record), `src/context/NlIntake.js`, `src/context/SynonymQuotient.js` (`canonicalKey`), `src/controller/ContextController.js` (`addNlFacts`), `src/components/Context/IntakePanel.jsx` (`NlIntakeForm`) |
| KPI 式アセット / role-kpi/2.0 / 式カタログ / exprTemplate / instantiateKpiExpr / KpiAssetChips / 選択リスト / 閉じた語彙 / 白紙撲滅 / IntakeVocabulary / DISCIPLINES / UNITS / recognition over recall / 選択優先インテーク / ウィザード / パラメトリックアセット | ADR-063 (Accepted, Phase 1+2 実装済; Phase 3–5 後続), ADR-062 (三層方針), `src/context/RoleKpiCatalog.js`, `src/context/RoleKpiCatalog.test.js`, `src/context/IntakeVocabulary.js`, `src/context/IntakeVocabulary.test.js`, `src/context/IntakeAssist.js` (`kpiCardLines`), `src/components/Context/IntakePanel.jsx` (`KpiAssetChips`) |
| 5W1H ユビキタス言語 / Mutual / NL⇄データ準同型 / Why ルート / KPI-Gap-Acceptance ツリー / 同義語商上の構造同型 / φ⁻¹ 来歴復元 / なぜシーンは Why を落とすか / CFツリーと SpatialLink は What/How 射影 | ADR-052, ADR-044 (φ 準同型), ADR-046 (L2/L5), ADR-049 (KPI/criterion/gap), ADR-048 §2.2.1 (構造関係) |
| Why ツリー構築 / 来歴復元 / provenance / buildWhyTree / recoverProvenance / シーンエンティティ→Why / KPI 遡及 / φ⁻¹ 実装 | ADR-052 §2.1/§2.2 Phase 1, `src/context/ProvenanceTree.js`, `src/service/ContextService.js` (`whyTree`, `recoverProvenance`) |
| Why パンくず / 来歴提示 UI / シーン操作→Why / 選択→provenance / Why タブ / Gap 表示 / showProvenance / WhyBreadcrumb | ADR-052 §3 Phase 2, `src/components/Context/WhyBreadcrumb.jsx`, `src/controller/ContextController.js` (`showProvenance`), `src/controller/AppController.js` (`_syncContextProvenance`), `src/service/ContextService.js` (`recoverProvenance` Gap join) |
| Why ツリー俯瞰 / 全体来歴ビュー / 俯瞰タブ / Why ルート apex / buildWhyTree UI / 5W1H 3層 / WhyTreeView | ADR-052 §2.1 Phase 3, `src/components/Context/WhyTreeView.jsx`, `src/service/ContextService.js` (`whyTree`), `src/controller/ContextController.js` (`_startNegotiation`/`_reproject` の `contextSetWhyTree`) |
| NL ⇄ doc 往復 / doc → NL ナレーション / 同義語商 / synonym quotient / canonicalize / localize / Why の自然言語化 / φ⁻¹ 返り脚 / narrateProvenance / narrateWhyTree | ADR-052 §2.2 Phase 4, ADR-044 (`why.keywords`), `src/context/SynonymQuotient.js`, `src/context/ProvenanceNarrative.js`, `src/service/ContextService.js` (`recoverProvenance` の `narrative` / `whyTreeNarrative`), `src/components/Context/WhyBreadcrumb.jsx`・`WhyTreeView.jsx` |
| ロボティクス / robotics / URDF / kinematics / KDL / ruckig / リーチ / 到達性 / 自己干渉 / 障害物干渉 / サイクルタイム / 軌道生成 / swept volume / TCP 教示 / IK 可視検証 / 測定器 KPI / ComputeBackend / 入力→計算→可視化→検証 | ADR-053 (Accepted, Phase 1+2+3 実装済), ADR-038 (jointType), ADR-049 (KPI 項), ADR-047 (ゴースト系譜) |
| C++→WASM ビルドレーン / Emscripten / emsdk / emcmake / KDL・ruckig WASM 化 / wasm-pack / ツールチェーン導入 / robotics-wasm / embind / vendor submodule / setup-toolchain / build:robotics-wasm | ADR-053 §11 Phase 3, `robotics-wasm/CMakeLists.txt`, `robotics-wasm/src/bindings.cpp`, `robotics-wasm/vendor/{ruckig,orocos_kdl,eigen}`, `scripts/setup-toolchain.sh`, `scripts/build-robotics-wasm.sh`, `src/engine/robotics-wasm/` (committed artifact), `robotics-wasm/robotics_engine.test.mjs` |
| robot_reach / collision_free 述語 / 到達性述語 / 干渉述語 / 事前ベイクオペランド / measured operand / reachable / contact clearance / marginMin / scope self·env / context/0.4 | ADR-053 §9 Phase 1, `src/context/PredicateEngine.js` (`evalRobotReach`/`evalCollisionFree`), `src/context/ContextDslSchema.js` (`VALID_PREDICATE_KINDS`/`CONTEXT_DSL_VERSION`), `src/context/RoboticsPredicate.test.js` |
| 測定器 純粋計算 / FK / 順運動学 / forwardKinematics / FK サンプリング 到達性 / reachTargets / AABB 干渉ベイク / bakeContacts / ComputeBackend / LocalComputeBackend / RoboticsService / 測定→doc ベイク / applyMeasuredFact / measureReach / measureCollision | ADR-053 §10 Phase 2, `src/robotics/Kinematics.js`, `src/robotics/Collision.js`, `src/robotics/ComputeBackend.js`, `src/service/RoboticsService.js`, `src/robotics/Robotics.test.js`, `src/service/RoboticsService.test.js` |
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
| Grasp search / 検証ウォークスルー / UI→DSL→BFF→API / compileLayout 往復 / graspSearch / GraspController / 右ドック grasp タブ / 判別共用体 FSM (idle/no-layout/compiling/solving/results/error) / objectiveScores バー / スコア優先 / selectCandidate / selectedRank / objectiveWeights / topN / 候補 candidates / 正規アクセスルート getCompiled().layoutDsl / graspPanelOpen 廃止 | ADR-057 (placement+FSM), ADR-054 (thread), `src/controller/GraspController.js`, `src/components/Grasp/GraspSearchPanel.jsx` (ContextLayer `'grasp'` タブ), `src/service/BffClient.js`, `src/controller/GraspController.test.js` |
| grasp diagnostics / 棄却ファネル / rejection funnel / 惜しさメーター / near miss / reachNearestMiss / candidatesGenerated / 効いた感 / 差分チップ / funnelStages / dominantStage / funnelDelta / nearMissCloseness / prevDiagnostics / DiagnosticsFunnel / contractVersion 3 | ADR-061 (Accepted, 実装済), ADR-060, `src/view/GraspFunnelMath.js`, `src/components/Grasp/GraspSearchPanel.jsx` (`DiagnosticsFunnel`), `src/controller/GraspController.js` (`runGraspSearch` diagnostics/prevDiagnostics) |
| grasp ゴースト / spatial ghost / グリッパグリフ / 接近ベクトル / approach vector / FRAME_CONVENTION / 能力ゲート / renderableEndEffectorFrame / hover プレビュー / 接近アニメ / pose kind union 消費 (endEffector/jointSpace) / 対象アウトライン | ADR-059 (Accepted, 段1 実装済), ADR-060, `src/view/GraspGhostMath.js`, `src/view/GraspGhostView.js`, `src/controller/GraspController.js` (`_syncGhost`/`hoverCandidate`/`disposeGhost`) |
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
- WASM build lanes are **not** needed for `vite build` (both ship committed artifacts in `src/engine/`). To regenerate them run `pnpm setup:toolchain` once (installs wasm-pack + Emscripten SDK + inits `robotics-wasm/vendor` submodules), then `pnpm build:wasm` (Rust) / `pnpm build:robotics-wasm` (C++ KDL+ruckig → `src/engine/robotics-wasm/`). On a fresh clone run `git submodule update --init --recursive` before the C++ build (ADR-053 §11).
- The neutral I/O contract `@easy-extrude/grasp-contract` is vendored as a **git submodule** at `vendor/grasp-contract` (a pnpm-workspace package the BFF depends on as `workspace:*`). A fresh clone needs `git submodule update --init --recursive`. The BFF only *derives* from it: `pnpm --filter easy-extrude-bff run gen:contract-types` regenerates the committed `.d.ts` from the schema, and `pnpm test:contract` runs the conformance + contractVersion-drift tests. Never edit the contract here — change it upstream and bump `contractVersion`.

@docs/PHILOSOPHY.md

## Session history

Full log → `docs/SESSION_LOG.md`. **ここには直近 3 件のみ、各 1–3 行の要約で記録する**
（全文は SESSION_LOG.md 側に書く — CLAUDE.md は 40k 文字制限があり、長文履歴が主因で超過した実績あり）。

- **2026-07-05** (2): Feature — **ADR-063 Phase 1+2 実装（KPI 式アセット `role-kpi/2.0` + 選択リストで白紙撲滅）→ Accepted (Phase 1+2)**。`RoleKpiCatalog` を式アセット `{name, unit, exprTemplate, params[], suggestedOp, description}` へ拡張（R8 は同一カタログを読み続け 1.0 名前配列 override も受容 = additive）、`instantiateKpiExpr` は未解決 `{…}` を逐語で残し `requirementGaps` が理由文で塞ぐ（#11）。`IntakeVocabulary` 新設（ROLES/NEGOTIABILITY はスキーマ enum の同一参照、DISCIPLINES はカタログキー由来 — 旧 UI リストの `eoat` 欠落を構造修正、UNITS datalist は提案であって拘束ではない）、`IntakePanel` に `KpiAssetChips`（hover ミニカードで選ぶ前に閲覧 → name/unit/expr/op 一括充填、pristine な間だけ `{var}` 自動追従）。テスト 381/381（+14）、tsc・vite build クリーン。残: Phase 3–5（ウィザード/パラメトリックビューワ/統合）+ ADR-062 全フェーズ。
- **2026-07-04** (2): Feature — **ADR-061 実装（契約 v3 diagnostics 棄却ファネル → UI 即時フィードバック）**。BFF は pin 更新 + 型再生成 + 素通しのまま（契約テスト 16/16、pre-v3 拒否 / 演出密輸拒否 / verbatim 素通しを追加）。純粋層 `GraspFunnelMath`（段順ファネル / 支配段 / 前回比差分 / 惜しさ曲線、判定ロジック非持込 — PHILOSOPHY #29）、`GraspController` results に `diagnostics`+`prevDiagnostics`、パネルに `DiagnosticsFunnel`（候補ゼロはファネルで説明・generated=0 は入力ガイド・near-miss メーター・差分チップ）。テスト 367/367。
- **2026-07-04**: Feature — **ADR-058「UX 具体化」節を実装（遊びの入力面・堅い検証境界）**。純粋層 `IntakeAssist`（seed-diff 判定 / ref 空き番提案 / 不足理由列挙 = submit 述語 / KPI カタログ chips / hover ミニカード行、`node --test` 11 件）。B-2 は `ContextValidator.isInterval` の export + 参照同一性テストで担保。`IntakePanel` に flood フラッシュ + seed tint / RefField ライブ一意性 / GapNote（無言 disabled 廃止）/ WhyTrail / KPI chips / DualRange（既存 onPreview → 3D バンド直結）。コミット境界 `onAddDocEntry` 無改変（B-3）。uiStore `context.requirements` 供給で Requirements バッジ常時 0 の潜在バグも修正。テスト 340 全パス。
