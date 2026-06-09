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
| Entity Capability Contracts | Use `instanceof` not `dimension`; `Sketch.extrude()` returns new Cuboid swapped via `SceneService.extrudeSketch()`; ImportedMesh/CoordinateFrame have restricted capabilities; MeasureLine supports 1D Edit Mode (endpoint drag via `_enterEditMode1D`); Solid supports R-key rotation — ADR-040 primary triple (`_position`, `orientation`, `localCorners`); world corners derived by `_rebuildWorldCorners()`; `SolidRotateCommand` stores start/end orientation+position for undo; `Solid.bodyRotation` is an alias for `orientation` (backward compat); child CFs follow automatically via ROS TF forward kinematics — no manual CF pose update needed on Solid rotation |
| Solid Pose Mutation Must Use Public API | `_rebuildWorldCorners()` is private to `Solid.js`. External code must never call it directly. For undo/redo and cancel-path restoration use `obj.restorePose(position, orientation)`; for translation drag use `obj.move()`; for rotation drag use `obj.rotate()`; for full deserialization use `obj.setPose()`; for legacy world-corner restoration use `obj.setWorldCorners()`. Stack snap must apply its Z offset via `selObj.move(segStartPos, currentDelta.clone().add(snapZ))` — never `corners.forEach(c => c.z += zOffset)`. See `docs/code_contracts/architecture.md` §"Solid Pose Mutation". |
| Preview Pipeline (applyPreviewTranslation / applyPreviewRotation / applyPreviewEndpointMove) | Entity mutation during live drag previews belongs in `SceneService`. Three methods: `applyPreviewTranslation(segStartCorners, segStartPositions, worldDelta)` — Grab/mouse-drag; `applyPreviewRotation(obj, snap, deltaQ)` — R-key rotate; `applyPreviewEndpointMove(obj, endpointIndex, worldPoint)` — 1D endpoint drag. `AppController` and handler classes compute input deltas and delegate all entity mutation to these service methods. Handler cancel paths must also use service methods to keep view in sync. See `docs/code_contracts/architecture.md` §"Preview Pipeline". |
| Rotate Pivot Must Use `_position` Directly | Any Solid pivot / centroid used in a state-mutating computation must come from `obj._position` (or `.clone()`), never from `getCentroid(obj.corners)`. Affected sites: `_startRotate()`, `_applyRotate()`, mobile re-touch in `_onPointerDown`, TC rotate `objectChange` handler, `_syncMobileTransformProxy`, `_startGrab` (and touch re-drag path), `_attachMobileTransform` legacy fallback, `onLocationChange` delta, Ctrl+drag `_objRotateCentroid`. `getCentroid` is permitted only for read-only display (N-panel, CF scale cap). Rationale: `getCentroid` averages 8 world-space vertex positions — far from the origin the FP rounding feeds back into `_position` each frame and compounds into visible drift (PHILOSOPHY #24 manifestation c). `obj._position` is the ADR-040 authoritative primary triple and carries zero rounding error. TC rotate additionally requires `.clone()` to avoid aliasing: `Solid.rotate()` mutates `this._position` (= `obj._position`) before reading `pivot`, so a direct reference produces `pivot.sub(pivot) = 0`. |
| MeasureLineView No-Op Interface | Every `_meshView` method called in AppController must exist as a no-op or real impl on MeasureLineView; `setEndpointHover(index)` and `clearEndpointHover()` are real impls used in `'1d'` edit substate |
| Measure Snap Display | Use `_measure.snapMeshView` (not `_meshView`) for all snap display during measure placement |
| MeasureLineView Label Lifecycle | Call `updateLabelPosition()` every animation frame for every MeasureLine in scene |
| CoordinateFrame Depth Rendering | Hidden by default; `setParentSelected()` controls visibility+X-ray; `setObjectSelected()` only changes sphere color |
| Auto Origin Frame (ADR-037) | `createSolid()`, `extrudeProfile()`, `duplicateSolid()` each call `createCoordinateFrame(id, 'Origin', null)` immediately after emitting `objectAdded`. Supersedes ADR-033 §3. `_ensureOriginFrames()` migrates legacy scenes on load. User CFs are always children of Origin CF (not direct Solid children). |
| Command Factory Naming Convention | All commands use `createXCommand` factory exports; never class-style `XCommand`. Import and call site must match the export name exactly |
| CommandStack push() vs execute() | `_confirm*()` handlers use `push()` (post-hoc recording); never use `execute()` for already-completed operations |
| FrameRotateCommand Must Call _updateWorldPoses | `FrameRotateCommand.apply()` calls `sceneService._updateWorldPoses()` (not just `invalidateWorldPose()`) so fastened constraints propagate immediately on every undo/redo — matching the `SolidRotateCommand` pattern. Omitting the full pass leaves the source Solid one animation-frame behind after undo. |
| Post-Hoc Push Requires Prior Service Call | UI class-change callbacks (`onIfcClassChange`, `onLynchClassChange`) must call the service method **before** `push()`; `push()` alone is a no-op — the domain object is never updated |
| Entity Swap Must Emit Events | Any direct `removeObject()`/`addObject()` call must also emit `objectRemoved`/`objectAdded` domain events |
| Soft-Delete Pattern | `_deleteObject()` uses `detachObject()` + `setVisible(false)`; `dispose()` only in cascade-delete and `_clearScene()` |
| N Panel Read-Only Rows | Always pass `val` argument through to `row()`; never substitute hardcoded 0 |
| Euler Angle Convention | Use `'ZYX'` order (= ROS RPY); never `'XYZ'` for CoordinateFrame rotation display |
| Mouse Rotation Sign | `angle = currentAngle - segmentStartAngle`; screen-CCW swipe → positive angle → CCW on-screen rotation for both PC and mobile |
| Visual State Ownership | `hlMesh.visible` owned by `setFaceHighlight()`; `boxHelper.visible` by `setObjectSelected()`; `cuboidMat.emissive` owned by `_syncEmissive()` — composes `_selected` (blue 0x112244) and `_constraintViolated` (red 0x550000); never set emissive directly from outside MeshView |
| Frame View Must Be Hidden Before Detach | `AddSolidCommand.undo()` must call `meshView.hide()` + `hideConnection()` before `detachObject()`; after detach `_scene.getObject()` returns null so `_hideFrameChain()` silently skips the frame |
| _updateMouse Before Coordinate Picking | Call `_updateMouse(e)` immediately after the canvas guard in `_onPointerDown`; touch devices have no preceding `pointermove` so `_mouse` is stale at first tap |
| CommandStack Clear After Init | Call `_commandStack.clear()` at the end of the constructor after `_addObject()` + `setMode()`; the auto-created initial solid must not appear in undo history |
| Urban Placement Confirm No Auto-Select | `_confirmUrbanPlacement()` must NOT call `_switchActiveObject()` after creating the entity; previous selection is preserved and toolbar returns to initial object-mode slots |
| Rect Selection Null Cuboid Guard | `_finalizeRectSelection()` must use `obj.meshView.cuboid?.visible` (optional chaining); Urban entities and CoordinateFrame return `null` for `.cuboid` and would throw TypeError without the guard |
| CoordinateFrame.localOffset vs Geometry.corners | `CoordinateFrame` exposes `localOffset` (LocalVector3[]); geometry exposes `corners` (WorldVector3[]). `.corners` does NOT exist on `CoordinateFrame`. Use `_grabHandlesOf(obj)` for grab/move; use `_worldPoseCache` for world position. (PHILOSOPHY #21 Phase 3) |
| CoordinateFrame ROS TF Local-Frame Semantics | `cf.translation` and `cf.rotation` are **parent-local** (ROS TF / URDF style). World pose is derived by `_updateWorldPoses()` via forward kinematics: `worldPos = parentWorldPos + parentWorldQuat * translation`; `worldQuat = parentWorldQuat * rotation`. `Solid.bodyRotation` is the parent world quaternion for direct children. Grab delta must be converted to local before `cf.move()`: `localDelta = worldDelta.applyQuaternion(parentWorldQuat.conjugate())`. N-panel displays and edits in local space directly — no conversion needed. |
| `worldPoseOf()` Self-Healing on Cache Miss | `SceneService.worldPoseOf()` calls `_updateWorldPoses()` when the requested frame is not in `_worldPoseCache`. Do NOT add per-call-site guards (`if (CF) _updateWorldPoses()`) — the accessor owns the freshness guarantee (PHILOSOPHY #23). Never call `_updateWorldPoses()` manually before `worldPoseOf()`. |
| HTML Overlay Active Camera | Views projecting 3D→screen for HTML labels must use `SceneView.activeCamera`, not `AppController._camera` (perspective-only); pass `this._sceneView.activeCamera` at each animation-loop call site |
| TC Gizmo Force-Update After Proxy Repositioning | Call `_tc.getHelper().updateMatrixWorld()` after `tc.attach()` in `_attachMobileTransform()`; call `_syncMobileTransformProxy()` from `_toggleTcMode()`. For Solids: proxy position and quaternion are copied from Origin CF world pose (ADR-037 §3); TC arrows align with `Solid.bodyRotation` after R-key rotation. |
| TC Gizmo Does Not Block Object Selection | `if (this._tcDragging) return` must appear BEFORE the entire `if (result)/else` block in the object-mode section of `_onPointerDown`. Two failure modes: (a) TC arrow outside Solid — `_hitAnyObject()` returns null, else-branch would deselect; (b) TC arrow overlapping a Solid — `_hitAnyObject()` returns the Solid, `_switchActiveObject` would replace `_activeObj` + re-attach TC proxy to the Solid, causing `objectChange` to look up the wrong id in `_tcStartCorners` → CF never moves. Empty-space touch tap (no TC, no entity) deselects normally. |
| TC Mode Must Match _tcMode | `_attachMobileTransform()` must set `_tcMode = 'translate'` in the non-CoordinateFrame branch alongside `tc.setMode('translate')`; `_tcMode` must always reflect the current TC mode for all code paths |
| Semantic Move Guardrail (checkMoveGuardrail) | Before G-key grab (`_startGrab()`) and before mouse quick-drag (`BEGIN_QUICK_DRAG` in `_onPointerDown`), call `SceneService.checkMoveGuardrail(_selectedIds)`. If it returns `{ blocked: true }`, show the message as a `'warn'` toast and return — do not enter the grab/drag state. The guardrail fires when: (1) any selected entity has a `fastened` or `mounts` SpatialLink to an entity **not** in the current selection; (2) any selected **Solid** has a fastened-child CF (`hasFastenedChild(id)`). The Solid check is required because fastened links live on child CF IDs, not the Solid ID — the direct-link loop alone misses them, and without the block the drag preview and `_updateFixedJointFrames()` fight every frame causing oscillation. If the linked peer is also selected (moving the whole assembly), the guardrail does not fire. All preconditions for movement belong inside `checkMoveGuardrail`; call sites must not add inline guard returns (PHILOSOPHY #25). | Tension Skips Topological Links | `getLinkDragTension()` must skip links whose `jointType === null` — those links carry no kinematic constraint and drag resistance has no physical meaning for them. Applying tension to them wrongly impedes free movement (PHILOSOPHY #11) and creates asymmetric damping (free toward linked entity, up to 85% resistance away) that users perceive as jitter/oscillation. |
| TC Drag Blocked on Fastened-Source CF | `_updateFastenedFrames()` overwrites `source.rotation` (and `source.translation` when the parent is another CF) every frame — any delta from TC `objectChange` is silently discarded, causing the TC proxy gizmo to drift from the CF. Also applies to the **parent Solid** of a fastened-source CF: the Solid snaps back every frame while the TC proxy stays at the dragged position. In `dragging-changed` start, detect via `isFastenedSource()` (for CF) or `hasFastenedChild()` (for Solid), set `_tcFastenedBlocked = true`, show toast. In `objectChange`, return early if `_tcFastenedBlocked`. In `dragging-changed` end, sync proxy via `_syncMobileTransformProxy()` and return without pushing a command. `hasFastenedChild()` is **transitive** — it walks the full CF ancestor chain via `_findAncestorChain()`, so nested-CF topologies (`Solid → IntermediateCF → SourceCF`) are blocked correctly. |
| R-key Rotation Blocked on Fixed-Joint Source Chain | Same conflict as TC drag: `_updateFastenedFrames()` and `_applyRotate()` fight over the same Solid's `bodyRotation` every frame. **Solid branch**: `_startRotate()` calls `hasFastenedChild(obj.id)` and shows a toast + returns if true — before snapshotting corners. `hasFastenedChild()` is **transitive** (uses `_findAncestorChain()`). **CF branch**: `_startRotate()` and the N-panel `onFrameRotationChange` handler both call `_isFastenedRotationBlocked(frame)` — the centralised helper that calls `isInFixedJointSourceChain(obj.id)` and shows the toast. **Always add new CF-rotation UI entry points through this helper** so the guard is never accidentally omitted. Without the block, `_updateFastenedFrames()` silently overrides the rotation every frame — the user's input appears to do nothing, which violates PHILOSOPHY #11 (silent failures). `isInFixedJointSourceChain()` walks the `parentId` chain of every JOINT_SOURCE to catch all ancestor CFs. Named after `jointType='fixed'` (ADR-038), not `semanticType='fastened'` — the guard applies to any fixed-joint topology regardless of semantic annotation. See STATE_TRANSITIONS.md §CoordinateFrame Role under Fixed-Joint SpatialLink. |
| _confirmRotate Must Call _syncMobileTransformProxy | After R-key rotation the Solid centroid moves. `_confirmRotate()` must call `_syncMobileTransformProxy()` to re-anchor the TC gizmo to the new centroid — otherwise the gizmo stays at the pre-rotation position until the next pointermove. Pattern mirrors the undo/redo handler. |
| CoordinateFrame Provenance (ADR-034) | Before Grab / R-key / rename / delete of a CoordinateFrame, call `RoleService.canEdit(frame)`; mismatch → `showToast` and return. `frame.declaredBy` is set to `RoleService.getRole()` at creation time. `window.__easyExtrude.setRole()` / `.getRole()` are the console API entry points |
| CoordinateFrame Scale Cap | `updateScale()` must always receive a finite `maxWorldSize`; use `sceneRadius × 0.3` (floor 1.0) as fallback for CFs without a solid parent — otherwise axes balloon to huge size when zooming out |
| CoordinateFrame Tap Selection | `_hitAnyObject()` never hits a CF (cuboid = null); `_onPointerDown` runs **both** `_hitAnyCoordinateFrame()` and `_hitAnyObject()` then picks via `_isCfDescendantOf()`: CF wins only when it is a child of the found Solid (PHILOSOPHY #22); otherwise the Solid wins — the 0.4-unit bbox fallback must not block selection of nearby unrelated Solids. |
| _promptAddFrame Must Select Frame After Creation | After pushing the command in `_promptAddFrame()`, call `_switchActiveObject(frame.id, true)` — otherwise the frame stays hidden in the 3D viewport. Undo restores parent selection; redo re-selects the frame. |
| _hitAnyEntityForLink CF Priority | `_hitAnyEntityForLink()` must call `_hitAnyCoordinateFrame()` as Step 0 before the cuboid raycast; CFs sit on top of Solids so the cuboid step would return the Solid, causing `_computeLinkOptions(CF, Solid)` to omit "Fixed · Fastened". |
| SpatialLink Two-Layer Taxonomy | Every `SpatialLink` has `jointType` (URDF kinematic, may be null) + `semanticType` (domain annotation). Constraint solver activates when `jointType === 'fixed'` for CF-to-CF links (except `semanticType === 'mounts'` which has its own path). Unfasten context menu uses `jointType === 'fixed'` not `semanticType === 'fastened'` — all fixed joints are unfastenable. See ADR-038. |
| Fastened Constraint Limitations | (1) **Full 6-DoF rigid body**: both translation AND rotation of the target CF are propagated to the parent Solid. The solver derives the absolute world pose directly: `new_Q_s = W_cf_quat × solidLocalQuat⁻¹`; `new_P_s = W_cf_pos − new_Q_s × solidLocalOffset`. No delta accumulation; no quaternion hemisphere-flip correction needed. (1a) **solidLocalOffset/solidLocalQuat must be computed from invariant local data only** — never from `_worldPoseCache` or `avg(corners)`. Seed `solidLocalOffset` from `new Vector3()` (exact zero — body-frame centroid IS `_position` by definition); walk `fullChain = [...chain, sourceCf]` accumulating each `cf.translation`/`cf.rotation`. **`_updateWorldPoses()` and `_getParentWorldPos()` must use `parent._position` directly** for the Solid world-origin — never `avg(corners)`, which closes a feedback loop (`_position → corners → avg → solver → new _position`) that accumulates FP error each frame. Symptoms: works near origin, drifts far away, fast rotation is fine, slow rotation diverges (PHILOSOPHY #24 manifestation c). Re-propagation in `_updateFastenedFrames` starts `pWorldPos` from `newSolidPos` (exact solver output), not a recomputed centroid. (2) Only one fastened source CF per parent Solid is supported; two fastened CFs on the same Solid violate each other (last processed wins). (3) `loadScene()` / `importFromJson()` must call `_updateWorldPoses()` + `_reactivateLiveLinks()` after entity/link reconstruction; without this, constraints are silent no-ops for the rest of the session. (4) **CF chain propagation** (ADR-035): when SOURCE's parent is another CF, `_findAncestorChain()` walks up to the root Solid; the rigid body transform is applied to the root Solid and the intermediate CF chain is re-propagated inline. (5) **Cycle detection** (ADR-035): `_detectFastenedCycles()` runs before the solver each frame; cyclic linkIds are skipped and a `constraintCycleDetected` event is emitted (→ toast) when the cyclic set changes. |
| SemanticInferencer Integration (ADR-041) | `_runSemanticInference()` is called at the end of `_confirmGrab()` and after QuickDrag confirm. It is skipped when `selectedIds.size > 1` or the moved entity is not a `Solid`. The inferrer (`inferSemanticRelationships`) is pure — no DOM or scene mutations. Calling `_startGrab()` dismisses any pending suggestion via `dismissSemanticSuggestion()`. Never call `inferSemanticRelationships` from inside the animation loop (it is not a per-frame computation). |
| Drag Suggestion Lifecycle (ADR-041 Phase 2) | Ghost `SpatialLinkView` and drag tooltip are created in `showDragSuggestion()` and must be disposed in all three exit paths: (1) inference lost in `onPointerMove` → `hideDragSuggestion()`; (2) pointerup confirm → `_clearSuggestion()` inside `confirm()`; (3) Enter-key accept → `hideDragSuggestion()` then `acceptSuggestion()`. `acceptSuggestion()` sets `_activeDragPointerId = null` before returning so the subsequent `pointerup` sees `wasDragging = false` and is a no-op. `_ghostLinkView` on `AppController` is the sole owner; `hideDragSuggestion()` is the sole disposer (PHILOSOPHY #4 Visual Flag Has One Owner, #9 Allocations Symmetric). |

---

## 2. Events & Interaction (Touch/Pointer)

Detail: `docs/code_contracts/interaction.md`

| Rule | Core Takeaway |
|------|--------------|
| Touch vs. Pointer Asymmetry | Re-run hit tests in `_onPointerDown` before `_handleEditClick`; hover does not fire before touch tap |
| Gesture-Based Interaction Priority | Auto-start face extrude on touch tap in Edit 3D; gesture-only, no toolbar button |
| Interaction Confirmation Lifecycle | FaceExtrude confirms on `pointerup`; Grab on touch confirms via toolbar only, never in `pointerup` |
| Mobile Rotate Interaction Lifecycle | Rotate button calls `_startRotate(true)`; each canvas touch re-anchors `segmentStart*`; `_onPointerUp` keeps rotate active; confirm via toolbar only |
| Grab State: allStartCorners vs segmentStartCorners | `allStartCorners` = undo anchor (never update mid-grab); `segmentStartCorners` = per-drag delta (re-snapshot on re-touch OR on axis-constraint switch in `_setGrabAxis()`). Re-snapshot triggers: (1) touch `pointerdown` in `S_GRAB_ACTIVE`; (2) `_setGrabAxis()` axis change — preserves accumulated offset from the previous constraint. `startMouse` is also reset on axis switch so the new delta starts at zero. After re-snapshotting `segmentStartPositions`, `_grab.centroid` and `_grab.pivot` must also be updated to the current object position (avg of `segmentStartPositions` for Solid; `worldPoseOf` for CF) — without this the axis guide line and screen-projection pivot remain at the original grab-start position while the object has already moved. |
| Rotate Segment Re-snapshot on Axis Change | `_setRotateAxis()` must mirror `_setGrabAxis()`: when the axis constraint changes, re-snapshot `segStartOrientation` / `segmentStartRot` from the current object orientation, update `segStartPos` / `segStartPivot` from `obj._position`, then reset `accumulatedAngle = 0`, `prevCurrentAngle = startAngle`, and `segmentStartAngle = startAngle`. Without the re-snapshot, the next `_applyRotate()` call applies `deltaQ` starting from the original orientation (discarding accumulated X rotation) and the first angle delta is computed against a stale `prevCurrentAngle` (causing a jump). |
| Global Event vs. UI Event Delegation | First guard in `_onPointerDown`: `if (e.target !== renderer.domElement) return` |
| OrbitControls Disable Strategy | Use `matchMedia('(pointer: coarse)')` not `innerWidth < 768`; disable only for single-finger-consuming ops |

---

## 3. UI & Layout Adaptability

Detail: `docs/code_contracts/ui_layout.md`

| Rule | Core Takeaway |
|------|--------------|
| Three.js Canvas Must Mount in #canvas-container | `SceneView` appends `renderer.domElement` to `document.getElementById('canvas-container')` (fallback: `document.body`). Never append directly to `document.body` — the implicit stacking order is fragile when a React overlay exists. Explicit z-index contract: `#canvas-container` (z-index:0) → GizmoView canvas (z-index:10, `position:fixed`) → `#react-ui-root` (z-index:100). Adding React UI layers without this container caused a black-screen regression after Phase 5. |
| Mobile Toolbar Stability | Fixed slot counts per mode; use `disabled` + `{spacer: true}` to prevent layout shifts. Object mode (5 slots): `[Add \| Grab \| Edit \| Delete \| Rotate-or-Stack]`. Solid selected: slot 5 = Rotate. CF selected: `[Add Frame \| Move \| spacer \| Delete \| Rotate]` — slots 2 (Move) and 5 (Rotate) intentionally mirror Solid positions for cross-entity muscle memory; Add Frame is always enabled even for Origin CF. Dup removed from toolbar; remains in long-press context menu. Semantic slot rule for transient operation bars: slot 1 = Cancel/Back, slot 4 = Confirm — fixed regardless of which operation is active. |
| CF Label Position Order | `_updateWorldPoses()` must run BEFORE `updateLabelPosition()` in the animation loop; calling label update on a stale `_group.position` (previous frame) causes the label to lag one frame and appear to vibrate at startup. |
| CF Label getBoundingClientRect Cache | `CoordinateFrameView.updateLabelPosition()` caches the result of `canvas.getBoundingClientRect()` (keyed on `clientWidth`/`clientHeight`) and reuses it across frames. Calling `getBoundingClientRect()` every frame on mobile returns slightly varying values during viewport-resize animations (address-bar show/hide), which pushes the rounded pixel position across a 0.5-pixel boundary on alternate frames and causes visible jitter. The cache is invalidated whenever canvas dimensions change (i.e., on window resize). Additionally, the transform is only written to the DOM when the rounded position changes, preventing GPU recomposition on static scenes. |
| Mobile Touch Gesture Model | Touch: tap=select, one-finger-drag=orbit, long-press=context menu; no rect selection or _objDragging |
| Long-Press Context Menu | `showContextMenu()` with Grab/Dup/Rename/Delete; items filtered by entity type |
| Long-Press for Non-Draggable Entities | CF/MeasureLine/Annotated* early-return must set long-press timer for touch BEFORE returning; without this CF "Link to..." is unreachable on mobile |
| _confirmFastenFrame Type Guard | Check `instanceof CoordinateFrame` for both IDs and call `_service._updateWorldPoses()` before `fastenFrame()`; type mismatch must show "Select a coordinate frame as source and target" not "frame pose unknown" |
| Measure Point Placement | Confirm in `_onPointerUp`; hold shows live snap feedback before release |
| Stack Mode | Ray origin must be Z=10000; runs in both `_grab.active` and `_objDragging` paths |
| Viewport-Aware Z-Index | Toast `bottom: 96px` on mobile (above 86px toolbar); status in `_infoEl` on mobile |
| Mobile Header Overflow | Export/Import hidden on mobile; replaced by `_moreMenuBtn` (⋯) dropdown. `_headerStatusEl` uses `visibility:hidden` (not `display:none`) to remain a flex:1 spacer. Map button hides its `<span>` text label on mobile (padding tightened to `4px`) — without this the N-panel icon is clipped on 375px viewports. Header has `overflow:hidden`. Mode dropdown (`_modeDropdownEl`) is appended to `document.body` with `position:fixed` and positioned via `getBoundingClientRect()` — if placed inside the header it gets clipped by `overflow:hidden` |

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
| BoxHelper Forbidden for World-Space Baked Geometry | `THREE.BoxHelper` computes AABB; use `THREE.LineSegments`+`EdgesGeometry` for `MeshView` selection highlight so it matches the solid's actual orientation after rotation |
| Annotation View Materials Must Use depthTest: true | `depthTest: false` makes annotations render over all Solid objects; use `depthTest: true` + `depthWrite: false` for transparent materials + `polygonOffset` for flat ground-plane meshes |
