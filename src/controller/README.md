# Controller Layer — Input Handling & MVC Coordination

**Responsibility**: Translate raw input events (pointer, keyboard, touch) into
`SceneService` / `SceneModel` calls and `View` updates. The Controller is
intentionally thin — business logic must not live here.

Files: `AppController.js` (3D editor), `ContextController.js` (requirement
context — ADR-050), `GraspController.js` (grasp search FSM — ADR-057),
`ContextDemoController.js` (demo layer — ADR-047), `map/MapModeController.js`
(2D map mode — ADR-031/072), `handler/` (per-operation handlers, e.g.
`GrabOperationHandler`), `snap/` (snap logic), `HitTestService.js`,
`SelectionManager.js`, `UIStateManager.js`

---

## Meta Model: Thin Coordinator

The Controller is the only layer that is permitted to depend on both the
Service layer and the View layer at the same time. It must not contain business
logic, domain calculations, or rendering code.

| Permitted | Prohibited |
|-----------|------------|
| Reading `SceneModel` state | Geometry computation (belongs in `CuboidModel`) |
| Calling `SceneService` factory/CRUD methods | `new Solid()` / `new Profile()` directly |
| Calling `View` render/update methods | `THREE.*` object creation or manipulation |
| Subscribing to `SceneService` events | Duplicating domain logic from entities |

## Mode Transition Contract (ADR-008, `docs/code_contracts/architecture.md`)

`AppController.setMode(mode)` is the **single entry point** for all mode
transitions. Before switching the active object, always call `setMode('object')`
first if currently in Edit mode. This guarantees all in-progress operations
and visual states are cleaned up before the swap.

```js
if (this._selectionMode === 'edit') this.setMode('object')
// ... then _switchActiveObject(newId, true)
```

## Event Routing Pattern

The Controller subscribes to `SceneService` events and delegates to View:

```js
this._scene.on('objectAdded',   obj  => this._outliner.addItem(obj))
this._scene.on('objectRemoved', id   => this._outliner.removeItem(id))
this._scene.on('objectRenamed', obj  => this._outliner.renameItem(obj))
this._scene.on('activeChanged', obj  => this._outliner.setActive(obj?.id))
```

The Controller must never call `SceneService` from inside View callbacks, or
call View methods from inside Service methods — these would create circular
dependencies.

## Entity Type Guards

Before invoking Edit Mode, Grab, or drag operations, the Controller must check
entity type and show user feedback for unsupported types:

```js
if (obj instanceof ImportedMesh || obj instanceof MeasureLine) {
  this._uiView.showToast('...')
  return
}
```

See `docs/code_contracts/architecture.md` for the full list of read-only
entity types and required feedback messages.

## References

- ADR-008 — Mode transition state machine
- ADR-011 — Service as entity factory (Controller must not call `new` on entities)
- ADR-013 — Observable pattern (Controller↔Service event wiring)
- `docs/ARCHITECTURE.md` — Layer dependency diagram
- `docs/STATE_TRANSITIONS.md` — Mode transition diagram (+ operation FSM, ADR-039)
- `docs/code_contracts/architecture.md` / `interaction.md` — Mode transition and interaction rules
