# Events Reference

A complete reference for all events in easy-extrude — domain events, DOM events,
and keyboard shortcuts — including their specifications.

> **When to update this document**
> - When adding or changing a domain event (`SceneService.emit(...)`)
> - When adding, changing, or removing a keyboard shortcut
> - When the pointer/touch event handling flow changes
> - When adding a new Undo/Redo command
> - When adding a click handler for a new UI button or widget

---

## Event Categories

| Category | Source | Delivery Path |
|----------|--------|---------------|
| [A] Domain events | `SceneService` | `EventEmitter.emit()` → listeners |
| [B] Pointer events | Browser Pointer Events API | `AppController._bind*()` |
| [C] Keyboard events | Browser KeyboardEvent | `AppController._onKeyDown/Up()` |
| [D] Touch-specific events | Browser + long-press timer | `AppController` (touch paths) |
| [E] UI events | DOM `click` / `change` | `UIView` / `OutlinerView` callbacks |

---

## [A] Domain Events (SceneService.emit)

`SceneService` extends `EventEmitter` and notifies subscribers (primarily
`AppController` and `OutlinerView`) of entity lifecycle changes.

### objectAdded

```
emit('objectAdded', entity)
```

| Item | Description |
|------|-------------|
| Payload | `entity: Solid | Profile | MeasureLine | CoordinateFrame | ImportedMesh` |
| Fired when | `createCuboid()`, `createProfile()`, `createImportedMesh()`, `createMeasureLine()`, `createCoordinateFrame()`, `duplicateCuboid()`, `extrudeSketch()` |
| Primary receivers | `OutlinerView.addObject()` — adds a row to the Outliner |
| Side effects | For CoordinateFrame, also updates parent object visibility logic |

### objectRemoved

```
emit('objectRemoved', id)
```

| Item | Description |
|------|-------------|
| Payload | `id: string` |
| Fired when | `deleteObject()`, `detachObject()` |
| Primary receivers | `OutlinerView.removeObject()` — removes a row from the Outliner |
| Note | In `_clearScene()`, `objectRemoved` must be emitted for each object BEFORE replacing `this._model` |

### objectRenamed

```
emit('objectRenamed', id, newName)
```

| Item | Description |
|------|-------------|
| Payload | `id: string`, `newName: string` |
| Fired when | `renameObject()` |
| Primary receivers | `OutlinerView.setObjectName()`, `AppController` (status update) |

### activeChanged

```
emit('activeChanged', id)
```

| Item | Description |
|------|-------------|
| Payload | `id: string | null` |
| Fired when | `setActiveObject()` |
| Primary receivers | `OutlinerView.setActive()` — updates Outliner highlight |

### geometryApplied

```
emit('geometryApplied', { objectId })
```

| Item | Description |
|------|-------------|
| Payload | `{ objectId: string }` |
| Fired when | After STEP geometry is received and applied via WebSocket |
| Primary receivers | `AppController` — camera fit (`fitCameraToSphere()`), hide progress indicator |

### geometryError

```
emit('geometryError', { objectId, message })
```

| Item | Description |
|------|-------------|
| Payload | `{ objectId: string, message: string }` |
| Fired when | In the `catch` block of `_applyGeometryUpdate()` |
| Primary receivers | `AppController` — shows error Toast |

### wsConnected / wsDisconnected

```
emit('wsConnected', {})
emit('wsDisconnected', {})
```

| Item | Description |
|------|-------------|
| Fired when | `WsChannel` WebSocket `open` / `close` events |
| Primary receivers | `AppController` — checks import state |

---

## [A2] Context Document Events (ContextService.emit)

`ContextService` (ADR-050) extends `EventEmitter` and notifies subscribers of
canonical Context DSL document lifecycle changes. The document is the project
artifact; the scene is a derived projection (ADR-049 invariant 9). Side effects
live in the controller; the pure `src/context/*` layer emits nothing.

### contextLoaded

```
emit('contextLoaded', { doc, validatorResult, compiled, importResult })
```

| Item | Description |
|------|-------------|
| Fired when | `loadContext()` adopts a new document (project-open boundary) |
| Primary receivers | `AppController._onContextLoaded()` — clears undo history + selection, frames the camera |
| Note | Loading a context regenerates the scene via `importFromJson({clear:true})` |

### contextChanged

```
emit('contextChanged', { doc, validatorResult, regenerated })
```

| Item | Description |
|------|-------------|
| Fired when | Any document mutation (approval / admissible edit / form answer) via `applyContextDoc()` |
| Payload | `regenerated: boolean` — whether the scene was re-imported |
| Primary receivers | Inspector + 3D overlays (later phases) re-project from the new doc |

### conflictsChanged

```
emit('conflictsChanged', { conflicts })
```

| Item | Description |
|------|-------------|
| Fired when | `validatorResult.conflicts` differs after a mutation (e.g. a region edit) |
| Note | A pure status flip (decision approval) does NOT change `conflicts` — `resolvedBy` is set independent of approval — so this does not fire on approve |

### decisionApproved

```
emit('decisionApproved', { ref })
```

| Item | Description |
|------|-------------|
| Fired when | `approveDecision()` flips a Decision `status: proposed → agreed` |
| Primary receivers | Matrix transition (`proposed ◐ → resolved ✓`), toast |

---

## [B] Pointer Events

Pointer events are managed uniformly via the Pointer Events API.
`pointerdown` is registered on `window`; `pointermove` / `pointerup` are captured on the canvas.

### Canvas Target Guard

```
pointerdown fires
  ↓
if (e.target !== renderer.domElement) return  ← required guard
```

Prevents `_handleEditClick()` from firing erroneously on toolbar or UI panel clicks.

### pointerdown

| Condition | Action |
|-----------|--------|
| `grab.active` + button=0 | `_confirmGrab()` → IDLE |
| `grab.active` + button=2 | `_cancelGrab()` → IDLE |
| `faceExtrude.active` + button=0 | Set `_activeDragPointerId` (confirmed on pointerup) |
| `faceExtrude.active` + button=2 | `_cancelFaceExtrude()` |
| `editSubstate === '2d-sketch'` | `_sketch.drawing = true`, disable orbit |
| `selectionMode === 'object'` + object hit | `_objDragging = true`, disable orbit |
| `selectionMode === 'object'` + miss | `_rectSel.active = true` (desktop only) |
| `editSubstate === '3d'` | Re-run hit test → `_handleEditClick()` |
| `editSubstate === '1d'` + near endpoint | Set `_endpointDrag` state, disable orbit, capture drag |
| `editSubstate === '1d'` + miss | No-op (orbit controls remain active) |
| Second touch (during rectSel) | Cancel rectSel, delegate to OrbitControls |

### pointermove

| Condition | Action |
|-----------|--------|
| `_rectSel.active` | Update selection rectangle overlay |
| `_objDragging` | Move object (direct drag, not Grab) |
| `_sketch.drawing` | Update sketch rectangle p2 |
| `faceExtrude.active` | Calculate distance + `_applyFaceExtrude()` + update label |
| `grab.active` | `_applyGrab()` |
| `_endpointDrag.active` | Project to drag plane → update endpoint position live |
| hover (edit 1d, nothing active) | `_findNearestVertex()` → `setEndpointHover()` |
| hover (edit 3d, nothing active) | `_hitFace/Vertex/Edge()` → `setFaceHighlight()` |
| Long-press timer active (`_longPressTimer`) | Cancel timer if movement > 8px |

### pointerup

| Condition | Action |
|-----------|--------|
| `_endpointDrag.active` | Confirm drag → `createMoveCommand` → `_commandStack.push()` |
| `faceExtrude.active` + `wasDragging` | `_confirmFaceExtrude()` |
| `_sketch.drawing` + `wasDragging` | `_confirmSketchRect()` |
| `_rectSel.active` + `wasDragging` | `_finalizeRectSel()` |
| `_objDragging` | Reset flag |
| Always | `_activeDragPointerId = null` |

### wheel

| Condition | Action |
|-----------|--------|
| `Ctrl` + `grab.active` | Cycle grid size (0.1, 0.5, 1, 5) |
| `Ctrl` + `rotate.active` | Cycle rotation step size (1°, 5°, 10°, 45°) |
| Otherwise | Delegate to OrbitControls zoom |

### contextmenu

- `e.preventDefault()` suppresses the browser default menu
- When `grab.active`, acts as a trigger for `_cancelGrab()`

### Right-click (button === 2) — PC context menu (ADR-006)

| State | Condition | Action |
|-------|-----------|--------|
| Operation in progress | `grab.active`, `measure.active`, `rotate.active`, etc. | Cancel the operation |
| Object mode, hits object | `selectionMode === 'object'` + `pointerType !== 'touch'` | Select object + `showContextMenu()` (Grab / Dup / Rename / Delete) |
| Object mode, hits empty | No hit result | No-op; OrbitControls handles right-drag orbit |

---

## [C] Keyboard Events

### Global (_onKeyDown)

| Key | Condition | Action |
|-----|-----------|--------|
| `Tab` | Not in grab.active / faceExtrude.active | Toggle mode (object ↔ edit) |
| `Escape` | During any operation | Cancel (grab, faceExtrude, rectSel, sketch, rotate, measure) |
| `Enter` | During any operation | Confirm (grab → `_confirmGrab()`, faceExtrude → `_confirmFaceExtrude()`, 2d-sketch → `_enterExtrudePhase()`) |
| `Ctrl+Z` | All modes | `_commandStack.undo()` |
| `Ctrl+Y` | All modes | `_commandStack.redo()` |
| `Ctrl+E` | Object Mode | Export scene JSON |
| `Ctrl+I` | Object Mode | Show scene JSON import modal |
| `Ctrl+S` | Object Mode | Save scene (BFF) |
| `Ctrl+O` | Object Mode | Load scene (BFF) |

### Object Mode

| Key | Action |
|-----|--------|
| `G` | `_startGrab()` |
| `R` | `_startRotate()` (CoordinateFrame or Solid selected, ADR-019/ADR-036) |
| `M` | `_startMeasurePlacement()` |
| `Shift+A` | Show add menu |
| `Shift+D` | Duplicate selected object |
| `X` / `Delete` | Delete selected object |

### Edit Mode · 3D

| Key | Action |
|-----|--------|
| `1` | Sub-element mode: Vertex |
| `2` | Sub-element mode: Edge |
| `3` | Sub-element mode: Face |
| `E` | `_startFaceExtrude()` (face selected only) |
| `O` | Return to Object Mode |

### Grab Active

| Key | Action |
|-----|--------|
| `X` | Lock to X axis |
| `Y` | Lock to Y axis |
| `Z` | Lock to Z axis |
| `V` | Enable Pivot selection mode |
| `S` | Toggle Stack mode |
| `0`–`9` / `.` | Numeric input mode (requires axis lock) |

### Face Extrude Active

| Key | Action |
|-----|--------|
| `0`–`9` / `.` | Numeric input mode |
| `Ctrl` (hold) | Enable snap mode |

### Rotate Active (CoordinateFrame / Solid)

| Key | Action |
|-----|--------|
| `X` | Rotate around X axis |
| `Y` | Rotate around Y axis |
| `Z` | Rotate around Z axis |
| `0`–`9` / `.` | Numeric input mode (degrees) |

Pivot: CoordinateFrame = frame world origin. Solid = centroid of corners at rotation start (ADR-036).

---

## [D] Touch-Specific Events

### Long Press

```
pointerdown (touch, Object Mode, object already selected)
  ↓
_longPressTimer = setTimeout(callback, 400ms) starts
  ↓
pointermove: movement > 8px → clearTimeout (cancelled)
  ↓
400ms reached → showContextMenu() shown
  Context menu items:
  - Grab (all entities)
  - Duplicate (Solid only)
  - Rename (all entities)
  - Delete (all entities)
```

### Grab Confirmation on Touch

```
Mobile Grab flow:
  Long press → context menu → tap "Grab" → grab.active = true
  (Canvas drag is used for orbit, so drag does not move the object during grab)
  → tap toolbar "✓ Confirm" button → _confirmGrab()
```

### Face Extrude on Touch

```
Edit 3D + face selected → touch tap auto-starts extrude
  (Desktop uses E key; touch starts by tapping a face without E key)
  ↓
Canvas drag → pointermove updates distance
  ↓
Lift finger (pointerup, wasDragging=true) → _confirmFaceExtrude()
```

---

## [E] UI Events (click / change)

### Header

| Element | Event | Action |
|---------|-------|--------|
| Mode selector button | `click` | Toggle dropdown |
| Mode dropdown item | `click` | `setMode(value)` |
| Undo button (↶) | `click` | `_commandStack.undo()` |
| Redo button (↷) | `click` | `_commandStack.redo()` |
| Export button | `click` | `SceneExporter.export()` + download |
| Import button | `click` | Show import modal |
| Save button | `click` | `SceneService.saveScene()` (BFF REST) |
| Load button | `click` | `SceneService.loadScene()` (BFF REST) |
| Demo button (desktop) / ⋯ menu Demo item (mobile) | `click` | `callbacks.onContextDemoClick` → `ContextDemoController.enter()` (ADR-047) |
| ⋯ menu (mobile) | `click` | Show dropdown with Export / Import / Demo |
| N button (mobile) | `click` | Toggle N Panel drawer |
| ≡ hamburger (mobile) | `click` | Toggle Outliner drawer |

### Outliner

| Element | Event | Action |
|---------|-------|--------|
| Object row | `click` | `_switchActiveObject(id)` |
| Visibility toggle (○) | `click` | `setVisible(id, toggle)` |
| Delete button (✕) | `click` | `_deleteObject(id)` |
| Object name | `dblclick` | Inline rename input or dialog |

### Mobile Toolbar

| State | Button | Event | Action |
|-------|--------|-------|--------|
| grab.active | ✓ Confirm | `click` | `_confirmGrab()` |
| grab.active | Stack | `click` | Toggle Stack mode |
| grab.active | ✕ Cancel | `click` | `_cancelGrab()` |
| faceExtrude.active | ✓ Confirm | `click` | `_confirmFaceExtrude()` |
| faceExtrude.active | ✕ Cancel | `click` | `_cancelFaceExtrude()` |
| Object Mode | + Add | `click` | Show add menu |
| Object Mode | Edit | `click` | `setMode('edit')` |
| Object Mode | Delete | `click` | `_deleteObject(activeId)` |
| Object Mode (Frame) | Rotate | `click` | `_startRotate()` |
| Object Mode (Frame) | Add Frame | `click` | `createCoordinateFrame()` |
| Edit 2D-Sketch | ← Object | `click` | `setMode('object')` |
| Edit 2D-Sketch | Extrude | `click` | `_enterExtrudePhase()` |
| Edit 2D-Extrude | ✓ Confirm | `click` | `_confirmExtrude()` |
| Edit 2D-Extrude | ✕ Cancel | `click` | `_cancelExtrude()` |
| Edit 3D | ← Object | `click` | `setMode('object')` |
| Edit 3D | Vertex/Edge/Face | `click` | Switch sub-element mode |
| Edit 3D | Extrude | `click` | `_startFaceExtrude()` |

> Toolbar buttons are handled on `click`, not `pointerdown`.
> The canvas target guard causes `pointerdown` to ignore anything other than the canvas.

### Context DSL Demo (ADR-047)

Registered by `ContextDemoController` in its constructor via `uiStore.actions.registerCallback`;
fired by the `ContextDemo` React components. No new domain events — step staging is
view-level visibility only.

| Callback | Fired by | Action |
|----------|----------|--------|
| `onContextDemoClick` | Header Demo button / MoreMenu | `enter()` — compile + confirm + scene load |
| `onDemoStepChange(n)` | StoryBar ← 戻る / 次へ → | `setStep(n)` — visibility diff + inspector tab (step ④ gated on approval) |
| `onDemoApproveDecision(ref)` | DecisionCard 承認ボタン | `approveDecision()` — ghost collapse → reveal + ripple |
| `onDemoItemSelect(ref)` | Inspector row click | `selectItem(ref)` — trace → 3D highlight / link flash / toast |
| `onContextAuthorClick` | Header **Author** button / MoreMenu | `enterAuthoring()` — region scenario + draggable AABB widgets (ADR-049 Phase 3) |
| `onContextNegotiationClick` | Header **交渉** button / MoreMenu | `enterNegotiation()` — conflict scenario, persona projections (matrix + cluster order), data-only overlay (ADR-049 Phase 4) |
| `onApproveNegotiationDecision(ref)` | Cluster tab 承認ボタン(確定 / 合同確定) | `approveNegotiationDecision(ref)` — `demoApproveDecision` → re-project matrix/order with updated `approvedRefs` (no re-validation) + nominal toast (ADR-049 Phase 4) |
| `onContextRegionGhostClick` | Header **ゴースト** button / MoreMenu | `enterRegionGhost()` — region scenario, actor-coloured admissible-region ghosts overlaid (empty intersection = red gap band), conflict matrix alongside; matrix actor-column `personaFilter` dims the 3D ghosts (ADR-049 §5.3) |
| `onDemoExit` | StoryBar ✕ | `exit()` — restore all visibility, dispose authoring widgets / region ghosts, `demoEnd()` |

**Persona filter (ADR-049 Phase 4)**: the Matrix tab's actor column headers call
`uiStore.actions.demoSetPersonaFilter(actorRef)` directly (pure UI state — no controller
callback, no 3D side effect). Re-clicking the selected actor clears the filter. Matrix cells and
Cluster steps not involving the filtered actor are dimmed. The negotiation overlay is data-only:
no pointer delegation, no scene replacement. In the **region ghost overlay** (§5.3) the same
`demoSetPersonaFilter` state additionally drives the 3D ghosts: `ContextDemoController.tick()`
mirrors `demo.personaFilter` into each `RegionGhostView.setPersonaFilter()` (guarded by a
last-value check), so clicking an actor column dims the other personas' 3D footprints too.

**n-ary approval flow (ADR-049 Phase 4)**: the Cluster tab's approve buttons fire
`onApproveNegotiationDecision(decisionRef)`. The controller marks the Decision approved, rebuilds
`approvedRefs`, and re-projects (matrix `proposed`◐ → `resolved`✓; step `approved` flag). A
cluster's 合同確定 button is enabled only when every `dependsOn` step is approved (DAG order,
invariant 8). The whole overlay is 3D-independent, so the Inspector renders full-width on mobile
in negotiation mode (only context that lifts the `<768px` hide).

### Context-first Negotiation (ADR-050 Phase 2)

Production counterpart of the demo negotiation, registered by `ContextController`
(not `ContextDemoController`) and fired by the production `ContextLayer` /
prop-driven Matrix·Cluster components. Reads the **`context`** uiStore slice
(persistent), distinct from the tutorial `demo` slice.

| Callback | Fired by | Action |
|----------|----------|--------|
| `onContextNegotiate` | Header **Context ▾ → Negotiate** / ⋯ menu | `enterNegotiation()` — operate on the **loaded** doc; project matrix + resolution order into the `context` slice (`mode:'negotiate'`). If no doc is loaded, show a guiding **warn** toast — it never bootstraps an example or replaces the scene |
| `onApproveContextDecision(ref)` | Cluster tab approve button (Settle / Settle jointly) | `approveDecision(ref)` — `createApproveDecisionCommand` → `cmd.execute()` + `_commandStack.push()` (undoable, ADR-050 §3.5) + nominal toast |
| `onContextAuthor` | Header **Context ▾ → Author** / ⋯ menu | **(Phase 3)** `enterAuthoring()` — operate on the **loaded** doc when it has a single-variable region requirement; hide derived meshes, spawn one `RegionAuthoringWidget` per region requirement (`mode:'author'`). Otherwise a guiding toast (load the "Robot Cell — Regions" template) — no scene replacement |
| `onContextRegionGhost` | Header **Context ▾ → Region Ghosts** / ⋯ menu | **(Phase 3)** `enterRegionGhost()` — same loaded-doc rule, overlay actor-coloured `RegionGhostView`s + the conflict matrix whose persona filter dims the ghosts (`mode:'ghost'`). Otherwise a guiding toast — no scene replacement |
| `onContextExit` | ContextLayer ✕ | `exit()` — dispose authoring widgets / region ghosts, restore derived meshes + Link Network, `contextEnd()` |
| `onOpenTemplateGallery` | Header **Context ▾ → New Project** / ⋯ menu | **(Phase 2)** `openTemplateGallery()` — `setTemplateGalleryOpen(true)`; the `TemplateGallery` modal renders the static `TEMPLATE_CATALOG`. This is the single "create new" entry (the former `New Context` direct item was removed; its Empty Project card here is the blank path) |
| `onSelectTemplate(id)` | Template Gallery card click | **(Phase 2)** `selectTemplate(id)` — exit any active overlay, resolve the doc (`createBlankDoc` for `kind:'blank'`, `TEMPLATE_DOCS[file]` for `kind:'example'`), load via `adoptDoc` / `loadContext`, open the negotiate overlay. No second confirm (footer states the consequence — §7) |
| `onCloseTemplateGallery` | Template Gallery ✕ / backdrop | **(Phase 2)** `closeTemplateGallery()` — `setTemplateGalleryOpen(false)` |
| `onForkTemplate(id)` | Template Gallery example card **✎ Use as a starting point** | **(ADR-058 Phase 1)** `forkExample(id)` — deep-clone the example into the working doc, `_loadThen` (regenerate scene, clear undo), then set `context.authorSeed` (read-only mirror) + open the `'intake'` tab. Only `kind:'example'` is forkable; the seed feeds the RequirementForm's seed-anchor chips |
| `onIntakePreview(spec\|null)` | IntakePanel RequirementForm admissible-interval inputs (live) | **(Phase 3)** `previewIntake(spec)` — drive one `UncertaintyGhostView` from `{lo,hi,unit,label}`; update in place via `setIntervalPreview` (no geometry rebuild), frame the camera once; `null` disposes the ghost. Cleared on form unmount / submit |
| `onAddNlFacts(facts)` | IntakePanel NlIntakeForm "Add … Facts to document" | **(Phase 4)** `addNlFacts(facts)` — fold NL-extracted Fact fragments (`extractFacts`, pure) into the doc as one undoable `createAddDocEntryCommand`; toast counts (asserted vs unconfirmed). Preview is computed locally in the form (pure, no round-trip) |
| `onEditDocEntry(type, data)` | IntakePanel EntryCard → inline editor **Save** (actor/variable/requirement) | **(ADR-058 Phase 2)** `editDocEntry(type, data)` — snapshot before → pure `updateActor`/`updateVariable`/`updateRequirement` (replace by unchanged `ref`) → undoable `createDocEditCommand` (regenerate). A compile-orphaning edit throws → toast, no push. `ref` is locked in the editor (rename = remove + re-add) |
| `onRemoveDocEntry(type, ref)` | IntakePanel inline editor **🗑 Remove** | **(ADR-058 Phase 2)** `removeDocEntry(type, ref)` — snapshot before → pure `removeDocEntry` → undoable `createDocEditCommand`. An orphaning removal throws → toast, no push |
| `onWizardStart` | WizardPanel start screen **▶ Start guided intake** | **(ADR-063 Phase 3)** `startWizard()` — seed `context.wizard = startWizard(CELL_INTAKE_WIZARD)` (step 0) + `contextSetTab('wizard')`. Warn toast when no context is loaded. ContextController is the sole writer of `context.wizard` (pure `WizardCatalog` transitions) |
| `onWizardNext` | WizardPanel **Next → / Review →** | **(ADR-063 Phase 3)** `wizardNext()` — gate on the pure `wizardStepGaps` against the **authoritative** `getDoc()` (the panel prints the same list from the projected slice — one predicate, two projections); blocked → warn toast with the reasons, never a silent no-op. Passing → `nextWizardState` (last step → review) |
| `onWizardBack` | WizardPanel **← Back** | **(ADR-063 Phase 3)** `wizardBack()` — `prevWizardState` (review → last step; step 0 stays). Always allowed |
| `onWizardFinish` | WizardPanel review **✓ Finish** | **(ADR-063 Phase 3)** `finishWizard()` — `context.wizard = null` + `contextSetTab('matrix')` + toast. A **view transition, not a commit** — every step already committed through the CommandStack (`onAddDocEntry`), so there is no all-or-nothing modal confirm |
| `onWizardExit` | WizardPanel **Exit** (step footer) | **(ADR-063 Phase 3)** `exitWizard()` — `context.wizard = null`; the wizard tab shows its start screen again. Committed steps stay in the doc (each was undoable) — partial progress is the deliverable |
| `onAssetViewerOpen(assetId)` | ParametricAssetPanel catalog card (Assets tab / wizard variables step) | **(ADR-063 Phase 4)** `openAssetViewer(assetId)` — seed `context.assetViewer = {assetId, values: clampParams(asset, {})}` (sole writer), create/refresh the `ParametricPreviewView` ghost from `instantiateAsset(...).entities`, frame the camera **once** per open |
| `onAssetParam(key, value)` | ParametricAssetPanel slider (live) | **(ADR-063 Phase 4)** `setAssetParam(key, value)` — clamp through the pure `clampParams`, replace the slice, rebuild the ghost. **No doc mutation, no CommandStack** — a preview keystroke is not a commit (optimistic preview / pessimistic commit) |
| `onAssetViewerCommit` | ParametricAssetPanel **✓ Commit as variables + fact** | **(ADR-063 Phase 4)** `commitAsset()` — pure `applyAssetCommit` (per-param variable upsert + one asserted fact replaced by ref) → one undoable `createDocEditCommand` through the single write path. Recommit overwrites, never duplicates. Toast summarises what was written |
| `onAssetViewerClose` | ParametricAssetPanel **← catalog** | **(ADR-063 Phase 4)** `closeAssetViewer()` — `context.assetViewer = null` + dispose the ghost preview (sole owner; also disposed on overlay `exit()` and `_startNegotiation` re-entry — PHILOSOPHY #9) |
| `onOpenGrasp` | Header **Context ▾ → Grasp Search…** / ⋯ menu | **(ADR-057)** `GraspController.openGrasp()` — ensure the negotiate overlay (the grasp tab's host), seed `context.grasp = {status:'idle', layout}`, and select the `'grasp'` tab (`contextSetTab('grasp')`). The former top-level `graspPanelOpen` modal flag is gone — the entry is a tab selection. Warns and does not seed/select when there is no renderable layout |
| `onRunGraspSearch({weights, topN})` | GraspSearchPanel (grasp tab) **Run** button | **(ADR-057)** `GraspController.runGraspSearch(params)` — read `getCompiled().layoutDsl`, ensure a JWT'd `BffClient`, then the linear FSM `compiling` (Step A `compileLayout` round-trip verify) → `solving` (Step B `graspSearch`, BFF stamps `contractVersion` + delegates) → `results` \| `error{stage}`. Replaces `context.grasp` wholesale with each discriminated-union state. A query, not a doc mutation — not on the CommandStack. 400/502/503/BFF-down surface their reason as a toast + the error state |
| `onSelectGraspCandidate(rank)` | GraspSearchPanel candidate card click | **(ADR-057)** `GraspController.selectCandidate(rank)` — set `selectedRank` (results state only); a pure highlight in v1, the connection seat for the deferred spatial ghost (ADR-059). No 3-D side effect |

**ADR-052 Phase 2 — Why breadcrumb (selection → provenance)**: there is **no UI
callback** for this — the trigger is **entity selection**, not a button.
`AppController._syncContextProvenance()` is called from `_switchActiveObject`
(select) and `SelectionManager.setObjectSelected` / `finalizeRectSelection`
(deselect / multi-select); it is the single reader of selection state and calls
`ContextController.showProvenance(id|null)` (no-op unless negotiate mode). The
controller climbs φ⁻¹ (`ContextService.recoverProvenance`, which joins the R6 Gap),
pushes `context.provenance`, and auto-switches to the `'why'` tab. Deselect / a
non-context entity / multi-select clears it. The Gap is re-joined for the tracked
selection inside `_reproject()` so approve / region edit / undo / redo keep the
breadcrumb fresh through the one re-projection path (PHILOSOPHY #5).

**ADR-052 Phase 3 — Why tree overview (俯瞰 tab)**: also has **no UI callback** —
it is pure projected state, not a user action. `ContextController._startNegotiation()`
pushes `ui.contextSetWhyTree(ContextService.whyTree())` on enter, and `_reproject()`
re-pushes it on every doc mutation (add / answer / region-edit / undo / redo) so the
whole-doc `WhyTreeView` overview always matches the live document through the same
re-projection path as the matrix / form / breadcrumb (PHILOSOPHY #5). `context.whyTree`
is reset by `contextEnd`.

**Phase 3 pointer delegation** (CODE_CONTRACTS «Context Authoring Pointer Delegation»): when
`_ctxCtrl.isAuthoring`, `_onPointerDown/Move/Up` delegate to `_ctxCtrl.onAuthor*(e)` (after
`_hitTest.updateMouse`, alongside the existing `_demoCtrl.isAuthoring` branch). A live drag
**recolours only** (re-validates a cloned edit context); the finished edit is committed once on
pointer-up through `createEditAdmissibleCommand` (**undoable** doc mutation + scene regen, ADR-050
§3.5/§7). Re-projection (approve / region edit / undo / redo) flows through `ContextService`'s
`contextChanged` event into `_reproject()` (PHILOSOPHY #5).

The Matrix tab's actor column headers call `uiStore.actions.contextSetPersonaFilter`
directly (pure UI state, mirroring the demo's `demoSetPersonaFilter`). The tab
switch uses `contextSetTab` directly. **Approval re-projection is event-driven**:
the controller subscribes to `ContextService`'s `contextChanged` (§A2) and
re-projects from there, so approve / undo / redo all re-paint through one path.
Because approval is a geometry-invariant status flip, neither `execute()` nor
`undo()` regenerates the scene.

**Region authoring pointer flow (ADR-049 Phase 3)**: while `_demoCtrl.isAuthoring`,
`AppController._onPointerDown/Move/Up` delegate to `_demoCtrl.onAuthorPointerDown/Move/Up`
right after `updateMouse` and before the normal op-state branches. The handler raycasts the
widget handle meshes; on a hit it drags on the Z=0 ground plane, runs
`applyAdmissibleEdit → validateContext` live (R6), recolours widgets + the Inspector
**Conflict** tab, and consumes the event (OrbitControls disabled for the drag). A miss returns
`false` so camera orbit still works.

### Gizmo

| Element | Event | Action |
|---------|-------|--------|
| X axis | `click` | Snap camera to +X direction (front view) |
| Y axis | `click` | Snap camera to +Y direction (left side view) |
| Z axis | `click` | Snap camera to +Z direction (top view) |

---

## Event Processing Priority

When multiple events fire simultaneously:

```
1. Canvas target guard (pointerdown)
   → Return immediately for UI element clicks

2. Active operation handlers (high priority)
   grab.active → grab handler
   faceExtrude.active → faceExtrude handler

3. Current mode handlers
   'object' → object select / drag / rectSel
   'edit' (2d-sketch) → sketch drawing
   'edit' (3d) → sub-element selection

4. OrbitControls (fallthrough)
   Unconsumed pointer events → camera operation
```

---

## Undo/Redo Commands and Corresponding Events

Commands are recorded post-hoc via `push()` — never use `execute()` for pre-execution.

| Command | Recorded When | Undo Operation |
|---------|---------------|----------------|
| `MoveCommand` | Inside `_confirmGrab()` | Restore corner coordinates to startCorners |
| `AddSolidCommand` | After `_addObject()` confirmed | Delete the object |
| `DeleteCommand` | After `_deleteObject()` confirmed | `attachObject()` + `setVisible(true)` |
| `ExtrudeSketchCommand` | After `_confirmExtrude()` confirmed | Delete Solid, restore Profile |
| `RenameCommand` | After `_confirmRename()` confirmed | Restore previous name |
| `FrameRotateCommand` | After `_confirmRotate()` confirmed (CoordinateFrame) | Restore startQuat |
| `SolidRotateCommand` | After `_confirmRotate()` confirmed (Solid) | Restore startCorners |

---

## Related Documents

- `docs/STATE_TRANSITIONS.md` — state transition details for each operation
- `docs/SCREEN_DESIGN.md` — per-screen information architecture
- `docs/adr/ADR-013-domain-events-scene-service-observable.md` — domain events ADR
- `docs/adr/ADR-022-undo-redo-command-pattern.md` — Undo/Redo command pattern ADR
- `docs/adr/ADR-023-mobile-input-model.md` — mobile input model ADR
- `.claude/mental_model/2_interaction.md` — interaction coding rules
