# SQA Validator — Software Quality Assurance

Perform a focused SQA review on the files specified in `$ARGUMENTS`, or on all recently changed source files if no argument is given.

## Steps

### 1. Identify target files

- If `$ARGUMENTS` is provided, review those files.
- Otherwise, run `git diff --name-only HEAD~1 HEAD` (fallback: `git status --short`) and review all modified `.js` files under `src/` and `server/src/`.

### 2. Read each target file in full

Use the Read tool on every identified file.

### 3. Evaluate each file against the following SQA checklist

#### A. Memory Management (Three.js) — MENTAL_MODEL §4

- [ ] Every `scene.add()` in a constructor has a matching `scene.remove()` + `.dispose()` in `dispose()`.
- [ ] Every `new THREE.BufferGeometry()` / `new THREE.Material()` has `.dispose()` in `dispose()`.
- [ ] No dangling mesh references after `deleteObject()`.

#### B. Input / Boundary Validation

- [ ] User inputs (pointer coordinates, keyboard values, WebSocket messages, REST request bodies) are validated at the system boundary before being passed inward.
- [ ] Numeric inputs from UI (type-in distances, extrude heights) have NaN / bounds checks.
- [ ] No `eval()`, `innerHTML` with unsanitised strings, or similar XSS vectors.

#### C. Error Handling

- [ ] `fetch` / `WebSocket` calls handle network failures (`.catch()` or `try/catch`).
- [ ] Errors that reach the user surface a toast or status message — they are never silently swallowed.
- [ ] No unguarded `.` access on values that can be `null` or `undefined` at runtime.

#### D. State Consistency

- [ ] Event listeners added in constructors or `start()` are removed in `dispose()` / `stop()`.
- [ ] No shared mutable state mutated from multiple unrelated paths without synchronization.
- [ ] Pointer-event lifecycle: `pointerdown` → `pointermove` → `pointerup` always paired; no leaked `_activeDragPointerId`.

#### E. Security (OWASP-relevant)

- [ ] No command injection in server-side shell calls.
- [ ] No SQL injection (use parameterised queries / prepared statements for SQLite).
- [ ] No path traversal in file-serving endpoints.
- [ ] CORS / Content-Security-Policy headers present on BFF responses.

#### F. Code Correctness

- [ ] No off-by-one errors in index loops over `faces[6]` or `edges[12]`.
- [ ] Geometry functions in `CuboidModel.js` are pure (no side effects, no `this`).
- [ ] `instanceof` type guards match MENTAL_MODEL §1 contracts (`instanceof Sketch` = 2D, `instanceof Cuboid` = 3D, `instanceof ImportedMesh` / `instanceof MeasureLine` = read-only).
- [ ] Every code path that accesses `.corners` on a selected object guards with `selObj.corners` or `instanceof ImportedMesh` check — `ImportedMesh` has no vertex graph.
- [ ] Every code path that calls `setMode('edit')` or `_startGrab()` for `ImportedMesh` / `MeasureLine` emits a `showToast('Imported geometry is read-only')` before returning.

#### G. Server-Side Async (Node.js BFF) — MENTAL_MODEL §3.5

- [ ] Every call to `sceneStore.getScene()`, `sceneStore.updateScene()`, `sceneStore.createScene()`, `sceneStore.deleteScene()` is `await`ed. Functions calling these are declared `async`.
- [ ] Fire-and-forget wrappers (e.g. `_autosave`) are `async` and wrap all `await` calls in `try/catch`.
- [ ] `PRAGMA journal_mode = WAL` is run as a standalone `await db.execute(...)` call, **not** inside `db.batch()`.
- [ ] `JSON.parse(row.data)` in the DB layer is wrapped in `try/catch` and re-throws a structured error.
- [ ] `occt-import-js` geometry is extracted at the mesh level (`mesh.attributes?.position?.array`), not at `mesh.faces[n].position` which is always `undefined`.
- [ ] After `updateGeometryBuffers` for an `ImportedMesh`, `SceneView.fitCameraToSphere()` is triggered (via `geometryApplied` event) to prevent far-clip cutoff.

#### H. Memory Management — WsChannel

- [ ] In `WsChannel._connect()`, bound event handlers are stored as instance properties (`_onWsOpen`, `_onWsMessage`, `_onWsClose`, `_onWsError`).
- [ ] In `WsChannel.close()`, all four handlers are removed via `removeEventListener` before `ws.close()` and `this._ws = null`.

### 4. Report findings

For each issue found:

```
[SEVERITY] File:line — Description
  Rule violated: <checklist item letter>
  Suggested fix: <one-line suggestion>
```

Severity levels: **CRITICAL** (data loss / security) · **HIGH** (crash / memory leak) · **MEDIUM** (silent wrong behaviour) · **LOW** (style / robustness).

If no issues are found, output: `✓ SQA: no issues found in <file list>`.

### 5. Summary

Output a one-line summary:
```
SQA result: N issues (C critical, H high, M medium, L low) across X files.
```
