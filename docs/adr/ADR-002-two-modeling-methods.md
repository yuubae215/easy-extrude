# ADR-002: Two Modeling Methods (Primitive Box vs. Sketch → Extrude)

**Date:** 2026-03-20
**Status:** Accepted

---

## Context

Users need two distinct ways to create 3D shapes, reflecting common modeling workflows:

1. Start directly from a 3D primitive (fast, common case)
2. Define a 2D footprint first, then extrude into 3D (useful for floor plans, cross-sections)

After extrusion, both paths should arrive at the **same Edit Mode** with the same face-push/pull controls.

## Decision

### Method A — Primitive Box

- `Shift+A` → "Add Box" → prompts for W × H × D (in grid units)
- Places a box of that size as a `VoxelShape`
- Immediately enters Edit Mode on the new object

### Method B — Sketch → Extrude

- `Shift+A` → "Add Sketch" → enters Edit Mode on a new, empty 2D Sketch object
- **Sketch phase:** left-click/drag to paint grid cells on the XY ground plane
- **Extrude phase:** press Enter → drag vertically (or type a number) to set height in grid units
- Result: a `VoxelShape` (columns of voxels under each painted cell)
- Immediately continues in Edit Mode (3D) on the extruded shape

### Shared Edit Phase

Both methods produce a `VoxelShape`. Edit Mode operates identically:
- Hover over an exposed face → highlight
- Drag face outward → add a voxel layer
- Drag face inward → remove a voxel layer

```
Method A:  Add Box ─────────────────────→ Edit Mode (3D)
Method B:  Add Sketch → Sketch Phase → Extrude Phase → Edit Mode (3D)
                                                         ↑ same code path
```

## Consequences

- No separate "Sketch Mode" in the mode system; Edit Mode adapts to object type (see ADR-004)
- The 2D Sketch object type is preserved after extrusion (non-destructive), allowing later re-edit of the footprint
- `extrudeProfile(cells2D, height)` is a pure Model function that produces a `VoxelShape`
