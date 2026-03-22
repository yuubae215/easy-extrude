# Improvement Plan — 2026-03-22

Based on: `docs/validation/2026-03-22-full-repo-validation.md`
Total actionable items: **24** (3 critical, 2 high, 3 medium, 8 low, 3 ADR gaps, 5 UX)

---

## Priority 1 — CRITICAL (server data loss / crash)

All three are in `server/src/ws/sessionManager.js`. Fix together in one commit.

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1 | `:110` | `getScene()` not awaited in `handleResume()` | Add `async` to method; `await getScene(sceneId)` |
| 2 | `:286` | `getScene()` not awaited in `_autosave()` | Add `async` to `_autosave()`; `await getScene(...)` |
| 3 | `:290` | `updateScene()` not awaited in `_autosave()` | `await updateScene(...)` in same method |

---

## Priority 2 — HIGH (crash on malformed data)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4 | `sessionManager.js:121` | Unguarded `JSON.parse(row.data)` in `handleResume()` | Wrap in `try/catch`; send `PARSE_ERROR` to client |
| 5 | `sceneStore.js:38` | Unguarded `JSON.parse(row.data)` in `getScene()` | Wrap in `try/catch`; reject with structured error |

---

## Priority 3 — MEDIUM (state consistency)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 6 | `SceneService.js:97` | `openGeometryChannel()` has no re-entry guard | Add `if (this._wsChannel?.isOpen) return this._wsChannel` |
| 7 | `AppController.js:374-381` | Window event listeners never unregistered | Store refs; call `removeEventListener` in `dispose()` |
| 8 | `BffClient.js:110-125` | WebSocket listeners not removed on `close()` | Add `ws.removeEventListener()` in `close()` |

---

## Priority 4 — QC / Layer violations

| # | Validator | Location | Issue | Fix |
|---|-----------|----------|-------|-----|
| 9 | QC LAYER | `SceneSerializer.js:104-124` | `new Cuboid()` / `new Sketch()` called directly, bypassing `SceneService` | Move entity creation into `SceneService.deserializeScene()` or a factory method |
| 10 | QC VISUAL | `MeshView.js:488-492` | Direct `.visible` mutation bypasses visual-state owners | Call `setFaceHighlight(null)` / `setObjectSelected(false)` or add comment |
| 11 | QC NAMING | `AppController.js:49` | `Sketch` mapped to `'cuboid'` in `objectAdded` handler | Change to `obj instanceof ImportedMesh ? 'imported' : obj instanceof Sketch ? 'sketch' : 'cuboid'` |

---

## Priority 5 — ADR gaps (documentation / design)

| # | Gap | Location | Fix |
|---|-----|----------|-----|
| 12 | `ImportedMesh` entity not in ADR-009 | `src/domain/ImportedMesh.js` | Update ADR-009 Consequences to add `ImportedMesh`, or create ADR-018 "Thin-Client Entity" |
| 13 | `wsConnected`/`wsDisconnected` not in ADR-013 | `SceneService.js:113,117` | Add both events to ADR-013 event table, or note in ADR-017 § Frontend integration |
| 14 | Early-return guard pattern for read-only entities not in ADR-008 | `AppController.js:657` | Add note to ADR-008 Consequences: "read-only entity types may early-return `setMode('edit')` only if no in-progress ops are possible" |

---

## Priority 6 — UX (user feedback & accessibility)

| # | Category | Location | Issue | Fix |
|---|----------|----------|-------|-----|
| 15 | GRAB UX | `AppController.js:657,973` | No status feedback when G / Tab blocked for `ImportedMesh` | Add `setStatus('Imported geometry is read-only')` or `showToast()` in both early-return paths |
| 16 | KEYBOARD | `AppController.js:2049-2052` | Tab `preventDefault()` fires but `setMode('edit')` silently no-ops | Guard `e.preventDefault()`: check `instanceof ImportedMesh` first, show status message |
| 17 | TOOLBAR | `UIView.js:910` | Mobile toolbar button count varies by mode (3/2/4/2) | Add disabled spacer slots so every mode shows the same button count |
| 18 | A11Y | `OutlinerView.js:203-208` | Read-only icon distinguished by colour only | Add `title="Imported mesh (read-only)"` to `iconEl` span |
| 19 | A11Y | `OutlinerView.js:245-250` | Delete button is a `<span>`, not `<button>` | Change to `<button>` or add `role="button" aria-label="Delete"` |
| 20 | A11Y | `UIView.js:115-163` | Hamburger / N-panel toggle lack ARIA labels | Add `aria-label="Toggle outliner"` / `aria-label="Toggle properties panel"` |
| 21 | A11Y | `GizmoView.js:33-53` | Orientation gizmo canvas has no ARIA label | Add `role="img" aria-label="World orientation gizmo: click an axis to snap the camera"` |

---

## Priority 7 — LOW (minor correctness / robustness)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 22 | `AppController.js:786,804,839,1105,1275` | `parseFloat(...) \|\| 0` silently masks invalid input | Use explicit `isNaN()` check; show validation error toast |
| 23 | `import.js:51-67` | `face.position?.array` not validated before use | Validate mesh structure; warn on empty face data |
| 24 | `SceneService.js:155` | Geometry update error logged but not surfaced to user | Emit `'geometryError'` event or show toast in catch block |
| 25 | `ImportedMeshView.js:46` | `positions.length` not validated before `Float32BufferAttribute` | Add `if (positions.length % 3 !== 0)` guard |

---

## Recommended execution order

```
Phase A — Server stability (Priority 1 + 2)   → sessionManager.js + sceneStore.js
Phase B — Client state consistency (Priority 3) → SceneService + AppController + BffClient
Phase C — Layer / QC cleanup (Priority 4)       → SceneSerializer + MeshView + AppController
Phase D — ADR documentation (Priority 5)        → ADR-008, ADR-009 / ADR-018, ADR-013/017
Phase E — UX / A11Y (Priority 6)                → AppController + UIView + OutlinerView + GizmoView
Phase F — Low severity (Priority 7)             → AppController + import.js + SceneService + ImportedMeshView
```

Phases A and B are independent and can be executed in parallel.
Phases C and D are independent of each other and can also be run in parallel after A/B.
