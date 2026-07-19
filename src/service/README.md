# Service Layer — Side Effects, Coordination & Lock Management

**Responsibility**: Entity persistence (CRUD), cross-domain coordination,
BFF communication, and lock management.

Files: `SceneService.js`, `SceneSerializer.js`, `SceneExporter.js`,
`SceneImporter.js`, `CommandStack.js`, `BffClient.js`, `ContextService.js`,
`RoboticsService.js`, `GeometryEngine.js`, `ConstraintSolver.js`,
`SemanticInferencer.js`, `RoleService.js`

| Service | Responsibility |
|---------|---------------|
| `SceneService` | Entity factories + CRUD, observable domain events (ADR-013), world-pose cache, link views |
| `SceneSerializer` / `Exporter` / `Importer` | Scene ⇄ JSON v1.3 round-trip (schema `schema/scene-1.3.schema.json`) |
| `CommandStack` | Undo/redo stack (ADR-022) + landing listener (ADR-065) |
| `BffClient` | REST + WebSocket client for the BFF (incl. grasp search — ADR-054) |
| `ContextService` | Canonical context doc lifecycle; scene as derived projection (ADR-050/052) |
| `RoboticsService` | Measurement orchestration: FK reach / collision bake → doc facts (ADR-053) |
| `GeometryEngine` | Rust-wasm geometry engine binding (ADR-027) |

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

`new Solid()` / `new Profile()` / `new ImportedMesh()` etc. must always go
through factory methods in `SceneService` (`createSolid`, `createProfile`,
`createImportedMesh`, `createCoordinateFrame`, `createAnnotatedLine/Region/Point`,
`createSpatialLink`). Controllers and Views must never call `new` directly on
domain entities.
