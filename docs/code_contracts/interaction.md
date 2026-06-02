# Mental Model: Events & Interaction (Touch/Pointer)

Detail file for `docs/CODE_CONTRACTS.md` Section 2.

---

## Touch vs. Pointer Event Asymmetry

- **Principle**: Do not rely on `pointermove` firing before `pointerdown` for hover states or hit-testing, as touch devices combine these into a single tap interaction.
- **Concrete Rule**: In `_onPointerDown`, you must manually re-run hit tests (e.g. `_hitFace()`) before calling `_handleEditClick`. Otherwise, touch taps will never successfully select sub-elements like faces or vertices.

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

## Gesture-Based Interaction Priority (Mobile)

- **Principle**: Mobile interactions should prioritize combined gesture flows (tap + drag) over multi-step button clicks for primary spatial actions.
- **Concrete Rule**: On touch devices (`matchMedia('(pointer: coarse)')`), tapping a face in Edit 3D auto-starts extrude. In `_onPointerDown`, after `_handleEditClick`, call `_startFaceExtrude(face)` and set `_activeDragPointerId`. The auto-start fires only when: `editSubstate === '3d'`, `_editSelectMode === 'face'`, `!e.shiftKey`, and at least one Face is in `editSelection` after the click. Face extrude is a gesture-only operation — there is no Extrude toolbar button in Edit 3D.

## Interaction Confirmation Lifecycle

- **Principle**: Continuous drag interactions must lock in their final value on release (`pointerup`), not on initial touch (`pointerdown`), to correctly capture the movement delta.
- **Concrete Rule**: `_confirmFaceExtrude()` belongs in `_onPointerUp` (confirmed on finger-lift). **`_confirmGrab()` on touch is toolbar-only** — `_onPointerUp` does NOT call it; grab stays active across multiple drag segments until the user presses Confirm. Do **not** move `_confirmFaceExtrude()` to `_onPointerDown`.

  For **Grab on touch**: each `_onPointerDown` with `e.pointerType === 'touch'` re-snapshots `_grab.segmentStartCorners` / `startPoint` / `dragPlane` from the current object position and camera, then sets `_activeDragPointerId`. `_onPointerUp` does nothing — grab stays active. The toolbar Confirm button calls `_confirmGrab()` directly; no double-confirm risk because `_activeDragPointerId` is never set for toolbar taps (canvas guard).

  For **FaceExtrude on touch**: `_onPointerDown` sets `_activeDragPointerId`; `_onPointerUp` calls `_confirmFaceExtrude()` when `wasDragging`.

```js
// _onPointerDown — touch grab path (re-snapshot segment start)
if (this._grab.active && e.button === 0 && e.pointerType === 'touch') {
  this._grab.segmentStartCorners = new Map(/* current corners of all selected */)
  // also update startPoint, dragPlane, startMouse from current state
  this._activeDragPointerId = e.pointerId
  return  // confirm via Confirm button only
}

// _onPointerUp — grab stays active
if (this._grab.active) {
  return  // do NOT call _confirmGrab() here
}
```

## Mobile Rotate Interaction Lifecycle

- **Principle**: On mobile, the rotate operation follows the same multi-segment drag pattern as Grab: each new canvas touch re-anchors the drag reference so subsequent drags accumulate naturally.
- **Concrete Rule**: Tapping the Rotate button calls `_startRotate(true)` (deferStartAngle = true). In `_onPointerDown` during rotate, touch events: (1) re-snapshot `segmentStartCorners` (Solid) or `segmentStartRot` (CF) from the current object state; (2) set `needsStartAngle = true`; (3) set `_activeDragPointerId`. In `_applyRotate`, when `needsStartAngle` is true, capture `segmentStartAngle = currentAngle` and return without applying rotation. Subsequent pointer moves apply `angle = currentAngle - segmentStartAngle` from `segmentStartCorners`. (Positive angle = screen-CCW rotation, which is the intuitive direction: screen-CCW swipe → object rotates CCW on screen.) In `_onPointerUp` during rotate, return immediately — rotate stays active until the Confirm/Cancel toolbar button fires.

  `startCorners` / `startRot` remain unchanged throughout (undo anchor). `segmentStart*` fields are re-initialized on each touch re-down.

  Left-click on canvas still confirms on PC; right-click cancels. Touch `pointerdown` during rotate must NOT confirm — add `if (e.pointerType === 'touch') { ... return }` before the `e.button === 0` confirm check.

## Rotate Segment Re-snapshot on Axis Change

- **Principle**: Switching axis constraints during Rotate (X→Y, Y→Z, etc.) must re-snapshot the current rotation state as the new segment baseline — identical to how `_setGrabAxis()` re-snapshots `segmentStartPositions` for Grab. Without re-snapshotting, the accumulated rotation from the previous axis is discarded and a spurious angle jump occurs.
- **Concrete Rule**: In `_setRotateAxis()`, after updating `this._rotate.axis` and before re-computing `startAngle`:
  1. Re-snapshot orientation: `segmentStartRot.copy(obj.rotation)` (CoordinateFrame) or `segStartOrientation = obj.orientation.clone()` (Solid).
  2. Re-snapshot position: `segStartPos = obj._position.clone()` and `segStartPivot = obj._position.clone()` (Solid only; CF pivot is derived from `worldPoseOf()`).
  3. After computing the new `startAngle`, reset: `accumulatedAngle = 0`, `prevCurrentAngle = startAngle`, `segmentStartAngle = startAngle`.

  Without step 1: `applyPreviewRotation` starts from the original orientation, discarding the X-axis rotation result.
  Without step 3: the first `_applyRotate()` delta is `currentAngle(new axis) − prevCurrentAngle(old axis)` — an arbitrary large jump.

## Grab State: allStartCorners vs segmentStartCorners

- **Principle**: A multi-drag grab (multiple finger-lift + re-touch cycles before confirming) needs two distinct corner snapshots: one for undo/cancel anchoring, and one for per-segment drag delta calculation.
- **Concrete Rule**:
  - `_grab.allStartCorners` — snapshot taken once in `_startGrab()`. Used by `_cancelGrab()` (restore to original) and `_confirmGrab()` (undo command "before" state). **Never updated mid-grab.**
  - `_grab.segmentStartCorners` — snapshot taken in `_startGrab()` (initially = `allStartCorners`) **and re-taken on every touch re-down** during grab AND on every axis-constraint switch in `_setGrabAxis()`. Used by `_applyGrabDeltaToAll()` so the drag delta is measured from the current position, not the original. Updating only `segmentStartCorners` (not `allStartCorners`) ensures cancel/undo always revert to the pre-grab origin.
  - `_applyGrabDeltaToAll(delta)` must iterate `segmentStartCorners`, not `allStartCorners`.
  - After re-snapshotting `segmentStartPositions` in `_setGrabAxis()`, **`_grab.centroid` and `_grab.pivot` must also be updated** to the current object position (average of `segmentStartPositions` for Solids; `worldPoseOf()` for CoordinateFrame). Without this update the axis guide line and the screen-space axis-projection pivot remain at the original grab-start position while the object has already moved — the line appears "left behind" (置いてきぼり).

## Long-Press Context Menu for Non-Draggable Entities (Mobile)

- **Principle**: Entity types that block pointer drag (CoordinateFrame, MeasureLine, Annotated*) must still receive the long-press context menu on touch so mobile users can access "Link to..." and other context actions.
- **Concrete Rule**: In `_onPointerDown`, the early-return guard that blocks drag for non-draggable entity types must set up the long-press timer for touch events **before** returning. Without this, CoordinateFrames are never accessible from the long-press context menu on mobile — the user is forced to long-press the parent Solid, which sets `sourceId` to the Solid's ID instead of the CF's ID, causing `fastenFrame()` to fail with a type-mismatch that shows as "frame pose unknown".

```js
if (obj instanceof MeasureLine || obj instanceof CoordinateFrame || ...) {
  // Set up long-press BEFORE returning so touch context menu still works
  if (e.pointerType === 'touch' && this._objSelected && this._selectedIds.has(obj.id)) {
    this._longPress.pointerId = e.pointerId
    this._longPress.startX    = e.clientX
    this._longPress.startY    = e.clientY
    this._longPress.timer = setTimeout(() => { ... }, 400)
  }
  return  // still no drag
}
```

## _confirmFastenFrame Type Guard

- **Principle**: Before delegating to `fastenFrame()`, verify that both source and target are CoordinateFrames. `fastenFrame()` returning null is overloaded — it covers both type mismatch and missing world pose; the caller must distinguish these cases to show a meaningful error.
- **Concrete Rule**: `_confirmFastenFrame()` must check `instanceof CoordinateFrame` for both IDs and show "Select a coordinate frame as source and target" before calling `fastenFrame()`. It must also call `this._service._updateWorldPoses()` immediately before `fastenFrame()` to refresh the cache (the same pattern used in `_switchActiveObject`).

## Global Event vs. UI Event Delegation

- **Principle**: Global `window` listeners must explicitly ignore pointer events originating from UI overlays to avoid intercepting and canceling clicks meant for buttons.
- **Concrete Rule**: In `_onPointerDown`, immediately check `if (e.target !== this._sceneView.renderer.domElement) return` before processing grabs or extrudes. This guard goes **before** the grab/faceExtrude active checks so that toolbar button taps fall through to their own `click` listeners. Without this, `_handleEditClick` fires on every toolbar tap and clears face/vertex/edge selection before the button's `click` handler runs.

```js
if (e.target !== this._sceneView.renderer.domElement) return
```

## Input Method Mutually Exclusive States

- **Principle**: Only disable global camera controls when a specific operation fully consumes the same input gesture (e.g. single-finger drag).
- **Concrete Rule**: Do **not** set `_controls.enabled = false` for rect selection. Rect selection uses 1-finger/left-click; Orbit uses 2-finger/right-click — they are mutually exclusive inputs. Cancel rect selection only if a second touch arrives, then clear `_activeDragPointerId` so OrbitControls can take over the two-finger gesture. Operations that **do** need `_controls.enabled = false` (single-finger/mouse drag conflicts): `_objDragging`, `_sketch.drawing`, **Measure point placement** (`_measure.active`), **2D extrude height drag** (`editSubstate === '2d-extrude'`), **Grab** (`_grab.active`), and **CoordinateFrame Rotate** (`_rotate.active`). Each operation must disable in its `_start*()` method and re-enable in both its `_confirm*()` and `_cancel*()` methods. `_enterExtrudePhase()` disables controls when `window.matchMedia('(pointer: coarse)').matches`; `_confirmExtrudePhase()` and `_cancelExtrudePhase()` re-enable unconditionally. `_onPointerDown` for `2d-extrude` sets `_activeDragPointerId` and returns early to prevent sub-element selection logic from running. **Do NOT use `window.innerWidth < 768` for any OrbitControls check** — iPads report `innerWidth = 768` in portrait (not `< 768`), and large phones in landscape may exceed 768 px, leaving OrbitControls erroneously active on those devices.
