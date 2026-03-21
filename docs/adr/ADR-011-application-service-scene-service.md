# ADR-011: Introducing the ApplicationService Layer — SceneService (DDD Phase 3)

- **Status**: Accepted
- **Date**: 2026-03-20
- **References**: ADR-009, ADR-010

---

## Context

Through DDD Phase 2 (ADR-010), domain entities (`Cuboid` / `Sketch`) gained their own behaviour methods.
However, `AppController` still:

1. Owns entity factory responsibilities (`new Cuboid(...)`, `new MeshView(...)`)
2. Handles direct CRUD operations on `SceneModel` (`addObject` / `removeObject`)
3. Mixes these with its primary responsibilities of input handling, mode transitions, and view updates

This left AppController playing two roles: "controller reacting to user input" and "service performing domain operations".

---

## Decision

Create `src/service/SceneService.js` as an ApplicationService and consolidate entity creation and CRUD operations there.

```
src/
  service/
    SceneService.js   # NEW: ApplicationService
  model/
    SceneModel.js     # Aggregate Root (unchanged)
  domain/
    Cuboid.js
    Sketch.js
  controller/
    AppController.js  # Focused solely on input handling
```

### SceneService responsibilities

| Operation | Method |
|-----------|--------|
| Create and register Cuboid | `createCuboid()` |
| Create and register Sketch | `createSketch()` |
| Delete entity + dispose MeshView | `deleteObject(id)` |
| Rename (delegated to entity) | `renameObject(id, name)` |
| Toggle visibility (delegated to MeshView) | `setObjectVisible(id, visible)` |
| Read aggregate root | `get scene()` → SceneModel |

### Changes to AppController

- `this._scene = new SceneModel()` → `this._service = new SceneService(sceneView.scene)`
- Add `get _scene()` shorthand to maintain read access to SceneModel
- `_addObject` / `_deleteObject` / `_renameObject` / `_setObjectVisible` simply call `this._service.*`
- Direct instantiation of `new Cuboid`, `new Sketch`, `new MeshView` removed from AppController

---

## Consequences

**Benefits**
- AppController's responsibility is narrowed to "input → service call → view update"
- Entity creation logic is consolidated in SceneService, improving testability
- Establishes the pattern of modifying SceneModel only through the service, in preparation for Phase 4 (domain events)

**Constraints**
- SceneService holds a reference to the Three.js scene because MeshView creation requires it
- This coupling remains until the View/Model separation is completed in Phase 4 (domain events)
