# Service Layer — Side Effects, Coordination & Lock Management

**Responsibility**: Entity persistence (CRUD), cross-domain coordination,
BFF communication, and lock management.

Files: `SceneService.js`, `SceneSerializer.js`, `BffClient.js`

---

## Meta Model: The Permitted Side-Effect Boundary

The Service layer is the only internal layer that may produce side effects.
Three.js rendering, however, remains the View layer's responsibility.

| Permitted | Prohibited |
|-----------|------------|
| Read/write `SceneModel` | Direct `THREE.Mesh` creation |
| `fetch` / WebSocket | `document.querySelector` |
| `EventEmitter.emit()` | Business logic duplicated outside Domain |
| Lock flag management | `isProcessing` flags on entities (Service owns them) |

## Observable Pattern (ADR-013)

`SceneService` emits events:
- `objectAdded`, `objectRemoved`, `objectRenamed`, `activeChanged`

The Controller subscribes and updates the View only in response to these
events. The Service must never call View methods directly.

## Lock Ownership

### Optimistic lock (high-frequency operations)
Grab / selection updates are lock-free. The Service commits to `SceneModel`
immediately, without waiting.

### Pessimistic lock (consistency-critical operations)
```js
async heavyServiceOperation(id) {
  this._isProcessing = true
  try {
    // ... atomic work spanning multiple entities
  } finally {
    this._isProcessing = false
    this.emit('processingDone')
  }
}
```
`isProcessing` is owned by the Service and observed by the View to disable UI.
See `docs/CONCURRENCY.md` §3–4.

## Entity Factory Ownership (ADR-011)

`new Cuboid()` / `new Sketch()` / `new ImportedMesh()` must always go through
factory methods in `SceneService` (`createBox`, `createSketch`,
`createImportedMesh`). Controllers and Views must never call `new` directly on
domain entities.
