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
| 許容領域ゴースト / actor 別色分け / region ghost / 共通部分が空 / no-man's-land バンド / persona 色重畳 / projectRegionGhosts / RegionGhostView / enterRegionGhost / gap band / 解消演出 / recolor→dissolve / ghost モードの再射影 | ADR-049 §5.3/§8 Phase 4, ADR-065 Phase 5 (解消演出 + ghost 再射影), `src/context/PersonaProjection.js` (`projectRegionGhosts`), `src/view/RegionGhostView.js`, `src/view/RegionGhostMath.js`, `src/view/RegionResolveEffect.js`, `src/controller/ContextController.js` (`enterRegionGhost`/`_refreshRegionGhosts`) |
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
| KPI 式アセット / role-kpi/2.0 / 式カタログ / exprTemplate / instantiateKpiExpr / KpiAssetChips / 選択リスト / 閉じた語彙 / 白紙撲滅 / IntakeVocabulary / DISCIPLINES / UNITS / recognition over recall / 選択優先インテーク / パラメトリックアセット | ADR-063 (Accepted, Phase 1+2+3 実装済; Phase 4–5 後続), ADR-062 (三層方針), `src/context/RoleKpiCatalog.js`, `src/context/RoleKpiCatalog.test.js`, `src/context/IntakeVocabulary.js`, `src/context/IntakeVocabulary.test.js`, `src/context/IntakeAssist.js` (`kpiCardLines`), `src/components/Context/IntakePanel.jsx` (`KpiAssetChips`) |
| ウィザード / guided intake / ガイド付きインテーク / WizardCatalog / wizard/1.0 / WizardPanel / wizard タブ / ウィザード FSM / step/review / wizardStepGaps / nextWizardState / wizardTrail / onWizardStart / 段階開示 / 順序付きの器 | ADR-063 §4/Phase 3 (実装済), `src/context/WizardCatalog.js`, `src/context/WizardCatalog.test.js`, `src/components/Context/WizardPanel.jsx`, `src/controller/ContextController.js` (`startWizard`/`wizardNext`/`finishWizard`), uiStore `context.wizard`/`contextSetWizard`, `docs/STATE_TRANSITIONS.md` §context.wizard |
| パラメトリックアセット / parametric asset / パラメトリックビューワ / ParametricAssets / parametric/1.0 / instantiateAsset / clampParams / applyAssetCommit / ParametricPreviewView / ParametricAssetPanel / Assets タブ / assetSource / スライダで3D / コミットは数値 / Guided Intake カード / Empty Project エキスパート棚 | ADR-063 §2/Phase 4+5 (実装済), `src/context/ParametricAssets.js`, `src/context/ParametricAssets.test.js`, `src/view/ParametricPreviewView.js`, `src/components/Context/ParametricAssetPanel.jsx`, `src/controller/ContextController.js` (`openAssetViewer`/`setAssetParam`/`commitAsset`), uiStore `context.assetViewer`/`contextSetAssetViewer` |
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
| 証明フィードバックループ / 演出プリミティブ / proof feedback / DeltaChip / LandingFlash / 着地フラッシュ / usePrevOnChange / FeedbackMath / refsSignature / settledRefs / 消化フラッシュ / 未解決カウント差分 / FormPanel 差分チップ / マトリックス解消フラッシュ | ADR-062 (Accepted, 全フェーズ実装済), PHILOSOPHY #29 scope note, `src/components/Feedback/FeedbackPrimitives.jsx`, `src/view/FeedbackMath.js`, `src/view/FeedbackMath.test.js`, `src/components/Context/FormPanel.jsx`, `src/components/ContextDemo/ConflictMatrix.jsx`, `src/components/ContextDemo/NegotiationClusterView.jsx`, `src/components/Context/ContextLayer.jsx` |
| 測定器フィードバック / Checks タブ / checkResults 表示 / 受入チェック面 / blocked→pass フラッシュ / margin 惜しさメーター / checkMeter / checkStatusKeys / checkTransitions / projectChecks / ChecksPanel / テンプレート構造プレビュー / structurePreview / templateGalleryPreviews / cell_robotics 例 | ADR-062 Phase 4+5 (実装済), ADR-053 §9 (ベイク済オペランド), ADR-061 (惜しさ曲線の共有), `src/view/CheckFeedbackMath.js`, `src/view/TemplatePreviewMath.js`, `src/components/Context/ChecksPanel.jsx`, `src/service/ContextService.js` (`projectChecks`), `src/controller/ContextController.js` (`_templatePreviews`), `examples/cell_robotics_context.json` |
| grasp ゴースト / spatial ghost / グリッパグリフ / 接近ベクトル / approach vector / FRAME_CONVENTION / 能力ゲート / renderableEndEffectorFrame / hover プレビュー / 接近アニメ / 三拍リビール / revealFrame / pose kind union 消費 (endEffector/jointSpace) / 対象アウトライン | ADR-059 (Accepted, 段1 実装済), ADR-060, ADR-065 Phase 5 (三拍リビール), `src/view/GraspGhostMath.js`, `src/view/GraspGhostView.js`, `src/controller/GraspController.js` (`_syncGhost`/`hoverCandidate`/`disposeGhost`) |
| CI / テストゲート / PR ワークフロー / rigor 遡及 / prefers-reduced-motion / reduced motion / motion 削減 / flashStyle / useReducedMotion / E2E スモーク / Playwright / smoke / 配線の生死 / pnpm test glob 化 | ADR-064 (Accepted, Phase 1+2+3+4 実装済), ADR-062 (play 側の対), PHILOSOPHY #29/#20, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `src/view/FeedbackMath.js` (`flashStyle`), `src/theme/motion.js` (単一 matchMedia 境界 — ADR-065 Phase 1 で移設; `FeedbackPrimitives.jsx` は再 export), `playwright.config.js`, `e2e/smoke.spec.js` |
| DSL スキーマ昇格 / Layout·Context DSL JSON Schema 化 / conformance / additionalProperties:false / ドリフト束縛 / 形と意味の分離 / schema:validate | ADR-064 Phase 2 (実装済), PHILOSOPHY #29, `schema/layout-1.0.schema.json`, `schema/context-0.4.schema.json`, `schema/README.md`, `src/schema/LayoutSchema.test.js`, `src/schema/ContextSchema.test.js`; 意味検査は `src/layout/LayoutValidator.js` / `src/context/ContextValidator.js` に残る |
| scene JSON スキーマ / /api/scenes 検証 / scene-1.3 / Blender datablock / グラフ骨格 vs ジオメトリ blob / opaque base64 葉 / 未契約ワイヤ宣言 / ws·import 対象外 / BFF が版を刻む | ADR-064 Phase 3 (実装済), PHILOSOPHY #29, `schema/scene-1.3.schema.json`, `server/src/scenes/sceneContract.js`, `server/src/routes/scenes.js`, `src/schema/SceneSchema.test.js`, `server/test/scenes.contract.test.js`; 対象外宣言は `server/src/routes/import.js` / `server/src/ws/sessionManager.js` の冒頭 |
| 遊び心 / ワクワク感 / playfulness / 遊戯化 / モーション階層 / Motion Tier / Tier A / affordance motion / アフォーダンス・モーション / Tier D / delight tier / 歓びティア / 遊びの許容 / MotionGovernor / MotionMath / 演出予算 / transient 演出 / celebration / セレブレーション / デザイントークン / design tokens / tokens.js / パレット ドリフトテスト / `src/theme/` / motion.js 単一境界 / disabled-as-quest / コアモデリング演出 / 着地演出 / 音量設計 / volume corollary / voxel / VoxelBurst / dissolve / materialize / SAO 飛散 / グリッチ明滅 / lifecycleDescriptor / voxelFrame / _lifecycleAnchors / objectRemoved 第2引数 / pose 操作は無音 / LandingEffects / CommandFeedbackMath / setLandingListener / クローム刷新 / ロック状態 / locked / ゲート述語 reason / ChromeGates / ChromeMath / ChromePrimitives / useHoverPress / 押下バネ / press spring / hover 呼吸 / breathe / activeGlow / 呼吸グロー / enterMotion / トースト entry / disabled タップ理由 toast / 三拍リビール / three-beat reveal / revealFrame / REVEAL_TIMELINE / mixHex / RegionGhostMath / gapBandRects / regionResolveTransitions / resolveFrame / RegionResolveEffect / _refreshRegionGhosts / _buildRegionGhosts / 領域 recolor→dissolve / settled gap band / 不確実バンド extremes 収束 / 永続ゴースト reduced 対応 / スナップ係合フラッシュ / snap engagement flash / SnapFeedbackMath / SnapFlash / snapTransition / snapFlashFrame / _syncSnapFx / fxSnap / engage / retarget | ADR-065 (Accepted, **全 7 フェーズ + 全候補実装済** — スナップ係合フラッシュ完了 2026-07-12 でプログラム完結), PHILOSOPHY #30 (Motion Tier + volume corollary + delight tier — 2026-07-12: 「何も語らない動きは不採用」を緩め、意図的・予算内・reduced 対応の歓び演出を Tier D として許容), `src/theme/tokens.js`+`tokens.test.js`, `src/theme/motion.js`+`motion.test.js` (grep 固定の単一境界), `src/view/MotionMath.js`, `src/view/MotionGovernor.js`, `src/view/CommandFeedbackMath.js`, `src/view/LandingEffects.js`, `src/service/CommandStack.js` (`setLandingListener`/`depth`), `src/view/ChromeGates.js`+`ChromeMath.js` (Phase 3 純粋層), `src/components/Chrome/ChromePrimitives.jsx`, `src/view/CelebrationMath.js`+`CelebrationMath.test.js`+`CelebrationField.js`, `src/components/Feedback/Celebration.jsx` (Phase 4 — 遷移述語/バースト/節目), `src/view/GraspGhostMath.js` (`revealFrame`/`mixHex`)+`GraspGhostView.js`, `src/view/RegionGhostMath.js`+`RegionGhostMath.test.js`+`RegionResolveEffect.js`, `src/view/UncertaintyGhostView.js` (Phase 5 — 振付 + reduced), `src/view/SnapFeedbackMath.js`+`SnapFeedbackMath.test.js`+`SnapFlash.js` (Phase 2 完結 — 係合フラッシュ), ADR-062 (親方針・無改変継承) |
| オンボーディングツアー / onboarding tour / ツアー / quest card / クエスト / TourMath / TourCard / tour FSM / ee_tour / 次のアフォーダンス / 漸進ヒント / progressive hint / + Add パルス / uiStore.tour / startTour / nextTourState / tourVisible / tourAnchor / 設定 vs 履歴の永続線引き / Widening 3 / Getting started | ADR-065 Phase 6 (実装済 2026-07-11, named rule 6), `docs/STATE_TRANSITIONS.md` §tour, `docs/SCREEN_DESIGN.md` S-18, `src/view/TourMath.js`+`TourMath.test.js`, `src/components/Onboarding/TourCard.jsx` (モバイルは従来の `Onboarding.jsx`), `src/controller/AppController.js` (`_updateTour`/`_startTourIfNeeded`/`_tourFacts`), uiStore `tour`/`setTour`, `src/components/Outliner/Outliner.jsx` (+ Add アンカーパルス) |
| ビューポートステージ / 常設環境演出 / ambient stage / SceneStage / StageMath / 背景グラデーション / フォグ / fog / ダスト / dust / フロアグロー / リムライト / 起動リビール / boot reveal / BootReveal / 起動カメラフライト / flightFrame / dustField / dustDrift / entryEnvelope / fogDensityFor / Tier D 適用 / _finishBootReveal / external-write ガード | ADR-067 (Accepted, 実装済 — ADR-066 Tier D の最初の適用), ADR-066, `src/view/StageMath.js`+`StageMath.test.js`, `src/view/SceneStage.js`(SceneView 所有・`scene.background`/`fog` 単独書き手), `src/view/BootReveal.js`(MotionGovernor transient・割込み契約), `src/view/SceneView.js`(`stage`/`_updateGridScale` 連動), `src/controller/AppController.js` (`_finishBootReveal`/start spawn/stage tick) |
| カメラフォーカスフライト / focus selection / frame selected / fly-to-selection / F キー / Home キー / ダブルクリックで寄る / CameraFlight / CameraMath / focusPose / lerpVec / scene framing vs selection framing / 生きた選択 / select pulse / 選択パルス / SelectPulse / hover affordance / 実体ホバー / setHovered / _hovered / トースト退場フェード / exitMotion / eaChromeExit / Grasp バー transition / Outliner scrollIntoView | ADR-068 (Accepted, 実装済), ADR-067 (BootReveal 系譜), `src/view/CameraMath.js`+`CameraMath.test.js`, `src/view/CameraFlight.js`, `src/view/SelectPulse.js`, `src/view/SceneView.js` (`focusPose`/`fitCameraToSphere` は同一導出源・グリッドは scene framing 専属), `src/view/MeshView.js` (`_syncEmissive` 3 フラグ), `src/controller/AppController.js` (`focusSelection`/`_focusSphere`/`_finishCameraFlight`/`_setHoveredEntity`/`_onDblClick`), `src/view/ChromeMath.js` (`exitMotion`), polish: `src/components/{UIShell.jsx,Grasp/GraspSearchPanel.jsx,Outliner/Outliner.jsx}` |
| エンティティ同一性 / entity identity / 3D ラベル / floating label / EntityLabel / setLabelText / setIfcTint / IFC ティント / IFC 活用 / IFC クラス可視化 / CF ラベル情報化 / RPY 読み出し / _syncLabel / _syncIdentityVisuals / _newMeshView / ee-entity-label / 段階開示ラベル | ADR-070 (Accepted, 決定2=A 実装済; B フル産業は別 ADR 候補), ADR-025, `src/view/EntityLabel.js`, `src/view/MeshView.js` (`setIfcTint`/`_syncLabel`), `src/view/ImportedMeshView.js`, `src/view/CoordinateFrameView.js` (`_syncLabelText`), `src/service/SceneService.js` (`_newMeshView`/`_syncIdentityVisuals`), `src/domain/IFCClassRegistry.js` |
| 配置既定 / placement defaults / スタック既定 ON / stack default / stack assist / 地面下 / below grade / ground clearance / checkGroundClearance / warnIfBelowGrade / groundWarned / 地面着地 / Free place / S キー反転 / 基礎 杭 footing pile | ADR-071 (Accepted, 案A アシスト既定 実装済), `src/controller/handler/GrabOperationHandler.js` (`stackMode`/`_applyStackSnap`/`warnIfBelowGrade`), `src/service/SceneService.js` (`checkGroundClearance`), `src/controller/UIStateManager.js` (Stack/Free ボタン) |
| 2D マップ研磨 / Map Mode / MapModeController / 正射影 / ortho camera / 投影スワップ / projection swap / frustumForDistance / distanceForFrustum / マップ配置 undo / AddAnnotationCommand / マップ出入りフライト / _completeEnterSwap / マップ端点スナップフラッシュ / _syncSnapFx / MapPreviewMath / カーソル呼吸 / cursorFrame / ringFrame / リング出現セトル | ADR-072 (Accepted, 実装済 + 洗練 Addendum — ADR-069 Phase 4 = パリティ・パス完結), ADR-031 (三状態描画), `src/controller/map/MapModeController.js` (`tick`), `src/command/AddAnnotationCommand.js`, `src/view/CameraMath.js` (`frustumForDistance`/`distanceForFrustum`), `src/view/CameraFlight.js` (加算的 `onDone`), `src/view/MapPreviewMath.js`+テスト |
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
- WASM build lanes are **not** needed for `pnpm build` (= `vite build` only; both lanes ship committed artifacts in `src/engine/`, and CI/deploy consume those artifacts — ADR-064 Phase 1, ADR-053 §11). To regenerate them run `pnpm setup:toolchain` once (installs wasm-pack + Emscripten SDK + inits `robotics-wasm/vendor` submodules), then `pnpm build:full` (Rust wasm regen + vite build) or the individual lanes `pnpm build:wasm` (Rust) / `pnpm build:robotics-wasm` (C++ KDL+ruckig → `src/engine/robotics-wasm/`). On a fresh clone run `git submodule update --init --recursive` before the C++ build.
- The neutral I/O contract `@easy-extrude/grasp-contract` is vendored as a **git submodule** at `vendor/grasp-contract` (a pnpm-workspace package the BFF depends on as `workspace:*`). A fresh clone needs `git submodule update --init --recursive`. The BFF only *derives* from it: `pnpm --filter easy-extrude-bff run gen:contract-types` regenerates the committed `.d.ts` from the schema, and `pnpm test:contract` runs the conformance + contractVersion-drift tests. Never edit the contract here — change it upstream and bump `contractVersion`.

@docs/PHILOSOPHY.md

## Session history

Full log → `docs/SESSION_LOG.md`. **ここには直近 3 件のみ、各 1–3 行の要約で記録する**
（全文は SESSION_LOG.md 側に書く — CLAUDE.md は 40k 文字制限があり、長文履歴が主因で超過した実績あり）。

- **2026-07-16** (2): Bugfix/UX — **マップモード カメラ復帰 + 配置粒度（ADR-072 Addendum C/D・実装済）**。ユーザ feedback 2 件: ①マップモードから戻るとカメラがリセットされず動ける姿勢範囲が変わる ②マップ配置グリッドが粗い。**修正 C**: `CameraFlight` が完了コールバック `onDone` を `_land()`（終端カメラ書き込み）の**前**に発火していた（`_markDone(); _land()`）→ フライト中断（ツール即クリック）や reduced motion 時、Map exit が読む `_stagedPos` がフライト途中ポーズを捕捉 → external-write ガードが誤発火し `flyToView(saved)` をスキップ → カメラ非復帰。修正は三経路すべて `_land(); _markDone()` に順序反転 + 契約明文化。**修正 D**: `_pickPoint` の固定 `GRID=1.0` を新純関数 `MapPreviewMath.mapGridStep(frustumSize)`（`frustumSize/50` 以下の最大 1/2/5×10^k; frustum 50→1.0 回帰なし・2→0.02 細かい・500→10）へ = ズームインで配置粒度が上がる（地面グリッド #27 と同規律）。docs: ADR-072 Addendum C/D + CODE_CONTRACTS §1 新 2 行 + PHILOSOPHY Yellow Card（callback は報告する状態の確定後に発火）+ `__easyExtrude.cameraState()` デバッグ/E2E アクセサ。Evidence: unit **653 pass**（+5）/ typecheck clean / build clean / E2E **11 pass**（map テストを enter フライト中断→配置→退出後カメラ pre/post 一致 assert に変更 — fix なしで fail 実証済）。契約・schema・DSL 版・BFF 無改変。（全文 → SESSION_LOG）
- **2026-07-16**: UX/Bugfix — **2D マップ視認性修正（ADR-072 Addendum・実装済）**。ユーザ feedback: マップ Top view で Cube/オブジェクトが黒く配置不明、かつマップオブジェクトが Move で空中に浮く。**根因はシェーディングでなく `FogExp2` 深度フォグ**: 正射影カメラは z≈0 のマップ平面の固定 100 単位上に据わるが、フォグ密度は透視カメラの短スタンドオフ用チューニング → 深度 100 で ~99.7% 減衰し全材質が近黒 `0x15152a` へ（#27 と同型のカメラ想定破綻）。**修正 A**: `SceneStage.setFogSuspended(bool)`（`scene.fog` を `_fog`⇄`null`・所有維持 #4）を `SceneView.useOrthoCamera(enable)` 両分岐で呼ぶ = 「フォグ off ⇔ 正射影稼働」を単一箇所で保証。**修正 B**: マップオブジェクト（注釈）を全頂点同一 Z の平板とし Z=`max(建物天面,0)`。下向きレイ単一源 `SceneService.highestSurfaceZAt`（`_applyStackSnap` から抽出・核 §1.1）を配置（`_confirmDrawing`）と Move（`applyPreviewTranslation` 注釈分岐 → `_mapObjectPlateDelta` が XY のみ移動 + `worldDelta` の Z 破棄）が共有 = 配置も Move も浮かない。docs: ADR-072 Addendum + CODE_CONTRACTS §1 新 2 行 + PHILOSOPHY Yellow Card。Evidence: unit **648 pass** / typecheck clean / build clean / E2E **11 pass**（map テストにアンカー G グラブ移動追加）+ 視覚確認（マップ面で Cube が基調色で明瞭）。契約・schema・DSL 版・BFF 無改変。（全文 → SESSION_LOG）
- **2026-07-15** (2): UX — **UX パリティ・パス Phase 4 = 2D マップ研磨（ADR-072 Accepted・実装済 — ADR-069 パス完結）**。マップ面に残る 3 統治ギャップを既存部品の再利用で閉鎖。**カメラ**: Map Mode 出入りの 1 フレームカット（motion 系を迂回する最後のカメラ面）を「一致ポーズでの投影スワップ + CameraFlight」へ — 純関数 `frustumForDistance`/`distanceForFrustum`（CameraMath, round-trip machine-pin）でフレーミング一致を導出、enter はギズモと同じ `flyToView` 契約で真上ステージングへ飛び `CameraFlight` の加算的 `onDone`（着地/finish/stolen/eviction いずれでも 1 回 = 終端状態保証 #11）でスワップ; exit は現 ortho 中心/ズームから一致透視ポーズを即時組立→スワップ→保存ポーズへ復帰フライト（`_stagedPos` external-write ガード）。**undo**: マップ配置が CommandStack を迂回する唯一の add 経路だった → `createAddAnnotationCommand` を post-hoc push; ラベル `Add "…"` が既存 lifecycle 語彙 `/^Add "/` に合流し materialize/dissolve が演出側変更ゼロで発火（核 §1.1）。**スナップ**: 端点スナップ係合フラッシュを `SnapFeedbackMath`+`SnapFlash` 丸ごと再利用（frustum 比例半径 #27・`_snapFxPrev` controller-local）。docs: ADR-072 + README 索引 + ADR-069 Status 完結 + CODE_CONTRACTS §1 新 2 行 + EVENTS undo 表。**洗練パス（同日 /animation-fx ゲート適用）**: 描画カーソルに entry ポップ×2 周波呼吸・スナップリングに出現セトル（Tier A — 純粋 `MapPreviewMath.js`+5 テスト; reduced=恒等スケール; ロックは呼吸しない・retarget 再ポップなし）、`_animate` tick 列に合流。Evidence: unit **648 pass**（CameraMath +3・MapPreviewMath +5）/ typecheck clean / build clean / E2E **11 pass**（新規: map enter フライト→Anchor 配置→confirm→undo 往復 liveness）。契約・schema・DSL 版・BFF 無改変。（全文 → SESSION_LOG）
