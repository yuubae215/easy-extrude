# Roadmap

## Design Direction (2026-03-20, updated 2026-04-11)

This project is a **solid-body modeling application**. Each shape is a deformable solid defined by a LocalGeometry graph (vertices / edges / faces). Complex scenes are built by placing and deforming multiple solid objects alongside coordinate frames and measurement annotations. See `docs/adr/` for detailed design decisions.

---

## Spatial Annotation System (ADR-029)

Generic 2D annotation entities for city, building, and part-level scales:
`AnnotatedLine` (linear), `AnnotatedRegion` (areal), `AnnotatedPoint` (point),
classified by place type: Route / Boundary / Zone / Hub / Anchor.

Domain layer (entities, registry, service, serializer) is complete.
The phases below cover the rendering and UI layers.

### Phase 1 — Rendering layer ★ prerequisite for all UI

| Task | Details | ADR |
|------|---------|-----|
| `AnnotatedLineView` | Three.js `Line2` (fat line) with configurable stroke color; BoxHelper for selection | ADR-029 |
| `AnnotatedRegionView` | Three.js `Line2` closed ring + translucent fill `Mesh` (ShapeGeometry); BoxHelper | ADR-029 |
| `AnnotatedPointView` | Three.js `Sprite` or `Mesh` (flat circle / diamond); label HTML overlay | ADR-029 |
| Wire views into `SceneService.create*` | Replace `meshView = null` with constructed view; add `scene.add` / `dispose` | ADR-029 |
| `AppController` instanceof guards | Grab (G key) allowed; Edit Mode blocked (no sub-element editing yet); Stack blocked | ADR-029 |

### Phase 2 — Classification UI (N-panel + Outliner)

| Task | Details | ADR |
|------|---------|-----|
| Outliner type icons | `⟿` for AnnotatedLine, `⬡` for AnnotatedRegion, `⬤` for AnnotatedPoint | ADR-029 |
| Outliner place-type badge | Coloured badge next to name when `placeType` is set | ADR-029 |
| N-panel "Place Type" section | Badge + Set/Change button + clear button; shown for all three entity types | ADR-029 |
| Place-type picker overlay | Grouped list filtered by geometry type (`getPlaceTypesByGeometry`); search input | ADR-029 |
| `SetPlaceTypeCommand` wired to controller | `AppController` subscribes `objectPlaceTypeChanged`; forwards to OutlinerView | ADR-029 |

### Phase 3 — Creation UX

> **Superseded by ADR-031** for interaction model details.
> The tasks below are preserved for reference; implementation follows ADR-031 §2–§7.

| Task | Details | ADR |
|------|---------|-----|
| "Annotate" submenu in Add menu (Shift+A) | Entries: Route, Boundary, Zone, Hub, Anchor (geometry type inferred from selection) | ADR-029 |
| Placement interaction model | Three-state drawing model; platform-differentiated (Mobile = drag, PC = multi-click/drag); see ADR-031 | ADR-031 |
| Naming before confirm | Name input in Map toolbar during `pending` state; default "{PlaceType} N" | ADR-031 |
| Mobile toolbar for annotation placement | Fixed-slot layout during `drawing` + `pending`; Confirm + Cancel slots | ADR-024, ADR-031 |

---

## SpatialLink (ADR-030)

Typed semantic edges between annotated elements — makes spatial relationships
machine-readable in the scene graph. Design defined in ADR-029 §Out of scope;
full specification in ADR-030.

### Phase 1 — Domain layer ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| `SpatialLink` domain entity | `id`, `sourceId`, `targetId`, `linkType` (`references` / `connects` / `contains` / `adjacent`); no geometry | ADR-030 |
| `SceneService.createSpatialLink()` / `detachSpatialLink()` / `reattachSpatialLink()` | Emits `spatialLinkAdded` / `spatialLinkRemoved`; stored in `SceneModel._links` | ADR-030 |
| `CreateSpatialLinkCommand` / `DeleteSpatialLinkCommand` | Undo/redo support; factory naming convention; detach/reattach pattern (no meshView) | ADR-030, ADR-022 |
| `SceneSerializer` + `SceneExporter` + `SceneImporter` | `"links": [...]` top-level array; scene version bump to 1.2; backward-compatible load (missing links → []) | ADR-030 |

### Phase 2 — Scene graph integration ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| `getSceneGraph()` extension | Include SpatialLinks as `relation: 'spatial'` edges with `linkType` field | ADR-030, ADR-028 |
| `SceneService.getLinksOf(entityId)` | Query helper: return all links where `sourceId` or `targetId` matches | ADR-030 |

### Phase 3 — Rendering ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| `SpatialLinkView` | Three.js dashed line/arrow between source and target world centroids; updates per animation frame | ADR-030 |
| Color-coded by `linkType` | `references`=amber, `connects`=cyan, `contains`=violet, `adjacent`=slate | ADR-030 |
| Polymorphic interface completeness | No-op stubs for all AppController-called MeshView methods (PHILOSOPHY #17) | ADR-030 |

### Phase 4 — Creation UI ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| Two-phase `L`-key link creation | Select source → `L` key → click target → linkType picker overlay → confirm | ADR-030 |
| N-panel "Spatial Links" section | List all links for selected entity with delete button per link | ADR-030 |
| Outliner badge for linked entities | Small `⟡` icon when entity participates in ≥ 1 SpatialLink | ADR-030 |
| `AppController` guards | Block Grab / Edit / Stack / Dup for `SpatialLink`; `showToast()` on blocked ops | ADR-030 |

---

## Spatial Node Editor Strategy (ADR-030 × ADR-016/017)

SpatialLink (ADR-030) と Node Editor (ADR-016/017) は、同じシーンオブジェクトに対する
**異なる抽象レベルのグラフ表現**である。

| レイヤー | エッジ種別 | 意味 | 効果 |
|---------|-----------|------|------|
| 意味的 (Semantic) | SpatialLink (`references`/`connects`/`contains`/`adjacent`) | 人間が読む意図 | なし — アノテーションのみ |
| 計算的 (Computational) | OperationGraph (BFF Phase D) | 形状依存関係 | サーバサイド計算を駆動 |
| 構造的 (Structural) | TransformGraph `'frame'` エッジ | SE(3) 親子 | 世界座標を駆動 |

三者はすでに `getSceneGraph()` (ADR-028) という統一データソースを共有している。
ADR-016 §4 の Extension path もこの方向を示唆している。

戦略的な機会は、**Node Editor パネルを三レイヤー統合グラフエディタとして育てる**ことにある。
それにより SpatialLink Phase 4 の `L` キー作成フローと、BFF Phase D の DAG 編集 UI が
「グラフに辺を追加する」同一 UX として収束し、二重実装を避けられる。

### Phase S-1 — Node Editor パネルへの統合シーングラフ表示

| タスク | 詳細 | ADR |
|--------|------|-----|
| Node Editor が `getSceneGraph()` を読む | シーンエンティティをノード、`'frame'`/`'anchor'`/`'spatial'` エッジをレイヤー別に描画 | ADR-016, ADR-028, ADR-030 |
| エッジ視覚語彙 | SpatialLink は既存の linkType 配色 (amber/cyan/violet/slate) を継承; OperationGraph エッジは別スタイル (例: 白実線) | ADR-030, ADR-017 |
| レイヤーフィルタトグル | 各エッジ種別の表示/非表示を独立切替; 大規模シーンの視覚的複雑度を低減 | — |
| 読み取り専用 (Phase S-1) | 表示のみ; トポロジー編集は Phase S-2 以降 | — |

### Phase S-2 — Node Editor パネルでの SpatialLink 編集

| タスク | 詳細 | ADR |
|--------|------|-----|
| ノード接続で SpatialLink 作成 | ソースノードのポートからドラッグ → ターゲットノードにリリース → linkType ピッカーオーバーレイ | ADR-030 §8 (代替作成フロー) |
| エッジ選択で SpatialLink 削除 | パネル上のエッジ選択 → Delete キー → `DeleteSpatialLinkCommand` | ADR-030, ADR-022 |
| `L` キーフローとの同期 | 両フローが同じ `CreateSpatialLinkCommand` を push する; 重複なし | ADR-030 |

### Phase S-3 — 意味的エッジの計算的エッジへのアップグレード

SpatialLink の意味型を起点に、段階的に「計算的効果を持つ構造」へ昇格させるパス。

| タスク | 詳細 | ADR |
|--------|------|-----|
| `references` → CoordinateFrame 親子化 | `references` エッジのコンテキストメニュー「親フレームとして昇格」→ `SpatialLink` を保持したまま `CoordinateFrame.parentId` を設定 | ADR-018, ADR-019, ADR-030 |
| `connects` → 拘束 (revolute / prismatic) | `connects` エッジから「拘束を追加」→ 拘束種別ピッカー → バックログの Revolute/Prismatic Constraint 実装を起動 | ADR-016 |
| アップグレードは非破壊的 | 元の SpatialLink は新しい構造的/計算的エッジと並存; ユーザーはいつでも降格できる | — |

> **設計上の注意**: アップグレードは SpatialLink を削除しない。意味的記述と計算的効果を
> 独立した関心として保持することで、PHILOSOPHY #3 (純粋計算と副作用の分離) を尊重する。

### Phase S-4 — 統合グラフ編集 (BFF Phase D Node Editor 項目を包含)

| タスク | 詳細 | ADR |
|--------|------|-----|
| DAG トポロジー編集 | Node Editor パネルで OperationGraph エッジを作成/削除; BFF Phase D の「Node Editor — DAG topology editing UI」を直接達成 | ADR-017 |
| 混在レイヤーグラフビュー | TransformGraph (構造) / SpatialLink (意味) / OperationGraph (計算) を単一キャンバス上にレイヤー切替表示 | ADR-016, ADR-028, ADR-030 |
| BFF Phase D 項目の置換え | Phase S-4 が完成したら「Node Editor — DAG topology editing UI」を BFF Phase D テーブルから削除し、このロードマップ項目に統合 | ADR-015, ADR-017 |

### アーキテクチャ上の前提

`getSceneGraph()` はすでに三レイヤー全体の統一データソースである。
Phase S-1 は新規データパイプライン不要 — Node Editor パネルの描画ターゲット追加のみ。
Phase S-2/S-3 は既存のコマンド/イベントシステムを拡張するだけで新規ドメイン概念を要しない。
**新 ADR は Phase S-3 (拘束ソルバー設計) および Phase S-4 (統合グラフ編集 UI) の着手前に作成する。**

---

## Map Mode Interaction Model (ADR-031)

Full design specification in `docs/adr/ADR-031-map-mode-interaction-model.md`.
Implements a unified three-state drawing model (`idle → drawing → pending → confirm`)
with platform-differentiated interaction and redesigned animations.

### Phase M-1 — Visual state language

| Task | Details | ADR |
|------|---------|-----|
| Pending state dashed line style | `AnnotatedLineView` / `AnnotatedRegionView`: add dashed `LineMaterial` variant; switch to dashed on `setPending(true)` | ADR-031 §3 |
| Pending state opacity | Set opacity to 90% (vs drawing 70% / confirmed 100%) | ADR-031 §3 |
| Pending stops rubber-band | On `pointerup` / Enter: freeze preview at current geometry, stop cursor following | ADR-031 §1 |

### Phase M-2 — Naming before confirm

| Task | Details | ADR |
|------|---------|-----|
| Name input in Map toolbar during `pending` | Add text-input slot to `showMapToolbar()`; shown only in `pending` state | ADR-031 §4 |
| Default name generation | Per-type counter: "Route 1", "Zone 2", …; `SceneService` tracks counts | ADR-031 §4 |
| Confirm with current name | `_mapConfirmDrawing()` reads name from toolbar input before calling `createAnnotated*()` | ADR-031 §4 |

### Phase M-3 — Platform-differentiated interaction

| Task | Details | ADR |
|------|---------|-----|
| Mobile drag model (all types) | `pointerdown` = start; `pointerup` = end; movement < 8 px AND geometry ≠ point → cancel | ADR-031 §2 |
| Mobile Line = 2-point straight line | `points = [start, end]`; no multi-click vertex accumulation on touch | ADR-031 §2 |
| Mobile Region = axis-aligned rectangle | Same as current Zone drag; enter `pending` on release (no immediate confirm) | ADR-031 §2 |
| PC Region = drag-rectangle only | Remove multi-click polygon on PC; drag-to-rectangle (same gesture as Mobile) | ADR-031 §2 |
| Remove immediate confirms | Zone drag, Point click: no longer confirm on `pointerup`; all enter `pending` | ADR-031 §2, §3 |
| Remove chain drawing | After confirm: tool resets to `idle`; `points = []`; no last-point carryover | ADR-031 §5 |

### Phase M-4 — Endpoint snapping (PC)

| Task | Details | ADR |
|------|---------|-----|
| Collect snap candidates | On every `pointermove` during `drawing` on PC: gather `AnnotatedLine` endpoints + `AnnotatedRegion` vertices | ADR-031 §6 |
| 20 px screen-space snap | Project candidate vertices to screen; if distance < 20 px, override `cursor` with snapped world position | ADR-031 §6 |
| Snap indicator ring | Render a highlighted ring at the snap target (`renderOrder` above preview); hide when not snapping | ADR-031 §6 |

### Phase M-5 — Animation overhaul

| Task | Details | ADR |
|------|---------|-----|
| Route bug fix | `AnnotatedLineView`: store `this._points`; call `_rebuildParticles(this._points)` from `setPlaceType()` | ADR-031 §8 |
| Zone strengthened fill breathing | `FILL_OPACITY_MIN = 0.15`, `FILL_OPACITY_MAX = 0.65`, 4 s sine (unchanged) | ADR-031 §8 |
| Zone rim ring | New `THREE.RingGeometry` at boundary; scale 1.0×→1.08×, opacity 0.40→0, 3 s cycle | ADR-031 §8 |
| Anchor crosshair pulse | 4 short line segments (±X, ±Y, length 0.18 m); scale 1.0×→1.3×, 4 s sine; replaces ring breathing | ADR-031 §8 |

---

## Map Mode — Mobile Bug Fixes

Issues discovered during 2026-04-11 session. Bug ① was fixed; ②–④ are deferred.

### ① cursor null on touch tap ✅ (2026-04-11)

`_mapMode.cursor` was only updated in `_onPointerMove`. On touch, `pointermove`
does not fire between taps, so `cursor` stayed `null` and `_updateMapPreview()`
returned early — no cursor dot or preview line appeared after any tap.

**Fix**: set `cursor = pt.clone()` and call `_updateMapPreview()` immediately
after adding a point in the tap paths (`_onPointerDown` line tool / region
polygon, `_onPointerUp` zone first-tap else-branch).

---

### ② Two-finger unintended multi-point addition — ✅ Superseded by ADR-031

Mobile Line/Region no longer uses multi-click vertex accumulation (ADR-031 §2: Mobile =
single drag gesture).  Multi-point addition paths are removed entirely, so the
`_activeDragPointerId` guard issue becomes moot.

---

### ③ Zone drag preview corrupted by second finger movement

| Detail | Location |
|--------|----------|
| **Root cause** | `_onPointerMove` in Map mode does not filter by `pointerId`. During a zone drag (finger 1, `_activeDragPointerId` set), if finger 2 moves across the screen, its `clientX/Y` updates `cursor` and `_updateMapPreview()` draws the rectangle to the wrong position. | `AppController.js:3823–3826` |
| **Fix** | Add `if (e.pointerId !== this._activeDragPointerId) return` guard (or skip cursor update when `_activeDragPointerId !== null && e.pointerId !== _activeDragPointerId`) at the top of the Map mode `_onPointerMove` branch. |

---

### ④ Zone polygon close threshold too small for touch — ✅ Superseded by ADR-031

Mobile Region is now drag-to-rectangle only (ADR-031 §2).  Multi-vertex polygon drawing
on Mobile is deferred to a future control-point editing mode.  The polygon-close tap path
no longer exists on touch, so the threshold issue is moot.

---

## Wasm Geometry Engine — remaining work (ADR-027)

Phases 1–4 are implemented (2026-04-05). See ADR-027 for full design and implementation details.

**Remaining Phase 3 candidates**

| Candidate Task | Description | ADR |
|---------------|-------------|-----|
| `run_monte_carlo(params)` | Simulation engine for urban / spatial analysis | ADR-027 |
| `build_boolean_union(a, b)` | CSG union — could replace server-side BFF round-trip for simple ops | ADR-027, ADR-017 |

**Phase 4 deferred**

| Task | Status | Details |
|------|--------|---------|
| Shared Wasm Memory | ⏸ Deferred | Requires `RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals"` (nightly Rust); architectural analysis in ADR-027 |
| Remove the one remaining copy | ⏸ Deferred | Blocked by shared Wasm memory above |

---

## BFF Phase D (ADR-015)

Phases A, B, C implemented (2026-03-21 to 2026-03-22). See ADR-015 and ADR-017 for details.

> **Priority to be determined after Phase C completion.**

| Candidate Task | Original Phase | ADR |
|---------------|----------------|-----|
| STEP geometry persistence (SceneSerializer extension) | C→D | ADR-015 |
| B-rep topology → graph | C | ADR-016 (open) |
| Frontend domain entities → cache-only | C | ADR-015 |
| GLTF / OBJ export (Geometry Service) | C | ADR-015 |
| Node Editor — DAG topology editing UI | C | ADR-017 |
| Delta-sync protocol (JSON Patch) | C | ADR-017 |
| Remove all domain computation from frontend | D | ADR-015 |
| Frontend unit tests — View / Controller only | D | ADR-015 |
| Independent Geometry Service scaling | D | ADR-015 |

---

## Backlog (frontend features)

| Priority | Item | Complexity | ADR / Notes |
|----------|------|-----------|-------------|
| 🔴 High | MeasureLine Edit Mode · 1D — endpoint drag to reposition after placement | Medium | ADR-005 |
| 🟡 Medium | Right-click context menu (currently: cancel only) | Low | ADR-006 |
| 🟡 Medium | Multi-face extrude (Shift+click) | Medium | — |
| 🟡 Medium | Export (OBJ / GLTF) | Low | Phase D via Geometry Service |
| 🟢 Low | CoordinateFrame assembly-mate positioning — `matchedFrameId` field; declare frame coincidence to drive object placement | High | ADR-021 |
| 🟢 Low | Node Editor — expose CoordinateFrame `translation`/`rotation` as editable node parameters | Medium | ADR-016, ADR-018 |
| 🟢 Low | Assembly groups (virtual TransformNode pivot) | Medium | ADR-016 |
| 🟢 Low | Revolute / prismatic constraints in Node Editor | High | ADR-016 |

## Mobile UX backlog

Mobile UX design decisions are formally documented in:
- **ADR-023** — Mobile Input Model (touch gesture model, device detection, OrbitControls strategy, confirmation lifecycle)
- **ADR-024** — Mobile Toolbar Architecture (fixed-slot layout, spacer pattern, mode-specific layouts)

Phases 1 and 2 completed 2026-03-28.

### Phase 3 — Advanced touch controls

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| 🟢 Low | **Axis constraint buttons (during Grab)** — Switch Grab toolbar to `Confirm \| X \| Y \| Z \| Cancel` 5-button layout. X/Y/Z tap calls `_setGrabAxis()`. | Low | Object mode already uses 5 slots, width already unified |
| 🟢 Low | **Snap mode toggle (during Grab)** — Switch snap target (Vertex / Edge / Face) via toolbar during Grab (equivalent to desktop 1/2/3 keys) | Low | Grab active toolbar needs additional slots |
| 🟢 Low | **Help drawer** — Add "Gesture list / Shortcuts" page to hamburger menu. Mobile shows gestures, desktop shows keybindings. | Medium | Extend OutlinerView drawer or add separate drawer |

## UX Polish backlog

Bug fixes and improvement candidates identified during UX validation (2026-03-26).
Bugs are also tracked on GitHub Issues #69–#73.

### Bug fixes (Issues)

| Priority | Item | Issue | Complexity |
|----------|------|-------|-----------|
| 🔴 High | Tab key shows no toast when Edit Mode blocked for read-only objects | [#69](https://github.com/yuubae215/easy-extrude/issues/69) | Low |
| 🔴 High | Stack button incorrectly enabled for ImportedMesh / MeasureLine | [#70](https://github.com/yuubae215/easy-extrude/issues/70) | Low |
| 🟡 Medium | No cancel button in mobile toolbar during measure placement | [#71](https://github.com/yuubae215/easy-extrude/issues/71) | Low |
| 🟡 Medium | R key (Rotate CoordinateFrame) missing from Object mode status bar hints | [#72](https://github.com/yuubae215/easy-extrude/issues/72) | Low |
| 🟢 Low | Modal dialogs lack label associations and keyboard navigation | [#73](https://github.com/yuubae215/easy-extrude/issues/73) | Medium |

### Improvement proposals

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| 🟡 Medium | **A-1: Context-sensitive status bar** — Dynamically switch footer hints based on active object type (add `R Rotate` for CoordinateFrame, read-only note for ImportedMesh) | Low | `_refreshObjectModeStatus()` + extend `UIView._setInfoText()` args |
| 🟡 Medium | **A-2: Live coordinates during Grab** — Show centroid coordinates `X:1.25 Y:0.00 Z:0.50` in status bar during Grab | Low | Change only `_updateGrabStatus()` |
| 🟢 Low | **A-3: CoordinateFrame rotation arc guide** — Overlay arc in Three.js to indicate rotation axis during R key | Medium | Requires new Three.js geometry |
| 🟢 Low | **B-3: Measure label tap** — Tap on MeasureLine distance label to copy to clipboard or convert units | Low | `MeasureLineView` + click handler |
| 🟢 Low | **C-1: Measure Panel** — List all MeasureLines in N panel with naming and CSV export | High | UIView + OutlinerView extension |
| 🟢 Low | **C-2: Snap grid visualization** — Overlay grid lines during Ctrl+Grab | Medium | Three.js GridHelper subset |
| 🟢 Low | **C-3: CoordinateFrame TF tree visualizer** — Display parent–child frame relationships as arrows in 3D viewport | High | ADR-018, ADR-019 |

---

## Completed phases

Full implementation history in `docs/SESSION_LOG.md`. Detailed design rationale in the respective ADRs.

| Feature | Completion | ADR / Notes |
|---------|------------|-------------|
| Spatial Annotation System refactor (UrbanPolyline→AnnotatedLine etc.) | 2026-04-08 | ADR-029 |
| Coordinate Space Type Safety (Phases 1–3: instanceof hotfix → JSDoc brands → API separation) | 2026-04-07 | PHILOSOPHY #21, CODE_CONTRACTS |
| Wasm Geometry Engine (Phases 1–4: Rust/Wasm + Worker + COOP/COEP) | 2026-04-05 | ADR-027 |
| IFC Semantic Classification | 2026-04-01 | ADR-025 |
| Undo / Redo (Phases 1–4: Command pattern, all entity types) | 2026-03-27 | ADR-022 |
| Mobile UX (Phases 1–2: toolbar, gestures, long-press, onboarding) | 2026-03-28 | ADR-023, ADR-024 |
| BFF + Microservices (Phases A–C: BFF, WebSocket, STEP import, ImportedMesh) | 2026-03-21 to 2026-03-22 | ADR-015, ADR-017 |
| Entity taxonomy redesign (Cuboid→Solid, Sketch→Profile) | 2026-03-26 | ADR-020, ADR-021 |
| CoordinateFrame (Phase A: attach + auto-origin; Phase B: nested hierarchy + rotation) | 2026-03-23 | ADR-018, ADR-019 |
| Anchored Annotations & Scene Graph API | 2026-04-06 | ADR-028 |
| Save / Load Scene UI + SceneSerializer | 2026-03-26 | ADR-015 |
| MeasureLine (1D annotation with snap) | 2026-03-22 | ADR-021 |
| Scene JSON export + import (Ctrl+E / Ctrl+I) | 2026-03-31 to 2026-04-01 | ADR-015 |
| DDD Phases 1–6 (domain entities, events, graph model, sub-element selection) | 2026-03-20 | ADR-009–ADR-014 |
| MVC refactor, ROS world frame, Blender-style UI and controls | 2026-03-17 to 2026-03-19 | ADR-002–ADR-008 |
