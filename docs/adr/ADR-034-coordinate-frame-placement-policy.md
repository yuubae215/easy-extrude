# ADR-034 — CoordinateFrame Placement and Pose Policy

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Date** | 2026-04-19 |
| **References** | ADR-033, ADR-032, ADR-030, ADR-018, ADR-019, PHILOSOPHY #21 |

---

## Context

ADR-033 defines *when* to create a CoordinateFrame (only with explicit user intent
or as a SpatialLink endpoint).  It leaves two questions open:

1. **Where** can a frame be placed within or on a parent entity?
2. **How** should the frame's orientation (pose) be initialised and changed?

These questions are non-trivial because:

- A naive UX might auto-align the frame to the nearest face normal, but that
  decision should belong to the integrator, not the tool.
- The "designer" of a CoordinateFrame is often not the geometry modeller.
  Understanding who decides frame placement is essential to designing the right UX.

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

The creation UX must support this full space via **Grab** after initial placement.

### 2. Default initial placement

When "Add Frame" is triggered without additional context, the frame is placed
at the **centroid of the parent entity's implicit local space**:

| Entity type | Centroid definition |
|-------------|---------------------|
| `Solid` | Average of `corners` (WorldVector3 array) |
| `AnnotatedLine` | Midpoint of vertex sequence |
| `AnnotatedRegion` | Average of ring vertices |
| `AnnotatedPoint` | The single vertex position |
| `ImportedMesh` | Bounding-box centroid |

This is a *starting point*, not a prescribed final position.  The user is
expected to Grab and reposition the frame immediately after creation.

> **Note (2026-04-19, Draft):** Centroid is a neutral fallback.  A future UX
> enhancement could enter a "pick placement" sub-mode on creation (similar to
> Map Mode's drawing state), allowing the user to click a point directly.
> This is deferred pending ADR-034 acceptance.

### 3. Default orientation (pose)

The initial rotation of a CoordinateFrame is the **identity rotation** —
axes aligned with the parent entity's implicit coordinate system
(which for root Solids aligns with the world frame).

**Rationale:** The integrator, not the geometry modeller, decides the
semantically correct axis orientation for an interface point.  Auto-rotating
to the nearest face normal would impose a geometry-derived convention on what
is fundamentally a relationship-derived concept.

Frame orientation is changed **only when**:

- A stakeholder (integrator or pre-declaring modeller) explicitly rotates the
  frame via the R-key rotation workflow.
- A future constraint solver (ADR Phase S-3 or later) computes a required
  orientation from a mating relationship.

### 4. Orientation change triggers

| Trigger | Who acts | When |
|---------|----------|------|
| User explicitly rotates via `R` key | Geometry modeller or integrator | Any time after creation |
| Constraint from `mounts`/`fastened` link | System (future solver) | When a geometric link is established |
| Copied from mating frame | System (future "align frames" UX) | When "snap to mate" is invoked |

### 5. Creation UX (current implementation)

1. User triggers "Add Frame" (N-panel button or long-press context menu).
2. Frame created at parent centroid, identity rotation.
3. Frame immediately becomes the active object.
4. User uses **Grab (G)** to reposition, **R key** to rotate if needed.
5. Frame is named via prompt (mobile) or inline rename (PC).

### 6. Implications for geometry modeller workflow

A geometry modeller who anticipates integration may:

- Create frames at *likely* interface points (e.g. mounting face centre)
  as a courtesy declaration.
- Name them descriptively: `MountingFace`, `OutputShaft`, `DatumHole_A`.
- Leave rotation at identity unless the interface direction is well-defined
  by the object's own geometry (e.g. a shaft axis is unambiguous).

The integrator retains authority to reposition or re-orient these frames
without the modeller's involvement.

---

## Consequences

### Benefits

- Frame placement is unrestricted — integrators can declare any spatial
  contract the assembly demands.
- No auto-alignment surprises — the tool does not impose geometric assumptions
  on semantic decisions.
- Consistent with PHILOSOPHY #2 (Type Is the Capability Contract) and
  PHILOSOPHY #3 (Separate Pure Computation from Side Effects): frame pose
  is mutable state owned by the integrator, not derived automatically from
  geometry.

### Constraints

- The centroid default requires a Grab step for most real placements.
  A "pick placement on creation" UX would reduce this friction
  (see §2 note above — deferred).
- Without a visual indicator of the implicit local axes (the parent entity's
  coordinate system), users may find identity rotation disorienting.
  A future ADR should address implicit axis visualisation.

### Open questions (to resolve before Accepted)

- Should "Add Frame" enter a placement-pick sub-mode instead of defaulting
  to centroid?  If yes, define the interaction model (escape cancels,
  click confirms, what is snapped to?).
- Should the system provide a visual ghost of the parent's implicit local
  axes when a frame is being placed?  This does not require an entity —
  it is a transient rendering aid.
- When the geometry modeller pre-declares frames and the integrator later
  adjusts them, is there a history / provenance model needed?

---

## References

- ADR-033 — CoordinateFrame Phase C: Interface Contract Model (creation trigger policy)
- ADR-032 — Geometric Host Binding (mounts/fastened links that will consume frames)
- ADR-030 — SpatialLink (semantic links that use frames as endpoints)
- ADR-018 — CoordinateFrame Phase A (original entity design)
- ADR-019 — CoordinateFrame Phase B (nested hierarchy, rotation editing)
- PHILOSOPHY #2 — Type Is the Capability Contract
- PHILOSOPHY #3 — Separate Pure Computation from Side Effects
- PHILOSOPHY #21 — Coordinate Spaces Are Statically Distinguished
