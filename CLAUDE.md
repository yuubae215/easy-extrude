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
| architecture / design / why | `docs/ARCHITECTURE.md`, then `docs/adr/README.md` |
| state machine / mode transition / state | `docs/STATE_TRANSITIONS.md`, ADR-008 |
| new feature / implementation plan | `docs/ROADMAP.md`, then related ADRs |
| screen / information architecture / UI screens / what shows on screen | `docs/SCREEN_DESIGN.md` |
| layout / dimensions / z-index / responsive / breakpoint / toolbar slots | `docs/LAYOUT_DESIGN.md` |
| events / domain events / keyboard / pointer / touch / click | `docs/EVENTS.md` |
| controls / mouse / keyboard / orbit | ADR-003, ADR-006 |
| mode / edit mode / object mode / sketch | ADR-002, ADR-004, ADR-008 |
| object / hierarchy / 1D / 2D / 3D | ADR-005 |
| cuboid / shape / corners / geometry / extrude | ADR-007, ADR-002 |
| SceneModel / domain state / MVC / DDD | `docs/ARCHITECTURE.md` |
| mobile / touch / gesture / pointer / OrbitControls | ADR-023, `.claude/mental_model/2_interaction.md` |
| mobile toolbar / slot / spacer / UI layout | ADR-024, `.claude/mental_model/3_ui_layout.md` |
| entity capability / instanceof / MeasureLine / ImportedMesh / CoordinateFrame | `.claude/mental_model/1_architecture.md` |
| visual flag / meshview / dispose / memory / Three.js cleanup | `.claude/mental_model/4_memory_management.md` |
| BFF / sceneStore / database / WebSocket / occt / STEP import | `.claude/mental_model/3b_server_async.md` |
| concurrency / async / locking / isProcessing | `docs/CONCURRENCY.md` |
| validation / process / agent workflow / meta | `.claude/PROCESS_NOTES.md` |

**`/adr <topic>`** — slash command to search the ADR index.

Create a new ADR when a design choice is non-obvious or hard to reverse.
Update `docs/adr/README.md` index whenever an ADR is added or superseded.

## After fixing a bug

After every bug fix, **before committing**, ask:
> "Did this bug exist because an implicit rule was missing or misunderstood?"

If yes → add the rule to the relevant `.claude/mental_model/*.md` detail file,
then update the summary row in `.claude/MENTAL_MODEL.md` index.
Use the criteria in MENTAL_MODEL's "What belongs here" section.
When in doubt, add it — stale entries are easier to clean up than missing ones.

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
@.claude/PROCESS_NOTES.md

## Notes for changes

- `vite.config.js` `base` must match the repo name (`/easy-extrude/`)
- Three.js addons must be imported from `three/addons/...`

## Session history

Full log → `docs/SESSION_LOG.md`

- **2026-04-01**: Bugfix — Mobile header overflow. Export/Import buttons clipped on narrow screens; replaced with `_moreMenuBtn` (⋯) dropdown on mobile. `_headerStatusEl` uses `visibility:hidden` (not `display:none`) to remain a flex:1 spacer. MENTAL_MODEL §3 updated.
- **2026-04-01**: Feature — Scene JSON import. `SceneImporter.js` (pure parse/validate); `SceneService.importFromJson()` for all entity types with merge/ID-remap support; `SceneExporter.js` upgraded to v1.1 with ImportedMesh geometry buffers (Base64); Import button + `Ctrl+I` + `showImportModal()` (Clear / Merge / Cancel) in UIView.
- **2026-03-31**: Feature — Scene JSON export. New `SceneExporter.js` pure module; header "Export" button + `Ctrl+E`. Exports Solid/Profile/MeasureLine/CoordinateFrame (with Euler ZYX + world pose)/ImportedMesh with AABB, face normals, attached frames. Browser download via Blob; no BFF dependency.
