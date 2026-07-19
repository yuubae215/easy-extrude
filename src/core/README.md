# Core Layer — Shared Infrastructure Utilities

**Responsibility**: Minimal, dependency-free utilities shared across all
other layers.

Files: `EventEmitter.js`, `StateMachine.js`, `editorStates.js`, `states/`
(operation state definitions — ADR-039)

---

## Meta Model: Zero Dependencies

Code in this layer **must have no imports** from any other `src/` layer or
from external libraries. It is the innermost ring — nothing inside the project
depends on nothing else inside the project.

| Prohibited | Reason |
|------------|--------|
| `import` from `three` | Rendering concern — belongs in View. |
| `import` from `src/domain/` or any other layer | Core must not depend inward. |
| Async dispatch / wildcard events | Keep surface minimal; not needed in-process. |

## EventEmitter

A minimal synchronous publish/subscribe bus used to implement the Observable
pattern (ADR-013) on `SceneService`.

```js
emitter.on('objectAdded', listener)   // subscribe
emitter.off('objectAdded', listener)  // unsubscribe
emitter.emit('objectAdded', obj)      // notify all listeners synchronously
```

All listeners are called synchronously and in registration order. There are no
wildcard events, no async dispatch, and no error isolation between listeners —
keep listeners lightweight and side-effect-free where possible.

## StateMachine (ADR-039)

`StateMachine.js` + `editorStates.js` + `states/` define the operation state
machine (`_opState`): explicit states, guarded transitions, and forbidden
transitions for editor operations. See `docs/STATE_TRANSITIONS.md` §Formal Spec.

## References

- ADR-013 — Observable / event-driven Controller↔Service wiring
- ADR-039 — Operation state machine
- `docs/ARCHITECTURE.md` — Layer dependency diagram
