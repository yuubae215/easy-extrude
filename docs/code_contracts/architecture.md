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

  - `extrudeFace` signature: `(face: Face, savedLocalFaceCorners, localNormal, dist)` — callers pass a `Face` object (`_dragFace`), not an index; `savedLocalFaceCorners` are body-frame (local) corner snapshots and `localNormal` is the face normal de-rotated by `orientation.invert()` (ADR-040). `Face.index` is used where an index is still needed (e.g. `MeshView.setFaceHighlight`).
  - `Cuboid` must always have: `move()`, `extrudeFace(face, ...)`, `faces: Face[6]`, `edges: Edge[12]`.
  - `Sketch` only needs: `extrude(height)`, `rename(name)`, `sketchRect`.
  - `MeasureLine` holds two `THREE.Vector3` endpoints (`p1`, `p2`) and a `MeasureLineView`. It has no `vertices`/`edges`/`faces` graph and must be excluded from `collectSnapTargets` loops and `_hitAnyObject` raycasting (guard with `instanceof MeasureLine`). Edit Mode is blocked; **Grab (move) is allowed** — `corners` returns `[p1, p2]` and `move(startCorners, delta)` translates both endpoints. `MeasureLineView.updateGeometry([p1, p2])` calls `update(p1, p2)` to refresh the line and label. Pointer drag is not available (no `cuboid` raycasting surface); use G key.
  - `ImportedMesh` has a synthetic 8-corner AABB (`_corners8`, initialised from geometry bounding box by `SceneService` after `updateGeometryBuffers`). **Grab and pointer drag are allowed** — `move(startCorners, delta)` updates `_corners8`; `ImportedMeshView.updateGeometry(corners)` computes the centroid and sets `cuboid.position = centroid - originalCenter`. Edit Mode is blocked.
  - `CoordinateFrame` is a named reference frame child of any geometry object or another `CoordinateFrame` (ADR-018 Phase A, ADR-019 Phase B). It has no vertex/edge/face graph and no raycasting surface (`cuboid = null`). **Grab (G key) and Rotate (R key) are allowed.** `cf.translation` and `cf.rotation` are **parent-local** (ROS TF / URDF style); world pose is derived each frame by `_updateWorldPoses()` using forward kinematics (`worldPos = parentWorldPos + parentWorldQuat * translation`, `worldQuat = parentWorldQuat * rotation`). `localOffset` returns `[this.translation]` as the grab handle; `move(startHandles, localDelta)` adds a parent-local delta (callers must convert world delta via `worldDelta.applyQuaternion(parentWorldQuat.conjugate())`). `CoordinateFrameView.updateRotation(worldQuat)` applies the world quaternion. The animation loop processes frames in **topological order** (shallow before deep). R-key rotation stores/restores local quaternion; `_applyRotate` uses change-of-basis: `newLocalRot = parentWorldQuat⁻¹ * deltaQ * parentWorldQuat * startLocalRot`. `Solid.orientation` (= `Solid.bodyRotation` alias for backward compat) serves as the parent world quaternion for direct children so they follow Solid R-key rotation automatically via `_updateWorldPoses()`. Edit Mode, pointer drag, Ctrl+drag rotation, pivot selection, and stack mode remain blocked. `CoordinateFrameView` implements the full `MeshView` no-op interface (including `updateBoxHelper`). Deletion of a parent cascades recursively.
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

## Annotation Marker Views Scale in Screen Space, Capped in World Space

- **Principle**: A marker view sized by a *world-unit constant* bakes in an assumption about scene scale. `AnnotatedPointView`'s `MARKER_RADIUS = 0.25` was designed for meter-scale scenes; in an mm-scale scene (Context DSL demo, entities at 2 800 mm) a 0.25 mm marker is sub-pixel — the marker silently disappears while its HTML label (pixel-sized) keeps rendering, which reads as "icon missing" (PHILOSOPHY #26).
- **Concrete Rule**: `AnnotatedPointView.updateScale(camera, renderer, maxWorldSize)` is called every animation frame from `AppController` with `maxWorldSize = Math.max(sceneRadius * 0.05, 0.25)` — constant screen size (target 20 px radius), capped at 5 % of the scene radius, floored at the legacy 0.25 world units so meter-scale scenes keep their original look. Same dual-bound pattern as `CoordinateFrameView.updateScale()` (rule above).
- **Composition contract**: `tick()`'s per-frame animation scales (Hub sonar ping, Anchor crosshair pulse) must multiply by `this._viewScale`, never overwrite it — `setScalar(animScale * this._viewScale)`. `_applyPlaceTypeVisuals()` and `setPlaceType()` reset to `_viewScale`, not `1`.

## Ground Grid Scales With Scene Radius

- **Principle**: the 20-unit `GridHelper` is another world-unit constant (PHILOSOPHY #27): in an mm-scale scene it collapses to an invisible dot, which reads as "the world grid is gone".
- **Concrete Rule**: `SceneView.fitCameraToSphere()` calls `_updateGridScale(radius)`, which scales `this._grid` by `10^max(0, ceil(log10(radius / 10)))` — power-of-10 cell sizes keep grid lines on round world coordinates; scale stays 1 for radius ≤ 10 so meter-scale scenes look unchanged. `fitCameraToSphere` is the single "frame the scene" entry point (STEP import, `compileLayout` demo): new code must route through it rather than positioning the camera directly, or the grid (and clip planes) silently desynchronise from the scene scale.

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
- **Concrete Rule 4**: TC's `pointerdown` listener is registered on `renderer.domElement` (target/bubble phase). AppController's `_onPointerDown` is registered on `window` (bubble phase). DOM event propagation fires the element listener first, then bubbles to `window` — so TC's `dragging-changed` event (and therefore `_tcDragging = true`) is set **before** `_onPointerDown` runs. Place `if (this._tcDragging) return` **before** the entire `if (result) / else` block in the object-mode section. This covers two failure modes: (a) TC arrow outside Solid bounds — `_hitAnyObject()` returns null, entering the `else` branch would deselect the active entity; (b) TC arrow overlapping a Solid — `_hitAnyObject()` returns the Solid, `_switchActiveObject()` would call `_attachMobileTransform(solid)` which replaces `_activeObj` and moves the proxy to the Solid centroid; subsequent `objectChange` then looks up the Solid id in `_tcStartCorners`, finds nothing (snapshot was for CF), and returns early — the CF never moves.
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

// _onPointerDown — guard BEFORE the if(result)/else block:
if (this._tcDragging) return  // ← TC owns this pointer; skip selection entirely

if (result) {
  // ... normal selection logic
} else {
  // Note: redundant _tcDragging check in else branch kept for clarity;
  // the top-level guard above already handles this path.
  if (this._tcDragging) return
  if (e.pointerType === 'touch') {
    this._clearObjectSelection()
    this._setObjectSelected(false)
    return
  }
  // ... rect selection start
}
```

## _confirmRotate Must Call _syncMobileTransformProxy

- **Principle**: R-key rotation moves the Solid's corners (and centroid). The TC proxy position is only set when `_syncMobileTransformProxy()` is called; it is NOT updated by the animation loop automatically. After rotation confirms, the proxy stays at the pre-rotation centroid, so the TC gizmo appears misaligned with the Solid.
- **Concrete Rule**: `_confirmRotate()` must call `this._syncMobileTransformProxy()` before returning — after `_updateNPanel()`. This matches the undo/redo pattern at the `onUndoClick`/`onRedoClick` handlers (lines 670/677). Omitting this call leaves the TC gizmo anchored to the old centroid until the next `pointermove` fires.

```js
// _confirmRotate() — end of method
this._updateNPanel()
this._syncMobileTransformProxy()  // ← re-anchor TC to new centroid
if (window.matchMedia('(pointer: coarse)').matches) this._updateMobileToolbar()
```

## R-key Rotation Must Be Blocked on Fastened-Source Solid

- **Principle**: `_updateFastenedFrames()` overwrites the SOURCE Solid's `orientation` and calls `_rebuildWorldCorners()` every animation frame to enforce the constraint. R-key rotation calls `obj.rotate(segStartOrientation, segStartPos, pivot, deltaQ)` each frame via `_applyRotate()`. These two writes target the **same Solid** and fight each other: each frame, R-key writes an orientation from snapshot + delta, and then the constraint immediately overwrites it with the constraint-enforced value. The resulting pose is undefined and the undo command records a stale `endOrientation` that differs from what the constraint will impose on the next frame.
- **Concrete Rule**: In `_startRotate()`, for the Solid branch, call `this._service.hasFastenedChild(obj.id)` before snapshotting orientation. If it returns `true`, set `this._rotate.active = false`, show the same toast as TC drag, and return. This mirrors the guard in the TC `dragging-changed` handler.

```js
// _startRotate() Solid branch — add BEFORE orientation snapshot
if (this._service.hasFastenedChild(obj.id)) {
  this._uiView.showToast('This object is held by a fastened constraint. Unfasten it first to move it independently.', { type: 'warn' })
  this._rotate.active = false
  return
}
this._rotate.startOrientation = obj.orientation.clone()
this._rotate.startPos         = obj._position.clone()
// ...
```

## TC Drag Must Be Blocked on Fastened-Source CoordinateFrames and Their Parent Solids

- **Principle**: A CoordinateFrame that is the SOURCE of a `fastened` SpatialLink has its `rotation` overwritten by `_updateFastenedFrames()` every animation frame (and `translation` too when the parent is another CF). Any delta applied by the TC `objectChange` handler is silently discarded one frame later, causing the TC proxy gizmo to drift away from the CF — the gizmo appears to move while the CF stays put.
- The same problem applies to the **parent Solid** of a fastened-source CF: `_updateFastenedFrames()` moves the Solid's corners back every frame to satisfy the constraint, so the Solid snaps to its original position while the TC proxy stays at the dragged position.
- **Concrete Rule**: In the `dragging-changed` start handler:
  - For `CoordinateFrame`: call `this._service.isFastenedSource(obj.id)`.
  - For Solid / other entities: call `this._service.hasFastenedChild(obj.id)`.
  - If either returns `true`, set `this._tcFastenedBlocked = true` and show a toast.
  - In the `objectChange` handler, return immediately when `_tcFastenedBlocked` is set.
  - In the `dragging-changed` end handler, if `_tcFastenedBlocked`: clear the flag, call `_syncMobileTransformProxy()` to snap the proxy back to the constraint-enforced position, and return without pushing any undo command.
- **Root bug (fixed)**: When the source CF's parent is a **Solid**, `_updateFastenedFrames()` must move the parent Solid (via `corner.add(delta)` + `updateGeometry`) rather than updating `source.translation`. Updating `source.translation` only slides the CF on the Solid's surface — the Solid itself never moves, so the constraint has no observable effect on the parent body. `source.translation` must remain unchanged so the CF stays at its designated mounting point on the Solid.

```js
// dragging-changed start
const isFastenedCF    = obj instanceof CoordinateFrame && this._service.isFastenedSource(obj.id)
const isFastenedSolid = !(obj instanceof CoordinateFrame) && this._service.hasFastenedChild(obj.id)
if (isFastenedCF || isFastenedSolid) {
  this._tcFastenedBlocked = true
  this._uiView.showToast('This object is held by a fastened constraint. Unfasten it first to move it independently.', { type: 'warn' })
}

// dragging-changed end
if (this._tcFastenedBlocked) {
  this._tcFastenedBlocked = false
  this._tcStartCorners = new Map()
  this._syncMobileTransformProxy()   // snap TC proxy back to constraint-enforced position
  return
}

// objectChange
if (this._tcFastenedBlocked) return
```

## Fastened Constraint — Known Limitations

These are design-level constraints (not bugs) of the current `fastened` implementation.  Violating these silently produces wrong behaviour.

- **Solid R-key rotation propagates through child CFs**: When a Solid is rotated with R-key (or TC rotate on mobile), `obj.rotate()` updates the primary triple (`_position`, `orientation`, `localCorners`) and calls `_rebuildWorldCorners()`. `_updateWorldPoses()` then recomputes world poses for all child CoordinateFrames via forward kinematics. This lets `_updateFastenedFrames()` detect the changed world pose of a target CF and propagate the rotation to the fastened Solid B. `SolidRotateCommand` stores start/end `orientation` + `_position` snapshots so undo/redo restores the primary triple correctly (ADR-040).

- **One fastened CF per Solid**: If two child CFs of the same Solid are each fastened to different target CFs, the second iteration of `_updateFastenedFrames()` moves the Solid again — invalidating the first constraint.  Only the last constraint processed (Map insertion order) is satisfied at the end of each frame.  **Do not create multiple fastened links whose source CFs share the same parent Solid.**

- **Geometric constraints inactive after `loadScene()` / `importFromJson()`**: SpatialLinks are deserialized and added to the model, but `_fastenedTransforms` and `_mountLocalPositions` are not populated during deserialization because `_worldPoseCache` is not yet available.  Both `loadScene()` and `importFromJson()` call `_updateWorldPoses()` + `_reactivateLiveLinks()` at the end to re-establish live constraints.  If either call is removed, constraints become permanently inactive for that session.

- **CF chain propagation** (ADR-035): When the SOURCE CF's direct parent is another CoordinateFrame (nested CF hierarchy), the old code absorbed the translation delta inside the CF chain and never reached the root Solid.  The fix: `_findAncestorChain(cfId)` walks up `parentId` links while the node is a `CoordinateFrame`, collecting intermediate CFs in root→leaf order, and returns `{ rootSolid, chain }`.  `_updateFastenedFrames()` then (1) moves `rootSolid` via primary triple (`_position`, `orientation`, `_rebuildWorldCorners()`) by the rigid-body delta, (2) re-propagates each intermediate CF's world pose inline — starting `pWorldPos` from `newSolidPos` (exact solver output, never a recomputed centroid), (3) leaves `source.translation` and `source.rotation` **unchanged** (local coordinates are invariant under rigid-body motion — back-converting from world-space would accumulate FP error each frame).  When `chain` is empty (direct Solid parent), this is identical to the old Solid-parent branch.  The `!rootSolid` (orphaned chain) path is the only case that back-converts world pose to local coordinates.  **Invariant**: `solidLocalOffset` seeds from `new Vector3()` (exact zero) — not `avg(localCorners)` which is only approximately zero and closes an error feedback loop (PHILOSOPHY #24c).

- **Cycle detection** (ADR-035): `_detectFastenedCycles(entries)` builds a Solid-to-Solid directed graph from fastened constraints and runs a DFS to find back-edges.  Entries whose `linkId` is in the returned `Set` are excluded from the solver for that frame.  `_prevCyclicLinkIds` tracks the previous frame's cyclic set; a `constraintCycleDetected` event is emitted (→ AppController toast) only when the set changes, preventing per-frame toast spam.

- **Quaternion hemisphere flip in delta solver**: `_updateFastenedFrames()` computes a per-frame delta quaternion `dq = targetQuat × prevQuat⁻¹`. If `targetQuat` and `prevQuat` are in opposite hemispheres (i.e. `targetQuat.dot(prevQuat) < 0`), `dq` encodes a ~360° rotation instead of the intended small rotation, causing the Solid to be flung out of the scene instantly. This manifests near ±90° and ±180° because that is where Three.js Euler→Quaternion conversion commonly crosses the hemisphere boundary. **Always negate `targetQuat` before multiplying when the dot product is negative**: `if (targetQuat.dot(prevQuat) < 0) targetQuat.negate()`. This enforces the shortest-path convention and keeps `dq` bounded to at most 180°.

## HTML Overlay Views Must Use the Active Camera for Screen Projection

- **Principle**: `AppController.get _camera()` always returns the perspective camera (`SceneView.camera`). When Map mode activates the orthographic camera (`SceneView.activeCamera`), the renderer uses the ortho camera but views storing the old perspective camera reference will compute wrong screen positions.
- **Concrete Rule**: Any view that projects 3D positions to screen coordinates for HTML overlay positioning (e.g. `AnnotatedPointView.updateLabelPosition()`) must use the ACTIVE camera, not a stale stored reference. Call sites in the animation loop must pass `this._sceneView.activeCamera` explicitly: `obj.meshView.updateLabelPosition(this._sceneView.activeCamera)`. The same applies to `MeasureLineView` if it is ever used alongside Map mode's orthographic camera.
- **Root bug**: `AnnotatedPointView` stored `this._camera` (perspective camera) at construction time. In Map mode the ortho camera was used for rendering, but labels were projected with the perspective camera → labels appeared at wrong screen positions relative to the rendered 3D markers.

## CoordinateFrame Tap Selection Must Check CF Before Parent Solid

- **Principle**: `_hitAnyObject()` filters candidates by `o.meshView.cuboid?.visible`. `CoordinateFrame.cuboid` returns `null`, so frames are never hit by this method. CFs are visually rendered on top of their parent Solid. If the Solid is checked first, a tap on the CF axes/sphere hits the Solid and the CF is never selected — this causes long-press context menus to be attributed to the Solid, breaking "Link to..." source selection for CF→CF fastened links on mobile.
- **Concrete Rule**: `_onPointerDown` runs **both** `_hitAnyCoordinateFrame()` and `_hitAnyObject()` in parallel, then applies the parent-child discrimination rule (PHILOSOPHY #22): prefer the CF result **only when the CF is a descendant of the found Solid** (tested via `_isCfDescendantOf(cf, solid.id)`). When the CF belongs to a *different* Solid, prefer the Solid — the 0.4-unit bounding-box fallback in `_hitAnyCoordinateFrame()` otherwise creates a false-positive zone that blocks selection of nearby Solids.
- **Anti-pattern**: calling `_hitAnyCoordinateFrame()` with a simple "if CF → return CF" gate causes visible CFs of the selected Solid to intercept every click within 0.4 world units, making it impossible to select other nearby Solids or CFs (the "solid-selection-conflict" bug).

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

## Solid Pose Mutation — Public API and SSOT Rule (ADR-040)

`Solid.js` owns the invariant: `vertices[i].position = _position + orientation.apply(localCorners[i])`.
This invariant is maintained by `_rebuildWorldCorners()`, which is **private** — it must only be called inside `Solid.js` itself. External code that calls `_rebuildWorldCorners()` directly is bypassing the public API and is forbidden.

### The five public mutation methods

| Method | When to use |
|--------|------------|
| `move(segStartPos, delta)` | Snapshot-based translation during drag |
| `rotate(segStartOrientation, segStartPos, pivot, quat)` | Snapshot-based rotation during drag |
| `restorePose(position, orient)` | Undo/redo restore and cancel paths — position+orientation change, localCorners unchanged |
| `setPose(position, orient, localCornersArr)` | Deserialization — all three primary triple members change |
| `setWorldCorners(worldCorners)` | MoveCommand undo/redo — restores from a legacy world-corner snapshot |
| `extrudeFace(face, savedLocalFaceCorners, localNormal, dist)` | Face extrude drag — only localCorners change |

### The snapshot pattern

All mutation methods are **reapplyable from the same snapshot**. Start snapshots must be taken from the ADR-040 primary triple (`_position`, `orientation`, `localCorners`) at the moment the operation begins, then passed to the method on every pointer-move frame. Never accumulate deltas across frames — always re-apply from the snapshot.

### restorePose() is the canonical restore path

Whenever an undo/redo command or a cancel path needs to restore `_position` and `orientation` (but not `localCorners`), it must call `obj.restorePose(position, orientation)`. Never:
```js
// WRONG — bypasses the public API, calls private _rebuildWorldCorners directly
obj.orientation.copy(orientation)
obj._position.copy(position)
obj._rebuildWorldCorners()

// CORRECT
obj.restorePose(position, orientation)
```

### localCorners direct mutation

The only legitimate exception is deserialization code that must fix `localCorners` in-place before calling a public rebuild method. The pattern is:
```js
// Fix localCorners (unavoidable in legacy format migration)
for (let i = 0; i < 8; i++) solid.localCorners[i].applyQuaternion(invQ)
// Then call a public method to sync _position + orientation and rebuild
solid.restorePose(solid._position, q)
```

### Stack Snap Must Use Public API

`_applyStackSnap()` computes a Z offset to rest grabbed objects on a surface below them. This offset must be applied via `selObj.move(segStartPos, currentDelta.clone().add(snapZ))` — never by directly mutating `corners`:

```js
// WRONG — leaves _position stale after corners are mutated
selObj.corners.forEach(c => { c.z += zOffset })

// CORRECT — snapshot-based move, keeps primary triple consistent
const segStartPos = segStartPositions.get(id)
if (segStartPos) selObj.move(segStartPos, currentDelta.clone().add(new THREE.Vector3(0, 0, zOffset)))
```

`_applyStackSnap()` receives `segStartPositions` and `currentDelta` as parameters because the call site differs between G-key grab (uses `this._grab.segmentStartPositions` + `lastDelta`) and mouse-drag (uses `this._objDragAllStartPositions` + `delta`).

## Preview Pipeline — applyPreviewTranslation / applyPreviewRotation / applyPreviewEndpointMove

Entity mutation during live drag previews belongs in `SceneService`, not in `AppController` or handler classes. Three methods own this contract:

| Method | Responsibility |
|--------|---------------|
| `SceneService.applyPreviewTranslation(segStartCorners, segStartPositions, worldDelta)` | CF → parent-local delta conversion + `cf.move()`; Solid → `solid.move(segStartPos, delta)`; other → `entity.move(corners, delta)`; mesh view update |
| `SceneService.applyPreviewRotation(obj, { segStartOrientation, segStartPos, pivot }, deltaQ)` | CF → ROS TF local rotation update + `meshView.updateRotation()`; Solid → `solid.rotate()` + mesh view update |
| `SceneService.applyPreviewEndpointMove(obj, endpointIndex, worldPoint)` | MeasureLine only — sets one vertex to absolute world position + `meshView.update()` |

`AppController` computes the world-space delta or quaternion from input events (mouse position, touch, axis constraints, grid snap), then calls the service method. It must not replicate the entity-type dispatch. Handler classes (`EndpointDragState`, and any future Edit Mode handlers) compute ray intersections from input events and delegate all entity mutation to these service methods.

After a stack snap (which re-applies domain mutations via `selObj.move()`), the call site must re-update mesh views for the snapped objects — `applyPreviewTranslation` only updates views for the non-snapped pass.

`cancel()` paths that need to restore entity state must also call the appropriate service method (e.g. `applyPreviewEndpointMove` called twice — once per endpoint — in `EndpointDragState.cancel()`). This keeps view state consistent even during cancellation.

## Centroid Is Validation-Only — Never Use for Verification or Geometry Traversal

- **Principle**: `getCentroid(corners)` / `avg(corners)` is a **measurement operation** computed by summing floating-point world-space vertices. Due to floating-point accumulation, the result diverges from the true geometric origin as coordinates grow large (PHILOSOPHY #24). It is suitable only for display and heuristics (Validation), never for computations whose correctness must be guaranteed (Verification).
- **Permitted uses** (Validation): N-panel display, label positioning, heuristic proximity checks, visual annotations, drag-tension display.
- **Forbidden uses** (Verification): SpatialLink endpoint calculation, snap targets, undo/redo coordinates, constraint solver inputs, physics traversal pivots.
- **Concrete Rule**: For `Solid`, the authoritative reference point is `obj._position` (ADR-040 primary triple). For `CoordinateFrame`, use `_worldPoseCache.get(id).position`. `SceneService._entityWorldCentroid()` must use these authoritative sources, not `avg(corners)`. `_dragSuggestionCentroid()` in `AppController` must use `obj._position` for `Solid` (already correct). The rule "getCentroid is permitted only for read-only display" in the "Rotate Pivot Must Use _position Directly" entry is an instance of this broader contract.

```js
// WRONG — avg(corners) for Solid SpatialLink endpoint
const sum = new Vector3(); for (const c of corners) sum.add(c); sum.divideScalar(corners.length)

// CORRECT — authoritative primary triple
return obj._position.clone()
```

## _hitAnyEntityForLink Must Prioritise CoordinateFrame Over Parent Solid

- **Principle**: CFs are visually rendered on top of (and often at the origin of) their parent Solid. A cuboid raycast (step 1) reaches the Solid first, making it impossible for the user to select a CF as a link target by tapping.
- **Concrete Rule**: `_hitAnyEntityForLink()` must call `_hitAnyCoordinateFrame()` as **Step 0** before the cuboid raycast. If a CF is found and it is not the link source, return it immediately. Only fall through to the cuboid and bounding-box steps when no CF is hit. `_startSpatialLinkCreation()` already calls `showFull()` on all CFs, so they are always visible during linking.

## importFromJson Solid v1.3 Coverage — Scene-JSON Producers Must Be Tested Through the Import Path

- **Principle**: There are two deserialization paths for scene JSON — `_deserializeEntities` (BFF `loadScene`) and `_reconstructEntity` (`importFromJson`). A format extension applied to only one of them creates a silent split: the per-entry `try/catch` in `importFromJson` swallows the `TypeError` into a `console.warn` and the entity is skipped without any user-visible failure (PHILOSOPHY #11). This happened with the v1.3 primary-triple Solid format (`position`/`orientation`/`localCorners`, no `vertices`): `compileLayout()` (ADR-045) emitted it, `_deserializeEntities` handled it, but `_reconstructEntity` read `dto.vertices` unconditionally — every compiled Solid was silently dropped, and the ADR-045 claim "loadable via importFromJson()" was false until the ADR-047 demo exercised the path.
- **Concrete Rule (1)**: `_reconstructEntity`'s Solid branch must mirror `_deserializeEntities`: check for `dto.position && dto.orientation && dto.localCorners` first and restore via `solid.setPose()` (public API per the Solid Pose Mutation contract); keep the legacy `vertices` path as fallback. Any future scene-JSON format change must be applied to **both** methods in the same commit.
- **Concrete Rule (2)**: Any new producer of scene JSON (compilers, exporters, migration scripts) must be verified end-to-end through `importFromJson` in a real browser session — golden-equality tests on the JSON alone do not prove loadability.

## stated→derived Promotion Is on the Compile Path — Un-invertible KPIs Bail, Never Throw

- **Principle**: `AdmissiblePromotion.promoteAdmissible()` runs inside `validateContext()`, which `compileContext()` calls before producing any layout. A throw there is not a local failure — it aborts compilation of the **entire** context. The monotonic-expression evaluator is *lazy* (the compiled closure parses/evaluates on each `kpi(x)` call), so an opaque construct like a function call (`fov_width(x)`) or a non-numeric fact path surfaces its `NotPromotable` signal only when `kpi(x)` is first evaluated **inside `invertCriterion`**, not at compile time. A `try/catch` that wraps only `compileMonotoneExpr` therefore catches nothing, and every Phase-1 context whose KPIs use helper-function exprs throws during validation.
- **Concrete Rule**: `tryPromote()` must wrap **both** `compileMonotoneExpr` and `invertCriterion` in one `try/catch (NotPromotable)` and `return null` (leave the requirement `stated`, so R9 still governs it). Promotion is best-effort: any expr that is not a closed-form, single-free-variable, strictly-monotonic, numerically-invertible function over the variable's domain must be silently left unchanged — never throw, never produce an invalid (empty or inverted) interval. Real-bug origin: ADR-049 Phase 2; the catch initially wrapped only the (now trivial) compile step and broke all 18 Phase-1 conflict tests with `"…does not resolve to a numeric fact value"`.

## Validator Rule Order — R0' on Input, Promotion, Then R6/R7/R9/R8 on the Promoted Set

- **Principle**: stated→derived promotion changes a requirement's admissible interval and `source`. Running it at the wrong point silently corrupts either input validation or conflict detection.
- **Concrete Rule**: in `validateContext()` the order is fixed: (1) R0' shape checks validate the **human-authored** requirements (catches inverted/invalid stated intervals before they are replaced); (2) `promoteAdmissible()` produces `liveRequirements` (a new Map) + `promoted[]`; (3) R9, R6, R7, R8, and the Decision-`relaxes` existence check all read `liveRequirements`, so the *canonical* (derived) region drives both the open-question and conflict outputs. R9 then naturally stays silent for a successfully promoted requirement (its `source` is now `derived`). `promoted` is returned (sorted) by both `validateContext` and `compileContext`.
