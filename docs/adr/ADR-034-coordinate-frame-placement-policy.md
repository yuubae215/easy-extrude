# ADR-034 — CoordinateFrame Placement, Pose, and Provenance Policy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-04-19 |
| **References** | ADR-033, ADR-032, ADR-030, ADR-018, ADR-019, PHILOSOPHY #21 |

---

## Context

ADR-033 defines *when* to create a CoordinateFrame (only with explicit user intent
or as a SpatialLink endpoint).  It leaves three questions open:

1. **Where** can a frame be placed within or on a parent entity, and how does the UX support that?
2. **How** should the frame's orientation (pose) be initialised and changed?
3. **Who** may change a frame that another stakeholder declared, and how is that enforced?

These questions are non-trivial because:

- A naive UX might auto-align the frame to the nearest face normal, but that
  decision should belong to the integrator, not the tool.
- The "designer" of a CoordinateFrame is often not the geometry modeller.
  Understanding who decides frame placement is essential to designing the right UX.
- Allowing anyone to silently change a declared frame violates the spatial contract.
  Changes must be explicit and role-aware.

### The stakeholder model

CoordinateFrame is a **spatial interface contract**.  It does not describe
the shape of an object — it declares a named point (or surface) at which
that object is prepared to relate to another.

Three stakeholder roles exist:

| Role | Description | Example |
|------|-------------|---------|
| **外形モデラー** (Geometry modeller) | Defines the shape and dimensions of the object | CAD drafter creating a bracket |
| **インテグレーター** (Integrator / Assembly engineer) | Defines how objects connect to each other | Mechanical engineer laying out an assembly |
| **インテグレーター予約** (Pre-declared by modeller) | Modeller anticipates future integration and declares frames in advance | Bracket designer adds "MountingFace" frame before assembly context exists |

Key insight: **the integrator determines the semantics of a CoordinateFrame**.
The geometry modeller may pre-declare frames as a courtesy or convention, but
the frame's meaning — and therefore its final placement and name — is resolved
by the integration context.

This means:

- Frame placement is **not** determined by geometry alone.
- Automatic alignment to face normals would impose the geometry modeller's
  perspective on what is ultimately the integrator's decision.
- The system must support arbitrary placement (face, interior, edge, vertex)
  because valid integration points span the full 3D interior of an object,
  not just its visible surfaces.
- A frame declared by one role must not be silently changed by another.

---

## Decision

### 1. Placement space

A CoordinateFrame may be placed at **any position in the parent entity's
implicit local coordinate space** (ADR-033 §6).  No geometric restriction is
imposed — the valid placement set includes:

- A point on a face (including off-centre)
- A point on an edge
- A point in the interior of a Solid
- A point at a vertex

### 2. Default initial placement

The frame's initial position is determined by the **placement-pick sub-mode**
(§6 below).  When the user confirms a pick point, the frame is created there.

If no explicit pick is made (e.g. pick is cancelled before confirming), no frame
is created.  There is no centroid fallback on abort.

| Entity type | Pick surface |
|-------------|-------------|
| `Solid` | Any face, edge, or vertex of the cuboid |
| `AnnotatedLine` | Any point along the line |
| `AnnotatedRegion` | Any point on the boundary or interior |
| `AnnotatedPoint` | The single vertex position |
| `ImportedMesh` | Any point on the surface mesh |

### 3. Default orientation (pose)

The initial rotation of a CoordinateFrame is always the **identity rotation** —
axes aligned with the world frame — regardless of where on the parent entity
the pick lands.

**Rationale:** The integrator, not the geometry modeller, decides the
semantically correct axis orientation for an interface point.  Auto-rotating
to the nearest face normal would impose a geometry-derived convention on what
is fundamentally a relationship-derived concept.

Frame orientation is changed **only when**:

- A stakeholder explicitly rotates the frame via the R-key rotation workflow.
- A future constraint solver (Phase S-3 or later) computes a required
  orientation from a mating relationship.

### 4. Orientation change triggers

| Trigger | Who acts | When |
|---------|----------|------|
| User explicitly rotates via `R` key | Geometry modeller or integrator | Any time after creation |
| Constraint from `mounts`/`fastened` link | System (future solver) | When a geometric link is established |
| Copied from mating frame | System (future "align frames" UX) | When "snap to mate" is invoked |

### 5. Creation UX

1. User triggers "Add Frame" (N-panel button or long-press context menu).
2. App enters **placement-pick sub-mode** for the parent entity (§6).
3. User picks a point → frame created at that position, identity rotation.
4. Frame immediately becomes the active object; parent axes ghost becomes visible (§7).
5. User uses **R key** to rotate if needed.
6. Frame is named via prompt (mobile) or inline rename (PC).

### 6. Placement pick sub-mode interaction model

The sub-mode is scoped to a single parent entity.  The user cannot pick
a point on a different entity.

#### PC

| Step | Action | Visual |
|------|--------|--------|
| Entry | "Add Frame" button clicked in N-panel | Status bar: "Click to place frame — Esc to cancel" |
| Hover | Mouse moves over parent entity | Ghost CoordinateFrame follows cursor; snaps to vertex / edge midpoint / face centre (20 px screen-space) |
| Snap | Snap candidate found | Snap ring indicator shown at candidate point (same ring as Grab snap) |
| Confirm | Left-click | Frame created at picked position; sub-mode exits |
| Cancel | Escape or right-click | Sub-mode exits; no frame created |

#### Mobile

| Step | Action | Visual |
|------|--------|--------|
| Entry | "Add interface frame ⊞" in long-press context menu | Mobile toolbar: `[Cancel]`; status bar: "Tap to place frame" |
| Tap | Finger taps parent entity | Frame created at tap position; sub-mode exits |
| Cancel | Toolbar Cancel button | Sub-mode exits; no frame created |

#### State

```
framePlacementState = {
  active:   bool,       // whether sub-mode is engaged
  parentId: string,     // the entity being placed on
}
```

### 7. Parent axes ghost — orientation context overlay

The parent entity's implicit coordinate axes are rendered as a transient ghost
overlay in two situations (see §5 for lifecycle):

1. **Placement pick sub-mode is active** — the user needs the orientation reference
   to decide *where* to place the frame and to understand what X/Y/Z will mean
   when they later edit the N-panel location fields.
2. **A CoordinateFrame is the active selected object** — the same reference is
   needed when repositioning via Grab or setting translation values in the N-panel.

#### What the ghost shows

The ghost always renders **world-aligned axes** (identity rotation — no
parent-local tilt), positioned at the **geometry ancestor's centroid**.

"Geometry ancestor" is the first non-CoordinateFrame entity found by walking
up the parentId chain from the immediate parent.

**Rationale:** `CoordinateFrame.translation` is a *world-space* offset from
the parent centroid (see `SceneService._updateWorldPoses()`:
`worldPos = parentWorldPos + frame.translation`).  This means N-panel
`X = 0.5` always moves the frame 0.5 units in the **world X direction**,
regardless of how any intermediate CoordinateFrame is rotated.  Showing
the geometry ancestor's world-aligned axes makes the ghost consistent with
the actual translation semantics.

Showing an intermediate CoordinateFrame's rotated local axes would be
misleading: the user would expect `X = 0.5` to move along the displayed X
axis, but the code moves along world X.

> **Note (2026-04-20, Draft — provisional):** This decision was reached by
> reasoning from the `translation`-is-world-space invariant.  It should be
> validated against real usage in Phase P-1 and revisited if the UX does not
> match user expectations.

| Property | Value |
|----------|-------|
| Geometry | Three `LineDashedMaterial` lines along world +X, +Y, +Z |
| Colors | X = #ff4444 (red), Y = #44cc44 (green), Z = #4488ff (blue) |
| Position | World centroid of the geometry ancestor |
| Rotation | Identity (world-aligned always) |
| Depth test | Off (`depthTest: false`, `renderOrder: 1`) — always visible through geometry |
| Opacity | 0.35 |
| Dash / gap | 0.08 / 0.05 world units (pre-scale) |
| Scale | Computed from camera distance to geometry ancestor centroid using the same formula as `CoordinateFrameView.updateScale()`; capped at geometry ancestor bounding radius × 1.5 |

#### Lifecycle

| Event | Ghost state |
|-------|-------------|
| Pick sub-mode entered (`_framePlacementState.active = true`) | Shown at geometry ancestor centroid, world-aligned |
| Pick confirmed → frame created and selected | Remains visible (now in "frame selected" mode) |
| Pick cancelled | Hidden |
| CoordinateFrame becomes active selected object | Shown at geometry ancestor centroid, world-aligned |
| Active object changes away from CoordinateFrame | Hidden |

Implementation: `CoordinateFrameView.showParentAxesGhost(worldPos)` /
`hideParentAxesGhost()` (no quaternion argument needed — always identity).
During pick sub-mode, `AppController._parentAxesOverlay` (a scene-level
Three.js Group) is used directly since no `CoordinateFrameView` exists yet.

### 8. Provenance model — role-based frame authorship

#### 8.1 Data model

`CoordinateFrame` gains one new field:

```js
/** @type {'modeller' | 'integrator' | null} */
this.declaredBy = null   // null = no provenance restriction
```

`null` is the default.  Frames created before this ADR is implemented, and
frames created when no role is active, carry `null` and are always editable.

#### 8.2 Edit validation

When a user attempts to **move (Grab), rotate (R key), rename, or delete** a
CoordinateFrame, the system checks:

| `frame.declaredBy` | `currentRole` | Result |
|--------------------|---------------|--------|
| `null` | any | ✅ allowed |
| `'modeller'` | `'modeller'` | ✅ allowed |
| `'integrator'` | `'integrator'` | ✅ allowed |
| `'modeller'` | `'integrator'` | ❌ blocked |
| `'integrator'` | `'modeller'` | ❌ blocked |
| any | `null` (no role set) | ✅ allowed (pre-Auth permissive mode) |

On block: `showToast('This frame was declared by a [role]. Switch to that role to edit it.', { type: 'warn' })`.

**Creating new frames is always allowed**, regardless of role or parent frame provenance.
New frames receive `declaredBy = currentRole` (null if no role is active).

#### 8.3 Current role storage and console API

Until Auth is integrated, the current role is stored in a module-level variable
in `RoleService.js` and exposed on the global app handle:

```js
// RoleService.js
let _currentRole = null   // 'modeller' | 'integrator' | null

export const RoleService = {
  getRole: () => _currentRole,
  setRole: (role) => { _currentRole = role },
}
```

```js
// AppController constructor — after init
window.__easyExtrude = {
  setRole: (role) => RoleService.setRole(role),
  getRole: ()     => RoleService.getRole(),
}
```

From the browser DevTools console:

```js
window.__easyExtrude.setRole('modeller')    // become geometry modeller
window.__easyExtrude.setRole('integrator')  // become integrator
window.__easyExtrude.setRole(null)          // clear role (permissive mode)
window.__easyExtrude.getRole()              // → 'modeller'
```

#### 8.4 Auth integration (backlog)

When an Auth layer is introduced:

1. `RoleService.setRole()` becomes read-only (set by Auth session).
2. `window.__easyExtrude.setRole()` is removed or restricted to dev builds.
3. The validation logic in `AppController` is unchanged — only the source
   of truth for `currentRole` changes from a local variable to a session token.
4. `declaredBy` serialisation is forward-compatible: existing `null` fields
   remain permissive; role-tagged fields enforce provenance immediately.

No migration of existing scene data is required for the Auth transition.

### 9. Implications for geometry modeller workflow

A geometry modeller who anticipates integration may:

- Enter the sub-mode and pick frames at *likely* interface points
  (e.g. mounting face centre, shaft end).
- Name them descriptively: `MountingFace`, `OutputShaft`, `DatumHole_A`.
- Leave rotation at identity unless the interface direction is well-defined
  by the object's own geometry (e.g. a shaft axis is unambiguous).
- Set role to `'modeller'` before declaring frames so that integrators
  cannot silently reposition them.

The integrator retains authority to **create** frames on any parent entity.
To reposition a modeller-declared frame, the integrator must switch to the
`'modeller'` role — which is a deliberate, visible act.

---

## Consequences

### Benefits

- Frame placement is unrestricted — integrators can declare any spatial
  contract the assembly demands.
- No auto-alignment surprises — the tool does not impose geometric assumptions
  on semantic decisions.
- Pick sub-mode eliminates the mandatory post-creation Grab step; the frame
  lands exactly where the user intended.
- Parent axes ghost gives orientation context at no cost: no new entity,
  no persistent state, just a transient rendering aid.
- Role-based provenance makes ownership explicit: implicit changes to declared
  frames are impossible.
- Auth integration is a drop-in: validation logic is role-source-agnostic.

### Constraints

- Pick sub-mode adds an interactive step before frame creation (vs. instant
  centroid creation).  This is acceptable because most real placements require
  a Grab step anyway.
- Console role-switching is a developer tool, not a user-facing workflow.
  Until Auth is in place, the system trusts the developer to set the correct role.
- `declaredBy = null` frames are permissive by design; existing scenes are
  unaffected until the user actively sets a role.

---

## Implementation phases

### Phase P-1 — Parent axes ghost

Two display contexts (§7):

1. **Frame selected**: `CoordinateFrameView.showParentAxesGhost(worldPos, worldQuat)` /
   `hideParentAxesGhost()`, called from `AppController` on selection change.
   `updateScale()` scales ghost from parent camera distance.

2. **Pick sub-mode active**: no `CoordinateFrameView` instance exists yet.
   `AppController` manages a scene-level `_parentAxesOverlay` (Three.js Group)
   directly — shown on sub-mode entry, hidden on confirm or cancel.
   May share the same geometry/material factory as `CoordinateFrameView`.

### Phase P-2 — Placement pick sub-mode

`AppController._framePlacementState`.  N-panel "Add Frame" enters sub-mode
instead of creating at centroid.  PC: hover ghost + snap ring + click confirm.
Mobile: tap confirm + toolbar Cancel.

### Phase P-3 — Provenance model + console API

`CoordinateFrame.declaredBy` field.  `RoleService.js`.  Edit validation in
`AppController` grab / rotate / rename / delete paths.  `window.__easyExtrude`
console API.  Serialisation: `declaredBy` included in scene JSON.

### Phase P-4 — Auth integration *(backlog)*

Replace `RoleService._currentRole` with session-derived role from Auth layer.
Remove or gate `window.__easyExtrude.setRole()`.  No scene data migration needed.

---

## References

- ADR-033 — CoordinateFrame Phase C: Interface Contract Model (creation trigger policy)
- ADR-032 — Geometric Host Binding (mounts/fastened links that will consume frames)
- ADR-030 — SpatialLink (semantic links that use frames as endpoints)
- ADR-031 — Map Mode Interaction Model (placement-pick sub-mode pattern reference)
- ADR-018 — CoordinateFrame Phase A (original entity design)
- ADR-019 — CoordinateFrame Phase B (nested hierarchy, rotation editing)
- PHILOSOPHY #2 — Type Is the Capability Contract
- PHILOSOPHY #3 — Separate Pure Computation from Side Effects
- PHILOSOPHY #21 — Coordinate Spaces Are Statically Distinguished
