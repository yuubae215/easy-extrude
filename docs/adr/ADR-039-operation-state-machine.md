# ADR-039: Runtime Operation State Machine

**Status**: Accepted  
**Date**: 2026-05-09  
**Supersedes**: —  
**Superseded by**: —

---

## Context

`AppController` manages five mutually exclusive "secondary operation" states
within Object Mode:

| Operation | Flag (before) | Checked via |
|-----------|---------------|-------------|
| Grab      | `this._grab.active` | scattered `if (_grab.active)` |
| Rotate    | `this._rotate.active` | scattered `if (_rotate.active)` |
| Face Extrude | `this._faceExtrude.active` | scattered `if (_faceExtrude.active)` |
| Measure Placing | `this._measure.active` | scattered `if (_measure.active)` |
| Spatial Link Mode | `this._spatialLinkMode.active` | scattered `if (_spatialLinkMode.active)` |

Each flag was a plain boolean on a state object.  Transitions (set/clear) were
scattered across ≈ 60 call sites: `_startGrab`, `_cancelGrab`,
`_confirmGrab`, pointer handlers, key handlers, `setMode()`, etc.

### Problems

1. **No mutual exclusion guarantee** — `_rotate.active = true` and
   `_grab.active = true` could coexist if a guard was missed.
   `_startRotate()` had to manually check `if (this._grab.active) return`
   instead of the invariant being structural.

2. **Documentation drift** — `docs/STATE_TRANSITIONS.md` §Formal FSM Specification
   was marked *"design document only — no runtime `StateMachine` class yet"*.
   Developers adding new operations had no enforced pattern, so each
   secondary state machine was implemented differently.

3. **Magic strings** — State values like `'2d-sketch'`, `'idle'`, `'drawing'`
   were hardcoded at every call site.

4. **No mental model for new stateful features** — Without a runtime FSM
   class, the design instinct of "define states and transitions first" had no
   code anchor.

---

## Decision

Introduce a lightweight runtime `StateMachine` class and migrate the five
Object Mode operations to it.

### `src/core/StateMachine.js`

Minimal Moore-Mealy hybrid FSM matching the JSON notation in
`STATE_TRANSITIONS.md §Formal FSM Specification`:

- **States**: plain string constants (exported from `src/core/editorStates.js`)
- **Transitions**: `{ from, on, to, guard?, action? }` array
- **`send(event)`**: finds first matching transition (same `from`, same `on`,
  guard passes), calls `action`, updates state; returns `true` on fire
- **`can(event)`**: dry-run guard check without state update
- **`is(state)`**: check current state

### `src/core/editorStates.js`

Named constants for all FSM state strings:

```js
// Object Mode operation FSM
export const S_OBJECT_IDLE     = 'S_OBJECT_IDLE'
export const S_GRAB_ACTIVE     = 'S_GRAB_ACTIVE'
export const S_ROTATE_ACTIVE   = 'S_ROTATE_ACTIVE'
export const S_FACE_EXTRUDE    = 'S_FACE_EXTRUDE'
export const S_MEASURE_PLACING = 'S_MEASURE_PLACING'
export const S_LINK_MODE       = 'S_LINK_MODE'

// Edit substates, Map draw states, …
```

### `AppController._opState`

Single `StateMachine` instance replacing all five `.active` flags:

```js
this._opState = new StateMachine(S_OBJECT_IDLE, [
  { from: S_OBJECT_IDLE,    on: 'BEGIN_GRAB',          to: S_GRAB_ACTIVE },
  { from: S_GRAB_ACTIVE,    on: 'CONFIRM',              to: S_OBJECT_IDLE },
  { from: S_GRAB_ACTIVE,    on: 'CANCEL',               to: S_OBJECT_IDLE },
  { from: S_OBJECT_IDLE,    on: 'BEGIN_ROTATE',         to: S_ROTATE_ACTIVE },
  { from: S_ROTATE_ACTIVE,  on: 'CONFIRM',              to: S_OBJECT_IDLE },
  { from: S_ROTATE_ACTIVE,  on: 'CANCEL',               to: S_OBJECT_IDLE },
  { from: S_OBJECT_IDLE,    on: 'BEGIN_FACE_EXTRUDE',   to: S_FACE_EXTRUDE },
  { from: S_FACE_EXTRUDE,   on: 'CONFIRM',              to: S_OBJECT_IDLE },
  { from: S_FACE_EXTRUDE,   on: 'CANCEL',               to: S_OBJECT_IDLE },
  { from: S_OBJECT_IDLE,    on: 'BEGIN_MEASURE',        to: S_MEASURE_PLACING },
  { from: S_MEASURE_PLACING, on: 'CONFIRM',             to: S_OBJECT_IDLE },
  { from: S_MEASURE_PLACING, on: 'CANCEL',              to: S_OBJECT_IDLE },
  { from: S_OBJECT_IDLE,    on: 'BEGIN_LINK',           to: S_LINK_MODE },
  { from: S_LINK_MODE,      on: 'CONFIRM',              to: S_OBJECT_IDLE },
  { from: S_LINK_MODE,      on: 'CANCEL',               to: S_OBJECT_IDLE },
])
```

### Method contract (after migration)

Each operation follows a three-phase contract:

| Phase | Call site | What happens |
|-------|-----------|--------------|
| Start | `_startX()` | Domain guards (with toasts) run first. If all pass, `this._opState.send('BEGIN_X')` is called — provides mutual exclusion; returns false if another op is active. |
| Confirm | `_confirmX()` | Guard: `if (!this._opState.is(S_X)) return`. Does work. Calls `this._opState.send('CONFIRM')` at the end to return to `S_OBJECT_IDLE`. |
| Cancel | `_cancelX()` | Guard: `if (!this._opState.is(S_X)) return`. Restores state. Calls `this._opState.send('CANCEL')` at the end. |

`setMode()` cancels the active operation using:

```js
if (this._opState.is(S_GRAB_ACTIVE))   this._cancelGrab()
if (this._opState.is(S_ROTATE_ACTIVE)) this._cancelRotate()
if (this._opState.is(S_FACE_EXTRUDE))  this._cancelFaceExtrude()
```

---

## Alternatives Rejected

| Alternative | Reason rejected |
|-------------|-----------------|
| XState / Zag | Production dependency for a focused, bounded problem |
| Enum + switch | Guard conditions and actions are hard to express declaratively |
| No-op (document only) | Perpetuates the drift between spec and code; no forcing function |
| Full migration of all state (Map mode, Edit substates, _endpointDrag) | Higher risk; deliver the pattern with operations first; migrate others incrementally |

---

## Consequences

**Positive**:

- Mutual exclusion is structural: `BEGIN_GRAB` cannot fire from `S_GRAB_ACTIVE`
  because no such transition exists; no manual cross-flag checks required.
- The FSM spec in `STATE_TRANSITIONS.md` is now the design input for
  `AppController._opState`'s transition table — documentation and code stay in sync.
- New operations follow a clear pattern: add rows to `editorStates.js`,
  add transitions to `_opState`, follow the three-phase contract.
- `.active` boolean flags are removed from `_grab`, `_rotate`, `_faceExtrude`,
  `_measure`, `_spatialLinkMode`; those objects become pure data holders.

**Constraints**:

- `StateMachine` is synchronous and single-threaded only (fine for UI events).
- Transitions currently have no `action` — methods call `send()` themselves.
  This is intentional: methods handle complex domain logic (toasts, undo
  snapshots) that shouldn't be hidden inside a transition table.
- `_mountPicking`, `_framePlacementState`, and `_endpointDrag` retain their
  own `.active` flags; they are not part of `_opState` (deferred to a follow-up).

---

## Implementation Reference

- `src/core/StateMachine.js` — FSM class
- `src/core/editorStates.js` — state name constants
- `src/controller/AppController.js` — `this._opState`, migrated methods
- `docs/STATE_TRANSITIONS.md` §Formal FSM Specification — now marked Implemented
