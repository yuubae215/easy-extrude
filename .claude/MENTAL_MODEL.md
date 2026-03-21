# Mental Model — easy-extrude

Accumulated rules and policies learned from bugs and design decisions.
Claude must follow these when modifying code in this repository.

---

## Maintenance guidelines

### What belongs here

- Rules learned from **real bugs** (not hypothetical ones)
- Policies where violating them causes **hard-to-find state inconsistencies**
- Ownership contracts between classes/modules that aren't obvious from the code
- Decisions that were **consciously chosen** over a simpler alternative

Do NOT add: general best practices, things already obvious from the code,
or temporary notes about in-progress work (use a task/plan for those).

### When to update

| Trigger | Action |
|---------|--------|
| A bug was caused by violating an implicit rule | Add the rule here |
| A new ADR establishes a coding contract | Summarize the contract here, link the ADR |
| An existing rule turns out to be wrong or too narrow | Update or remove it |
| A rule is already enforced by the code itself (e.g. type system) | Remove it — code is the source of truth |

### How to update

1. Add/edit the relevant section below
2. Commit together with the code change that motivated it
3. If the rule is substantial, create an ADR first and link it here

---

## Mode transition policy (ADR-008)

`AppController.setMode(mode)` is the **single entry point** for all mode transitions.

Before calling `_switchActiveObject()`, always call `setMode('object')` first if `_selectionMode === 'edit'`.
This ensures the current active object's visual state is cleaned up before the switch.

```js
// Correct pattern when switching active objects from any mode
if (this._selectionMode === 'edit') this.setMode('object')
// ... then _switchActiveObject(newId, true)
```

Applies to: any function that adds objects, deletes the active object, or switches the active object.

`setMode()` guarantees, in order:
1. Cancel in-progress operations (grab, face drag, object drag)
2. Clear active object visual state (`setFaceHighlight(null)`, `clearExtrusionDisplay()`, `clearSketchRect()`)
3. Reset controller state (`_hoveredFace`, `_faceDragging`, `_dragFace`, `_cleanupEditSubstate()`)
4. Dispatch to new mode — `instanceof Sketch` → Edit 2D, otherwise → Edit 3D

## Entity type contract (ADR-012, Phase 5-3)

**Rule**: entity *type* (not a `dimension` field) determines which operations are available.
`instanceof Sketch` = 2D unextruded. `instanceof Cuboid` = 3D.

`Sketch.extrude(height)` does **not** mutate the Sketch. It returns a new `Cuboid` reusing
the same `id`, `name`, and `meshView`. `SceneService.extrudeSketch(id, height)` performs the
swap in SceneModel; after the swap `scene.activeObject` returns the Cuboid automatically.

`extrudeFace` signature: `(face: Face, savedFaceCorners, normal, dist)` — callers pass a
`Face` object (`_dragFace`), not an index. Face.index is used where an index is still needed
(e.g. `MeshView.setFaceHighlight`).

`Cuboid` must always have: `move()`, `extrudeFace(face, ...)`, `faces: Face[6]`, `edges: Edge[12]`.
`Sketch` only needs: `extrude(height)`, `rename(name)`, `sketchRect`.

## MeshView visual state ownership

Each `visible` flag in `MeshView` has a single owner. Never set it elsewhere.

| Element | Owner |
|---------|-------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

## Touch hover sync before edit click

`_hoveredFace`, `_hoveredVertex`, `_hoveredEdge` are updated only in `_onPointerMove`.
On touch devices `pointermove` does **not** fire before `pointerdown`, so these are null
when the user taps. `_onPointerDown` must re-run the hit test before calling
`_handleEditClick`, or touch taps will never select sub-elements.

```js
// Required pattern at the bottom of _onPointerDown (edit mode path)
if (this._scene.editSubstate === '3d') {
  if (this._editSelectMode === 'face') {
    const hit = this._hitFace()
    this._hoveredFace = hit?.face ?? null
    this._meshView.setFaceHighlight(this._hoveredFace?.index ?? null, this._corners)
  } // likewise for vertex / edge
}
this._handleEditClick(e.shiftKey)
```

## Face extrude confirm on pointerup, not pointerdown

`_confirmFaceExtrude()` is called in `_onPointerUp`, **not** `_onPointerDown`.

Reason: on mobile, the first canvas touch after `_startFaceExtrude()` is the *start* of a
drag intended to set the distance. Confirming on `pointerdown` would lock in dist=0 before
any movement. The correct flow is: pointerdown → set `_activeDragPointerId` →
`_onPointerMove` updates dist → `_onPointerUp` confirms.

On desktop this feels identical to the old click-to-confirm UX (confirm fires on release).

Do **not** move confirm back to `_onPointerDown`.

## OrbitControls must stay enabled during rect selection

`_controls.enabled = false` must **not** be set when starting rect selection.

Reason: orbit (right-click drag on desktop, two-finger on mobile) uses separate input that
does not conflict with rect selection (left-click / single-finger). Disabling controls
blocks orbit even though the inputs are mutually exclusive.

Only `_objDragging` and `_sketch.drawing` legitimately need `_controls.enabled = false`
(they capture the left/single-finger input fully and must prevent orbit from also reacting).

When a second touch arrives while rect selection is active, cancel the rect selection and
clear `_activeDragPointerId` so OrbitControls can take over the two-finger gesture.

## Canvas target guard in _onPointerDown

`_onPointerDown` is registered on `window` to support drag-outside-canvas. This means it
also fires for taps on toolbar buttons, overlay menus, and other UI elements.

Without a canvas guard, tapping a toolbar button fires `_handleEditClick` (which clears
face/vertex/edge selection) **before** the button's `click` handler fires — because
`pointerdown` precedes `click`. The classic failure: tapping the mobile Extrude button
clears the face selection, so the `click` handler finds nothing to extrude.

**Rule**: add a canvas target check immediately after the secondary-touch guard:

```js
if (e.target !== this._sceneView.renderer.domElement) return
```

This guard goes **before** the grab/faceExtrude active checks so that toolbar buttons
always fall through to their own `click` listeners instead.

## Face extrude confirm requires a canvas drag (wasDragging)

`_onPointerUp` on `window` fires for toolbar button taps too. Without a guard,
tapping the mobile Confirm button produces both a `pointerup` (which calls
`_confirmFaceExtrude` via `_onPointerUp`) **and** a `click` (which calls it again via
`onClick`), causing a double-confirm.

**Rule**: only confirm face extrude in `_onPointerUp` when `_activeDragPointerId` was
set for that pointer (i.e. a canvas drag was started in `_onPointerDown`):

```js
const wasDragging = this._activeDragPointerId === e.pointerId
if (wasDragging) this._activeDragPointerId = null
if (this._faceExtrude.active && wasDragging) { this._confirmFaceExtrude(); return }
```

## Mobile toolbar must have a fixed button count per mode

If buttons appear or disappear based on sub-state (e.g. Extrude only when face selected),
the entire centered toolbar shifts left/right, making tapping unreliable.

**Rule**: every mode shows a **fixed set** of buttons. Unavailable actions use
`disabled: true` (grayed out, no click handler) instead of being hidden.

| Mode         | Buttons (always shown)                              |
|--------------|-----------------------------------------------------|
| Object       | Add · Edit · Delete                                 |
| Edit 2D      | ← Object · Extrude                                  |
| Edit 3D      | ← Object · Vertex · Edge · Face · Extrude           |
| Grab active  | ✓ Confirm · ✕ Cancel                               |
| Face extrude | ✓ Confirm · ✕ Cancel                               |

## MeshView.dispose() must mirror the constructor exactly

Every `scene.add(object)` call in the `MeshView` constructor MUST have a matching
`scene.remove(object)` in `dispose()`, and every `new THREE.BufferGeometry()` stored on
`this` must have a matching `geometry.dispose()`.

Root cause of the ghost-object bug: the pivot/snap system was refactored from two
properties (`_pivotPoints`, `_hoveredPivotPoints`) to per-type objects (`_pivotVertPoints`,
`_pivotEdgePoints`, etc.), but `dispose()` still referenced the old names. Because
`undefined.dispose()` throws, `SceneService.deleteObject()` aborted before calling
`removeObject()` and `emit('objectRemoved')` — leaving the object in the model (outliner
intact, snap candidates still active) while only the main mesh was visually removed.

**Rule**: whenever you add a new Three.js object to the scene in the constructor, immediately
add the corresponding `scene.remove()` and `.dispose()` calls to `dispose()` in the same commit.
