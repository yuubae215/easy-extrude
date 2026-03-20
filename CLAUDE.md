# easy-extrude

Three.js + Vite sample project. An interactive editing scene for a cuboid built with custom BufferGeometry. Deployed to GitHub Pages.

## Document navigation (read this at every session start)

Before writing or modifying any code, consult the relevant documents below.
Use the index to decide what to read — do not guess at design decisions.

| Trigger keyword in prompt | What to read first |
|---------------------------|--------------------|
| architecture / design / why | `docs/adr/README.md` → follow relevant ADR links |
| new feature / implementation plan | `docs/ROADMAP.md`, then related ADRs |
| mouse / keyboard / controls / orbit | ADR-003, ADR-006 |
| mode / edit mode / object mode / sketch | ADR-002, ADR-004 |
| object / hierarchy / 1D / 2D / 3D | ADR-005 |
| voxel / shape / geometry / extrude | ADR-001, ADR-002 |
| mobile / touch / pointer | `docs/ROADMAP.md` (Mobile Support section) |
| ADR / decision record | `docs/adr/README.md` (full index) |

**Slash command:** `/adr <topic>` — searches the ADR index and returns relevant decisions.

### When to create a new ADR

Create a new ADR (and update `docs/adr/README.md`) when:
- A significant design choice is made that is non-obvious or hard to reverse
- An existing ADR is superseded (update its status field, add a new ADR)

Do NOT create an ADR for implementation details or bug fixes.

## Development commands

```bash
pnpm install       # install dependencies
pnpm dev           # start dev server (http://localhost:5173)
pnpm build         # production build (output to dist/)
pnpm preview       # preview production build
```

## Tech stack

- **Three.js** - 3D rendering
- **Vite** - bundler / dev server
- **pnpm** - package manager
- **GitHub Actions** - CI/CD

## Project structure (MVC architecture)

```
easy-extrude/
├── index.html                        # entry point
├── vite.config.js                    # Vite config (base: '/easy-extrude/')
├── package.json
├── src/
│   ├── main.js                       # startup entry: assembles MVC and calls start()
│   ├── model/
│   │   └── CuboidModel.js            # pure functions only (no side effects)
│   ├── view/
│   │   ├── SceneView.js              # renderer, camera, controls, lighting, grid
│   │   ├── MeshView.js               # cuboid mesh, wireframe, face highlight
│   │   └── UIView.js                 # DOM UI (mode buttons, status bar, info bar)
│   └── controller/
│       └── AppController.js          # input handling, animation loop, MV wiring
└── .github/
    └── workflows/
        └── deploy.yml                # GitHub Pages deploy workflow
```

## MVC design

| Layer | File | Responsibility |
|---|---|---|
| **Model** | `model/CuboidModel.js` | Data definitions (`FACES`, `createInitialCorners`) and pure functions (`buildGeometry`, `computeFaceNormal`, `computeOutwardFaceNormal`, `getCentroid`, `buildFaceHighlightPositions`, `toNDC`) |
| **View** | `view/SceneView.js` | Three.js scene, WebGL renderer, OrbitControls initialization and `render()` |
| **View** | `view/MeshView.js` | Cuboid mesh, wireframe, BoxHelper, face highlight, extrusion display line updates |
| **View** | `view/UIView.js` | DOM element creation, header bar (mode dropdown), status display, bottom info bar, N panel, extrusion label, cursor changes |
| **Controller** | `controller/AppController.js` | Mouse/keyboard events, raycasting, mode switching, animation loop |

### Pure functions vs. side effects

- **Pure functions** (`CuboidModel.js`): depend only on their arguments; never mutate external state
- **Side effects** (View / Controller): DOM manipulation, WebGL rendering, event registration, `requestAnimationFrame`

## World coordinate system

This project uses **ROS world frame** as the canonical coordinate system:

| Axis | Direction |
|------|-----------|
| +X | forward (toward viewer in default camera view) |
| +Y | left |
| +Z | up (sky) |

Right-handed system. Matches ROS REP-103. Three.js `camera.up` is set to `(0, 0, 1)`. The XY plane (Z = 0) is the ground plane.

## Scene features

- **Custom BufferGeometry** cuboid (8 corners × 6 faces)
- **OrbitControls** – right-drag to orbit the camera
- **Object Mode** (O key or Tab from Edit Mode):
  - Left-drag to move / Ctrl+drag to rotate on Z axis (world up)
  - Click to select / deselect
  - G → Grab (Blender-style): X/Y/Z to constrain axis, type digits for exact distance, Enter/LClick confirm, Esc/RClick cancel
- **Edit Mode** (E key or Tab from Object Mode): hover to highlight face / left-drag to extrude
- **N Panel** (N key): toggle right-side properties panel showing Location (centroid) and Dimensions (bounding box)
- **Blender-style header bar**: mode dropdown at top, bottom info bar with context-sensitive key hints
- **GridHelper** and **DirectionalLight**

## GitHub Pages deployment

Automatically deploys on push to `main` or `master`.

**Workflow:** `.github/workflows/deploy.yml`

Deploy URL: `https://yuubae215.github.io/easy-extrude/`

### Repository settings

1. Settings → Pages → Source: set to **GitHub Actions**

## Notes for changes

- `vite.config.js` `base` must match the repository name (`/easy-extrude/`)
- Three.js addons must be imported from `three/addons/...`

## Session history

- **2026-03-17**: Refactored `src/main.js` to MVC pattern. Separated pure functions from side effects into `model/` / `view/` / `controller/`. Session complete.
- **2026-03-18**: Documentation update. Fully revised README.md to match the implemented MVC structure. Added `computeOutwardFaceNormal` to the Model pure function list in CLAUDE.md; updated MeshView and UIView responsibility descriptions to match reality.
- **2026-03-18**: Added Blender-style grab controls (G/X/Y/Z, numeric input, confirm/cancel). Disabled OrbitControls inertia (enableDamping = false). Translated all in-repo text from Japanese to English.
- **2026-03-19**: Adopted ROS world frame (+X forward, +Y left, +Z up). Updated coordinate system in CuboidModel (face definitions, corner labels), SceneView (camera.up, grid rotation), AppController (Ctrl+drag rotation axis Y→Z), MeshView (extrusion arm axis preference), and GizmoView (top/bottom snap Z+/Z-).
- **2026-03-19**: Blender-style UI overhaul. Added header bar with mode dropdown (Object Mode / Edit Mode), Tab key toggle, N panel (N key) for Location/Dimensions, bottom info bar with context-sensitive key hints. Renamed 'face' mode to 'edit'.
- **2026-03-19**: Refined status display to be fully Blender-like. Removed floating yellow status div; integrated status into the header bar (centered). Added `setStatusRich(parts)` to UIView for colored, segmented status text. Grab now shows axis in X/Y/Z colors (red/green/blue), Extrude shows face name + distance, object selection shows object name.
- **2026-03-20**: Architecture design session (no implementation). Decided on voxel-based modeling approach. Defined two modeling methods: Method A (Primitive Box) and Method B (Sketch → Extrude → same Edit Mode). Adopted middle-click for orbit (freeing right-click for cancel/context-menu). Defined Edit Mode adapting to object type (1D/2D/3D) instead of separate Sketch Mode. Designed object hierarchy with dimensional classification. Mobile support added to backlog (low priority). ADRs written to `docs/adr/` (ADR-001 through ADR-006). `docs/ROADMAP.md` fully revised.
