# ADR-008: Mode Transition State Machine — Logical Consistency Policy

**Date:** 2026-03-20
**Status:** Accepted

---

## Context

`AppController` holds a mode (`_selectionMode`: `'object'` | `'edit'`) and
an Edit substate (`_editSubstate`: `null` | `'3d'` | `'2d-sketch'` | `'2d-extrude'`).

In the initial implementation several code paths triggered mode transitions without going through `setMode()`,
causing inconsistencies such as:

- Calling `_addObject('box')` while in Edit Mode without calling `setMode` left `_editSubstate`, `_hoveredFace`, etc. still referencing the previous object
- Calling `_deleteObject` from the Outliner while in Edit Mode caused `setMode('object')` to be called after `meshView.dispose()`, attempting to use an already-disposed meshView
- `setMode('edit')` did not clear visual state (`setFaceHighlight`, `clearExtrusionDisplay`, etc.)
- `setMode()` did not cancel in-progress face drag or object drag operations when interrupted
- `MeshView.setFaceHighlight()` did not manage `hlMesh.visible`, so `hlMesh` hidden by `setVisible(false)` was never shown again

## Decision

### 1. Make `setMode()` the sole state transition entry point

`setMode(mode)` is implemented as a function that "transitions to a new mode in a clean state, regardless of the current mode".

Execution order:

```
1. Cancel in-progress operations
   - Grab active → _cancelGrab()
   - Face drag active → _faceDragging = false, clearExtrusionDisplay()
   - Object drag active → _objDragging = false

2. Clear active object visual state
   - setFaceHighlight(null, corners)
   - clearExtrusionDisplay()
   - clearSketchRect()
   - UIView.clearExtrusionLabel()

3. Reset controller state
   - _hoveredFace = null
   - _faceDragging = false
   - _dragFaceIdx = null
   - _cleanupEditSubstate() → clear sketch/extrude state

4. Transition to the new mode
   - 'object': UI update only
   - 'edit': _setObjectSelected(false), then dispatch to substate based on dimension
```

### 2. Always go through `setMode` before switching the active object

Operations that add, delete, or switch objects can occur while in Edit Mode.
In such cases, call `setMode('object')` **before** calling `_switchActiveObject` to
clean up the current active object's visual state.

```
// Correct order (setMode before dispose)
if (selectionMode === 'edit') setMode('object')   // ← cleanup while meshView is alive
meshView.dispose()                                  // ← dispose afterwards
```

Applies to:

| Function | Condition |
|----------|-----------|
| `_addObject('box')` | While in Edit Mode |
| `_addSketchObject()` | While in Edit Mode (currently unreachable, but defensive) |
| `_deleteObject(id)` | While in Edit Mode AND `id === _activeId` |

### 3. `MeshView.setFaceHighlight()` fully owns `hlMesh.visible`

```javascript
setFaceHighlight(fi, corners) {
  this.hlMesh.visible = (fi !== null)  // ← setFaceHighlight controls visible
  if (fi === null) { /* clear geometry */ return }
  /* update geometry */
}
```

Visibility is always determined by `setFaceHighlight`, independent of the `setVisible(false/true)` history.

## Consequences

- **Fewer bugs**: The active object can never change without going through a mode transition,
  so previous object visual state (face highlight etc.) no longer persists
- **Safe Outliner operations**: The Delete button always works safely, even in Edit Mode
- `setMode` idempotency: Transitioning to the same mode (e.g. Edit → Edit) also acts as a cleanup,
  providing a reset mechanism when substate becomes corrupted
- **Safety net for future features**: When adding a new object-switching code path,
  simply follow the rule of calling `setMode('object')` first

## References

- ADR-002 (Sketch→Extrude workflow)
- ADR-004 (Edit Mode dimension dispatch)
- ADR-005 (Object hierarchy and dimension)
