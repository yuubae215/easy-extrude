# ADR-040 — Solid Data Model Redesign: Primary Triple

**Status**: Accepted  
**Date**: 2026-05-14  
**Supersedes**: ADR-036 §"Known Limitation" (corner-baking approach)

---

## Context

ADR-036 predicted this redesign explicitly:

> "In a future phase, the Solid data model itself should be redesigned so that `orientation` is the primary state and world corners are derived."

The root problem: Solid had **two representations of rotation** that had to be kept in sync manually at every mutation site:

- `corners: WorldVector3[8]` — baked world positions (authoritative for geometry rendering)
- `bodyRotation: Quaternion` — separately tracked orientation (authoritative for CF parenting)

Every site that rotated a Solid (R-key, TC gizmo, fastened constraint solver) had to write BOTH. The constraint solver `_applyFastenedConstraint` computed a per-corner quaternion rotation with 12 lines of inline math AND called `bodyRotation.premultiply(dq)` — two writes per frame, with drift if either was missed or applied in the wrong order.

---

## Decision

Introduce a **primary triple** as the Single Source of Truth:

```
_position:    Vector3     // body-frame origin in world space (≈ initial centroid; fixed reference point)
orientation:  Quaternion  // authoritative cumulative rotation
localCorners: Vector3[8]  // corner positions in body frame (shape definition)
```

**Invariant**: `worldCorner[i] = _position + orientation.apply(localCorners[i])`

The derived state `vertices[i].position` (= world corners) is updated by `_rebuildWorldCorners()` after every mutation to the primary triple.

### Key API changes

| Old | New |
|-----|-----|
| `move(startCorners[], delta)` | `move(segStartPos, delta)` — updates `_position` from snapshot |
| `rotate(startCorners[], pivot, quat)` | `rotate(segStartOrientation, segStartPos, pivot, quat)` |
| `extrudeFace(face, worldFaceCorners[], worldNormal, dist)` | `extrudeFace(face, localFaceCorners[], localNormal, dist)` |
| *(new)* | `setWorldCorners(wc[])` — decomposes 8 world corners → `_position` + `localCorners` |
| *(new)* | `setPose(pos, orient, localCorners[])` — bulk setter for deserialisation |
| *(new)* | `_rebuildWorldCorners()` — zero-allocation sync from primary triple to vertices |

### Backward compatibility

- `get bodyRotation()` returns `this.orientation` — all in-place mutation callers (`premultiply`, `copy`, `set`) continue to work.
- `get corners()` returns `vertices.map(v => v.position)` — unchanged; callers that read world corners are unaffected.

### Why `_position` is not guaranteed to equal the current centroid

When `_position` is first set (via `_initFromWorldCorners`), it equals the centroid of the initial corners. After `extrudeFace`, the centroid of `localCorners` shifts, so the world centroid ≠ `_position`. This is intentional: `_position` is the **body-frame origin** (a fixed reference point for the body), not the instantaneous centroid. This matches CAD system conventions (cf. URDF `<origin>`).

---

## Consequences

### Constraint solver simplification

Old (per-corner inline quaternion math, ~12 lines):
```js
for (const corner of rootSolid.corners) {
  const rx = corner.x - pivotX, ...
  corner.x = rx + dqw * tx + ...  // quaternion sandwich manually expanded
}
rootSolid.meshView.updateGeometry(rootSolid.corners)
rootSolid.bodyRotation.premultiply(dq)
```

New (3 lines via primary triple):
```js
rootSolid.orientation.premultiply(dq)
rootSolid._position.sub(pivot).applyQuaternion(dq).add(newPos)
rootSolid._rebuildWorldCorners()
```

### Serialization (v1.3 format)

Old: `vertices[]` (8 world positions) + `bodyRotation`  
New: `position`, `orientation`, `localCorners[]` (8 body-frame offsets)

Migration path for old files (detected by absence of `localCorners`): the loaded world corners are decomposed by `_initFromWorldCorners` (centroid → `_position`, offsets → initial `localCorners` as world-space vectors). Then `bodyRotation` is applied to de-rotate `localCorners` into body frame via `localCorner[i].applyQuaternion(invQ)`.

### Face extrude

The face extrude call now operates entirely in body frame:
- `savedLocalFaceCorners`: the face vertex localCorners at drag start
- `localNormal`: world normal de-rotated by `orientation.invert()`

`_rebuildWorldCorners()` at the end of `extrudeFace` produces correct world positions for any orientation — no special handling needed for rotated solids.

---

## Rejected Alternatives

**Keep corner-baking, add helpers**: Would not eliminate the dual-sync problem; callers would still need to update both `corners` and `orientation`. The constraint solver would remain fragile.

**Fully lazy derived corners** (compute in `get corners()`): Would require every caller to not cache `corners` across mutation. Too risky given the large surface area.

---

## References

- ADR-036: introduced `bodyRotation` + corner-baking; documented this redesign as future work
- ADR-035: fastened-chain propagation (constraint solver now simplified)
- ADR-022: MoveCommand undo/redo — uses `setWorldCorners()` for backward-compatible restore
- PHILOSOPHY #3: Separate Pure Computation from Side Effects
- CODE_CONTRACTS §1: Entity Capability Contracts — updated
