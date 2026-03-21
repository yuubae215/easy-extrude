# State Transitions

Records the mode state transitions of easy-extrude.
See ADR-008 for implementation details.

---

## Top-level Modes

A two-state machine held in `SceneModel.selectionMode`.

```
                    Tab
  ┌─────────────────────────────────────────────────┐
  |                                                 |
  v                                                 |
OBJECT MODE  ──────────────────────────────> EDIT MODE
  |                                                 |
  | Shift+A → Add Box                               | (dispatches on active object dimension)
  |   → _addObject('box') → OBJECT MODE             |
  |                                                 |
  | Shift+A → Add Sketch                            |
  |   → _addSketchObject() → EDIT MODE · 2D         |
  |                                                 |
  | X / Delete (selected)                           |
  |   → _deleteObject() → OBJECT MODE               |
  └─────────────────────────────────────────────────┘
```

---

## Edit Mode Substates

State machine held in `SceneModel.editSubstate`.
The initial substate when entering EDIT MODE is determined by `activeObject.dimension`.

```
Enter EDIT MODE
    |
    v
dimension == 3 ?─────> EDIT · 3D ('3d')
    |                       |
    | No                    | Tab / O key / setMode('object')
    |                       v
dimension == 2 ?─────> OBJECT MODE
    |
    v
EDIT · 2D-SKETCH ('2d-sketch')
    |
    | Rectangle drag complete → sketchRect saved
    | Enter (area > 0.01)
    v
EDIT · 2D-EXTRUDE ('2d-extrude')
    |                |
    | Enter          | Escape
    | (height > 0)   |
    v                v
EDIT · 3D      EDIT · 2D-SKETCH (back)
    |
    | Tab / O key
    v
OBJECT MODE
```

### Substate Details

| substate | Meaning | Transition trigger |
|---------|---------|--------------------|
| `null` | Outside Edit Mode (Object Mode) | After `setMode('object')` call |
| `'2d-sketch'` | Drawing a rectangle on the ground plane | `_enterEditMode2D()` |
| `'2d-extrude'` | Extruding sketch in the height direction | `_enterExtrudePhase()` (Enter key) |
| `'3d'` | Face selection and extrusion on a 3D cuboid | `_enterEditMode3D()` |

---

## setMode() Execution Order (ADR-008 contract)

```
setMode(mode) called
    |
    1. Cancel in-progress operations
    |    - grab.active → _cancelGrab()
    |    - faceDragging → clearExtrusionDisplay()
    |    - objDragging → reset flags
    |
    2. Clear active object visual state
    |    - setFaceHighlight(null)
    |    - clearExtrusionDisplay()
    |    - clearSketchRect()
    |    - uiView.clearExtrusionLabel()
    |
    3. Reset controller internal state
    |    - _hoveredFace = null
    |    - _cleanupEditSubstate() → SceneModel.setEditSubstate(null)
    |
    4. SceneModel.setSelectionMode(mode)
    |
    5. Dispatch to new mode
         mode === 'object' → UI update only
         mode === 'edit'   → dispatch on dimension
                             2 → _enterEditMode2D()
                             3 → _enterEditMode3D()
```

**Important**: Always call `setMode('object')` before switching the active object.
Calling `_switchActiveObject()` while in Edit Mode leaves the previous object's visual state dirty.

---

## State Transitions on Object Add / Delete

```
_addObject(type) / _addSketchObject()
    |
    if selectionMode === 'edit'
        → setMode('object')  ← required: clean up Edit Mode
    |
    → SceneModel.addObject(obj)
    → _switchActiveObject(id, true)
    |
    only when type === 'sketch'
        → setMode('edit')  ← enter Edit Mode · 2D immediately

_deleteObject(id)
    |
    if id === activeId && selectionMode === 'edit'
        → setMode('object')  ← required: clear visual state before dispose
    |
    → meshView.dispose()
    → SceneModel.removeObject(id)
    → _switchActiveObject() (to another object)
```

---

## Grab State Machine

Blender-style grab operation started with G key in Object Mode.

```
OBJECT MODE (selected)
    |
    G key → _startGrab()
    |
    v
GRAB ACTIVE (grab.active = true)
    |
    |── mouse move → _applyGrab()
    |── X/Y/Z key → _setGrabAxis(axis)  (axis lock)
    |── V key → PIVOT SELECT MODE (grab.pivotSelectMode = true)
    |       |── mouse move → _updatePivotHover()
    |       |── left click → _confirmPivotSelect() → GRAB ACTIVE
    |       └── Escape    → _cancelPivotSelect()  → GRAB ACTIVE
    |── 0-9/. key (while axis locked) → numeric input → _applyGrabFromInput()
    |── Ctrl held → _trySnapToOrigin() (origin snap)
    |── Enter / left click → _confirmGrab() → OBJECT MODE
    └── Escape / right click → _cancelGrab() → restore corner positions → OBJECT MODE
```

---

## Face Extrude State Machine

Face extrusion operation in Edit Mode · 3D.

```
EDIT MODE · 3D (face mode)
    |
    mouse move → _hitFace() → setFaceHighlight(fi)
    |
    left click → _handleEditClick() → add Face to editSelection
    |
    E key (at least one face selected) → _startFaceExtrude(face)
    |
    v
FACE EXTRUDE ACTIVE (faceExtrude.active = true)
    |
    |── mouse move → compute distance + _applyFaceExtrude() + setExtrusionLabel()
    |── Ctrl held → _trySnapFaceExtrude() for geometry snap
    |── numeric keys → _applyFaceExtrudeFromInput() (numeric input mode)
    |── Enter / left click → _confirmFaceExtrude() → EDIT MODE · 3D
    └── Escape / right click → _cancelFaceExtrude() → restore corners → EDIT MODE · 3D
```

---

## Mobile Input State Machine

Touch and mouse input are unified via the **Pointer Events API** (`pointerdown` / `pointermove` / `pointerup`).
`_activeDragPointerId` tracks which pointer owns the current edit drag.

### Primary pointer (first finger / mouse)

```
IDLE (_activeDragPointerId = null)
    |
    pointerdown (canvas target) ─────────────────────────────────────────────┐
    |                                                                         |
    ├─ grab.active ──────────────────────────────────────────────────────────>│
    │   button=0 → _confirmGrab()           (IDLE)                           |
    │   button=2 → _cancelGrab()            (IDLE)                           |
    │                                                                         |
    ├─ faceExtrude.active ───────────────────────────────────────────────────>│
    │   button=0 → set _activeDragPointerId ← do NOT confirm yet             |
    │              (wait for pointermove to set distance, confirm on up)      |
    │   button=2 → _cancelFaceExtrude()     (IDLE)                           |
    │                                                                         |
    ├─ editSubstate === '2d-sketch' ─────────────────────────────────────────>│
    │   ray hits ground plane → _sketch.drawing=true                          |
    │   _controls.enabled = false   ← orbit must not interfere with draw      |
    │   set _activeDragPointerId                                               |
    │                                                                         |
    ├─ selectionMode === 'object' ───────────────────────────────────────────>│
    │   hit object → _objDragging=true                                        |
    │                _controls.enabled = false                                |
    │                set _activeDragPointerId                                  |
    │   no hit     → _rectSel.active=true                                    |
    │                set _activeDragPointerId                                  |
    │                (_controls stays ENABLED — orbit must remain usable)     |
    │                                                                         |
    └─ editSubstate === '3d' ────────────────────────────────────────────────>│
        re-run hit test (touch has no prior pointermove)                      |
        → _hoveredFace / _hoveredVertex / _hoveredEdge refreshed              |
        → _handleEditClick()                                                  |
                                                                              ▼
                                              DRAG (_activeDragPointerId set)
                                                  |
                                                  | pointermove (same pointerId)
                                                  |── rectSel: update overlay rect
                                                  |── objDragging: move object(s)
                                                  |── sketch.drawing: update rect p2
                                                  |── faceExtrude: update distance
                                                  |── grab: apply grab
                                                  |
                                                  | pointerup (same pointerId)
                                                  │   wasDragging = true
                                                  │   _activeDragPointerId = null
                                                  │──  faceExtrude → _confirmFaceExtrude()
                                                  │──  sketch.drawing → _confirmSketchRect()
                                                  │──  rectSel → _finalizeRectSel()
                                                  │──  objDragging → reset flags
                                                  v
                                              IDLE
```

### Secondary touch (second finger)

```
DRAG (_activeDragPointerId set) + second touch arrives
    |
    pointerdown (e.pointerType === 'touch', different pointerId)
    |
    ├─ _rectSel.active
    │   → cancel rect selection
    │   → _activeDragPointerId = null   ← release ownership
    │   → return                        ← OrbitControls takes two-finger gesture
    │
    └─ any other drag state
        → return (secondary touch ignored; primary drag continues)
```

### Canvas target guard

`pointerdown` is registered on `window` (to support drag-outside-canvas).
This means it fires for toolbar button taps, overlay menus, etc.

```
pointerdown fired
    |
    if e.target !== canvas → return immediately
    (toolbar click listeners handle these via the 'click' event instead)
```

Without this guard, a toolbar tap fires `_handleEditClick` (clears face/vertex/edge
selection) **before** the button's own `click` handler fires — because `pointerdown`
precedes `click`. The classic failure: tapping "Extrude" clears the face selection.

### Face extrude confirm flow (touch vs. desktop)

```
Desktop:
  left-click (pointerdown+pointerup without move) → confirm immediately on pointerup

Touch:
  tap "Extrude" button → _startFaceExtrude()
      |
      Touch canvas to start drag → _activeDragPointerId set (pointerdown)
      |
      Drag finger → pointermove updates distance
      |
      Lift finger → pointerup: wasDragging=true → _confirmFaceExtrude()

  tap "Confirm" toolbar button → fires both pointerup AND click
      pointerup: wasDragging=false (no canvas drag started) → skip confirm
      click:     → _confirmFaceExtrude()   ← only this path fires
```

The `wasDragging` guard prevents double-confirm when the toolbar button is tapped.

---

## Mobile Toolbar State Machine

On narrow screens (`window.innerWidth < 768`), a floating toolbar replaces keyboard shortcuts.
The toolbar shows a **fixed set of buttons per state** — buttons are disabled (not hidden)
to prevent layout shifts.

```
App state                   Toolbar buttons (→ always the same count)
──────────────────────────────────────────────────────────────────────────
grab.active                 [✓ Confirm]  [✕ Cancel]
faceExtrude.active          [✓ Confirm]  [✕ Cancel]
──────────────────────────────────────────────────────────────────────────
Object Mode                 [+ Add]  [Edit*]  [Delete*]
  * disabled if no selection
──────────────────────────────────────────────────────────────────────────
Edit · 2D-Sketch            [← Object]  [Extrude*]
  * disabled until rect area > 0.01
──────────────────────────────────────────────────────────────────────────
Edit · 2D-Extrude           [✓ Confirm]  [✕ Cancel]
──────────────────────────────────────────────────────────────────────────
Edit · 3D                   [← Object]  [Vertex]  [Edge]  [Face]  [Extrude*]
  * disabled until a Face is in editSelection; active sub-mode highlighted
──────────────────────────────────────────────────────────────────────────
```

Toolbar button taps use `click` events, not pointer events, so they are
unaffected by the canvas target guard above.

---

## Related ADRs

- **ADR-002**: Two-step Sketch → Extrude workflow
- **ADR-004**: Edit Mode auto-dispatches to 2D / 3D based on object.dimension
- **ADR-008**: `setMode()` is the sole mode transition entry point
