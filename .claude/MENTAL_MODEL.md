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

> Do NOT add: general best practices, things already obvious from the code,
> or temporary notes about in-progress work (use a task/plan for those).

### When to update

| Trigger | Action |
|---------|--------|
| A bug was caused by violating an implicit rule | Add the rule here |
| A new ADR establishes a coding contract | Summarize the contract here, link the ADR |
| An existing rule turns out to be wrong or too narrow | Update or remove it |
| A rule is already enforced by the code itself (e.g. type system) | Remove it — code is the source of truth |

### How to update

1. Add/edit the relevant section below using the **Principle + Concrete Rule** format.
2. Commit together with the code change that motivated it.
3. If the rule is substantial, create an ADR first and link it here.

---

## 1. Architecture & State Management

### Mode Transition Flow (ADR-008)

- **Principle**: State transitions must flow through a single source of truth to ensure thorough cleanup of the previous state and proper initialization of the next.
- **Concrete Rule**: `AppController.setMode(mode)` is the single entry point. Before calling `_switchActiveObject()`, always call `setMode('object')` first if `_selectionMode === 'edit'`. This guarantees in-progress operations are canceled and visual states (`setFaceHighlight(null)`, `clearExtrusionDisplay()`, `clearSketchRect()`) are cleared before the active object is swapped.

```js
// Correct pattern when switching active objects from any mode
if (this._selectionMode === 'edit') this.setMode('object')
// ... then _switchActiveObject(newId, true)
```

`setMode()` guarantees, in order:
1. Cancel in-progress operations (grab, face drag, object drag)
2. Clear active object visual state
3. Reset controller state (`_hoveredFace`, `_faceDragging`, `_dragFace`, `_cleanupEditSubstate()`)
4. Dispatch to new mode — `instanceof Sketch` → Edit 2D, otherwise → Edit 3D

### State Restoration on Mode Exit

- **Principle**: Temporary state changes made by a specific mode must be explicitly reverted when exiting that mode to prevent UI desync.
- **Concrete Rule**: `_objSelected` is set to `false` when entering Edit Mode. When returning to Object mode via `setMode('object')`, if `_activeObj` exists, you must manually restore `_objSelected = true` and call `meshView.setObjectSelected(true)`. Without this, the mobile toolbar's Edit and Delete buttons stay disabled.

```js
if (this._activeObj && !this._objSelected) {
  this._objSelected = true
  this._activeObj.meshView.setObjectSelected(true)
}
```

### Entity Capability Contracts (ADR-012, Phase 5-3)

- **Principle**: Determine available operations by the entity's class type, not a scalar property (like `dimension`). Immutable operations should return new instances and swap them in the model rather than mutating the original.
- **Concrete Rule**: `instanceof Sketch` = 2D unextruded; `instanceof Cuboid` = 3D. `Sketch.extrude(height)` does **not** mutate the Sketch — it returns a new `Cuboid` reusing the same `id`, `name`, and `meshView`. Call `SceneService.extrudeSketch(id, height)` to perform the swap in `SceneModel`.

  - `extrudeFace` signature: `(face: Face, savedFaceCorners, normal, dist)` — callers pass a `Face` object (`_dragFace`), not an index. `Face.index` is used where an index is still needed (e.g. `MeshView.setFaceHighlight`).
  - `Cuboid` must always have: `move()`, `extrudeFace(face, ...)`, `faces: Face[6]`, `edges: Edge[12]`.
  - `Sketch` only needs: `extrude(height)`, `rename(name)`, `sketchRect`.
  - `MeasureLine` holds two `THREE.Vector3` endpoints (`p1`, `p2`) and a `MeasureLineView`. It has no `vertices`/`edges`/`faces` graph and must be excluded from `collectSnapTargets` loops and `_hitAnyObject` raycasting (guard with `instanceof MeasureLine`). Edit Mode is blocked; **Grab (move) is allowed** — `corners` returns `[p1, p2]` and `move(startCorners, delta)` translates both endpoints. `MeasureLineView.updateGeometry([p1, p2])` calls `update(p1, p2)` to refresh the line and label. Pointer drag is not available (no `cuboid` raycasting surface); use G key.
  - `ImportedMesh` has a synthetic 8-corner AABB (`_corners8`, initialised from geometry bounding box by `SceneService` after `updateGeometryBuffers`). **Grab and pointer drag are allowed** — `move(startCorners, delta)` updates `_corners8`; `ImportedMeshView.updateGeometry(corners)` computes the centroid and sets `cuboid.position = centroid − originalCenter`. Edit Mode is blocked.
  - Ctrl+drag rotation and pivot selection (`_startPivotSelect`) are blocked for both `ImportedMesh` and `MeasureLine` (no local vertex geometry to rotate/pivot).
  - The "no Edit Mode" guard (`instanceof ImportedMesh || instanceof MeasureLine`) applies only to `setMode('edit')`.

### MeasureLineView No-Op Interface Completeness

- **Principle**: Every method called via `_meshView` in `AppController` must exist on `MeasureLineView` (as a no-op if not applicable), or any code path that reaches it when a `MeasureLine` is active will throw `TypeError` and silently abort the handler.
- **Concrete Rule**: Whenever a new method is added to `MeshView` and called through `_meshView` in `AppController`, add the same method as a no-op `(){}` to `MeasureLineView`. The current required no-op list: `setFaceHighlight`, `clearExtrusionDisplay`, `clearSketchRect`, `clearVertexHover`, `clearEdgeHover`, `clearEditSelection`, `clearPivotDisplay`, `clearSnapDisplay`, `showSnapCandidates`, `showSnapLocked`, `clearSnapLocked`. Missing `showSnapCandidates`/`showSnapLocked`/`clearSnapLocked` caused a `TypeError` in `_onPointerMove` that prevented the preview guide from rendering on the second (and any subsequent) measure placement.

### Measure Snap Display Must Not Depend on Active MeshView

- **Principle**: Snap candidate display relies on `THREE.Points` objects owned by a specific `MeshView` instance. If the active object is a `MeasureLine`, `_meshView` returns `MeasureLineView` which has no such infrastructure — calling snap display methods on it is a no-op, so candidates are invisible.
- **Concrete Rule**: `_measure.snapMeshView` is set in `_startMeasurePlacement()` to a real `MeshView` (falls back to any non-`MeasureLine` object's view when the active object is a `MeasureLine`). All snap display calls during measure placement use `_measure.snapMeshView`, not `_meshView`. Clear `_measure.snapMeshView` (and call `clearSnapDisplay()` on it) in both `_cancelMeasure()` and `_confirmMeasurePoint()` Phase 2.

```js
// _startMeasurePlacement()
const activeObj = this._scene.activeObject
this._measure.snapMeshView = (activeObj && !(activeObj instanceof MeasureLine))
  ? activeObj.meshView
  : ([...this._scene.objects.values()].find(o => !(o instanceof MeasureLine))?.meshView ?? null)

// cleanup in _cancelMeasure() / _confirmMeasurePoint() Phase 2
this._measure.snapMeshView?.clearSnapDisplay()
this._measure.snapMeshView = null
```

### MeasureLineView Label Lifecycle

- **Principle**: HTML labels that overlay a Three.js canvas must be repositioned every animation frame because the camera may have moved.
- **Concrete Rule**: `MeasureLineView.updateLabelPosition()` must be called once per frame from the animation loop for every `MeasureLine` in the scene. The label uses `position: fixed` and is projected from world-space midpoint via `Vector3.project(camera)`. It is appended to `document.body` and removed in `dispose()`.

### Visual State Ownership

- **Principle**: Each visual flag must have exactly one mutator function to prevent race conditions and scattered state updates.
- **Concrete Rule**: Never set `visible` flags in `MeshView` outside their designated owners:

| Element | Owner |
|---------|-------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

---

## 2. Events & Interaction (Touch/Pointer)

### Touch vs. Pointer Event Asymmetry

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

### Gesture-Based Interaction Priority (Mobile)

- **Principle**: Mobile interactions should prioritize combined gesture flows (tap + drag) over multi-step button clicks for primary spatial actions.
- **Concrete Rule**: On mobile (`innerWidth < 768`), tapping a face in Edit 3D auto-starts extrude. In `_onPointerDown`, after `_handleEditClick`, call `_startFaceExtrude(face)` and set `_activeDragPointerId`. The auto-start fires only when: `editSubstate === '3d'`, `_editSelectMode === 'face'`, `!e.shiftKey`, and at least one Face is in `editSelection` after the click. Face extrude is a gesture-only operation — there is no Extrude toolbar button in Edit 3D.

### Interaction Confirmation Lifecycle

- **Principle**: Continuous drag interactions must lock in their final value on release (`pointerup`), not on initial touch (`pointerdown`), to correctly capture the movement delta.
- **Concrete Rule**: `_confirmFaceExtrude()` belongs in `_onPointerUp`. Only confirm if `_activeDragPointerId === e.pointerId` (meaning a canvas drag actually occurred). This prevents double-confirms when the user taps toolbar buttons. Do **not** move confirm back to `_onPointerDown`.

```js
const wasDragging = this._activeDragPointerId === e.pointerId
if (wasDragging) this._activeDragPointerId = null
if (this._faceExtrude.active && wasDragging) { this._confirmFaceExtrude(); return }
```

### Global Event vs. UI Event Delegation

- **Principle**: Global `window` listeners must explicitly ignore pointer events originating from UI overlays to avoid intercepting and canceling clicks meant for buttons.
- **Concrete Rule**: In `_onPointerDown`, immediately check `if (e.target !== this._sceneView.renderer.domElement) return` before processing grabs or extrudes. This guard goes **before** the grab/faceExtrude active checks so that toolbar button taps fall through to their own `click` listeners. Without this, `_handleEditClick` fires on every toolbar tap and clears face/vertex/edge selection before the button's `click` handler runs.

```js
if (e.target !== this._sceneView.renderer.domElement) return
```

### Input Method Mutually Exclusive States

- **Principle**: Only disable global camera controls when a specific operation fully consumes the same input gesture (e.g. single-finger drag).
- **Concrete Rule**: Do **not** set `_controls.enabled = false` for rect selection. Rect selection uses 1-finger/left-click; Orbit uses 2-finger/right-click — they are mutually exclusive inputs. Cancel rect selection only if a second touch arrives, then clear `_activeDragPointerId` so OrbitControls can take over the two-finger gesture. Only `_objDragging` and `_sketch.drawing` legitimately need `_controls.enabled = false`.

---

## 3. UI & Layout Adaptability

### Mobile Toolbar Stability

- **Principle**: Mobile UI elements must maintain consistent layout dimensions and button placements to prevent misclicks caused by layout shifts during state changes.
- **Concrete Rule**: Every mode must show exactly **4 slots** (the width of Edit 3D, the widest mode). Within a mode, use `disabled: true` for temporarily unavailable actions. For modes that have fewer than 4 actions, pad with `{ spacer: true }` invisible placeholders so the total slot count stays 4 and the toolbar width never changes.

| Mode | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
|------|--------|--------|--------|--------|
| Object | Add | Edit | Delete | Stack |
| Edit 2D sketch | ← Object | Extrude | *(spacer)* | *(spacer)* |
| Edit 2D extrude | Confirm | Cancel | *(spacer)* | *(spacer)* |
| Edit 3D | ← Object | Vertex | Edge | Face |
| Grab active | Confirm | Stack | Cancel | *(spacer)* |

`{ spacer: true }` renders as a `visibility: hidden` div of identical dimensions. It occupies layout space without being tappable.

Grab, Edit, and Stack are disabled for `ImportedMesh` and `MeasureLine`. Delete remains enabled for all object types including `MeasureLine`. All four Object-mode slots maintain consistent disabled states so slot positions never shift.

The Object-mode Stack button pre-sets `_grab.stackMode` before a grab gesture. `_startGrab()` does not reset `stackMode`, so the pre-set is respected. `_confirmGrab()` and `_cancelGrab()` reset it to `false` when the grab ends.

Face extrude on mobile is a gesture-only operation (tap → drag → release = confirm). No Extrude button is shown in Edit 3D.
Grab on mobile is also a gesture (touch object → drag) — no toolbar button needed. Stack is an explicit constraint mode, so it has a dedicated toolbar button (Object mode: pre-grab toggle; Grab active mode: mid-grab toggle).

### Measure Point Placement (Mobile: Hold-to-Snap, Release-to-Confirm)

- **Principle**: On touch devices, placement of a single point requires the user to see snap feedback before committing. A tap-and-release offers no time to adjust; hold-and-release does.
- **Concrete Rule**: Measure point confirmation happens in `_onPointerUp`, not `_onPointerDown`. On `pointerdown`, set `_measure.pressing = true` and `_activeDragPointerId`. On `pointerup`, if `_measure.pressing && _activeDragPointerId === e.pointerId`, call `_confirmMeasurePoint()`. During the hold, `_onPointerMove` continues updating snap candidates so the user sees live snap feedback. `_cancelMeasure()` also resets `pressing = false`.

### Stack Mode (Grab)

- **Principle**: When stacking objects, the Z position should be determined by what is physically below the grabbed object, not by cursor height.
- **Concrete Rule**: Stack mode is toggled with **S** during grab (or the Stack toolbar button on mobile). When active, `_applyStackSnap()` runs after the normal movement each frame — both during `_grab.active` (G-key path) **and** during `_objDragging` (touch-drag path). It casts downward rays (`(0,0,-1)`) from **Z=10000** (not from the object's current bottom) from the 4 bottom-face corners + centroid, and finds the highest surface among non-grabbed objects. `zOffset = highestHitZ - gZMin`; if `|zOffset| >= 0.001`, all selected objects' vertex Z is shifted by `zOffset` so the bottom face rests exactly on that surface. The `_grab.stacking` flag tracks whether a snap surface was found this frame.
- **Why ray origin must be HIGH_Z**: casting from `gZMin + ε` misses surfaces whose top face is *above* the grabbed object's current bottom (e.g. target is taller than where we're dragging from). Starting from Z=10000 ensures the ray finds the topmost surface at (x,y) regardless of current object height.
- **Why _objDragging path**: on mobile, touch-dragging an object uses `_objDragging`, not `_grab.active`. Stack snap must be called in both paths or it silently does nothing on mobile.

### Viewport-Aware Z-Index and Positioning

- **Principle**: Floating UI elements must dynamically adjust their spatial positioning to avoid colliding with or being hidden behind device-specific layouts (like mobile toolbars).
- **Concrete Rule**: The mobile floating toolbar's top edge is at **86px** from the bottom (`bottom: 26px` + `height: 60px`). `showToast()` must check `_isMobile()` and set `bottom: 96px` (instead of the desktop `64px`) so it appears above the toolbar. If the toolbar height or position changes, update both the toolbar CSS and this constant together.

```js
const bottomPx = this._isMobile() ? '96px' : '64px'
```

On mobile, status text is shown in the footer info bar (`_infoEl`) instead of the header or canvas pill, because the mobile header is too narrow and keyboard hints are irrelevant on touch. `setStatus()` and `setStatusRich()` update `_infoEl` on mobile; `_setInfoText()` is a no-op on mobile. The `_canvasStatusEl` pill is always hidden (the footer replaces it on mobile; the header status replaces it on desktop). The Nodes button (`_nodeEditorBtn`) is desktop-only and hidden on mobile. The N-panel toggle button (`_nToggleBtn`) uses `marginLeft: auto` on mobile to stay right-aligned in the header.

---

## 3.5 Server-Side Async (Node.js BFF)

### All DB calls must be awaited

- **Principle**: Async DB operations that are called without `await` silently return a Promise, not the data. The caller then operates on a Promise object, causing crashes (JSON.parse of an object) or silent data loss.
- **Concrete Rule**: Every call to `sceneStore.getScene()`, `sceneStore.updateScene()`, `sceneStore.createScene()`, and `sceneStore.deleteScene()` **must** be `await`ed. Functions that call these must themselves be declared `async`. Fire-and-forget wrappers (like `_autosave`) must be `async` and must wrap all `await` calls in `try/catch` so that the caller's promise chain is never rejected unexpectedly.

```js
// WRONG — row is a Promise object, not scene data
const row = getScene(sceneId)
JSON.parse(row.data)  // throws — row.data is undefined

// CORRECT
const row = await getScene(sceneId)
```

### PRAGMA journal_mode Must Not Run Inside a Transaction

- **Principle**: `@libsql/client`'s `db.batch()` wraps all statements in a transaction. SQLite forbids switching journal mode (`PRAGMA journal_mode = WAL`) from within a transaction, so including the PRAGMA in `batch()` causes a `LibsqlBatchError` at startup.
- **Concrete Rule**: Always `await db.execute('PRAGMA journal_mode = WAL')` as a standalone call *before* any `db.batch()`. Schema-creation DDL (`CREATE TABLE IF NOT EXISTS`) is safe inside `batch()`.

```js
// WRONG — throws LibsqlBatchError on startup
await db.batch(['PRAGMA journal_mode = WAL', 'CREATE TABLE IF NOT EXISTS ...'], 'write')

// CORRECT
await db.execute('PRAGMA journal_mode = WAL')
await db.batch(['CREATE TABLE IF NOT EXISTS ...'], 'write')
```

### Unguarded JSON.parse in DB layer

- **Principle**: A single malformed row in the database causes an unhandled rejection that crashes the current WebSocket handler or request — with no error returned to the client.
- **Concrete Rule**: Any `JSON.parse(row.data)` call in `sceneStore.js` must be wrapped in `try/catch` and re-throw a structured error so callers receive a meaningful error object instead of a generic `SyntaxError`.

### occt-import-js Geometry Structure

- **Principle**: `mesh.faces` in the occt-import-js result is **face-group metadata** (index ranges + per-face colour), not per-face geometry buffers. Accessing `face.position?.array` on these entries always returns `undefined`, silently producing zero vertices while the mesh count appears non-zero.
- **Concrete Rule**: Extract geometry at the **mesh level**, not the face level:
  ```js
  const pos = mesh.attributes?.position?.array ?? []  // Float32Array
  const nrm = mesh.attributes?.normal?.array   ?? []  // Float32Array
  const idx = mesh.index?.array                ?? []  // Uint32Array
  ```
  Use `mesh.faces` only for per-face colour/material lookups. Never use `push(...typedArray)` for large arrays — iterate with a `for` loop to avoid "Maximum call stack size exceeded".

### Camera Far Clip and Fit for Imported Geometry

- **Principle**: The default camera `far = 100` is sized for hand-built voxel scenes. STEP files from real CAD tools routinely have bounding sphere radii in the hundreds or thousands of units (mm-scale parts). Geometry beyond `far` is clipped and invisible with no error.
- **Concrete Rule**: After any `updateGeometryBuffers` call for an `ImportedMesh`, call `SceneView.fitCameraToSphere(sphere.center, sphere.radius)` to reposition the camera and dynamically expand `camera.far` to `max(current far, dist×2 + radius×4)`. The trigger is the `geometryApplied` event emitted by `SceneService`. Never hard-code `camera.far` — let `fitCameraToSphere` expand it on demand.

---

## 4. Memory Management (Three.js)

### WsChannel Native Event Listener Cleanup

- **Principle**: Native `WebSocket.addEventListener` callbacks are not automatically removed when the socket is closed, so re-opening a channel without removing old listeners causes two handlers to fire for every server message.
- **Concrete Rule**: In `WsChannel._connect()`, save each bound handler as an instance property (`_onWsOpen`, `_onWsMessage`, `_onWsClose`, `_onWsError`). In `close()`, call `this._ws.removeEventListener(...)` for all four before calling `this._ws.close()`. Set `this._ws = null` after closing.

### Read-Only Entity Early-Return Must Show Feedback

- **Principle**: When an operation is silently blocked for a read-only entity type (`ImportedMesh`), the user sees no indication that the shortcut was consumed. This breaks the "shortcut → visible effect" contract.
- **Concrete Rule**: Any early-return that blocks `setMode('edit')` or `_startGrab()` for `ImportedMesh` must call `this._uiView.showToast('Imported geometry is read-only')` before returning. The Tab key handler must additionally guard `e.preventDefault()` so the browser's own Tab behavior is not suppressed when no mode transition occurs.

### Object Lifecycle Symmetry

- **Principle**: Every dynamic memory allocation or scene addition must have a strictly enforced, symmetrical teardown in its disposal method to prevent memory leaks and ghost objects.
- **Concrete Rule**: In `MeshView`, every `scene.add()` or `new THREE.BufferGeometry()` in the constructor MUST have a matching `scene.remove()` and `.dispose()` in `dispose()`. Missing this breaks `SceneService.deleteObject()` — if `dispose()` throws (e.g. accessing a renamed property that is now `undefined`), `removeObject()` and `emit('objectRemoved')` never run, leaving the object in the model (outliner intact, snap candidates still active) while only the main mesh is visually removed. Whenever you add a new Three.js object in the constructor, add the teardown in the same commit.
