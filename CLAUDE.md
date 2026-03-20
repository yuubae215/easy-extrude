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

- **2026-03-20**: ドメインモデル設計 — 「次元と動詞」モデルを確立。Sketch→Cuboid エンティティ差し替えパターン、グラフ基底ジオメトリの方向性を ADR-012 (Proposed) として記録。ロードマップを Phase 4–6 に更新。
- **2026-03-20**: バグ修正 — Sketch に `move()`/`extrudeFace()` が欠落し Extrude 後の Grab・面押し出しが動かない問題を修正。MENTAL_MODEL に次元遷移契約を追加。
- **2026-03-20**: DDD Phase 3 — `SceneService` (ApplicationService) を新設。エンティティ生成・CRUD を AppController から分離。AppController は入力ハンドリングに専念。ADR-011 作成。
- **2026-03-20**: DDD Phase 2 — `Cuboid`/`Sketch` にビヘイビアメソッド追加 (`rename`, `move`, `extrudeFace`, `extrude`)。AppController のドメインロジックをエンティティへ移管。ADR-010 作成。
- **2026-03-20**: DDD Phase 1 — `src/domain/Cuboid.js` / `src/domain/Sketch.js` を新設。plain object 生成を typed entity に置き換え。ADR-009 作成。
- **2026-03-20**: MVC refactor — extracted `SceneModel` from `AppController`. Domain state (`_objects`, `_activeId`, `_selectionMode`, `_editSubstate`) now lives in `src/model/SceneModel.js`. Added `docs/ARCHITECTURE.md` and `docs/STATE_TRANSITIONS.md`.
- **2026-03-20**: Bug fixes + ADR-008 (Mode Transition State Machine). `setMode()` now fully cancels in-progress ops and clears visual state before transitioning. `_addObject`, `_deleteObject` guard against Edit Mode. `MeshView.setFaceHighlight` owns `hlMesh.visible`.
- **2026-03-20**: Added `.claude/commands/adr.md` (`/adr` slash command). Added document navigation guide to CLAUDE.md. Refactored CLAUDE.md to agent-instructions-only format; moved full session history to `docs/SESSION_LOG.md`.
- **2026-03-20**: Architecture design session. ADR-001–006 created. `docs/ROADMAP.md` revised.
- **2026-03-20**: Implemented ADR-002 (Sketch→Extrude) and ADR-004 (Edit Mode 2D/3D dispatch). Shift+A shows Add menu (Box/Sketch). Sketch workflow: draw rect on ground plane → Enter → drag/type height → Enter → Edit Mode · 3D. Objects carry `dimension: 2|3`.
- **2026-03-20**: Implemented ADR-001 (VoxelModel), ADR-003 (middle-click orbit), voxel object system (2×2×2 box default, integer-snap face extrude). (Reverted; cuboid-based model restored.)
- **2026-03-19**: Blender-style UI overhaul (header bar, N panel, bottom info bar, `setStatusRich`). ROS world frame adopted. Grab controls added (G/X/Y/Z, numeric input).
