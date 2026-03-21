# ADR-014: Edit Mode Sub-Element Selection (DDD Phase 6)

**Status:** Accepted
**Date:** 2026-03-20
**References:** ADR-004, ADR-012

---

## Context

DDD Phase 5-3 introduced `Vertex`, `Edge`, `Face` objects and `SceneModel.editSelection: Set<Vertex|Edge|Face>`,
but they were not yet wired to actual selection operations.

Also, Grab + Ctrl snapping was limited to the world origin only, making it impractical.

---

## Decisions

### 1. Sub-element mode switching — 1 / 2 / 3 keys

Assign the following keys in Edit Mode · 3D:

| Key | Mode |
|-----|------|
| `1` | Vertex mode |
| `2` | Edge mode |
| `3` | Face mode (default) |

Equivalent to Blender's Numpad 1/2/3. `V`/`E`/`F` are not used because `V` conflicts with
the V key (pivot select) during Grab.

### 2. Click-vs-drag separation (Face mode)

Changed from the previous behaviour of immediately starting a drag on mousedown in Face mode:

- `mousedown` → `_editDragPending = true` (hold state in pending)
- `mousemove` moving more than 5px AND hovered face exists → start face extrude drag
- `mouseup` while still pending → treat as a click, execute `_handleEditClick()`

In Vertex / Edge mode there is no drag; `mousedown` immediately fires `_handleEditClick()`.

### 3. Selection semantics

- Click → replace `editSelection` with 1 element
- Shift+Click → toggle in `editSelection` (add or remove)
- Click empty space → clear `editSelection`

### 4. Hover detection

| Mode | Detection method |
|------|-----------------|
| face | Raycasting (existing) |
| vertex | Project each `Vertex.position` to screen → nearest (15px threshold) |
| edge | Project each `Edge` midpoint to screen → nearest (15px threshold) |

### 5. Grab snap expansion

Replace `_trySnapToOrigin` with `_trySnapToGeometry`:

- Snap candidates: world origin + all Cuboid Vertices + all Edge midpoints
- Add `_grab.autoSnap: boolean`:
  - Set to `true` after confirming a G→V pivot
  - While `autoSnap = true`, snap fires automatically without Ctrl
  - `autoSnap` is maintained even when Ctrl is released (reset when Grab ends)
- Snap also fires on Ctrl press (extends existing behaviour)

---

## Rejected Alternatives

- **V/E/F keys**: `V` is already used for pivot select during Grab. A design that only activates it when Grab is not active is possible, but 1/2/3 was chosen for consistency.
- **Reset autoSnap when Ctrl is released**: Rejected because it would reintroduce the original problem of forgetting to hold Ctrl.

---

## Consequences

- `editSelection` is now wired to actual operations, completing the foundation for multi-face / multi-vertex selection
- Grab snap covers all geometry, making precise placement easy
- Face drag is separated from click via the pending pattern so click doesn't interrupt drag prematurely
