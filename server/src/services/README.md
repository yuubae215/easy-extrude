# Services Layer — Data Access

**Responsibility**: All database read/write operations for scene persistence.
Provides a typed async API over the raw `db` client.

Files: `sceneStore.js`

---

## Meta Model

| Permitted | Prohibited |
|-----------|------------|
| SQL queries via `db` from `db/database.js` | HTTP or WebSocket I/O |
| JSON serialisation / deserialisation of scene data | Business logic or geometry computation |
| Throwing structured errors on malformed data | Direct use of `req` / `res` objects |

## sceneStore.js — Public API

All functions are `async` and must be `await`ed by callers (see MENTAL_MODEL §3.5).

| Function | Signature | Returns |
|----------|-----------|---------|
| `listScenes()` | `()` | `{ id, name, created_at, updated_at }[]` |
| `getScene(id)` | `(string)` | `{ id, name, data, created_at, updated_at } \| null` |
| `createScene({ id, name, data })` | `(object)` | `{ id, name, created_at, updated_at }` |
| `updateScene(id, patch)` | `(string, { name?, data? })` | `{ id, name, updated_at } \| null` |
| `deleteScene(id)` | `(string)` | `boolean` |

## Key Contracts

- `getScene()` returns `null` when the id is not found. Callers must check before use.
- `getScene()` throws a structured `Error` (not a `SyntaxError`) when the stored `data` column is not valid JSON. Callers should propagate this as a `DB_ERROR` response.
- `updateScene()` returns `null` when the id is not found. Callers must check before use.
- `deleteScene()` returns `true` if the row was deleted, `false` if it did not exist.
- The `data` field is a plain JavaScript object (parsed from JSON). Callers receive and supply objects, not strings.

## Scene document shape

```js
{
  objects: SceneObjectDTO[],       // serialised Cuboid / Sketch entities
  transformGraph: {                // ADR-016
    nodes: TransformNode[],
    edges: TransformEdge[]
  },
  operationGraph: {                // ADR-017 (Phase B)
    nodes: OperationNode[],
    edges: OperationEdge[]
  }
}
```
