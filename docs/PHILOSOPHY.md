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

A principle belongs here only if it explains the **spirit** behind multiple CODE_CONTRACTS
rules; a one-file/one-class rule belongs in CODE_CONTRACTS.

### What belongs here

Values discovered through **recurring pain**, reasoning that was **actively debated**,
root causes shared by **2+ CODE_CONTRACTS rules** in unrelated areas, and guidance that
shapes **how a contributor thinks**. Do NOT add: generic best practices, single-class
rules (→ CODE_CONTRACTS), workflow patterns (→ DEVELOPMENT), or in-progress notes.

### When to update

| Trigger | Action |
|---------|--------|
| The same root value was violated in 2+ unrelated files or features | Extract a principle; link to the CODE_CONTRACTS rules it underlies |
| A design debate resolved with a non-obvious conclusion | Encode the reasoning here so future contributors don't reopen it |
| A principle's wording led to a wrong implementation | Clarify the wording; add a "not this" counterexample |
| Experience reveals a principle applies more broadly than written | Widen its scope; update examples |
| A principle is now enforced structurally (type system, linter) | **Retire it** — structure is the source of truth, prose is redundant |
| A principle is really a single code rule | Move it to CODE_CONTRACTS; remove from here |
| A bug fix where Q2 is "almost but only 1 context" | Add a row to the **Yellow Cards** table (above the Index); graduate when 2nd context found |

### How to update

Prefer sharpening an existing principle over adding one. New entries use **Title — Subtitle**,
then *what it means*, *how it manifests here*, *why it matters*. Update the **Index** table,
and commit together with the motivating change (commit message names the principle).
Lifecycle: unmarked = active; ✗ Retired = superseded or encoded structurally, kept as history.

---

## I. Design Philosophy

### 1. One Authoritative Entry Point

Every critical state transition has exactly one designated entry point. Never bypass it.

- `setMode()` is the sole entry point for all mode transitions.
- Before calling `_switchActiveObject()` from edit mode, always pass through `setMode('object')`.
- Bypassing creates split-brain: the model and view believe different modes are active —
  the resulting bugs are non-deterministic and nearly impossible to reproduce.

The same principle applies to domain entity mutation: a domain class owns the invariant
between its primary state and its derived state. External code must use the class's
public mutation API — never reach in and call the private rebuild method directly.

- `Solid._rebuildWorldCorners()` maintains `vertices[i].position = _position + orientation × localCorners[i]`.
  External code (commands, services, controllers) must call `restorePose()`, `move()`, `rotate()`, etc.
  Calling `_rebuildWorldCorners()` from outside `Solid.js` is a bypass: the invariant is maintained
  by convention of the caller, not by the class's own API boundary.

*Underlies CODE_CONTRACTS rules: Mode Transition Flow, CommandStack push() vs execute(), Solid Pose Mutation Must Use Public API*

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

### 24. Derive Absolute State from Invariant Sources — Never Feed Derived Values Back

Per-frame computations must take their inputs from immutable local data, never from
the outputs of a previous run of the same computation. A derived value re-used as
an input seeds an error feedback loop: the error compounds each frame, growing until
it causes visible divergence or blows up entirely.

Three concrete manifestations in this codebase:

**a) solidLocalOffset back-computed from _worldPoseCache** (first fix)
`solidLocalOffset` was derived from `_worldPoseCache` (a world-space value produced by
the previous frame). FP rounding in the centroid-from-corners step fed a tiny error
back into `_position` each frame. Far from the origin — where large coordinates lose
mantissa precision — this compounded into slow divergence. Symptom: "rotates slowly →
flies off-screen; returns to origin → recovers." Fixed by accumulating directly from
`cf.translation`/`cf.rotation` (local, invariant).

**b) Delta quaternion accumulation** (second fix)
`dq = currentQuat × prevQuat⁻¹` accumulated each frame. Sign drift in `prevQuat`
caused `dq` to approach a 180° flip at hemisphere boundaries. Fixed by deriving the
absolute pose in one step from the solver's output — no accumulation at all.

**c) avg(corners) used as parentWorldPos in _updateWorldPoses** (third fix)
`_updateWorldPoses()` and `_getParentWorldPos()` computed the Solid's world-origin
as `avg(corners)` — an average of 8 world-space vertices. The constraint solver then
used this as an input to compute a new `_position`, which `_rebuildWorldCorners()`
wrote back into `corners`. This closed a frame-to-frame loop:

```
_position → corners → avg(corners) ≈ parentWorldPos → solver → new _position
```

`avg(corners)` carries FP rounding from 8 large-coordinate additions, so the re-computed
`_position` drifted `~1e-14` per frame — visible far from origin, catastrophic under slow
rotation (many frames), invisible under fast rotation, reset at the origin: matching the
reported symptoms exactly.

Fixed by replacing `avg(corners)` with `parent._position` directly (the authoritative
ADR-040 primary triple). In `_updateFastenedFrames`, `solidLocalOffset` now seeds from
`new Vector3()` (exact zero) instead of `avg(localCorners)` (≈ zero but not exact).

**The general rule**: if a derived quantity feeds back into the computation that
produced it — even indirectly, even across two different methods — the cycle
accumulates error every frame. Audit any path where a per-frame output becomes
a per-frame input.

**The failure mode is asymmetric**: the code is valid JavaScript, throws no exception,
and produces a value that is a plausible scene position — invisible until the error
compounds enough to be visually obvious, which can take seconds or minutes.

**The invariant to check**: if removing the derived quantity and replacing it with the
invariant source produces the same mathematical result, the derived path is a liability
— remove it.

*Underlies CODE_CONTRACTS rules: Fastened Constraint Limitations (1a)*

---

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

### 22. Narrower Scope Wins in Hit-Testing

Hit-test priority must match what the user is actually targeting — not just what geometry
arrives first in the raycast pipeline. Two concrete manifestations:

**a) Children before parents in scene hierarchy.**
When entity A is a child of entity B and both occupy the same screen region, test A first.
The parent's geometry physically covers the child; testing the parent first silently
redirects every tap intended for the child.

- `_onPointerDown` runs `_hitAnyCoordinateFrame()` before `_hitAnyObject()` (cuboid).
  A CF rendered on top of its parent Solid: testing the Solid first would select the Solid —
  the CF long-press context menu never fires, "Link to..." stores the Solid id as source,
  and the subsequent `_confirmFastenFrame` instanceof check fails.
- `_hitAnyEntityForLink()` checks CF (Step 0) before the cuboid raycast (Step 1) for the
  same reason: the Solid behind the CF would otherwise be returned as the link target,
  causing `_computeValidLinkTypes(CF, Solid)` to omit "fastened".

**b) Tool gizmo drag and object selection are independent operations.**
A tool gizmo (e.g. TransformControls) must not shadow unrelated scene entities
through its collision volumes — neither visible nor invisible.

- On mobile, `_hitAnyObject()` tests only domain cuboids. TC gizmo meshes are
  never in the result, so no explicit hit-guard is needed. TC handles its own
  drag via its own pointer listeners; AppController handles selection independently.
- On touch, tapping empty space (no entity in `result`) immediately deselects —
  this is the industry-standard tap-to-deselect behaviour (Shapr3D, Nomad Sculpt).
- Invisible picker meshes (`visible=false`) must never block selection. This
  applies to all raycasts against the TC helper, if such a test were ever added.

*Underlies CODE_CONTRACTS rules: CoordinateFrame Tap Selection, _hitAnyEntityForLink CF Priority, TC Gizmo Does Not Block Object Selection*

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

### 26. A Screen Edge Is a Shared Resource

A `position: fixed` element anchored to a screen edge implicitly claims that edge.
Two persistent opaque panels layered on the same edge produce a silent overlap:
no error, no warning — the lower-z element simply ceases to exist for the user.

Every edge-anchored element must therefore either be *transient with a higher z-index*
(drawer, dropdown, modal) or *offset itself past the current occupants*. And because
occupancy is dynamic (panels open and close), the offset must be computed in one
authoritative place from the full occupancy state — not patched ad hoc at each
toggle call site (same spirit as #23 and #25).

Two manifestations found on the same day, in unrelated features:

- **Left edge**: `LinkNetworkView` (z:50, `left:8px`) rendered entirely behind the
  Outliner sidebar (z:90, opaque, 180px, always visible on desktop). The link graph
  was unreachable — users reported it as "missing".
- **Right edge**: the Context DSL demo Inspector (ADR-047, 280px, z:100) covered both
  the N panel (z:90) and the world gizmo (z:10). The pre-existing gizmo-offset
  mechanism (`setRightOffset`) knew only about the N panel, because it was wired
  inside `_toggleNPanel()` — a per-call-site patch that no new panel would ever know
  to extend. Fixed by making `AppController._updateGizmoOffset()` the sole owner,
  driven by a uiStore subscription over all right-edge occupancy state.

**The failure mode is asymmetric**: the layout renders, nothing throws, and each
panel looks correct in isolation — the overlap is only visible when both happen
to be open, which may be a state the developer never tested.

*Underlies CODE_CONTRACTS rules: Edge-Anchored Panels Must Coordinate Occupancy*

---

### 27. Overlay Markers Are Sized in Screen Space, Capped in World Space

A marker view (frame axes, anchor icons, annotation glyphs) sized by an absolute
constant in *either* space alone encodes a hidden assumption that reality will break:

- An absolute **world-unit** size assumes a scene scale. `AnnotatedPointView`'s
  `MARKER_RADIUS = 0.25` was invisible (sub-pixel) in the mm-scale Context DSL demo
  scene — while its HTML label, sized in pixels, kept rendering. The user saw
  "label without icon".
- An absolute **screen-pixel** size without a world cap assumes a camera distance.
  `CoordinateFrameView`'s constant-screen-size axes ballooned to dwarf the whole
  scene when zooming out, until a finite `maxWorldSize` cap was enforced.
- The ground `GridHelper` (20 world units) is the same assumption at scene level:
  in the mm-scale demo scene it collapsed to an invisible dot — "the world grid
  is gone". Fixed by scaling it with the scene radius in `fitCameraToSphere()`
  (power-of-10 cells, so grid lines stay on round coordinates).

The correct shape is always the pair: *target size in screen pixels, clamped to a
world-space bound derived from the scene (scene radius, parent bounding radius)*.
One bound without the other is the same bug in mirror image.

**The failure mode is asymmetric**: both versions render valid markers with no
exception; the marker is just imperceptibly small or absurdly large, and only at
scene scales or zoom levels the developer didn't try.

*Underlies CODE_CONTRACTS rules: CoordinateFrame Scale Cap, Annotation Marker Screen-Space Scale, Ground Grid Scales With Scene Radius*

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

### 23. Accessors Own Their Freshness Guarantee

A derived-state accessor is responsible for ensuring the value it returns is current.
Never push that responsibility to callers.

When callers must manually run a "refresh" step before every read, N−1 of them will
eventually skip it — the invariant is maintained only by convention, not structure.

- `worldPoseOf()` called `_updateWorldPoses()` on cache miss, instead of requiring
  every call site to guard manually.  11 of 14 call sites were missing the guard;
  grab, rotate, hit-test, N-panel, and link-mode all silently fell back to origin.
- The one accessor method is the single authoritative enforcement point.
  An invariant that lives in N callers lives in none of them reliably.

**The failure mode is asymmetric**: the code compiles, no exception is thrown,
the fallback value (0,0,0) is a plausible position — the bug is invisible until
the user drags a CoordinateFrame and it teleports.

*Underlies CODE_CONTRACTS rules: `worldPoseOf()` self-healing (SceneService)*

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
  `CoordinateFrame.translation` and `CoordinateFrame.localOffset` are local space.
- **World space** (`WorldVector3`): a position expressed in the scene's global coordinate system.
  `Solid.corners`, `ImportedMesh.corners`, and every value in `_worldPoseCache` are world space.
- Both are `THREE.Vector3` at runtime. Without branded types the compiler cannot distinguish them.

**The failure mode is asymmetric and insidious**: when geometry `corners` and frame `corners`
shared the same property name, the same JavaScript type, and the same shape — but their semantics
were opposite — code that worked for geometry silently produced wrong results for frames.

**Phase 1 — Hotfix**: branch on `instanceof CoordinateFrame` at every call site.
**Phase 2 — Branded types**: JSDoc `WorldVector3`/`LocalVector3` brands; `tsc --checkJs` in CI —
no runtime overhead, no TypeScript migration; the type checker rejects misuse.
**Phase 3 — Structural separation** (the full expression of this principle):
`CoordinateFrame` no longer has a `corners` property. It exposes `localOffset` instead.
Accessing `.corners` on a frame returns `undefined` — the API shape itself makes confusion
impossible, not just detectable. This is aligned with PHILOSOPHY #2 ("Type Is the Capability
Contract"): a `CoordinateFrame` does not have world-geometry corners, and its API reflects that.

The `_grabHandlesOf(obj)` helper centralises the one remaining `instanceof` branch so all
grab/move/undo code stays clean without scattered checks.

*Underlies CODE_CONTRACTS rules: CoordinateFrame.localOffset vs Geometry.corners*

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

### 25. Guard Logic Belongs in Service Predicates, Not Inline Handler Returns

Preconditions for a domain operation belong in a named service method.
Handler code calls the predicate once and acts on the result. It does not inline its own guard logic.

An inline early return in a handler is only permitted when it works around a specific
library or runtime constraint — not when it enforces a domain rule.

**The permitted case:** `if (e.target !== renderer.domElement) return` — this is a browser
event-bubbling workaround with no service-layer analogue. There is no domain rule that says
"ignore events not aimed at the canvas"; it is a quirk of the host environment.

**The violation:** inlining a domain guard as an early return in a handler
(`if (selObj instanceof Solid && service.hasFastenedChild(id)) { showToast(); return }`).
This was done at two call sites (G-key grab, QuickDrag) instead of inside
`checkMoveGuardrail`; any future code path that moves objects would silently omit the guard.

**The correct pattern:**
```js
// One authoritative predicate; handler is oblivious to its internals
const result = service.checkMoveGuardrail(selectedIds)
if (result.blocked) { showToast(result.message); return }
```

All preconditions for movement — whether they enforce semantic design intent (fastened link),
solver conflict (hasFastenedChild), or role access (RoleService) — belong inside the
corresponding service predicate, not scattered across handlers.

*Underlies CODE_CONTRACTS rules: Semantic Move Guardrail (checkMoveGuardrail)*

---

## VII. Interface Contracts (cont.)

### 28. Mutual Means Round-Trip Up to a Normal Form, Never a Literal Inverse

When two representations must convert both ways but the forward map is many-to-one,
"Mutual" cannot mean byte-identity — that target is unreachable. The canonical reconciliation
is a structure-preserving round-trip *up to a quotient / normal form*: the forward map is a
homomorphism (many-to-one), and the reverse is a **section** that picks one canonical
representative per equivalence class — recovering the structure, not the surface. Test the
invariant that *can* hold (a fixpoint, or isomorphism on the quotient), not an impossible identity.

Three manifestations in this codebase, in unrelated layers:

- **NL ⇄ doc (ADR-052).** Defined as "structural isomorphism on the synonym quotient." φ (NL→doc)
  folds synonyms many-to-one; φ⁻¹ recovers the whole 5W1H Why-tree but only **one** representative
  surface word per synonym class. `SynonymQuotient.localize` is the section. ADR-056 makes this
  isomorphism *computable*: `CanonicalForm.canonicalSignature` is the ref-invariant WL normal form on
  that quotient, turning the round-trip into the machine-checkable invariant
  `docSignature(φ(NL)) === docSignature(structural-recovery)` — no longer an anecdotal golden test.
- **Scene ⇄ Layout DSL (ADR-055).** `compileLayout` folds the placement `strategy` and slugs `ref`s
  into ids (many-to-one). `decompileLayout` emits the canonical representative
  (`strategy:'manual'`, explicit positions, prefix-stripped refs). The law is the **scene fixpoint**
  `compileLayout(decompileLayout(scene)) ≡ scene` — proven on the scene side, never claimed as
  byte-identity on the DSL side. Expressiveness gaps that would break the fixpoint (a rotated Solid)
  are closed additively (`rotation`); what still can't round-trip is **reported**, not silently dropped.
- **Ubiquitous KPI (ADR-053 §1.1).** Reconciles the user-domain and system-domain KPIs not via a
  two-sided inverse but a section on the synonym quotient + a criterion preimage (pullback).

**The mistake this guards against:** treating the canonical mapping as two-sided-invertible, then
losing provenance / structure when the surface cannot be restored — and worse, asserting a
round-trip "works" by an identity test that quietly only holds for inputs the developer happened
to try. Name the quotient, pick the representative, and prove the fixpoint.

*Underlies CODE_CONTRACTS rules: LayoutDecompiler scene fixpoint (ADR-055); SynonymQuotient / ProvenanceNarrative (ADR-052 Phase 4); CanonicalForm WL normal form (ADR-056)*

---

### 29. Rigor on the Wire, Play in the Client — 契約は決定を運び、UI は体感を所有する

The correctness boundary and the experience boundary obey **opposite** design pressures,
and confusing them corrupts both. The contract / API boundary carries only *committed
facts the solver decided* — logically exact, conservatively versioned, **closed**
(`additionalProperties:false`), grown only by a deliberate versioned act. The UI owns
*experience* — playful, low-friction, inviting — and **derives** presentation client-side
from those wire facts. A high-brow, austere UI is never touched; a playful one gets used
early and yields feedback early. So play is not a luxury here, it is how the project learns.

The two failure directions are symmetric and both must be guarded:

- **UI play leaking into contract laxity.** Every visualization need tempts a new optional
  field on the wire (`pose.tcp?`, `gripperWidth?`, `approachVector?`…). Unchecked, the
  contract grows an unbounded bag of presentation conveniences and stops being a rigorous
  decision record. *The naming tell:* a field named `optional`/`*?` for its cardinality
  rather than its meaning is usually presentation bolt-on, not a committed fact.
- **Contract rigor making the UI austere.** Treating the rigorous wire shape as the UI's
  shape produces a literal, numeric, intimidating interface (a joints array printed as text)
  that no one wants to touch.

**The inclusion test for a wire field:** *"Is this a committed fact the solver decided, or a
presentation convenience?"* Only the former goes on the wire. The latter is derived in the
client. Approach vectors, ghost colour, animation, fades, gripper glyphs — all derived from
the wire facts (an end-effector frame, a score), never demanded back as new wire entities.
This is also the **growth governor**: visualization needs grow client derivations, not the
contract; the contract grows only when the solver genuinely decides a *new kind of fact*, and
that growth is a discriminated `kind`, not an open accretion of optionals.

This sharpens the repo's existing scope boundary ("declare/schema here, solving upstream"):
that boundary says *where solving lives*; this principle says *where rigor lives vs where
play lives*, and they cut differently — the rigorous wire is owned upstream, the playful
experience is owned here, and presentation never crosses onto the wire.

**Scope note (ADR-062, 2026-07-05)**: this principle applies to *every* UX surface, not just
the grasp thread it was distilled from. The proof-feedback loop (input → proof layer decides
a fact → client derives the "it worked" presentation) is the default shape for any input or
result surface; the shared primitives live in `FeedbackPrimitives` / `FeedbackMath`, and the
presentation history behind a delta chip / landing flash stays component-local — never a
store field, never a wire field.

**Scope note (ADR-064, 2026-07-08)**: symmetric to the play-side note above, *rigor* is the
default for **every wire** (HTTP route, WS message, file format, DSL), not a property of the
grasp thread it was distilled from. Every wire is one of two states — (a) it has a closed,
versioned schema with a CI conformance test, or (b) it is *explicitly declared* out of rigor
scope with a reason and a deadline. There is no third state (implicit no-contract) — an
undeclared uncontracted wire is the silent failure #11 forbids, one layer up. The repo's own
declared surface (Layout/Context DSL) gets the same schema treatment grasp-contract received:
the schema is the **shape** contract (`additionalProperties:false`, enum vocabularies), the JS
validator keeps the **meaning** contract (semantic rules a schema cannot express), and a drift
test pins the two vocabularies equal so neither becomes a silent second source (§1.1).

*Underlies CODE_CONTRACTS rules: Grasp Contract Is Derived, Never Defined; BffClient Surfaces the Contract-Error Envelope (ADR-054); ContextController Grasp Walkthrough (ADR-057 score-first); ADR-060 contract governance; ADR-059 client-derived ghost; Shared Feedback Primitives (ADR-062); DSL Schema Is the SHAPE Contract (ADR-064 Phase 2)*

---

## Yellow Cards — Pending Elevation

Single-context violations that do not yet meet the 2+ threshold for a named principle.
When the same root value is violated in a second **unrelated** context, move the entry
to the main body as a full principle and add a row to the Index.

### How to update

Add a row when a bug fix's Q2 answer is "almost, but only 1 context so far"; note the second
context when the same root value appears in an unrelated file/feature; graduate to a full
principle once 2+ contexts exist (remove the row); remove stale rows made impossible by refactoring.

| Candidate Principle | First Context (date · file · what happened) | CODE_CONTRACTS Rule |
|---------------------|---------------------------------------------|---------------------|
| Overflow-escaping popups belong on body | 2026-05-01 · `UIView.js` · `_modeDropdownEl` was a child of the header (which has `overflow:hidden`); the dropdown was clipped below the header boundary and unselectable. Fixed by moving to `document.body` with `position:fixed` + `getBoundingClientRect()` positioning, matching the already-correct `_moreMenuDropdown` pattern. | Mobile Header Overflow |
| Three.js helpers must match the actual geometry model, not an approximation | 2026-05-02 · `MeshView.js` · `THREE.BoxHelper` computes AABB; because `MeshView` bakes corner positions as world-space vertices with no mesh transform, the AABB diverges from the actual OBB after R-key rotation. After confirming rotation, the selection highlight appeared as an axis-aligned box larger than the solid, visually rotating independently. Fixed by replacing `BoxHelper` with `LineSegments+EdgesGeometry` kept in sync by `updateGeometry()`. | BoxHelper Forbidden for World-Space Baked Geometry |
| Per-frame derived values must be computed before their consumers in the same frame | 2026-05-18 · `AppController.js` animation loop · `updateLabelPosition()` read `_group.position` before `_updateWorldPoses()` set it for the current frame, causing CF labels to lag one frame behind and appear to vibrate at startup. Fixed by moving `_updateWorldPoses()` to run before the per-object label loop. The failure mode is asymmetric: the bug is invisible when the scene is static (lag = 0 px); it only manifests when the cache is being populated (startup) or when the CF moves (drag). | CF Label Position Order |
| *(graduated to principle #24 — Derive Absolute State from Invariant Sources)* | | |
| Rendering layer must match spatial role — scene objects use depthTest, overlays bypass it | 2026-05-21 · `Annotated{Region,Line,Point}View.js` · `depthTest: false` made Zones/Routes render over Solids regardless of depth; tempting because flat ground-plane objects are hard to see during authoring. Correct: `depthTest: true` + `polygonOffset`. **Recurrence (2026-06-12, same feature family — not yet a 2nd unrelated context)**: the `polygonOffset` fix itself bit back (slope-scaled factor composited the Zone fill over the opaque Anchor disc at glancing angles). Each layering hack traded one hidden assumption for another; the durable form is explicit ordering in one render queue (`transparent:true, opacity:1` + renderOrder) plus geometry that does not straddle the decal plane. | Annotation View Materials Must Use depthTest: true; Ground Markers Must Not Straddle Z=0 |
| *(graduated to principle #28 — Mutual Means Round-Trip Up to a Normal Form; contexts: ADR-053 §1.1 + ADR-055)* | | |

---

## Index

| # | Principle | Chapter | Underlies |
|---|-----------|---------|-----------|
| 1 | One Authoritative Entry Point | Design | Mode Transition Flow, CommandStack, Solid Pose Mutation Must Use Public API |
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
| 21 | Coordinate Spaces Are Statically Distinguished | Contracts | CoordinateFrame.localOffset vs Geometry.corners |
| 22 | Children Before Parents in Hit-Testing | Interaction | CoordinateFrame Tap Selection, _hitAnyEntityForLink CF Priority |
| 23 | Accessors Own Their Freshness Guarantee | Contracts | `worldPoseOf()` self-healing |
| 24 | Derive Absolute State from Invariant Sources | Concurrency | Fastened Constraint Limitations (1a) |
| 25 | Guard Logic Belongs in Service Predicates, Not Inline Handler Returns | Design | Semantic Move Guardrail (checkMoveGuardrail) |
| 26 | A Screen Edge Is a Shared Resource | UI | Edge-Anchored Panels Must Coordinate Occupancy |
| 27 | Overlay Markers Are Sized in Screen Space, Capped in World Space | UI | CoordinateFrame Scale Cap, Annotation Marker Screen-Space Scale, Ground Grid Scale |
| 28 | Mutual Means Round-Trip Up to a Normal Form, Never a Literal Inverse | Contracts | LayoutDecompiler scene fixpoint (ADR-055); SynonymQuotient / ProvenanceNarrative (ADR-052); CanonicalForm WL normal form (ADR-056) |
| 29 | Rigor on the Wire, Play in the Client | Contracts | Grasp Contract Is Derived Never Defined; BffClient Contract-Error Envelope (ADR-054); Grasp score-first (ADR-057); contract governance (ADR-060); client-derived ghost (ADR-059); shared feedback primitives (ADR-062) |
