# ADR-004: Edit Mode Adapts to Object Type

**Date:** 2026-03-20
**Status:** Accepted

---

## Context

The application needs to support editing objects of different dimensionalities (1D, 2D, 3D). A naive approach would introduce separate named modes for each type ("Sketch Mode", "Draw Mode", etc.), increasing the number of modes users must learn.

## Decision

Keep exactly **two top-level modes**: Object Mode and Edit Mode.

Edit Mode's behaviour automatically adapts based on the **type of the selected object**:

| Selected Object Type | Edit Mode Behaviour |
|---------------------|---------------------|
| **3D** (VoxelShape / Box) | Face hover + push/pull (current extrude behaviour) |
| **2D** (Sketch) | Grid cell paint/erase on XY plane |
| **1D** (MeasureLine, future) | Endpoint drag |

```
Object Mode  ──Tab──→  Edit Mode
                           ├── if 3D selected: face extrude
                           ├── if 2D selected: cell paint
                           └── if 1D selected: endpoint drag
```

The mode indicator in the header bar shows the compound state:
- `Edit Mode · 3D`
- `Edit Mode · 2D`
- `Edit Mode · 1D`

### Extrude transition (2D → 3D)

When a 2D Sketch object is in Edit Mode and the user presses Enter to confirm the sketch:
1. The sketch enters Extrude phase (height input) — still within Edit Mode
2. On extrude confirm, a new 3D VoxelShape object is created as a child of the sketch
3. Edit Mode seamlessly continues on the new 3D object
4. Status bar shows: `"Extruded → Edit Mode · 3D"`

## Consequences

- Users learn one shortcut (`Tab`) for all object types
- AppController requires a dispatch on object type at the Edit Mode entry point
- UIView status display needs to reflect the compound mode string
- No "Sketch Mode" key binding needed; reduces cognitive load
