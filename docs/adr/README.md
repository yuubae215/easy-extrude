# Architecture Decision Records (ADR)

This directory records the project's design decisions.

## Rules

- File naming: `ADR-NNN-kebab-case-title.md`
- Status: `Proposed` / `Accepted` / `Deprecated` / `Rejected` / `Superseded by ADR-NNN`
- When superseding a decision, update the old ADR's status and add a new ADR (do not delete)

## Index

| No. | Title | Status | Date | Related |
|-----|-------|--------|------|---------|
| [ADR-001](ADR-001-voxel-based-shape-representation.md) | Voxel-based Shape Representation | **Superseded by ADR-007** | 2026-03-20 | ADR-007 |
| [ADR-002](ADR-002-two-modeling-methods.md) | Two Modeling Methods (Primitive Box / Sketch→Extrude) | Accepted | 2026-03-20 | ADR-004, ADR-007 |
| [ADR-003](ADR-003-orbit-control-middle-click.md) | Orbit Control Migrated to Middle-Click | **Rejected** | 2026-03-20 | ADR-006 |
| [ADR-004](ADR-004-edit-mode-adapts-to-object-type.md) | Edit Mode Adapts to Object Type | Accepted | 2026-03-20 | ADR-002, ADR-005 |
| [ADR-005](ADR-005-object-hierarchy-dimensional-classification.md) | Object Hierarchy with 1D/2D/3D Dimensional Classification | Accepted | 2026-03-20 | ADR-004 |
| [ADR-006](ADR-006-right-click-cancel-context-menu.md) | Right-Click = Cancel / Context Menu | Accepted | 2026-03-20 | — |
| [ADR-007](ADR-007-cuboid-based-shape-representation.md) | **Cuboid-based Shape Representation** | Accepted | 2026-03-20 | ADR-001 |
| [ADR-008](ADR-008-mode-transition-state-machine.md) | **Mode Transition State Machine — Logical Consistency Policy** | Accepted | 2026-03-20 | ADR-002, ADR-004 |
| [ADR-009](ADR-009-domain-entity-types-cuboid-sketch.md) | **Domain Entity Types: Cuboid / Sketch** | **Superseded by ADR-020** (renamed to Solid / Profile) | 2026-03-20 | ADR-002, ADR-005, ADR-007, ADR-020 |
| [ADR-010](ADR-010-domain-entity-behaviour-methods.md) | **Domain Entity Behaviour Methods (DDD Phase 2)** | Accepted | 2026-03-20 | ADR-009 |
| [ADR-011](ADR-011-application-service-scene-service.md) | **Introducing the ApplicationService Layer — SceneService (DDD Phase 3)** | Accepted | 2026-03-20 | ADR-009, ADR-010 |
| [ADR-012](ADR-012-graph-based-geometry-model.md) | **Graph-based Geometry Model (Vertex / Edge / Face / Solid)** | Accepted | 2026-03-20 | ADR-005, ADR-009, ADR-011 |
| [ADR-013](ADR-013-domain-events-scene-service-observable.md) | **Domain Events — Making SceneService Observable (DDD Phase 4)** | Accepted | 2026-03-20 | ADR-011, ADR-010 |
| [ADR-014](ADR-014-edit-mode-sub-element-selection.md) | **Edit Mode Sub-Element Selection (DDD Phase 6)** | Accepted | 2026-03-20 | ADR-004, ADR-012 |
| [ADR-015](ADR-015-bff-microservices-architecture.md) | **BFF + Microservices Architecture** | Accepted | 2026-03-20 | ADR-011, ADR-012, ADR-013 |
| [ADR-016](ADR-016-transform-graph-scene-relationships.md) | **Transform Graph — Spatial Relationships Between Scene Objects** | Accepted | 2026-03-21 | ADR-012, ADR-015 |
| [ADR-017](ADR-017-websocket-session-geometry-service.md) | **WebSocket Session Design and Geometry Service (Phase B)** | Accepted | 2026-03-21 | ADR-015, ADR-016 |
| [ADR-018](ADR-018-coordinate-frame-entity.md) | **Coordinate Frame Entity — Object Origin Hierarchy** | Accepted | 2026-03-23 | ADR-005, ADR-009, ADR-011, ADR-013, ADR-016 |
| [ADR-019](ADR-019-coordinate-frame-phase-b.md) | **CoordinateFrame Phase B — Nested Hierarchy and Rotation Editing** | Accepted | 2026-03-23 | ADR-005, ADR-008, ADR-016, ADR-018 |
| [ADR-020](ADR-020-domain-entity-taxonomy-redesign.md) | **Domain Entity Taxonomy Redesign — Solid / Profile / Frame / Annotation** | Accepted | 2026-03-25 | ADR-007, ADR-009, ADR-010, ADR-012, ADR-018, ADR-019 |
| [ADR-021](ADR-021-unified-local-geometry-graph-interface.md) | **Unified Local-Geometry Graph Interface — extend graph model to MeasureLine and Profile** | Accepted | 2026-03-25 | ADR-012, ADR-020 |
| [ADR-022](ADR-022-undo-redo-command-pattern.md) | **Undo / Redo via Command Pattern** | Accepted | 2026-03-26 | ADR-008, ADR-010, ADR-011, ADR-012 |
| [ADR-023](ADR-023-mobile-input-model.md) | **Mobile Input Model — Touch Gesture Model and Device Detection** | Accepted | 2026-03-29 | ADR-003, ADR-006, ADR-014 |
| [ADR-024](ADR-024-mobile-toolbar-architecture.md) | **Mobile Toolbar Architecture — Fixed-Slot Layout and Context-Sensitive Actions** | Accepted | 2026-03-29 | ADR-008, ADR-023 |
| [ADR-025](ADR-025-ifc-semantic-classification.md) | **IFC Semantic Classification of Scene Objects** | Accepted | 2026-04-01 | ADR-020, ADR-021, ADR-022, ADR-013 |
| [ADR-026](ADR-026-lynch-urban-classification.md) | **Lynch Urban Classification of 2D Map Objects** | **Superseded by ADR-029** | 2026-04-01 | ADR-029 |
| [ADR-027](ADR-027-wasm-geometry-engine.md) | **Wasm Geometry Engine — Three-Layer Architecture with Zero-Copy Data Path** | Accepted | 2026-04-05 | ADR-007, ADR-012, ADR-017 |
| [ADR-028](ADR-028-anchored-annotations-scene-graph.md) | **Anchored Annotations & Scene Graph API** | Accepted | 2026-04-06 | ADR-012, ADR-016, ADR-018, ADR-019, ADR-021 |
| [ADR-029](ADR-029-spatial-annotation-system.md) | **Spatial Annotation System — AnnotatedLine/Region/Point with Place Types** | Accepted | 2026-04-08 | ADR-020, ADR-021, ADR-022, ADR-025, ADR-013, ADR-028 |
| [ADR-030](ADR-030-spatial-link.md) | **SpatialLink — Typed Semantic Edges Between Annotated Elements** | Accepted | 2026-04-09 | ADR-029, ADR-028, ADR-013, ADR-020, ADR-022 |
| [ADR-031](ADR-031-map-mode-interaction-model.md) | **Map Mode Interaction Model & Visual Language** | Accepted | 2026-04-11 | ADR-023, ADR-024, ADR-029, ADR-006 |
| [ADR-032](ADR-032-geometric-host-binding.md) | **Geometric Host Binding — Map Elements Mounted on Scene Objects** | Accepted | 2026-04-13 | ADR-029, ADR-030, ADR-016, ADR-018, ADR-019 |
| [ADR-033](ADR-033-coordinate-frame-phase-c.md) | **CoordinateFrame Phase C — Interface Contract Model** | Accepted | 2026-04-15 | ADR-018, ADR-019, ADR-032, ADR-030 |
| [ADR-034](ADR-034-coordinate-frame-placement-policy.md) | **CoordinateFrame Placement and Pose Policy** | Accepted | 2026-04-20 | ADR-033, ADR-032, ADR-030, ADR-018, ADR-019 |
| [ADR-035](ADR-035-fastened-chain-propagation.md) | **Fastened Constraint CF-Chain Propagation and Cycle Detection** | Accepted | 2026-05-02 | ADR-032, ADR-033, ADR-030, ADR-018, ADR-019 |
| [ADR-036](ADR-036-solid-arbitrary-rotation.md) | **Solid Arbitrary Rotation — R key, Corner-Baking** | **Partially Superseded by ADR-040** | 2026-05-02 | ADR-007, ADR-019, ADR-022, ADR-012, ADR-040 |
| [ADR-037](ADR-037-body-frame-architecture.md) | **Body Frame Architecture — CF-Primary Entity Model** | Accepted | 2026-05-07 | ADR-018, ADR-019, ADR-033, ADR-034, ADR-035, ADR-036 |
| [ADR-038](ADR-038-urdf-link-taxonomy.md) | **URDF-Style Link Taxonomy: Kinematic + Semantic Two-Layer Classification** | Accepted | 2026-05-08 | ADR-030, ADR-032, ADR-016, ADR-037 |
| [ADR-039](ADR-039-operation-state-machine.md) | **Runtime Operation State Machine — FSM-First Design Pattern** | Accepted | 2026-05-09 | ADR-008, ADR-022, ADR-030 |
| [ADR-040](ADR-040-solid-data-model-redesign.md) | **Solid Data Model Redesign — Primary Triple (_position, orientation, localCorners)** | Accepted | 2026-05-14 | ADR-036, ADR-035, ADR-022, ADR-012 |
| [ADR-041](ADR-041-semantic-inference-suggestions.md) | **Semantic Inference Suggestions — Geometric Heuristics for SpatialLink Proposals** | Accepted | 2026-05-17 | ADR-030, ADR-038, ADR-039 |
| [ADR-042](ADR-042-unified-entity-transform-mental-model.md) | **Unified Entity Transform Mental Model — Fixed-Slot Transform Policy** | Accepted | 2026-05-20 | ADR-023, ADR-024, ADR-037, ADR-039, ADR-040 |
| [ADR-043](ADR-043-2d-3d-spatial-link-semantics.md) | **2D/3D Spatial Link Semantics — `bounded_by` and Clearance Evaluation** | Draft | 2026-05-21 | ADR-029, ADR-030, ADR-038 |
| [ADR-044](ADR-044-5w1h-function-mapping.md) | **5W1H Function Mapping — Homomorphic Bridge Between Natural Language and Automation** | Draft | 2026-06-01 | ADR-030, ADR-039, ADR-041, ADR-022 |
| [ADR-045](ADR-045-external-layout-api.md) | **External Layout API — CLI/REST-Driven Scene Composition via Layout DSL** | Accepted | 2026-06-09 | ADR-044, ADR-015, ADR-022, ADR-030, ADR-037, ADR-040 |
| [ADR-046](ADR-046-context-dsl.md) | **Context DSL — 要件文脈の一級データ構造化と仕様への追跡可能コンパイル** | Draft | 2026-06-10 | ADR-044, ADR-045, ADR-037, ADR-030, ADR-047 |
| [ADR-047](ADR-047-context-demo-layer.md) | **Context Demo Layer — 要求文脈の可視化オーバーレイ (UncertaintyGhost / Inspector / StoryBar)** | Accepted | 2026-06-11 | ADR-046, ADR-045, ADR-040, ADR-041 |
| [ADR-048](ADR-048-link-network-layered-layout.md) | **Link Network 決定的階層レイアウト — 力学レイアウト廃止と親子構造の可視化** | Accepted | 2026-06-12 | ADR-030, ADR-037, ADR-038 |
| [ADR-049](ADR-049-requirement-conflict-model.md) | **Requirement / Conflict モデル — KPI 由来の許容領域・衝突検出・交渉クラスター** | Accepted | 2026-06-14 | ADR-046, ADR-047, ADR-044, ADR-035 |
| [ADR-050](ADR-050-context-first-project-model.md) | **Context-First Project Model — 要求/衝突/交渉 の PoC から本番機能化** | Accepted | 2026-06-14 | ADR-049, ADR-046, ADR-047, ADR-045, ADR-022, ADR-013, ADR-011 |
| [ADR-051](ADR-051-requirement-intake.md) | **要件入力（Requirement Intake）— あいまい要件を起点化する複数入口アーキテクチャ** | Accepted (全 4 フェーズ実装済) | 2026-06-16 | ADR-052, ADR-050, ADR-049, ADR-047, ADR-046, ADR-044, ADR-022, ADR-013 |
| [ADR-052](ADR-052-5w1h-ubiquitous-language.md) | **5W1H ユビキタス言語 — NL ⇄ データの Mutual 構造（Why ルートの正準ツリー）** | Accepted (Phase 1 + Phase 2 + Phase 3 + Phase 4 実装済) | 2026-06-17 | ADR-046, ADR-044, ADR-049, ADR-048, ADR-050, ADR-051 |
| [ADR-053](ADR-053-robotics-kpi-methods.md) | **ロボティクス KPI メソッド — 測定器としての運動学/軌道/干渉計算と可視検証ループ** | Accepted (Phase 1+2+3 実装済) | 2026-06-20 | ADR-038, ADR-047, ADR-049, ADR-052, ADR-027, ADR-015, ADR-017 |
| [ADR-054](ADR-054-ui-dsl-bff-grasp-walkthrough.md) | **UI → DSL → BFF → Grasp API Verification Walkthrough** | Accepted | 2026-06-22 | ADR-045, ADR-050, ADR-046, ADR-015, ADR-017, ADR-053 |
| [ADR-055](ADR-055-scene-layout-dsl-mutual.md) | **Scene ⇄ Layout DSL Mutual — a Normal-Form Inverse for the Geometry Layer** | Accepted (Phase 1 実装済) | 2026-06-22 | ADR-045, ADR-052, ADR-050, ADR-054, ADR-040, ADR-037, ADR-038 |
| [ADR-056](ADR-056-computable-structural-isomorphism.md) | **Computable Structural Isomorphism on the Synonym Quotient — Canonical Form, Diff, Reconcile** | Accepted (実装済) | 2026-06-23 | ADR-052, ADR-055, ADR-044, ADR-050, ADR-051, ADR-049 |
| [ADR-057](ADR-057-grasp-search-ui.md) | **Grasp Search UI — 右ドックの宣言/検証パネル（スコア優先・ゴーストは後続）** | Accepted (実装済) | 2026-06-30 | ADR-054, ADR-050, ADR-047, ADR-053, ADR-049, ADR-052, ADR-055 |
| [ADR-058](ADR-058-context-authoring-fork-and-tweak.md) | **Context オーサリング UX — 例を土台に編集する（fork & tweak）** | Accepted (Phase 1 + seed chips + UX 具体化 実装済) | 2026-06-30 | ADR-051, ADR-050, ADR-046, ADR-049, ADR-052, ADR-057 |
| [ADR-059](ADR-059-grasp-candidate-spatial-ghost.md) | **Grasp 候補の空間ゴースト — 数値を「掴める姿」に翻訳する（段階化）** | Accepted (段1 実装済 2026-07-03; 段2 は門2 待ち) | 2026-06-30 | ADR-057, ADR-053, ADR-047, ADR-054, ADR-045, ADR-060 |
| [ADR-060](ADR-060-grasp-contract-data-governance.md) | **Grasp Contract のデータ構造統治 — 決定層は閉、pose は kind 判別の有界 union** | Accepted (upstream 実装済み確認 2026-07-01; 本リポジトリ追従済 2026-07-03 — BFF 型再生成 + 消費コード ADR-059 段1) | 2026-06-30 | ADR-059, ADR-057, ADR-054, ADR-056 |

## How to Add a New ADR

1. Assign the next sequence number (`NNN = max + 1`)
2. Create the file: `ADR-NNN-title.md`
3. **Add a row to the index table in this README**
4. Add a reference in related existing ADRs' `References` section
5. Commit and push
