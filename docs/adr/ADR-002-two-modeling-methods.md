# ADR-002: Two Modeling Methods (Primitive Box vs. Sketch → Extrude)

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — VoxelShape → CuboidShape)

---

## Context

Users need two ways to create 3D shapes:

1. Start directly from a 3D primitive (fastest, most versatile)
2. Define a 2D footprint (rectangle) first and extrude it in the height direction (plan-view / cross-section workflow)

Both methods ultimately arrive at the **same Edit Mode** (face push/pull).

## Decision

### Method A — Primitive Box

- `Shift+A` → "Add Box" → place a Cuboid at the default size (2×2×2)
- The new object is a cuboid represented by `corners[8]`
- Enters Edit Mode immediately after placement

### Method B — Sketch → Extrude

- `Shift+A` → "Add Sketch" → create an empty 2D Sketch object and enter Edit Mode · 2D
- **Sketch phase:** click and drag on the XY ground plane to draw a rectangle (two-corner specification)
- **Extrude phase:** Enter → drag mouse upward (or type a value) to specify height
- Result: a `corners[8]` Cuboid built from the rectangular footprint × height
- Continues directly in Edit Mode (3D)

### Shared Edit Phase

Both methods produce a `corners[8]` CuboidShape. Edit Mode operations are shared:
- Hover a face → highlight
- Drag face outward → extrude (move the 4 face corners in the normal direction)
- Drag face inward → push in

```
Method A:  Add Box ─────────────────────→ Edit Mode (3D)
Method B:  Add Sketch → Sketch Phase → Extrude Phase → Edit Mode (3D)
                                                         ↑ same code path
```

## Consequences

- Edit Mode uses the same face operations regardless of Sketch or Box (see ADR-004)
- Sketch objects hold only the rectangle definition (two corners); non-destructive re-editing via the ADR-005 hierarchy is planned for the future
- `buildCuboidFromRect(minXY, maxXY, height)` is implemented as a pure function in the Model layer
