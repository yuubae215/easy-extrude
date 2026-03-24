# ADR-019: CoordinateFrame Phase B — Nested Hierarchy and Rotation Editing

- **Status**: Accepted
- **Date**: 2026-03-23
- **References**: ADR-005, ADR-008, ADR-016, ADR-018

---

## Context

ADR-018 implemented Phase A of the `CoordinateFrame` entity with two explicit
constraints that were deferred to Phase B:

1. **Single level only** — geometry → frame; frame → frame (nested) is blocked.
2. **No rotation editing** — the `rotation: Quaternion` field exists on the
   entity but no UI allows the user to change it.

The roadmap backlog item "CoordinateFrame relative-transform editing via Node
Editor (Phase B)" calls for:

- Nested frame hierarchy (frame → frame chains)
- Expose `translation`/`rotation` as editable parameters
- DAG support per ADR-016 (deferred to Phase C)

This ADR covers the Phase B design.

---

## Decision

### 1. Nested frame hierarchy (frame → frame)

Remove the guard in `SceneService.createCoordinateFrame` that rejects a
`CoordinateFrame` parent.  Any `SceneObject` that is **not** a `MeasureLine`
or `ImportedMesh` may be a parent.

```
world
  └── Cube                    ← geometry root
        └── Frame.001         ← child of Cube   (Phase A)
              └── Frame.002   ← child of Frame.001 (Phase B ← NEW)
```

**World position propagation** — frames at depth > 1 must compose transforms
through the full ancestor chain:

```
worldPos(frame) = worldPos(parent) + parent_worldRot.apply(frame.translation)
worldRot(frame) = worldRot(parent) * frame.rotation
```

`AppController`'s animation loop already recomputes `_worldPos` for each frame.
This loop is extended to use `getAncestorChain(frame)` so that frames deeper
than 1 level are also updated correctly.

**Cascade deletion** — `SceneModel.getChildren` is already recursive-compatible
(it only returns direct children).  `SceneService.deleteObject` is extended to
call itself recursively for each child, so the entire subtree is removed.

### 2. Rotation editing — R key

A new controller state `_rotate` is introduced, symmetric to `_grab`:

```js
this._rotate = {
  active:       false,
  axis:         null,      // null | 'x' | 'y' | 'z'
  startAngle:   0,         // radians at grab start (mouse angle around pivot)
  startRot:     new Quaternion(),  // saved rotation at start
  inputStr:     '',        // numeric input buffer
  hasInput:     false,
}
```

#### Key bindings

| Key | Action |
|-----|--------|
| `R` | Start rotate (Object mode, active object is `CoordinateFrame`) |
| `X` / `Y` / `Z` | Constrain axis during rotate |
| `0`–`9`, `.`, `-` | Numeric angle (degrees) input |
| `Enter` | Confirm |
| `Escape` / RMB | Cancel |

`R` is **only** active when the active object is a `CoordinateFrame`.  For
other object types, `R` is a no-op (no conflict with any existing binding).

#### Angle computation

While `_rotate.active` and no axis is locked, rotation is around the camera's
view-space Z axis (screen plane rotation), matching Blender behaviour.

When an axis is locked (`_rotate.axis = 'x'|'y'|'z'`), the rotation is around
the world axis of that name.

```
mouseDelta = currentAngle − startAngle    (signed radians)
if hasInput: angle = parseFloat(inputStr) * (π/180)
```

Applied delta quaternion:

```js
const axis  = axisVec  // THREE.Vector3  (e.g. (0,0,1) for Z)
const q     = new Quaternion().setFromAxisAngle(axis, angle)
frame.rotation.copy(startRot).premultiply(q)
frame.meshView.updateRotation(frame.rotation)
```

#### Capability matrix update

| Operation | Phase A | Phase B |
|-----------|---------|---------|
| Grab / G key | ✓ | ✓ (unchanged) |
| Rotate / R key | ✗ | ✓ (CoordinateFrame only) |
| Ctrl+drag rotation | ✗ | ✗ (still blocked — applies to geometry only) |
| Edit Mode | ✗ | ✗ |
| Pointer drag | ✗ | ✗ |

### 3. CoordinateFrameView — rotation support

New method `updateRotation(quaternion)` applies the quaternion to the root
`THREE.Group`:

```js
updateRotation(quaternion) {
  this._group.quaternion.copy(quaternion)
}
```

The arrows and origin sphere are children of `_group`, so they all rotate as a
rigid body.  The selection sphere stays spherical so it does not need special
treatment.

### 4. OutlinerView — multi-level indentation

`addObject(id, name, type, parentId)` currently only handles one level of
indent.  Phase B extends it to compute **depth** by walking the parent chain:

```js
_getDepth(parentId) {
  let depth = 0, id = parentId
  while (id) {
    depth++
    id = this._parentMap.get(id) ?? null
  }
  return depth
}
```

Each depth level adds `12px` of left-padding and a `└` connector glyph.
Depth 0 = root (no indent, no glyph).

The outliner stores `_parentMap: Map<childId, parentId>` so depth can be
computed without querying the scene model.

### 5. Status bar display during rotate

The status bar shows live feedback identical to the Grab pattern:

```
Rotate  AxisZ  45.00°          ← axis locked, numeric
Rotate  (free) 12.3°           ← no axis lock, mouse-driven
```

`_setInfoText` / `setStatusRich` are used exactly as in Grab.

### 6. Capability guard — Grab vs Rotate

`_startGrab` blocks for `CoordinateFrame` when `_rotate.active` is true (and
vice versa) to prevent simultaneous operations.

---

## Consequences

### Benefits

- Nested frame chains enable full ROS-style TF trees to be modeled in the UI.
- R key rotation is discoverable and consistent with Blender conventions.
- The `CoordinateFrame.rotation` quaternion is now user-editable, enabling
  future Node Editor exposure with no API changes.

### Constraints / Open Questions (Phase C)

- **DAG support** (one frame referenced by multiple geometry objects) —
  deferred per ADR-016.  Phase B keeps strict tree semantics.
- **Node Editor parameter binding** — `translation`/`rotation` are not yet
  wired to Node Editor numeric inputs.  Planned for Phase C alongside DAG.
- **Rotation of world-frame children** — when rotating a parent frame, child
  frames should follow.  Phase B recomputes child world positions through the
  ancestor chain, but does **not** recompute their rotations (world rotation
  propagation is a Phase C concern to keep scope manageable).
