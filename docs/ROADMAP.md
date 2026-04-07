# Roadmap

## Design Direction (2026-03-20, updated 2026-04-05)

This project is a **solid-body modeling application**. Each shape is a deformable solid defined by a LocalGeometry graph (vertices / edges / faces). Complex scenes are built by placing and deforming multiple solid objects alongside coordinate frames and measurement annotations. See `docs/adr/` for detailed design decisions.

---

## Wasm Geometry Engine (ADR-027)

Three-layer architecture for non-blocking, near-zero-copy geometry computation.
Rust → WebAssembly → Web Worker → Main thread (Three.js).

### Phase 1 — Infrastructure ✅ *2026-04-05*

| Task | Details | ADR |
|------|---------|-----|
| Rust crate `wasm-engine/` | `build_cuboid_geometry()` + pointer getters + `wasm_memory()`; mirrors `CuboidModel.js` face/normal logic exactly | ADR-027 |
| Web Worker bridge `geometry.worker.js` | Loads Wasm via `initWasm(wasmUrl)`, reads output via pointer (zero-copy view), slices once, transfers ArrayBuffer to main thread | ADR-027 |
| `GeometryEngine.js` facade | Promise API (`computeCuboid(corners)`); `?worker` Vite import; graceful fallback to `CuboidModel.buildGeometry()` on init failure | ADR-027 |
| Build pipeline | `pnpm build:wasm` (wasm-pack → `src/engine/wasm/`); `pnpm build` runs it first; `pnpm test:wasm` (cargo test); CI updated | ADR-027 |
| `src/engine/wasm/` committed | Generated WASM binary and JS bindings committed — JS-only developers need no Rust toolchain | ADR-027 |

### Phase 2 — Wire into rendering pipeline ✅ *2026-04-05*

| Task | Details | ADR |
|------|---------|-----|
| `MeshView` async geometry path | `rebuildGeometry()` → `await geometryEngine.computeCuboid(corners)` via Wasm worker; sync `updateGeometry()` retained for real-time interactive operations | ADR-027 |
| Batched computation (multi-object scenes) | `SceneService.batchRebuildSolids(solids)` runs all `rebuildGeometry()` calls via `Promise.all()`; called from `loadScene()` and `importFromJson()` after all entities are created | ADR-027 |
| Progress indicator | `batchRebuildStart/Progress/End` events emitted when solid count > 3; `AppController` subscribes and shows/updates/hides `showImportProgress()` overlay | ADR-027 |

### Phase 3 — Expand Rust compute surface ✅ *2026-04-05*

| Task | Details | ADR |
|------|---------|-----|
| `build_extruded_profile(profile, height)` | Arbitrary n-gon prism geometry in Rust (2*n f32 profile verts + height); fan-triangulated caps + side quads; centroid-based outward-normal test handles CW/CCW input. `GeometryEngine.computeExtrudedProfile()` + `MeshView.rebuildExtrudedProfile()` wired; AppController fires async Wasm rebuild after sync `updateGeometry()` on extrude confirm | ADR-027 |
| `build_instance_matrices(transforms[])` | Batch TRS → column-major 4×4 matrices in Rust (n×10 f32 → n×16 f32); matches `THREE.Matrix4.compose()` layout exactly; JS fallback via Three.js `Matrix4.compose()`; `GeometryEngine.computeInstanceMatrices()` ready for `THREE.InstancedMesh` usage | ADR-027 |

**Remaining (Phase 3 future)**

| Candidate Task | Description | ADR |
|---------------|-------------|-----|
| `run_monte_carlo(params)` | Simulation engine for urban analysis (UrbanPolygon / ADR-026) | ADR-027 |
| `build_boolean_union(a, b)` | CSG union — could replace server-side BFF round-trip for simple ops | ADR-027, ADR-017 |

### Phase 4 — True zero-copy (SharedArrayBuffer) — partial ✅ *2026-04-05*

> COOP/COEP headers are now set on GitHub Pages via a service worker.
> The `posView.slice()` step is analysed and deferred — see ADR-027 §Phase 4 Architectural Analysis.

| Task | Status | Details |
|------|--------|---------|
| Enable COOP/COEP headers | ✅ *2026-04-05* | `public/coi-serviceworker.js` intercepts every fetch on GitHub Pages and injects `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`; `index.html` registers the SW and reloads once on first activation; Vite dev server already sets these headers natively |
| Shared Wasm Memory | ⏸ Deferred | Requires `RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals"` (nightly Rust as of 2026-04); architectural constraint documented in ADR-027 |
| Remove the one remaining copy | ⏸ Deferred | Blocked by shared Wasm memory above; single-buffered Rust statics require one copy to guarantee Three.js data ownership (ADR-027 §Phase 4 Architectural Analysis) |

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

> **Priority to be determined after Phase C completion.**

Candidate tasks:

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

---

## Lynch Urban Elements — 2D Map Classification (ADR-026)

New 2D entity types for city-scale urban morphology based on Kevin Lynch's
*The Image of the City* (1960).  Domain layer (entities, registry, service,
serializer) is complete.  The phases below cover the rendering and UI layers.

### Phase 1 — Rendering layer ★ prerequisite for all UI

| Task | Details | ADR |
|------|---------|-----|
| `UrbanPolylineView` | Three.js `Line2` (fat line) with configurable stroke color; BoxHelper for selection | ADR-026 |
| `UrbanPolygonView` | Three.js `Line2` closed ring + translucent fill `Mesh` (ShapeGeometry); BoxHelper | ADR-026 |
| `UrbanMarkerView` | Three.js `Sprite` or `Mesh` (flat circle / diamond); label HTML overlay | ADR-026 |
| Wire views into `SceneService.create*` | Replace `meshView = null` with constructed view; add scene.add / dispose | ADR-026 |
| `AppController` instanceof guards | Grab (G key) allowed; Edit Mode blocked (no sub-element editing yet); Stack blocked | ADR-026 |

### Phase 2 — Classification UI (N-panel + Outliner)

| Task | Details | ADR |
|------|---------|-----|
| Outliner type icons | `⟿` for UrbanPolyline, `⬡` for UrbanPolygon, `⬤` for UrbanMarker | ADR-026 |
| Outliner Lynch class badge | Coloured badge (Lynch color) next to name when `lynchClass` is set | ADR-026 |
| N-panel "Lynch Class" section | Badge + Set/Change button + clear button; shown for all three Urban entity types | ADR-026 |
| Lynch class picker overlay | Grouped list filtered by geometry type (`getLynchClassesByGeometry`); search input | ADR-026 |
| `SetLynchClassCommand` wired to controller | `AppController` subscribes `objectLynchClassChanged`; forwards to OutlinerView | ADR-026 |

### Phase 3 — Creation UX

| Task | Details | ADR |
|------|---------|-----|
| "Urban" submenu in Add menu (Shift+A) | Entries: Urban Path, Urban Edge, Urban District, Urban Node, Urban Landmark | ADR-026 |
| UrbanPolyline placement mode | Click to place vertices; Enter/RMB to confirm; Escape to cancel | ADR-026 |
| UrbanPolygon placement mode | Click to place ring vertices; auto-close on first vertex or Enter | ADR-026 |
| UrbanMarker placement mode | Single click to place; immediate confirm | ADR-026 |
| Mobile toolbar for Urban placement | Fixed-slot layout during placement; Cancel in last slot | ADR-024, ADR-026 |

---

## Coordinate Space Type Safety

**Goal**: eliminate the class of bugs where `LocalVector3` is silently used where
`WorldVector3` is required (or vice versa) by making the distinction enforceable at
compile time. Root cause documented in PHILOSOPHY #21.

**Root cause of the nested-frame bug (2026-04-07)**:
`CoordinateFrame.corners` returns `[this.translation]` — a parent-relative local offset.
Geometry `corners` return world-space positions. Both are `Vector3[]`. The spatial
computation layer treated them uniformly, producing wrong world positions for nested frames
and connection lines anchored at world origin.

### Phase 1 — Hotfix ✅ *2026-04-07*

| Task | Details |
|------|---------|
| `instanceof` branch in `_updateWorldPoses()` | For `CoordinateFrame` parents: read world position from `_worldPoseCache`; for geometry: compute centroid from `corners` as before |
| `instanceof` branch in `createCoordinateFrame()` | Same branching for initial world position on frame creation |
| CODE_CONTRACTS rule | "CoordinateFrame.corners Is Local Space" added to `architecture.md` and index |
| PHILOSOPHY principle | #21 "Coordinate Spaces Are Statically Distinguished" added |

### Phase 2 — Branded type annotations (JSDoc) ✅ *2026-04-07*

**Approach**: JSDoc intersection types create compile-time brands with zero runtime overhead.
`tsc --checkJs` enforces them without a TypeScript migration.

| Task | Details |
|------|---------|
| Add branded type aliases ✅ | `src/types/spatial.js` — exports `@typedef WorldVector3` and `LocalVector3` as branded `THREE.Vector3` intersections |
| Annotate `corners` return types ✅ | `/** @returns {WorldVector3[]} */` on Solid, ImportedMesh, Profile; `/** @returns {LocalVector3[]} */` on CoordinateFrame |
| Annotate `_worldPoseCache` values ✅ | `{ position: WorldVector3, quaternion: THREE.Quaternion }` |
| Annotate `_updateWorldPoses()` locals ✅ | `parentWorldPos: WorldVector3`, `worldPos: WorldVector3` |
| Annotate `createCoordinateFrame()` locals ✅ | `initialWorldPos: WorldVector3` |
| Wire `tsc --checkJs` into CI ✅ | `tsconfig.json` (`checkJs: true`, `noImplicitAny: false`, `strictFunctionTypes: true`, `noEmit: true`); `pnpm typecheck` script; CI step after install, before build |
| Bonus: fix Urban entity Vertex bug ✅ | `UrbanPolyline/Polygon/Marker.fromPoints()` passed only `id` to `new Vertex()`, leaving `position` undefined — caught by tsc; fixed to `new Vertex(id, p.clone())` |
| Scope note | `src/types/` and `src/domain/` are the checked include set. View/service files transitively pulled in carry `// @ts-nocheck` until full annotation is done in Phase 3. `strict: true` deferred to Phase 3. |

**Expected outcome**: any future code that passes `frame.corners[0]` (LocalVector3) where
a WorldVector3 is expected produces a type error at `pnpm typecheck` — caught before merge.
`pnpm typecheck` is now a required CI gate on every push to main/master.

### Phase 3 — Structural separation (long-term, after Phase 2)

Evaluate whether `corners` should be split into semantically distinct interfaces so that
the distinction is enforced by the API shape, not just by brands:

| Option | Pros | Cons |
|--------|------|------|
| Rename `CoordinateFrame.corners` → `localOffset` | Impossible to confuse with world-space `corners` | Breaking change to all call sites; grab uses `allStartCorners` keyed by id |
| Split `IWorldGeometry` / `ILocalOffset` interfaces | Fully structural; IDE navigation is clear | Refactor scope is large; existing grab/undo machinery uses unified `corners` contract |
| Keep unified `corners` + Phase 2 brands | Minimal change; already ships | Relies on JSDoc discipline; brands are advisory until `strict` mode is universal |

**Decision gate**: revisit after Phase 2 is running in CI for ≥ 1 month.
If brand violations are caught in practice, Phase 3 is worthwhile.
If no violations appear, the brands alone may be sufficient.

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

Mobile UX Phases 1 and 2 were completed 2026-03-28. Remaining items are grouped by phase.

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

## Completed

| Item | Date |
|------|------|
| Wasm Geometry Engine Phase 4 — COOP/COEP via `public/coi-serviceworker.js`; `index.html` SW registration with one-shot reload; `typeof SharedArrayBuffer !== 'undefined'` now true on GitHub Pages; shared Wasm memory deferred (requires nightly Rust); architectural analysis documented in ADR-027 (ADR-027) | 2026-04-05 |
| Wasm Geometry Engine Phase 3 — `build_extruded_profile()` (arbitrary n-gon prism); `build_instance_matrices()` (batch TRS→4x4); `GeometryEngine.computeExtrudedProfile()` + `computeInstanceMatrices()`; `MeshView.rebuildExtrudedProfile()`; AppController async Wasm rebuild on extrude confirm (ADR-027) | 2026-04-05 |
| Wasm Geometry Engine Phase 2 — `MeshView.rebuildGeometry()` async Wasm path; `SceneService.batchRebuildSolids()` parallel rebuild via `Promise.all()`; progress overlay for batches > 3 objects; `importFromJson()` made async; sync `updateGeometry()` retained for interactive ops (ADR-027) | 2026-04-05 |
| Wasm Geometry Engine — three-layer architecture (Rust/Wasm + Web Worker + GeometryEngine.js facade); zero-copy data path; `pnpm build:wasm` pipeline; wasm-pack output committed; CI updated; JS-only devs need no Rust toolchain (ADR-027) | 2026-04-05 |
| IFC semantic classification — `IFCClassRegistry`, `SetIfcClassCommand`; N-panel IFC class picker (dropdown) for Solid and ImportedMesh; `Ctrl+Z` undoable; `SceneSerializer` and `SceneExporter` include `ifcClass` field (ADR-025) | 2026-04-01 |
| Documentation — `docs/SCREEN_DESIGN.md`, `docs/LAYOUT_DESIGN.md`, `docs/EVENTS.md` created (Japanese → English); Mermaid `block-beta` diagrams; `CLAUDE.md` change-impact matrix added | 2026-04-01 |
| Documentation — `docs/PHILOSOPHY.md` created: 20 design principles distilled from MENTAL_MODEL, PROCESS_NOTES, and ADRs; doc-structure refactored (MENTAL_MODEL → CODE_CONTRACTS + DEVELOPMENT + PHILOSOPHY) | 2026-04-01 |
| Bugfix — Mobile header overflow: Export/Import buttons replaced by `_moreMenuBtn` (⋯) dropdown on mobile; `_headerStatusEl` uses `visibility:hidden` to remain a flex spacer | 2026-04-01 |
| Scene JSON import — `SceneImporter.js` (pure: parse/validate JSON v1.0 and v1.1); `SceneService.importFromJson()` reconstructs all entity types; merge mode remaps IDs; `UIView` gains Import header button + `showImportModal()`; `Ctrl+I` shortcut | 2026-04-01 |
| Scene JSON export — `SceneExporter.js` (pure computation); downloads structured JSON snapshot; geometry Base64-encoded for ImportedMesh; `UIView` gains Export header button; `Ctrl+E` shortcut | 2026-03-31 |
| Swagger UI — `swagger-ui-express` v5; OpenAPI 3.0 spec for all BFF endpoints mounted at `GET /api/docs`; JWT BearerAuth security scheme and dev-token flow documented | 2026-03-29 |
| Mobile UX documentation — ADR-023 (Mobile Input Model: touch gesture model, device detection, OrbitControls strategy, confirmation lifecycle); ADR-024 (Mobile Toolbar Architecture: fixed-slot layout, spacer pattern, mode-specific layouts); MENTAL_MODEL.md split into 6.9k index + 4 detail files | 2026-03-29 |
| OrbitControls bugfix — OrbitControls now disabled during 2D extrude height-drag and face-extrude auto-start on touch (coarse pointer) devices; `_onPointerDown` gained `2d-extrude` early-return; face-extrude auto-start guard corrected from `innerWidth < 768` to `matchMedia` | 2026-03-29 |
| Mobile UX Phase 2 — Measure tool quick-access (promoted to top of Add menu: Measure → Box → Sketch → Frame → Import STEP); Frame Rotate button for CoordinateFrame (5-slot Object mode toolbar: Rotate\|Grab\|Delete\|Add Frame\|spacer; `ICONS.rotate`, `ICONS.grab`, `ICONS.frame` added); long-press context menu (400ms popup with Grab/Duplicate/Delete/Rename; `UIView.showContextMenu`/`hideContextMenu`/`showRenameDialog`) | 2026-03-28 |
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
