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

- **2026-03-29**: Bugfix — OrbitControls remained active during CoordinateFrame Rotate mode. `_startRotate()` was missing `this._controls.enabled = false`; `_confirmRotate()` and `_cancelRotate()` were missing the re-enable. MENTAL_MODEL "Input Method Mutually Exclusive States" rule updated to include Rotate and Grab in the disable list.
- **2026-03-29**: Feature — Swagger UI added to BFF. Installed `swagger-ui-express` v5; created `server/src/openapi.js` with an OpenAPI 3.0 spec covering all BFF endpoints; mounted at `GET /api/docs` (public, no auth). JWT BearerAuth security scheme and dev-token flow documented in the UI.
- **2026-03-29**: Documentation — MENTAL_MODEL.md (40.7k) split into 6.9k lean index + 4 detail files under `.claude/mental_model/`; CLAUDE.md navigation table updated with per-section pointers. ADR-023 (Mobile Input Model) and ADR-024 (Mobile Toolbar Architecture) created to formally record mobile UX design decisions. `docs/adr/README.md` index and `docs/ROADMAP.md` Mobile UX section updated.
