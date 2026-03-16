# easy-extrude

> **Face Extrude made simple, right in your browser.**

An interactive web app that lets anyone experience 3D "extrude" operations intuitively — no complex software required. Just open and create.

**Live Demo:** https://yuubae215.github.io/easy-extrude/

---

## What is this?

"Face Extrude" is the operation of selecting a face on a 3D model and pushing it outward to create new geometry. It's a fundamental technique in tools like Blender and Maya — and we're bringing it to the **browser, the easy way**.

```
Click to select a face → Drag to extrude → Your 3D shape is ready!
```

---

## Current State

A prototype interactive 3D scene built with Three.js + Vite.

- 3D shapes (star, heart, arrow) using ExtrudeGeometry
- Mouse controls via OrbitControls (rotate, zoom, pan)
- Animated PointLight orbiting the scene
- Floating particle effects
- Fog and grid helpers

---

## Roadmap

- [ ] Draw any 2D shape and extrude it
- [ ] Face selection → Face Extrude interaction
- [ ] Export (OBJ / GLTF)
- [ ] Mobile support

---

## Getting Started

```bash
git clone https://github.com/yuubae215/easy-extrude.git
cd easy-extrude
pnpm install
pnpm dev
```

Dev server runs at http://localhost:5173

## Tech Stack

| Tool | Role |
|------|------|
| [Three.js](https://threejs.org/) | 3D rendering |
| [Vite](https://vitejs.dev/) | Bundler & dev server |
| [pnpm](https://pnpm.io/) | Package manager |
| GitHub Actions | CI/CD → auto deploy to GitHub Pages |

---

Made with Three.js
