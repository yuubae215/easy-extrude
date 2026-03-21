# ADR-004: Edit Mode Adapts to Object Type

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — VoxelShape → CuboidShape)

---

## Context

Having separate mode names (e.g. "Sketch Mode") for editing objects of different dimensions (1D, 2D, 3D) increases the learning curve.

## Decision

Keep only **two top-level modes: Object Mode and Edit Mode**.

Edit Mode behaviour changes automatically based on the selected object's type (`dimension`):

| Selected object type | Edit Mode behaviour |
|----------------------|---------------------|
| **3D** (CuboidShape) | Face hover + push/pull |
| **2D** (Sketch / rectangle) | Draw a rectangle on the XY plane (two-corner specification) |
| **1D** (MeasureLine, future) | Endpoint drag |

```
Object Mode  ──Tab──→  Edit Mode
                           ├── if 3D selected: face push/pull
                           ├── if 2D selected: rect sketch
                           └── if 1D selected: endpoint drag
```

The header bar mode display includes the subtype:
- `Edit Mode · 3D`
- `Edit Mode · 2D`
- `Edit Mode · 1D`

### Extrude transition (2D → 3D)

When a 2D Sketch object is in Edit Mode and the user presses Enter:
1. Transition to the Extrude phase (height input) — inside Edit Mode
2. On confirmation, a `corners[8]` CuboidShape is created
3. Continues directly in Edit Mode · 3D
4. Status bar: `"Extruded → Edit Mode · 3D"`

## Consequences

- Users need to remember only one shortcut: `Tab`
- AppController must dispatch on object type at the Edit Mode entry point
- UIView status display handles the compound string `Edit Mode · 2D / 3D`
