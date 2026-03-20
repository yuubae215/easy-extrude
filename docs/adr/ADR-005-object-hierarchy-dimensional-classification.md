# ADR-005: Object Hierarchy with Dimensional Classification

**Date:** 2026-03-20
**Status:** Accepted

---

## Context

The application is evolving from a single-object editor to a multi-object scene editor. Objects have different dimensionalities and should be organizable into a hierarchy (groups, parent-child relationships).

## Decision

### Object Type Classification

All scene objects carry a `dimension` property:

| Dimension | Type Examples | Data | Edit Behaviour |
|-----------|--------------|------|----------------|
| `1D` | MeasureLine, reference line | two endpoints | drag endpoints |
| `2D` | Sketch (grid cells) | `Set<"ix,iy">` | paint/erase cells |
| `3D` | Box, ExtrudedShape | `VoxelShape` | face push/pull |

### Object Data Structure

```javascript
SceneObject = {
  id: string,           // unique, e.g. "obj_0_1742394000000"
  name: string,         // user-visible, e.g. "Wall_A"
  dimension: 1 | 2 | 3,
  shape: VoxelShape | SketchShape | LineShape,
  transform: {          // world-space position/rotation (grid-snapped)
    position: THREE.Vector3,
    rotationZ: number,  // ROS frame: rotation around +Z (world up)
  },
  children: SceneObject[],  // for groups / parent-child
  visible: boolean,
  locked: boolean,
}
```

### Hierarchy

- Objects can be grouped (empty parent with children)
- 2D Sketch and its extruded 3D child can be parent-child (non-destructive history)
- The Outliner panel displays the tree; expand/collapse per group

### Outliner Display Example

```
Scene
├── [GRP] Building_A
│   ├── [3D] Wall
│   ├── [3D] Column
│   └── [2D] Footprint  ← parent of Column (non-destructive)
├── [3D] Floor
└── [1D] Width_ref      ← future
```

Icons in the Outliner distinguish dimension: cube (3D), square (2D), line (1D).

## Consequences

- `_objects: Map<id, SceneObject>` in AppController becomes a tree (or stays flat with `parentId` references for simplicity)
- Outliner panel (`OutlinerView`) needs tree rendering and expand/collapse
- `dimension` field drives Edit Mode dispatch (ADR-004)
- 1D objects are a **future backlog item** — the architecture supports them but no implementation is planned now
