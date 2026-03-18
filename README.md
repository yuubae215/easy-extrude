# easy-extrude

> **Face Extrude made simple, right in your browser.**

An interactive web app that lets anyone experience 3D "extrude" operations intuitively — no complex software required. Just open and create.

**Live Demo:** https://yuubae215.github.io/easy-extrude/

---

## What is this?

"Face Extrude" is the operation of selecting a face on a 3D model and pushing it outward to create new geometry. It's a fundamental technique in tools like Blender and Maya — and we're bringing it to the **browser, the easy way**.

```
Switch to Face mode → Hover to highlight a face → Drag to extrude → Your 3D shape is ready!
```

---

## Features

An interactive 3D scene built with Three.js + Vite (MVC architecture).

- Custom **BufferGeometry** cuboid with 8 corners and 6 independently addressable faces
- **Object mode** (`O` key): click to select, left-drag to move, Ctrl+drag to rotate around Y-axis
- **Face mode** (`F` key): hover to highlight a face, left-drag to extrude along face normal
- Extrusion dimension line with live `Δ` label while dragging
- **OrbitControls**: right-drag to orbit camera, scroll to zoom
- Grid helper and directional lighting

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

## Project Structure (MVC)

```
src/
├── main.js                    # Entry point: wires MVC components and calls start()
├── model/
│   └── CuboidModel.js         # Pure functions only (no side effects)
├── view/
│   ├── SceneView.js           # Renderer, camera, OrbitControls, lighting, grid
│   ├── MeshView.js            # Cuboid mesh, wireframe, face highlight, extrusion display
│   └── UIView.js              # DOM UI: mode buttons, status bar, info bar, extrusion label
└── controller/
    └── AppController.js       # Input handling, animation loop, MV coordination
```

---

## Tech Stack

| Tool | Role |
|------|------|
| [Three.js](https://threejs.org/) | 3D rendering |
| [Vite](https://vitejs.dev/) | Bundler & dev server |
| [pnpm](https://pnpm.io/) | Package manager |
| GitHub Actions | CI/CD → auto deploy to GitHub Pages |

---

## Roadmap

- [x] Face selection → Face Extrude interaction
- [ ] Multi-face extrude
- [ ] Export (OBJ / GLTF)
- [ ] Mobile support
- [ ] Draw any 2D shape and extrude it

---

Made with Three.js
