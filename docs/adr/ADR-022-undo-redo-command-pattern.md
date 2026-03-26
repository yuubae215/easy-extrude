# ADR-022 — Undo / Redo via Command Pattern

**Date:** 2026-03-26
**Status:** Proposed
**Related:** ADR-008 (Mode Transition), ADR-010 (Domain Entity Behaviour), ADR-011 (SceneService), ADR-012 (Graph Model)

---

## Context

Currently every user operation (Grab, FaceExtrude, Delete, Add, …) is irreversible within a
session. Mistakes require the user to re-do the work manually. This is one of the most
impactful missing UX features for any modeling tool.

The domain layer already exhibits properties that make Command Pattern feasible:

- `Solid.move(startCorners, delta)` accepts a pre-captured snapshot (`startCorners`) — the
  inverse is trivially "restore `startCorners`".
- `Sketch.extrude(height)` returns a **new** `Solid` without mutating the original `Profile`
  — the inverse is to delete the `Solid` and restore the `Profile`.
- All entity creation / deletion flows through `SceneService`, which already emits
  `objectAdded` / `objectRemoved` domain events — commands can reuse these.

---

## Decision

Introduce a **`CommandStack`** singleton owned by `AppController`. Every user-confirmed,
state-mutating operation is wrapped in a `Command` object and pushed onto the stack.
`Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) undo / redo the top-most command.

### 1. CommandStack interface

```js
class CommandStack {
  /** Maximum history length. Older entries are evicted when exceeded. */
  static MAX = 50

  /** Execute a command and push it onto the undo stack. Clears the redo stack. */
  execute(command) { command.execute(); this._undo.push(command); this._redo = [] }

  /** Undo the most recent command. Moves it to the redo stack. */
  undo() { const cmd = this._undo.pop(); if (cmd) { cmd.undo(); this._redo.push(cmd) } }

  /** Redo the most recently undone command. */
  redo() { const cmd = this._redo.pop(); if (cmd) { cmd.execute(); this._undo.push(cmd) } }

  /** Discard all history (called on scene load / clear). */
  clear() { this._undo = []; this._redo = [] }
}
```

### 2. Command interface

Every command implements two methods:

```js
interface Command {
  execute(): void   // (re-)apply the operation
  undo():    void   // revert the operation
}
```

Commands are **plain objects** (no class hierarchy required). They capture all state needed
for both directions at construction time.

### 3. Undoable operations (Phase 1 scope)

| Operation | Command | State captured at construction |
|-----------|---------|-------------------------------|
| Grab confirm (single or multi) | `MoveCommand` | `Map<id, startCorners[]>` + `Map<id, endCorners[]>` |
| FaceExtrude confirm | `FaceExtrudeCommand` | `face`, `savedCorners[]`, `normal`, `dist` |
| Add Solid | `AddSolidCommand` | created `Solid` reference |
| Delete object | `DeleteCommand` | deleted entity object + parent id (for re-insertion) |
| Sketch → Extrude (Profile→Solid swap) | `ExtrudeSketchCommand` | `profileId`, `solidId`, both entity refs |
| Rename | `RenameCommand` | `id`, `oldName`, `newName` |

Deferred to Phase 2: `FrameRotateCommand`, `FrameMoveCommand`, scene-level batch operations.

### 4. State storage strategy — corner snapshots

Commands store **corner coordinate arrays** (`THREE.Vector3[]`), not full entity clones or
serialised JSON. Rationale:

- Corners are the minimal state needed to reconstruct visual and domain state for `Solid` /
  `Profile` / `MeasureLine` / `CoordinateFrame`.
- `THREE.Vector3` instances are lightweight (3 floats each; 8 per Solid = 24 floats).
- Full entity clones would require deep-copying `MeshView` (Three.js objects) — expensive
  and error-prone.
- JSON serialisation round-trips are unnecessary overhead for in-memory history.

```js
// MoveCommand construction (called from _confirmGrab)
const endCorners = new Map()
for (const [id, obj] of movedObjects) endCorners.set(id, obj.corners.map(c => c.clone()))

const cmd = {
  execute() { /* apply endCorners to each object */ },
  undo()    { /* restore startCorners to each object */ },
}
commandStack.execute(cmd)
```

### 5. Operations NOT on the undo stack

| Operation | Reason |
|-----------|--------|
| STEP import (`ImportedMesh` creation) | Geometry lives on the server; re-import requires a network round-trip. Show toast: "Import cannot be undone." |
| Scene load / save | Whole-scene replacement; stack is cleared instead. |
| Camera orbit / zoom | Camera state is not domain state; no undo needed. |
| CoordinateFrame visibility toggle | Display-only; no domain mutation. |
| Measure placement (Phase 1) | Deferred — `MeasureLine` is fully deletable as a workaround. |

### 6. History limit and eviction

`CommandStack.MAX = 50`. When `_undo.length > MAX` after a push, `_undo.shift()` evicts the
oldest entry. The evicted command's captured `THREE.Vector3` references are released for GC.

### 7. Stack lifecycle

| Event | Stack behaviour |
|-------|----------------|
| Scene load (`SceneService.loadScene`) | `commandStack.clear()` |
| Scene clear (`SceneService._clearScene`) | `commandStack.clear()` |
| Object delete | Undo stack entries that reference the deleted id remain valid — `DeleteCommand.undo()` re-adds the entity. |
| Mode transition (ADR-008) | No effect — stack persists across mode changes. |

### 8. Placement in the architecture

```
AppController
  ├── _commandStack: CommandStack          ← new
  ├── _confirmGrab()   → _commandStack.execute(new MoveCommand(...))
  ├── _confirmFaceExtrude() → ...
  ├── _deleteObject()  → ...
  └── _onKeyDown  Ctrl+Z → _commandStack.undo()
                 Ctrl+Y / Ctrl+Shift+Z → _commandStack.redo()

CommandStack                               ← new (src/service/CommandStack.js)
  _undo: Command[]
  _redo: Command[]

Command objects (src/command/)             ← new directory
  MoveCommand.js
  FaceExtrudeCommand.js
  AddSolidCommand.js
  DeleteCommand.js
  ExtrudeSketchCommand.js
  RenameCommand.js
```

`CommandStack` lives in `src/service/` (application-layer coordination, not domain logic).
Individual command files live in `src/command/` (one file per operation type).

### 9. UI surface

- **Desktop:** `Ctrl+Z` undo, `Ctrl+Shift+Z` / `Ctrl+Y` redo. No toolbar buttons in Phase 1.
- **Mobile:** Deferred — the mobile toolbar has no spare slot. Phase 2 may add a
  long-press-on-canvas gesture or a dedicated undo button in the header.
- **Status bar:** On undo/redo, briefly show `Undo: Move` / `Redo: Delete "Cube.001"` via
  `showToast()` so the user knows what was reversed.

---

## Consequences

### Positive

- Irreversible-operation anxiety eliminated for the most common workflows (move, extrude, delete).
- Corner-snapshot strategy is O(1) per command with negligible memory overhead for typical
  scene sizes (< 200 objects).
- Command objects are pure data + two functions — easy to unit-test in isolation without a
  Three.js scene.
- `Ctrl+Z` is the single most-requested missing feature; shipping Phase 1 alone (Move + Delete)
  delivers most of the value.

### Negative / Trade-offs

- `DeleteCommand.undo()` must re-add the entity to `SceneModel` **and** re-add its
  `MeshView` to the Three.js scene — this is the most complex inverse. Requires a new
  `SceneService.restoreObject(entity)` method.
- Commands that swap entities (`ExtrudeSketchCommand`: Profile → Solid) must carefully
  preserve `id`, `name`, and `meshView` ownership (same contract as the existing
  `SceneService.extrudeSketch()` swap pattern — see ADR-012).
- Multi-object Grab (`_selectedIds`) produces a single `MoveCommand` with a `Map` of all
  moved objects. This is correct but the undo label is generic ("Move N objects").
- `ImportedMesh` operations cannot be undone — users must be informed via toast, not silently
  excluded from the stack.

---

## Implementation Plan

| Phase | Scope | Estimated effort |
|-------|-------|-----------------|
| Phase 1 | `CommandStack` + `MoveCommand` + `Ctrl+Z`/`Ctrl+Y` keybinding | 1 session |
| Phase 2 | `FaceExtrudeCommand` + `ExtrudeSketchCommand` | 1 session |
| Phase 3 | `AddSolidCommand` + `DeleteCommand` (requires `restoreObject`) | 1–2 sessions |
| Phase 4 | `RenameCommand` + `FrameRotateCommand` + undo toast UI | 1 session |
| Phase 5 | Mobile undo UI + edge-case hardening | 1 session |

Start with Phase 1 only. Each phase ships independently and is immediately useful.

---

## Alternatives Considered

### A. Memento Pattern (full scene snapshot per operation)

Serialize the entire scene to JSON before each operation and restore on undo. Simple to
implement but memory-intensive (each snapshot is O(scene size)) and slow for large scenes
with `ImportedMesh` geometry. Rejected.

### B. Event Sourcing (replay from initial state)

Store all operations as events; undo by replaying without the last N events. Correct in
theory but prohibitively expensive for real-time use (replay cost grows with history length).
Rejected.

### C. Immutable entity tree (persistent data structures)

Replace mutable `THREE.Vector3[]` corners with an immutable persistent array structure.
Structurally elegant but requires pervasive refactoring of all geometry-mutation code.
Deferred — may become viable if the frontend moves to a React/Zustand architecture in Phase D.

---

## References

- ADR-008 — Mode Transition State Machine (cancellation semantics reused by undo)
- ADR-010 — Domain Entity Behaviour Methods (`move()`, `extrudeFace()` signatures)
- ADR-011 — SceneService (entity lifecycle; `extrudeSketch()` swap pattern)
- ADR-012 — Graph-based Geometry Model (corner arrays as canonical state)
- MENTAL_MODEL.md §1 — Entity Capability Contracts
