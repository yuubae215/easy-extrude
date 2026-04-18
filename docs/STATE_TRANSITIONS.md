# State Transitions

Records the mode state transitions of easy-extrude.
See ADR-008 for implementation details.

---

## Top-level Modes

```
                    Tab
  ┌─────────────────────────────────────────────────┐
  |                                                 |
  v                                                 |
OBJECT MODE  ──────────────────────────────> EDIT MODE
  |     |                                           |
  |     | Map button / _enterMapMode()              | (dispatches on active object dimension)
  |     v                                           |
  |  MAP MODE  (orthographic top-down camera)       |
  |     |                                           |
  |     | Escape (no tool) / Exit Map button        |
  |     | _exitMapMode() → OBJECT MODE              |
  |                                                 |
  | Shift+A → Add Box                               |
  |   → _addObject('box') → OBJECT MODE             |
  |                                                 |
  | Shift+A → Add Sketch                            |
  |   → _addSketchObject() → EDIT MODE · 2D         |
  |                                                 |
  | X / Delete (selected)                           |
  |   → _deleteObject() → OBJECT MODE               |
  └─────────────────────────────────────────────────┘
```

### Map Mode (2D Spatial Annotation — ADR-031)

`_mapMode.active = true` — orthographic top-down camera; OrbitControls disabled.
`_mapMode.tool` — the place type currently being drawn (`"Route"` / `"Boundary"` /
`"Zone"` / `"Hub"` / `"Anchor"`), or `null` (pan-only).
`_mapMode.drawState` — three-state inner FSM: `"idle"` / `"drawing"` / `"pending"`.

```
OBJECT MODE
    |
    Map button header click → _enterMapMode()
    |
    v
MAP MODE  (_mapMode.active = true, drawState = "idle")
    |
    ├─ No tool active  (drawState = "idle", _mapMode.tool = null)
    │    Left-drag / middle-drag → pan camera (XY)
    │    Scroll wheel            → zoom (frustumSize ±15%)
    │    ESC → _exitMapMode() → OBJECT MODE
    │
    ├─ Click place type in left toolbar → _setMapTool(type)
    │       drawState stays "idle" until the first input gesture
    │
    │   ┌─ PC platform ─────────────────────────────────────────────────────┐
    │   │                                                                    │
    │   │  Route / Boundary (multi-click polyline)                          │
    │   │    first click → drawState = "drawing", points[0] set             │
    │   │    subsequent clicks → append vertex                              │
    │   │    endpoint snap ring (_updateSnapRing, 20 px) near first vertex  │
    │   │    Enter / RMB (≥2 pts) OR snap-close → drawState = "pending"    │
    │   │                                                                    │
    │   │  Zone (drag-rectangle region)                                     │
    │   │    pointerdown → drawState = "drawing"                            │
    │   │    pointerup   → drawState = "pending"                            │
    │   │                                                                    │
    │   │  Hub / Anchor (single click point)                                │
    │   │    click → drawState = "pending"                                  │
    │   │                                                                    │
    │   └────────────────────────────────────────────────────────────────────┘
    │
    │   ┌─ Mobile platform ─────────────────────────────────────────────────┐
    │   │                                                                    │
    │   │  All types: single drag gesture                                   │
    │   │    pointerdown → drawState = "drawing"                            │
    │   │    pointermove → update preview (cursor set here — no prior hover)│
    │   │    pointerup   → drawState = "pending"                            │
    │   │                                                                    │
    │   └────────────────────────────────────────────────────────────────────┘
    │
    │       drawState = "drawing"
    │           preview line/shape updates with pointer movement
    │           ESC → drawState = "idle" (discard)
    │
    │       drawState = "pending"
    │           showMapToolbar() name input displayed (pre-filled per-type counter)
    │           Enter / confirm button → _mapConfirmDrawing()
    │               → create entity (AnnotatedLine / AnnotatedRegion / AnnotatedPoint)
    │               → drawState = "idle"  (tool stays active for next shape)
    │           ESC → drawState = "idle" (discard)
    │
    └─ Exit Map button / ESC (drawState="idle", no tool) → _exitMapMode() → OBJECT MODE
```

---

## Edit Mode Substates

State machine held in `SceneModel.editSubstate`.
The initial substate when entering EDIT MODE is determined by the active object's runtime type
(`instanceof Solid` → 3D, `instanceof Profile` → 2D, `instanceof MeasureLine` → 1D).
There is no `dimension` field (removed in ADR-012).

```
Enter EDIT MODE
    |
    v
instanceof Solid ?───> EDIT · 3D ('3d')
    |                       |
    | No                    | Tab / O key / setMode('object')
    |                       v
instanceof Profile ?──> OBJECT MODE
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

instanceof MeasureLine ?──> EDIT · 1D ('1d')
                                |
                                | Tab / Esc / setMode('object')
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
| `'1d'` | Endpoint drag on a MeasureLine | `_enterEditMode1D()` |

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
         mode === 'edit'   → dispatch on active object runtime type (instanceof)
                             instanceof MeasureLine → _enterEditMode1D()
                             instanceof Profile     → _enterEditMode2D()
                             instanceof Solid       → _enterEditMode3D()
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
mapMode.active              [← Exit Map]  (left-side map toolbar handles drawing)
──────────────────────────────────────────────────────────────────────────
Object Mode                 [+ Add]  [Edit*]  [Delete*]
  * disabled if no selection
──────────────────────────────────────────────────────────────────────────
Edit · 1D (MeasureLine)     [← Object]
──────────────────────────────────────────────────────────────────────
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
- **ADR-004**: Edit Mode auto-dispatches on active object `instanceof` (dimension field removed in ADR-012)
- **ADR-008**: `setMode()` is the sole mode transition entry point
- **ADR-023**: Mobile input model — Pointer Events API, `_activeDragPointerId`, OrbitControls disable strategy
- **ADR-024**: Mobile toolbar architecture — fixed slot counts, `disabled` vs hidden, `{spacer: true}`
- **ADR-029**: Spatial annotation system — `AnnotatedLine/Region/Point`, `PlaceTypeRegistry`
- **ADR-030**: SpatialLink — typed semantic edges; `L` key two-phase creation flow
- **ADR-031**: Map Mode interaction model — three-state `drawState`, PC vs Mobile platform split, naming-before-confirm
