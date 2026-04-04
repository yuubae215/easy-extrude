# Mental Model: Server-Side Async (Node.js BFF)

Detail file for `docs/CODE_CONTRACTS.md` Section 3.5.
See also: ADR-015 (BFF Microservices Architecture), ADR-017 (WebSocket Session Geometry Service).

---

## All DB calls must be awaited

- **Principle**: Async DB operations that are called without `await` silently return a Promise, not the data. The caller then operates on a Promise object, causing crashes (JSON.parse of an object) or silent data loss.
- **Concrete Rule**: Every call to `sceneStore.getScene()`, `sceneStore.updateScene()`, `sceneStore.createScene()`, and `sceneStore.deleteScene()` **must** be `await`ed. Functions that call these must themselves be declared `async`. Fire-and-forget wrappers (like `_autosave`) must be `async` and must wrap all `await` calls in `try/catch` so that the caller's promise chain is never rejected unexpectedly.

```js
// WRONG — row is a Promise object, not scene data
const row = getScene(sceneId)
JSON.parse(row.data)  // throws — row.data is undefined

// CORRECT
const row = await getScene(sceneId)
```

## PRAGMA journal_mode Must Not Run Inside a Transaction

- **Principle**: `@libsql/client`'s `db.batch()` wraps all statements in a transaction. SQLite forbids switching journal mode (`PRAGMA journal_mode = WAL`) from within a transaction, so including the PRAGMA in `batch()` causes a `LibsqlBatchError` at startup.
- **Concrete Rule**: Always `await db.execute('PRAGMA journal_mode = WAL')` as a standalone call *before* any `db.batch()`. Schema-creation DDL (`CREATE TABLE IF NOT EXISTS`) is safe inside `batch()`.

```js
// WRONG — throws LibsqlBatchError on startup
await db.batch(['PRAGMA journal_mode = WAL', 'CREATE TABLE IF NOT EXISTS ...'], 'write')

// CORRECT
await db.execute('PRAGMA journal_mode = WAL')
await db.batch(['CREATE TABLE IF NOT EXISTS ...'], 'write')
```

## Unguarded JSON.parse in DB layer

- **Principle**: A single malformed row in the database causes an unhandled rejection that crashes the current WebSocket handler or request — with no error returned to the client.
- **Concrete Rule**: Any `JSON.parse(row.data)` call in `sceneStore.js` must be wrapped in `try/catch` and re-throw a structured error so callers receive a meaningful error object instead of a generic `SyntaxError`.

## occt-import-js Geometry Structure

- **Principle**: `mesh.faces` in the occt-import-js result is **face-group metadata** (index ranges + per-face colour), not per-face geometry buffers. Accessing `face.position?.array` on these entries always returns `undefined`, silently producing zero vertices while the mesh count appears non-zero.
- **Concrete Rule**: Extract geometry at the **mesh level**, not the face level:
  ```js
  const pos = mesh.attributes?.position?.array ?? []  // Float32Array
  const nrm = mesh.attributes?.normal?.array   ?? []  // Float32Array
  const idx = mesh.index?.array                ?? []  // Uint32Array
  ```
  Use `mesh.faces` only for per-face colour/material lookups. Never use `push(...typedArray)` for large arrays — iterate with a `for` loop to avoid "Maximum call stack size exceeded".

## setIndex Requires BufferAttribute, Not Raw TypedArray

- **Principle**: `BufferGeometry.setIndex()` in Three.js only auto-wraps plain JS `Array`s into a `BufferAttribute`. If a raw `TypedArray` (e.g., `Uint32Array` from `base64ToU32`) is passed, the `else` branch stores it verbatim as `geometry.index`. The WebGL renderer then reads `geometry.index.array.byteLength` and crashes with "Cannot read properties of undefined (reading 'byteLength')" because a TypedArray has no `.array` property.
- **Concrete Rule**: In `ImportedMeshView.updateGeometryBuffers`, always wrap indices in a `THREE.BufferAttribute` before passing to `setIndex`:
  ```js
  this._geo.setIndex(
    Array.isArray(indices)
      ? indices  // Three.js wraps plain arrays automatically
      : new THREE.BufferAttribute(indices instanceof Uint32Array ? indices : new Uint32Array(indices), 1)
  )
  ```
  The base64 decode path (`base64ToU32`) returns a `Uint32Array`, so this wrapping is mandatory for all geometry received via WebSocket.

## Camera Far Clip and Fit for Imported Geometry

- **Principle**: The default camera `far = 100` is sized for hand-built voxel scenes. STEP files from real CAD tools routinely have bounding sphere radii in the hundreds or thousands of units (mm-scale parts). Geometry beyond `far` is clipped and invisible with no error.
- **Concrete Rule**: After any `updateGeometryBuffers` call for an `ImportedMesh`, call `SceneView.fitCameraToSphere(sphere.center, sphere.radius)` to reposition the camera and dynamically expand `camera.far` to `max(current far, dist*2 + radius*4)`. The trigger is the `geometryApplied` event emitted by `SceneService`. Never hard-code `camera.far` — let `fitCameraToSphere` expand it on demand.
