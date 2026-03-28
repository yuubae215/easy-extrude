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
| mobile / touch | `docs/ROADMAP.md` (Mobile Support section) |
| concurrency / async / locking / isProcessing | `docs/CONCURRENCY.md` |
| validation / process / agent workflow / meta | `.claude/PROCESS_NOTES.md` |

**`/adr <topic>`** — slash command to search the ADR index.

Create a new ADR when a design choice is non-obvious or hard to reverse.
Update `docs/adr/README.md` index whenever an ADR is added or superseded.

## After fixing a bug

After every bug fix, **before committing**, ask:
> "Did this bug exist because an implicit rule was missing or misunderstood?"

If yes → add the rule to `.claude/MENTAL_MODEL.md` in the same commit.
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

- **2026-03-28**: Bugfix — mobile Grab immediately confirmed on first canvas tap after long-press context menu. `_onPointerDown` called `_confirmGrab()` for any `e.button === 0` (always true for touch); fixed to set `_activeDragPointerId` and confirm on `_onPointerUp` (same pattern as face extrude). MENTAL_MODEL updated.
- **2026-03-28**: Mobile UX Phase 2 + orbit bugfix — `SceneView.touches.ONE` was `null` (single-finger orbit silently ignored); fixed to `THREE.TOUCH.ROTATE`. Phase 2: Measure menu昇格 (Add メニュー先頭に Measure); CoordinateFrame 選択時ツールバーを専用5スロット (Rotate|Grab|Delete|Add Frame|spacer) に切替; 長押しコンテキストメニュー (`UIView.showContextMenu`/`showRenameDialog`; Grab/Duplicate/Rename/Delete)。MENTAL_MODEL 更新。
- **2026-03-28**: Mobile UX Phase 1 — Undo/Redo buttons in mobile header (`_undoBtn`/`_redoBtn`, `setUndoRedoEnabled`); Duplicate button in Object mode toolbar (5-slot layout: Add|Dup|Edit|Delete|Stack); first-run onboarding overlay (`showOnboardingIfNeeded`, localStorage flag); touch gesture model: single-finger drag = orbit, long-press ≥ 400 ms on selected object = Grab (`_longPress` state). MENTAL_MODEL updated with new Mobile Touch Gesture Model rule.
- **2026-03-20**: MVC refactor — extracted `SceneModel` from `AppController`. Domain state (`_objects`, `_activeId`, `_selectionMode`, `_editSubstate`) now lives in `src/model/SceneModel.js`. Added `docs/ARCHITECTURE.md` and `docs/STATE_TRANSITIONS.md`.
- **2026-03-20**: Bug fixes + ADR-008 (Mode Transition State Machine). `setMode()` now fully cancels in-progress ops and clears visual state before transitioning. `_addObject`, `_deleteObject` guard against Edit Mode. `MeshView.setFaceHighlight` owns `hlMesh.visible`.
- **2026-03-20**: Added `.claude/commands/adr.md` (`/adr` slash command). Added document navigation guide to CLAUDE.md. Refactored CLAUDE.md to agent-instructions-only format; moved full session history to `docs/SESSION_LOG.md`.
- **2026-03-20**: Architecture design session. ADR-001–006 created. `docs/ROADMAP.md` revised.
- **2026-03-20**: Implemented ADR-002 (Sketch→Extrude) and ADR-004 (Edit Mode 2D/3D dispatch). Shift+A shows Add menu (Box/Sketch). Sketch workflow: draw rect on ground plane → Enter → drag/type height → Enter → Edit Mode · 3D. Objects carry `dimension: 2|3`.
- **2026-03-20**: Implemented ADR-001 (VoxelModel), ADR-003 (middle-click orbit), voxel object system (2×2×2 box default, integer-snap face extrude). (Reverted; cuboid-based model restored.)
- **2026-03-19**: Blender-style UI overhaul (header bar, N panel, bottom info bar, `setStatusRich`). ROS world frame adopted. Grab controls added (G/X/Y/Z, numeric input).
