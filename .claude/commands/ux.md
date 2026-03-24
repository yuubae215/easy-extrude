# UX Validator — User Experience & UI Consistency

Perform a UX review on the files specified in `$ARGUMENTS`, or on all recently changed View / Controller files if no argument is given.

## Steps

### 1. Identify target files

- If `$ARGUMENTS` is provided, review those files.
- Otherwise, run `git diff --name-only HEAD~1 HEAD` and filter for `src/view/`, `src/controller/`, and any `.css` / `.html` files.

### 2. Read reference documents

Read these before evaluating:
- `.claude/MENTAL_MODEL.md` §2 (Touch/Pointer events), §3 (UI & Layout)
- `docs/ROADMAP.md` — Mobile Support section

### 3. Read each target file in full

### 4. Evaluate against the UX checklist

#### A. Mobile Toolbar Stability (MENTAL_MODEL §3)

- [ ] Every mode exposes exactly **4 slots** (matching the widest mode, Edit 3D). Missing slots use `{ spacer: true }` (not conditional rendering), so toolbar width never changes.

| Mode | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
|------|--------|--------|--------|--------|
| Object | Add | Edit | Delete | Stack |
| Edit 2D sketch | ← Object | Extrude | *(spacer)* | *(spacer)* |
| Edit 2D extrude | Confirm | Cancel | *(spacer)* | *(spacer)* |
| Edit 3D | ← Object | Vertex | Edge | Face |
| Grab active | Confirm | Stack | Cancel | *(spacer)* |

- [ ] Buttons that are temporarily unavailable use `disabled: true`, not conditional rendering.
- [ ] Grab and Edit are `disabled` for `ImportedMesh` and `MeasureLine`. Delete remains enabled for all types.
- [ ] No layout shifts between mode transitions that would cause misclicks.
- [ ] Object-mode Stack button pre-sets `_grab.stackMode` before a grab gesture. Grab active Stack button toggles `stackMode` mid-grab.`_startGrab()` does **not** reset `stackMode`, preserving the pre-set.

#### B. Touch Event Handling (MENTAL_MODEL §2)

- [ ] `_onPointerDown` re-runs hit tests (e.g. `_hitFace()`) for touch devices before dispatching clicks — not relying on a prior `pointermove` for hover state.
- [ ] Face extrude on mobile is **gesture-only**: tap → drag → release (no Extrude button in Edit 3D).
- [ ] `_confirmFaceExtrude()` is called in `_onPointerUp`, not `_onPointerDown`.
- [ ] `_onPointerDown` returns early for events not originating from the canvas (`e.target !== renderer.domElement`).

#### C. Multi-touch / Orbit Coexistence (MENTAL_MODEL §2)

- [ ] Rect selection does not disable OrbitControls (`_controls.enabled` not set to `false` for rect sel).
- [ ] Second touch during rect selection cancels rect sel and lets OrbitControls take the two-finger gesture.
- [ ] Only `_objDragging` and `_sketch.drawing` legitimately set `_controls.enabled = false`.

#### D. Toast & Status Positioning (MENTAL_MODEL §3)

- [ ] `showToast()` uses `bottom: 96px` on mobile, `bottom: 64px` on desktop.
- [ ] Status text on mobile updates `_infoEl` (footer bar), not the canvas pill or header.
- [ ] `_canvasStatusEl` pill is always hidden.
- [ ] Nodes button (`_nodeEditorBtn`) is hidden on mobile.
- [ ] N-panel toggle (`_nToggleBtn`) uses `marginLeft: auto` on mobile for right-aligned placement.

#### E. Grab / Numeric Input UX

- [ ] Numeric input (e.g. typing a distance during Grab) is clearly shown in the status bar.
- [ ] `Escape` / right-click always cancels an in-progress operation with visible feedback.
- [ ] Confirm (`Enter`) finalises the operation and returns to the previous mode.
- [ ] Stack mode: **S** toggles it during grab (desktop); the Stack toolbar button toggles it on mobile (Object-mode pre-set and Grab-active mid-grab). Status bar shows stack indicator when `_grab.stacking` is true.

#### F. Read-Only Entity Feedback

- [ ] Attempting Grab (G key or touch-drag) on `ImportedMesh` or `MeasureLine` emits `showToast('Imported geometry is read-only')` before returning — the keypress must not be silently swallowed.
- [ ] Attempting Edit Mode (Tab / E key) on `ImportedMesh` or `MeasureLine` emits the same toast. `e.preventDefault()` is called only when a real mode transition occurs (not for read-only blocks).

#### G. MeasureLine / Measure Tool UX

- [ ] **M key** and **Shift+A → Measure** start measure placement mode; status bar shows placement instructions.
- [ ] Snap candidates (V/E/F snapping) are shown during measure pointer movement via `_measure.snapMeshView` (not `_meshView` of the active `MeasureLine`).
- [ ] **Desktop**: click places p1; next click places p2 and confirms the measurement.
- [ ] **Mobile** (hold-to-snap): `pointerdown` starts pressing (`_measure.pressing = true`); `pointerup` confirms the point — not `pointerdown`. Live snap feedback visible during the hold.
- [ ] Distance label (amber) updates every animation frame via `MeasureLineView.updateLabelPosition(camera)`.
- [ ] `_cancelMeasure()` clears `_measure.snapMeshView` and calls `clearSnapDisplay()` on it.

#### H. Accessibility Basics

- [ ] Interactive DOM elements (`button`, `input`) have discernible labels (text content or `aria-label`).
- [ ] Focus is not lost unexpectedly when switching modes.
- [ ] Colour alone is not the only indicator of state (e.g. selected vs unselected should also differ in shape or label).

#### I. Keyboard Shortcuts (Desktop)

- [ ] Shift+A opens the Add menu.
- [ ] G starts Grab; X/Y/Z constrain axis; S toggles Stack during grab; Enter confirms; Escape / right-click cancels.
- [ ] M key (or Shift+A → Measure) starts measure placement.
- [ ] Tab cycles edit sub-modes in Edit 3D (Vertex / Edge / Face).
- [ ] Shortcuts are surfaced in the status bar while the relevant operation is active.

#### J. Visual Feedback Consistency

- [ ] Hovered faces highlight immediately on `pointermove` (desktop).
- [ ] Selected sub-elements (vertices, edges, faces) have a distinct colour from hovered ones.
- [ ] `setObjectSelected(true)` is restored when returning to Object mode from Edit mode (MENTAL_MODEL §1 — State Restoration on Mode Exit).
- [ ] Measure distance label (amber) is visible and updates position every animation frame via `MeasureLineView.updateLabelPosition(camera)`.

### 5. Report findings

For each issue:

```
[CATEGORY] File:line — Description
  Rule violated: <checklist item letter>
  Suggested fix: <one-line suggestion>
```

Categories: **TOOLBAR** · **TOUCH** · **ORBIT** · **STATUS** · **GRAB** · **READONLY** · **MEASURE** · **A11Y** · **KEYBOARD** · **VISUAL**

If no issues are found, output: `✓ UX: no issues found in <file list>`.

### 6. Summary

```
UX result: N issues across X files. Categories: <list with counts>.
```
