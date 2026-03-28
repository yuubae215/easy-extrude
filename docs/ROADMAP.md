# Roadmap

## Design Direction (2026-03-20, updated 2026-03-26)

This project is a **solid-body modeling application**. Each shape is a deformable solid defined by a LocalGeometry graph (vertices / edges / faces). Complex scenes are built by placing and deforming multiple solid objects alongside coordinate frames and measurement annotations. See `docs/adr/` for detailed design decisions.

---

## BFF + Microservices Migration (ADR-015)

The architecture evolves incrementally from a browser-only SPA toward a thin-client frontend
backed by a BFF and dedicated microservices.

**Phase B ends with a UX validation checkpoint.**
Phases C and D are intentionally left open — the direction will be decided based on learnings
from that checkpoint (pivot if needed).

```
Browser (View + Controller)
        │ REST / WebSocket
        ▼
BFF (Node.js) — auth, aggregation, routing
   ├── Scene Service   — scene CRUD + DB
   ├── User Service    — auth / profile
   └── Geometry Service — graph eval, STEP import, export
```

### Phase A — BFF skeleton + Scene persistence ✅ *2026-03-21*

| Task | Details | ADR |
|------|---------|-----|
| Scaffold BFF (Node.js / Express or Fastify) | JWT gateway, REST routing stub | ADR-015 |
| Scene save / load REST endpoints | `POST /scenes`, `GET /scenes/:id` | ADR-015 |
| Scene Service + DB schema | Store scene JSON (objects + transform graph) | ADR-015, ADR-016 |
| TransformGraph persistence | Adjacency list: `TransformNode[]` + `TransformEdge[]`; ROS frame + quaternions | ADR-016 |
| `SceneService` → HTTP client | Replace in-memory CRUD with BFF REST calls | ADR-015 |
| Existing frontend behaviour unchanged | Client-complete fallback while BFF is wired up | ADR-015 |
| **`VITE_BFF_URL` env var** | GitHub Pages cannot run server-side code. BFF must be deployed separately (Railway / Render / Fly.io etc.). `BffClient` baseUrl should default to `import.meta.env.VITE_BFF_URL \|\| '/api'` so the production frontend points to the hosted BFF while the dev Vite proxy still works. | ADR-015 |

### Phase B — Geometry Service + WebSocket + Node Editor prototype ★ UX checkpoint ✅ *2026-03-21*

| Task | Details | ADR |
|------|---------|-----|
| Extract Geometry Service | `server/src/geometry/` — OperationGraph (DAG), nodeTypes, evaluator, meshEncoder | ADR-017 |
| WebSocket session (BFF ↔ Frontend) | `ws` on `/api/ws`; SessionManager; operation-based messages | ADR-017 |
| Delta-sync protocol on reconnect | `session.resume` → `graph.snapshot` full-state (delta-patch deferred to Phase C) | ADR-017 |
| Node Editor UI prototype | `NodeEditorView` — SVG DAG panel, draggable nodes, param editor, STEP trigger | ADR-017 |
| STEP import prototype | `POST /api/import/step` (multer); `import.step` WS message; `occt-import-js` lazy-load | ADR-017 |
| TransformGraph → DAG | OperationGraph extends TransformGraph with cycle detection (DFS), topo-sort | ADR-017 |
| BffClient WebSocket | `WsChannel` class; `openWs()`/`closeWs()`; `SceneService.openGeometryChannel()` | ADR-017 |
| **★ UX validation checkpoint** | Evaluate: latency feel, Node Editor usability, STEP import UX. Decide pivot direction for Phase C+. | — |

### Phase C — STEP reference geometry + Solid coexistence ✅ *2026-03-22*

**Goal**: Import STEP files and display them in the scene as reference geometry while continuing
to model with Solid objects in the same scene.
`ImportedMesh` is a thin-client entity — it only displays server-evaluated geometry (read-only).
Solid objects remain thick-client (local editing).

> **Prerequisite**: Phase B UX checkpoint cleared. Phase B WebSocket + Geometry Service continues.

| Task | Details | ADR |
|------|---------|-----|
| `ImportedMeshView` | Display arbitrary triangle mesh (positions/normals/indices) via Three.js BufferGeometry. Manages BoxHelper and visibility only; no edit mesh. | — |
| `ImportedMesh` domain entity | Holds `id`, `name`, `meshView: ImportedMeshView`. Methods: `rename()`, `move()`. Distinguished from Solid/Profile via `instanceof ImportedMesh`. | — |
| `SceneService.createImportedMesh()` | Create ImportedMesh + ImportedMeshView and register in SceneModel. Emits `objectAdded`. | — |
| `SceneService._applyGeometryUpdate()` | If objectId not in SceneModel → auto-create via `createImportedMesh()`. For ImportedMesh → call `meshView.updateGeometryBuffers()`. | — |
| `OutlinerView` type icons | Added `type` argument to `addObject(id, name, type)`. `'imported'` → `⬡` in grey (distinct from Solid blue). Edit button disabled. | — |
| `AppController` ImportedMesh guards | Edit Mode transition blocked with toast. Grab (G key) and pointer drag allowed. Ctrl+drag rotation and pivot selection blocked. | — |
| `SceneView.fitCameraToSphere()` | Repositions camera and expands `camera.far` after geometry load. Triggered by `geometryApplied` event. | — |
| Unit conversion dialog | `NodeEditorView._showUnitDialog()` — 6 scale presets (mm→m, etc.) applied server-side before streaming. | — |
| occt-import-js API fix | Geometry extracted at mesh level (`mesh.attributes.position.array`), not face level. | — |

**Out of scope (deferred to Phase D)**:
- STEP geometry scene persistence (SceneSerializer extension / embedding geometry in scene.data)
- Node Editor DAG topology editing (add/remove nodes and edges)
- Delta-sync protocol (currently full-graph snapshot only)
- Multi-instance BFF / Redis session sharing

### Phase D — Post-C (direction TBD after Phase C checkpoint)

> **Phase C 完了後に優先度を決定する。**

Candidate tasks:

| Candidate Task | Original Phase | ADR |
|---------------|----------------|-----|
| STEP ジオメトリの永続化（SceneSerializer 拡張） | C→D | ADR-015 |
| B-rep topology → graph | C | ADR-016 (open) |
| Frontend domain entities → cache-only | C | ADR-015 |
| GLTF / OBJ export (Geometry Service) | C | ADR-015 |
| Node Editor — DAG トポロジー編集 UI | C | ADR-017 |
| Delta-sync プロトコル (JSON Patch) | C | ADR-017 |
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

Mobile UX Phase 1 was completed 2026-03-28. Remaining items are grouped by phase.

### Phase 2 — Core mobile operations ✅ *2026-03-28*

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| ✅ | **Measure tool quick-access** — Add メニューの先頭に Measure を昇格。`showAddMenu` のアイテム順を Measure → Box → Sketch → Frame → Import STEP に変更。 | Low | `UIView.showAddMenu` アイテム並び替え |
| ✅ | **Frame Rotate ボタン** — CoordinateFrame 選択中は Object モードツールバーを専用 5 スロットに切替: `Rotate \| Grab \| Delete \| Add Frame \| spacer`. `ICONS.rotate`, `ICONS.grab`, `ICONS.frame` を追加。 | Low | `_updateMobileToolbar()` の CoordinateFrame 分岐 |
| ✅ | **長押しコンテキストメニュー** — 長押し 400 ms 後に「Grab / Duplicate / Delete / Rename」のポップアップを表示。`UIView.showContextMenu(x,y,items)` + `UIView.hideContextMenu()` + `UIView.showRenameDialog(name,cb)` 追加。`_showLongPressContextMenu(x,y,obj)` がメニューを組み立て。 | Medium | `_longPress` タイマーを流用 |

### Phase 3 — Advanced touch controls

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| 🟢 Low | **軸拘束ボタン（Grab 中）** — Grab 中ツールバーを `Confirm \| X \| Y \| Z \| Cancel` の 5 ボタン構成に変更。X/Y/Z タップで `_setGrabAxis()` を呼ぶ | Low | Object モードが既に 5 スロットなので幅は統一済み |
| 🟢 Low | **スナップモード切替（Grab 中）** — Grab 中に Vertex / Edge / Face のスナップ対象をツールバーで切替 (デスクトップの 1/2/3 キー相当) | Low | Grab active ツールバーに追加スロットが必要 |
| 🟢 Low | **ヘルプドロワー** — ハンバーガーメニューに「ジェスチャー一覧 / Shortcuts」ページを追加。モバイルではジェスチャー、デスクトップではキーバインド一覧 | Medium | OutlinerView ドロワーを拡張 or 独立ドロワー |

## UX Polish backlog

UXバリデーション (2026-03-26) で特定されたバグ修正・改善候補。
バグ修正は GitHub Issues #69–#73 でも追跡。

### バグ修正（Issues）

| Priority | Item | Issue | Complexity |
|----------|------|-------|-----------|
| 🔴 High | Tab key shows no toast when Edit Mode blocked for read-only objects | [#69](https://github.com/yuubae215/easy-extrude/issues/69) | Low |
| 🔴 High | Stack button incorrectly enabled for ImportedMesh / MeasureLine | [#70](https://github.com/yuubae215/easy-extrude/issues/70) | Low |
| 🟡 Medium | No cancel button in mobile toolbar during measure placement | [#71](https://github.com/yuubae215/easy-extrude/issues/71) | Low |
| 🟡 Medium | R key (Rotate CoordinateFrame) missing from Object mode status bar hints | [#72](https://github.com/yuubae215/easy-extrude/issues/72) | Low |
| 🟢 Low | Modal dialogs lack label associations and keyboard navigation | [#73](https://github.com/yuubae215/easy-extrude/issues/73) | Medium |

### 改善提案

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| 🟡 Medium | **A-1: Context-sensitive status bar** — active object 型に応じてフッターのヒントを動的切替 (CoordinateFrame 選択時に `R Rotate` 追加、ImportedMesh 選択時に read-only 注記) | Low | `_refreshObjectModeStatus()` + `UIView._setInfoText()` 引数拡張 |
| 🟡 Medium | **A-2: Grab 中の現在座標表示** — Grab 中のステータスバーにセントロイド座標 `X:1.25 Y:0.00 Z:0.50` を追加表示 | Low | `_updateGrabStatus()` のみ変更 |
| 🟢 Low | **A-3: CoordinateFrame 回転円弧ガイド** — R キー中に回転軸を示す円弧を Three.js でオーバーレイ表示 | Medium | 新規 Three.js ジオメトリが必要 |
| 🟢 Low | **B-3: 計測ラベルのタップ操作** — MeasureLine 距離ラベルのタップでクリップボードコピー or 単位変換 | Low | `MeasureLineView` + クリックハンドラ |
| 🟢 Low | **C-1: Measure Panel** — N パネルに全 MeasureLine を一覧化、名前付け・CSV 出力対応 | High | UIView + OutlinerView 拡張 |
| 🟢 Low | **C-2: スナップグリッド可視化** — Ctrl+Grab 中にグリッド線をオーバーレイ表示 | Medium | Three.js GridHelper サブセット |
| 🟢 Low | **C-3: CoordinateFrame TF 木ビジュアライザ** — 3D ビューポート内でフレーム間の親子関係を矢印で表示 | High | ADR-018, ADR-019 |

---

## Completed

| Item | Date |
|------|------|
| Mobile UX Phase 1 — Undo/Redo header buttons (`_undoBtn`/`_redoBtn`, `setUndoRedoEnabled`); Duplicate button in Object mode toolbar (5-slot: Add\|Dup\|Edit\|Delete\|Stack); first-run onboarding overlay (`showOnboardingIfNeeded`, `localStorage.ee_onboarded`); touch gesture model: single-finger drag = orbit, long-press ≥ 400 ms on selected object = Grab (`_longPress` state) | 2026-03-28 |
| Undo/Redo Phase 4 — `RenameCommand`, `FrameRotateCommand`; `MoveCommand` extended to all entity types (CoordinateFrame, MeasureLine, ImportedMesh); `SceneService.invalidateWorldPose`; `FrameMoveCommand` covered by updated `MoveCommand` (ADR-022) | 2026-03-27 |
| Undo/Redo Phase 3 — `AddSolidCommand` + `DeleteCommand` (soft-delete: detach without dispose, bounded by MAX=50); `_deleteObject` no longer calls `deleteObject` (dispose); `_addObject` pushes undo record (ADR-022) | 2026-03-27 |
| Undo/Redo Phase 2 — `FaceExtrudeCommand` (corner-snapshot via MoveCommand), `ExtrudeSketchCommand` (Profile↔Solid swap); `SceneService.detachObject`/`reattachObject`; `extrudeProfile` now emits events (ADR-022) | 2026-03-27 |
| Undo/Redo Phase 1 — `CommandStack` + `MoveCommand` (Grab); `Ctrl+Z`/`Ctrl+Y`/`Ctrl+Shift+Z`; stack cleared on scene load (ADR-022) | 2026-03-27 |
| Entity taxonomy redesign — `Cuboid`→`Solid`, `Sketch`→`Profile`; LocalGeometry unified interface for MeasureLine/Profile; `CoordinateFrame._worldPos` → `SceneService._worldPoseCache`; Euler convention → ROS RPY (ADR-020, ADR-021) | 2026-03-26 |
| Save/Load Scene UI — header buttons, `enableSaveLoad()`, `_saveScene()`/`_loadScene()` dialogs; `_clearScene()` now emits `objectRemoved`; SceneSerializer handles CoordinateFrame + MeasureLine | 2026-03-26 |
| CoordinateFrame N panel UX — R-key updates N panel in realtime; Location/Rotation labels clarified (World vs Local, RPY); Origin frame shows actual world position; two bug fixes | 2026-03-25 |
| CoordinateFrame Phase B — nested frame hierarchy (frame→frame), R-key rotation (X/Y/Z axis + numeric input), `CoordinateFrameView.updateRotation()`, topological-sort animation loop, Outliner multi-level indentation, recursive cascade delete (ADR-019) | 2026-03-23 |
| CoordinateFrame Phase A — attach named SE(3) frames to geometry objects; auto Origin frame on Solid creation; Outliner indentation; parent-gated visibility (X-ray when selected) (ADR-018) | 2026-03-23 |
| Move support for ImportedMesh and MeasureLine — synthetic AABB corners + `move()` for ImportedMesh; `corners`/`move()` for MeasureLine; `updateGeometry()`/`updateBoxHelper()` on both views | 2026-03-23 |
| STEP import end-to-end — occt-import-js API fix (geometry at mesh level); camera far-clip / fitCameraToSphere; `_finalizeRectSelection` ImportedMesh guard; unit conversion dialog | 2026-03-23 |
| Server startup fix — `PRAGMA journal_mode = WAL` moved out of `db.batch()` into standalone `db.execute()` | 2026-03-23 |
| Measure guide + snap display fix — MeasureLineView no-op interface completeness; `_measure.snapMeshView` for snap display fallback when active object is MeasureLine | 2026-03-23 |
| Mobile Stack snap fix + footer keybinding update | 2026-03-23 |
| Mobile toolbar 4-slot unification — `{ spacer: true }` placeholder; all modes padded to 4 slots | 2026-03-22 |
| MeasureLine — 1D measure tool: M key / Shift+A → Measure; V/E/F snap during placement; amber dashed line + HTML distance label; Outliner icon | 2026-03-22 |
| BFF Phase C — ImportedMesh thin-client entity, ImportedMeshView, SceneService.createImportedMesh(), _applyGeometryUpdate() routing, OutlinerView type icon, AppController guards | 2026-03-22 |
| BFF Phase B — Geometry Service (DAG evaluator), WebSocket session (ADR-017), Node Editor UI prototype, STEP import (REST + WS), BffClient WsChannel | 2026-03-21 |
| BFF Phase A — Express BFF scaffold, SQLite scene persistence, TransformGraph storage (ADR-016), BffClient, SceneSerializer, Vite proxy, pnpm workspace | 2026-03-21 |
| Mobile touch support — Pointer Events API, `_activeDragPointerId`, mobile toolbar, canvas target guard, touch hover sync, face-extrude confirm on `pointerup` | 2026-03-21 |
| Architecture design — BFF + microservices strategy, transform graph (SE(3) tree, ROS frames, quaternions) | 2026-03-21 (ADR-015, ADR-016) |
| DDD Phase 6 — Sub-element selection (1/2/3 keys); Grab snap expanded to all geometry (ADR-014) | 2026-03-20 |
| DDD Phase 5-3 — Edge/Face graph objects; unified selection model; dimension field removed (ADR-012) | 2026-03-20 |
| DDD Phase 5-2 — Event-driven status bar; _refreshObjectModeStatus() | 2026-03-20 |
| DDD Phase 5-1 — Vertex layer in graph model (ADR-012) | 2026-03-20 |
| DDD Phase 4 — Domain events (EventEmitter); SceneService observable (ADR-013) | 2026-03-20 |
| DDD Phase 3 — SceneService ApplicationService layer (ADR-011) | 2026-03-20 |
| DDD Phase 2 — Domain entity behaviour methods (ADR-010) | 2026-03-20 |
| DDD Phase 1 — Typed domain entities Cuboid / Sketch (ADR-009) | 2026-03-20 |
| Method B: Sketch → Extrude (ADR-002) + Edit Mode 2D/3D dispatch (ADR-004) | 2026-03-20 |
| Custom BufferGeometry cuboid + Face Extrude | 2026-03-17 |
| MVC refactor (Model / View / Controller separation) | 2026-03-17 |
| Blender-style Grab controls (G/X/Y/Z, numeric input) | 2026-03-18 |
| ROS world frame (+X forward, +Y left, +Z up) | 2026-03-19 |
| Blender-style UI (header bar, N panel, bottom info bar) | 2026-03-19 |
| Colored status display (`setStatusRich`) | 2026-03-19 |
| Cuboid-based architecture design + ADRs (ADR-007) | 2026-03-20 |
