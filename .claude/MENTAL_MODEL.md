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
- **Concrete Rule**: Every mode must show a **fixed set** of buttons. Use `disabled: true` instead of hiding buttons that are temporarily unavailable.

| Mode | Buttons (always shown) |
|------|------------------------|
| Object | Add · Edit · Delete |
| Edit 2D | ← Object · Extrude |
| Edit 3D | ← Object · Vertex · Edge · Face |
| Grab active | ✓ Confirm · ✕ Cancel |

Face extrude on mobile is a gesture-only operation (tap → drag → release = confirm). No Extrude button is shown in Edit 3D.

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

### Unguarded JSON.parse in DB layer

- **Principle**: A single malformed row in the database causes an unhandled rejection that crashes the current WebSocket handler or request — with no error returned to the client.
- **Concrete Rule**: Any `JSON.parse(row.data)` call in `sceneStore.js` must be wrapped in `try/catch` and re-throw a structured error so callers receive a meaningful error object instead of a generic `SyntaxError`.

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
