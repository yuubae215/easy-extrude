# Mental Model — easy-extrude

Accumulated rules and policies learned from bugs and design decisions.
Claude must follow these when modifying code in this repository.

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
3. Reset controller state (`_hoveredFace`, `_faceDragging`, `_dragFaceIdx`, `_cleanupEditSubstate()`)
4. Dispatch to new mode

## MeshView visual state ownership

Each `visible` flag in `MeshView` has a single owner. Never set it elsewhere.

| Element | Owner |
|---------|-------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |
