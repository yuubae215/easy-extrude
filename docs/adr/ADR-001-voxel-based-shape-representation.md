# ADR-001: Voxel-based Shape Representation

**Date:** 2026-03-20
**Status:** Superseded by ADR-007

---

> The initial approach adopted voxels (a set of unit cubes), but the design was changed to a cuboid-based model and superseded by ADR-007.
> The contents are preserved as a historical record.

---

## Context

The current implementation represents a single cuboid via 8 `THREE.Vector3` corners and 6 fixed quad faces. This is sufficient for a single box, but not for:

- Composite shapes (L-shape, T-shape, etc.)
- A "Sketch → Extrude" workflow where the 2D footprint can be non-rectangular
- Future extensibility (multi-object scenes, boolean operations)

Two approaches were considered:

1. **General polygon mesh** — arbitrary vertices and faces (like OBJ/GLTF)
2. **Voxel (grid-aligned box set)** — all shapes are collections of unit cubes on an integer grid

## Decision

Adopt **voxel-based representation**. All 3D shapes are a set of axis-aligned unit cubes at integer grid positions.

```javascript
VoxelShape = {
  voxels: Map<"ix,iy,iz", { ix: number, iy: number, iz: number }>
}
```

Mesh geometry is computed on demand by enumerating **exposed faces** — faces of voxels that have no adjacent voxel neighbour.

```javascript
// Pure function (Model layer)
function computeExposedFaces(voxels) → FaceDescriptor[]
function buildGeometryFromVoxels(voxels) → THREE.BufferGeometry
```

## Consequences

**Benefits:**
- Simple data model — a `Set` of integer triples
- Face Extrude = add/remove a layer of voxels (integer step, no floating-point drift)
- Sketch → Extrude maps naturally: painted 2D cells → extruded voxel columns
- No need for triangle decomposition, self-intersection checks, or winding-order repair

**Trade-offs:**
- Shapes are always axis-aligned (no angled faces)
- Smooth/organic forms are not possible
- Current `corners[8]` representation must be migrated to the new model

**Migration path:**
- A 1×1×1 Box primitive = one voxel (backward-compatible starting point)
- `buildGeometryFromVoxels` subsumes the current `buildGeometry(corners)`
