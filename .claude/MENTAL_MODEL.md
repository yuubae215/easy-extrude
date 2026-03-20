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
