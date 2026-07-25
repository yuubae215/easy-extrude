# State Transitions

Records the state machines of easy-extrude — both **UI mode transitions** and
**internal component state machines**.

UI state machines (modes, substates, input gestures) are covered in the sections below.
Internal component state machines (caches, async flags, lifecycle objects) are covered
in the final section.  **Both must be designed here before implementation.**
See ADR-008 for UI mode implementation details.

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
`_mapMode.drawState` — two-state inner FSM: `"idle"` / `"drawing"` (ADR-073
removed the old `"pending"` name+confirm gate — geometry completion creates
the entity immediately with an auto-name; rename is a later N-panel act).

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
    │    Scroll wheel / two-finger pinch → zoom (frustumSize)
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
    │   │    Enter / RMB (≥2 pts) OR snap-close → _createAnnotation()      │
    │   │                                                                    │
    │   │  Zone (drag-rectangle region)                                     │
    │   │    pointerdown → drawState = "drawing"                            │
    │   │    pointerup   → _createAnnotation()                             │
    │   │                                                                    │
    │   │  Hub / Anchor (single click point)                                │
    │   │    click → _createAnnotation()                                   │
    │   │                                                                    │
    │   └────────────────────────────────────────────────────────────────────┘
    │
    │   ┌─ Mobile platform ─────────────────────────────────────────────────┐
    │   │                                                                    │
    │   │  All types: single drag gesture                                   │
    │   │    pointerdown → drawState = "drawing"                            │
    │   │    pointermove → update preview (cursor set here — no prior hover)│
    │   │    pointerup   → _createAnnotation()                             │
    │   │                                                                    │
    │   └────────────────────────────────────────────────────────────────────┘
    │
    │       drawState = "drawing"
    │           preview line/shape updates with pointer movement
    │           ESC → drawState = "idle" (discard)
    │
    │       _createAnnotation()  (geometry complete — no name form, ADR-073)
    │           → auto-name "<Type> N" from per-type counter
    │           → create entity (AnnotatedLine / AnnotatedRegion / AnnotatedPoint)
    │           → push AddAnnotationCommand (undoable)
    │           → drawState = "drawing"  (tool stays active for the next shape)
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
    |       re-snapshots segmentStartCorners/segmentStartPositions to current positions
    |       and resets startMouse — preserves accumulated offset from previous constraint
    |       (e.g. X→Y keeps the X movement; switching back to free grab also resets startPoint)
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

## Internal Component State Machines

### Design workflow (required before implementation)

Whenever you introduce a stateful component — a cache, an async flag, a lifecycle
object — draw its state machine here **before writing the implementation**.
The critical question that must be answered for every accessor method:

> **"What does this method return / do in each state?"**

This question, asked at design time, prevents an entire class of bug where callers
receive `null` or stale data and silently fall back to a wrong value.

The checklist:

```
1. Name every possible state the component can be in.
2. Draw all transitions (what event causes each transition).
3. For each public accessor / method:
      - specify its behaviour in every state
      - choose one of: (a) compute on demand (self-healing)
                       (b) throw / assert (precondition violated)
                       (c) eager init (UNINIT state impossible by construction)
      - "return null" is NOT an acceptable answer — it transfers the problem
        to every caller and will be mishandled by N−1 of them.
4. Document the chosen strategy here and in CODE_CONTRACTS.
```

---

### `_worldPoseCache` (SceneService)

**Why this exists here**: 11 of 14 `worldPoseOf()` call sites were missing a
freshness guard because the cache's lifecycle states were never formally designed.
Every accessor silently fell back to `(0,0,0)` before the animation loop had run.
(See PHILOSOPHY #23.)

**States**

```
UNINIT ──[_updateWorldPoses() first call]──→ VALID
VALID  ──[invalidateWorldPose(frameId)]────→ STALE  (entry removed from Map)
STALE  ──[_updateWorldPoses()]─────────────→ VALID
```

`UNINIT` = `_worldPoseCache` is empty (app start, or after `_worldPoseCache.clear()`).
`STALE`  = one or more entries have been removed by `invalidateWorldPose()` but
           `_updateWorldPoses()` has not yet rerun (e.g. during undo/redo, between frames).

**Accessor contract**

| Accessor | UNINIT | VALID | STALE |
|----------|--------|-------|-------|
| `worldPoseOf(id)` | auto-heal: calls `_updateWorldPoses()`, then returns entry | return cached entry | auto-heal: calls `_updateWorldPoses()`, then returns entry |

Strategy chosen: **(a) compute on demand** — `worldPoseOf()` calls `_updateWorldPoses()`
on cache miss so every caller always receives a current pose regardless of when it is
called relative to the animation loop.

```javascript
// SceneService.js
worldPoseOf(frameId) {
  if (!this._worldPoseCache.has(frameId)) this._updateWorldPoses()
  return this._worldPoseCache.get(frameId) ?? null
}
```

**Transition triggers**

| Transition | Trigger | Called by |
|------------|---------|-----------|
| → VALID | `_updateWorldPoses()` | animation loop (every frame) + `worldPoseOf()` on cache miss |
| → STALE | `invalidateWorldPose(id)` | `MoveCommand.apply()` during undo/redo |
| → UNINIT | `_worldPoseCache.clear()` | `_clearScene()` |

---

### `context.wizard` — Guided-intake wizard FSM (ADR-063 Phase 3)

**Why this exists here**: the wizard has 3+ states and its illegal transitions
(advancing past an unsatisfied step, a bulk confirm that bypasses review) are doc
quality accidents — 核 §1.4 requires the machine before the components. The state
was designed in ADR-063 §4 before `WizardPanel` was written.

**States** (stored in `uiStore.context.wizard`, replaced wholesale — a
discriminated union like `context.grasp`, illegal shapes unrepresentable)

```
null (inactive)
  ──[startWizard() — onWizardStart]──────────────→ { defId, status:'step', index:0 }
step(k)
  ──[next, wizardStepGaps === []]────────────────→ step(k+1)   (k < last)
  ──[next, wizardStepGaps === [] , k === last]───→ review
  ──[next, wizardStepGaps ≠ []]──────────────────→ step(k)     (SAME state returned — blocked with printable reasons, never silent)
  ──[back, k > 0]────────────────────────────────→ step(k−1)
  ──[back, k === 0]──────────────────────────────→ step(0)     (stays; no underflow)
  ──[exit — onWizardExit]────────────────────────→ null        (committed steps stay in the doc)
review
  ──[back]───────────────────────────────────────→ step(last)
  ──[finish — onWizardFinish]────────────────────→ null        (+ contextSetTab('matrix'); a view transition, NOT a commit)
any
  ──[contextStart / contextEnd]──────────────────→ null
```

**Guards / invariants**

- `next` is gated by the pure `wizardStepGaps(def, state, doc)` — it counts only
  **committed** doc entries (step-local form drafts are transient and never a
  second source, §1.1). The controller enforces the gate against the
  authoritative `ContextService.getDoc()`; the panel derives the same list from
  the projected slice for display (one predicate, two projections — no silent
  disabled, PHILOSOPHY #11).
- Every step confirm is an immediate CommandStack doc commit (the existing
  `onAddDocEntry` path) — exiting mid-wizard always leaves a valid, undoable
  working doc. There is no all-or-nothing modal commit (ADR-063 §4).
- Sole writer: `ContextController` via the pure `WizardCatalog` transition
  functions (`startWizard` / `nextWizardState` / `prevWizardState`). The panel
  only reads and fires `onWizard*` callbacks (same discipline as the grasp FSM,
  ADR-057 / PHILOSOPHY #5).

---

### `tour` — Desktop onboarding tour FSM (ADR-065 Phase 6)

**Why this exists here**: the tour has 3+ states and a wrong hint is an
experience accident (核 §1.4 trigger — designed in ADR-065 §2 before the
components). It is user-visible APP state (which quest is open), NOT
presentation history — the deliberate ADR-065 §2 carve-out from ADR-062's
"no presentation state in the uiStore".

**States** (stored in top-level `uiStore.tour`, replaced wholesale — a
discriminated union like `context.grasp`/`context.wizard`)

```
null (not shown: mobile pointer, or persisted ee_tour flag)
  ──[boot, fine pointer, no ee_tour — startTour(facts)]→ { status:'active', step:firstOpen }
active(step)
  ──[fact source fires, step.done(facts)]──────────────→ active(next open step)   (satisfied steps SKIPPED)
  ──[fact source fires, last step done]────────────────→ { status:'done' }        (+ persist ee_tour='done')
  ──[fact source fires, step still open]───────────────→ active(step)             (SAME reference — no store write)
  ──[malformed facts]──────────────────────────────────→ active(step)             (held, never advanced on garbage)
  ──[corrupt state (unknown step id)]──────────────────→ null                     (no hint beats a wrong hint #11)
  ──[✕ Skip — onTourDismiss]───────────────────────────→ null                     (+ persist ee_tour='dismissed')
done
  ──[✕ Close — onTourDismiss]──────────────────────────→ null
```

**Guards / invariants**

- Quest trail (pure `TOUR_STEPS` in `src/view/TourMath.js`): add → select →
  grab → edit → extrude. Every `done` predicate reads only **committed** facts:
  Solid count, the committed selection, `selectionMode`, and the last
  CommandStack landing `{label, phase}` (a landing is a committed operation —
  optimistic previews never land).
- Progress only moves FORWARD (`nextTourState` never regresses — undoing the
  added box does not resurrect the add quest; the affordance was demonstrated).
- Fact sources → `AppController._updateTour()`: CommandStack landing listener,
  `objectAdded`, `activeChanged`, `setMode()`. Sole writer: AppController
  (PHILOSOPHY #5); `TourCard` and the Outliner anchor pulse only read.
- An active overlay (Context / demo / template gallery) suppresses rendering
  via the shared `tourVisible` predicate WITHOUT mutating the FSM — the quest
  resumes when the overlay closes.
- Persistence is a display **setting** (ADR-065 Widening 3): only the
  done/dismissed flag (`localStorage.ee_tour`) survives the session; the
  progression itself persists nowhere.

---

### `home` — Launch / Home screen FSM (ADR-089)

**Why this exists here**: Home touches the **boot flow** (a hard-to-reverse app
entry) and toggles app-visible state (whether the launch overlay is up). It is
modelled as a discriminated union replaced wholesale — the same流儀 as
`tour` / `context.wizard` — so an illegal shape (e.g. "open" with no overlay) is
unrepresentable. It is a small 2-state machine (§0 cheapest-lens: BPMN-style
open→resolve, not CMMN); the **skip preference** is a persisted display setting
(`localStorage.ee_home`), NOT an FSM state (§1.1 — settings/derived never smuggled
into the state).

**States** (stored in top-level `uiStore.home`)

```
null (not shown: persisted ee_home='skip' flag at boot, or after resolve)
  ──[boot, no ee_home flag — openHome()]───────────────→ { status:'open' }
  ──[Header "Layout gallery" slot — openHome()]─────────→ { status:'open' }   (reopen after skip)
open
  ──[select layout card — onSelectLayoutTemplate(id)]──→ null   (+ compileLayout → importFromJson(clear) → land S-01)
  ──[Empty Project — onStartEmptyProject()]────────────→ null   (close onto default boot scene → S-01)
  ──[✕ close — onCloseHome()]──────────────────────────→ null   (close onto whatever scene is loaded)
any
  ──[toggle "起動時に表示しない" — onToggleHomeSkip(b)]→ (same state)   (persists ee_home; NOT a transition)
```

**Guards / invariants**

- Sole writer: `AppController` (PHILOSOPHY #5). `HomeScreen` only reads `uiStore.home`
  and fires `onSelectLayoutTemplate` / `onStartEmptyProject` / `onToggleHomeSkip` /
  `onCloseHome` callbacks (same discipline as the tour / wizard panels).
- Layout load rides the **single authoritative path** `compileLayout` →
  `SceneService.importFromJson(scene, {clear:true})` (PHILOSOPHY #1) — Home adds no
  new load logic. Empty Project performs no scene replacement (keeps the default
  boot scene).
- Persistence is a display **setting** (ADR-065 Widening 3, ADR-089 §3): only the
  skip flag (`localStorage.ee_home`) survives the session; the open/null state
  persists nowhere. Boot reads the flag once to decide the initial state.
- Reopen affordance lives in a **fixed** header slot / ⋯ MoreMenu item so a skipped
  Home is never a dead end (PHILOSOPHY #15 / #11).
- The ADR-086 deterministic boot slice (no startup ReferenceError) holds on the Home
  path as well.

---

### GSN goal support — 未探索 / 探索中 / 支えあり (PHILOSOPHY #31)

**Why this exists here**: the ledger crossed the 3-state threshold for a `.gsn`
goal's *support* on 2026-07-25 (核 §1.4). This is not a runtime entity, but it is
a state set with an illegal region that used to be reachable in silence: a goal
with **zero** support (0 strategy, 0 solution, 0 sub-goal) rendered identically to
a fully evidenced one, because absence has no node to inspect. The state is now
declared rather than inferred, and the guards are executable
(`gsn_tool.py lint`, CI `pnpm test:gsn`) — the transitions below are enforced, not
described.

**States** (support is structural + a reserved `labels` value; `state` stays the
extension's *freshness* axis and is deliberately orthogonal)

```
unexplored  (labels support-unexplored — nothing named yet, not falsifiable)
  ──[write an assumption naming the check that would settle it]──→ exploring
exploring   (labels support-exploring + ≥1 assumption child — "証拠予定: …")
  ──[run the check; assumption → solution, drop the label]───────→ supported
  ──[decompose instead; add a strategy, drop the label]──────────→ supported
supported   (≥1 strategy / solution / sub-goal, no support label)
  ──[evidence goes stale]───────────────────────────────────────→ (state ToBeReviewed; still supported)
```

**Guards / invariants** — each one is a lint error, not a convention:

- **No undeclared zero.** A goal with no support and no `support-*` label is an
  error. This is the whole point: the empty branch can no longer pass silently.
- **Exactly one declaration.** Two `support-*` labels on one goal is an error.
- **`support-exploring` requires an assumption child.** Without a named check it is
  `support-unexplored` wearing a costume — the label would claim in-flight work
  that does not exist.
- **A declaration of absence dies when support arrives.** A `support-*` label on a
  goal that has gained a strategy/solution/sub-goal is an error, so the forward
  transitions cannot be taken half-way.
- **Support labels are goal-only.** The same label on a strategy or solution is an error.
- Backward transitions (supported → exploring) are not modelled: evidence that goes
  stale moves on the freshness axis (`state ToBeReviewed`), and deleting a branch to
  tidy the tree is forbidden by `/gsn-maintain`'s guardrails — a removed zero is an
  invisible zero again.

---

## CoordinateFrame Body Frame Lifecycle (ADR-037)

### Origin CF is created atomically with every Solid

```
Shift+A → Add Box  /  Extrude Profile  /  Duplicate Solid
    |
    createSolid() / extrudeProfile() / duplicateSolid()
    |   → Solid added to model, objectAdded emitted
    |   → createCoordinateFrame(solid.id, 'Origin', null)
    |       translation=(0,0,0), rotation=identity
    |
    v
OBJECT MODE — Solid selected
    Outliner: Solid
               └── Origin (CF, locked icon, at centroid)
    TC proxy: position = Origin CF worldPos (= centroid)
              quaternion = Origin CF worldQuat (= Solid.bodyRotation)
```

### User CF creation — parent is always Origin CF

```
OBJECT MODE (Solid selected)
    |
    Long-press → "Add Interface Frame"   OR
    Add menu → "Frame" → pick-sub-mode → click
    |
    Solid already has Origin CF (guaranteed since Solid creation)
    effectiveParentId = Origin CF id
    createCoordinateFrame(originId, name, [worldPos])
    push CreateCoordinateFrameCommand(userFrame)
    |
    v
OBJECT MODE — user CF selected
    Outliner: Solid
               └── Origin (locked)
                   └── Frame.001 (user CF)
```

### Undo Solid creation (AddSolidCommand.undo)

```
Undo AddSolidCommand
    |
    childrenRefs (collected by _collectAllDescendantFrames) includes Origin CF
    |
    for each child (reverse order): hide + detach
    detach Solid
    |
    → OBJECT MODE (next object selected or deselected)
```

### Undo / redo of Extrude (ExtrudeSketchCommand)

```
Undo ExtrudeSketchCommand
    |
    find Origin CF via scene.getChildren(solidId)
    deleteObject(Origin CF)   ← disposes meshView
    detachObject(solid)
    reattachObject(profile)   ← Profile survives with its MeshView
    |
    → OBJECT MODE — Profile selected

Redo ExtrudeSketchCommand
    |
    extrudeProfile() → new Solid + new Origin CF (both created fresh)
    |
    → OBJECT MODE — Solid selected
```

### Origin CF lifecycle states

```
ABSENT  ── (before Solid creation)
           Solid created ────────────────────────────────→ PRESENT
PRESENT ── AddSolidCommand.undo() ──────────────────────→ ABSENT
PRESENT ── ExtrudeSketchCommand.undo() ─────────────────→ ABSENT (deleteObject disposes it)
PRESENT ── explicit delete attempt ──────────────────────→ PRESENT (blocked with toast)
PRESENT ── cascade delete (parent Solid deleted) ────────→ gone (disposed)
```

### Origin CF invariants

- `translation = (0,0,0)` in parent-local → worldPos = Solid centroid
- `rotation = identity` in parent-local → worldQuat = Solid.bodyRotation
- `name === 'Origin'`
- Always a direct child of a Solid (`parentId = solid.id`)

Protected operations (toast shown, operation blocked):

| Operation | Guard location |
|-----------|---------------|
| Grab / drag | `_startGrab()` |
| N-panel translation | `onFramePositionChange` (existing) |
| N-panel rotation | `onFrameRotationChange` (existing) |
| Rename | `_renameObject()` |
| Delete | `_deleteObject()` |
| Reparent | `onReparent`, `onFrameParentChange` (existing) |

### TC proxy orientation for Solid (ADR-037 §3)

```
Solid selected → _attachMobileTransform(solid)
    |
    look up Origin CF (direct child with name === 'Origin')
    |
    ├── found:
    │     tcProxy.position   = worldPoseOf(origin).position   (= centroid)
    │     tcProxy.quaternion = worldPoseOf(origin).quaternion (= bodyRotation)
    │
    └── not found (legacy scene, pre-ADR-037):
          tcProxy.position   = getCentroid(solid.corners)
          tcProxy.quaternion = identity   ← world-aligned fallback
```

---

## CoordinateFrame Role under Fixed-Joint SpatialLink (ADR-038)

A CF's **kinematic role** in the constraint graph determines which user operations are
permitted on it every animation frame. The role is derived from `_fastenedTransforms`
(keyed by SpatialLink.id where `jointType === 'fixed' && semanticType !== 'mounts'`).

### CF kinematic role states

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ State          │ Definition                           │ Managed by           │
├─────────────────────────────────────────────────────────────────────────────┤
│ FREE           │ Not in any fixed-joint chain         │ default              │
│ JOINT_SOURCE   │ _fastenedTransforms[link.id]         │ fastenFrame()        │
│                │   .sourceId === this.id              │ unfastenFrame()      │
│ SOURCE_ANCESTOR│ parentId chain of JOINT_SOURCE       │ derived (no field)   │
│                │ includes this CF                     │                      │
│ JOINT_TARGET   │ link.targetId === this.id            │ fastenFrame()        │
│                │ (reference/driver frame)             │ unfastenFrame()      │
└─────────────────────────────────────────────────────────────────────────────┘
```

State is **not stored** on the entity — it is queried each operation via:
- `isFastenedSource(cfId)` → JOINT_SOURCE
- `isInFixedJointSourceChain(cfId)` → JOINT_SOURCE **or** SOURCE_ANCESTOR

### State transitions

```
FREE ──── fastenFrame(thisId, targetId) ────────────────────────→ JOINT_SOURCE
FREE ──── fastenFrame(sourceId, thisId) ────────────────────────→ JOINT_TARGET
FREE ──── parentId-chain of a JOINT_SOURCE CF ──────────────────→ SOURCE_ANCESTOR
                                                                   (implicit; no event)

JOINT_SOURCE ──── unfastenFrame(link) ─────────────────────────→ FREE
JOINT_TARGET ──── unfastenFrame(link) ─────────────────────────→ FREE
SOURCE_ANCESTOR ── all JOINT_SOURCE CFs in chain unfastened ───→ FREE
                                                                   (implicit)
```

### Permitted operations per role

| Operation | FREE | JOINT_SOURCE | SOURCE_ANCESTOR | JOINT_TARGET |
|-----------|------|--------------|-----------------|--------------|
| Grab (translate) | ✓ | ✗ toast | ✗ toast | ✓ |
| R-key rotate | ✓ | ✗ toast | ✗ toast | ✓ |
| TC drag | ✓ | ✗ toast | ✓ (TC blocked separately) | ✓ |
| N-panel translate | ✓ | ✓ (constraint overwrites) | ✓ | ✓ |
| N-panel rotate | ✓ | ✓ (constraint overwrites) | ✓ | ✓ |
| Delete | ✓ | ✓ (link removed too) | ✓ | ✓ |
| Rename | ✓ | ✓ | ✓ | ✓ |

**R-key on SOURCE_ANCESTOR** was previously unguarded (bug #GxGK6):
- `_applyRotate()` wrote `Origin CF.rotation` using the LIVE `Solid.bodyRotation`
- `_updateFastenedFrames()` corrected `Solid.bodyRotation` each frame
- Each frame `_applyRotate()` read the corrected bodyRot → produced a different
  CF rotation → different constraint delta → bodyRot accumulated unboundedly
- Fix: `_startRotate()` CF branch calls `isInFixedJointSourceChain(obj.id)`,
  which checks both JOINT_SOURCE and SOURCE_ANCESTOR states.

### `_updateFastenedFrames()` per-frame writes (constraint active)

Every animation frame while `_fastenedTransforms` is non-empty:

```
JOINT_SOURCE CF:
  ├── source.translation  ← overwritten (world→local back-conversion)
  ├── source.rotation     ← overwritten (world→local back-conversion)
  ├── _worldPoseCache[sourceId] ← overwritten with solver result
  └── source.meshView     ← updatePosition, updateRotation, updateConnectionLine

SOURCE_ANCESTOR CFs (chain between JOINT_SOURCE and rootSolid):
  ├── _worldPoseCache[cf.id]  ← re-propagated from new Solid kinematics
  └── cf.meshView             ← updatePosition, updateRotation, updateConnectionLine

rootSolid (Solid in JOINT_SOURCE's ancestor chain):
  ├── corners[]          ← rigid-body rotated around source CF pivot → translated
  ├── bodyRotation       ← premultiplied by dq (world-space delta quaternion)
  ├── meshView.updateGeometry
  └── meshView.updateBoxHelper
```

JOINT_TARGET CF is **read-only** for the constraint: only `_worldPoseCache[targetId]`
is consumed; target entity fields are never written by `_updateFastenedFrames()`.

---

## Robot roster — 0 / 1 / N robots (ADR-090)

**基数そのものが状態である**実体 (原則 #31)。`mode` や `status` と違って欄が無いため
状態に見えないが、遷移を誤ると事故になる (0 台のまま grasp を解く = 原点に立つ
無限リーチの幽霊ロボットで「候補が出た」と表示する) ので、クラスより先に確定した。

### 状態集合と遷移

```
                    ┌──── seed (新規 boot シーンのみ ─ ensureRobotFrames({seed:true})) ────┐
                    ▼                                                                      │
              ┌──────────┐   addRobot()      ┌────────────┐   addRobot()    ┌───────────┐
              │  none    │ ───────────────▶  │   single   │ ──────────────▶ │   multi   │
              │  (0 台)  │ ◀───────────────  │   (1 台)   │ ◀────────────── │  (N 台)   │
              └──────────┘  delete (要確認)  └────────────┘  delete (要確認) └───────────┘
                    │                              │                              │
   grasp: no-robot (理由つきで停止)      grasp: 暗黙に 1 台を選択     grasp: 明示選択が無ければ no-robot
```

- **権威**: scene (`objects` 内の base/tcp CoordinateFrame 対)。解決は
  `domain/robotFrames.js: resolveRobots()` の 1 箇所 (§1.1)。同一性は base フレームの
  **entity id** — 名前ではない (rename は label 変更にすぎない)。
- **禁止遷移**: **入口通過による none → single** (`importFromJson` / `loadScene` は
  upgrade のみ)。これを許すと台数の真実の源が scene から seed 規則へ戻り、
  ユーザーが削除した 0 台がテンプレ読込で復活する (ADR-090 §力学(4))。
  機械側の問い所は `src/RobotRosterAuthority.test.js` (seed 呼び出しの個数を数える)。
- **guard**: 各遷移の前提は名前付き述語に集約 (原則 #25) —
  `selectRobot(robots, selectedId)` が「どれのことか」を、
  `robotCardinality(robots)` が 0/1/N を返す。呼び出し側で数を数え直さない。
- **削除**: 0 台への遷移を含むため `Origin` のような無条件禁止ではなく **確認**
  (`showConfirmDialog` — 「無言で消える」だけを潰す)。undo は base+tcp を対で復元
  (`AddRobotCommand` / `DeleteCommand`)。

### 各ロボットの TF ロール (`CoordinateFrame.robotRole`)

```
world ──▶ base (robotRole:'base', parentId=null) ──▶ tcp (robotRole:'tcp', parentId=base.id)
```

- 1 台につき base ちょうど 1、tcp は `0..1` (tcp 不在も正当 — `tcpOrientation` を
  省いた要求は core/ が代替軸へフォールバックする。ADR-084 §3)。
- 書き手は `SceneService._setRobotRole()` の 1 箇所で、`robotRoleChanged` を発行する
  (Outliner の ROBOT バッジと grasp パネルの roster は購読側 — 原則 #5/#18)。
- レガシー経路: role 欄を持たない scene / DSL は名前 (`robot_base` + `parentId===null`)
  で 1 台だけ解決し、シーン入口で role を刻む (`_upgradeLegacyRobotFrames`) ので
  名前解決は移行ランプに留まる。

### grasp-search FSM への影響

`context.grasp` の判別 union に `no-robot` が加わった (7 状態)。`no-layout` の直後に
評価され、**BFF へは何も送らない**: 理由つき toast + パネルの gap 表示で止まる
(原則 #11 — 入力が消費されて何も起きない状態を作らない)。ワイヤ形状は ADR-084 の
単数 `robot { base, tcpOrientation }` のまま — 同一性はフロント側の関心なので
契約 (`packages/grasp-contract`) と `core/` は本 ADR で一切変わらない (原則 #29)。

---

## Commit observation metadata — 未刻印 / 刻印済 / 刻印不能 (ADR-092)

コミット 1 個が持つ観測トレーラ (`Model-Effort` / `Task-Class`) の有無。3 状態あるが
第 3 の状態は**不在の終端**なので状態に見えない (原則 #31) — 明示的に置く。

```
                  ┌──────────┐
   git commit ───▶│  未刻印   │
   (Claude)       └──────────┘
                    │      │
   PostToolUse hook │      │ 同一コマンド内で push 済み
   (amend --only)   │      │ (刻む隙間が無い ─ 恒久)
                    ▼      ▼
              ┌──────────┐  ┌────────────┐
              │  刻印済   │  │  刻印不能   │  ← report が母数として数える
              └──────────┘  └────────────┘
                    │
                    └── 再実行しても SHA 不動 (値が同じなら no-op = 冪等)
```

- **権威**: `.claude/hooks/commit-trailers.sh` の 1 箇所のみ (§1.1)。導出規則は
  `scripts/commit-meta.mjs` の純粋関数に置き、書き手 (hook) と読み手 (`report`) が
  同じ規則を**参照**する。二重実装すると遡及分類と新規分類が静かにズレる。
- **禁止遷移**: **公開済みコミットの刻印**。`git branch -r --contains HEAD` が非空なら
  何もしない — amend は SHA を変えるので、push 済みを書き換えると履歴が分岐する。
  安全側に倒した結果が「刻印不能」という終端状態であり、これは*失敗*ではなく
  **宣言された欠測**として `report` の母数に現れる。
- **guard**: rebase / merge 進行中・detached HEAD・マージコミット・直近 300 秒に
  新しいコミットが無い (= コマンド失敗) のいずれかで素通り。判定のどこかが失敗しても
  fail-open (統治の hook がユーザーの作業を壊さない)。
- **副作用の告知**: 刻印は SHA を変えるため、`additionalContext` と `systemMessage`
  で `before → after` を告げる (原則 #11 — 黙って変えない)。
- **人間のコミットは「未刻印」のまま正しい。** hook は Claude のツール呼び出しに
  だけ発火するので、トレーラの不在がそのまま帰属の情報になる。

---

## Related ADRs

- **ADR-002**: Two-step Sketch → Extrude workflow
- **ADR-004**: Edit Mode auto-dispatches on active object `instanceof` (dimension field removed in ADR-012)
- **ADR-008**: `setMode()` is the sole mode transition entry point
- **ADR-023**: Mobile input model — Pointer Events API, `_activeDragPointerId`, OrbitControls disable strategy
- **ADR-024**: Mobile toolbar architecture — fixed slot counts, `disabled` vs hidden, `{spacer: true}`
- **ADR-029**: Spatial annotation system — `AnnotatedLine/Region/Point`, `PlaceTypeRegistry`
- **ADR-030**: SpatialLink — typed semantic edges; `L` key two-phase creation flow
- **ADR-031**: Map Mode interaction model — `drawState`, PC vs Mobile platform split (ADR-073 collapsed the FSM to two states: immediate creation, no name form)
- **ADR-037**: Body Frame Architecture — Origin CF created atomically with Solid; TC proxy follows Origin CF world pose
- **ADR-090**: Robot roster — identity moved from the magic name to the entity (`robotRole`), 0/1/N cardinality as an explicit state, grasp gated on a resolved robot

---

## § Formal FSM Specification (Moore-Mealy Hybrid)

Runtime implementation of the app's Object Mode operation state machine.
**Status**: Implemented — `src/core/StateMachine.js` + `src/core/editorStates.js` (ADR-039).
**Runtime instance**: `AppController._opState` (`new StateMachine(S_OBJECT_IDLE, [...])`)
**State constants**: exported from `src/core/editorStates.js`

To add a new operation state:
1. Add state constant to `src/core/editorStates.js`
2. Add transitions `{ from: S_OBJECT_IDLE, on: 'BEGIN_X', to: S_X }` + CONFIRM/CANCEL rows to `_opState`
3. Follow the three-phase method contract (see ADR-039 §Method contract)
4. Document the new state in this section below

### Convention

- **Moore output**: always active while in that state (set on entry, held until exit).
- **Mealy action**: executed exactly once on a specific transition edge.
- **Guard format**: 2D array — outer array = OR (any row satisfies), inner array = AND (all conditions in the row must hold).
- Transition precedence: guards evaluated top-to-bottom; first matching transition fires.

### Object Mode — Primary Operations

```json
{
  "states": {
    "S_OBJECT_IDLE": {
      "outputs": {
        "selectionMode": "object",
        "orbitEnabled": true,
        "mobileToolbarSlots": "object-idle"
      }
    },
    "S_GRAB_ACTIVE": {
      "outputs": {
        "orbitEnabled": false,
        "grab.active": true,
        "mobileToolbarSlots": "grab"
      }
    },
    "S_ROTATE_ACTIVE": {
      "outputs": {
        "orbitEnabled": false,
        "rotate.active": true,
        "mobileToolbarSlots": "rotate"
      }
    },
    "S_FACE_EXTRUDE": {
      "outputs": {
        "orbitEnabled": false,
        "faceExtrude.active": true,
        "mobileToolbarSlots": "edit-3d"
      }
    },
    "S_MEASURE_PLACING": {
      "outputs": {
        "orbitEnabled": false,
        "measure.active": true,
        "mobileToolbarSlots": "measure"
      }
    },
    "S_LINK_MODE": {
      "outputs": {
        "spatialLinkMode.sourceId": "captured",
        "statusBar": "Click source CF, then target CF"
      }
    },
    "S_FRAME_PLACEMENT": {
      "outputs": {
        "cursor": "crosshair",
        "framePlacementState.parentId": "captured",
        "parentAxesOverlay.visible": true,
        "mobileToolbarSlots": "frame-placement"
      }
    },
    "S_MOUNT_PICKING": {
      "outputs": {
        "cursor": "crosshair",
        "mountPicking.sourceId": "captured",
        "statusBar": "Tap target frame (or empty space to cancel)"
      }
    }
  },
  "transitions": [
    {
      "from": "S_OBJECT_IDLE",
      "to": "S_GRAB_ACTIVE",
      "event": "keyG",
      "guard": [
        ["activeObj !== null", "NOT isFastenedSource(activeObj)"]
      ],
      "actions": {
        "grab.allStartCorners": "snapshot(_grabHandlesOf(activeObj))",
        "grab.segmentStartCorners": "snapshot(_grabHandlesOf(activeObj))",
        "grab.axis": "null",
        "grab.pivotSelectMode": "false",
        "grab.groundWarned": "false  // ADR-071: below-grade warning re-arms per gesture; stackMode NOT reset here (mobile Stack/Free toggles before start)"
      }
    },
    {
      "from": "S_GRAB_ACTIVE",
      "to": "S_OBJECT_IDLE",
      "event": "confirmGrab",
      "guard": [],
      "actions": {
        "commandStack.push": "createMoveCommand(allStartCorners, currentCorners)",
        "grab.stackMode": "true  // ADR-071: gesture end restores the assistive default (stack ON; ground plane = implicit landing surface)"
      }
    },
    {
      "from": "S_GRAB_ACTIVE",
      "to": "S_OBJECT_IDLE",
      "event": "keyEscape",
      "guard": [],
      "actions": {
        "activeObj.corners": "restore(grab.allStartCorners)"
      }
    },
    {
      "from": "S_OBJECT_IDLE",
      "to": "S_ROTATE_ACTIVE",
      "event": "keyR",
      "guard": [
        ["activeObj instanceof Solid", "NOT hasFastenedChild(activeObj.id)"]
      ],
      "actions": {
        "rotate.startCorners": "snapshot(activeObj.corners)",
        "rotate.pivot": "centroid(activeObj.corners)",
        "rotate.axis": "null",
        "rotate.isMobile": "false"
      }
    },
    {
      "from": "S_ROTATE_ACTIVE",
      "to": "S_OBJECT_IDLE",
      "event": "confirmRotate",
      "guard": [],
      "actions": {
        "commandStack.push": "createSolidRotateCommand(startCorners, currentCorners)",
        "_syncMobileTransformProxy": "call()"
      }
    },
    {
      "from": "S_ROTATE_ACTIVE",
      "to": "S_OBJECT_IDLE",
      "event": "keyEscape",
      "guard": [],
      "actions": {
        "activeObj.corners": "restore(rotate.startCorners)"
      }
    },
    {
      "from": "S_OBJECT_IDLE",
      "to": "S_LINK_MODE",
      "event": "keyL",
      "guard": [["activeObj !== null"]],
      "actions": {
        "spatialLinkMode.sourceId": "activeObj.id"
      }
    },
    {
      "from": "S_LINK_MODE",
      "to": "S_OBJECT_IDLE",
      "event": "targetSelected",
      "guard": [["sourceId !== targetId"]],
      "actions": {
        "showLinkTypePicker": "call(_computeLinkOptions(source, target))"
      }
    },
    {
      "from": "S_LINK_MODE",
      "to": "S_OBJECT_IDLE",
      "event": "keyEscape",
      "guard": [],
      "actions": {}
    },
    {
      "from": "S_OBJECT_IDLE",
      "to": "S_MEASURE_PLACING",
      "event": "keyM",
      "guard": [["selectionMode === 'object'"]],
      "actions": {
        "measure.active": "true",
        "measure.p1": "null",
        "measure.p2": "null"
      }
    },
    {
      "from": "S_MEASURE_PLACING",
      "to": "S_OBJECT_IDLE",
      "event": "pointerUp_p2Confirmed",
      "guard": [["measure.p1 !== null"]],
      "actions": {
        "commandStack.push": "createMeasureLineCommand(p1, p2)"
      }
    },
    {
      "from": "S_MEASURE_PLACING",
      "to": "S_OBJECT_IDLE",
      "event": "keyEscape",
      "guard": [],
      "actions": {
        "measure.active": "false"
      }
    },
    {
      "from": "S_OBJECT_IDLE",
      "to": "S_FRAME_PLACEMENT",
      "event": "_addCoordinateFrame",
      "guard": [["activeObj !== null"]],
      "actions": {
        "framePlacementState.parentId": "activeObj.id",
        "parentAxesOverlay": "show(geometryAncestorCentroid)",
        "cursor": "crosshair"
      }
    },
    {
      "from": "S_FRAME_PLACEMENT",
      "to": "S_OBJECT_IDLE",
      "event": "pointerDown_left",
      "guard": [["pickFramePlacementPoint() !== null"]],
      "actions": {
        "commandStack.push": "createCreateCoordinateFrameCommand(placedFrame)",
        "parentAxesOverlay.visible": false,
        "frameCursorGhost.visible": false,
        "cursor": "default"
      }
    },
    {
      "from": "S_FRAME_PLACEMENT",
      "to": "S_OBJECT_IDLE",
      "event": "keyEscape",
      "guard": [],
      "actions": {
        "parentAxesOverlay.visible": false,
        "frameCursorGhost.visible": false,
        "cursor": "default"
      }
    },
    {
      "from": "S_OBJECT_IDLE",
      "to": "S_MOUNT_PICKING",
      "event": "longPressContextMenu_mountOnFrame",
      "guard": [["activeObj instanceof AnnotatedLine|AnnotatedRegion|AnnotatedPoint"]],
      "actions": {
        "mountPicking.sourceId": "activeObj.id",
        "cursor": "crosshair"
      }
    },
    {
      "from": "S_MOUNT_PICKING",
      "to": "S_OBJECT_IDLE",
      "event": "pointerDown_hitCoordinateFrame",
      "guard": [["hit.obj instanceof CoordinateFrame"]],
      "actions": {
        "commandStack.push": "createMountAnnotationCommand(sourceId, targetId)",
        "cursor": "default"
      }
    },
    {
      "from": "S_MOUNT_PICKING",
      "to": "S_OBJECT_IDLE",
      "event": "keyEscape",
      "guard": [],
      "actions": {
        "cursor": "default"
      }
    }
  ]
}
```

### Notes on Guard Syntax

Guards use a 2-D array encoding:
- `[[A, B], [C]]` means `(A AND B) OR (C)`.
- `[]` means unconditional (always fires, subject to event match).

This mirrors IEC 61499-style state machine notation and the PLC structured text
convention used in the project's robotics integration context.

---

### Edit Mode — Operation States (`_editOpState`)

**Status**: Implemented — `AppController._editOpState` (`new StateMachine(EO_IDLE, [...])`)
**Handler classes**: `src/core/states/EndpointDragState.js`, `src/core/states/SketchDrawState.js`
**State constants**: `EO_IDLE`, `EO_1D_DRAG`, `EO_2D_SKETCH_DRAW` in `src/core/editorStates.js`

Parallel FSM to `_opState`, scoped to operations within Edit Mode.

```json
{
  "states": {
    "EO_IDLE": {
      "outputs": { "editDragActive": false }
    },
    "EO_1D_DRAG": {
      "outputs": {
        "editDragActive": true,
        "orbitEnabled": false,
        "cursor": "grabbing",
        "handler": "EndpointDragState"
      }
    },
    "EO_2D_SKETCH_DRAW": {
      "outputs": {
        "editDragActive": true,
        "orbitEnabled": false,
        "cursor": "crosshair",
        "handler": "SketchDrawState"
      }
    }
  },
  "transitions": [
    {
      "from": "EO_IDLE",
      "to": "EO_1D_DRAG",
      "event": "pointerDown_nearEndpoint",
      "guard": [["editSubstate === '1d'", "findNearestVertex() !== null"]],
      "actions": {
        "EndpointDragState.enter": "call(vertex, endpointIndex)",
        "controls.enabled": false,
        "cursor": "grabbing"
      }
    },
    {
      "from": "EO_1D_DRAG",
      "to": "EO_IDLE",
      "event": "pointerUp",
      "guard": [["activeDragPointerId === e.pointerId"]],
      "actions": {
        "EndpointDragState.confirm": "call() → push MoveCommand if moved",
        "controls.enabled": true,
        "cursor": "default"
      }
    },
    {
      "from": "EO_1D_DRAG",
      "to": "EO_IDLE",
      "event": "cancelEditMode",
      "guard": [],
      "actions": {
        "EndpointDragState.cancel": "call() → restore original corners",
        "controls.enabled": true
      }
    },
    {
      "from": "EO_IDLE",
      "to": "EO_2D_SKETCH_DRAW",
      "event": "pointerDown_onGroundPlane",
      "guard": [["editSubstate === '2d-sketch'", "groundPlane ray-hit succeeded"]],
      "actions": {
        "SketchDrawState.enter": "call() → sets sketch.p1/p2, disables controls",
        "controls.enabled": false
      }
    },
    {
      "from": "EO_2D_SKETCH_DRAW",
      "to": "EO_IDLE",
      "event": "pointerUp",
      "guard": [["activeDragPointerId === e.pointerId"]],
      "actions": {
        "SketchDrawState.confirm": "call() → obj.setRect() if rect large enough",
        "controls.enabled": true
      }
    },
    {
      "from": "EO_2D_SKETCH_DRAW",
      "to": "EO_IDLE",
      "event": "cancelEditMode",
      "guard": [],
      "actions": {
        "SketchDrawState.cancel": "call() → clears sketch.p1/p2",
        "controls.enabled": true
      }
    }
  ]
}
```

### Object Mode — Quick Drag and Rectangle Selection (`_opState` extensions)

`S_QUICK_DRAG` and `S_RECT_SELECT` are appended to the same `_opState` machine (source of truth: `AppController._opState`).

| State | Entry event | Confirm event | Cancel event | Handler class |
|---|---|---|---|---|
| `S_QUICK_DRAG` | `BEGIN_QUICK_DRAG` on pointerdown hitting an object (mouse only) | `CONFIRM` on pointerup **or** Enter key while SUGGESTING | `CANCEL` on mode exit | `QuickDragState` |
| `S_RECT_SELECT` | `BEGIN_RECT_SELECT` on pointerdown on empty space (mouse only) | `CONFIRM` on pointerup | `CANCEL` on second touch / mode exit | `RectSelectState` |

**Handler files**: `src/core/states/QuickDragState.js`, `src/core/states/RectSelectState.js`

**`QuickDragState` internal sub-states** (not tracked by `_opState`):

| Sub-state | Entry condition | Exit condition |
|-----------|----------------|----------------|
| DRAGGING | `enter()` | inference found → SUGGESTING |
| SUGGESTING | `inferSemanticRelationships()` returns a result | inference lost → DRAGGING; Enter key → confirm + link; pointerup → confirm (Phase 1 banner) |

Ghost `SpatialLinkView` + tooltip are shown in SUGGESTING and disposed on any exit (confirm, cancel, inference lost).
See ADR-041 for the full two-tier suggestion system.
