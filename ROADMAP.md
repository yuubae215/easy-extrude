# Roadmap: Implementation Plans

## Status

| Item | Status |
|------|--------|
| Face selection → Face Extrude interaction | ✅ Done |
| Multi-face extrude | 📋 Planned |
| Export (OBJ / GLTF) | 📋 Planned |
| Mobile support | 📋 Planned |
| Draw any 2D shape and extrude it | 📋 Planned |

---

## 1. Multi-face extrude

**Goal:** Select multiple faces with Shift+click and extrude them all simultaneously.

### Design

- Each face moves independently along its own outward normal.
- Selection is additive (Shift+click toggles a face in/out of selection).
- All selected faces highlight simultaneously.

### Changes by layer

#### Model (`CuboidModel.js`)
No new pure functions needed. The existing `computeOutwardFaceNormal`, `buildGeometry`, and `buildFaceHighlightPositions` all operate per-face already.

#### Controller (`AppController.js`)
- Add `_selectedFaces: Set<number>` to track the multi-selection.
- In face mode, Shift+click toggles a face in/out of `_selectedFaces`; plain click clears the set and selects one face.
- When a drag begins on any selected face, compute `_dragNormal` and `_dragStart` for the dragged face.
- On `mousemove` during drag, compute `dist` once (projection along the dragged face's normal), then apply the same `dist` to every face in `_selectedFaces` independently (each along its own normal × dist).
- Save `_savedFaceCorners` as a `Map<faceIndex, Vector3[4]>` covering all selected faces.
- On mouseup, clear extrusion display for all faces.

#### View (`MeshView.js`)
- `setFaceHighlight` currently handles one face at a time. Extend to `setFaceHighlights(faceIndices, corners)` that renders one quad per selected face (or merges them into one BufferGeometry).
- Update `clearFaceHighlight` to clear all highlight quads.

#### View (`UIView.js`)
- Status bar text: update to show how many faces are selected (e.g., `"2 faces selected"`).

### Key risks
- Shared corners: if two adjacent faces share a corner (e.g., Top and Front share the top-front-left corner), moving both faces simultaneously will double-apply the offset to that corner. Mitigation: collect all `(cornerIndex, offset)` pairs, group by corner, and sum only distinct face contributions before applying — or allow the double-offset as intentional behaviour (like Blender's "Individual Faces" extrude mode).

---

## 2. Export (OBJ / GLTF)

**Goal:** Download the current cuboid as an OBJ or GLTF file.

### Design

- Two export buttons added to the UI: **Export OBJ** and **Export GLTF**.
- Export uses the current `corners` state (the live geometry), not a reset shape.
- The exported file is saved via a browser download (no server needed).

### Changes by layer

#### Model (`CuboidModel.js`)
No changes. `buildGeometry(corners)` already returns a complete `BufferGeometry`.

#### View (`UIView.js`)
- Add an export toolbar (e.g., a row of buttons in the bottom-right corner).
- Methods: `onExportOBJ(callback)`, `onExportGLTF(callback)`.

#### Controller (`AppController.js`)
- On export OBJ click:
  ```js
  import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
  const exporter = new OBJExporter();
  const result = exporter.parse(meshView.cuboid);
  triggerDownload(result, 'model.obj', 'text/plain');
  ```
- On export GLTF click:
  ```js
  import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
  const exporter = new GLTFExporter();
  exporter.parse(meshView.cuboid, (gltf) => {
    const json = JSON.stringify(gltf);
    triggerDownload(json, 'model.gltf', 'application/json');
  }, (err) => console.error(err), { binary: false });
  ```
- Helper `triggerDownload(content, filename, mimeType)`: creates a temporary `<a>` element, sets `href` to a Blob URL, programmatically clicks it, then revokes the URL.

### Key risks
- `OBJExporter` and `GLTFExporter` are included in the Three.js addons; no new npm packages required.
- The exported mesh uses the merged BufferGeometry from `buildGeometry`. Normals and indices are already computed correctly, so exported models should display correctly in other tools.

---

## 3. Mobile support

**Goal:** Allow face extrude and object manipulation via touch (smartphones / tablets). OrbitControls already supports two-finger orbit and pinch-to-zoom natively.

### Design

- Replace raw `mouse*` event listeners with **Pointer Events API** (`pointerdown`, `pointermove`, `pointerup`). Pointer events unify mouse, touch, and stylus with no behaviour change on desktop.
- Single-finger touch → same as left mouse button drag.
- The UI buttons already work on touch (they are standard `<button>` elements).

### Changes by layer

#### Controller (`AppController.js`)
- Replace `addEventListener('mousedown', ...)` → `addEventListener('pointerdown', ...)`, etc.
- Add `canvas.setPointerCapture(e.pointerId)` on pointerdown so that pointermove continues firing even if the finger leaves the canvas bounds.
- Check `e.pointerType === 'touch'` where behaviour needs to differ (e.g., skip hover highlights on touch since there is no hover state).
- Disable `OrbitControls` while a face or object drag is in progress (already done via `controls.enabled = false`).

#### View (`UIView.js`)
- Add `touch-action: none` CSS to the canvas to prevent the browser from intercepting touch gestures.
- Ensure all UI buttons have sufficient tap target size (min 44×44 px).
- Make the status and info bars legible on small screens (responsive font size / padding).

#### View (`SceneView.js`)
- Verify `renderer.setPixelRatio(window.devicePixelRatio)` is called (ensures sharp rendering on high-DPI screens). Already likely done; confirm.

### Key risks
- Multi-touch: if a second finger lands during a single-finger drag, the pointerdown for that second finger could trigger unintended actions. Mitigation: track `_activeDragPointerId` and ignore pointerdown events when another drag is in progress.
- Long-press context menu on some mobile browsers: suppress with `contextmenu` event handler (return `false`).

---

## 4. Draw any 2D shape and extrude it

**Goal:** Let users draw a custom polygon on a 2D plane and extrude it into a 3D solid.

### Design

This is the most complex roadmap item. It introduces a new **Draw mode** and a new geometry type alongside the existing cuboid.

### Modes
Add a third mode: **Draw mode** (`D` key), or a two-phase flow:
1. **Sketch phase** — user clicks to place vertices on the XZ ground plane; double-click or Enter to close the shape.
2. **Extrude phase** — a height input or vertical drag sets the extrusion depth; Enter to confirm.

### Changes by layer

#### Model (`ShapeModel.js`) — new file
Pure functions for the custom shape:

```js
// Build a THREE.Shape from an array of {x, z} points
export function buildShape(points)

// Extrude a THREE.Shape into a THREE.ExtrudeGeometry
export function buildExtrudedGeometry(shape, depth)

// Compute the 2D convex hull (optional, for validation)
export function isValidPolygon(points)
```

Three.js `THREE.ExtrudeGeometry` handles the heavy lifting: it accepts a `THREE.Shape` (2D polygon) and an extrusion depth and returns a full `BufferGeometry` with side faces, top, and bottom caps.

#### View (`SketchView.js`) — new file
- Renders a **grid plane** (already exists in SceneView) for visual reference.
- Draws temporary line segments as the user clicks to indicate the evolving polygon outline.
- Renders small sphere markers at each placed vertex.
- On shape close, renders the filled polygon face (using `THREE.ShapeGeometry`).

#### View (`MeshView.js`)
- Add `setExtrudedShape(geometry)` to add / replace an extruded mesh in the scene.
- The extruded shape replaces (or coexists alongside) the cuboid mesh. The simplest initial version: drawing a new shape replaces the cuboid.

#### View (`UIView.js`)
- Add **Draw mode** button (D key shortcut shown in tooltip).
- Status bar guidance text for each sketch phase:
  - Sketch: `"Click to place points • Double-click or Enter to close shape"`
  - Extrude: `"Drag up/down or type a value to set height • Enter to confirm"`

#### Controller (`AppController.js`)
- Add `'draw'` to the list of modes alongside `'object'` and `'face'`.
- Draw mode event handling:
  - `mousedown` → raycast against ground plane (y=0 XZ plane) → append point to `_sketchPoints`.
  - Double-click or Enter → close shape (connect last point to first), transition to extrude phase.
  - During extrude phase: `mousemove` → compute height from vertical mouse delta → call `buildExtrudedGeometry(shape, height)` → `meshView.setExtrudedShape(geometry)`.
  - Enter to confirm, Esc to cancel.

### Phased delivery
1. **Phase 1** — Sketch only: click to place points, close shape, display flat polygon.
2. **Phase 2** — Extrude: drag to set height from the flat polygon.
3. **Phase 3** — Integration: exported OBJ/GLTF should include the custom shape.

### Key risks
- **Self-intersecting polygons**: `THREE.ExtrudeGeometry` may produce artefacts. Add simple self-intersection detection and show an error if the polygon is invalid.
- **Coplanar / collinear points**: three consecutive collinear points degenerate the polygon. Filter them out before building the `THREE.Shape`.
- **UX clarity**: switching between sketch and extrude sub-phases needs clear visual feedback (status bar + cursor change).

---

## Implementation order (suggested)

| Priority | Item | Complexity | Dependencies |
|----------|------|-----------|--------------|
| 1 | Export (OBJ / GLTF) | Low | None |
| 2 | Mobile support | Medium | None |
| 3 | Multi-face extrude | Medium | None |
| 4 | Draw any 2D shape and extrude it | High | Export (for phase 3) |
