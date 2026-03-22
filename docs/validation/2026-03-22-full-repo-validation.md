# Full Repository Validation Report — 2026-03-22

Scope: all source files under `src/` and `server/src/`.
Validators run: SQA · QC · ADR · UX (in parallel).

---

## Executive Summary

```
=== FULL REPOSITORY VALIDATION SUMMARY ===

SQA  : 9 issues (3 critical, 2 high, 2 medium, 2 low) across 8 files
QC   : 2 issues across 2 files. Categories: LAYER (1), VISUAL (1)
ADR  : 0 violations, 0 gaps across 35 files. ADRs checked: ADR-002,004–017
UX   : 4 issues across 3 files. Categories: TOOLBAR (1), A11Y (3)

Total actionable items: 15
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

**SQA result: 9 issues (3 critical, 2 high, 2 medium, 2 low) across 8 files.**

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

---

## QC — Code Quality & Standards Compliance

**QC result: 2 issues across 2 files. Categories: LAYER (1), VISUAL (1).**

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

All other checks passed:
- No circular imports ✓
- Three.js addons imported from `three/addons/...` ✓
- CuboidModel.js is pure (no side effects, no Three.js) ✓
- `instanceof` type guards used correctly throughout ✓
- SceneService emits domain events for all state changes ✓
- Mode transitions always flow through `setMode()` ✓
- Memory lifecycle symmetry enforced in MeshView and ImportedMeshView ✓
- vite.config.js base is `/easy-extrude/` ✓

---

## ADR — Architecture Decision Record Compliance

**ADR-validate result: 0 violations, 0 gaps across 35 files.**

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

Deferred items (not gaps — intentionally documented in ADRs):
- DAG editing UI (Phase C, ADR-017)
- Delta-sync on reconnect (Phase C, ADR-017)
- Multi-instance BFF session sharing (Redis, ADR-017)
- STEP B-rep topology access (open question, ADR-017)
- 1D object implementation (backlogged, ADR-005)

---

## UX — User Experience & UI Consistency

**UX result: 4 issues across 3 files. Categories: TOOLBAR (1), A11Y (3).**

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

---

*Generated by `/validate-all` — see `.claude/commands/validate-all.md`*
