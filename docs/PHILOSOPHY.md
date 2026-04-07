# Philosophy — easy-extrude

Principles distilled from real design decisions, bug fixes, and post-mortems.
Each entry represents a value that was tested against reality and held.

> Philosophy is not knowledge to be understood — it is a standard to be practised
> in every code review, design decision, and document update.

---

## Maintenance guidelines

### Where this fits in the documentation hierarchy

| Document | Answers | Trigger | Granularity |
|----------|---------|---------|-------------|
| **`PHILOSOPHY.md`** (this file) | *Why* we make these choices | Same root value violated in 2+ unrelated contexts | Abstract — a named value with examples |
| **`CODE_CONTRACTS.md`** | *What* rule applies in a specific area | A bug revealed an implicit rule | Concrete — a specific method or class contract |
| **`DEVELOPMENT.md`** | *How* to work on this codebase | A workflow pattern proved more reliable | Procedural — steps, commands, agent strategies |

A principle belongs here only if it explains the **spirit** behind multiple CODE_CONTRACTS rules.
If a rule applies to one file or one class, it belongs in CODE_CONTRACTS, not here.

### What belongs here

- Values discovered through **recurring pain** — not hypothetical wisdom
- Reasoning that was **actively debated** before a direction was chosen
- Root causes shared by **two or more CODE_CONTRACTS rules** in unrelated areas
- Guidance that shapes **how a new contributor thinks**, not just what they do

**Do NOT add:**
- General software engineering best practices not specific to this project
- Rules about a single class or module (use CODE_CONTRACTS instead)
- Workflow or agent patterns (use DEVELOPMENT instead)
- In-progress notes or tentative ideas (use a task/plan instead)

### When to update

| Trigger | Action |
|---------|--------|
| The same root value was violated in 2+ unrelated files or features | Extract a principle; link to the CODE_CONTRACTS rules it underlies |
| A design debate resolved with a non-obvious conclusion | Encode the reasoning here so future contributors don't reopen it |
| A principle's wording led to a wrong implementation | Clarify the wording; add a "not this" counterexample |
| Experience reveals a principle applies more broadly than written | Widen its scope; update examples |
| A principle is now enforced structurally (type system, linter) | **Retire it** — structure is the source of truth, prose is redundant |
| A principle is really a single code rule | Move it to CODE_CONTRACTS; remove from here |

### How to update

1. Identify which existing principle (if any) the trigger relates to.
   Be conservative — a sharper existing principle beats a new one.
2. If adding: write in the format **Title — Subtitle**, then *what it means*,
   *how it manifests in this codebase*, and *why it matters*.
3. Add or update the row in the **Index** table at the bottom of this file.
4. Commit together with the code change or post-mortem that motivated it.
   The commit message should name the principle.

### Lifecycle states

| State | Meaning |
|-------|---------|
| *(no mark)* | Active — practised and relevant |
| ✗ Retired | Superseded or encoded structurally; kept as history |

---

## I. Design Philosophy

### 1. One Authoritative Entry Point

Every critical state transition has exactly one designated entry point. Never bypass it.

- `setMode()` is the sole entry point for all mode transitions.
- Before calling `_switchActiveObject()` from edit mode, always pass through `setMode('object')`.
- Bypassing creates split-brain: the model and view believe different modes are active —
  the resulting bugs are non-deterministic and nearly impossible to reproduce.

*Underlies CODE_CONTRACTS rules: Mode Transition Flow, CommandStack push() vs execute()*

---

### 2. Type Is the Capability Contract

What an entity *can do* is determined by its runtime type (`instanceof`), not by a property value.

- Never branch on a `dimension` field or string tag. Branch on `instanceof Solid`.
- When a type changes, its capabilities change — the type system enforces the contract.
- UI availability (Grab, Edit, Dup) is derived from type, not from ad-hoc flags.

*Underlies CODE_CONTRACTS rules: Entity Capability Contracts, MeasureLineView No-Op Interface*

---

### 3. Separate Pure Computation from Side Effects

Every function is either a pure computation (deterministic, no I/O) or a side-effectful
operation (DOM, Three.js, storage, mutation). Never mix the two in one function.

- `CuboidModel.js` contains only geometry arithmetic — no Three.js, no DOM.
- Views and Controllers own all side effects; the domain layer owns none.
- Mixed functions are untestable, non-composable, and the source of the hardest bugs.

*Underlies CODE_CONTRACTS rules: Visual State Ownership, Pure / Side-Effect Separation*

---

### 4. Every Visual Flag Has One Owner

Each piece of visual state is written by exactly one method. No scattered assignments.

- `hlMesh.visible` is written only by `setFaceHighlight()`.
- `boxHelper.visible` is written only by `setObjectSelected()`.
- When two code paths both write a flag, the last write wins unpredictably.
  Ownership eliminates this class of race entirely.

*Underlies CODE_CONTRACTS rules: Visual State Ownership*

---

### 5. Communicate Through Events, Not References

Views and Controllers subscribe to domain events. They do not hold back-references into the model.

- `SceneService` emits `objectAdded`, `objectRemoved`, `objectRenamed`, `geometryApplied`.
- `OutlinerView` reacts to events — it does not poll or reference `SceneModel` directly.
- Direct references couple modules; events decouple them, making each independently testable.

*Underlies CODE_CONTRACTS rules: Entity Swap Must Emit Events, _clearScene Emit Order*

---

### 6. Transformations Return New Instances

Transformation verbs produce a new entity without mutating the source.

- `Profile.extrude(height)` returns a new `Solid`. The Profile is unchanged.
- `SceneService.extrudeSketch()` performs the model swap — the domain method stays pure.
- Immutable transformations make undo/redo natural and eliminate hidden mutation bugs.

*Underlies CODE_CONTRACTS rules: Entity Swap Must Emit Events, Soft-Delete Pattern*

---

## II. Concurrency

### 7. Choose Your Locking Strategy Before You Write Code

Decide whether an operation is *optimistic* (prioritise responsiveness) or
*pessimistic* (prioritise consistency) before implementation — not ad hoc.

| Strategy | When to use | Examples |
|----------|-------------|---------|
| Optimistic (non-blocking) | User needs immediate feedback | Object drag, camera orbit, sub-element selection |
| Pessimistic (blocking) | Data integrity is critical | Boolean ops, scene save/load, file import |

- Pessimistic operations set `isProcessing = true`, disable input, and show a spinner.
- Mixing strategies produces either a frozen UI or silent data corruption.

*Underlies CODE_CONTRACTS rules: `isProcessing` flag, Concurrency strategy (CLAUDE.md)*

---

### 8. Every Async Call Must Be Awaited at Its Layer

`await` every DB and network call. Never let a Promise pass through as data.

- Every `sceneStore.*()` call is `await`ed; the enclosing function is `async`.
- Fire-and-forget wrappers (e.g. `_autosave`) wrap the `await` in `try/catch`.
- A forgotten `await` delivers a Promise to `JSON.parse` — a silent crash with no stack trace.

*Underlies CODE_CONTRACTS rules: All DB calls must be awaited, PRAGMA journal_mode*

---

## III. Memory and Lifecycle

### 9. Allocations and Deallocations Are Symmetric

Every `scene.add()` has a matching `scene.remove()` + `.dispose()` in the same class.

- The teardown lives in the same file as the allocation — written in the same commit.
- `_clearScene()` emits `objectRemoved` for each object *before* swapping the model.
- Broken symmetry leaves ghost objects: invisible in the scene, still alive in memory and logic.

*Underlies CODE_CONTRACTS rules: Object Lifecycle Symmetry, _clearScene Emit Order*

---

### 10. Delete Softly; Dispose Late

Preserve undo capability by keeping deleted entities alive but invisible until the undo stack releases them.

- `_deleteObject()` calls `detachObject()` (remove from model) + `setVisible(false)` (keep GPU resources).
- `dispose()` is called only in cascade-delete and `_clearScene()`.
- The command stack limit (MAX=50) bounds the invisible mesh count automatically.

*Underlies CODE_CONTRACTS rules: Soft-Delete Pattern*

---

## IV. Error Handling and Feedback

### 11. Silent Failures Are the Hardest Bugs

Every blocked operation must surface to the user. A silent no-op is never acceptable.

- `JSON.parse(row.data)` is always wrapped in `try/catch` — malformed data throws, not crashes.
- An early-return that blocks an operation always shows `showToast()` first.
- "Keyboard shortcut consumed but nothing happened" is the worst UX bug: the user thinks the app is broken.

*Underlies CODE_CONTRACTS rules: Unguarded JSON.parse, Read-Only Entity Early-Return*

---

## V. Interaction Design

### 12. One Continuous Gesture Over Multiple Button Steps

Primary spatial operations complete in a single unbroken gesture, not a multi-step button sequence.

- Mobile face extrude: tap → drag → release = done (one action, no separate confirm button).
- Gestures are *discovered*, not read from a manual — the best design teaches itself.
- A button sequence that takes 3 taps to do what one drag can do is 3x the friction.

*Underlies CODE_CONTRACTS rules: Gesture-Based Interaction Priority, Interaction Confirmation Lifecycle*

---

### 13. Touch Does Not Pass Through Hover

Touch devices do not fire `pointermove` before `pointerdown`. Never assume hover state precedes a tap.

- `_onPointerDown` always re-runs `_hitFace()` before edit selection logic, regardless of `_hoveredFace`.
- Violating this means touch taps never select sub-elements — a complete silent failure.

*Underlies CODE_CONTRACTS rules: Touch vs. Pointer Asymmetry*

---

### 14. Disable Controls Only When Input Truly Conflicts

Disable OrbitControls only when a specific operation fully consumes the same input gesture.

- Rect selection does NOT disable OrbitControls (uses 1-finger; orbit uses 2-finger).
- Measure placement and Grab DO disable OrbitControls (both consume 1-finger-drag).
- Unnecessary disabling traps the user — they cannot navigate and cannot understand why.

*Underlies CODE_CONTRACTS rules: OrbitControls Disable Strategy*

---

## VI. UI Stability

### 15. Toolbar Slots Are Fixed; Buttons Are Not Removed

Mobile toolbar button positions must never shift between states.

- Each mode has a fixed slot count (Object = 5, Edit 3D = 4).
- Temporarily unavailable actions use `disabled: true` — never removal.
- Absent slots are padded with `{ spacer: true }` invisible placeholders.
- A shifting button triggers an accidental tap on the wrong action — data loss risk.

*Underlies CODE_CONTRACTS rules: Mobile Toolbar Stability*

---

### 16. Discovery Is a Design Deliverable

Secondary actions are better discovered through contextual gestures than memorised toolbar positions.

- Long-press (≥ 400 ms, < 8 px movement) reveals Grab / Duplicate / Rename / Delete.
- Fewer visible buttons reduce cognitive load without reducing capability.
- Menu items are filtered by entity type — the context menu is smart, not generic.

*Underlies CODE_CONTRACTS rules: Long-Press Context Menu*

---

## VII. Interface Contracts

### 17. Polymorphic Interfaces Must Be Complete

Every method called through a polymorphic reference must exist on all concrete types.
If the behaviour does not apply, implement a no-op.

- `MeasureLineView` implements every `MeshView` method as a no-op.
- A missing method produces a `TypeError` that silently aborts the input handler — no error log, no user feedback.
- When a new method is added to `MeshView`, all sibling Views receive a no-op in the same commit.

*Underlies CODE_CONTRACTS rules: MeasureLineView No-Op Interface*

---

### 18. Emit the Event, Then Perform the Swap

When an entity is replaced outside the standard create/delete path, always emit the
corresponding domain events — `objectRemoved` before the swap, `objectAdded` after.

- `extrudeSketch()` emits both events. It does not silently swap the model.
- Without events, `OutlinerView` and `AppController` diverge from the model state invisibly.
- Every direct `addObject()` / `removeObject()` call is a suspect — verify it emits.

*Underlies CODE_CONTRACTS rules: Entity Swap Must Emit Events, _clearScene Emit Order*

---

### 21. Coordinate Spaces Are Statically Distinguished

Every `Vector3` in the spatial computation layer belongs to exactly one coordinate space.
The type system must enforce this — not documentation, not naming conventions, not code review.
Mixing coordinate spaces produces wrong numeric results: valid JavaScript, no runtime exception,
no stack trace. The bug is invisible until it manifests visually or physically.

- **Local space** (`LocalVector3`): a position or offset expressed relative to a parent frame.
  `CoordinateFrame.translation` and `CoordinateFrame.corners` are local space.
- **World space** (`WorldVector3`): a position expressed in the scene's global coordinate system.
  `Cuboid.corners`, `ImportedMesh.corners`, and every value in `_worldPoseCache` are world space.
- Both are `THREE.Vector3` at runtime. Without branded types the compiler cannot distinguish them.

**The failure mode is asymmetric and insidious**: geometry `corners` and frame `corners` share
the same property name, the same JavaScript type, and the same shape — but their semantics are
opposite. Code that works for geometry silently produces wrong results for frames.

**Immediate measure**: branch on `instanceof CoordinateFrame` at every call site that reads
`corners` for a spatial computation, and document the contract in CODE_CONTRACTS.

**Permanent measure**: use JSDoc branded types so the type checker rejects misuse at compile time:

```js
/** @typedef {import('three').Vector3 & { _brand: 'world' }} WorldVector3 */
/** @typedef {import('three').Vector3 & { _brand: 'local' }} LocalVector3 */
```

No runtime overhead. No TypeScript migration. `tsc --checkJs` enforces the distinction in CI.

*Underlies CODE_CONTRACTS rules: CoordinateFrame.corners Is Local Space*

---

## VIII. Living Documentation

### 19. Documentation Drift Is a Bug

The code, ADRs, and mental model must stay in sync. A partially updated codebase is a partially
broken codebase — the undocumented part will cause the next bug.

- After every bug fix, ask: *"Did this bug exist because an implicit rule was missing?"*
- If yes → add the rule to `CODE_CONTRACTS.md` before committing the fix.
- After every design decision, ask: *"Will a future contributor understand why we chose this?"*
- If no → write the principle here or in an ADR before the session ends.

*Underlies CODE_CONTRACTS rules: Documentation Drift, DEVELOPMENT two-pass pattern*

---

### 20. Narrow Focus Finds What Broad Scans Miss

For verification, give an agent a small named file list rather than `src/**/*.js`.

- A broad scan of 35 files spreads context thin; subtle issues receive proportionally less attention.
- Run broad validators in parallel (structural violations), then focused validators sequentially
  on recently changed files (ADR text drift, silent UX failures).
- This is Pass 1 → Pass 2 in the two-pass pattern (see `DEVELOPMENT.md`).

*Underlies DEVELOPMENT rules: Two-pass pattern, Focused Agents > Broad Agents*

---

## Index

| # | Principle | Chapter | Underlies |
|---|-----------|---------|-----------|
| 1 | One Authoritative Entry Point | Design | Mode Transition Flow, CommandStack |
| 2 | Type Is the Capability Contract | Design | Entity Capability Contracts, No-Op Interface |
| 3 | Separate Pure Computation from Side Effects | Design | Visual State Ownership, Pure/Side-Effect |
| 4 | Every Visual Flag Has One Owner | Design | Visual State Ownership |
| 5 | Communicate Through Events, Not References | Design | Entity Swap Emit, _clearScene Order |
| 6 | Transformations Return New Instances | Design | Entity Swap, Soft-Delete |
| 7 | Choose Your Locking Strategy Before You Write Code | Concurrency | isProcessing, CONCURRENCY.md |
| 8 | Every Async Call Must Be Awaited at Its Layer | Concurrency | DB calls, PRAGMA |
| 9 | Allocations and Deallocations Are Symmetric | Memory | Object Lifecycle Symmetry |
| 10 | Delete Softly; Dispose Late | Memory | Soft-Delete Pattern |
| 11 | Silent Failures Are the Hardest Bugs | Errors | JSON.parse guard, Read-Only Early-Return |
| 12 | One Continuous Gesture Over Multiple Button Steps | Interaction | Gesture Priority, Confirmation Lifecycle |
| 13 | Touch Does Not Pass Through Hover | Interaction | Touch vs. Pointer Asymmetry |
| 14 | Disable Controls Only When Input Truly Conflicts | Interaction | OrbitControls Disable Strategy |
| 15 | Toolbar Slots Are Fixed; Buttons Are Not Removed | UI | Mobile Toolbar Stability |
| 16 | Discovery Is a Design Deliverable | UI | Long-Press Context Menu |
| 17 | Polymorphic Interfaces Must Be Complete | Contracts | MeasureLineView No-Op Interface |
| 18 | Emit the Event, Then Perform the Swap | Contracts | Entity Swap Emit |
| 19 | Documentation Drift Is a Bug | Living Docs | CODE_CONTRACTS maintenance, ADR drift |
| 20 | Narrow Focus Finds What Broad Scans Miss | Living Docs | DEVELOPMENT two-pass pattern |
| 21 | Coordinate Spaces Are Statically Distinguished | Contracts | CoordinateFrame.corners Is Local Space |
