# Roadmap

## Design Direction (2026-03-20)

This project is a **cuboid-based modeling application**. Each shape is a deformable box defined by 8 corner vertices. Complex scenes are built by placing and deforming multiple cuboid objects. See `docs/adr/` for detailed design decisions.

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

### Phase C — STEP reference geometry + Cuboid coexistence ✅ *2026-03-22*

**Goal**: STEPファイルをインポートしてシーンに参照ジオメトリとして表示しつつ、
同一シーンで Cuboid のモデリングを続けられるようにする。
ImportedMesh はサーバー評価結果をフロントエンドで表示するだけの thin-client エンティティ（編集不可）。
Cuboid は引き続き thick-client（ローカル編集）。

> **前提**: Phase B UX チェックポイントをクリア済み。Phase B の WebSocket + Geometry Service は継続利用。

| Task | Details | ADR |
|------|---------|-----|
| `ImportedMeshView` | 任意三角メッシュ（positions/normals/indices）を Three.js BufferGeometry で表示。BoxHelper・visibility のみ管理。編集用メッシュは持たない。 | — |
| `ImportedMesh` ドメインエンティティ | `id`, `name`, `meshView: ImportedMeshView` を保持。メソッドは `rename()` のみ。`instanceof ImportedMesh` で Cuboid/Sketch と区別。 | — |
| `SceneService.createImportedMesh()` | ImportedMesh + ImportedMeshView を生成し SceneModel に登録。`objectAdded` を emit。 | — |
| `SceneService._applyGeometryUpdate()` 修正 | objectId が SceneModel 未登録 → `createImportedMesh()` で自動生成。`ImportedMesh` なら `meshView.updateGeometryBuffers()` を呼び出す。`_positionsToCorners()` の null パスを利用。 | — |
| `OutlinerView` の型アイコン対応 | `addObject(id, name, type)` に type 引数を追加。`'imported'` → `⬡` を灰色で表示（Cuboid の水色と区別）。Edit ボタンは disabled。 | — |
| `AppController` の ImportedMesh 対応 | Object Mode での選択・Grab は無効。削除は可能。Edit Mode への遷移ガード（`instanceof ImportedMesh` → enter edit を skip）。 | — |

**スコープ外 (Phase D に延期)**:
- STEP ジオメトリのシーン永続化（SceneSerializer 拡張 / scene.data への geometry 埋め込み）
- Node Editor での DAG トポロジー編集（ノード・エッジの追加/削除）
- Delta-sync（現状は full-graph snapshot のまま）
- Multi-instance BFF / Redis セッション共有

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
| 🟡 Medium | Object hierarchy + Outliner tree view | Medium | ADR-005 |
| 🟡 Medium | Right-click context menu (currently: cancel only) | Low | ADR-006 |
| 🟡 Medium | Multi-face extrude (Shift+click) | Medium | — |
| 🟡 Medium | Export (OBJ / GLTF) | Low | Phase C via Geometry Service |
| 🟢 Low | CoordinateFrame relative-transform editing via Node Editor (Phase B) — expose `translation`/`rotation` fields as editable Node Editor parameters; allow nested frames (frame→frame hierarchy); DAG support per ADR-016 | High | ADR-016, ADR-018 |
| 🟢 Low | Assembly groups (virtual TransformNode pivot) | Medium | ADR-016 |
| 🟢 Low | Revolute / prismatic constraints in Node Editor | High | ADR-016 |

---

## Completed

| Item | Date |
|------|------|
| MeasureLine — 1D measure tool: M key / Shift+A → Measure; V/E/F snap during placement; amber dashed line + HTML distance label; Outliner ↔ icon | 2026-03-22 |
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
