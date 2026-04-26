# Mental Model: Architecture & State Management

Detail file for `docs/CODE_CONTRACTS.md` Section 1.

---

## Mode Transition Flow (ADR-008)

- **Principle**: State transitions must flow through a single source of truth to ensure thorough cleanup of the previous state and proper initialization of the next.
- **Concrete Rule**: `AppController.setMode(mode)` is the single entry point. Before calling `_switchActiveObject()`, always call `setMode('object')` first if `_selectionMode === 'edit'`. This guarantees in-progress operations are canceled and visual states (`setFaceHighlight(null)`, `clearExtrusionDisplay()`, `clearSketchRect()`) are cleared before the active object is swapped.

```js
// Correct pattern when switching active objects from any mode
if (this._selectionMode === 'edit') this.setMode('object')
// ... then _switchActiveObject(newId, true)
```

`setMode()` guarantees, in order:
1. Cancel in-progress operations (grab, rotate, face drag, object drag)
2. Clear active object visual state
3. Reset controller state (`_hoveredFace`, `_faceDragging`, `_dragFace`, `_cleanupEditSubstate()`)
4. Dispatch to new mode — `instanceof Sketch` -> Edit 2D, otherwise -> Edit 3D

## State Restoration on Mode Exit

- **Principle**: Temporary state changes made by a specific mode must be explicitly reverted when exiting that mode to prevent UI desync.
- **Concrete Rule**: `_objSelected` is set to `false` when entering Edit Mode. When returning to Object mode via `setMode('object')`, if `_activeObj` exists, you must manually restore `_objSelected = true` and call `meshView.setObjectSelected(true)`. Without this, the mobile toolbar's Edit and Delete buttons stay disabled.

```js
if (this._activeObj && !this._objSelected) {
  this._objSelected = true
  this._activeObj.meshView.setObjectSelected(true)
}
```

## Entity Capability Contracts (ADR-012, Phase 5-3)

- **Principle**: Determine available operations by the entity's class type, not a scalar property (like `dimension`). Immutable operations should return new instances and swap them in the model rather than mutating the original.
- **Concrete Rule**: `instanceof Sketch` = 2D unextruded; `instanceof Cuboid` = 3D. `Sketch.extrude(height)` does **not** mutate the Sketch — it returns a new `Cuboid` reusing the same `id`, `name`, and `meshView`. Call `SceneService.extrudeSketch(id, height)` to perform the swap in `SceneModel`.

  - `extrudeFace` signature: `(face: Face, savedFaceCorners, normal, dist)` — callers pass a `Face` object (`_dragFace`), not an index. `Face.index` is used where an index is still needed (e.g. `MeshView.setFaceHighlight`).
  - `Cuboid` must always have: `move()`, `extrudeFace(face, ...)`, `faces: Face[6]`, `edges: Edge[12]`.
  - `Sketch` only needs: `extrude(height)`, `rename(name)`, `sketchRect`.
  - `MeasureLine` holds two `THREE.Vector3` endpoints (`p1`, `p2`) and a `MeasureLineView`. It has no `vertices`/`edges`/`faces` graph and must be excluded from `collectSnapTargets` loops and `_hitAnyObject` raycasting (guard with `instanceof MeasureLine`). Edit Mode is blocked; **Grab (move) is allowed** — `corners` returns `[p1, p2]` and `move(startCorners, delta)` translates both endpoints. `MeasureLineView.updateGeometry([p1, p2])` calls `update(p1, p2)` to refresh the line and label. Pointer drag is not available (no `cuboid` raycasting surface); use G key.
  - `ImportedMesh` has a synthetic 8-corner AABB (`_corners8`, initialised from geometry bounding box by `SceneService` after `updateGeometryBuffers`). **Grab and pointer drag are allowed** — `move(startCorners, delta)` updates `_corners8`; `ImportedMeshView.updateGeometry(corners)` computes the centroid and sets `cuboid.position = centroid - originalCenter`. Edit Mode is blocked.
  - `CoordinateFrame` is a named reference frame child of any geometry object or another `CoordinateFrame` (ADR-018 Phase A, ADR-019 Phase B). It has no vertex/edge/face graph and no raycasting surface (`cuboid = null`). **Grab (G key) and Rotate (R key) are allowed.** `corners` returns `[this._worldPos]`; `move(startCorners, delta)` updates `_worldPos`; `CoordinateFrameView.updateRotation(quaternion)` applies the quaternion to the root `THREE.Group`. The animation loop processes frames in **topological order** (shallow before deep) so nested frame chains propagate in a single pass. `_rotate.startRot` saves the quaternion on R-key press; cancel restores it. Edit Mode, pointer drag, Ctrl+drag rotation, pivot selection, and stack mode remain blocked. `CoordinateFrameView` implements the full `MeshView` no-op interface (including `updateBoxHelper`). Deletion of a parent cascades recursively (`SceneService.deleteObject` calls itself for each child, `OutlinerView.removeObject` also recurses).
  - Ctrl+drag rotation and pivot selection (`_startPivotSelect`) are blocked for `ImportedMesh`, `MeasureLine`, and `CoordinateFrame` (no local vertex geometry to rotate/pivot).
  - The "no Edit Mode" guard applies to `setMode('edit')` for `ImportedMesh`, `MeasureLine`, and `CoordinateFrame`.

## Rect Selection Must Guard Against Null Cuboid

- **Principle**: `_finalizeRectSelection()` iterates over every object in the scene. Not all entities have a raycasting surface — `CoordinateFrame`, `MeasureLine`, `UrbanPolyline`, `UrbanPolygon`, and `UrbanMarker` all return `null` for `.cuboid`. Accessing `.visible` on `null` throws a `TypeError` that silently aborts rect selection entirely.
- **Concrete Rule**: Always use optional chaining `obj.meshView.cuboid?.visible` (not `.cuboid.visible`) in `_finalizeRectSelection`. Objects with `cuboid === null` produce `undefined`, which is falsy, so they are correctly skipped by the `continue`. The same pattern is already used in `_hitAnyObject` and `_findStackTarget`.

```js
// Correct
if (!obj.meshView.cuboid?.visible) continue
// Wrong — throws when an UrbanPolyline/UrbanPolygon/UrbanMarker is in the scene
if (!obj.meshView.cuboid.visible) continue
```

## MeasureLineView No-Op Interface Completeness

- **Principle**: Every method called via `_meshView` in `AppController` must exist on `MeasureLineView` (as a no-op if not applicable), or any code path that reaches it when a `MeasureLine` is active will throw `TypeError` and silently abort the handler.
- **Concrete Rule**: Whenever a new method is added to `MeshView` and called through `_meshView` in `AppController`, add the same method as a no-op `(){}` to `MeasureLineView`. The current required no-op list: `setFaceHighlight`, `clearExtrusionDisplay`, `clearSketchRect`, `clearVertexHover`, `clearEdgeHover`, `clearEditSelection`, `clearPivotDisplay`, `clearSnapDisplay`, `showSnapCandidates`, `showSnapLocked`, `clearSnapLocked`. Missing `showSnapCandidates`/`showSnapLocked`/`clearSnapLocked` caused a `TypeError` in `_onPointerMove` that prevented the preview guide from rendering on the second (and any subsequent) measure placement.

## Measure Snap Display Must Not Depend on Active MeshView

- **Principle**: Snap candidate display relies on `THREE.Points` objects owned by a specific `MeshView` instance. If the active object is a `MeasureLine`, `_meshView` returns `MeasureLineView` which has no such infrastructure — calling snap display methods on it is a no-op, so candidates are invisible.
- **Concrete Rule**: `_measure.snapMeshView` is set in `_startMeasurePlacement()` to a real `MeshView` (falls back to any non-`MeasureLine` object's view when the active object is a `MeasureLine`). All snap display calls during measure placement use `_measure.snapMeshView`, not `_meshView`. Clear `_measure.snapMeshView` (and call `clearSnapDisplay()` on it) in both `_cancelMeasure()` and `_confirmMeasurePoint()` Phase 2.

```js
// _startMeasurePlacement()
const activeObj = this._scene.activeObject
const _isSnapCapable = o => !(o instanceof MeasureLine) && !(o instanceof CoordinateFrame)
this._measure.snapMeshView = (activeObj && _isSnapCapable(activeObj))
  ? activeObj.meshView
  : ([...this._scene.objects.values()].find(_isSnapCapable)?.meshView ?? null)

// cleanup in _cancelMeasure() / _confirmMeasurePoint() Phase 2
this._measure.snapMeshView?.clearSnapDisplay()
this._measure.snapMeshView = null
```

## MeasureLineView Label Lifecycle

- **Principle**: HTML labels that overlay a Three.js canvas must be repositioned every animation frame because the camera may have moved.
- **Concrete Rule**: `MeasureLineView.updateLabelPosition()` must be called once per frame from the animation loop for every `MeasureLine` in the scene. The label uses `position: fixed` and is projected from world-space midpoint via `Vector3.project(camera)`. It is appended to `document.body` and removed in `dispose()`.

## CoordinateFrame Depth Rendering and Visibility Policy

- **Principle**: Gizmo-style objects (axes, labels) cause visual noise when always visible, and are buried inside parent geometry when idle. Frames should only appear when the user is actively working with them.
- **Concrete Rule — parent-gated visibility**: `CoordinateFrameView` is `visible = false` by default. `setParentSelected(true)` is called by `AppController._setChildFramesVisible()` whenever the parent object is selected; `setParentSelected(false)` hides it when the parent is deselected. `setParentSelected(true)` also applies X-ray (`depthTest: false`, `renderOrder: 1`) so the frame is always visible through the parent geometry.
- **Concrete Rule — self-selection highlight**: `setObjectSelected(selected)` ONLY changes the origin sphere color (gold `#ffcc00` + scale 1.6x when selected, white + 1.0x when not). It does NOT change `visible` or `depthTest` — those are managed by `showFull`/`showDimmed`/`hide`.
- **Visibility ownership table** (CoordinateFrame-specific):

| Trigger | Method | Effect |
|---------|--------|--------|
| Geometry parent selected | `showFull()` | visible + full opacity + X-ray |
| Frame selected (active frame in tree) | `showFull()` + `setObjectSelected(true)` | visible + full opacity + X-ray + gold sphere |
| Non-selected frame in same tree | `showDimmed()` | visible + 0.30 opacity + X-ray (de-emphasised) |
| Frame/geometry deselected | `hide()` | `visible = false` |
| Outliner eye icon | `setVisible(bool)` | `visible` on/off |
| Connection line (child -> parent frame) | `showConnection(dimmed)` / `hideConnection()` | dashed line between frame origins |

- **Frame tree visibility entry points** in `AppController`:
  - `_showGeometryFrameTree(geoId)` — called when a geometry object is selected. Collects ALL descendant CoordinateFrames via `_collectAllDescendantFrames`, calls `showFull()` on each, shows connection lines at full opacity. Stores IDs in `_activeFrameChain`.
  - `_showFrameChain(frameId)` — called when a CoordinateFrame is selected. Walks up to find the geometry root, then shows the entire frame tree: selected frame via `showFull()` (full opacity + gold sphere), all others via `showDimmed()` (0.30 opacity). Connection line to the selected frame is full opacity; all others are dimmed.
  - `_hideFrameChain()` — hides all frames in `_activeFrameChain` via `hide()` + `hideConnection()`. Called on deselect, switch, edit-mode entry.
  - `_setChildFramesVisible(parentId, visible)` — thin wrapper: `true` -> `_showGeometryFrameTree`, `false` -> `_hideFrameChain`.
- **No selection ring**: the orange wireframe selection sphere was removed. Selection state is conveyed solely by the depth override (arrows pop to the front when selected).
- **Axis label sprites** (`_labelX/Y/Z`): `THREE.Sprite` with `CanvasTexture` bearing the letter in the axis colour. Positioned at `AXIS_LENGTH + 0.09` along each axis so the letter sits just past the arrowhead. Must be included in the `depthTest`/`renderOrder` loop and their `material.map` must be disposed in `dispose()`.

## CoordinateFrame.localOffset vs Geometry.corners (PHILOSOPHY #21 Phase 3)

- **Principle**: Geometry entities (`Solid`, `ImportedMesh`, `Profile`, Urban*) expose `get corners()` returning `WorldVector3[]`. `CoordinateFrame` exposes `get localOffset()` returning `LocalVector3[]` — a single-element array wrapping `this.translation`. **`CoordinateFrame` has no `corners` property.** Accessing `.corners` on a frame returns `undefined`.
- **Why distinct names**: Phase 2 added JSDoc brands to distinguish the types at compile time. Phase 3 eliminates the shared property name so the API shape itself enforces the distinction — no branch, no annotation, no code review can accidentally treat `localOffset` as world space (PHILOSOPHY #21 Phase 3, PHILOSOPHY #2).
- **Grab / move**: use the `_grabHandlesOf(obj)` helper in `AppController.js` (returns `obj.localOffset` for frames, `obj.corners` for geometry). Do NOT call `.corners` on an object that might be a `CoordinateFrame`.
- **World position of a frame**: always read from `SceneService._worldPoseCache.get(id).position`. Never compute from `localOffset`.
- **`SceneService._updateWorldPoses()` and `createCoordinateFrame()`**: branch on `parent instanceof CoordinateFrame` to use the world pose cache for frame parents; use `parent.corners` centroid for geometry parents.

```js
// ✓ Correct — use world pose cache for frame parents; corners for geometry
if (parent instanceof CoordinateFrame) {
  parentWorldPos = this._worldPoseCache.get(parent.id).position  // true world position
} else {
  const centroid = new Vector3()
  for (const c of parent.corners) centroid.add(c)        // geometry corners = WorldVector3
  centroid.divideScalar(parent.corners.length)
  parentWorldPos = centroid
}

// ✓ Correct — grab handles (AppController)
const handles = _grabHandlesOf(selObj)    // localOffset for CF; corners for geometry
handles.forEach((c, i) => c.copy(saved[i]))

// ✗ Wrong — parent.corners is undefined when parent is a CoordinateFrame
const centroid = getCentroid(parent.corners)   // TypeError or wrong result
```

- **Ordering dependency**: `_updateWorldPoses()` topologically sorts frames (shallow first) before the loop so that when a child frame is processed its parent's world pose is already in `_worldPoseCache`. This invariant must be preserved if the loop structure is ever changed.

## CoordinateFrame Provenance and Role-Based Edit Access (ADR-034 §8)

- **Principle**: A frame declared by one stakeholder role must not be silently changed by another. Ownership is explicit via `frame.declaredBy`; violations show a toast.
- **Concrete Rule**: `CoordinateFrame.declaredBy` is `'modeller' | 'integrator' | null`. `null` = permissive (always editable). Before Grab, R-key, rename, or delete of a `CoordinateFrame`, the controller calls `RoleService.canEdit(frame)`. If it returns false, show `showToast('This frame was declared by a <role>. Switch to that role to edit it.', { type: 'warn' })` and return.
- `RoleService.getRole()` / `RoleService.setRole(role)` — module-level singleton. `null` = no role set (permissive mode).
- `window.__easyExtrude.setRole('modeller')` / `.getRole()` — console API (DevTools).
- **Serialisation**: `declaredBy` is included in scene JSON (backward-compatible: missing key → `null` on load).
- **Frame creation**: `createCoordinateFrame()` sets `frame.declaredBy = RoleService.getRole()` — null when no role is active.

## CoordinateFrame Scale Cap — maxWorldSize Must Always Be Finite

- **Principle**: CFs use constant-screen-size scaling (target: 80 px). Without an upper bound, the world-space axis length grows linearly with camera distance, making independent CFs visually dwarf all scene objects when the user zooms out.
- **Concrete Rule**: The animation loop in `AppController.start()` must **always** pass a finite `maxWorldSize` to `CoordinateFrameView.updateScale()`. When a CF has a solid geometry parent, `maxWS = parentBoundingRadius × 1.5`. When no solid parent exists, fall back to `sceneRadius × 0.3` (where `sceneRadius` = max `c.length()` across all `corners` in the scene), with a floor of `1.0` for empty scenes.

```js
// ✓ Correct — always finite
if (maxWS === Infinity) {
  maxWS = sceneRadius > 0 ? sceneRadius * 0.3 : 1.0
}
obj.meshView.updateScale(camera, renderer, maxWS)

// ✗ Wrong — passes Infinity for independent CFs; axes balloon to huge size at far zoom
obj.meshView.updateScale(camera, renderer, Infinity)
```

- `sceneRadius` is computed once per frame before the object iteration loop (not per-CF), from all objects whose `corners?.length > 0`.

## ~~Auto Origin Frame on 3D Object Creation~~ — Superseded by ADR-033

> **This contract is superseded by ADR-033 (CoordinateFrame Phase C).**
> The rule below describes the old behaviour. Do NOT follow it for new code.

~~**Principle**: Every 3D geometry object should have a visible origin coordinate frame so the user can immediately read its reference direction.~~
~~**Concrete Rule**: `SceneService.createCuboid()`, `SceneService.extrudeSketch()`, and `SceneService.duplicateCuboid()` each call `this.createCoordinateFrame(id, 'Origin')`.~~

**New rule (ADR-033)**: `CoordinateFrame` is an interface contract — it is created only
when a spatial relationship (SpatialLink) is being established, or when the user
explicitly adds a named reference point. `createCuboid()`, `extrudeSketch()`, and
`duplicateCuboid()` must NOT call `createCoordinateFrame()` automatically.

Existing scenes with auto-generated "Origin" frames are read back as-is (backward
compatibility). The migration step (removing the `createCoordinateFrame` calls) is
tracked in ADR-033 §Migration.

## Command Factory Naming Convention

- **Principle**: All commands are plain objects returned by factory functions, not class instances. The export name follows the `createXCommand` pattern. Importing with a class-style name (`XCommand`) will produce a build-time "not exported" error — but only at build time, not in the editor.
- **Concrete Rule**: Every file in `src/command/` exports a single function named `createXCommand`. Imports in `AppController.js` must use `{ createXCommand }` not `{ XCommand }`. Call sites use `createXCommand(...)` not `new XCommand(...)`. When adding a new command, verify both the export name in the command file and the import+call in `AppController.js` match before committing.

```js
// ✓ Correct
import { createSetLynchClassCommand } from '../command/SetLynchClassCommand.js'
const cmd = createSetLynchClassCommand(id, oldClass, newClass, service)

// ✗ Wrong — causes build error "not exported"
import { SetLynchClassCommand } from '../command/SetLynchClassCommand.js'
const cmd = new SetLynchClassCommand(id, oldClass, newClass, service)
```

## CommandStack: push() vs execute() — Post-Hoc Recording

- **Principle**: `CommandStack.execute(cmd)` calls `cmd.execute()` then pushes to the undo stack. Using it for a just-completed operation double-applies the effect.
- **Concrete Rule**: All `_confirm*()` handlers (Grab, FaceExtrude, Rotate, ExtrudePhase) and mutation helpers (`_deleteObject`, `_addObject`, `_renameObject`) complete the operation first via their own logic, then call `_commandStack.push(cmd)` to record it — **never** `_commandStack.execute(cmd)`. Use `execute()` only when the command is the single driver of the mutation (currently unused; reserved for future composite operations).

## Entity Swap Methods Must Emit Domain Events

- **Principle**: Any SceneService method that swaps one entity for another in `SceneModel` without going through `deleteObject`/`createXxx` bypasses event emission. Subscribers (OutlinerView, AppController) see stale state: the old entity's type icon persists, the new entity is invisible in the Outliner.
- **Concrete Rule**: Every method that calls `this._model.removeObject(id)` or `this._model.addObject(entity)` directly **must** also emit `this.emit('objectRemoved', id)` / `this.emit('objectAdded', entity)`. Currently affected: `extrudeProfile()` (fixed 2026-03-27), `detachObject()`, `reattachObject()`. New swap methods must follow the same pattern.

## Soft-Delete Pattern for Undo-Capable Deletion

- **Principle**: `SceneService.deleteObject()` calls `meshView.dispose()`, which destroys GPU resources and removes objects from the Three.js scene. Once disposed, a meshView cannot be restored without full reconstruction — making undo of delete impossible.
- **Concrete Rule**: `AppController._deleteObject()` uses `SceneService.detachObject()` (removes from SceneModel, clears worldPoseCache, emits `objectRemoved`, does NOT dispose) + `meshView.setVisible(false)`. The Three.js objects remain in the scene graph but invisible. `SceneService.deleteObject()` (dispose path) is now only called in two cases: (1) cascade-delete of child frames inside a `deleteObject` call itself; (2) `_clearScene()` which destroys everything. The `CommandStack.MAX=50` limit bounds the number of live-but-invisible meshViews to an acceptable constant.

## N Panel Read-Only Rows Must Render the Passed Value

- **Principle**: A display-layer function that ignores its data arguments and renders a hardcoded constant is a silent data-loss bug: the controller passes correct values but the UI always shows wrong ones.
- **Concrete Rule**: In `UIView.updateNPanelForFrame`, the `locked` branch of `locRow` and `rotRow` must pass the `val` argument through to `row()`, not substitute `0`. Example: `(ax, col, val) => row(ax, col, val)`, NOT `(ax, col, _v) => row(ax, col, 0)`. The Origin frame shows world position (non-zero) in the locked Location row; always derive displayed values from what the caller passes.

## Euler Angle Convention for CoordinateFrame (ADR-020)

- **Principle**: The project adopts ROS REP-103 conventions throughout. The world frame uses ROS axes (+X forward, +Y left, +Z up). Euler angle display for `CoordinateFrame` must use the same convention — **intrinsic ZYX = extrinsic XYZ = RPY** — not the Three.js default `'XYZ'` order.
- **Concrete Rule**: All `setFromQuaternion` / `Euler` calls for `CoordinateFrame` rotation display must use order `'ZYX'` (Three.js), which corresponds to intrinsic ZYX = extrinsic XYZ = ROS RPY. Using `'XYZ'` is wrong: it is intrinsic XYZ = extrinsic ZYX, and produces incorrect angle values.

```js
// WRONG — intrinsic XYZ, not ROS RPY
const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ')

// CORRECT — intrinsic ZYX = extrinsic XYZ = ROS RPY
const euler = new THREE.Euler().setFromQuaternion(q, 'ZYX')
```

Affected sites: `CoordinateFrame.js` JSDoc, `AppController.js` (two `setFromQuaternion` calls), `UIView.js` N-panel label (show "RPY" not "XYZ").

## Mouse-Driven Rotation Angle Sign Convention

- **Principle**: The direction mapping from screen-space cursor angle to 3D rotation must match user expectation: moving the cursor clockwise around the frame should rotate the frame in a visually consistent direction.
- **Concrete Rule**: In `_applyRotate()`, use `angle = this._rotate.startAngle - currentAngle` (NOT `currentAngle - startAngle`). The `atan2`-based `currentAngle` increases when the cursor moves CCW on screen; subtracting from `startAngle` inverts this so the physical rotation tracks the cursor correctly. This affects only the mouse-driven path; numeric input (`this._rotate.hasInput`) uses the parsed degree value directly and is unaffected.

```js
// WRONG — rotation appears reversed on screen
angle = currentAngle - this._rotate.startAngle

// CORRECT
angle = this._rotate.startAngle - currentAngle
```

## Visual State Ownership

- **Principle**: Each visual flag must have exactly one mutator function to prevent race conditions and scattered state updates.
- **Concrete Rule**: Never set `visible` flags in `MeshView` outside their designated owners:

| Element | Owner |
|---------|-------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

## Frame View Must Be Hidden Before Detach (Undo)

- **Principle**: A view that has been made visible (via `showFull()`) must be explicitly hidden before its entity is detached from the model; hiding cannot be deferred to `_hideFrameChain()` because `_hideFrameChain()` looks up entities via `_scene.getObject()`, which returns null after detach.
- **Concrete Rule**: In `AddSolidCommand.undo()`, call `meshView.hide()` and `meshView.hideConnection()` on each child `CoordinateFrame` **before** calling `sceneService.detachObject()`. The comment "frames are already invisible" was incorrect — a frame shown via `_showGeometryFrameTree()` (parent selected) remains visible after soft-detach unless explicitly hidden first.

```js
// WRONG — frame stays visible in the Three.js scene after undo
sceneService.detachObject(frame.id)

// CORRECT
frame.meshView.hide()
frame.meshView.hideConnection()
sceneService.detachObject(frame.id)
```

## Post-Hoc Command Push Requires Prior Service Call

- **Principle**: `CommandStack.push()` is post-hoc recording — it records an operation that has ALREADY been applied. The command's `execute()` is only called by `redo()`, never by `push()`.
- **Concrete Rule**: When UI callbacks (e.g. `onIfcClassChange`, `onLynchClassChange`) create commands and push them, the corresponding service method (`setIfcClass`, `setLynchClass`) must be called **before** `push()`. Calling `push(cmd)` without a prior service call results in a no-op: the domain object's field is never updated, no domain event is emitted, the outliner badge stays blank, and the N-panel reflects stale data.

```js
// WRONG — class is never applied to domain object
const cmd = createSetLynchClassCommand(id, old, newClass, service)
commandStack.push(cmd)

// CORRECT — apply first, then record for undo
service.setLynchClass(id, newClass)
const cmd = createSetLynchClassCommand(id, old, newClass, service)
commandStack.push(cmd)
```

## CommandStack Must Be Clear After Initialization

- **Principle**: The undo stack represents user-reversible actions. Auto-created initial state (the first solid placed on construction) is not a user action and must not appear in the undo history.
- **Concrete Rule**: After `_addObject()` and `setMode('object')` in the constructor, call `this._commandStack.clear()`. Without this, the Undo button is enabled immediately on load even though nothing has been done.

```js
// Constructor — end of setup
this._addObject()
this.setMode('object')
this._commandStack.clear()  // ← initial state is not undoable
```

## Urban Placement Confirm Must Not Auto-Select the New Entity

- **Principle**: After a placement workflow (urban, measure), the app must return to the pre-placement toolbar state so the user can immediately continue working. Auto-selecting the new entity transitions the toolbar to an entity-specific variant that may lack the Add button, trapping the user.
- **Concrete Rule**: `_confirmUrbanPlacement()` must NOT call `_switchActiveObject()` after creating the entity. The previous selection is preserved automatically; `_refreshObjectModeStatus()` and `_updateMobileToolbar()` at the end of the method restore the correct toolbar.

```js
// WRONG — selects new entity, changes toolbar to [Grab|Lynch|Delete|spacer]
const obj = this._service.createUrbanPolyline(points, undefined, renderer)
this._switchActiveObject(obj.id, true)

// CORRECT — entity added to scene/outliner; toolbar returns to initial object-mode slots
const obj = this._service.createUrbanPolyline(points, undefined, renderer)
// (no _switchActiveObject)
```

## _updateMouse Must Precede All Coordinate-Picking Handlers in _onPointerDown

- **Principle**: All pointer-position-dependent operations inside `_onPointerDown` must see the CURRENT event position, not the position from the last `pointermove`. On touch devices (mobile), `pointermove` does NOT fire before the first `pointerdown`, so `this._mouse` is stale at tap time.
- **Concrete Rule**: Call `this._updateMouse(e)` immediately after the `e.target !== renderer.domElement` guard — before any handler that uses `this._mouse` or calls `_urbanPickPoint()` / `_raycaster`. Failure to do this makes tap-to-place operations (e.g. urban entity placement) record points at the wrong world position, which causes entities to appear at origin or to not be created at all.

```js
if (e.target !== renderer.domElement) return
this._updateMouse(e)   // ← must be here, not further down
// ... rotate / grab / urban placement handlers follow
```

## TC Gizmo Must Be Force-Updated After Proxy Repositioning

- **Principle**: Three.js `TransformControls.attach()` stores the proxy reference but does NOT immediately reposition the gizmo. The gizmo only moves on the next render cycle when `TransformControlsGizmo.updateMatrixWorld()` runs. After `_attachMobileTransform()` repositions the proxy to a new object's world position, the gizmo remains at the previous object's position for one frame — visually separating TC from the new frame's origin.
- **Concrete Rule 1**: After `_tc.attach(proxy)` in `_attachMobileTransform()`, immediately call `_tc.getHelper().updateMatrixWorld()` to force the gizmo's internal `_worldPosition` to reflect the proxy's new matrix. Without this, TC rotates/translates relative to the wrong pivot for the first drag.
- **Concrete Rule 2**: `_syncMobileTransformProxy()` must call `_service._updateWorldPoses()` before reading `worldPoseOf()` when the active object is a `CoordinateFrame`. `MoveCommand.apply()` calls `invalidateWorldPose()` synchronously before `_syncMobileTransformProxy()` runs during undo/redo — leaving the cache empty. `worldPoseOf()` would return `null` and the fallback `new THREE.Vector3()` would snap the proxy to the world origin.
- **Concrete Rule 3**: `_toggleTcMode()` must call `_syncMobileTransformProxy()` after resetting the proxy quaternion to re-anchor the gizmo at the frame's current world position. Without this, switching Rotate↔Translate leaves TC internally anchored to a stale world position.
- **Concrete Rule 4**: `_onPointerDown` must raycast against `_tc.getHelper()` BEFORE `_hitAnyObject()` whenever the TC gizmo is attached (`this._tc?.object`). TC registers its own pointer listeners AFTER `_onPointerDown`, so `_tcDragging` is still `false` at the time `_onPointerDown` fires — the only reliable way to detect a gizmo hit is to raycast explicitly. Without this guard, the ray passes through TC handles (rotate ring, translate arrows) to hit objects behind them, causing `_switchActiveObject()` → `_attachMobileTransform()` → `tc.setMode()` to run — unintentionally switching the active object and the gizmo mode. **Critical**: Three.js `Mesh.raycast()` does NOT respect the `visible` flag, so invisible TC picker meshes (which extend far beyond the visual handles) intercept every tap on the object body even when no visible handle is present. The guard must filter hits to `visible = true` objects only: `if (tcHits.some(h => h.object.visible)) return`. Using `tcHits.length > 0` blocks all single-tap selection of regular Cuboids.
- **Concrete Rule 5**: `_attachMobileTransform()` must keep `_tcMode` in sync with the TC mode for ALL entity types. Previously only the `CoordinateFrame` branch set `_tcMode = 'rotate'`; the `else` branch set `tc.setMode('translate')` without updating `_tcMode`. Always set `_tcMode = 'translate'` alongside `tc.setMode('translate')`.

```js
// _attachMobileTransform() — force gizmo sync after attach
this._tc.attach(this._tcProxy)
this._tc.getHelper().updateMatrixWorld()   // ← required; without this, gizmo stays at old position

// _syncMobileTransformProxy() — flush world pose cache first
if (obj instanceof CoordinateFrame) this._service._updateWorldPoses()  // ← before worldPoseOf()
const centroid = this._service.worldPoseOf(obj.id)?.position?.clone() ?? new THREE.Vector3()

// _toggleTcMode() — re-anchor after mode switch
this._tcProxy.quaternion.identity()
this._syncMobileTransformProxy()           // ← refresh proxy position + gizmo internal state

// _onPointerDown — guard against TC gizmo hit before regular selection
if (this._tc?.object) {
  this._raycaster.setFromCamera(this._mouse, this._camera)
  const tcHits = this._raycaster.intersectObject(this._tc.getHelper(), true)
  // Filter to visible handles only — invisible pickers have visible=false but
  // Mesh.raycast() ignores visible, so they block selection of the object body.
  if (tcHits.some(h => h.object.visible)) return  // ← let TC handle its own pointer event
}
```

## HTML Overlay Views Must Use the Active Camera for Screen Projection

- **Principle**: `AppController.get _camera()` always returns the perspective camera (`SceneView.camera`). When Map mode activates the orthographic camera (`SceneView.activeCamera`), the renderer uses the ortho camera but views storing the old perspective camera reference will compute wrong screen positions.
- **Concrete Rule**: Any view that projects 3D positions to screen coordinates for HTML overlay positioning (e.g. `AnnotatedPointView.updateLabelPosition()`) must use the ACTIVE camera, not a stale stored reference. Call sites in the animation loop must pass `this._sceneView.activeCamera` explicitly: `obj.meshView.updateLabelPosition(this._sceneView.activeCamera)`. The same applies to `MeasureLineView` if it is ever used alongside Map mode's orthographic camera.
- **Root bug**: `AnnotatedPointView` stored `this._camera` (perspective camera) at construction time. In Map mode the ortho camera was used for rendering, but labels were projected with the perspective camera → labels appeared at wrong screen positions relative to the rendered 3D markers.

## CoordinateFrame Tap Selection Requires _hitAnyCoordinateFrame Fallback

- **Principle**: `_hitAnyObject()` filters candidates by `o.meshView.cuboid?.visible`. `CoordinateFrame.cuboid` returns `null`, so frames are never hit by this method. `_hitAnyAnnotation()` also skips frames. Without a dedicated fallback, tapping a visible frame axis on mobile never calls `_switchActiveObject()` and TC never appears.
- **Concrete Rule**: `_onPointerDown` must call `_hitAnyCoordinateFrame()` as a third fallback after `_hitAnyAnnotation()`. `CoordinateFrameView` exposes a `get group()` getter (returns `this._group`); `_hitAnyCoordinateFrame()` iterates over all `CoordinateFrame` entities, skips those with `!obj.meshView?.group?.visible`, and raycasts `intersectObject(group, true)` to find the nearest hit. Only frames that are currently shown (via `showFull()` or `showDimmed()`) are considered.

## _promptAddFrame Must Select Frame After Creation

- **Principle**: `CoordinateFrameView._group.visible` defaults to `false`. A frame only becomes visible when `_showFrameChain()` or `_setChildFramesVisible()` calls `showFull()` / `showDimmed()`. These are only called from `_switchActiveObject()`.
- **Concrete Rule**: After `this._commandStack.push(...)` in `_promptAddFrame()`, always call `this._switchActiveObject(frame.id, true)`. Without this, the frame is soft-created in the model and shown in the outliner (via `objectAdded` event), but remains permanently invisible in the 3D viewport and TC is never attached. Match the pattern from `_confirmFramePlacement()` including proper undo/redo callbacks: undo → restore parent selection; redo → `_switchActiveObject(id, true)`.

```js
// _promptAddFrame() — correct pattern
this._commandStack.push(createCreateCoordinateFrameCommand(frame, this._service,
  () => {
    const parent = this._scene.getObject(parentId)
    if (parent) this._switchActiveObject(parentId, true)
    else { this._objSelected = false; this._selectedIds.clear(); ... }
    this._updateNPanel()
  },
  (id) => { this._switchActiveObject(id, true); this._updateNPanel() },
))
this._switchActiveObject(frame.id, true)  // ← make frame visible + attach TC
```
