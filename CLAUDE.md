# easy-extrude

Three.js + Vite sample project. An interactive editing scene for a cuboid built with custom BufferGeometry. Deployed to GitHub Pages.

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
| **View** | `view/UIView.js` | DOM element creation, mode buttons, status display, extrusion label, cursor changes |
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
- **Object mode** (O key): left-drag to move / Ctrl+drag to rotate on Z axis (world up)
- **Face select mode** (F key): hover to highlight / left-drag to extrude
- **Blender-style grab** (G key, object mode only):
  - G → start grab (object follows mouse on camera-facing plane)
  - G → X / Y / Z → constrain to that axis (press same key again to release)
  - Type digits while axis is constrained → set exact distance
  - Enter or left-click → confirm; Esc or right-click → cancel
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
