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
常時 load の蒸留ダイジェストが `.claude/rules/10-principles.md` にある(**導出物** — 本ファイルが
正本)。原則の追加・改稿・退役時はダイジェストの該当行も同じコミットで更新する。
ダイジェストは canonical kernel bundle が他リポジトリへ運ぶレーンでもある(核 §4「結晶化した
原則」)。昇格順は **本ファイル → ダイジェスト → canonical** — 逆流させない。
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

**d) A pose writer measuring the pose it had just written** (fourth fix, ADR-101)
The stack assist opened by measuring the grabbed entity (`_bottomZOf` /
`_footprintSamplesOf`) *after* the same call had already moved it, so the assist's
input was its own output one frame earlier:

```
_applyStackAssist → _applyEntityDelta → _worldPoseCache (rAF) → _applyStackAssist
```

Unlike (a)–(c) this cycle does not drift, it **oscillates**: exactly one edge is
delayed (the cache is refreshed once per animation frame and no pose write
invalidates it), so the loop has period 2 — seated → "already resting, do nothing"
→ dropped → seated → … The user sees the entity in two places at once. Fixed by
giving the assist the same invariant inputs `_policyDelta` already used: the
segment-start snapshot and the delta the policy allowed.

**Freshness can differ by entity kind, which is what hid it.** The very same line
`this._bottomZOf(grabbed)` read `obj.corners` for a Solid — mutated synchronously
by the write path, therefore fresh — and `_worldPoseCache` for a frame-probed
entity (`robot_base`), therefore one frame stale. One code path, two behaviours,
no branch to notice. Reading the code cannot reveal this; only naming which
accessors answer for *rendered* state and forbidding writers from touching them
can.

**The general rule**: if a derived quantity feeds back into the computation that
produced it — even indirectly, even across two different methods — the cycle is a
defect. With a continuous quantity it accumulates error every frame (a–c); with a
discrete decision it oscillates between branches (d). Audit any path where a
per-frame output becomes a per-frame input, and treat a cache refreshed on a
schedule (rather than on write) as exactly such a path.

**The failure mode is asymmetric**: the code is valid JavaScript, throws no exception,
and produces a value that is a plausible scene position — invisible until the error
compounds enough to be visually obvious, which can take seconds or minutes. In the
oscillating form it is visible immediately but reads as a *rendering* glitch
("it flickers", "it looks duplicated"), which points attention at the view layer
rather than at the input of a predicate.

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

### 30. Motion Tier — 動きは事実・能力・歓びのいずれかを担う。役割なき欺瞞的な動きだけが不採用

Every animation in the client is classified *before* it is written (ADR-065
Widening 1; **Tier D delight added 2026-07-12 — ADR-066**) into one of three
admitted tiers, or the one rejected category:

| Tier | Speaks about | Governance |
|------|--------------|------------|
| **Tier F — fact-driven** | "your committed input worked / almost / failed" | ADR-062 unchanged: proof-layer fact → pure derivation → null degrade |
| **Tier A — affordance** | "you can act here / why you can't" | pure function of (interaction state × the SAME gate predicate that enables the control — #25/#14); stateless; never implies a judgment or a correct answer |
| **Tier D — delight** | nothing propositional — it marks an occasion or gives the surface life (a celebration, an ambient touch, a flourish that makes the moment feel good) | admitted when *chosen deliberately and budgeted* — the same transient owner (`MotionGovernor`) and the same reduced-motion boundary every tier pays; must NOT sit where the user reads fact/affordance feedback (no judgment forgery, below); occasional by design — its value is scarcity, so it is never sprinkled to fill every silence |
| **Forbidden — undisciplined / deceptive** | falsely implies a higher tier, or escapes the structural governance | a flourish dressed as a correctness signal (fake Tier F), or an unbounded/ungoverned effect with no owner and no reduced-motion path |

**The one-sentence routing test**: *"その動きが止まったとき、ユーザーが知れなく
なることは何か?"* — a concrete propositional answer ("whether my input worked",
"that I can grab here") routes the motion to Tier F or A and fixes its
governance. **"Nothing" no longer rejects the motion** — this is the 2026-07-12
revision that lifted the original restraint (the earlier wording, *"if the
answer is 'nothing', the motion is decoration and is rejected"*, over-corrected
by banning delight outright and was found to stifle 遊び心). A "nothing" answer
now means the motion is not *informational*, so it must justify itself as
**Tier D delight** — chosen on purpose, budgeted, reduced-motion-aware. What is
rejected is only motion that *lies* about its tier (a delight flourish worn as a
fact cue — judgment forgery) or that slips the structural governance. A
breathing handle says "grab me" (Tier A); a confetti burst on the user's first
completed model says nothing but marks a real occasion (Tier D, admitted); a
header swaying with no occasion, no budget, and no owner is neither informational
nor a deliberate moment (rejected).

**Volume corollary (2026-07-11 revision)**: the test applies *per firing*, not
per feature. A Tier F cue attached to a high-frequency operation whose result
is already fully visible at the anchor (a moved solid IS its own feedback)
answers the test with "nothing" on every firing — it is decoration wearing a
fact costume, and at per-operation frequency it reads as noise. Tier F motion
earns its production value in inverse proportion to how visible the fact
already is: an entity *vanishing* (nothing left to look at afterwards) merits
the loudest cue; an entity *appearing* a brief one; a pose change none. The
first application: the ADR-065 Phase 2 landing pulse fired identically on
every Move/Rotate/Add/undo — user-reported as "fireworks on every operation";
revised so only existence transitions render (voxel materialize/dissolve) and
routine pose ops are machine-pinned silent. The same scarcity logic governs
Tier D from the other side: delight earns its attention by being *rare*, so a
celebratory flourish on a routine, high-frequency action is the identical noise
wearing a party hat — admitted delight still spends the volume budget.

Two structural corollaries, both machine-pinned:

- **One reduced-motion boundary.** Every tier degrades under
  `prefers-reduced-motion` to a *static styled cue* — information preserved,
  movement dropped — never to nothing (#11). The preference is read at exactly
  ONE place (`src/theme/motion.js`), pinned by the grep test in
  `src/theme/motion.test.js`; DOM primitives re-export it and the 3D
  `MotionGovernor` injects it into every transient effect. The boundary may
  move; it must never fork (核 §1.1).
- **Transients have one owner.** Transient 3D effects live in the
  `MotionGovernor` (concurrency budget + oldest-evicted-with-dispose, #9);
  their fact source is a *committed* transition (e.g. a CommandStack landing),
  never an optimistic preview or an initial load. Clarified by the snap
  engagement flash (ADR-065 Phase 2 completion, 2026-07-12): what is forbidden
  is rendering a provisional *result* (an uncommitted pose) — an interaction
  *event* that already occurred inside a gesture (a snap lock applied to the
  domain preview) is a committed fact; a later cancel does not un-happen it.

**Why it matters**: without the tier decision, every new animation re-opens the
same drifts — **undisciplined delight** (delight sprinkled everywhere until it
costs attention and means nothing; the pre-2026-07-12 wording over-corrected
this by banning delight outright, which the tier now channels instead of
forbids), **judgment forgery** ("the glowing button must be the right answer" —
Tier F authority faked by a Tier A or D surface), and **reduced-motion
regressions** (each animation inventing its own matchMedia read). The tier table
turns those review debates into a lookup: delight is welcome, but it must
*declare itself as delight* and pay the same governance every tier pays — the
restraint moved from "no decoration" to "no undeclared, ungoverned, or deceptive
motion". Contexts already spanned: the DOM proof-feedback
primitives (ADR-062/064) and the 3D transient effects + core-modeling landing
pulses (ADR-065 Phase 1–2); the chrome refresh (Phase 3) consumes the same rule.

*Underlies CODE_CONTRACTS rules: MotionGovernor Is the Single Owner of Transient
3D Effects (ADR-065 Phase 1); Landing Effects Speak Only Entity Lifecycle
(ADR-065 Phase 2, volume revision); Reduced Motion Degrades the Play Layer to a
Static Cue (ADR-064 Phase 4)*

---

## I. Design Philosophy (cont.)

### 31. Zero Is a State That Does Not Look Like One — Iterate Over Required Kinds, Not Present Items

`mode` and `status` are recognised as states by every reviewer, every linter, and every AI:
they are a *field holding a value*, so something exists to inspect, name, and get wrong.
**Cardinality is a state too — and it has no such field.** "Zero of them" and "N of them"
are conditions of the *world*, not values in it. An absent thing carries no node, no key,
no row, so every check written by walking what is present passes over it in silence. The
empty case is therefore not merely unhandled; it is *invisible*, and invisibility reads as
correctness right up until the moment it produces a confident wrong answer.

Manifestations in this repo, in unrelated layers (the list grows; do not cite it by count):

- **Zero robots became one phantom robot (ADR-090, `core/…/engine/pipeline.py`).** When a
  scene declares no robot frames the front omits the `robot` key entirely, and the solver
  filled the gap with per-field defaults: base at the origin, `reach_min 0.0`,
  `reach_max inf`, wrist cone π. Every candidate then passes reach and wrist filtering, so
  the user is shown ranked grasps for a robot that does not exist and cannot execute any of
  them. Each default was reasonable *as an optional-parameter fallback*; the defect is that
  the same defaults also covered the case where the whole required declaration was absent,
  making "0 robots" indistinguishable from "1 robot, unconstrained". No exception, no empty
  result — a silent *plausible* answer, which is worse than a silent no-op (#11) because
  nothing prompts the user to doubt it.
- **Zero strategies became a finished branch (`gsn_tool.py`, 2026-07-25).** The GSN linter
  validated malformed content thoroughly — bad UUIDs, invalid states, unquoted summaries —
  by iterating over the nodes each entity *had*. A goal supported by nothing (0 strategy,
  0 solution, 0 sub-goal) has no node to iterate, so it produced no finding and rendered
  identically to a fully evidenced one. Thirteen such branches had accumulated across two
  argument trees, in files whose entire purpose is to make the state of an argument legible.
- **N annotations became one annotation, N times (ADR-093, `src/view/Annotated*View.js`).**
  Every Map annotation animation derived its phase from the raw loop clock, which is exactly
  correct for one entity: a Hub pings, a Zone breathes, and it looks alive. Place four Hubs
  on the map and all four ping on the same frame forever — a population moving in unison
  reads as a mechanism, and the visual quality the animation was written to deliver inverts.
  Nothing was unhandled; the cardinality simply never entered the model, and **the defect is
  invisible in every single-entity test, screenshot, and review.** Cardinality here is not
  even about zero: it is that "1" and "N" are different worlds, and only one of them was
  designed for. The fix has the same shape as the others — the phase is derived from the
  entity's own identity, so being one of N is represented rather than inferred.

- **Zero pose-write entry points became "the ones I happened to know about" (ADR-097,
  `src/service/SceneService.js` + three controllers).** The rule "an entity must not sink
  through the floor" was implemented per gesture path, so it existed on the free grab and
  not under an axis constraint, on `Solid` and not on anything else, on the drag-time
  re-seat and not on the per-frame `mounts` follow. Every path that had it looked correct;
  the defect lived entirely in the paths that had *nothing* — and a path with no clamp has
  no clamp to inspect, so reading the code that implements the rule can never reveal it.
  The census that replaced this found **two further entry points nobody had named**: the
  N-panel numeric Location field, and a fourth drag-plane implementation on touch re-grab.
  Neither was found by reading. The blast radius here is not the set of entity kinds — it
  is *the set of places that can write a pose*, and that set is only knowable by
  enumerating and counting it.

- **One entity's emphasis rule became N entities' glare (ADR-099, `src/controller/
  SelectionManager.js`).** Selection reveals what it selected, and the ADR named its own
  mitigation for crowding in advance — "use the DIMMED contextual level, keep FULL for the
  pick itself". The implementation applied it to the CoordinateFrame branch and not to the
  geometry branch, which kept claiming a selected Solid's descendant frames at FULL because
  that is what looked right for **one** selection. Rectangle-select fifty Solids and two
  hundred frames arrive at full intensity. Nothing was unhandled and no rule was missing
  from the file — there were *two* rules for the same relationship, and the difference
  between them is invisible at N=1, where `4N` and `N` are the same number. The fix makes
  one rule serve both branches, which turns the bound into something writable:
  `FULL(claim) === the selection, exactly`. Note what the ADR's prose could not do here: it
  *stated* the mitigation and still shipped half of it, because prose is not asked at the
  moment the second branch is written.


- **The palette declared 21 colours while the code drew 225 (ADR-100, `src/theme/`).** ADR-065
  had already pinned the token vocabulary to its documentation, both ways, so the *declared*
  set could not grow in silence. What no check ever asked was how many colours lived
  **outside** that set — and an undeclared colour has no token, no row, no key, so a test that
  iterates `COLOR` sees a clean vocabulary forever while the screen drifts. The governance in
  place was a sentence ("migrate any line you TOUCH"), which is asked only of lines somebody
  happens to touch; the untouched 400 were never going to move. The fix counts the complement:
  a ratchet over hex literals NOT in the vocabulary, with legitimately-excluded vocabularies
  named rather than inferred, failing when the number rises **and** when it falls without the
  declared baseline coming down with it. The same shape appeared one level in: "how many
  windows paint *selected*?" walked as windows gives six, enumerated as kinds gives nine — the
  rubber band, the floating label, and the React outliner do not look like selection painters
  from the outside, which is exactly why three of them had reached for their own hex.

The shared root: **a check that inspects present items can never see an absence.** The fix
in both cases has the same shape — enumerate the *required kinds* and test their count,
then make a legitimate zero a **declaration** rather than an inference. An absent required
input is rejected at the boundary (400 / an explicit `no-robot` state) instead of defaulted;
an unsupported goal must carry `support-unexplored` / `support-exploring` instead of merely
looking like every other goal. Defaults then apply only to fields that are genuinely
optional *within* a present declaration.

The corollary for state design: `docs/STATE_LEDGER.md` carries a **cardinality column**
precisely because the state-set column cannot express this. Filling in `0..1` / `0..N` /
`1` is the moment the question "what happens at zero?" is forced to be answered; ADR-090's
defect is exactly what that column being empty looks like. A zero you declared is a state;
a zero you left implicit is a blind spot with good posture.

*Asked at (Q3 — this principle has no CODE_CONTRACTS row on purpose; its carrier is a check,
not prose): the mandatory cardinality column in `docs/STATE_LEDGER.md` + the write-time nudge
`.claude/hooks/state-ledger-nudge.sh`; `gsn_tool.py lint` via CI `pnpm test:gsn` (unsupported
goals, `docs/STATE_TRANSITIONS.md` §GSN goal support); for the robot case, now three executable
checks rather than the ADR's prose — `src/domain/robotFrames.test.js` (zero resolves to the named
`none` state and selects nothing), `src/controller/GraspController.test.js` (a robot-less run
stops at `no-robot` with **zero** solver calls, so the absent declaration is never defaulted),
and `src/RobotRosterAuthority.test.js`, which counts the seed call sites — because the cheapest
"fix" for a missing robot is to re-seed it at every scene entry, which makes zero unrepresentable
again; for the pose-entry case, `src/PosePolicyOwnership.test.js`, which counts the pose writes
outside the one entry (and whose declared-exception table makes "an exception exists" different
from "an exception nobody counted"); for the selection case, `src/SelectionOwnership.test.js`
(the count of places that can write a selection) and `src/controller/SelectionManager.test.js`,
whose intensity tests are **fixtured at N=25 on purpose** — the bound `FULL(claim) === the
selection` and the defect `FULL === 4 × the selection` agree on every value a one-entity
fixture can produce*

**A second corollary, from ADR-096 and ADR-097 arriving at the same shape independently:**
when behaviour depends on an entity's *kind*, the per-kind table must **throw on an
undeclared kind** rather than fall through to a value. `EXPLICIT_DEFAULTS` (visibility) and
`PLACEMENT_BY_KIND` (placement) both do this, because in both cases the original defect was
a default nobody had chosen — a `true` seeded into an Outliner row, a floor that only some
entity kinds happened to get. A fall-through default makes "this kind was considered and
declared free" indistinguishable from "this kind was added and nobody thought about it",
which is the zero-shaped blind spot one level up: not a missing *item*, but a missing
*decision*. Adding an entity kind without deciding its behaviour should be a test failure.

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
| A render parameter calibrated for one camera / projection breaks silently under another | 2026-07-16 · `SceneStage.js` / `SceneView.js` · `FogExp2` density (0.024) was tuned for the perspective camera's short standoff. The 2D Map Mode ortho camera sits a fixed ~100 units above the z≈0 map plane, so at depth 100 the fog attenuates ~99.7% and rendered every fogged material — lit cubes AND unlit annotations — as near-black `0x15152a`; users "couldn't see where anything was placed". No exception, valid render; the value was simply wrong at a camera standoff the developer never exercised. Fixed by suspending the fog while the ortho camera is active (`SceneStage.setFogSuspended`, toggled from `SceneView.useOrthoCamera`). Kin to #27 (a size/marker value assuming a camera scale) but the parameter here is fog density, not a marker size — graduate to a widened #27 or a new principle if a 2nd unrelated context appears (e.g. a shader/LOD/near-far value tuned for one projection). | Fog Suspended While the Ortho Map Camera Is Active (ADR-072 addendum) |
| An overlay that disables the shared navigation controls owes their affordances on every input modality | 2026-07-16 · `MapModeController.js` · Map Mode swaps to an ortho camera and disables OrbitControls, but only re-provided zoom via the mouse wheel — so on touch devices (no wheel; OrbitControls' pinch disabled) there was NO way to zoom ("マップモードってズームできない"). The wheel path worked, hiding the gap on desktop; the failure was modality-specific and invisible unless you tested touch. Fixed by implementing two-finger pinch-zoom in the controller. Kin to #14 (disable controls only when input truly conflicts) but the inverse obligation: once you HAVE disabled the shared controls, you must re-offer every navigation affordance they provided (zoom, pan, orbit-equivalent) across mouse AND touch — a per-modality audit, not just "wire the one gesture the developer happens to use". Graduate if a second overlay (or a new gesture) re-opens the same modality-blind gap. | Map Mode Owns Two-Finger Pinch-Zoom |
| A completion callback must fire after the state it reports is finalized | 2026-07-16 · `CameraFlight.js` · `onDone` (via `_markDone`) fired BEFORE `_land()` wrote the terminal camera pose. A consumer reading `camera.position` in the callback (Map Mode's `_completeEnterSwap` capturing `_stagedPos`) therefore saw a mid-flight pose whenever the flight was interrupted (`finish()`) or reduced-motion; `_land()`'s subsequent jump left `_stagedPos ≠ camera.position`, so the exit external-write guard mis-fired and skipped the return flight — the camera never reset (user: "movable pose range differs after Map Mode"). The failure was asymmetric: a natural landing hid it (easeOutCubic shrinks the last-frame gap under the guard's tolerance), so only the interrupt/reduced paths broke. Fixed by reordering to `_land(); _markDone()` on every exit path and pinning the contract in the docstring. Candidate value: a "done"/completion signal must be emitted only after the state it advertises has been committed — an observer that reads state in the callback is reading a promise, not a fact, if it fires first. Graduate if a second unrelated callback-before-commit ordering bug appears. | CameraFlight Fires `onDone` AFTER the Terminal Camera Write |
| A layer excluded from static checks needs an explicit liveness guard<br>**2nd context (2026-07-26, ADR-098 実装中)**: 数値 Grab の `1`/`2`/`3` が `this._setSnapMode(...)` — `src/` のどこにも無いメソッド — を呼び、TypeError を投げたうえで**数値入力の分岐より先に `return`** していた。つまり 1・2・3 を含む Grab 距離はその桁が黙って消えていた (入力は消費され何も起きない)。1 例目と違い「そのメニュー項目が動かない」ではなく**別の機能 (数値入力) が部分的に壊れる**形で出たので、当該経路を通す E2E があっても気づけたとは限らない。走査したところ同型が **さらに 4 箇所** (Save / Load / STEP インポート / pivot 選択確定) 生きていた = 単発ではなく分布。**昇格の扱い**: 常時 load の原則行を増やすとプロンプト希釈と衝突するため (ADR-092 の先例と同じ判断)、原則化ではなく**問う場所を作る**方を選んだ — `src/DanglingSelfCallCensus.test.js` が呼び出しの形を列挙して定義の無い個数を数え、直せない 4 件は `DECLARED_GAPS` として宣言・計数する。3 例目 (この census で拾えない形 — 動的ディスパッチ経由など) が出たら原則化を再検討。 | 2026-07-11 · `AppController.js` · `_addObject('sketch')` called `this._addProfileObject()`, a method that did not exist — the Add-menu Sketch entry threw a TypeError inside the click handler and the user silently stayed in Object Mode (touch drag then orbits, misdiagnosed as an OrbitControls conflict). `tsconfig.json` scopes `checkJs` to `src/types/` + `src/domain/` (a documented Phase-2 tradeoff), so the controller layer has NO static guard for dangling calls; nothing else exercised the path. Fixed by implementing `_addProfileObject` + `createAddProfileCommand` and adding the sketch flow to the smoke E2E. The candidate value: whenever a static check is deliberately scoped down, the excluded layer must name its substitute guard (here: every Add-menu entry appears in the smoke). | Add Sketch Auto-Enters Edit Mode 2D; Controller Wiring Has No Static Guard; 存在しない自メソッドを呼ばない |
| *(graduated to principle #31 — Zero Is a State That Does Not Look Like One; contexts: ADR-090 phantom robot + `gsn_tool.py` unsupported goals, 2026-07-25)* | | |
| 統治レンズのトリガ判定は判定対象の**構造**で行う — 生の入力文字列への正規表現は、そのルールを説明する文章そのもので誤発火する | 2026-07-25 · `.claude/hooks/commit-trailers.sh` · `git commit` と `git push` の連鎖を助言する PreToolUse 判定を、コマンド文字列への正規表現で書いた。ところが Claude Code が hook に渡すコマンド文字列には **heredoc のコミットメッセージ本文が含まれる**。ADR-092 を導入するコミット自身が、メッセージ中で「塞げない穴: `git commit && git push` の連鎖」と*説明していた*ため、連鎖していないのに助言が発火した (自己言及的な誤発火)。修正は正規表現をやめ、heredoc 本体を落として引用を尊重するトークン化 → セグメント分割で判定する形へ (`detectsCommitPushChain`、`scripts/commit-meta.test.mjs` が固定)。同時に「改行はコマンド区切り」という shell の構造も落としていたことが露見し、別行の `git push` を見落としていた。候補となる価値: 入力を*構造として*読まずに文字列として読む判定は、その入力が**判定ルール自体に言及しうる**場では必ず破れる (ログ・コミットメッセージ・ドキュメント・プロンプト — いずれも自分を語る)。加えて誤発火する統治レンズは使われなくなるので、鬱陶しさは利便性ではなく正しさの問題 (核 §6 シグナル(b))。他の入力検査 (ログ走査・プロンプト分類・diff 検査) で 2 例目が出たら昇格。 | 統治 hook のトリガ判定は構造で行う |
| **原則 #24 の DOM 版 — 導出値が hit target の生成に戻ると、誤差ではなく「要素の同一性」が毎周期失われる** | 2026-07-26 実測 / 2026-07-29 修正 · `LinkNetworkView.js` · `mouseenter` が `_renderSVG()` を呼び、`_renderSVG()` が SVG の子を全部作り直していた。ポインタ下の `<g>` が破棄され同じ場所に新しい `<g>` が生まれると、ブラウザは hover 対象の変化として `mouseenter` を再び投げる → また再構築 → …。実測で hover 系 76 件・子要素の変異 114〜120 件 (実行ごとに揺れる = 有界でない)、`mousedown`/`mouseup`/`click` は **0 件**。`click` は押下と離上が共通の要素へ届いたときにしか合成されないので、閉路が回っているあいだパネルの選択ハンドラは**一度も呼ばれていなかった**。数値の閉路 (原則 #24) は毎周期に誤差を蓄積するが、DOM の閉路は毎周期に**同一性**を失い、症状は「値がずれる」ではなく**「入力が届かない」**という別の顔で出る — だから原因を出力側 (ハイライトが光らない) に探しているあいだは見つからない。修正は構造側: レイアウトが変わったときだけ要素を作り、hover/選択は属性の書き換えにした (`layoutSignature` が純粋側で同値を判定)。冪等ガードは併用するが閉路を断つ主体ではない。**昇格の扱い**: 根の価値は既に原則 #24 なので新原則ではなく #24 の適用域の話。DOM 以外の第 2 文脈 (キャンバスのヒット領域・フォーカス管理・仮想リストなど) が出たら #24 の本文へ「同一性を持つ資源の再生成」を明示的に含める改稿を行う。 | ADR-099 / `src/view/LinkNetworkLayout.js` (`layoutSignature`) |
| A vocabulary/taxonomy revision is closed by a repo-wide grep for the old vocabulary, not by declaration<br>**2nd context (2026-07-25, ADR-092)**: `CLAUDE.md` §Constitutional Rules を 4 項から 2 項へ畳んだ際、**序数**での引用が壊れた — ADR-020 の「Constitutional Rule 2」は削除された項を、ADR-048 の「Rule 3」は別の項を指すようになった。grep で 2 件を発見し、序数ではなく**名前**で引く形へ直した上で、リスト自体を番号なしにして参照点を消した (再発の構造的除去)。語彙の改名と規則の連番は同じ根: 共有参照の変更は宣言では閉じず、living docs への機械的な掃引でしか閉じない。**昇格の扱い**: 2 文脈に達したが常時 load の原則行を増やすと本 ADR の目的 (希釈低減) と衝突するため、原則化ではなく**壊れる参照点そのものを消す**方を選んだ。3 例目 (掃引で拾えない形) が出たら原則化を再検討。 | 2026-07-19 · `templates/README.md` ほか · The 2026-07-19 layer-boundary revision declared "別 repo 分割前提の文言の除去" done, but the retired taxonomy (レイヤ A/B/C, 2a/2b, 売り物/Booth/Gumroad, old grasp-search ADR numbering `ADR-005-bin-picking-...`) survived in `templates/README.md`, `core/README.md`, five `core/` docstrings, and `schema/README.md`'s citation of a CLAUDE.md heading that no longer exists — living documents contradicting the canonical layer map for a full session generation. Fixed by sweeping all non-historical files (ADR bodies and the frozen SESSION_LOG keep their era's wording on purpose). Candidate value: renaming a shared vocabulary is a §1.1 single-source change; its cleanup is only closed by evidence (a grep for every retired token over living docs), never by asserting completion. Graduate if a second rename leaves the same kind of residue. | — (process rule; no code contract row) |
| **証拠は「何を構造的に見逃すか」を宣言してはじめて証拠になる — 緑は *その形の証拠が見える範囲で* しか緑ではない** | 2026-07-26/27 · `e2e/smoke.spec.js` (ADR-098) → ADR-101 · ADR-098 の差分ペア 3 本は**数値 Grab** (`G` → 軸 → 距離 → Enter) で書かれていた。画面座標に依存しない形を選んだのは正しく、その選択自体が別の欠陥 (`_setSnapMode` の不在呼び出し) を露出させている。だが数値 Grab は**キー入力ごとに要求値が変わる**ため、1 フレーム古い幾何を読む欠陥があっても最終状態はいずれ正しい側へ落ちる — `_applyStackAssist` が自分の出力を測り直す閉路 (原則 #24) は**緑のまま出荷**され、翌日 ADR-101 として別途起票・修正することになった。振動は「**同じ要求を 2 回以上通す**」か「ポインタを連続で動かす」ときにしか現れない。候補となる価値: 証拠を選ぶ行為は同時に**見えない範囲を選ぶ**行為であり、「通った」だけを記録して見逃す族を記録しないと、次の欠陥はその族から出る (核 §2「再 Observe」の裏面)。**降ろし先**: 原則を増やすとプロンプト希釈と衝突するため (ADR-092 の先例) 原則化はせず、**問う場所**を `/whiteboard` §5 に足した (書く瞬間に問われる場所 — 憲法 Q3)。2 例目 (別機能で、証拠の形が特定の失敗族を構造的に隠した事例) が出たら昇格。 | — (process rule; `.claude/commands/whiteboard.md` §5 に降ろした) |
| **住所は動詞で決まる — 表示条件が同じであることは、同じ場所に居る理由ではない**<br/>**2 例に達したが、原則ではなく検査へ降ろした** | 2026-08-02/03 · `Header.jsx` (ADR-108 D4) · 1 例目 = `32 Assets` (ADR-063 Phase 4 が Context の文脈で作られたので `ContextLayer` のタブになった。実装された**時期**が住所を決めた — ADR-106 D3 で `+ 追加` へ移した)。2 例目 = `40 Node Editor` (`Save` / `Load` と**表示条件**が一致していた (「BFF 接続時のみ」) のでその隣に並んだ。`Header.jsx` のコメントが理由をそう書いていた)。どちらも住所が**タスクの近さではなく実装の事情**(時期 / 条件) で決まっており、根の価値は同じ — 住所は**その要素が担う動詞**で決まる。症状として現れ方が違うのが厄介で、Node Editor は「間違った場所に在る」のではなく**「正しく見える場所に在る」**: 3 つ並んだ入口が同じ条件で一斉に現れたり消えたりするので、見た目には一貫したクラスタだった。**昇格の扱い**: 2 文脈に達したが、常時 load の原則行を増やすとプロンプト希釈と衝突するため (ADR-092 / ADR-098 と同じ判断)、原則化せず**問う場所**を作った — `src/HeaderEntranceCensus.test.js` は入口が動詞を宣言しないと母集団に残れない形にしてあり、表示条件は宣言欄に存在しない (`requires` は可用性であって分類ではない)。3 例目 (この検査で拾えない形 — ヘッダの外で条件が住所を決めた事例など) が出たら原則化を再検討。 | 表示条件は住所の根拠ではない (ADR-108 D4) |
| **ポインタ位置に開くポップオーバーは、開いた位置に出るだけでは足りない — 視野に収める責任は自分が持つ** | 2026-08-02 · `AddMenu.jsx` (ADR-106 D3) · 場から出ていった Assets を `+ 追加` へ移し、メニューに 5 項目の群が増えた。ところが `AddMenu` はポインタ座標にそのまま `position:fixed` で出るだけで、視野内への収まりを一切持っていなかったため、ポインタが画面下半分にあると**末尾の群が視野外へ落ちた** — 項目は DOM に在り、`toBeVisible()` も通り、しかしクリックできない (`element is outside of the viewport`)。「在ること」と「届くこと」の差であり、原則 #16 (発見可能性は成果物) は前者では満たされない。注目すべきは**規則が既にコードに在った**こと: `ContextMenu` と `LinkTypePicker` は 3 年前から `Math.min(x, W - …)` で clamp していて、3 つのうち 1 つだけが持っていなかった。規則がどこにも *規則として*書かれていないと、持っていない箇所は**在るものを辿る読み方では出てこない** (原則 #31 の同型 — clamp を*している*コードをいくら読んでも、していない 1 箇所は見つからない)。修正は余地のある端への アンカー + スクロール。**捕まえたのは e2e** で、静的には見えない (z-index とレイアウトの相互作用)。2 例目 (別のポップオーバー、あるいは同型の「容量を問わない移設」) が出たら昇格。 | Edge-Anchored Panels Must Coordinate Occupancy (ui_layout.md — ポインタ追従ポップオーバーの節) |

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
| 30 | Motion Tier — 動きは事実・能力・歓びを担う (delight tier 2026-07-12) | Design | MotionGovernor single owner (ADR-065 Phase 1); CommandStack landing effects (ADR-065 Phase 2); reduced-motion static cue (ADR-064 Phase 4) |
| 31 | Zero Is a State That Does Not Look Like One (2026-07-25) | Design | State Ledger cardinality column (核 §1.4); GSN support cardinality (`pnpm test:gsn`); absent required declaration rejected not defaulted (ADR-090); animation phase derived from entity identity so 1-of-N is represented, not inferred (ADR-093, `MapVisualMath.test.js`); **count what is NOT declared** — undeclared colour literals ratcheted, selection painters enumerated by kind (ADR-100, `src/theme/tokens.test.js`) |
