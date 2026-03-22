# Full Repository Validation Report — 2026-03-22

Scope: all source files under `src/` and `server/src/`.
Validators run: SQA · QC · ADR · UX (in parallel).
Phase C addendum: targeted re-run on Phase C files
(`ImportedMesh`, `ImportedMeshView`, `SceneService`, `OutlinerView`, `AppController`).

---

## Executive Summary

```
=== FULL REPOSITORY VALIDATION SUMMARY (incl. Phase C addendum) ===

SQA  : 12 issues (3 critical, 2 high, 3 medium, 4 low) across 9 files
QC   : 5 issues across 4 files. Categories: LAYER (1), VISUAL (1), NAMING (1), DOCS (2)
ADR  : 0 violations, 3 gaps across 5 files (Phase C). ADRs checked: ADR-002,004–017
UX   : 7 issues across 4 files. Categories: TOOLBAR (1), A11Y (4), GRAB (1), KEYBOARD (1)

Total actionable items: 24
Critical / blocking:    3
```

### Top-5 highest-priority findings

| Priority | Validator | File | Issue |
|----------|-----------|------|-------|
| 1 | SQA CRITICAL | `server/src/ws/sessionManager.js:110` | `getScene()` not awaited in `handleResume()` — Promise treated as data, crash on JSON.parse |
| 2 | SQA CRITICAL | `server/src/ws/sessionManager.js:286` | `getScene()` + `updateScene()` not awaited in `_autosave()` — data loss on server restart |
| 3 | SQA HIGH | `server/src/ws/sessionManager.js:121` | `JSON.parse(row.data)` unguarded — malformed DB record crashes handler without client error |
| 4 | SQA HIGH | `server/src/services/sceneStore.js:38` | `JSON.parse(row.data)` unguarded — malformed JSON causes unhandled rejection |
| 5 | QC LAYER | `src/service/SceneSerializer.js:104-124` | `new Cuboid()` / `new Sketch()` called directly in deserialize, bypassing `SceneService` |

---

## SQA — Software Quality Assurance

**SQA result: 12 issues (3 critical, 2 high, 3 medium, 4 low) across 9 files.**
*(Base: 9 issues across 8 files + Phase C addendum: 3 issues across 3 files)*

### CRITICAL

```
[CRITICAL] server/src/ws/sessionManager.js:110 — getScene() not awaited in handleResume()
  Rule violated: C (Error Handling)
  Suggested fix: Change `row = getScene(sceneId)` to `row = await getScene(sceneId)`

[CRITICAL] server/src/ws/sessionManager.js:286 — getScene() not awaited in _autosave()
  Rule violated: C (Error Handling)
  Suggested fix: Make _autosave() async and await all DB calls

[CRITICAL] server/src/ws/sessionManager.js:290 — updateScene() not awaited in _autosave()
  Rule violated: C (Error Handling — data loss)
  Suggested fix: Make _autosave() async and add await before updateScene()
```

### HIGH

```
[HIGH] server/src/ws/sessionManager.js:121 — Unguarded JSON.parse on row.data
  Rule violated: C (Error Handling)
  Suggested fix: Wrap in try/catch and send 'PARSE_ERROR' to client on failure

[HIGH] server/src/services/sceneStore.js:38 — Unguarded JSON.parse in getScene()
  Rule violated: C (Error Handling)
  Suggested fix: Wrap in try/catch block; reject with structured error
```

### MEDIUM

```
[MEDIUM] src/controller/AppController.js:374-381 — Window event listeners never unregistered
  Rule violated: D (State Consistency)
  Suggested fix: Store listener references and call removeEventListener in a dispose() method

[MEDIUM] src/service/BffClient.js:110-125 — WebSocket event listeners not removed on close()
  Rule violated: D (State Consistency)
  Suggested fix: Add ws.removeEventListener() calls in close()
```

### LOW

```
[LOW] src/controller/AppController.js:786,804,839,1105,1275 — parseFloat(...) || 0 silently masks invalid input
  Rule violated: B (Input Validation)
  Suggested fix: Use explicit isNaN() check and show a validation error toast

[LOW] server/src/routes/import.js:51-67 — face.position?.array not validated before use
  Rule violated: F (Code Correctness)
  Suggested fix: Validate mesh structure before flattening; warn on empty face data
```

### Phase C addendum (SQA)

```
[MEDIUM] src/service/SceneService.js:97 — openGeometryChannel() has no re-entry guard
  Rule violated: D (State Consistency)
  Suggested fix: Add `if (this._wsChannel?.isOpen) return this._wsChannel` before
    creating a new WsChannel, to prevent _wsUnsubs from being overwritten without cleanup

[LOW] src/service/SceneService.js:155 — geometry update error logged but not surfaced to user
  Rule violated: C (Error Handling — user visibility)
  Suggested fix: Emit a 'geometryError' event or show a toast in the catch block

[LOW] src/view/ImportedMeshView.js:46 — positions array length not validated before Float32BufferAttribute
  Rule violated: B (Input Validation)
  Suggested fix: Add `if (positions.length % 3 !== 0) { console.warn(...); return }` guard
```

---

## QC — Code Quality & Standards Compliance

**QC result: 5 issues across 4 files. Categories: LAYER (1), VISUAL (1), NAMING (1), DOCS (2).**
*(Base: 2 issues across 2 files + Phase C addendum: 3 issues across 3 files)*

```
[LAYER] src/service/SceneSerializer.js:104-124 — Entity creation outside SceneService
  Rule violated: A (Layer Responsibility)
  Suggested fix: Move new Cuboid()/new Sketch() calls into SceneService.deserializeScene()
    or a SceneService-owned factory method

[VISUAL] src/view/MeshView.js:488-492 — Direct .visible mutation in setVisible() bypasses owners
  Rule violated: F (Visual State Ownership)
  Suggested fix: Call setFaceHighlight(null) and setObjectSelected(false) instead of
    directly setting hlMesh.visible and boxHelper.visible to false; or add comment
    explaining why direct mutation is safe in this hide path
```

### Phase C addendum (QC)

```
[NAMING] src/controller/AppController.js:49 — Sketch mapped to type='cuboid' in objectAdded handler
  Rule violated: C (Naming Conventions — OutlinerView type parameter contract)
  Suggested fix: Change to `obj instanceof ImportedMesh ? 'imported' : obj instanceof Sketch ? 'sketch' : 'cuboid'`

[DOCS] src/service/SceneService.js:22 — wsConnected / wsDisconnected events missing from module docblock
  Rule violated: I (Documentation)
  Suggested fix: Add `'wsConnected' ()` and `'wsDisconnected' ()` to the "Events emitted" JSDoc block

[DOCS] docs/ARCHITECTURE.md:102 — ImportedMesh not documented in SceneObject structure
  Rule violated: I (Documentation — ARCHITECTURE.md out of date)
  Suggested fix: Add ImportedMesh entity description alongside Cuboid and Sketch
```

All other checks passed:
- No circular imports ✓
- Three.js addons imported from `three/addons/...` ✓
- CuboidModel.js is pure (no side effects, no Three.js) ✓
- `instanceof` type guards used correctly throughout ✓
- SceneService emits domain events for all state changes ✓
- Mode transitions always flow through `setMode()` ✓
- Memory lifecycle symmetry enforced in MeshView and ImportedMeshView ✓
- vite.config.js base is `/easy-extrude/` ✓
- Phase C: `createImportedMesh()` is sole factory — no direct `new ImportedMesh` outside service ✓
- Phase C: `ImportedMeshView` no-op stubs preserve `setMode()` safety ✓

---

## ADR — Architecture Decision Record Compliance

**ADR-validate result: 0 violations, 3 gaps (Phase C) across 5 files.**
*(Base: 0 violations, 0 gaps across 35 files)*

ADRs checked: ADR-002, ADR-004, ADR-005, ADR-006, ADR-007, ADR-008, ADR-009, ADR-010, ADR-011, ADR-012, ADR-013, ADR-014, ADR-015, ADR-016, ADR-017.

All 15 Accepted ADRs are fully implemented and consistently followed:

| ADR | Title | Status |
|-----|-------|--------|
| ADR-002 | Two Modeling Methods | ✓ COMPLIANT |
| ADR-004 | Edit Mode Type Dispatch | ✓ COMPLIANT |
| ADR-005 | Object Hierarchy / Dimensional Classification | ✓ COMPLIANT |
| ADR-006 | Right-click as Cancel | ✓ COMPLIANT |
| ADR-007 | Cuboid-based Shape Representation | ✓ COMPLIANT |
| ADR-008 | Mode Transition State Machine | ✓ COMPLIANT |
| ADR-009 | Domain Entity Types | ✓ COMPLIANT |
| ADR-010 | Domain Entity Behaviour Methods | ✓ COMPLIANT |
| ADR-011 | Application Service Layer | ✓ COMPLIANT |
| ADR-012 | Graph-based Geometry (Vertex/Edge/Face) | ✓ COMPLIANT |
| ADR-013 | Domain Events / Observable | ✓ COMPLIANT |
| ADR-014 | Edit Mode Sub-Element Selection | ✓ COMPLIANT |
| ADR-015 | BFF + Microservices Architecture | ✓ COMPLIANT |
| ADR-016 | Transform Graph (SE(3) tree) | ✓ COMPLIANT |
| ADR-017 | WebSocket Session Design | ✓ COMPLIANT |

### Phase C addendum (ADR)

```
[GAP] src/domain/ImportedMesh.js:1 — ImportedMesh as a third entity type has no ADR coverage
  ADR-009 defines the union as `Cuboid | Sketch`; ADR-015 Phase C mentions "cache-only entities"
  but does not name the type, its read-only contract, or the auto-create-on-geometry-update pattern.
  Suggestion: Update ADR-009 Consequences to add ImportedMesh, or create ADR-018
    "Thin-Client Entity (Phase C) — read-only imported geometry, no edit graph".

[GAP] src/service/SceneService.js:113,117 — wsConnected / wsDisconnected events not in ADR-013
  ADR-013 defines four domain events; two new WS lifecycle events are emitted without documentation.
  Suggestion: Add wsConnected / wsDisconnected to the ADR-013 event table, or note them
    in ADR-017 § Frontend integration.

[GAP] src/controller/AppController.js:657 — early-return guard for ImportedMesh bypasses ADR-008 cleanup sequence
  The pattern is safe today (Grab/Edit already blocked independently), but the contract
  "read-only entity types may early-return setMode('edit') only if no in-progress ops are possible"
  is not stated in any ADR.
  Suggestion: Add a note to ADR-008 Consequences covering this pattern.
```

Deferred items (not gaps — intentionally documented in ADRs):
- DAG editing UI (Phase C, ADR-017)
- Delta-sync on reconnect (Phase C, ADR-017)
- Multi-instance BFF session sharing (Redis, ADR-017)
- STEP B-rep topology access (open question, ADR-017)
- 1D object implementation (backlogged, ADR-005)

---

## UX — User Experience & UI Consistency

**UX result: 7 issues across 4 files. Categories: TOOLBAR (1), A11Y (4), GRAB (1), KEYBOARD (1).**
*(Base: 4 issues across 3 files + Phase C addendum: 3 issues across 2 files)*

```
[TOOLBAR] src/view/UIView.js:910 — Mobile toolbar button count varies across modes
  Rule violated: A (Mobile Toolbar Stability — MENTAL_MODEL §3)
  Detail: Object(3) / Edit2D(2) / Edit3D(4) / Grab(2) differ in button count
  Suggested fix: Add disabled spacer/placeholder buttons so every mode shows
    the same number of slots and prevents layout shifts

[A11Y] src/view/GizmoView.js:33-53 — Orientation gizmo canvas has no ARIA label
  Rule violated: F (Accessibility Basics)
  Suggested fix: Add role="img" aria-label="World orientation gizmo: click an axis
    to snap the camera" to the canvas element

[A11Y] src/view/UIView.js:115-163 — Hamburger and N-panel toggle buttons lack ARIA labels
  Rule violated: F (Accessibility Basics)
  Suggested fix: Add aria-label="Toggle outliner" and aria-label="Toggle properties panel"

[A11Y] src/view/OutlinerView.js:245-250 — Delete button is a <span>, not a <button>
  Rule violated: F (Accessibility Basics)
  Suggested fix: Change to <button> element or add role="button" aria-label="Delete"
```

### Phase C addendum (UX)

```
[GRAB] src/controller/AppController.js:657,973 — No status feedback when Grab (G) or Edit Mode (Tab) is blocked for ImportedMesh
  Rule violated: E (Grab UX — silent failure with no user feedback)
  Suggested fix: In _startGrab() and setMode() early-return paths, call
    this._uiView.setStatus('Imported geometry is read-only') or showToast()

[A11Y] src/view/OutlinerView.js:203-208 — Imported vs editable objects distinguished by icon colour alone
  Rule violated: F (Accessibility — colour-only state indicator)
  Suggested fix: Add title="Imported mesh (read-only)" to iconEl span so the
    read-only nature is discoverable without colour perception

[KEYBOARD] src/controller/AppController.js:2049-2052 — Tab preventDefault fires but setMode('edit') silently no-ops for ImportedMesh
  Rule violated: G (Keyboard Shortcuts — shortcut consumed without visible effect)
  Suggested fix: Guard before e.preventDefault(): check instanceof ImportedMesh
    and show a status message, or restructure so Tab only prevents default when
    mode transition will actually occur
```

All other UX checks passed:
- Touch `_onPointerDown` re-runs hit tests before `_handleEditClick` ✓
- Face extrude is gesture-only on mobile (no Extrude button in Edit 3D) ✓
- `_confirmFaceExtrude()` is in `_onPointerUp`, not `_onPointerDown` ✓
- Canvas target guard (`e.target !== renderer.domElement`) fires first ✓
- Rect selection does NOT disable OrbitControls ✓
- Toast positioned at `96px` on mobile, `64px` on desktop ✓
- Status bar routes to footer `_infoEl` on mobile ✓
- Keyboard shortcuts (Shift+A, G/X/Y/Z, Tab, E) all present ✓
- Object selection state restored on Edit→Object mode exit ✓
- Phase C: Mobile Edit button correctly `disabled` (not hidden) for ImportedMesh ✓
- Phase C: `ImportedMeshView` no-ops prevent stale visual state on mode transitions ✓

---

*Generated by `/validate-all` — see `.claude/commands/validate-all.md`*
*Phase C addendum added 2026-03-22.*
