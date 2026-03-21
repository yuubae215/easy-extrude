# easy-extrude

Voxel-based 3D modeling app built with Three.js + Vite. Deployed to GitHub Pages.
For project structure, MVC design, and features see `README.md`.

## Document navigation

Before writing or modifying any code, consult the relevant documents.

| Trigger in prompt | Read first |
|-------------------|-----------|
| architecture / design / why | `docs/ARCHITECTURE.md`, then `docs/adr/README.md` |
| state machine / mode transition / state | `docs/STATE_TRANSITIONS.md`, ADR-008 |
| new feature / implementation plan | `docs/ROADMAP.md`, then related ADRs |
| controls / mouse / keyboard / orbit | ADR-003, ADR-006 |
| mode / edit mode / object mode / sketch | ADR-002, ADR-004, ADR-008 |
| object / hierarchy / 1D / 2D / 3D | ADR-005 |
| cuboid / shape / corners / geometry / extrude | ADR-007, ADR-002 |
| SceneModel / domain state / MVC / DDD | `docs/ARCHITECTURE.md` |
| mobile / touch | `docs/ROADMAP.md` (Mobile Support section) |

**`/adr <topic>`** — slash command to search the ADR index.

Create a new ADR when a design choice is non-obvious or hard to reverse.
Update `docs/adr/README.md` index whenever an ADR is added or superseded.

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

@.claude/MENTAL_MODEL.md

## Notes for changes

- `vite.config.js` `base` must match the repo name (`/easy-extrude/`)
- Three.js addons must be imported from `three/addons/...`

## Session history

Full log → `docs/SESSION_LOG.md`

- **2026-03-21**: Architecture design — BFF + microservices strategy established. Decided to limit the frontend to View + Controller only, consolidating geometry computation and STEP import on the server side. Node.js BFF / REST+WebSocket / Geometry Service (server-side graph computation) recorded in ADR-015. Transform graph (SE(3) tree, ROS frames, quaternions) recorded in ADR-016. STEP import to start with `occt-import-js` in Phase B, migrating to `opencascade.js` or a Python service if B-rep access is needed.
- **2026-03-20**: DDD Phase 5-1 — Added `src/graph/Vertex.js`. `Cuboid`/`Sketch` hold `vertices: Vertex[]` with `get corners()` for backward compatibility. ADR-012 Accepted.
- **2026-03-20**: DDD Phase 6 — Implemented sub-element selection. `1`/`2`/`3` keys switch Vertex / Edge / Face mode. Click updates `editSelection`, Shift+Click toggles. Face mode separates click vs drag using pending pattern. Grab snap extended to `_trySnapToGeometry` (all Vertex, Edge midpoints, Origin). After G→V pivot confirmation, `autoSnap = true` enables snap without Ctrl. Created ADR-014.
- **2026-03-20**: DDD Phase 5-3 — Added `src/graph/Edge.js`, `src/graph/Face.js`. Added `faces: Face[6]`, `edges: Edge[12]` to `Cuboid`. Changed `Sketch.extrude()` to return a new `Cuboid` without mutation. Entity replacement via `SceneService.extrudeSketch()`. Removed `dimension` field; use `instanceof Sketch` for type dispatch. Changed `AppController._hoveredFace`/`_dragFace` to `Face|null`. Added `SceneModel.editSelection: Set<Vertex|Edge|Face>`. ADR-012 complete.
- **2026-03-20**: DDD Phase 5-2 — Partially migrated status bar to event-driven updates. Added `_refreshObjectModeStatus()`, auto-update on rename via `objectRenamed` subscription. Fixed stuck "Object selected" string after Grab.
- **2026-03-20**: DDD Phase 4 — Added `EventEmitter`. Made `SceneService` Observable, emitting `objectAdded`, `objectRemoved`, `objectRenamed`, `activeChanged` events. AppController auto-syncs OutlinerView via event subscriptions. Removed direct View calls from controller. Created ADR-013.
- **2026-03-20**: Domain model design — Established the "dimensions and verbs" model. Sketch→Cuboid entity swap pattern, graph-based geometry direction recorded as ADR-012 (Proposed). Updated roadmap to Phases 4–6.
- **2026-03-20**: Bug fix — Fixed missing `move()`/`extrudeFace()` on Sketch causing Grab and face extrude to break after Extrude. Added dimension transition contract to MENTAL_MODEL.
- **2026-03-20**: DDD Phase 3 — Added `SceneService` (ApplicationService). Extracted entity creation and CRUD from AppController. AppController now focuses on input handling only. Created ADR-011.
- **2026-03-20**: DDD Phase 2 — Added behaviour methods to `Cuboid`/`Sketch` (`rename`, `move`, `extrudeFace`, `extrude`). Moved domain logic from AppController into entities. Created ADR-010.
- **2026-03-20**: DDD Phase 1 — Added `src/domain/Cuboid.js` / `src/domain/Sketch.js`. Replaced plain object creation with typed entities. Created ADR-009.
- **2026-03-20**: MVC refactor — extracted `SceneModel` from `AppController`. Domain state (`_objects`, `_activeId`, `_selectionMode`, `_editSubstate`) now lives in `src/model/SceneModel.js`. Added `docs/ARCHITECTURE.md` and `docs/STATE_TRANSITIONS.md`.
- **2026-03-20**: Bug fixes + ADR-008 (Mode Transition State Machine). `setMode()` now fully cancels in-progress ops and clears visual state before transitioning. `_addObject`, `_deleteObject` guard against Edit Mode. `MeshView.setFaceHighlight` owns `hlMesh.visible`.
- **2026-03-20**: Added `.claude/commands/adr.md` (`/adr` slash command). Added document navigation guide to CLAUDE.md. Refactored CLAUDE.md to agent-instructions-only format; moved full session history to `docs/SESSION_LOG.md`.
- **2026-03-20**: Architecture design session. ADR-001–006 created. `docs/ROADMAP.md` revised.
- **2026-03-20**: Implemented ADR-002 (Sketch→Extrude) and ADR-004 (Edit Mode 2D/3D dispatch). Shift+A shows Add menu (Box/Sketch). Sketch workflow: draw rect on ground plane → Enter → drag/type height → Enter → Edit Mode · 3D. Objects carry `dimension: 2|3`.
- **2026-03-20**: Implemented ADR-001 (VoxelModel), ADR-003 (middle-click orbit), voxel object system (2×2×2 box default, integer-snap face extrude). (Reverted; cuboid-based model restored.)
- **2026-03-19**: Blender-style UI overhaul (header bar, N panel, bottom info bar, `setStatusRich`). ROS world frame adopted. Grab controls added (G/X/Y/Z, numeric input).
