# Roadmap

## Design Direction (2026-03-20, updated 2026-04-09)

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

| Task | Details | ADR |
|------|---------|-----|
| "Annotate" submenu in Add menu (Shift+A) | Entries: Route, Boundary, Zone, Hub, Anchor (geometry type inferred from selection) | ADR-029 |
| `AnnotatedLine` placement mode | Click to place vertices; Enter/RMB to confirm; Escape to cancel | ADR-029 |
| `AnnotatedRegion` placement mode | Click to place ring vertices; auto-close on first vertex or Enter | ADR-029 |
| `AnnotatedPoint` placement mode | Single click to place; immediate confirm | ADR-029 |
| Mobile toolbar for annotation placement | Fixed-slot layout during placement; Cancel in last slot | ADR-024, ADR-029 |

---

## SpatialLink (ADR-030)

Typed semantic edges between annotated elements — makes spatial relationships
machine-readable in the scene graph. Design defined in ADR-029 §Out of scope;
full specification in ADR-030.

### Phase 1 — Domain layer

| Task | Details | ADR |
|------|---------|-----|
| `SpatialLink` domain entity | `id`, `sourceId`, `targetId`, `linkType` (`references` / `connects` / `contains` / `adjacent`); no geometry | ADR-030 |
| `SceneService.createSpatialLink()` / `deleteSpatialLink()` | Emits `spatialLinkAdded` / `spatialLinkRemoved`; stored in `SceneModel` | ADR-030 |
| `CreateSpatialLinkCommand` / `DeleteSpatialLinkCommand` | Undo/redo support; factory naming convention | ADR-030, ADR-022 |
| `SceneSerializer` + `SceneExporter` + `SceneImporter` | `"links": [...]` top-level array; scene version bump to 1.2; backward-compatible load | ADR-030 |

### Phase 2 — Scene graph integration

| Task | Details | ADR |
|------|---------|-----|
| `getSceneGraph()` extension | Include SpatialLinks as `relation: 'spatial'` edges with `linkType` field | ADR-030, ADR-028 |
| `SceneService.getLinksOf(entityId)` | Query helper: return all links where `sourceId` or `targetId` matches | ADR-030 |

### Phase 3 — Rendering

| Task | Details | ADR |
|------|---------|-----|
| `SpatialLinkView` | Three.js dashed line/arrow between source and target world centroids; updates per animation frame | ADR-030 |
| Color-coded by `linkType` | `references`=amber, `connects`=cyan, `contains`=violet, `adjacent`=slate | ADR-030 |
| Polymorphic interface completeness | No-op stubs for all AppController-called MeshView methods (PHILOSOPHY #17) | ADR-030 |

### Phase 4 — Creation UI

| Task | Details | ADR |
|------|---------|-----|
| Two-phase `L`-key link creation | Select source → `L` key → click target → linkType picker overlay → confirm | ADR-030 |
| N-panel "Spatial Links" section | List all links for selected entity with delete button per link | ADR-030 |
| Outliner badge for linked entities | Small icon when entity participates in ≥ 1 SpatialLink | ADR-030 |
| `AppController` guards | Block Grab / Edit / Stack / Dup for `SpatialLink`; `showToast()` on blocked ops | ADR-030 |

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
