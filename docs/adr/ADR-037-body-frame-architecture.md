# ADR-037 — Body Frame Architecture: CF-Primary Entity Model

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-05-07 |
| Supersedes | ADR-033 §3 (no auto-Origin at Solid creation) |
| Related | ADR-018, ADR-019, ADR-033, ADR-034, ADR-035, ADR-036 |

---

## Context

ADR-033 removed automatic "Origin" CoordinateFrame creation at Solid creation time,
based on the principle that CoordinateFrames should only be created with explicit user
intent (interface contract model).

However, ROS / URDF and most virtual-world frameworks define the **body frame (link
frame) as the primary entity**, with the visual geometry (mesh) attached to it:

```xml
<!-- ROS URDF pattern -->
<link name="base_link">
  <visual>
    <origin xyz="0 0 0"/>
    <geometry><mesh .../></geometry>
  </visual>
</link>
```

In this model the CoordinateFrame IS the object. The Solid is merely its visual
representation. Moving the body frame moves the whole object. Interface frames
(sensor mounts, attachment points) are children of the body frame, not of the mesh.

easy-extrude's current architecture has the inverse relationship:

```
Solid (root, world-space corners)
  └── CoordinateFrame (child, parent-local translation/rotation)
```

This ADR establishes the target architecture:

```
CoordinateFrame "Origin"   ← body frame (primary, created at Solid creation)
  ├── [Solid / visual]     ← geometry (Phase 2: will become explicit child with local coords)
  └── user CFs             ← interface frames, children of body frame
```

---

## Decision

### 1. Origin CF is created atomically with every Solid

`createSolid()`, `extrudeProfile()`, and `duplicateSolid()` each call
`createCoordinateFrame(solid.id, 'Origin', null)` immediately after the Solid is
added to the model.

`translation = (0,0,0)` and `rotation = identity` in parent-local space give:
```
worldPos  = Solid.centroid + Solid.bodyRotation × (0,0,0) = centroid
worldQuat = Solid.bodyRotation × identity                 = bodyRotation
```
The Origin CF therefore always sits at the Solid's centroid with the Solid's
current orientation.

### 2. User CFs are children of Origin CF, not of Solid

`_promptAddFrame()` and `_confirmFramePlacement()` look up the Origin CF of the
target Solid and use it as `effectiveParentId`. The resulting hierarchy matches
ROS TF tree semantics:

```
Solid
  └── Origin (body frame, locked)
      ├── camera_mount (user CF)
      └── gripper_base (user CF)
          └── gripper_tip (nested user CF)
```

### 3. TC proxy orientation follows Origin CF world quaternion

`_attachMobileTransform()` for a Solid looks up the Origin CF's world pose and
copies both **position** and **quaternion** to the TC proxy. After an R-key
rotation, the Solid's `bodyRotation` is non-identity; the TC arrows then align
with the rotated body frame axes rather than the world axes.

### 4. Origin CF is permanently protected

All editing operations are blocked on a CF with `name === 'Origin'`:

| Operation | Guard |
|-----------|-------|
| Grab | `_startGrab()` |
| N-panel translation | `onFramePositionChange` |
| N-panel rotation | `onFrameRotationChange` |
| Rename | `_renameObject()` |
| Delete | `_deleteObject()` |
| Reparent | `onReparent`, `onFrameParentChange`, `reparentFrame()` |

### 5. Undo/redo is handled by existing AddSolidCommand infrastructure

`createSolid()` creates the Origin CF before returning. The caller in
`_addObject()` then calls `_collectAllDescendantFrames(solid.id)`, which
naturally includes the Origin CF. `AddSolidCommand` already handles
`childrenRefs` for undo/redo of all descendant frames.

`ExtrudeSketchCommand.undo()` already contained dead code to delete the
auto-created Origin frame (written before ADR-033 removed it). With this ADR
that code becomes active again.

### 6. Legacy scene migration

Scenes saved before ADR-037 have Solids without an Origin CF. On load,
`loadScene()` and `importFromJson()` run a migration pass: for each Solid
in the restored model that has no direct child CF named 'Origin', an Origin
CF is created.

---

## Phase 2 (future)

The current implementation keeps `Solid.corners` in world space and
`CoordinateFrame.parentId = solid.id` (child-of-Solid in the data model).
The TC and grab operations on a Solid remain unchanged — they still update
corners directly — but the TC proxy now shows the correct body-frame axes.

A full inversion (Solid as explicit visual child with local-space corners,
Origin CF as the scene-graph root) requires migrating every `corners`
read to apply the CF world transform. This is deferred to a future ADR.

---

## Consequences

### Positive
- Every Solid always has a canonical body frame, matching ROS / URDF conventions.
- TC arrows align with the Solid's rotation after R-key; no stale world-axis gizmo.
- User CFs consistently live under Origin CF — clean TF tree structure.
- `ExtrudeSketchCommand` undo correctly removes the Origin CF without extra code.

### Negative / mitigations
- Scenes saved before this ADR need migration (handled in load path).
- Every scene will now have one more entity per Solid in the outliner (the locked
  "Origin" node). Its locked icon communicates that it is not directly editable.
- ADR-033's "no auto-Origin" rule is superseded only for the Solid creation case;
  the broader principle (CFs declared by explicit user intent) still applies to
  all user-created interface frames.
