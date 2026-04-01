# Events Reference

A complete reference for all events in easy-extrude — domain events, DOM events,
and keyboard shortcuts — including their specifications.

> **When to update this document**
> - When adding or changing a domain event (`SceneService.emit(...)`)
> - When adding, changing, or removing a keyboard shortcut
> - When the pointer/touch event handling flow changes
> - When adding a new Undo/Redo command
> - When adding a click handler for a new UI button or widget

---

## Event Categories

| Category | Source | Delivery Path |
|----------|--------|---------------|
| [A] Domain events | `SceneService` | `EventEmitter.emit()` → listeners |
| [B] Pointer events | Browser Pointer Events API | `AppController._bind*()` |
| [C] Keyboard events | Browser KeyboardEvent | `AppController._onKeyDown/Up()` |
| [D] Touch-specific events | Browser + long-press timer | `AppController` (touch paths) |
| [E] UI events | DOM `click` / `change` | `UIView` / `OutlinerView` callbacks |

---

## [A] Domain Events (SceneService.emit)

`SceneService` extends `EventEmitter` and notifies subscribers (primarily
`AppController` and `OutlinerView`) of entity lifecycle changes.

### objectAdded

```
emit('objectAdded', entity)
```

| Item | Description |
|------|-------------|
| Payload | `entity: Solid | Profile | MeasureLine | CoordinateFrame | ImportedMesh` |
| Fired when | `createCuboid()`, `createProfile()`, `createImportedMesh()`, `createMeasureLine()`, `createCoordinateFrame()`, `duplicateCuboid()`, `extrudeSketch()` |
| Primary receivers | `OutlinerView.addObject()` — adds a row to the Outliner |
| Side effects | For CoordinateFrame, also updates parent object visibility logic |

### objectRemoved

```
emit('objectRemoved', id)
```

| Item | Description |
|------|-------------|
| Payload | `id: string` |
| Fired when | `deleteObject()`, `detachObject()` |
| Primary receivers | `OutlinerView.removeObject()` — removes a row from the Outliner |
| Note | In `_clearScene()`, `objectRemoved` must be emitted for each object BEFORE replacing `this._model` |

### objectRenamed

```
emit('objectRenamed', id, newName)
```

| Item | Description |
|------|-------------|
| Payload | `id: string`, `newName: string` |
| Fired when | `renameObject()` |
| Primary receivers | `OutlinerView.setObjectName()`, `AppController` (status update) |

### activeChanged

```
emit('activeChanged', id)
```

| Item | Description |
|------|-------------|
| Payload | `id: string | null` |
| Fired when | `setActiveObject()` |
| Primary receivers | `OutlinerView.setActive()` — updates Outliner highlight |

### geometryApplied

```
emit('geometryApplied', { objectId })
```

| Item | Description |
|------|-------------|
| Payload | `{ objectId: string }` |
| Fired when | After STEP geometry is received and applied via WebSocket |
| Primary receivers | `AppController` — camera fit (`fitCameraToSphere()`), hide progress indicator |

### geometryError

```
emit('geometryError', { objectId, message })
```

| Item | Description |
|------|-------------|
| Payload | `{ objectId: string, message: string }` |
| Fired when | In the `catch` block of `_applyGeometryUpdate()` |
| Primary receivers | `AppController` — shows error Toast |

### wsConnected / wsDisconnected

```
emit('wsConnected', {})
emit('wsDisconnected', {})
```

| Item | Description |
|------|-------------|
| Fired when | `WsChannel` WebSocket `open` / `close` events |
| Primary receivers | `AppController` — checks import state |

---

## [B] Pointer Events

Pointer events are managed uniformly via the Pointer Events API.
`pointerdown` is registered on `window`; `pointermove` / `pointerup` are captured on the canvas.

### Canvas Target Guard

```
pointerdown fires
  ↓
if (e.target !== renderer.domElement) return  ← required guard
```

Prevents `_handleEditClick()` from firing erroneously on toolbar or UI panel clicks.

### pointerdown

| Condition | Action |
|-----------|--------|
| `grab.active` + button=0 | `_confirmGrab()` → IDLE |
| `grab.active` + button=2 | `_cancelGrab()` → IDLE |
| `faceExtrude.active` + button=0 | Set `_activeDragPointerId` (confirmed on pointerup) |
| `faceExtrude.active` + button=2 | `_cancelFaceExtrude()` |
| `editSubstate === '2d-sketch'` | `_sketch.drawing = true`, disable orbit |
| `selectionMode === 'object'` + object hit | `_objDragging = true`, disable orbit |
| `selectionMode === 'object'` + miss | `_rectSel.active = true` (desktop only) |
| `editSubstate === '3d'` | Re-run hit test → `_handleEditClick()` |
| Second touch (during rectSel) | Cancel rectSel, delegate to OrbitControls |

### pointermove

| Condition | Action |
|-----------|--------|
| `_rectSel.active` | Update selection rectangle overlay |
| `_objDragging` | Move object (direct drag, not Grab) |
| `_sketch.drawing` | Update sketch rectangle p2 |
| `faceExtrude.active` | Calculate distance + `_applyFaceExtrude()` + update label |
| `grab.active` | `_applyGrab()` |
| hover (edit 3d, nothing active) | `_hitFace/Vertex/Edge()` → `setFaceHighlight()` |
| Long-press timer active (`_longPressTimer`) | Cancel timer if movement > 8px |

### pointerup

| Condition | Action |
|-----------|--------|
| `faceExtrude.active` + `wasDragging` | `_confirmFaceExtrude()` |
| `_sketch.drawing` + `wasDragging` | `_confirmSketchRect()` |
| `_rectSel.active` + `wasDragging` | `_finalizeRectSel()` |
| `_objDragging` | Reset flag |
| Always | `_activeDragPointerId = null` |

### wheel

| Condition | Action |
|-----------|--------|
| `Ctrl` + `grab.active` | Cycle grid size (0.1, 0.5, 1, 5) |
| `Ctrl` + `rotate.active` | Cycle rotation step size (1°, 5°, 10°, 45°) |
| Otherwise | Delegate to OrbitControls zoom |

### contextmenu

- `e.preventDefault()` suppresses the browser default menu
- When `grab.active`, acts as a trigger for `_cancelGrab()`

---

## [C] Keyboard Events

### Global (_onKeyDown)

| Key | Condition | Action |
|-----|-----------|--------|
| `Tab` | Not in grab.active / faceExtrude.active | Toggle mode (object ↔ edit) |
| `Escape` | During any operation | Cancel (grab, faceExtrude, rectSel, sketch, rotate, measure) |
| `Enter` | During any operation | Confirm (grab → `_confirmGrab()`, faceExtrude → `_confirmFaceExtrude()`, 2d-sketch → `_enterExtrudePhase()`) |
| `Ctrl+Z` | All modes | `_commandStack.undo()` |
| `Ctrl+Y` | All modes | `_commandStack.redo()` |
| `Ctrl+E` | Object Mode | Export scene JSON |
| `Ctrl+I` | Object Mode | Show scene JSON import modal |
| `Ctrl+S` | Object Mode | Save scene (BFF) |
| `Ctrl+O` | Object Mode | Load scene (BFF) |

### Object Mode

| Key | Action |
|-----|--------|
| `G` | `_startGrab()` |
| `R` | `_startRotate()` (CoordinateFrame selected only) |
| `M` | `_startMeasurePlacement()` |
| `Shift+A` | Show add menu |
| `Shift+D` | Duplicate selected object |
| `X` / `Delete` | Delete selected object |

### Edit Mode · 3D

| Key | Action |
|-----|--------|
| `1` | Sub-element mode: Vertex |
| `2` | Sub-element mode: Edge |
| `3` | Sub-element mode: Face |
| `E` | `_startFaceExtrude()` (face selected only) |
| `O` | Return to Object Mode |

### Grab Active

| Key | Action |
|-----|--------|
| `X` | Lock to X axis |
| `Y` | Lock to Y axis |
| `Z` | Lock to Z axis |
| `V` | Enable Pivot selection mode |
| `S` | Toggle Stack mode |
| `0`–`9` / `.` | Numeric input mode (requires axis lock) |

### Face Extrude Active

| Key | Action |
|-----|--------|
| `0`–`9` / `.` | Numeric input mode |
| `Ctrl` (hold) | Enable snap mode |

### Rotate Active (CoordinateFrame)

| Key | Action |
|-----|--------|
| `X` | Rotate around X axis |
| `Y` | Rotate around Y axis |
| `Z` | Rotate around Z axis |
| `0`–`9` / `.` | Numeric input mode (degrees) |

---

## [D] Touch-Specific Events

### Long Press

```
pointerdown (touch, Object Mode, object already selected)
  ↓
_longPressTimer = setTimeout(callback, 400ms) starts
  ↓
pointermove: movement > 8px → clearTimeout (cancelled)
  ↓
400ms reached → showContextMenu() shown
  Context menu items:
  - Grab (all entities)
  - Duplicate (Solid only)
  - Rename (all entities)
  - Delete (all entities)
```

### Grab Confirmation on Touch

```
Mobile Grab flow:
  Long press → context menu → tap "Grab" → grab.active = true
  (Canvas drag is used for orbit, so drag does not move the object during grab)
  → tap toolbar "✓ Confirm" button → _confirmGrab()
```

### Face Extrude on Touch

```
Edit 3D + face selected → touch tap auto-starts extrude
  (Desktop uses E key; touch starts by tapping a face without E key)
  ↓
Canvas drag → pointermove updates distance
  ↓
Lift finger (pointerup, wasDragging=true) → _confirmFaceExtrude()
```

---

## [E] UI Events (click / change)

### Header

| Element | Event | Action |
|---------|-------|--------|
| Mode selector button | `click` | Toggle dropdown |
| Mode dropdown item | `click` | `setMode(value)` |
| Undo button (↶) | `click` | `_commandStack.undo()` |
| Redo button (↷) | `click` | `_commandStack.redo()` |
| Export button | `click` | `SceneExporter.export()` + download |
| Import button | `click` | Show import modal |
| Save button | `click` | `SceneService.saveScene()` (BFF REST) |
| Load button | `click` | `SceneService.loadScene()` (BFF REST) |
| ⋯ menu (mobile) | `click` | Show dropdown with Export / Import |
| N button (mobile) | `click` | Toggle N Panel drawer |
| ≡ hamburger (mobile) | `click` | Toggle Outliner drawer |

### Outliner

| Element | Event | Action |
|---------|-------|--------|
| Object row | `click` | `_switchActiveObject(id)` |
| Visibility toggle (○) | `click` | `setVisible(id, toggle)` |
| Delete button (✕) | `click` | `_deleteObject(id)` |
| Object name | `dblclick` | Inline rename input or dialog |

### Mobile Toolbar

| State | Button | Event | Action |
|-------|--------|-------|--------|
| grab.active | ✓ Confirm | `click` | `_confirmGrab()` |
| grab.active | Stack | `click` | Toggle Stack mode |
| grab.active | ✕ Cancel | `click` | `_cancelGrab()` |
| faceExtrude.active | ✓ Confirm | `click` | `_confirmFaceExtrude()` |
| faceExtrude.active | ✕ Cancel | `click` | `_cancelFaceExtrude()` |
| Object Mode | + Add | `click` | Show add menu |
| Object Mode | Edit | `click` | `setMode('edit')` |
| Object Mode | Delete | `click` | `_deleteObject(activeId)` |
| Object Mode (Frame) | Rotate | `click` | `_startRotate()` |
| Object Mode (Frame) | Add Frame | `click` | `createCoordinateFrame()` |
| Edit 2D-Sketch | ← Object | `click` | `setMode('object')` |
| Edit 2D-Sketch | Extrude | `click` | `_enterExtrudePhase()` |
| Edit 2D-Extrude | ✓ Confirm | `click` | `_confirmExtrude()` |
| Edit 2D-Extrude | ✕ Cancel | `click` | `_cancelExtrude()` |
| Edit 3D | ← Object | `click` | `setMode('object')` |
| Edit 3D | Vertex/Edge/Face | `click` | Switch sub-element mode |
| Edit 3D | Extrude | `click` | `_startFaceExtrude()` |

> Toolbar buttons are handled on `click`, not `pointerdown`.
> The canvas target guard causes `pointerdown` to ignore anything other than the canvas.

### Gizmo

| Element | Event | Action |
|---------|-------|--------|
| X axis | `click` | Snap camera to +X direction (front view) |
| Y axis | `click` | Snap camera to +Y direction (left side view) |
| Z axis | `click` | Snap camera to +Z direction (top view) |

---

## Event Processing Priority

When multiple events fire simultaneously:

```
1. Canvas target guard (pointerdown)
   → Return immediately for UI element clicks

2. Active operation handlers (high priority)
   grab.active → grab handler
   faceExtrude.active → faceExtrude handler

3. Current mode handlers
   'object' → object select / drag / rectSel
   'edit' (2d-sketch) → sketch drawing
   'edit' (3d) → sub-element selection

4. OrbitControls (fallthrough)
   Unconsumed pointer events → camera operation
```

---

## Undo/Redo Commands and Corresponding Events

Commands are recorded post-hoc via `push()` — never use `execute()` for pre-execution.

| Command | Recorded When | Undo Operation |
|---------|---------------|----------------|
| `MoveCommand` | Inside `_confirmGrab()` | Restore corner coordinates to startCorners |
| `AddSolidCommand` | After `_addObject()` confirmed | Delete the object |
| `DeleteCommand` | After `_deleteObject()` confirmed | `attachObject()` + `setVisible(true)` |
| `ExtrudeSketchCommand` | After `_confirmExtrude()` confirmed | Delete Solid, restore Profile |
| `RenameCommand` | After `_confirmRename()` confirmed | Restore previous name |
| `FrameRotateCommand` | After `_confirmRotate()` confirmed | Restore startQuat |

---

## Related Documents

- `docs/STATE_TRANSITIONS.md` — state transition details for each operation
- `docs/SCREEN_DESIGN.md` — per-screen information architecture
- `docs/adr/ADR-013-domain-events-scene-service-observable.md` — domain events ADR
- `docs/adr/ADR-022-undo-redo-command-pattern.md` — Undo/Redo command pattern ADR
- `docs/adr/ADR-023-mobile-input-model.md` — mobile input model ADR
- `.claude/mental_model/2_interaction.md` — interaction coding rules
