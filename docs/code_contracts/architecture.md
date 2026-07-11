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

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

Use `instanceof` not `dimension`; `Sketch.extrude()` returns new Cuboid swapped via `SceneService.extrudeSketch()`; ImportedMesh/CoordinateFrame have restricted capabilities; MeasureLine supports 1D Edit Mode (endpoint drag via `_enterEditMode1D`); Solid supports R-key rotation — ADR-040 primary triple (`_position`, `orientation`, `localCorners`); world corners derived by `_rebuildWorldCorners()`; `SolidRotateCommand` stores start/end orientation+position for undo; `Solid.bodyRotation` is an alias for `orientation` (backward compat); child CFs follow automatically via ROS TF forward kinematics — no manual CF pose update needed on Solid rotation

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

## Add Sketch Auto-Enters Edit Mode 2D; Controller Wiring Has No Static Guard

- **Principle**: A UI entry point whose handler throws is a silent no-op to the user
  (PHILOSOPHY #11 — the exception dies in the click handler, nothing renders). The
  Add-menu "Sketch" entry called `this._addProfileObject()` which did not exist —
  the method was lost in a history rewrite while its call site survived. Because
  `tsconfig.json` scopes `checkJs` to `src/types/` + `src/domain/` (Phase 2 decision),
  a dangling method call in the controller layer is invisible to `pnpm typecheck`;
  the smoke E2E is the ONLY liveness guard for controller wiring (ADR-064).
  The user-visible symptom was misleading: still in Object Mode, a touch drag
  orbits the camera — reported as "OrbitControls beats the sketch drag" when the
  sketch mode was simply never entered.
- **Concrete Rule**: `_addProfileObject()` creates the Profile via
  `SceneService.createProfile()`, records `createAddProfileCommand` (a Profile is
  not a Solid — no cuboid geometry, no child Origin CF, so `createAddSolidCommand`'s
  redo path does not apply, PHILOSOPHY #2), then auto-enters Edit Mode via
  `setMode('edit')` → `_enterEditMode2D` → `'2d-sketch'` (one continuous flow, #12).
  Its `onAfterUndo` runs while the user may still be in Edit Mode 2D on the vanished
  Profile: it must leave through `setMode('object')` (Mode Transition Flow) before
  switching active. `_enterEditMode2D` with no `sketchRect` must clear stale
  `_sketch.p1/p2` (kept across confirm for `_enterExtrudePhase`) so a fresh Profile
  never inherits the previous rect through the Extrude gate. Every Add-menu entry
  must be exercised by `e2e/smoke.spec.js` — there is no other guard.

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

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

Same conflict as TC drag: `_updateFastenedFrames()` and `_applyRotate()` fight over the same Solid's `bodyRotation` every frame. **Solid branch**: `_startRotate()` calls `hasFastenedChild(obj.id)` and shows a toast + returns if true — before snapshotting corners. `hasFastenedChild()` is **transitive** (uses `_findAncestorChain()`). **CF branch**: `_startRotate()` and the N-panel `onFrameRotationChange` handler both call `_isFastenedRotationBlocked(frame)` — the centralised helper that calls `isInFixedJointSourceChain(obj.id)` and shows the toast. **Always add new CF-rotation UI entry points through this helper** so the guard is never accidentally omitted. Without the block, `_updateFastenedFrames()` silently overrides the rotation every frame — the user's input appears to do nothing, which violates PHILOSOPHY #11 (silent failures). `isInFixedJointSourceChain()` walks the `parentId` chain of every JOINT_SOURCE to catch all ancestor CFs. Named after `jointType='fixed'` (ADR-038), not `semanticType='fastened'` — the guard applies to any fixed-joint topology regardless of semantic annotation. See STATE_TRANSITIONS.md §CoordinateFrame Role under Fixed-Joint SpatialLink.

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

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

`_updateFastenedFrames()` overwrites `source.rotation` (and `source.translation` when the parent is another CF) every frame — any delta from TC `objectChange` is silently discarded, causing the TC proxy gizmo to drift from the CF. Also applies to the **parent Solid** of a fastened-source CF: the Solid snaps back every frame while the TC proxy stays at the dragged position. In `dragging-changed` start, detect via `isFastenedSource()` (for CF) or `hasFastenedChild()` (for Solid), set `_tcFastenedBlocked = true`, show toast. In `objectChange`, return early if `_tcFastenedBlocked`. In `dragging-changed` end, sync proxy via `_syncMobileTransformProxy()` and return without pushing a command. `hasFastenedChild()` is **transitive** — it walks the full CF ancestor chain via `_findAncestorChain()`, so nested-CF topologies (`Solid → IntermediateCF → SourceCF`) are blocked correctly.

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

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

`_rebuildWorldCorners()` is private to `Solid.js`. External code must never call it directly. For undo/redo and cancel-path restoration use `obj.restorePose(position, orientation)`; for translation drag use `obj.move()`; for rotation drag use `obj.rotate()`; for full deserialization use `obj.setPose()`; for legacy world-corner restoration use `obj.setWorldCorners()`. Stack snap must apply its Z offset via `selObj.move(segStartPos, currentDelta.clone().add(snapZ))` — never `corners.forEach(c => c.z += zOffset)`. See `docs/code_contracts/architecture.md` §"Solid Pose Mutation".

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

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

Entity mutation during live drag previews belongs in `SceneService`. Three methods: `applyPreviewTranslation(segStartCorners, segStartPositions, worldDelta)` — Grab/mouse-drag; `applyPreviewRotation(obj, snap, deltaQ)` — R-key rotate; `applyPreviewEndpointMove(obj, endpointIndex, worldPoint)` — 1D endpoint drag. `AppController` and handler classes compute input deltas and delegate all entity mutation to these service methods. Handler cancel paths must also use service methods to keep view in sync. See `docs/code_contracts/architecture.md` §"Preview Pipeline".

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

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

`getCentroid(corners)` / `avg(corners)` accumulates FP error and must NOT be used for geometry traversal, SpatialLink endpoints, snap, undo/redo, or constraint solver inputs (Verification). Permitted only for N-panel display, label positioning, heuristic proximity, and visual-only annotations (Validation). For Solid: use `obj._position` (ADR-040); for CF: use `_worldPoseCache.get(id).position`. See `docs/code_contracts/architecture.md` §"Centroid Is Validation-Only".

## _hitAnyEntityForLink Must Prioritise CoordinateFrame Over Parent Solid

- **Principle**: CFs are visually rendered on top of (and often at the origin of) their parent Solid. A cuboid raycast (step 1) reaches the Solid first, making it impossible for the user to select a CF as a link target by tapping.
- **Concrete Rule**: `_hitAnyEntityForLink()` must call `_hitAnyCoordinateFrame()` as **Step 0** before the cuboid raycast. If a CF is found and it is not the link source, return it immediately. Only fall through to the cuboid and bounding-box steps when no CF is hit. `_startSpatialLinkCreation()` already calls `showFull()` on all CFs, so they are always visible during linking.

## importFromJson Solid v1.3 Coverage — Scene-JSON Producers Must Be Tested Through the Import Path

- **Principle**: There are two deserialization paths for scene JSON — `_deserializeEntities` (BFF `loadScene`) and `_reconstructEntity` (`importFromJson`). A format extension applied to only one of them creates a silent split: the per-entry `try/catch` in `importFromJson` swallows the `TypeError` into a `console.warn` and the entity is skipped without any user-visible failure (PHILOSOPHY #11). This happened with the v1.3 primary-triple Solid format (`position`/`orientation`/`localCorners`, no `vertices`): `compileLayout()` (ADR-045) emitted it, `_deserializeEntities` handled it, but `_reconstructEntity` read `dto.vertices` unconditionally — every compiled Solid was silently dropped, and the ADR-045 claim "loadable via importFromJson()" was false until the ADR-047 demo exercised the path.
- **Concrete Rule (1)**: `_reconstructEntity`'s Solid branch must mirror `_deserializeEntities`: check for `dto.position && dto.orientation && dto.localCorners` first and restore via `solid.setPose()` (public API per the Solid Pose Mutation contract); keep the legacy `vertices` path as fallback. Any future scene-JSON format change must be applied to **both** methods in the same commit.
- **Concrete Rule (2)**: Any new producer of scene JSON (compilers, exporters, migration scripts) must be verified end-to-end through `importFromJson` in a real browser session — golden-equality tests on the JSON alone do not prove loadability.

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

`_reconstructEntity`'s Solid branch must mirror `_deserializeEntities`: handle the v1.3 primary triple (`position`/`orientation`/`localCorners`, no `vertices`) via `solid.setPose()` before the legacy `dto.vertices` path. Scene-JSON format changes must touch **both** deserialization paths in the same commit; new scene-JSON producers (e.g. `compileLayout`) must be verified through `importFromJson` end-to-end — golden JSON equality alone does not prove loadability. The per-entry try/catch turns the omission into a silent skip (PHILOSOPHY #11). See ADR-047 §3.

## stated→derived Promotion Is on the Compile Path — Un-invertible KPIs Bail, Never Throw

- **Principle**: `AdmissiblePromotion.promoteAdmissible()` runs inside `validateContext()`, which `compileContext()` calls before producing any layout. A throw there is not a local failure — it aborts compilation of the **entire** context. The monotonic-expression evaluator is *lazy* (the compiled closure parses/evaluates on each `kpi(x)` call), so an opaque construct like a function call (`fov_width(x)`) or a non-numeric fact path surfaces its `NotPromotable` signal only when `kpi(x)` is first evaluated **inside `invertCriterion`**, not at compile time. A `try/catch` that wraps only `compileMonotoneExpr` therefore catches nothing, and every Phase-1 context whose KPIs use helper-function exprs throws during validation.
- **Concrete Rule**: `tryPromote()` must wrap **both** `compileMonotoneExpr` and `invertCriterion` in one `try/catch (NotPromotable)` and `return null` (leave the requirement `stated`, so R9 still governs it). Promotion is best-effort: any expr that is not a closed-form, single-free-variable, strictly-monotonic, numerically-invertible function over the variable's domain must be silently left unchanged — never throw, never produce an invalid (empty or inverted) interval. Real-bug origin: ADR-049 Phase 2; the catch initially wrapped only the (now trivial) compile step and broke all 18 Phase-1 conflict tests with `"…does not resolve to a numeric fact value"`.

## Validator Rule Order — R0' on Input, Promotion, Then R6/R7/R9/R8 on the Promoted Set

- **Principle**: stated→derived promotion changes a requirement's admissible interval and `source`. Running it at the wrong point silently corrupts either input validation or conflict detection.
- **Concrete Rule**: in `validateContext()` the order is fixed: (1) R0' shape checks validate the **human-authored** requirements (catches inverted/invalid stated intervals before they are replaced); (2) `promoteAdmissible()` produces `liveRequirements` (a new Map) + `promoted[]`; (3) R9, R6, R7, R8, and the Decision-`relaxes` existence check all read `liveRequirements`, so the *canonical* (derived) region drives both the open-question and conflict outputs. R9 then naturally stays silent for a successfully promoted requirement (its `source` is now `derived`). `promoted` is returned (sorted) by both `validateContext` and `compileContext`.

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

In `validateContext()`: R0' validates human-authored requirements first; then `promoteAdmissible()` yields `liveRequirements` + `promoted[]`; then R9/R6/R7/R8 and the Decision-`relaxes` check all read `liveRequirements` so the canonical derived region drives both open-question and conflict outputs. R8 keys on the additive Actor `discipline` field via `RoleKpiCatalog` (`ctx.kpiCatalog` overrides). `promoted` (sorted) is returned by both `validateContext` and `compileContext`. Form projection (`FormProjection.projectForm`) reads only the validator's `openQuestions`, never re-validates. See ADR-049 Phase 2.

## Region Conflict (R6) Is AABB-Only — the Helly-2D Caveat (ADR-049 Phase 3)

- **Principle**: R6's scalar logic is complete because of the 1-D Helly property — a family of intervals has empty common intersection iff some *pair* is disjoint, so one binding pair `(lo=max(mins), hi=min(maxes))` fully describes the conflict. This does **not** generalise to arbitrary 2-D convex sets: the Helly number in the plane is 3, so three pairwise-overlapping convex sets can have empty common intersection and the binding-pair + gap output becomes ill-defined.
- **Why AABB works**: the intersection of axis-aligned boxes decomposes independently per axis — `∩ AABBᵢ = (∩ intervalsₓ) × (∩ intervalsᵧ) [× (∩ interval_z)]` — and the common intersection is empty iff it is empty on ≥1 axis, where the 1-D Helly property holds. So region R6 = run the scalar interval logic once per axis (`RegionGeometry.intersectBoxes` over `intersectIntervals`). Convex polygons are rejected at R0' (their intersection needs LP/GJK and breaks the per-axis gap contract).
- **Concrete Rules**:
  - The half-open `[min,max)` test lives **only** in `RegionGeometry.intersectIntervals`; both the scalar branch and every region axis call through it so the touching-intervals-conflict convention can never diverge.
  - `gap` shape is polymorphic by admissible shape: scalar → `[hi,lo]` **array** (unchanged — backward-compat regression guard in `ContextConflict.test.js`); region → `{axis:[hi,lo]}` **map** over empty axes only.
  - `detectConflicts` skips a variable bucket whose requirements mix interval and region shapes (R0' already flags that as an error) rather than throwing on the inconsistent data.
  - Region ≠ multi-variable: a region admissible constrains exactly one region variable. Multi-variable requirements (`constrains.length ≥ 2`) carry no single-variable admissible and continue to feed R7 clustering, never R6.

## PredicateEngine — Pure, THREE-Free, Blocked-Before-Evaluate (ADR-049 Phase 3)

- **Principle**: acceptance predicates (`no_overlap`, `reach_covers`, `swept_volume`) are pure geometry. The deferral in ADR-046 §4.2 is now implemented in `src/context/PredicateEngine.js` + `RegionGeometry.js`.
- **Concrete Rules**:
  - Engine functions return `{ kind, pass, violations }` value objects and **never throw on `pass:false`** (a failing predicate is a normal result). The only thrown error is `MalformedPredicate` for a structurally invalid predicate — caught in R5 and re-surfaced as a validator `error` (PHILOSOPHY #11, never swallowed).
  - No `THREE` import anywhere in `src/context/` — `RegionGeometry.js` implements its own AABB/vector math so the whole tree loads under bare `node --test`. A `three/addons` import would throw there, which is the built-in purity safety net.
  - In R5, a structured `predicate` is evaluated **only when the check is not blocked**. A check whose `requires` resolves to an assumed/unknown fact is `status:'blocked'` and the engine is NOT run — you cannot evaluate clearance/reach against an unknown dimension. Precedence: blocked > fail > pass.
  - `swept_volume` is a conservative capsule-chain **sampling** approximation (points along each path segment, point-to-AABB distance minus tool radius), not an exact swept solid — documented in the module.
- **Additive return contract**: `validateContext` returns `checkResults` (predicate `pass|fail|blocked` records) on **every** return path including the early `!ctx` null-guard — same discipline as `promoted`. `compileContext` passes it through.

---

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

`PredicateEngine.evaluatePredicate()` is pure, returns `{pass, violations}` value objects, and throws only `MalformedPredicate` (bad shape) — never on `pass:false`. It imports no `THREE` (own AABB/vector math in `RegionGeometry.js`) so the whole `src/context/` tree loads under bare `node --test`. In R5, evaluate a structured `predicate` **only when the check is not blocked** — a check with an assumed/unknown required fact is `status:'blocked'` and the engine is NOT run (you cannot evaluate clearance against an unknown dimension — PHILOSOPHY #11). `MalformedPredicate` surfaces as a validator `error`, never swallowed. **Robotics kinds (ADR-053 Phase 1, `context/0.4`)**: `robot_reach` (`targets[].reachable`/`margin` + optional `marginMin` → `unreachable`/`low_margin` violations) and `collision_free` (`scope:'self'｜'env'`, pre-baked `contacts[].clearance` + optional required `clearance` → `contact` violations) follow the same contract. They consume **pre-baked measurement-instrument operands** (the future `RoboticsService` runs FK/IK/BVH; the predicate is only the pure formal evaluation that collapses them to a boolean — ADR-053 §2/§1.1), so the engine still imports no `THREE`. An empty `contacts` list is a legitimate `pass` (nothing touches); an empty `targets` array is `MalformedPredicate`. Adding a kind = `VALID_PREDICATE_KINDS` + engine `PREDICATE_KINDS`/switch + `CONTEXT_DSL_VERSION` bump; the validator dispatch (`evaluatePredicate`) needs no change.

## Rotate Pivot Must Use `_position` Directly

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

Any Solid pivot / centroid used in a state-mutating computation must come from `obj._position` (or `.clone()`), never from `getCentroid(obj.corners)`. Affected sites: `_startRotate()`, `_applyRotate()`, mobile re-touch in `_onPointerDown`, TC rotate `objectChange` handler, `_syncMobileTransformProxy`, `_startGrab` (and touch re-drag path), `_attachMobileTransform` legacy fallback, `onLocationChange` delta, Ctrl+drag `_objRotateCentroid`. `getCentroid` is permitted only for read-only display (N-panel, CF scale cap). Rationale: `getCentroid` averages 8 world-space vertex positions — far from the origin the FP rounding feeds back into `_position` each frame and compounds into visible drift (PHILOSOPHY #24 manifestation c). `obj._position` is the ADR-040 authoritative primary triple and carries zero rounding error. TC rotate additionally requires `.clone()` to avoid aliasing: `Solid.rotate()` mutates `this._position` (= `obj._position`) before reading `pivot`, so a direct reference produces `pivot.sub(pivot) = 0`.

---

## Semantic Move Guardrail (checkMoveGuardrail)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

Before G-key grab (`_startGrab()`) and before mouse quick-drag (`BEGIN_QUICK_DRAG` in `_onPointerDown`), call `SceneService.checkMoveGuardrail(_selectedIds)`. If it returns `{ blocked: true }`, show the message as a `'warn'` toast and return — do not enter the grab/drag state. The guardrail fires when: (1) any selected entity has a `fastened` or `mounts` SpatialLink to an entity **not** in the current selection; (2) any selected **Solid** has a fastened-child CF (`hasFastenedChild(id)`). The Solid check is required because fastened links live on child CF IDs, not the Solid ID — the direct-link loop alone misses them, and without the block the drag preview and `_updateFixedJointFrames()` fight every frame causing oscillation. If the linked peer is also selected (moving the whole assembly), the guardrail does not fire. All preconditions for movement belong inside `checkMoveGuardrail`; call sites must not add inline guard returns (PHILOSOPHY #25).

---

## SemanticInferencer Integration (ADR-041)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`_runSemanticInference()` is called at the end of `_confirmGrab()` and after QuickDrag confirm. It is skipped when `selectedIds.size > 1` or the moved entity is not a `Solid`. The inferrer (`inferSemanticRelationships`) is pure — no DOM or scene mutations. Both `GrabOperationHandler.start()` and `QuickDragState.enter()` dismiss any pending SemanticSuggestion banner via `dismissSemanticSuggestion()` when a new drag begins — without this, the stale banner stays visible during the new drag, and clicking its "Link" button leaves the new drag's ghost/tooltip alive. Never call `inferSemanticRelationships` from inside the animation loop (it is not a per-frame computation).

---

## Drag Suggestion Lifecycle (ADR-041 Phase 2)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

Ghost `SpatialLinkView` and drag tooltip are created in `showDragSuggestion()` and must be disposed in all four exit paths: (1) inference lost in `onPointerMove` → `hideDragSuggestion()`; (2) pointerup confirm → `_clearSuggestion()` inside `confirm()`; (3) Enter-key accept → `hideDragSuggestion()` then `acceptSuggestion()`; (4) SemanticSuggestion "Link" button click → `hideDragSuggestion()` called at the start of the `onAccept` callback inside `_runSemanticInference()`. `acceptSuggestion()` sets `_activeDragPointerId = null` before returning so the subsequent `pointerup` sees `wasDragging = false` and is a no-op. `_ghostLinkView` on `AppController` is the sole owner; `hideDragSuggestion()` is the sole disposer (PHILOSOPHY #4 Visual Flag Has One Owner, #9 Allocations Symmetric).

---

## Robotics Measurement Instrument: Pure Kernel + ComputeBackend Seam + RoboticsService Receptacle (ADR-053 Phase 2)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

The measurement instrument that *produces* the Phase-1 predicate operands lives in `src/robotics/*` (pure, THREE-free, bare `node --test`) behind the `ComputeBackend.run(job)` seam (ADR-053 §3/§10). **`Kinematics.js`** owns FK (`forwardKinematics` — its own SE(3) quaternion math, no `THREE`, ROS +X/+Y/+Z, URDF RPY=Rz·Ry·Rx) and **FK-sampling** reach (`reachTargets` — nearest sampled TCP ≤ `tolerance` ⇒ `reachable`; `margin` is a **length-unit** outer-workspace clearance, **NOT** a singularity margin — that needs the KDL Jacobian, deferred). `sampleConfigs` caps the grid at `MAX_SAMPLE_CONFIGS` and **throws** rather than hang on a combinatorial blow-up; `fixed` joints consume no `q` (`movableJoints`). **`Collision.js`** `bakeContacts` reuses the shared `RegionGeometry.aabbClearance` (single signed-clearance source — never re-implement the `lo<hi` test) for AABB contact baking (`scope:'self'` = link pairs, `'env'` = link×obstacle), an approximation of the deferred three-mesh-bvh exact mesh distance. The output shapes match §9.2 predicate operands exactly. **Divergence from §4 is intentional and documented (§10.1)**: §4 specified KDL/ruckig→Emscripten-WASM IK/trajectory; the env has no Emscripten lane, so Phase 2 ships the §3-blessed pure-JS "初期形" `LocalComputeBackend`. The KDL/ruckig-WASM, BVH, and `ServerComputeBackend` (BFF `/compute`) swap in **behind the same `run(job)` seam** — the caller never changes. **`RoboticsService`** (`src/service/RoboticsService.js`, `EventEmitter`) is the §2 receptacle: a side-effect coordinator with **no pure logic** (PHILOSOPHY #3, like `ContextService`), backend **injected** (THREE-free unit tests with a fake backend). `measureReach`/`measureCollision` await the backend and bake the operands into the acceptance check's `robot_reach`/`collision_free` predicate as a **new doc** (input-immutable — PHILOSOPHY #6); `applyMeasuredFact` writes a scalar `status:'measured'` Fact (the `numericFact` receptacle; `measured` does NOT block dependent checks — only `assumed`/`unknown` do). A missing check or mismatched predicate kind **throws** (never silently drop a measurement — PHILOSOPHY #11). A baked predicate then flows through `validateContext`/`evaluatePredicate` unchanged. Non-goals still deferred: IK/Jacobian, movable solver, urdf-loader/three-mesh-bvh real geometry, `ServerComputeBackend`/BFF, `RobotPoseGhost`/`CollisionHighlightView` (the §6 human-verification overlay), pending UX.

---

## C++→WASM Build Lane: Committed Artifact, Off the Default Build, Toolchain via Setup Script (ADR-053 Phase 3)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

The Emscripten C++ lane (`robotics-wasm/`, ADR-053 §11) compiles KDL `v1.5.1` + ruckig `v0.9.2` + Eigen `3.4.0` (pinned **git submodules** under `robotics-wasm/vendor/`) into ONE embind WASM module. Its output `src/engine/robotics-wasm/robotics_engine.{mjs,wasm}` is **committed to git** — identical policy to the Rust `wasm-engine` (ADR-027): `vite build` and GitHub Pages CI must never need a C++ toolchain. Consequences that are easy to get wrong: **(1)** `build:robotics-wasm` is **NOT** wired into `pnpm build` (which only runs `build:wasm` for Rust) — the Emscripten SDK is heavy and the artifact is checked in; rebuild it explicitly only when bindings/vendored versions change. **(2)** The toolchain itself is provisioned by `scripts/setup-toolchain.sh` (`pnpm setup:toolchain`), idempotent and reproducible on a fresh/ephemeral container; it fetches the `wasm-pack` prebuilt binary from the **github.com release asset** (the `rustwasm.github.io` Pages installer URL can 403 under a network policy) and installs `emsdk` to `$EMSDK_DIR` (default `/opt/emsdk`). A fresh clone needs `git submodule update --init --recursive` before building (the build script does this if `vendor/` is missing). **(3)** KDL is built with the **old Tree interface** (`config.h` generated by `configure_file` with `KDL_USE_NEW_TREE_INTERFACE` undefined) so **no Boost** is pulled in — `config.h` is still required because `kinfam_io.hpp → tree.hpp → config.h` is included transitively even by the Chain solvers we actually use. ruckig links only its 5 core sources (no `python.cpp`/cloud client). **(4)** The smoke test `robotics-wasm/robotics_engine.test.mjs` (`pnpm test:robotics-wasm`) imports the **committed** artifact and runs under `node --test`, so it is kept **out of `test:context`** (the THREE-free pure-JS lane that must load with no WASM). Every embind function in `src/bindings.cpp` is a pure computation (PHILOSOPHY #3).

---

## PersonaProjection Consumes `validateContext`, Not Raw `detectConflicts` (ADR-049 Phase 4)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`PersonaProjection.projectConflictMatrix`/`projectResolutionOrder` are pure (no THREE/DOM, input-immutable, load under bare `node --test`) and read the **validator result** — specifically `conflicts[].resolvedBy` / `negotiationClusters[].resolvedBy`, populated by `validateContext`'s Decision-resolution pass (a `d_*` whose `resolves` matches the conflict ref / covers all cluster variables). Feeding them the raw `RequirementGraph.detectConflicts` output instead leaves `resolvedBy` undefined, so every Decision-settled conflict renders as a live red `conflict` cell instead of `resolved` — a silent wrong-colour, not a crash. Matrix cell state is `conflict` only for an **unresolved** conflict whose `between` includes one of the cell's requirements; coupled (multi-variable, `constrains.length ≥ 2`) requirements never appear in `between` (R6 is single-variable) so they read `satisfied`/`coupled`. Matrix/Cluster render as **tabs inside the existing 280px Context Inspector**, never a new edge panel (PHILOSOPHY #26); the persona filter is pure uiStore state (`demoSetPersonaFilter`), not a controller callback. **n-ary approval gate (Phase 4 完了)**: both projections take an opt-in 3rd arg `{ approvedRefs: Set<string> }`. `resolvedBy` is set by the validator whenever a Decision *references* the conflict/cluster — independent of approval — so when `approvedRefs` is provided, a `resolvedBy` whose Decision is **not** in the set reads the new state `proposed` (matrix ◐ amber) instead of `resolved` (green ✓); `projectResolutionOrder` adds an additive `approved` flag per step. **Omitting `approvedRefs` preserves `resolved`-on-`resolvedBy`** — the story/authoring callers pass no gate and must stay non-breaking (the backward-compat seam). `ContextDemoController.approveNegotiationDecision(ref)` is the sole approval path: it calls `demoApproveDecision(ref)`, rebuilds `approvedRefs` from `demo.approvedDecisions`, and **re-projects from the cached `_negCtx`/`_negResult` — never re-validating** (the Decision set changed, not the requirement graph). The n-ary `合同確定` button is enabled only when every `dependsOn` step is already approved (DAG order, invariant 8). The negotiation overlay is 3D-independent, so `ContextInspector` lifts its `<768px` `return null` **only when `demo.conflictMatrix` is present** and renders full-width on mobile (transient overlay, PHILOSOPHY #26) — the story/authoring inspector stays desktop-only. **Region ghost overlay (§5.3, the last Phase 4 deferral)**: `projectRegionGhosts(ctx, validatorResult, {approvedRefs})` is the third pure projection (same THREE/DOM-free, input-immutable contract). It only yields a ghost for a **region Variable** (`v.region` present) with single-variable region requirements (`constrains.length === 1`, `admissible.region`) — coupled multi-variable reqs feed R7, not the per-axis footprint, and scalar variables have no footprint to draw. It computes the common intersection via `RegionGeometry.intersectBoxes` (the single half-open per-axis source — never re-implement the `lo < hi` test in the view), so `intersection.empty` / `emptyAxes` / `gap` ARE the R6 region-conflict result; `state` mirrors the matrix (`conflict`/`proposed`/`resolved`/`satisfied`). It returns `regions` sorted by `ctx.actors` index so the view's persona-colour palette assignment is **deterministic** — colour is presentation (lives in `RegionGhostView.PERSONA_PALETTE`/`personaColor`), the pure layer never names a hex. `RegionGhostView` is read-only (the **output** projection — ADR-047 ghost lineage) and is solely owned by `ContextDemoController` (`enterRegionGhost` creates the views, `exit()` disposes them — PHILOSOPHY #4/#9), distinct from the editable **input** projection `RegionAuthoringWidget` (§5.2). The conflict matrix is shown alongside the 3D ghosts (same `demoSetMatrix` path) so the actor-column `personaFilter` drives ghost dimming — the controller mirrors `demo.personaFilter` into `view.setPersonaFilter()` from `tick()`, guarded by a `_ghostFilter` last-value check (no per-frame churn).

---

## ContextService Owns the Canonical Doc; Scene Is Derived (ADR-050)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`ContextService` (extends `EventEmitter`, `src/service/ContextService.js`) is a **side-effect coordinator with no pure logic** (PHILOSOPHY #3): it delegates validation/compilation/projection to `src/context/*` (94 tests, unchanged) and re-rendering to `SceneService.importFromJson`. **`loadContext(doc, vc)` is the single authoritative entry** for adopting a document (PHILOSOPHY #1): validate → `compileContext` → `compileLayout` → `importFromJson({clear:true})` → rebuild `_refToId`/`_traceByFrom`/`_constraintToLinkId`/`_linkIds` → emit `contextLoaded`. It **throws** on validation/compile/import failure (the service shows no UI — the caller toasts, PHILOSOPHY #11). **Every doc change yields a NEW doc** (input-immutable — PHILOSOPHY #6); the input is never mutated. **Approval is a real doc mutation** (`decision.status: proposed → agreed` via `_withDecisionStatus`), not a transient set — so the matrix `resolved` state is doc-derived: `_approvedRefs()` reads `agreed`/`signed` decisions and feeds the pure projections' `{approvedRefs}` gate (the ADR-049 Phase 4 seam). `approveDecision` does **not** regenerate the scene — `$decision` markers resolve to `nominal` verbatim regardless of status, so geometry is invariant under the flip (avoids the §7 recompile cost); `applyAdmissible` **does** regenerate (region edits change geometry). `applyContextDoc` compiles **before** mutating state so a compile failure leaves prior state intact, and emits `conflictsChanged` only when the conflict signature differs (a status flip does not change `validateContext().conflicts`). Accessors (`getDoc`/`getValidatorResult`/`getCompiled`/`getRefToId`/…) own their freshness (PHILOSOPHY #23). `AppController._onContextLoaded(compiled)` does scene-side housekeeping (clear undo history + selection, frame the mm-scale camera — PHILOSOPHY #27). Unit-tested THREE-free by injecting a fake `sceneService` (mock `importFromJson`). NOTE (Phase 1): the working PoC `ContextDemoController` still owns its own inline ref-map bookkeeping; its migration to a `ContextController` consuming `ContextService` is ADR-050 §4.1 / Phase 2.

---

## ContextController Is a Persistent Overlay; Approval Goes Through the CommandStack (ADR-050 Phase 2)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`ContextController` (`src/controller/ContextController.js`) is the **production** Context-first overlay coordinator — a persistent overlay like `MapModeController`, **not** a `setMode()` FSM state (ADR-050 §4.2 / ADR-047 §2.1): orbit/select/grab stay live underneath. It consumes the canonical doc through `ContextService` (never re-implements validation/compile/projection). It is **distinct from `ContextDemoController`** (the tutorial story, untouched in Phase 2); the two read **separate uiStore slices** (`context` vs `demo`) so production and tutorial are decoupled. Approval **must** go through `createApproveDecisionCommand(ctxService, ref, vc)` (`src/command/ApproveDecisionCommand.js`) + `_commandStack.push()` (post-hoc record — never `execute()` on the stack; CODE_CONTRACTS push vs execute) so the doc mutation is undoable on the single history. The controller does **not** re-project inside `approveDecision()`; it subscribes to `ContextService`'s `contextChanged` event and re-projects **from there** (PHILOSOPHY #5) — so approve / undo / redo (all doc mutations through the service) re-paint the matrix through one path, not three. `_reproject()` short-circuits when `!_negotiation`, so the initial `loadContext` (which emits `contextLoaded`, not `contextChanged`) does not double-project. The `ConflictMatrix` / `NegotiationClusterView` React components are **prop-driven** (`{matrix,filter,onSetFilter}` / `{order,clusters,filter,onApprove}`), slice-independent, shared verbatim by the demo (`demo` slice via `ContextInspector`) and production (`context` slice via `ContextLayer`).

---

## ContextController Authoring/Ghost: Recolour Live, Commit Once, Regenerate on Drag-End (ADR-050 Phase 3)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`ContextController` now carries a single `_mode` (`'negotiate'｜'author'｜'ghost'｜null`) replacing the Phase-2 `_negotiation` boolean; the getters `isNegotiation`/`isAuthoring`/`isRegionGhost`/`isActive` derive from it. **Region authoring** (`enterAuthoring`/`_startAuthoring`): spawn one `RegionAuthoringWidget` per single-variable region requirement (`constrains.length===1 && admissible.region`) of the **loaded doc**; hide derived meshes (the widgets ARE the regions). **No bootstrap (2026-06-18)**: `enterAuthoring`/`enterRegionGhost`/`enterNegotiation` never load a bundled example or replace the scene. If no doc (or no region requirement) is loaded they show a guiding **warn** toast (load a project template / import a `.ctx.json`). The cell examples are still reachable as **New Project** gallery templates, so the views operate on a loaded context without a surprise reset — matching ADR-050's persistent-overlay intent. A live drag (`onAuthor*`, delegated from AppController **alongside** the `_demoCtrl.isAuthoring` branch) **recolours only** — re-validate a **cloned** `_editCtx` (`applyAdmissibleEdit`→`validateContext`), **never the canonical doc** (PHILOSOPHY #6/#7). On pointer-up commit **once** through `createEditAdmissibleCommand(ctxService, reqRef, before, after, vc)` (`src/command/EditAdmissibleCommand.js`) + `_commandStack.push()` — the whole drag is one undoable doc mutation that regenerates the scene (full regen deferred to drag-end — ADR-050 §3.5/§7). A no-op drag (region unchanged) pushes nothing. `execute()`/`undo()` **return the regen promise** (importFromJson is async); `_commitRegionEdit` pushes only after it resolves and on reject **rolls the widget back** + toasts (a region edit that resolves a conflict orphans its Decision → `compileContext` throws invariant 7 — PHILOSOPHY #11). **Region ghost** (`enterRegionGhost`): overlay actor-coloured `RegionGhostView`s from `ContextService.projectGhosts()`, mirror `context.personaFilter` into ghost dimming from `tick()` guarded by `_ghostFilter` last-value. Widgets/ghosts are **solely owned** here — created on enter, disposed in `exit()` (PHILOSOPHY #4/#9). `_reproject()` (driven by `contextChanged`) **dispatches by `_mode`** (negotiate/ghost re-project the matrix; author re-hides derived meshes + resyncs `_editCtx`/widgets + recolours) — superseding the Phase-2 `!_negotiation` short-circuit; it is a no-op when `_mode===null` so the initial `loadContext` (emits `contextLoaded`, not `contextChanged`) never double-projects. `ContextLayer.jsx` renders by `context.mode` (negotiate: Matrix+Cluster tabs / author: live R6 conflict list / ghost: Matrix-only).

---

## ContextController Blank-Doc Entry: adoptDoc Skips Compile/Layout; addDocEntry Goes Through CommandStack (ADR-051 Phase 1)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

**Blank doc adoption** (`selectTemplate('blank')` — the **New Project** gallery's Empty Project card; the former `newContext()` direct menu item was removed 2026-06-18): calls `ContextService.adoptDoc(blankDoc, vc)` — NOT `loadContext()`. `adoptDoc` validates the doc, clears the scene with an empty `SCENE_JSON_VERSION` JSON (no layout compile step — the blank doc has no `specification.layout`), sets `_compiled = null`, and emits `contextLoaded`. `loadContext()` would throw at `ctx.specification.layout` because blank docs intentionally omit specification. **Direct entry addition** (`addDocEntry(type, data)`): snapshot `beforeDoc = getDoc()`, apply the appropriate pure `DocBuilder` function (`addActor`/`addFact`/`addVariable`/`addRequirement`) → `afterDoc`, create `createAddDocEntryCommand(ctxService, beforeDoc, afterDoc, label, vc)` + `_commandStack.push()` (post-hoc record — PHILOSOPHY #1, CODE_CONTRACTS push vs execute). The command uses `regenerate:true` for uniformity; when `_compiled = null` (blank doc), `applyContextDoc` re-compiles on first entry addition that adds a specification — but blank docs with no specification still pass validate and return a no-op scene. `_reproject()` after `contextChanged` refreshes `context.actors` and `context.variables` so IntakePanel dropdowns reflect the new state (PHILOSOPHY #5). Initial tab defaults to `'intake'` when the doc has no actors yet; tabs include `'intake'` always in negotiate mode. `ContextService.adoptDoc` also resets `_refToId`/`_traceByFrom`/`_constraintToLinkId`/`_linkIds` to empty Maps (same invariant as `loadContext`). Pure builders in `src/context/DocBuilder.js` are THREE-free and input-immutable (21 tests + 4 command tests).

---

## ContextController Template Gallery: Pure Catalog, Side-Effectful Doc Resolution (ADR-051 Phase 2)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

**Starter templates** (`openTemplateGallery`/`selectTemplate(id)`): the catalog is the pure metadata module `src/context/TemplateCatalog.js` (`TEMPLATE_CATALOG` / `getTemplateMeta` / `exampleFiles`) — THREE-free, **no JSON imports**, loads under bare `node --test`. Each entry's `source` is `{kind:'blank'}` or `{kind:'example', file}`; the catalog NEVER holds a doc. Resolving an example `file` → a bundled doc is a **side effect** owned by the controller's `TEMPLATE_DOCS` import map (static `import x from '../../examples/*.json'`). A module-load loop checks every `exampleFiles()` entry is mapped (`console.error` on a gap — PHILOSOPHY #11, no card silently loads nothing). `selectTemplate` exits any active overlay first (disposes widgets/ghosts — PHILOSOPHY #9), then dispatches: `blank` → `adoptDoc(createBlankDoc(name))` (no layout compile); `example` → `_loadThen(doc, _startNegotiation)` (regenerates the derived scene, clears undo — project-open boundary). The gallery footer states the scene-replacement consequence so **no second confirm dialog** is shown (ADR-051 §7 transparency = the gallery surface itself). `TemplateGallery.jsx` is a transient full-screen modal (z-index 300, above all edge panels — PHILOSOPHY #26); open/close is pure uiStore state (`templateGalleryOpen` / `setTemplateGalleryOpen`), gated by `onSelectTemplate`/`onCloseTemplateGallery` callbacks.

---

## ContextController Fork & Tweak: Seed Is a Read-Only Mirror, Not a Second Source (ADR-058 Phase 1 + actor/variable seed chips)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

**Fork an example** (`forkExample(id)` / `onForkTemplate`): the gallery's example cards carry a "✎ Use as a starting point" action. `forkExample` **deep-clones** the bundled example doc into the working doc (so editing never touches the imported module), loads it through the single authoritative path (`_loadThen` → `loadContext`, scene regenerated, undo cleared — project-open boundary), then **after** `_startNegotiation` sets `context.authorSeed = deepClone(seed)` and opens the `'intake'` tab. The seed must be set after `_startNegotiation` because `contextStart` resets `authorSeed` to null; `contextStart`/`contextEnd` both clear it so a non-fork negotiate never carries a stale seed. The seed is a **read-only mirror** of the example file — it is **NOT a second source of truth**; the working doc stays owned by `ContextService` (§1.1 / PHILOSOPHY #1). Only `kind:'example'` templates are forkable (a blank doc has no filled values to anchor against). The pure index `src/context/SeedAnchor.js` (`buildSeedIndex`/`seedEntry`/`seedIsEmpty`/`describeSeedRequirement`/`describeSeedActor`/`describeSeedVariable` — THREE-free, input-immutable, bare `node --test`, the `describe*` chip-label helpers degrade gracefully on missing fields) keys the seed by entity kind + ref; an entry with no string `ref` is skipped (never fabricate an anchor — PHILOSOPHY #11). `IntakePanel` `useMemo`-indexes `ctx.authorSeed` and renders a seed banner + seed chips on the **actor, variable, and requirement** forms (the shared `SeedChips` component — kind-agnostic `{entries,describe,onPick,hint}` — replaces the Phase-1 inline requirement chips so all three forms read as one family): clicking a chip `fillFromSeed(entry)` floods every field with the example's real values (an **editable** anchor, the superset of a faint placeholder) and suffixes the `ref` with `_copy` — because the forked working doc already contains the seed ref, the add-only form would otherwise create a duplicate ref. **In-place per-field editing of existing entries** (the ADR §3 snapshot-command form, the generic `createDocEditCommand`) is still deferred; the implemented work is fork + seed-anchor + per-kind seed chips only (front-end UX, no contract/schema change — scope boundary).

---

## Intake Live Checks Are the Validator's Own Predicates; the Gap List IS the Submit Predicate (ADR-058 UX)

**Same function reference, never a re-implementation (§B-2)**: every field-level live check in the intake surface that mirrors a commit-time rule must call the predicate exported by the validator itself — `isInterval` is exported from `ContextValidator.js` and imported by `src/context/IntakeAssist.js` (re-exported for one import surface); `IntakeAssist.test.js` machine-checks the reference identity (`assert.equal(isInterval, validatorIsInterval)`). Writing a looser UI copy creates the "passes the form, fails the commit" divergence (§1.1 — the rule's source of truth is the validator; the input surface only mirrors it).

**No silent disabled (§B-1 / PHILOSOPHY #11)**: each form's `*Gaps(form)` function (`actorGaps`/`variableGaps`/`requirementGaps`) is THE submit predicate — the button is disabled iff the list is non-empty, `submit()` early-returns on the same list, and `GapNote` prints it as the one-line reason. One predicate, three projections; never an independent `canSubmit` boolean beside a hand-written reason string.

**The playful layer never writes the doc (§B-3)**: seed flood/tint (`matchesSeed` against the `seedFill` snapshot — render-time derivation, no state machine), ref suggestions (`refStatus`/`suggestRef` — informative, never input-blocking), KPI chips (`kpiCatalogChips` — read-only projection of `RoleKpiCatalog`; the catalog carries no units/exprs so none are fabricated), and the `DualRange` admissible slider all end in form-local state; the only doc-mutating exit remains `onAddDocEntry` → DocBuilder → `AddDocEntryCommand`. The slider writes the SAME `admLo`/`admHi` state as the numeric inputs (no second source) so the existing `onPreview` → 3-D band path needs no new wiring. `context.requirements` (uiStore) is supplied by `_startNegotiation` AND `_reproject` (PHILOSOPHY #5) for the ref-uniqueness set and the Why-first trail — the Requirements section badge counts `requirements.length`, not the nonexistent `variableSummary[].requirements` (the pre-existing always-0 bug).

---

## ContextController Live Intake Preview: One Ghost, Updated In Place (ADR-051 Phase 3)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

**Live preview** (`previewIntake(spec)` / `onIntakePreview`): the IntakePanel RequirementForm fires `spec = {lo, hi, unit, label}` (or `null`) as the admissible interval inputs change; the controller drives **one** `UncertaintyGhostView` (`_intakeGhost`, sole owner — created on first valid `[lo,hi]`, disposed in `previewIntake(null)` and `exit()`, PHILOSOPHY #4/#9). Subsequent keystrokes call the **additive** `UncertaintyGhostView.setIntervalPreview({interval,nominal,labelText})`, which only moves / rescales the band + extremes + nominal wire and rewrites the label — **no geometry rebuild** (the band is a unit box driven by `scale`; entity dims and the non-axis band center are fixed at construction). The camera is framed **once** when the ghost first appears (re-framing per keystroke would be disorienting). `setIntervalPreview` is a **no-op while collapsing** (`_phase !== 'idle'`) so the snap animation owns the band; it is purely additive so `ContextDemoController` is untouched. `tick()` pulses `_intakeGhost` whenever it exists (negotiate mode only). The React form clears the preview on unmount (tab switch / `Section` collapse) and after a successful submit via a `useEffect` cleanup + explicit `onPreview(null)` — completion is event-driven, never left dangling. A committed requirement records an admissible interval, **not** a Decision, so the preview clears without a collapse animation (PHILOSOPHY #11 — never fake a Decision-driven convergence).

---

## NL Intake Bridge Is Pure, Deterministic, and Conservative (ADR-051 Phase 4)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

**`NlIntake.extractFacts(utterance)`** (`src/context/NlIntake.js`) is pure — input-immutable, no I/O / THREE / DOM, loads under bare `node --test`. Per ADR-044 it is a *homomorphism that maps only to the fixed Fact schema* — it never generates arbitrary structure. Per ADR-051 §Negative it is **conservative**: a definite number → `asserted {value, unit}`; anything vague (約/range/hedge word) or explicitly unknown → the literal `attrs[key] = "unknown"` with `status:'unknown'` (raising a validator-R1 OpenQuestion the FormPanel later resolves, fixed only by a Decision — ADR-046 invariant 2); the raw estimate/range is preserved in `note` for traceability. Un-parseable segments are returned in `unparsed`, **never silently dropped** (PHILOSOPHY #11). Attribute keys are sanitised to contain no `.` (FormApplication splits its `target` on `.`). The React `NlIntakeForm` calls `extractFacts` **directly** for a live preview (pure, no controller round-trip); only commit is a side effect: `onAddNlFacts(facts)` → `ContextController.addNlFacts` folds the batch with `DocBuilder.addFact` into one `afterDoc` and pushes a **single** `createAddDocEntryCommand` (one undoable mutation for the whole batch — CODE_CONTRACTS push vs execute). The preview is review-before-commit: the user sees extracted facts (asserted vs 未確定) before they enter the doc. **Additive `canonical` record (ADR-052 §2.2)**: `buildFact` also attaches `canonical = {subject, attr}` (canonical keys via `SynonymQuotient.canonicalKey`, `null` for out-of-quotient terms, the whole field **omitted** when both are null). The surface `subject`/`attrs` stay **verbatim** — `canonical` is a NEW field, never a replacement, so it is **inert** in `addFact` (which spreads the fact whole), the validator (no `given[]` field whitelist), and the narrator (renders `node.label`=verbatim subject + node *kind*, never this field). It closes the φ-lexicon side of the round-trip with the same dictionary `ProvenanceNarrative` uses for φ⁻¹; do **not** wire `canonical` into rendering (that would change output and break the additive guarantee). Domain nouns (robot/reach/カメラ) lie outside the 5W1H quotient → no field; test with a quotient term (`設計変数`→`variable`, `constraint`→`constraint`). Caveat: a quotient term containing a vague-marker substring (e.g. `制約` ⊃ `約`) is downgraded by the pre-existing hedge-word path before canonicalisation.

---

## ContextController Form + Persistence: AnswerQuestion Goes Through CommandStack; `.ctx.json` Is the Project File (ADR-050 Phase 4)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

**Form intake** (`answerQuestion(qRef, question, answer)`): snapshot `beforeDoc = getDoc()`, apply pure `applyQuestionAnswer(beforeDoc, question, answer)` → `afterDoc`, create `createAnswerQuestionCommand(ctxService, qRef, beforeDoc, afterDoc, vc)` + `_commandStack.push()` — a form answer is one undoable doc mutation that **regenerates** (unlike approval which is geometry-invariant). Re-projection (form shrinkage) is event-driven: `applyContextDoc` → `contextChanged` → `_reproject()` → `contextSetForm(projectForm())` — one path for answer/undo/redo (PHILOSOPHY #5). The form is empty exactly when `projectForm()` returns `[]` — completion is machine-checkable (PHILOSOPHY #11). **`.ctx.json` persistence** (`importContextFile`/`exportContextFile`): import = file picker → `JSON.parse` → `_loadThen(doc, _startNegotiation)` (scene regenerated, undo cleared — project-open boundary matching `_onContextLoaded`); export = `JSON.stringify(getDoc())` download (the doc IS the artifact — §5, no conversion). `_startNegotiation` populates `context.form` + `context.actors` in the context slice; when `form.length > 0` the tab defaults to `'questions'`. `FormPanel.jsx` renders `context.form` with answerKind-specific widgets (quantity / actorRef / kpiCriterion / requirement); `FormApplication.applyQuestionAnswer` is the pure doc-mutation complement of `FormProjection.projectForm`. `AnswerQuestionCommand` before/after are doc **snapshots** (never deltas) — the same PHILOSOPHY #6 pattern as `EditAdmissibleCommand`.

---

## ProvenanceTree Is Pure φ⁻¹ Over the Canonical Doc; Adds No Data Structure (ADR-052)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`src/context/ProvenanceTree.js` (`buildWhyTree(ctx)` / `recoverProvenance(ctx, entityRef)`) is pure — input-immutable, no THREE / DOM / I/O, loads under bare `node --test`. It adds **no new doc field**: it synthesises the already-scattered Why/How/What relations (`intents[].parent`, `requirements[].kpi/criterion/constrains`, `decisions[].resolves/relaxes`, `obligations[].dependsOn`, `acceptance[].requires`, `specification.trace[]`, and the `$fact`/`$decision` markers inside `specification.layout`) into one typed node + edge graph. **Every edge is oriented derived→source (What-ward → Why-ward)** so climbing them from a scene entity recovers its Why; `whyRoots()` are the Why-layer nodes nothing climbs above (Intent apex for factory-style docs, Requirement/KPI apex for cell-style docs). Marker collection (`_collectMarkers`) deliberately **does NOT resolve** `$fact`/`$decision` values — unlike `ContextCompiler.extractProvenance`, which calls the resolver and throws on an unresolvable doc — because provenance recovery must be total on a structurally-present but uncompilable doc (PHILOSOPHY #11: never crash the explainer). `recoverProvenance` surfaces the constrained `variables` rather than re-implementing R6: the measured-vs-target **Gap** stays owned by `validateContext().conflicts` (keyed `conflict_<variable>`), so the caller joins it in by variable ref. `ContextService.recoverProvenance(sceneId)` reverses `_refToId` (scene id → layout ref) then delegates to the pure function (the service holds no pure logic — PHILOSOPHY #3); `whyTree()` / `recoverProvenance()` return `null` before a doc is loaded (freshness-owning accessors, PHILOSOPHY #23).

---

## Why Breadcrumb: Selection Is the Single Provenance Trigger; the Gap Join Lives in the Service (ADR-052 Phase 2)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

The Why breadcrumb (`src/components/Context/WhyBreadcrumb.jsx`, presentational, bound to `context.provenance`) shows the φ⁻¹ provenance of the **selected** scene entity in negotiate mode. **`AppController._syncContextProvenance()` is the single authoritative reader** of selection state → `ContextController.showProvenance(id|null)` (PHILOSOPHY #5/#23): it is called from `_switchActiveObject` (select path) and from `SelectionManager.setObjectSelected` / `finalizeRectSelection` (deselect + multi-select paths) — the three places where the active selection changes while the N-panel is hidden under the overlay. It shows a breadcrumb only for a **single** selected, context-derived entity; multi-select, deselect, a non-derived entity (`found:false`), or any non-negotiate mode clears it (no stale breadcrumb — PHILOSOPHY #11). `showProvenance` auto-switches the inspector to the `'why'` tab so a click surfaces the Why immediately (ADR-052 §3 "scene operation → provenance presentation"). The R6 **Gap** join is owned by `ContextService.recoverProvenance` (additive `gaps[]` field: `validateContext().conflicts` filtered to the entity's constrained `variables`, with a `resolved` flag from `resolvedBy`) — NOT by the pure `ProvenanceTree.recoverProvenance`, which only returns `variables` (the service is the one place holding both halves). `ContextController._reproject()` re-joins the Gap for the tracked `_provenanceSceneId` so approval / region edit / undo / redo refresh the breadcrumb through the one re-projection path (PHILOSOPHY #5). `context.provenance` is selection-transient: reset by `contextStart` / `contextEnd`.

---

## Why Tree Overview Is the Whole-Doc Complement to the Selection-Driven Breadcrumb (ADR-052 Phase 3)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`WhyTreeView` (`src/components/Context/WhyTreeView.jsx`, presentational, bound to `context.whyTree`) renders the **entire** canonical doc as the single Why-rooted 5W1H tree (`buildWhyTree` `{nodes, edges, roots}`), grouped Why → How → What with the Why **roots** (`roots` — apexes nothing climbs above) surfaced first with a `▲ root` badge. It is the bird's-eye complement to the selection-driven, single-entity `WhyBreadcrumb` (Phase 2) — the two share presentational primitives (Layer / Tag / cardStyle) so they read as one family. The tree is pushed by `ContextController._startNegotiation()` (`ui.contextSetWhyTree(this._ctxService.whyTree())`) and re-pushed by `_reproject()` in negotiate mode, so add / answer / region-edit / undo / redo all reshape it through the **one** re-projection path (PHILOSOPHY #5). `context.whyTree` is reset by `contextEnd`. No new doc field and no pure/service-layer change — `buildWhyTree` / `ContextService.whyTree()` were implemented and tested in Phase 1 (ProvenanceTree contract: the tree synthesises already-scattered doc relations, adds no data structure).

---

## SynonymQuotient Is the Quotient Map; ProvenanceNarrative Is the doc → NL Return Leg (ADR-052 Phase 4)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`src/context/SynonymQuotient.js` (`canonicalize` / `canonicalKey` / `localize` / `localizeOperator` / `operatorSymbol` / `synonymsOf` / `QUOTIENT_TABLE`) and `src/context/ProvenanceNarrative.js` (`narrateProvenance` / `narrateWhyTree`) are pure — input-immutable, no THREE/DOM/I/O, load under bare `node --test`. ADR-052 §2.2 defines Mutual as **structural isomorphism on the quotient by synonyms**: `canonicalize(term)` projects a surface term onto its equivalence-class key (φ on the lexicon), and `localize(key, lang)` picks **one** representative back out — never the full preimage, which φ⁻¹ cannot restore (ADR-044 §φ⁻¹). The narrator renders the `recoverProvenance` result (with the service-joined `gaps[]`) and the `buildWhyTree` overview into prose **through** `localizeOperator` so a `criterion.op` like `'>='` reads "10 以上" / "at least 10" — faithful **up to synonym**, the exact contract, not more. An unknown operator/term passes through verbatim (never crashes — PHILOSOPHY #11); `QUOTIENT_TABLE` is `Object.freeze`d and adding a row widens the quotient without touching either bridge (the extension point ADR-052 Negative names). `ContextService.recoverProvenance(sceneId, opts)` attaches the narration **additively** as `narrative` (computed after the gap join, so it flows through the existing `showProvenance` / `_reproject` push paths — PHILOSOPHY #5); `whyTreeNarrative(opts)` returns `null` before a doc loads (#23). The service holds no pure logic — it delegates to the two modules (#3). `WhyBreadcrumb`/`WhyTreeView` render the prose as a plain-language block above the structured cards (the narrator import in `WhyTreeView` is a pure call, same altitude as its existing inline grouping). This closes the round-trip with `NlIntake.extractFacts` (φ: NL → doc, ADR-051 Phase 4): the two bridges meet at this one dictionary.

---

## A Requirements-Only Doc Has No Renderable Layout; Every Entry Path Must Accept It (ADR-051 Entry A / ADR-050)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

An authoring-stage Context doc can be valid yet derive **no** 3-D scene: a **blank doc** (`createBlankDoc` — ADR-051 Entry A) intentionally has no `specification` at all, and a **requirements-only doc** (e.g. `examples/cell_phase2_context.json` — "要求のみを検証する空レイアウト") has `specification.layout.entities: []`. Both must load without error. Two guards enforce this. **(1) `ContextValidator` R3 (orphan-spec) is gated on `ctx.specification !== undefined`** — it only enforces "`specification.layout` must be an object" once a specification is actually present, so a blank doc validates `valid:true` instead of failing (which made `adoptDoc` throw "specification.layout must be an object" on **New Context** / the *空のプロジェクト* template). The example/factory docs all carry a specification, so their behaviour is unchanged. **(2) `ContextService.loadContext` derives an empty scene when `compiled.layoutDsl.entities` is empty** — it must NOT call `compileLayout` on an empty layout, because `LayoutValidator` rejects an empty `entities` array (a legitimate guard for the CLI layout path, ADR-045, kept strict). `loadContext` also checks `validatorResult.valid` and throws a clean message **before** compiling (matching `adoptDoc`), and the empty scene-JSON payload is the shared `_emptyScene()` helper (used by both `adoptDoc` and the empty-layout branch). Without these, the *ロボットセル — シンプル* (`cell_phase2`) template threw "entities array must not be empty". `_rebuildDerivation` is safe on an empty layout (empty ref/link maps). **(3) `AppController._onContextLoaded(compiled)` must accept `compiled === null`** — `adoptDoc` emits `contextLoaded` with `compiled: null` (a blank doc has no compiled layout), and the scene-side handler's camera-fit loop dereferenced `compiled.layoutDsl.entities` → `TypeError: Cannot read properties of null (reading 'layoutDsl')`, surfaced as the **"Null"** toast on **New Context** and the *空のプロジェクト* template (the previous fix touched only validate/load, never this event sink). Use `compiled?.layoutDsl?.entities ?? []`; the empty-box branch already frames the default camera. **(4) `ContextService.applyContextDoc({regenerate})` must mirror load/adopt** — `AddDocEntryCommand` (intake add) always passes `regenerate:true`, but the branch unconditionally called `compileContext(newDoc)` (throws `reading 'layout'` on a spec-less doc) then `compileLayout` (throws `entities array must not be empty` on a requirements-only doc). Gate it: `newDoc.specification === undefined` → `compiled=null`, `scene=_emptyScene()` (no compile); else compile and pick `compileLayout` vs `_emptyScene()` by `entities.length>0`. Only call `_rebuildDerivation(compiled)` when `compiled` is non-null; when null, reset the four ref/trace/link maps to empty (same as `adoptDoc`). The shared value across all four guards: a doc at the requirements/authoring stage is a first-class state, not a malformed compiled doc — accept it on every entry path (validate, adopt, load, **the contextLoaded event handler, and the regenerate path**).

---

## GraspController Owns the Grasp FSM as a Discriminated Union; the Panel Is the `'grasp'` Tab, Not a Modal; Scoring Reads Only the Contract (ADR-054 thread, ADR-057 placement + state machine)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

The UI→DSL→BFF→grasp-search walkthrough now lives in its own coordinator **`src/controller/GraspController.js`** (split out of `ContextController` for single responsibility — §1.1), a persistent overlay like `MapModeController` (NOT a `setMode()` FSM state — ADR-057 §H), constructed as `new GraspController(this, useUIStore)` (the uiStore is **injected**, not statically imported, so its FSM unit-tests run THREE/`node_modules`-free in the `test:context` lane — `GraspController.test.js`, 11 tests). Its **only** legitimate Layout DSL source is the intermediate `ContextService.getCompiled()?.layoutDsl` (the Context-first canonical route — ADR-050/046; never the `decompileLayout` reverse compiler, ADR-055, which stays unwired from the Context flow — the single-canonical invariant). `context.grasp` is a **discriminated union on `status`** (`idle`/`no-layout`/`compiling`/`solving`/`results`/`error`) **replaced wholesale** by `contextSetGrasp(state)` (never merge-patched), so illegal states (`candidates` while `error`, `results` while `solving`) are unrepresentable; `GraspController` is the **sole writer** of every transition (PHILOSOPHY #5) and the panel only reads. `runGraspSearch({weights,topN})` is the linear BPMN flow `compiling` (Step A `bff.compileLayout` round-trip verify) → `solving` (Step B `bff.graspSearch`, BFF stamps `contractVersion` + delegates) → `results` | `error{stage:'compile'|'solve'|'bff'}`; it ensures a JWT'd `BffClient` via `SceneService.connectBff()` on demand, is a **query not a doc mutation** (geometry invariant → **never** on the CommandStack, unlike approve / answer / region-edit), and Run is a no-op mid-flight (no overlapping requests). Any `BffUnavailableError` → `error{stage:'bff'}` regardless of step; 400/502/503 surface their reason. The UI **must not** set `contractVersion` (the BFF stamps it; a present mismatch is 400). **Placement (ADR-057 §B)**: the panel is the **`'grasp'` tab inside the production `ContextLayer`** (negotiate mode), not a central modal — the old top-level `graspPanelOpen` flag + `setGraspPanelOpen` are **removed**; entry authority is `inspectorTab === 'grasp'` (the tab shows once `context.grasp` is seeded). It rides on `ContextLayer`'s existing 280px dock, so **no new screen-edge footprint and no `_updateGizmoOffset` term** (PHILOSOPHY #26 — riding on, not adding). **Scoring (ADR-057 §F)**: built from the contract `score` only — the 3 boolean chips + labelled `objectiveScores` bars (objective→0..1, comparable across requests) + client-side sort (never re-runs the query); the opaque `pose` is **never** interpreted into 3-D (spatial ghosts deferred to ADR-059; `selectCandidate(rank)` sets `selectedRank` as the future ghost hook seat — a pure highlight here). The BFF endpoints + `vendor/grasp-contract` submodule are reused **unchanged** (scope boundary — the UI declares, it never solves).

---

## Grasp Ghost Is a Gate-Kept Derived Projection; the View Is Factory-Injected; the Frame Convention Lives in ONE Constant (ADR-059 Stage 1)

The stage-1 spatial ghost translates the **typed** wire facts (`pose.kind:'endEffector'` cartesian frame + `score`) into a client-derived 3-D presentation (PHILOSOPHY #29 — nothing here is ever demanded back as a wire field; the approach vector is the −Z frame convention, not an `approachVector` field). Contracts:

- **Capability gate is one pure function, shared by controller and panel.** `renderableEndEffectorFrame(pose)` (`src/view/GraspGhostMath.js`, pure/THREE-free) is the ONLY decision point for "does this candidate get a ghost": `kind === 'endEffector'` + shape check (position length-3 finite numbers, orientation length-4). `GraspController._syncGhost` and `GraspSearchPanel`'s `PoseFooter` caption both call the SAME function — a failing pose gets no ghost AND an honest "spatial view unavailable" caption (PHILOSOPHY #11; heuristic interpretation of opaque/`jointSpace` poses is forbidden). Never duplicate the check inline (§1.1).
- **`GraspGhostView` is factory-injected, never statically imported into `GraspController`.** The view imports THREE; the controller's tests run in the THREE/`node_modules`-free `test:context` lane. AppController passes `deps.createGhostView`; absent factory = ghost path degrades to a no-op. The pure `GraspGhostMath` import is fine (THREE-free).
- **Hover is controller-local, never in the `context.grasp` union.** The ghost is a *derived projection* of `results.selectedRank` + pointer hover (ADR-059 §C — no new FSM); `_hoverRank` lives on the controller, and `contextSetGrasp` payloads never carry it.
- **Ownership & disposal boundaries (PHILOSOPHY #4/#9)**: `GraspController` is the sole owner. `clear()` on every transition out of `results` (new run, idle re-seed); `disposeGhost()` from `ContextController.exit()` (the negotiate overlay is the ghost's host). `tick(t)` is driven from AppController's loop — note the loop clock is **seconds**, the view's animation constants are **ms**; the controller converts (`t * 1000`).
- **The `frame` base-frame assumption is sealed in `FRAME_CONVENTION`** (single exported constant in `GraspGhostView.js`, surfaced in the caption as `frame: world (assumed)`). Upstream has not specified world vs base-link; when it does, that one line changes. Machine check: grep must find exactly one definition + caption reference.
- **Target highlight never touches `cuboidMat.emissive`** (owned by `_syncEmissive()` — "Visual State Ownership"): the view adds/disposes its own `EdgesGeometry` overlay over the target's baked world-space geometry (the BoxHelper rule). Nearest-target pick (`nearestTargetIndex`) is display-only proximity — permitted by "Centroid Is Validation-Only", never fed back into state.

---

## LayoutDecompiler Is the Scene→DSL Normal-Form Inverse; the Scene Fixpoint Is the Law; Context Stays Canonical (ADR-055)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`src/layout/LayoutDecompiler.js` (`decompileLayout(sceneJson) → {dsl, warnings}`) is the pure, THREE-free, `node --test`-loadable inverse of `compileLayout` — it makes **Scene ⇄ Layout DSL Mutual at the geometry (What/How) layer only**. Because `compileLayout` is many-to-one (strategy folds positions; `ref` is slugged into ids) a byte-identity inverse is impossible; the inverse emits the **canonical representative** (`strategy:'manual'` + explicit `position`; refs recovered by stripping the `ENTITY_PREFIX`, already slugged so stable under recompile). The contract is the **scene fixpoint law**: `compileLayout(decompileLayout(scene)) ≡ scene` for any Layout-DSL-expressible scene (golden-tested against `examples/factory_layout.json`). It mirrors `LayoutCompiler.generateObjects`/`generateLinks` in reverse: dims from `localCorners` (max−min/axis), auto-Origin CFs (name `'Origin'`, parent = Solid) **folded away**, user frames (parent = Origin) folded into `Solid.frames[]`, standalone CFs emitted with `parentRef`, links → constraints via an id→ref map covering the entity / `<ref>_origin` / frame namespaces; entities are built in **scene object-array order** so recompile reproduces the same object order (required for deep-equality). **Additive expressiveness**: a Solid's body `orientation` round-trips via the new optional `rotation` field on Layout DSL Solids (default identity; additive **within layout/1.0** — NO version bump, since the strict-equality validator must keep accepting existing `layout/1.0` docs including `factory_context.json`'s `specification.layout`; identity is normalised away on decompile). **Honest gaps**: scene types with no DSL representation (`ImportedMesh`/`MeasureLine`/`Profile`) and links with an unconvertible endpoint go to `warnings[]`, never silently dropped (PHILOSOPHY #11). **Scope boundary**: `decompileLayout` recovers only What/How geometry — it NEVER reconstructs Why/Context (the scene drops Why, ADR-052 §1) — and is for the **non-Context authoring path**. When a Context doc is loaded the canonical Layout DSL remains `ContextService.getCompiled().layoutDsl` (ADR-054); decompile is deliberately NOT wired into the Context flow (avoids the two-canonical-artifacts divergence ADR-050 §2.1 / ADR-052 §2.4 rejected).

---

## CanonicalForm Is the Computed WL Normal Form on the Quotient; Colours Need a FIXED Round Count to Be Cross-Doc Comparable (ADR-056)

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`src/context/CanonicalForm.js` (`canonicalForm` / `verify` / `canonicalSignature` / `structuralDiff` / `reconcile`) is pure, THREE-free, input-immutable, `node --test`-loadable, and **adds no doc field** (synthesise, never persist — the ProvenanceTree precedent). It *computes* what ADR-052 only *declared*: the structural isomorphism on the synonym quotient, as a **ref-name- and order-invariant Weisfeiler–Leman colour-refinement signature** over `buildWhyTree`'s 5W1H graph (the doc-layer generalisation of the ADR-055 scene fixpoint). Depends ONLY on `buildWhyTree` (ProvenanceTree) + `canonicalKey`/`operatorSymbol` (SynonymQuotient). **The non-obvious invariant: WL must run a FIXED `WL_ROUNDS` (16), NOT an early stop on partition stability.** A doc-dependent round count hashes a *sink* node (a node with no up-neighbours, e.g. a leaf requirement) a different number of times in two docs, so its colour stops being equal across docs — silently breaking `reconcile`/`structuralDiff`, which both align nodes by **cross-doc colour equality**. A fixed round count makes a colour the hash of the node's depth-h unrolled neighbourhood, comparable across any two docs; 16 ≫ the diameter of the small rooted near-tree DAGs this targets, so it is fully refined in practice (the §2.2 "WL-equivalence, not full canonical form" honesty — PHILOSOPHY #28). **`identityPayload`** holds only ref-free canonical scalars (criterion `op` folded through the quotient + `value`; KPI `unit`; and the KPI `expr` normalised to its **ref-invariant shape** by collapsing every identifier/ref-path to a `_` placeholder — `f_cam.px / fov(v_x)` → `_/_(_)` — so a `ref` rename never leaks into the signature); labels and standalone domain nouns are deliberately excluded (outside the quotient, §2.1). `docSignature`/`rootSignature` are FNV-1a hashes (self-contained, Unicode-safe) of the sorted colour multiset / Why-root colours. **`structuralDiff` aligns by colour** (matched colour = unchanged) then pairs leftovers by `id` for `changed` (same id, different colour) vs `added`/`removed` — diff is the version-to-version key (id-stable), reconcile is the cross-author key (colour-only). **`reconcile` is maximum matching within each colour class** (structurally indistinguishable → any pairing valid → pair by sorted `ref` for determinism), yielding the `refA ↔ refB` seam. **Finalized output forms (ADR-056 §2.4)**: the module publishes four serializable, deterministic output shapes. **`canonicalForm(ctx) → {version, docSignature, rootSignature, roots:[{ref,kind,color}], nodes:[{ref,kind,layer,color}]}`** is the finalized **JSON-serializable, versioned** normal form (`CANONICAL_FORM_VERSION = 'canonical-form/1.0'`, house style cf. `context/0.4`/`layout/1.0`) — it carries **no `Map`** and never leaks the internal ProvenanceTree `data`/`label`/id (node identity is the doc-meaningful `(kind,ref)`, unique by construction; nodes sorted by layer→colour→ref). **`canonicalSignature` stays the internal `Map`-based primitive** that `structuralDiff`/`reconcile` consume directly; it now additively returns `roots` (Why-apex node ids) so `canonicalForm` can project them — non-breaking. **`verify(a, b) → {equal, rootEqual, docSignature:{a,b}, rootSignature:{a,b}}`** is the ADR §2.3 *verify* op (`equal ⇔ docSignature(a)===docSignature(b)`, the computed form of the ADR-052 Mutual round-trip); when unequal, `structuralDiff` explains the difference. **Scope boundary (§3)**: this is the deterministic core that *decides* equivalence/correspondence; embedding/similarity ranking for quotient-unresolvable terms is out-of-scope (an external *proposal* layer, never inside this decision). 25 tests in `CanonicalForm.test.js`; diff/reconcile/canonicalForm are NOT yet wired to any UI (pure layer only).

---

## CoordinateFrame ROS TF Local-Frame Semantics

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`cf.translation` and `cf.rotation` are **parent-local** (ROS TF / URDF style). World pose is derived by `_updateWorldPoses()` via forward kinematics: `worldPos = parentWorldPos + parentWorldQuat * translation`; `worldQuat = parentWorldQuat * rotation`. `Solid.bodyRotation` is the parent world quaternion for direct children. Grab delta must be converted to local before `cf.move()`: `localDelta = worldDelta.applyQuaternion(parentWorldQuat.conjugate())`. N-panel displays and edits in local space directly — no conversion needed.

---

## TC Gizmo Does Not Block Object Selection

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`if (this._tcDragging) return` must appear BEFORE the entire `if (result)/else` block in the object-mode section of `_onPointerDown`. Two failure modes: (a) TC arrow outside Solid — `_hitAnyObject()` returns null, else-branch would deselect; (b) TC arrow overlapping a Solid — `_hitAnyObject()` returns the Solid, `_switchActiveObject` would replace `_activeObj` + re-attach TC proxy to the Solid, causing `objectChange` to look up the wrong id in `_tcStartCorners` → CF never moves. Empty-space touch tap (no TC, no entity) deselects normally.

---

## Proof-Feedback Presentation: Shared Primitives, Fact-Fed Only, History Is Component-Local (ADR-062 Phase 1–3)

The proof-feedback loop (input → proof layer decides a fact → client derives the "it worked" presentation) is the default shape for every input/result surface (PHILOSOPHY #29 scope note). Contracts:

- **The primitives are shared, never re-implemented inline.** `DeltaChip` / `LandingFlash` / `flashAnim` / `FeedbackDefs` / `usePrevOnChange` live in `src/components/Feedback/FeedbackPrimitives.jsx`; the pure snapshot comparisons (`refsSignature` / `listDelta` / `settledRefs`) live in `src/view/FeedbackMath.js` (THREE-free, `test:context` lane). A new input surface wires these — it does not grow its own delta/flash logic (§1.1; the pre-ADR-062 state where `DeltaChip` lived inside `GraspSearchPanel` is the anti-pattern).
- **Inputs are always proof-layer facts.** `projectForm()` open questions, validator `conflicts` (`resolvedBy`), projected matrix `variableSummary` (`approved`), resolution-order `approved`, contract `diagnostics`. The presentation layer never re-judges (no client-side re-validation, no guessed identity: an unkeyable snapshot degrades the whole comparison to `null` — #11).
- **The previous snapshot is component-local presentation state.** `usePrevOnChange` keeps it in React state — NEVER a uiStore field and NEVER a wire field (same rule that keeps grasp hover out of the `context.grasp` union, ADR-059). It updates only on a *real* change: `refsSignature` absorbs the store's array-identity churn on re-projection, so a repaint never reads as "something happened".
- **Zero / null renders nothing.** `DeltaChip` hides on 0/null; `LandingFlash` with `active:false` or a null tick is a plain div. Silence is the honest rendering of "no change", not a failure.
- **Keyframes mount once per overlay root.** `FeedbackDefs` is mounted by `ContextLayer`, demo `ContextInspector`, and `IntakeSharedDefs`; duplicates are harmless (identical keyframes), but an overlay that renders a flash without any mounted defs silently animates nothing — mount the defs with the overlay.

## Checks Surface: Verdicts Verbatim, One Meter Curve, Blocked Means No Meter (ADR-062 Phase 4)

The `'checks'` tab surfaces the validator's acceptance verdicts with measurement feedback. Contracts:

- **`ContextService.projectChecks()` is the one join point.** It merges `validateContext().checkResults` (validator-owned verdicts, verbatim) with each check's predicate from the canonical doc (the instrument-baked operands, ADR-053 §9) — the same service-glue shape as the ADR-052 Gap join. `ContextController` pushes it into `context.checks` on negotiate enter and in `_reproject()` (one path — approve / answer / edit / undo all repaint the verdicts through it, PHILOSOPHY #5).
- **Status changes need a status-aware snapshot.** `refsSignature` alone misses a status flip on an unchanged check set, so `CheckFeedbackMath.checkStatusKeys` encodes `ref:status` pairs for `usePrevOnChange`; `checkTransitions` reports only refs present on both sides whose status changed. Any unkeyable entry degrades the whole snapshot to `null` (#11).
- **The near-miss meter is the ADR-061 curve, imported.** `checkMeter` derives worst margin/clearance vs the predicate's own threshold (`marginMin` / `clearance`, default 0) from the baked operands and computes `closeness` via `nearMissCloseness` — one "so close" curve across the grasp funnel and the checks panel; never a second curve. Raw worst / required numbers are always printed next to the fill (ADR-061 discipline).
- **A blocked check gets no meter.** Its operands were never evaluated (R5 blocks before the engine runs); rendering a meter over unevaluated data would fabricate a judgment. The card shows the blocking question refs instead — the Questions tab is the unblock path, and the resulting `blocked→pass` flip is what the landing flash celebrates.

## Template Structure Preview Derives From the Canonical Form and Never Compares (ADR-062 Phase 5)

`TemplateGallery` example cards show a structure preview (Why/How/What stacked bar + counts + `⌗` signature prefix). Contracts: the fact is `canonicalForm(doc)` (ADR-056 — the versioned WL normal form); the card shape is the pure `structurePreview` in `src/view/TemplatePreviewMath.js`, which only counts nodes per 5W1H layer and truncates `docSignature` for display. It never recomputes colours, never diffs/reconciles two docs, and never ranks similarity (out of scope — ADR-056 §3). `ContextController._templatePreviews()` derives the map once from the bundled `TEMPLATE_DOCS` (memoized; a doc whose derivation throws gets `null` → the card renders no preview, #11) and pushes it as `templateGalleryPreviews` when the gallery opens.
