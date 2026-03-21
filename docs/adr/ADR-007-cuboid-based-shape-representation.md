# ADR-007: Cuboid-based Shape Representation

**Date:** 2026-03-20
**Status:** Accepted
**Supersedes:** ADR-001

---

## Context

ADR-001 adopted voxels (a set of unit cubes). However, the actual user workflow is
**"place a cuboid and deform it by pushing/pulling faces"**, and the fine granularity
of a unit-cube grid was unnecessary.

Differences between the voxel and cuboid models:

| | Voxel | Cuboid |
|--|-------|--------|
| Shape representation | Set of unit cubes (`Map<key, {ix,iy,iz}>`) | 8 corner vertices (`THREE.Vector3[8]`) |
| Face extrude | Add/remove a layer of unit-grid cubes | Move the 4 face vertices in the normal direction |
| Deformation granularity | Integer steps (1 unit) | Continuous values (floating point) |
| Shape variety | L-shape, T-shape, arbitrary stacking | Single deformable hexahedron |

## Decision

Adopt **cuboid-based representation**. 3D objects are represented as deformable cuboids with 8 corner vertices.

```javascript
CuboidShape = {
  corners: THREE.Vector3[8]  // ROS world frame (+X forward, +Y left, +Z up)
}
```

Corner labels and layout:

```
      6─────7
     /|    /|    +Z up
    5─────4 |    +Y left
    | 2───|─3    +X front
    |/    |/
    1─────0
```

Face definitions (each face: 4 corner indices, outward-facing CCW):

```javascript
FACES = [
  { name: 'Front (+X)', corners: [1, 2, 6, 5] },
  { name: 'Back (-X)',  corners: [0, 4, 7, 3] },
  { name: 'Top (+Z)',   corners: [4, 5, 6, 7] },
  { name: 'Bottom (-Z)', corners: [1, 0, 3, 2] },
  { name: 'Left (+Y)',  corners: [2, 3, 7, 6] },
  { name: 'Right (-Y)', corners: [1, 5, 4, 0] },
]
```

### Face Extrude

Extruding face `fi` = move its 4 corners by `delta` in the normal direction:

```javascript
// Model pure function
function extrudeFace(corners, fi, delta) → THREE.Vector3[8]
```

### Initial Shape

New objects are created as a 2×2×2 unit cuboid centred at the origin via `createInitialCorners()`.

## Consequences

**Benefits:**
- One object = one cuboid. Simple data structure.
- Face extrude achieved by vertex movement alone (no integer snapping needed)
- Smooth deformation with floating-point precision
- Small code footprint (contained in the pure functions of `CuboidModel.js`)

**Trade-offs:**
- Composite shapes (L-shape, T-shape, etc.) are represented by **placing multiple Cuboid objects**
  (a single Cuboid deformation cannot produce non-convex shapes)
- Sketch → Extrude always produces a cuboid (rectangular footprint × height)

## References

- ADR-001 (Superseded)
- ADR-002 (Two modeling methods — Method B also produces a cuboid)
- ADR-005 (Object hierarchy — defines `CuboidShape`)
