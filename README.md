<div align="center">

# easy-extrude

**Browser-native 3D modeling — sketch, extrude, sculpt. No installation.**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen?style=for-the-badge&logo=githubpages)](https://yuubae215.github.io/easy-extrude/)
[![License](https://img.shields.io/github/license/yuubae215/easy-extrude?style=for-the-badge)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-0.172-black?style=for-the-badge&logo=threedotjs)](https://threejs.org/)
[![Built with Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)

[**Try the Live Demo →**](https://yuubae215.github.io/easy-extrude/)

<sub>GitHub Pages has no backend, so the demo is built in the grasp <b>stub lane</b> (ADR-117) — stubbed screens are labelled as such.</sub>

<br>

<img src="docs/media/hero-sketch-extrude.gif" alt="New scene → sketch a rectangle on the ground → extrude it into a solid → orbit" width="880">

<sub>Recorded from the real app with <a href="tools/screencast/README.md"><code>pnpm screencast</code></a> — the scenario is a JSON file, so re-shooting is one command.</sub>

</div>

---

## What is easy-extrude?

easy-extrude brings the core modeling operations of tools like Blender and Maya **directly into your browser** — no plugins, no downloads, no GPU drivers to configure.

Draw a rectangle. Extrude it into a solid. Select a face. Push it outward. That's the loop.

```
Shift+A  →  Draw rectangle  →  Enter  →  Drag height  →  Enter  →  E to extrude
```

It runs on desktop **and mobile**. It speaks the **ROS coordinate frame** convention out of the box (+X forward, +Y left, +Z up; world unit = mm). It opens on a **Home screen** of work-cell templates, keeps a full undo history, and grows from plain modeling into robotics-aware scene construction: requirement capture, spatial relations, and a grasp-search backend that answers *where and how a robot can pick a part* — and *why not* when it can't.

---

## Features

### Core Modeling
- **Sketch → Extrude** — draw a 2D rectangle on the ground plane, extrude to a 3D solid
- **Add Box** — place a default solid instantly with `Shift+A`
- **Face Extrude** (`E`) — select a face in Edit Mode, drag along its normal; live distance label updates in real time
- **Grab** (`G`) — move objects with axis lock (`X`/`Y`/`Z`), numeric input, origin snap (`Ctrl`)
- **Duplicate** (`Shift+D`) — copies geometry and all attached frames
- **Undo / Redo** (`Ctrl+Z` / `Ctrl+Y`) — full command history for every operation

### Spatial Annotations & Mapping
- **Places** (`Shift+A`) — Routes, Zones, Boundaries, Hubs, and Anchors drawn over the scene; Map is a top-down *viewpoint*, not a separate mode (ADR-103). Annotations render as light falling on the floor, phased from each entity's own identity so a population never pulses in lockstep (ADR-093/166)
- **Districts own the floor** — a zone stands at its declared elevation, a thing's floor comes from the district it belongs to, and overlaps are resolved by declared owners (ADR-170); the floor holds under rotation and extrusion too (ADR-169)
- **Spatial relations in axes** — a relation between two things is said as direction × contact × mobility, claimed by a named person and checked against the layout; the words are shown where they point (ADR-168)
- **Measure Tool** (`M`) — snap two endpoints; renders an amber dashed line with a live distance label
- **Coordinate Frames** (`Shift+A → Frame`) — named SE(3) reference frames in a pose graph; supports nested hierarchy and `R`-key rotation
- **Spatial Links** (`L`) — create typed directional relationships between any two entities; visualised as arrowheads in the scene

### Data Interop
- **STEP Import** — import `.step` / `.stp` files via the Node Editor; server-side tessellation streamed over WebSocket
- **IFC Classification** — assign IFC classes (IfcWall, IfcBeam, IfcColumn …) to any Solid or ImportedMesh
- **Export / Import** (`Ctrl+E` / `Ctrl+I`) — round-trip scene as structured JSON (geometry, frames, links, annotations)
- **Save / Load** — persist and restore scene state via the BFF REST API

### External Layout API (ADR-045)
- **Layout DSL** — declarative JSON that encodes *Why* (constraints), *How* (strategy: `linear` / `grid` / `stack` / `radial` / `manual`), and *What* (entity dimensions, coordinate frames, spatial links)
- **CLI** — compile a Layout DSL file to a loadable scene JSON, or save it directly to the BFF database; no browser required
- **REST API** — `POST /api/layout/compile` and `POST /api/layout/scenes`; Swagger docs at `GET /api/docs`
- **NL → Layout DSL via Claude API** — pass `--ai` to the `interpret` command; the LLM generates Layout DSL (never executable code), then `validateLayoutDsl()` catches any schema violations before the scene is built
- **Scene ⇄ DSL round-trip** — `LayoutDecompiler` inverts a scene back to Layout DSL up to a named normal form (ADR-055)

### Requirement Context & Negotiation (ADR-046 … 052)
- **Context DSL** — capture requirements as Facts, Decisions, Open Questions, KPIs and admissible regions *before* geometry exists; the scene is a derived projection of the approved context
- **Multiple intake paths** — Home-screen templates that open as documents (ADR-089/162), blank doc, fork-&-tweak seeded examples, guided wizard, parametric 3D assets, and conservative NL → Fact extraction
- **Conflict negotiation** — conflict matrix, negotiation clusters, per-actor admissible-region ghosts in 3D; approvals are undoable commands
- **Criteria heard before design** — end users are interviewed one at a time for expectations and weights; the agreed line moves only by approved proposal, with versions and stale-margin detection (ADR-165)
- **Adopt from the screen** — declaring on an on-screen object brings it into the document; adoption inverts the whole scene, then cuts the connected component (ADR-159/163)
- **Why provenance** — every scene entity can be traced back through the 5W1H chain to the requirements that justify it (Why breadcrumb / Why tree)

### Robotics & Grasp Search (ADR-053, ADR-074 … 172)
- **Robots as scene entities** — 0, 1 or N robots grounded in a TF tree (`world → robot_base → tcp`); real meshes by default with a lightweight toggle (ADR-149); the tool is fixed to the flange and the TCP is derived from its mounting (ADR-150/151); analytic UR IK (ADR-127)
- **Declarations live on their owners** — grasp spec & strategy, gripper / suction hands, centre of mass, the grasp relation and the camera are declared on the panel of the entity that owns the fact (ADR-152/164/118/121); the camera's field of view is drawn as the rectangle that is judged (ADR-171)
- **Robotics KPI checks** — URDF-style joint taxonomy, forward kinematics reach sampling, AABB collision baking; results are baked into the context doc as measured facts
- **C++/Rust wasm engines** — KDL + ruckig compiled to WebAssembly for kinematics/trajectory; Rust wasm geometry engine
- **Grasp search backend** — Python judgement engine (candidate generation → staged domain filters: see / reach / grasp / interference → weighted scoring) behind a FastAPI core API, proxied by the BFF under a versioned JSON-Schema contract (`packages/grasp-contract`, currently **contract v13**). Interference is judged per motion phase including the arm links (ADR-145/157); the rejection funnel says *why* candidates were dropped, and an objective that could not be measured is never scored as 0 (ADR-120)
- **Replay** — the judged samples of each phase are replayed in 3D, and each obstacle's rejection can be replayed by the best candidate it stopped (ADR-158)
- **Propose-only recommendation lane** — embedding similarity only proposes and ranks; deterministic equivalence stays in the frontend core (ADR-056/077)

### Selection & Navigation
- **Edit Mode** (`Tab`) — sub-element selection: Vertex (`1`), Edge (`2`), Face (`3`)
- **Rectangle Selection** — drag on empty space to multi-select (enclosed or touch)
- **Outliner** — scene hierarchy sidebar; rename, toggle visibility, delete; multi-level indentation for nested frames
- **OrbitControls** — right-drag / two-finger to orbit, scroll / pinch to zoom

### Mobile-First
- **Mobile Toolbar** — fixed floating buttons adapt to the current mode; slot positions never shift
- **Touch Gestures** — tap to select, one-finger drag to orbit, two-finger pinch-zoom (incl. Map Mode), long-press for context menu (Grab / Duplicate / Rename / Delete)
- **Pointer Events API** — all interactions use unified Pointer Events; no separate touch/mouse branches

### Polish & Motion (ADR-065 … 068, 080, 166)
- **Motion identity** — a studio work cell lit by exactly one stage light that casts real shadows; role-based easing (`land` / `fade` / `exit` / `loop`, one `spring`), crisp timing (≤ 300 ms responses), one accent colour (ADR-166)
- **Governed motion system** — every effect declares its tier (Fact / Affordance / Delight), runs under a `MotionGovernor` budget, and degrades under `prefers-reduced-motion`; idle loops read a 20 fps idle clock so waiting things don't spin the GPU
- **Camera focus flight** (`F` / `Home` / double-click), boot reveal, lifecycle voxels cut from the entity's own shape, onboarding tour
- **English UI** — on-screen language is English; input language is free (ADR-161)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20 (CI runs on 22)
- [pnpm](https://pnpm.io/) ≥ 10
- [uv](https://docs.astral.sh/uv/) — only for the optional Python grasp-search core API

### Run locally

```bash
git clone https://github.com/yuubae215/easy-extrude.git
cd easy-extrude
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

### With the BFF server (STEP import + scene persistence)

```bash
pnpm dev:all   # starts both the BFF (port 3001) and the Vite dev server
```

The neutral contract lives in-repo (`packages/grasp-contract` — ADR-082), so no submodule
init is needed for the dev stack. (`git submodule update --init --recursive` is only for
the optional C++ WASM build lane — see `robotics-wasm/`.)

### Full stack with grasp search (Python core API)

```bash
cd core && uv sync --extra dev --extra serve   # first time only
pnpm dev:stack                                 # core API (:4001) + BFF (:3001) + Vite (:5173)
pnpm test:core                                 # core pytest incl. contract conformance
```

`pnpm dev:all` starts BFF + Vite only (grasp search then answers 503). To try the grasp
UX with no backend at all, run `pnpm dev:stub` (the same stub lane the live demo uses).

### Layout API — generate scenes from the CLI

```bash
# Compile a Layout DSL file → SceneSerializer v1.3 JSON (no BFF required)
pnpm layout compile examples/factory_layout.json --pretty

# Compile + save scene to the BFF database
pnpm layout import examples/factory_layout.json --api-url http://localhost:3001

# Natural language → Layout DSL via Claude API → compile/import
ANTHROPIC_API_KEY=sk-... pnpm layout interpret "ロボット3台を1m間隔で配置" --ai

# Swagger UI (BFF must be running)
open http://localhost:3001/api/docs
```

See [`docs/adr/ADR-045-external-layout-api.md`](docs/adr/ADR-045-external-layout-api.md) for the full DSL schema and design rationale.

### Production build

```bash
pnpm build     # → dist/
pnpm preview   # preview the build locally
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Toggle Object ↔ Edit Mode |
| `Shift+A` | Add menu (Box / Sketch / Measure / Frame) |
| `G` | Grab (move) selected object |
| `G` → `X` / `Y` / `Z` | Grab with axis lock |
| `R` | Rotate selected coordinate frame |
| `M` | Start measure placement |
| `L` | Create spatial link (two-phase pick) |
| `S` | Toggle Stack mode during Grab |
| `Shift+D` | Duplicate selected object |
| `X` / `Delete` | Delete selected object |
| `F` / `Home` | Focus camera on selection (flight) |
| `E` | Extrude selected face (Edit Mode 3D) |
| `1` / `2` / `3` | Vertex / Edge / Face sub-element (Edit Mode 3D) |
| `Enter` | Confirm operation |
| `Escape` | Cancel operation |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+E` | Export scene as JSON |
| `Ctrl+I` | Import scene from JSON |

---

## Architecture

easy-extrude is a **three-layer monorepo** — frontend (`src/`) → neutral contract (`packages/grasp-contract`) → backend (`server/` BFF + `core/` Python judgement engine). The frontend follows a strict **MVC + Domain-Driven Design** layering. The domain layer is pure — it holds no Three.js, no DOM, no I/O.

```
src/
├── domain/          # Pure entities — Solid, Profile, CoordinateFrame, SpatialLink, annotations, …
├── graph/           # Geometry graph — Vertex, Edge, Face
├── model/           # Aggregate root (SceneModel) + pure geometry computation (CuboidModel)
├── command/         # Undo/redo commands — one class per operation
├── service/         # Application services — SceneService, ContextService, RoboticsService, BffClient, …
├── layout/          # Layout DSL — validator, compiler (ADR-045), decompiler (ADR-055)
├── context/         # Context DSL — requirement compiler, predicate engine, canonical forms (ADR-046…)
├── robotics/        # Pure FK / collision measurement (ADR-053)
├── view/            # Three.js + DOM views, paired pure *Math.js modules, MotionGovernor
├── components/      # React 19 UI panels (Context, Grasp, Outliner, Chrome, …) + zustand store/
└── controller/      # App / Context / Grasp / MapMode controllers — thin coordination
```

**Key invariants:**
- Domain depends on nothing outside itself
- Controllers are thin — no business logic
- Every visual flag has exactly one owner method
- Every async call is awaited at its layer
- The frontend never solves constraints (IK / collision / reach) — solvers live in `core/`, reached only through the versioned contract

For the full design rationale see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the [ADR log](docs/adr/).

---

## Tech Stack

| Technology | Role |
|-----------|------|
| [Three.js](https://threejs.org/) 0.172 | 3D rendering, OrbitControls |
| [React](https://react.dev/) 19 + [zustand](https://zustand.docs.pmnd.rs/) | UI panels (Context, Grasp, Outliner, Chrome) |
| [Vite](https://vitejs.dev/) 6 | Bundler & dev server |
| [pnpm](https://pnpm.io/) | Package manager (workspace) |
| Rust + WebAssembly | High-performance geometry engine (`wasm-engine`) |
| C++ → WebAssembly (Emscripten) | KDL kinematics + ruckig trajectories (`robotics-wasm`) |
| Node.js / Express | BFF server — scene persistence, geometry service, grasp proxy |
| Python / [FastAPI](https://fastapi.tiangolo.com/) / [uv](https://docs.astral.sh/uv/) | Grasp-search judgement engine (`core/`) |
| JSON Schema / [ajv](https://ajv.js.org/) | DSL & wire contracts (`schema/`, `packages/grasp-contract`) |
| SQLite / libsql | Server-side scene storage |
| WebSocket (`ws`) | Real-time geometry streaming (BFF ↔ frontend) |
| [occt-import-js](https://github.com/kovacsv/occt-import-js) | Server-side STEP tessellation |
| [Claude API](https://www.anthropic.com/) | NL → Layout DSL (`interpret --ai`, optional) |
| [Playwright](https://playwright.dev/) | E2E smoke tests (ADR-064) |
| GitHub Actions | CI gate + auto deploy to GitHub Pages |

---

## Documentation

| Document | Contents |
|----------|----------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Monorepo layers, MVC/DDD design, entity taxonomy, coordinate system |
| [`docs/NAVIGATION.md`](docs/NAVIGATION.md) | Keyword → "read first" index across all docs and ADRs |
| [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) | Where each computation lives; kinematics, interference and gauge formulas |
| [`docs/STATE_TRANSITIONS.md`](docs/STATE_TRANSITIONS.md) | Mode FSM, mobile input flow, toolbar states |
| [`docs/SCREEN_DESIGN.md`](docs/SCREEN_DESIGN.md) | Information architecture per mode |
| [`docs/LAYOUT_DESIGN.md`](docs/LAYOUT_DESIGN.md) | UI layout, z-index, responsive breakpoints, toolbar slots |
| [`docs/EVENTS.md`](docs/EVENTS.md) | Domain events, keyboard shortcuts, pointer/touch events |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Feature backlog and completed milestones |
| [`docs/CODE_CONTRACTS.md`](docs/CODE_CONTRACTS.md) | Coding rules derived from real bugs |
| [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) | Design principles distilled from post-mortems |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records (ADR-001 … ADR-172) |
| [`docs/CONCURRENCY.md`](docs/CONCURRENCY.md) | Optimistic vs. pessimistic locking strategy |
| [`core/README.md`](core/README.md) | Python grasp-search engine and core API |

---

## Coordinate System

easy-extrude uses the **ROS world frame** convention:

```
+X  forward
+Y  left
+Z  up
```

Right-handed. Matches [ROS REP-103](https://www.ros.org/reps/rep-0103.html). `camera.up = (0,0,1)`. The XY plane (Z=0) is the ground plane.

The world unit is **millimetres**; robots, URDF and the grasp contract are converted to metres only at the wire boundary, and external coordinates declare their own frame (unit, handedness, up axis) before entering the world (ADR-136/139).

This makes easy-extrude a natural fit for robotics scene construction and ROS-based simulation pipelines.

---

## Contributing

Contributions are welcome! Before opening a PR:

1. Read [`CLAUDE.md`](CLAUDE.md) for constitutional rules and the document navigation table.
2. Check the relevant ADR(s) for your area — non-obvious design choices are already documented.
3. Run `pnpm typecheck` to verify branded-type contracts (`WorldVector3` / `LocalVector3`).
4. After a bug fix, ask: *"Did this bug exist because an implicit rule was missing?"* — if yes, add it to [`docs/CODE_CONTRACTS.md`](docs/CODE_CONTRACTS.md).

---

## License

[MIT](LICENSE) — © yuubae215
