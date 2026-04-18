<div align="center">

# easy-extrude

**Browser-native 3D modeling — sketch, extrude, sculpt. No installation.**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen?style=for-the-badge&logo=githubpages)](https://yuubae215.github.io/easy-extrude/)
[![License](https://img.shields.io/github/license/yuubae215/easy-extrude?style=for-the-badge)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-0.172-black?style=for-the-badge&logo=threedotjs)](https://threejs.org/)
[![Built with Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)

[**Try the Live Demo →**](https://yuubae215.github.io/easy-extrude/)

</div>

---

## What is easy-extrude?

easy-extrude brings the core modeling operations of tools like Blender and Maya **directly into your browser** — no plugins, no downloads, no GPU drivers to configure.

Draw a rectangle. Extrude it into a solid. Select a face. Push it outward. That's the loop.

```
Shift+A  →  Draw rectangle  →  Enter  →  Drag height  →  Enter  →  E to extrude
```

It runs on desktop **and mobile**. It speaks the **ROS coordinate frame** convention out of the box (+X forward, +Y left, +Z up). And it has a full undo history, STEP import, IFC classification, and a spatial annotation system for robotics-aware scene construction.

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
- **Map Mode** — draw Routes, Zones, Boundaries, Hubs, and Anchors over the scene
- **Measure Tool** (`M`) — snap two endpoints; renders an amber dashed line with a live distance label
- **Coordinate Frames** (`Shift+A → Frame`) — named SE(3) reference frames in a pose graph; supports nested hierarchy and `R`-key rotation
- **Spatial Links** (`L`) — create typed directional relationships between any two entities; visualised as arrowheads in the scene

### Data Interop
- **STEP Import** — import `.step` / `.stp` files via the Node Editor; server-side tessellation streamed over WebSocket
- **IFC Classification** — assign IFC classes (IfcWall, IfcBeam, IfcColumn …) to any Solid or ImportedMesh
- **Export / Import** (`Ctrl+E` / `Ctrl+I`) — round-trip scene as structured JSON (geometry, frames, links, annotations)
- **Save / Load** — persist and restore scene state via the BFF REST API

### Selection & Navigation
- **Edit Mode** (`Tab`) — sub-element selection: Vertex (`1`), Edge (`2`), Face (`3`)
- **Rectangle Selection** — drag on empty space to multi-select (enclosed or touch)
- **Outliner** — scene hierarchy sidebar; rename, toggle visibility, delete; multi-level indentation for nested frames
- **OrbitControls** — right-drag / two-finger to orbit, scroll / pinch to zoom

### Mobile-First
- **Mobile Toolbar** — fixed floating buttons adapt to the current mode; slot positions never shift
- **Touch Gestures** — tap to select, one-finger drag to orbit, long-press for context menu (Grab / Duplicate / Rename / Delete)
- **Pointer Events API** — all interactions use unified Pointer Events; no separate touch/mouse branches

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [pnpm](https://pnpm.io/) ≥ 9

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

easy-extrude follows a strict **MVC + Domain-Driven Design** layering. The domain layer is pure — it holds no Three.js, no DOM, no I/O.

```
src/
├── domain/          # Pure entities — Solid, Profile, MeasureLine, CoordinateFrame, …
├── graph/           # Geometry graph — Vertex, Edge, Face
├── model/           # Aggregate root (SceneModel) + pure geometry computation (CuboidModel)
├── command/         # Undo/redo commands — one class per operation
├── service/         # Application services — SceneService, Serializer, Exporter, BffClient
├── view/            # Three.js + DOM views — SceneView, MeshView, UIView, OutlinerView, …
└── controller/      # AppController — thin input → Model/Service/View coordination
```

**Key invariants:**
- Domain depends on nothing outside itself
- Controllers are thin — no business logic
- Every visual flag has exactly one owner method
- Every async call is awaited at its layer

For the full design rationale see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the [ADR log](docs/adr/).

---

## Tech Stack

| Technology | Role |
|-----------|------|
| [Three.js](https://threejs.org/) 0.172 | 3D rendering, OrbitControls |
| [Vite](https://vitejs.dev/) 6 | Bundler & dev server |
| [pnpm](https://pnpm.io/) | Package manager (workspace) |
| Rust + WebAssembly | High-performance geometry engine (`wasm-engine`) |
| Node.js / Express | BFF server — scene persistence, geometry service |
| SQLite / libsql | Server-side scene storage |
| WebSocket (`ws`) | Real-time geometry streaming (BFF ↔ frontend) |
| [occt-import-js](https://github.com/kovacsv/occt-import-js) | Server-side STEP tessellation |
| GitHub Actions | CI/CD → auto deploy to GitHub Pages |

---

## Documentation

| Document | Contents |
|----------|----------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layer responsibilities, DDD design, coordinate system |
| [`docs/STATE_TRANSITIONS.md`](docs/STATE_TRANSITIONS.md) | Mode FSM, mobile input flow, toolbar states |
| [`docs/SCREEN_DESIGN.md`](docs/SCREEN_DESIGN.md) | Information architecture per mode |
| [`docs/LAYOUT_DESIGN.md`](docs/LAYOUT_DESIGN.md) | UI layout, z-index, responsive breakpoints, toolbar slots |
| [`docs/EVENTS.md`](docs/EVENTS.md) | Domain events, keyboard shortcuts, pointer/touch events |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Feature backlog and completed milestones |
| [`docs/CODE_CONTRACTS.md`](docs/CODE_CONTRACTS.md) | Coding rules derived from real bugs |
| [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) | Design principles distilled from post-mortems |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records (ADR-001 … ADR-033) |
| [`docs/CONCURRENCY.md`](docs/CONCURRENCY.md) | Optimistic vs. pessimistic locking strategy |

---

## Coordinate System

easy-extrude uses the **ROS world frame** convention:

```
+X  forward
+Y  left
+Z  up
```

Right-handed. Matches [ROS REP-103](https://www.ros.org/reps/rep-0103.html). `camera.up = (0,0,1)`. The XY plane (Z=0) is the ground plane.

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
