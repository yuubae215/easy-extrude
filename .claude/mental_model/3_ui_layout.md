# Mental Model: UI & Layout Adaptability

Detail file for `.claude/MENTAL_MODEL.md` Section 3.

---

## Mobile Toolbar Stability

- **Principle**: Mobile UI elements must maintain consistent layout dimensions and button placements to prevent misclicks caused by layout shifts during state changes.
- **Concrete Rule**: Each mode shows a fixed number of slots. Object mode uses **5 slots** (widest); Edit 3D uses **4 slots**. Within a mode, use `disabled: true` for temporarily unavailable actions. Pad with `{ spacer: true }` invisible placeholders so the slot count stays constant and the toolbar width never changes.

| Mode | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
|------|--------|--------|--------|--------|--------|
| Object (generic) | Add | Dup | Edit | Delete | Stack |
| Object (CoordinateFrame selected) | Rotate | Grab | Delete | Add Frame | *(spacer)* |
| Edit 2D sketch | <- Object | Extrude | *(spacer)* | *(spacer)* | — |
| Edit 2D extrude | Confirm | Cancel | *(spacer)* | *(spacer)* | — |
| Edit 3D | <- Object | Vertex | Edge | Face | — |
| Grab active | Confirm | Stack | Cancel | *(spacer)* | — |

`{ spacer: true }` renders as a `visibility: hidden` div of identical dimensions. It occupies layout space without being tappable.

Dup, Edit, and Stack are disabled for `ImportedMesh`, `MeasureLine`, and `CoordinateFrame`. Dup is additionally disabled for `Profile`. Delete remains enabled for all object types. All Object-mode slots maintain consistent disabled states so slot positions never shift.

**CoordinateFrame exception**: when a CoordinateFrame is selected the entire toolbar switches to a specialised 5-slot layout (Rotate|Grab|Delete|Add Frame|spacer) rather than disabling individual generic slots.

The Object-mode Stack button pre-sets `_grab.stackMode` before a grab gesture. `_startGrab()` does not reset `stackMode`, so the pre-set is respected. `_confirmGrab()` and `_cancelGrab()` reset it to `false` when the grab ends.

Face extrude on mobile is a gesture-only operation (tap face -> drag -> release = confirm). No Extrude button is shown in Edit 3D.

## Mobile Touch Gesture Model (2026-03-28, updated Phase 2)

- **Principle**: On mobile, the primary navigation gesture (one-finger drag) must always orbit the camera. Intercepting it for object dragging makes navigation unreliable and forces two-step flows to do basic panning.
- **Concrete Rule**: Touch (`e.pointerType === 'touch'`) in Object mode:
  - **Quick tap on object** -> selection (unchanged).
  - **One-finger drag anywhere** -> orbit via OrbitControls (no `_objDragging`, no rect selection).
  - **Long press >= 400 ms, < 8 px movement on a *selected* object** -> `_showLongPressContextMenu()` with options Grab / Duplicate / Delete / Rename. Timer stored in `_longPress.{ timer, pointerId, startX, startY }`. Cancelled in `_onPointerMove` (threshold exceeded) or `_onPointerUp` (quick release).
  - **Touch on empty space** -> orbit (no rect selection started).
  - Rect selection and `_objDragging` are mouse-only paths.
- **OrbitControls config**: `touches.ONE` must be `THREE.TOUCH.ROTATE` (not `null`). AppController returns early for touch so OrbitControls gets all single-finger events.

```js
// _longPress timer pattern (Object mode, touch hit):
if (e.pointerType === 'touch') {
  if (this._objSelected && this._selectedIds.has(obj.id)) {
    this._longPress.timer = setTimeout(() => {
      this._showLongPressContextMenu(startX, startY, obj)
    }, 400)
  }
  return  // no drag setup
}
```

## Long-Press Context Menu

- **Principle**: A single long-press action (previously direct Grab) is too opaque for first-time users. Presenting a small action popup provides discovery and reduces misfire risk.
- **Concrete Rule**: `_showLongPressContextMenu(x, y, obj)` calls `UIView.showContextMenu(x, y, items)`. Items shown depend on entity type:
  - **Grab** — always shown (all non-MeasureLine/non-CoordinateFrame objects can be grabbed).
  - **Duplicate** — hidden for `ImportedMesh` and `Profile` (read-only or un-extruded).
  - **Rename** — always shown (calls `_promptRename(id)` -> `UIView.showRenameDialog()`).
  - **Delete** — always shown (danger style).
- `UIView.showContextMenu` is dismissed on any outside `pointerdown` via a one-shot handler. `UIView.hideContextMenu()` is safe to call multiple times.
- `UIView.showRenameDialog(currentName, callback)` renders an inline modal (not `window.prompt`) with an auto-focused input, OK/Cancel buttons, and Enter/Escape keyboard support.

## Measure Point Placement (Mobile: Hold-to-Snap, Release-to-Confirm)

- **Principle**: On touch devices, placement of a single point requires the user to see snap feedback before committing. A tap-and-release offers no time to adjust; hold-and-release does.
- **Concrete Rule**: Measure point confirmation happens in `_onPointerUp`, not `_onPointerDown`. On `pointerdown`, set `_measure.pressing = true` and `_activeDragPointerId`. On `pointerup`, if `_measure.pressing && _activeDragPointerId === e.pointerId`, call `_confirmMeasurePoint()`. During the hold, `_onPointerMove` continues updating snap candidates so the user sees live snap feedback. `_cancelMeasure()` also resets `pressing = false`.

## Stack Mode (Grab)

- **Principle**: When stacking objects, the Z position should be determined by what is physically below the grabbed object, not by cursor height.
- **Concrete Rule**: Stack mode is toggled with **S** during grab (or the Stack toolbar button on mobile). When active, `_applyStackSnap()` runs after the normal movement each frame — both during `_grab.active` (G-key path) **and** during `_objDragging` (touch-drag path). It casts downward rays (`(0,0,-1)`) from **Z=10000** (not from the object's current bottom) from the 4 bottom-face corners + centroid, and finds the highest surface among non-grabbed objects. `zOffset = highestHitZ - gZMin`; if `|zOffset| >= 0.001`, all selected objects' vertex Z is shifted by `zOffset` so the bottom face rests exactly on that surface. The `_grab.stacking` flag tracks whether a snap surface was found this frame.
- **Why ray origin must be HIGH_Z**: casting from `gZMin + epsilon` misses surfaces whose top face is *above* the grabbed object's current bottom (e.g. target is taller than where we're dragging from). Starting from Z=10000 ensures the ray finds the topmost surface at (x,y) regardless of current object height.
- **Why _objDragging path**: on desktop, mouse-dragging an object uses `_objDragging`, not `_grab.active`. Stack snap must be called in both paths. Note: touch no longer uses `_objDragging` (2026-03-28 — single-finger touch orbits; Grab via long-press uses `_grab.active`). The `_objDragging` path therefore only fires on desktop mouse drag.

## Viewport-Aware Z-Index and Positioning

- **Principle**: Floating UI elements must dynamically adjust their spatial positioning to avoid colliding with or being hidden behind device-specific layouts (like mobile toolbars).
- **Concrete Rule**: The mobile floating toolbar's top edge is at **86px** from the bottom (`bottom: 26px` + `height: 60px`). `showToast()` must check `_isMobile()` and set `bottom: 96px` (instead of the desktop `64px`) so it appears above the toolbar. If the toolbar height or position changes, update both the toolbar CSS and this constant together.

```js
const bottomPx = this._isMobile() ? '96px' : '64px'
```

On mobile, status text is shown in the footer info bar (`_infoEl`) instead of the header or canvas pill, because the mobile header is too narrow and keyboard hints are irrelevant on touch. `setStatus()` and `setStatusRich()` update `_infoEl` on mobile; `_setInfoText()` is a no-op on mobile. The `_canvasStatusEl` pill is always hidden (the footer replaces it on mobile; the header status replaces it on desktop). The Nodes button (`_nodeEditorBtn`) is desktop-only and hidden on mobile.

**Mobile header right-alignment**: `_headerStatusEl` uses `visibility: hidden` (not `display: none`) on mobile so it still acts as a `flex: 1` spacer, pushing the right-side buttons (⋯ and N) to the far right without needing `marginLeft: auto` on any individual button.

**Export/Import on mobile**: `_exportJsonBtn` and `_importJsonBtn` are hidden on mobile. They are replaced by `_moreMenuBtn` (⋯), a single overflow button that opens a dropdown containing Export and Import. This keeps the header width within the mobile viewport. The ⋯ button is inserted into the flex header before `_nToggleBtn`, giving the order: `⋯ | N` at the right edge.
