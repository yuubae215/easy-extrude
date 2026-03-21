# ADR-005: Object Hierarchy with Dimensional Classification

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — VoxelShape → CuboidShape)

---

## Context

The app is evolving from single-object editing to multi-object scene editing.
Objects have a dimensionality and need to be organised into a hierarchy (groups, parent-child).

## Decision

### Object Type Classification

All scene objects have a `dimension` property:

| Dimension | Example types | Data | Edit Mode behaviour |
|-----------|--------------|------|---------------------|
| `1D` | MeasureLine | 2 endpoints | Endpoint drag |
| `2D` | Sketch | `{ min: Vector2, max: Vector2 }` (2-corner rectangle) | Rectangle drawing |
| `3D` | Box, ExtrudedShape | `corners: THREE.Vector3[8]` | Face push/pull |

### Object Data Structure

```javascript
SceneObject = {
  id:        string,           // e.g. "obj_0_1742394000000"
  name:      string,           // e.g. "Wall_A"
  dimension: 1 | 2 | 3,
  shape:     CuboidShape | SketchRect | LineShape,
  visible:   boolean,
  locked:    boolean,
  children:  SceneObject[],    // group / parent-child
}

// 3D shape
CuboidShape = {
  corners: THREE.Vector3[8],   // CCW winding, ROS world frame
}

// 2D shape (Sketch footprint)
SketchRect = {
  min: THREE.Vector2,
  max: THREE.Vector2,
}
```

### Hierarchy

- Objects can be grouped (empty parent + children)
- Making a 2D Sketch and its extruded 3D child a parent-child pair enables non-destructive history (future)
- The Outliner panel displays the tree

### Outliner Display Example

```
Scene
├── [GRP] Building_A
│   ├── [3D] Wall
│   ├── [3D] Column
│   └── [2D] Footprint
├── [3D] Floor
└── [1D] Width_ref      <- future
```

Icons distinguish dimensions: cube (3D), square (2D), line (1D).

## Consequences

- The `dimension` field drives Edit Mode dispatch (ADR-004)
- The Outliner's current flat implementation can be extended to a hierarchy via `parentId` references
- 1D objects are backlogged — the architecture supports them but the implementation is TBD
