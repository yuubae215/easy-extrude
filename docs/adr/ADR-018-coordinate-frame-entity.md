# ADR-018: Coordinate Frame Entity — Object Origin Hierarchy

- **Status**: Accepted
- **Date**: 2026-03-23
- **References**: ADR-005, ADR-009, ADR-011, ADR-013, ADR-016

---

## Context

ADR-016 specified a *Transform Graph* (SE(3) tree) as the structural model for
spatial relationships between scene objects.  Until now the frontend only
represented the graph *conceptually* — `TransformNode` data was to be managed
server-side and received read-only.

The product requirement is to assign a named **coordinate frame** to any
geometry object's origin, parent-to-child, so that the **Outliner** reflects
the resulting family tree.  This is the first concrete step toward making the
ADR-016 transform hierarchy editable and visible in the UI.

Reference: Blender uses the same model.  An "Empty (Axes)" object attached to a
mesh's origin represents a local frame and appears indented under the mesh in
the Outliner.

---

## Decision

### 1. New domain entity: `CoordinateFrame`

Introduce `src/domain/CoordinateFrame.js` as a first-class scene entity.

```
SceneObject union (updated):
  Cuboid | Sketch | MeasureLine | ImportedMesh | CoordinateFrame
```

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Globally unique scene object ID |
| `name` | `string` | User-editable display name |
| `parentId` | `string` | ID of the parent geometry object (never null) |
| `meshView` | `CoordinateFrameView` | Three.js representation |
| `translation` | `THREE.Vector3` | Relative offset from parent origin (default 0) |
| `rotation` | `THREE.Quaternion` | Relative rotation (default identity) |

A `CoordinateFrame` **always** has a `parentId`.  Root-level (world-origin)
frames are not supported in Phase A.

### 2. Parent-child relationship stored on the entity

The `parentId` field on `CoordinateFrame` encodes the hierarchy.  `SceneModel`
exposes two queries built from this field:

```js
SceneModel.getChildren(parentId)  // returns CoordinateFrame[] for a given parent
SceneModel.getRoots()              // returns all objects with no parentId
```

Geometry objects (`Cuboid`, `Sketch`, etc.) do **not** gain a `parentId` field
in Phase A.  They implicitly live at the root level.

### 3. Outliner hierarchy display

`OutlinerView.addObject(id, name, type, parentId)` accepts an optional
`parentId`.  When provided:
- The child row is inserted directly after its parent's row in the DOM.
- Child rows are indented with a `└` connector glyph.
- The parent row's expand triangle turns orange to signal it has children.
- Removing a parent row cascade-removes all child rows.

Example Outliner rendering:

```
▶ ⬡ Cube            ← geometry object (root)
  └ ⊕ Frame.001     ← coordinate frame (child, parentId = Cube.id)
▶ ⬡ Cube.002
  └ ⊕ Frame.002
```

### 4. Capability matrix (Phase A)

| Operation | Allowed |
|-----------|---------|
| Select in Outliner | ✓ |
| Rename | ✓ |
| Delete | ✓ (parent deletion cascades) |
| Visibility toggle | ✓ |
| Edit Mode | ✗ (no vertex graph) |
| Grab / G key | ✓ — moves the `translation` offset relative to parent |
| Pointer drag | ✗ (no cuboid raycasting surface) |
| Ctrl+drag rotation | ✗ |
| Stack mode | ✗ |
| Snap target | ✗ (corners returns [_worldPos] for grab only, not snap) |

#### Position model

```
_worldPos  = parentCentroid + translation   (recomputed every frame)
translation = _worldPos − parentCentroid    (back-derived after each Grab)
```

When the frame is **not** being grabbed, the animation loop recomputes
`_worldPos = parentCentroid + translation` so the frame follows its parent
with the current offset.

When the frame **is** being grabbed, `move()` updates `_worldPos` directly;
the animation loop then back-derives `translation = _worldPos − parentCentroid`,
so the new offset is remembered for subsequent parent moves.

`corners` returns `[this._worldPos]` (mutable reference) so the standard Grab
machinery (startCorners save, cancel restore, drag-plane centroid) works without
modification.

### 5. Cascade deletion

`SceneService.deleteObject(id)` calls `SceneModel.getChildren(id)` before
removing the target object, disposing and emitting `objectRemoved` for each
child `CoordinateFrame` first.

### 6. Three.js representation

`CoordinateFrameView` renders:
- Three `THREE.ArrowHelper` instances (X=red, Y=green, Z=blue), 0.5 units long.
- A white `THREE.SphereGeometry` at the origin.
- A wireframe sphere selection indicator (orange, opacity 0 unless selected).

The view has no `cuboid` property (returns `null`) and therefore never appears
in any raycasting or snap-target computation.

All `MeshView` interface methods that do not apply are implemented as no-ops,
following the precedent set by `MeasureLineView` (MENTAL_MODEL §1).

### 7. Add-menu entry

`showAddMenu` gains an optional `onFrame` callback rendered as
**"Coordinate Frame"** in the Add menu.  The callback is only passed when a
suitable geometry parent is selected (i.e. `_objSelected` and active object is
not itself a `CoordinateFrame`).

---

## Consequences

### Benefits

- The Outliner now shows the first level of the ADR-016 transform hierarchy
  in a form the user can see and interact with.
- The `parentId` / `getChildren` contract is reusable when parent-child
  relationships between geometry objects are introduced in Phase B.
- `CoordinateFrame.translation` and `CoordinateFrame.rotation` are already
  present; Phase B can expose them for Node-Editor editing without a breaking
  API change.

### Constraints / Open questions

- Only one level of hierarchy in Phase A: geometry → frame.
  Frame → frame (nested frames) is blocked (`createCoordinateFrame` rejects a
  `CoordinateFrame` as parent).
- Frame position is parent-centroid only.  Offset from centroid is planned but
  not implemented (Phase B, Node Editor).
- DAG structure (one frame referenced by multiple parents) is deferred to
  Phase B per ADR-016.
