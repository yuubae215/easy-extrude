# ADR-023: Mobile Input Model — Touch Gesture Model and Device Detection

**Status**: Accepted
**Date**: 2026-03-29
**Related**: ADR-003 (Orbit Control), ADR-006 (Right-click Cancel), ADR-014 (Sub-element Selection)

---

## Context

Three.js's OrbitControls and the application's own pointer event handlers both compete
for touch events on mobile. Early implementations tried to intercept single-finger drags
for object movement (`_objDragging`) and rect selection, which made camera navigation
unreliable and forced multi-step flows for basic panning.

Additionally, mobile device detection via `window.innerWidth < 768` was found to be
unreliable: iPads in portrait mode report exactly 768, and large phones in landscape can
exceed 768, leaving OrbitControls erroneously active.

Several interaction confirmation patterns also differ between desktop and mobile:
- Face extrude is driven purely by gesture on mobile (no toolbar button).
- Grab can span multiple drag segments before confirming.
- Measure point placement requires visual snap feedback before committing.

---

## Decision

### 1. Primary navigation gesture: single-finger drag = orbit

On touch (`e.pointerType === 'touch'`), single-finger drag is **unconditionally reserved
for OrbitControls**. AppController returns early for all touch events in Object mode so
that OrbitControls receives full single-finger input.

```
OrbitControls config:
  touches.ONE = THREE.TOUCH.ROTATE
  touches.TWO = THREE.TOUCH.DOLLY_PAN
```

Rect selection and `_objDragging` are **mouse-only paths** and must not activate on touch.

### 2. Object interaction: tap + long-press model

| Gesture | Condition | Effect |
|---------|-----------|--------|
| Quick tap | Hits any object | Selection |
| Quick tap | Hits empty space | Deselect |
| Long press (≥ 400 ms, < 8 px movement) | On a **selected** object | Context menu popup |
| Long press | On empty space | No-op (orbit took over) |

The long-press timer is stored as `_longPress.{ timer, pointerId, startX, startY }`.
It is cancelled if `_onPointerMove` detects movement > 8 px, or on `_onPointerUp` before
the timeout fires.

`_showLongPressContextMenu(x, y, obj)` calls `UIView.showContextMenu(x, y, items)` with
context-sensitive actions: Grab / Duplicate (filtered by entity type) / Rename / Delete.

### 3. Device detection: matchMedia not innerWidth

All runtime checks that distinguish mobile touch behavior from desktop mouse behavior
**must** use `window.matchMedia('(pointer: coarse)').matches`, never `innerWidth < 768`.

Rationale: `innerWidth` is an approximation of screen width, not input capability.
`(pointer: coarse)` reflects the primary pointing device accurately on all devices.

### 4. OrbitControls disable strategy

OrbitControls must be disabled (`_controls.enabled = false`) **only** for operations that
consume single-finger input themselves, to prevent gesture conflicts:

| Operation | Disable OrbitControls? |
|-----------|----------------------|
| `_objDragging` (mouse drag) | Yes (mouse-only path, no touch) |
| `_sketch.drawing` | Yes |
| Measure point placement (`_measure.active`) | Yes — `_startMeasurePlacement()` disables; `_cancelMeasure()` and `_confirmMeasurePoint()` Phase 2 re-enable |
| 2D extrude height drag (`editSubstate === '2d-extrude'`) | Yes — `_enterExtrudePhase()` disables; `_confirmExtrudePhase()` and `_cancelExtrudePhase()` re-enable unconditionally |
| Rect selection | No — left-click and 2-finger are mutually exclusive inputs |
| Grab (G key, `_grab.active`) | No — Grab uses G key + pointer, not single-finger-only |

### 5. Face extrude: tap-to-start, release-to-confirm (touch only)

On touch devices, tapping a face in Edit 3D mode **auto-starts face extrude** without
requiring a separate Extrude toolbar button. The flow is:

1. `_onPointerDown`: `_handleEditClick` selects the face → `_startFaceExtrude()` is
   called immediately → `_activeDragPointerId` is set.
2. `_onPointerMove`: drag updates extrusion height.
3. `_onPointerUp`: `_confirmFaceExtrude()` is called if `wasDragging`.

Guard conditions for auto-start: `editSubstate === '3d'`, `_editSelectMode === 'face'`,
`!e.shiftKey`, and at least one face in `editSelection` after the click.

There is **no Extrude button** in the Edit 3D mobile toolbar. Face extrude is
gesture-only on mobile.

### 6. Grab: multi-segment drag, toolbar-only confirm

On touch, Grab (`_grab.active`) stays active across multiple finger-lift + re-touch
cycles. `_onPointerUp` does **not** call `_confirmGrab()`. Confirm is toolbar-only.

Each `_onPointerDown` during an active grab re-snapshots `_grab.segmentStartCorners`,
`startPoint`, `dragPlane`, and `startMouse` from the current object position so the drag
delta is measured from the current location, not the original.

See MENTAL_MODEL §1 "Grab State: allStartCorners vs segmentStartCorners" for the
two-snapshot distinction.

### 7. Measure placement: hold-to-snap, release-to-confirm

Measure point confirmation happens in `_onPointerUp`, not `_onPointerDown`.

- `pointerdown`: sets `_measure.pressing = true` and `_activeDragPointerId`.
- `pointermove`: updates snap candidates (live feedback during hold).
- `pointerup`: calls `_confirmMeasurePoint()` if `pressing && pointerId matches`.

This gives the user time to see snap candidates before committing the point.

---

## Consequences

**Positive**:
- Single-finger drag is always reliable for camera navigation on mobile.
- Long-press context menu provides discoverable access to primary object operations.
- `matchMedia('(pointer: coarse)')` correctly handles iPads and large-screen phones.
- Confirmation lifecycle matches user expectation for each gesture type.

**Negative / Trade-offs**:
- Object dragging on mobile is removed (replaced by Grab via long-press). Users
  accustomed to direct drag-to-move must learn the long-press workflow.
- Face extrude on mobile requires two-hand coordination (tap + drag). No alternative
  toolbar path exists.

---

## References

- ADR-003: Orbit Control — desktop orbit model (rejected middle-click approach)
- ADR-006: Right-click = Cancel / Context Menu (desktop right-click model)
- ADR-014: Edit Mode Sub-Element Selection (face selection mechanism)
- ADR-022: Undo / Redo (Grab confirmation produces a MoveCommand)
- MENTAL_MODEL §2 Events & Interaction (`.claude/mental_model/2_interaction.md`)
- ROADMAP: Mobile UX Phase 1 & 2 (2026-03-28)
