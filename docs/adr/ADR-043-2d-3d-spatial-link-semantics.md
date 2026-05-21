# ADR-043 — 2D/3D Spatial Link Semantics: `bounded_by` and Clearance Evaluation

**Status:** Draft
**Date:** 2026-05-21
**Supersedes:** —
**Related:** ADR-029, ADR-030, ADR-038, PHILOSOPHY #2, #5, #21

---

## Context

ADR-029 established the Lynch urban-annotation taxonomy (`AnnotatedLine`, `AnnotatedRegion`,
`AnnotatedPoint`) for 2D spatial metadata living in the XY ground plane. ADR-030 introduced
`SpatialLink` as a typed relationship edge between scene entities. ADR-038 added a two-layer
taxonomy (`jointType` + `semanticType`) to separate kinematic and semantic concerns.

Until now, `SpatialLink` was only validated for CF-to-CF fixed joints and annotation mounts.
The existing semantic types (`fastened`, `contains`, `adjacent`, etc.) were annotation-only —
the constraint solver never checked them at runtime.

A new class of design intent has emerged: **2D boundary objects constraining 3D solid objects**.
Examples:

- Safety fence (`AnnotatedLine / Boundary`) must not be penetrated or approached within N mm by
  a robot workspace (`Solid`).
- Process zone (`AnnotatedRegion / Zone`) must spatially contain all equipment assigned to it.
- AGV route (`AnnotatedLine / Route`) must remain at least 800 mm from moving machinery.

These constraints require **per-frame geometric evaluation** in world space, visual feedback
(alert color), and user-visible error messages. They are neither purely topological annotations
nor kinematic constraints in the URDF sense.

---

## Decision

### 1. New semantic type: `bounded_by`

Add `'bounded_by'` to `SEMANTIC_TYPES` in `SpatialLink.js`.

**Meaning:** The target entity (3D Solid) is spatially constrained by the source boundary
entity (AnnotatedLine or AnnotatedRegion). The target must remain outside, or at least a
specified clearance distance away from, the source boundary.

**jointType:** Always `null`. Clearance is evaluated per-frame in JS, not by the Wasm
fixed-joint solver. No kinematic DOF is implied.

**Classification:** Added to `TOPOLOGICAL_SEMANTIC_TYPES` — it describes a spatial
relationship, not a coordinate-space binding.

### 2. `properties` field on SpatialLink

`SpatialLink` gains an optional `properties` map (plain object, serialized as JSON).

```js
new SpatialLink(id, sourceId, targetId, jointType, semanticType, properties = {})
```

The `properties` field is open-ended for future link types. For `bounded_by`, the relevant key is:

- `clearance` (number, world units = mm): minimum required distance from boundary to target.
  `0` means any intersection is a violation. Defaults to `0` when missing.

Runtime-only fields (`violated`, `errorMessage`, `properties.currentClearance`) are written by
`SceneService._evaluateClearanceLinks()` each frame. They are never serialized.

### 3. Pure-JS clearance evaluator in SceneService

`_evaluateClearanceLinks()` runs at the end of each `_updateSpatialLinkViews()` call.

Algorithm (2D XY projection):
1. Enumerate all `bounded_by` links.
2. For each link, fetch source corners (AnnotatedLine vertices or AnnotatedRegion boundary)
   and target corners (Solid world corners).
3. Compute minimum distance from each solid corner to each polyline segment in the XY plane.
4. If `minDist < link.properties.clearance` → `link.violated = true`.
5. Call `view.setViolated(link.violated)` on the SpatialLinkView.

**Why XY projection?** The app uses ROS world frame (+Z up). Boundary objects live in the XY
ground plane (Z = 0). Safety clearance for factory layout is fundamentally a 2D concern:
a fence that is 500 mm away in plan view is safe regardless of the solid's height.

**Why pure JS, not Wasm?** The computation is O(M × N) where M = polyline segments and
N = solid corners (typically M ≤ 20, N = 8). At 60 fps this is ≈ 9,600 float operations per
link — well within main-thread budget. Wasm would add compile complexity for negligible gain.
If scenes grow to hundreds of links, migrate to Wasm with the same interface.

### 4. Alert visual state in SpatialLinkView

`SpatialLinkView.setViolated(violated)` sets `_violated` flag.

When `_violated = true`, `update()` overrides the tension-color path:
- Pulsing interpolation between alert-red (`0xEF4444`) and bright red (`0xFF9999`).
- Dash size reduced (0.15 / 0.08) — tighter dash pattern signals urgency.
- Opacity oscillates 0.8–1.0 for attention.

This is consistent with PHILOSOPHY #4 (one owner per visual flag): `setViolated()` is the
sole writer of the violated visual state; `update()` reads it each frame.

### 5. UI: clearance picker in `_computeLinkOptions`

When source is `AnnotatedLine` or `AnnotatedRegion` AND target is `Solid`, the link type picker
offers three preset clearances: `bounded_by (500mm)`, `bounded_by (1000mm)`, `bounded_by (no gap)`.

The `properties` map is embedded in the option object and threaded through
`_createSpatialLinkDirect → createSpatialLink`.

Custom clearance input (text field in picker) is deferred to a future phase.

---

## Consequences

**Positive:**
- Factory layout designers get real-time visual feedback when 3D equipment violates 2D safety boundaries.
- `bounded_by` is purely additive: no existing semanticType, jointType, or solver logic is changed.
- The `properties` field enables future link metadata without schema churn.
- Serialization is backward-compatible: old scenes without `properties` load with `properties = {}`.

**Negative / Trade-offs:**
- Per-frame O(M × N) clearance evaluation adds a small CPU cost proportional to the number of `bounded_by` links. Acceptable up to ~50 links; beyond that, consider spatial indexing or Wasm.
- The 2D XY projection is correct for ground-plane factories but misleading for vertical safety analysis (e.g., cranes, multi-story). 3D clearance mode deferred.
- Only `AnnotatedLine` source is wired in Phase 1. `AnnotatedRegion` containment (point-in-polygon) requires a separate algorithm deferred to Phase 2.

---

## Deferred (Phase 2+)

- **Zone containment** (`AnnotatedRegion → Solid`): solid must remain inside the Zone polygon. Requires point-in-polygon test for each solid corner.
- **Hub interface timing** (`AnnotatedPoint → trajectory`): takt-time estimation linking logistics path travel time to Hub demand timing.
- **Anchor tolerance tree** (`AnnotatedPoint → CF chain`): constraint tree validation from calibration fixture to CF ancestry.
- **Custom clearance input** in the link type picker (text field for arbitrary mm value).
- **Wasm migration** of `_evaluateClearanceLinks` when scene complexity warrants it.
- **3D clearance mode**: full distance in world space (not just XY), for non-ground-plane boundaries.
