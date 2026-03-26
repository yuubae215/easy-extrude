# easy-extrude

> **Face Extrude made simple, right in your browser.**

An interactive web app for 3D modeling — sketch shapes, extrude them, sculpt faces, measure distances, and import STEP geometry.
Works on desktop and mobile. No installation required.

**Live Demo:** https://yuubae215.github.io/easy-extrude/

---

## What is this?

"Face Extrude" is the operation of selecting a face on a 3D model and pushing it outward to create new geometry. It's a fundamental technique in tools like Blender and Maya — and we're bringing it to the **browser, the easy way**.

```
Shift+A → Add Sketch → Draw rectangle → Enter → Drag height → Enter → Edit faces → Extrude
```

---

## Features

- **Sketch → Extrude** workflow: draw a 2D rectangle on the ground plane, extrude it into a 3D solid
- **Add Box**: instantly place a default solid object
- **Object Mode**: click to select, left-drag to move, Ctrl+drag to rotate around Z-axis
- **Edit Mode (3D)**: switch sub-element selection between Vertex / Edge / Face (keys `1` / `2` / `3`)
  - Hover to highlight a face, click to select, `E` key (or mobile button) to extrude along normal
  - Live extrusion distance label while dragging
- **Grab** (`G` key): move objects with optional axis lock (X/Y/Z), numeric input, and origin snap (Ctrl)
- **Measure tool** (`M` key): place two snapped endpoints; renders amber dashed line + live distance label
- **Coordinate Frames** (`Shift+A → Frame`): attach named SE(3) reference frames to objects; supports nested hierarchy and `R`-key rotation
- **STEP import**: import STEP files via the Node Editor; server-side tessellation streamed over WebSocket
- **Save / Load scene**: persist and restore scene state via BFF REST API
- **Outliner**: scene hierarchy sidebar — rename objects, toggle visibility, delete; multi-level indentation for nested frames
- **Rectangle selection**: drag on empty space to select multiple objects (enclosed or touch)
- **OrbitControls**: right-drag / two-finger to orbit, scroll / pinch to zoom
- **Mobile toolbar**: fixed floating buttons adapt to current mode; all gestures use Pointer Events
- **ROS world frame**: +X forward, +Y left, +Z up (right-handed, matches ROS REP-103)

---

## Getting Started

```bash
git clone https://github.com/yuubae215/easy-extrude.git
cd easy-extrude
pnpm install
pnpm dev
```

Dev server runs at http://localhost:5173

### Build & Preview

```bash
pnpm build    # Production build → dist/
pnpm preview  # Preview the build locally
```

---

## Project Structure (MVC + DDD)

```
src/
├── main.js                       # Entry point: assembles layers and calls start()
├── domain/
│   ├── Solid.js                  # Domain entity: 3D deformable solid (vertices, faces, edges)
│   ├── Profile.js                # Domain entity: 2D cross-section profile (draw → extrude)
│   ├── MeasureLine.js            # Domain entity: 1D distance annotation (p1, p2 endpoints)
│   ├── CoordinateFrame.js        # Domain entity: named SE(3) reference frame (pose graph node)
│   └── ImportedMesh.js           # Domain entity: read-only server-computed geometry (thin client)
├── graph/
│   ├── Vertex.js                 # { id, position: Vector3 }
│   ├── Edge.js                   # { id, v0: Vertex, v1: Vertex }
│   └── Face.js                   # { id, vertices: Vertex[4], name, index }
├── model/
│   ├── CuboidModel.js            # Pure functions: geometry computation (stateless)
│   └── SceneModel.js             # Aggregate root: objects + mode state + editSelection
├── service/
│   ├── SceneService.js           # ApplicationService: entity creation, CRUD, observable events
│   ├── SceneSerializer.js        # Scene save / load: domain → JSON round-trip
│   └── BffClient.js              # REST + WebSocket client for BFF (WsChannel)
├── view/
│   ├── SceneView.js              # Renderer, camera, OrbitControls, lighting, grid
│   ├── MeshView.js               # Per-object mesh, wireframe, face highlight, sketch rect
│   ├── CoordinateFrameView.js    # Axis arrows + origin sphere; depth rendering; rotation
│   ├── ImportedMeshView.js       # Triangle mesh (BufferGeometry); updateGeometryBuffers()
│   ├── MeasureLineView.js        # Dashed line + distance label; no-op MeshView interface
│   ├── NodeEditorView.js         # SVG DAG panel; draggable nodes; STEP import trigger
│   ├── UIView.js                 # DOM UI: header, N panel, status bar, mobile toolbar
│   ├── GizmoView.js              # World-axis gizmo (top-right corner)
│   └── OutlinerView.js           # Scene hierarchy sidebar; multi-level indentation
└── controller/
    └── AppController.js          # Input handling (Pointer Events), animation loop, MV coordination
```

See `docs/ARCHITECTURE.md` for layer responsibilities and DDD migration status.

---

## Key Bindings

| Key | Action |
|-----|--------|
| `Tab` | Toggle Object ↔ Edit Mode |
| `Shift+A` | Add menu (Box / Sketch / Measure / Frame) |
| `G` | Grab (move) selected object; `X`/`Y`/`Z` to lock axis |
| `R` | Rotate selected coordinate frame; `X`/`Y`/`Z` to lock axis |
| `M` | Start measure placement |
| `S` | Toggle Stack mode during Grab |
| `Shift+D` | Duplicate selected object |
| `X` / `Delete` | Delete selected object |
| `E` | Extrude selected face (Edit Mode · 3D) |
| `1` / `2` / `3` | Vertex / Edge / Face sub-element mode (Edit Mode · 3D) |
| `Enter` | Confirm operation |
| `Escape` | Cancel operation |

---

## Tech Stack

| Tool | Role |
|------|------|
| [Three.js](https://threejs.org/) | 3D rendering |
| [Vite](https://vitejs.dev/) | Bundler & dev server |
| [pnpm](https://pnpm.io/) | Package manager (workspace) |
| Node.js / Express | BFF server (scene persistence, geometry service) |
| SQLite / libsql | Scene storage (server-side) |
| WebSocket (`ws`) | Real-time geometry streaming (BFF ↔ frontend) |
| occt-import-js | Server-side STEP tessellation |
| GitHub Actions | CI/CD → auto deploy to GitHub Pages |

---

## Documentation

| Document | Contents |
|----------|----------|
| `docs/ARCHITECTURE.md` | Layer responsibilities, DDD migration status, coordinate system |
| `docs/STATE_TRANSITIONS.md` | Mode state machine, mobile input flow, toolbar states |
| `docs/ROADMAP.md` | Feature backlog and completed items |
| `docs/adr/` | Architecture Decision Records (ADR-001 … ADR-021) |
| `.claude/MENTAL_MODEL.md` | Coding policies learned from real bugs |

---

Made with Three.js
