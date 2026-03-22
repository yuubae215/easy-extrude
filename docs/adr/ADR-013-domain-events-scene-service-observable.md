# ADR-013: Domain Events — Making SceneService Observable (DDD Phase 4)

- **Status**: Accepted
- **Date**: 2026-03-20
- **References**: ADR-011, ADR-010

---

## Context

Through DDD Phase 3 (ADR-011), `SceneService` was established as an ApplicationService.
However, `AppController` was still calling Views directly after every domain operation.

```js
// Up to Phase 3 — AppController._addObject
const obj = this._service.createCuboid()
this._outlinerView.addObject(obj.id, obj.name)  // ← direct call
this._switchActiveObject(obj.id, true)
```

This coupling made AppController a "notification bus" for domain operations,
requiring AppController to be modified whenever a View was added or removed.

---

## Decision

Make `SceneService` a subclass of `EventEmitter`, emitting domain events on state changes.

```
src/
  core/
    EventEmitter.js   # NEW: minimal pub/sub utility
  service/
    SceneService.js   # Extends EventEmitter, adds event emitting
  controller/
    AppController.js  # Switches to event subscriptions, removes direct View calls
```

### Events emitted by SceneService

| Event name | Arguments | Fired when |
|------------|-----------|------------|
| `objectAdded` | `obj: SceneObject` | After `createCuboid()` / `createSketch()` / `createImportedMesh()` completes |
| `objectRemoved` | `id: string` | After `deleteObject()` completes |
| `objectRenamed` | `id, name: string` | After `renameObject()` completes |
| `activeChanged` | `id: string\|null` | After `setActiveObject()` completes |
| `wsConnected` | _(none)_ | After `openGeometryChannel()` opens the WS connection (BFF Phase B) |
| `wsDisconnected` | _(none)_ | When the WS channel is closed by the server or network (BFF Phase B) |

### Changes to AppController

Subscribe to events in the constructor and auto-sync OutlinerView.

```js
this._service.on('objectAdded',   obj      => outlinerView?.addObject(obj.id, obj.name))
this._service.on('objectRemoved', id       => outlinerView?.removeObject(id))
this._service.on('objectRenamed', (id, nm) => outlinerView?.setObjectName(id, nm))
this._service.on('activeChanged', id       => outlinerView?.setActive(id))
```

Remove the corresponding direct View calls from `_addObject` / `_deleteObject` / `_switchActiveObject` / `_renameObject`.

`_switchActiveObject` calls `this._service.setActiveObject(id)` instead of `this._scene.setActiveId(id)`.

### Changes to SceneModel

Remove the `renameObject` facade method (it had been effectively dead code since Phase 3,
as SceneService calls `obj.rename()` directly).

---

## Consequences

**Benefits**
- AppController can perform domain operations without knowing the concrete View types
- Adding a new View (e.g. a property panel) requires only subscribing to events, without modifying AppController
- SceneService is now the sole official gateway for domain state

**Constraints**
- Status bar updates in UIView are still handled directly by AppController
  (these depend on interaction state — grab/hover — which doesn't map well to model events)
- All events are synchronously dispatched. Extend EventEmitter if async events are needed
