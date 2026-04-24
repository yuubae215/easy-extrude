# Code Contracts — easy-extrude

Accumulated rules and policies derived from real bugs and design decisions.
Full details in `docs/code_contracts/`.
**Read the relevant detail file before modifying code in that area.**

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

1. Add/edit the rule in the relevant detail file in `docs/code_contracts/`.
2. Update the summary row in the index table below.
3. Commit together with the code change that motivated it.
4. If the rule is substantial, create an ADR first and link it here.

---

## 1. Architecture & State Management

Detail: `docs/code_contracts/architecture.md`

| Rule | Core Takeaway |
|------|--------------|
| Mode Transition Flow | `setMode()` is the single entry point; always call `setMode('object')` before `_switchActiveObject()` from edit mode |
| State Restoration on Mode Exit | Restore `_objSelected = true` + `setObjectSelected(true)` when returning to Object mode if `_activeObj` exists |
| Entity Capability Contracts | Use `instanceof` not `dimension`; `Sketch.extrude()` returns new Cuboid swapped via `SceneService.extrudeSketch()`; ImportedMesh/CoordinateFrame have restricted capabilities; MeasureLine supports 1D Edit Mode (endpoint drag via `_enterEditMode1D`) |
| MeasureLineView No-Op Interface | Every `_meshView` method called in AppController must exist as a no-op or real impl on MeasureLineView; `setEndpointHover(index)` and `clearEndpointHover()` are real impls used in `'1d'` edit substate |
| Measure Snap Display | Use `_measure.snapMeshView` (not `_meshView`) for all snap display during measure placement |
| MeasureLineView Label Lifecycle | Call `updateLabelPosition()` every animation frame for every MeasureLine in scene |
| CoordinateFrame Depth Rendering | Hidden by default; `setParentSelected()` controls visibility+X-ray; `setObjectSelected()` only changes sphere color |
| ~~Auto Origin Frame~~ | ~~`createCuboid()`, `extrudeSketch()`, `duplicateCuboid()` each call `createCoordinateFrame(id, 'Origin')`~~ **Superseded by ADR-033** — CoordinateFrame is created only with explicit user intent (interface contract); no auto-generation on Solid creation |
| Command Factory Naming Convention | All commands use `createXCommand` factory exports; never class-style `XCommand`. Import and call site must match the export name exactly |
| CommandStack push() vs execute() | `_confirm*()` handlers use `push()` (post-hoc recording); never use `execute()` for already-completed operations |
| Post-Hoc Push Requires Prior Service Call | UI class-change callbacks (`onIfcClassChange`, `onLynchClassChange`) must call the service method **before** `push()`; `push()` alone is a no-op — the domain object is never updated |
| Entity Swap Must Emit Events | Any direct `removeObject()`/`addObject()` call must also emit `objectRemoved`/`objectAdded` domain events |
| Soft-Delete Pattern | `_deleteObject()` uses `detachObject()` + `setVisible(false)`; `dispose()` only in cascade-delete and `_clearScene()` |
| N Panel Read-Only Rows | Always pass `val` argument through to `row()`; never substitute hardcoded 0 |
| Euler Angle Convention | Use `'ZYX'` order (= ROS RPY); never `'XYZ'` for CoordinateFrame rotation display |
| Mouse Rotation Sign | `angle = startAngle - currentAngle` (not reversed); mouse-driven path only |
| Visual State Ownership | `hlMesh.visible` owned by `setFaceHighlight()`; `boxHelper.visible` by `setObjectSelected()` |
| Frame View Must Be Hidden Before Detach | `AddSolidCommand.undo()` must call `meshView.hide()` + `hideConnection()` before `detachObject()`; after detach `_scene.getObject()` returns null so `_hideFrameChain()` silently skips the frame |
| _updateMouse Before Coordinate Picking | Call `_updateMouse(e)` immediately after the canvas guard in `_onPointerDown`; touch devices have no preceding `pointermove` so `_mouse` is stale at first tap |
| CommandStack Clear After Init | Call `_commandStack.clear()` at the end of the constructor after `_addObject()` + `setMode()`; the auto-created initial solid must not appear in undo history |
| Urban Placement Confirm No Auto-Select | `_confirmUrbanPlacement()` must NOT call `_switchActiveObject()` after creating the entity; previous selection is preserved and toolbar returns to initial object-mode slots |
| Rect Selection Null Cuboid Guard | `_finalizeRectSelection()` must use `obj.meshView.cuboid?.visible` (optional chaining); Urban entities and CoordinateFrame return `null` for `.cuboid` and would throw TypeError without the guard |
| CoordinateFrame.localOffset vs Geometry.corners | `CoordinateFrame` exposes `localOffset` (LocalVector3[]); geometry exposes `corners` (WorldVector3[]). `.corners` does NOT exist on `CoordinateFrame`. Use `_grabHandlesOf(obj)` for grab/move; use `_worldPoseCache` for world position. (PHILOSOPHY #21 Phase 3) |
| HTML Overlay Active Camera | Views projecting 3D→screen for HTML labels must use `SceneView.activeCamera`, not `AppController._camera` (perspective-only); pass `this._sceneView.activeCamera` at each animation-loop call site |
| TC Gizmo Force-Update After Proxy Repositioning | Call `_tc.getHelper().updateMatrixWorld()` after `tc.attach()` in `_attachMobileTransform()`; call `_service._updateWorldPoses()` before `worldPoseOf()` in `_syncMobileTransformProxy()`; call `_syncMobileTransformProxy()` from `_toggleTcMode()` |
| TC Gizmo Hit Guard Before Object Selection | In `_onPointerDown`, raycast against `_tc.getHelper()` before `_hitAnyObject()` when TC is attached; return early if hit — otherwise the ray pierces TC handles to hit objects behind them, switching active object and gizmo mode unintentionally |
| TC Mode Must Match _tcMode | `_attachMobileTransform()` must set `_tcMode = 'translate'` in the non-CoordinateFrame branch alongside `tc.setMode('translate')`; `_tcMode` must always reflect the current TC mode for all code paths |
| CoordinateFrame Provenance (ADR-034) | Before Grab / R-key / rename / delete of a CoordinateFrame, call `RoleService.canEdit(frame)`; mismatch → `showToast` and return. `frame.declaredBy` is set to `RoleService.getRole()` at creation time. `window.__easyExtrude.setRole()` / `.getRole()` are the console API entry points |
| CoordinateFrame Scale Cap | `updateScale()` must always receive a finite `maxWorldSize`; use `sceneRadius × 0.3` (floor 1.0) as fallback for CFs without a solid parent — otherwise axes balloon to huge size when zooming out |
| CoordinateFrame Tap Selection | `_hitAnyObject()` never hits a CF (cuboid = null); `_onPointerDown` must call `_hitAnyCoordinateFrame()` as a third fallback. `CoordinateFrameView.group` getter exposes the Three.js Group for `intersectObject()`. Only visible groups are tested. |
| _promptAddFrame Must Select Frame After Creation | After pushing the command in `_promptAddFrame()`, call `_switchActiveObject(frame.id, true)` — otherwise the frame stays hidden in the 3D viewport. Undo restores parent selection; redo re-selects the frame. |

---

## 2. Events & Interaction (Touch/Pointer)

Detail: `docs/code_contracts/interaction.md`

| Rule | Core Takeaway |
|------|--------------|
| Touch vs. Pointer Asymmetry | Re-run hit tests in `_onPointerDown` before `_handleEditClick`; hover does not fire before touch tap |
| Gesture-Based Interaction Priority | Auto-start face extrude on touch tap in Edit 3D; gesture-only, no toolbar button |
| Interaction Confirmation Lifecycle | FaceExtrude confirms on `pointerup`; Grab on touch confirms via toolbar only, never in `pointerup` |
| Grab State: allStartCorners vs segmentStartCorners | `allStartCorners` = undo anchor (never update mid-grab); `segmentStartCorners` = per-drag delta (re-snapshot on re-touch) |
| Global Event vs. UI Event Delegation | First guard in `_onPointerDown`: `if (e.target !== renderer.domElement) return` |
| OrbitControls Disable Strategy | Use `matchMedia('(pointer: coarse)')` not `innerWidth < 768`; disable only for single-finger-consuming ops |

---

## 3. UI & Layout Adaptability

Detail: `docs/code_contracts/ui_layout.md`

| Rule | Core Takeaway |
|------|--------------|
| Mobile Toolbar Stability | Fixed slot counts per mode; use `disabled` + `{spacer: true}` to prevent layout shifts |
| Mobile Touch Gesture Model | Touch: tap=select, one-finger-drag=orbit, long-press=context menu; no rect selection or _objDragging |
| Long-Press Context Menu | `showContextMenu()` with Grab/Dup/Rename/Delete; items filtered by entity type |
| Measure Point Placement | Confirm in `_onPointerUp`; hold shows live snap feedback before release |
| Stack Mode | Ray origin must be Z=10000; runs in both `_grab.active` and `_objDragging` paths |
| Viewport-Aware Z-Index | Toast `bottom: 96px` on mobile (above 86px toolbar); status in `_infoEl` on mobile |
| Mobile Header Overflow | Export/Import hidden on mobile; replaced by `_moreMenuBtn` (⋯) dropdown. `_headerStatusEl` uses `visibility:hidden` (not `display:none`) to remain a flex:1 spacer |

---

## 3.5 Server-Side Async (Node.js BFF)

Detail: `docs/code_contracts/server_async.md`

| Rule | Core Takeaway |
|------|--------------|
| All DB calls must be awaited | Every `sceneStore.*()` call must be `await`ed; async wrappers must use try/catch |
| PRAGMA journal_mode | Run WAL pragma as standalone `db.execute()` before any `db.batch()` |
| Unguarded JSON.parse | Wrap `JSON.parse(row.data)` in try/catch in sceneStore.js |
| occt-import-js Geometry Structure | Extract geometry from `mesh.attributes`, not `mesh.faces` |
| Camera Far Clip for Imports | Call `fitCameraToSphere()` after every `updateGeometryBuffers`; never hard-code `camera.far` |
| setIndex Requires BufferAttribute | Wrap raw `Uint32Array` (e.g. from `base64ToU32`) in `new THREE.BufferAttribute(arr, 1)` before `setIndex()`; plain JS arrays are handled automatically |

---

## 4. Memory Management (Three.js)

Detail: `docs/code_contracts/memory_management.md`

| Rule | Core Takeaway |
|------|--------------|
| WsChannel Listener Cleanup | Save bound handlers as instance properties; `removeEventListener` all 4 in `close()` |
| Read-Only Entity Early-Return | Show `showToast('Imported geometry is read-only')` before any early-return that blocks op |
| Object Lifecycle Symmetry | Every `scene.add()` must have matching `scene.remove()` + `.dispose()` in `dispose()` |
| _clearScene Emit Order | Emit `objectRemoved` for each object BEFORE replacing `this._model` |
| SceneSerializer Entity Coverage | Every domain entity must be explicitly handled (or commented) in `serializeScene()` |
| SceneImporter KNOWN_TYPES Coverage | `KNOWN_TYPES` in `SceneImporter` must include every type in `serializeScene()` + `_deserializeEntities`; add in same commit as domain entity |
| ImportedMesh Serialization | Base64 buffers; restore `cuboid.position` from `offset` BEFORE calling `initCorners()` |
| THREE.Mesh Requires Valid Geometry | Never pass `null` to `new THREE.Mesh(null, mat)` — use `new THREE.BufferGeometry()` as placeholder; `updateMorphTargets()` throws on null geometry |
| Zone Rim Ring Must Use Polygon Geometry | Use `ShapeGeometry` + polygon hole for the rim ring; `RingGeometry` always produces a circle regardless of Zone shape |
