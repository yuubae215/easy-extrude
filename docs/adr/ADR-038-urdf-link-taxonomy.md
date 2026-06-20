# ADR-038 — URDF-Style Link Taxonomy: Kinematic + Semantic Two-Layer Classification

**Status**: Accepted  
**Date**: 2026-05-08  
**Supersedes**: ADR-030 §2 (link type vocabulary), ADR-032 §2 (geometric link vocabulary)  
**Related**: ADR-053 (ロボティクス KPI メソッド — 予約 jointType `revolute`/`prismatic` を URDF→シーン表現で活用)

---

## Context

`SpatialLink` originally used a single flat `linkType` field (ADR-030/ADR-032) that mixed
kinematic constraint behavior (`fastened` = rigid 6-DoF) with topological annotation
(`adjacent`, `contains`) and semantic annotation (`references`, `represents`) into one
undifferentiated vocabulary.

This caused two problems:

1. **Semantic overloading**: "fastened" means both *how the bodies are constrained* (rigid
   joint = 0 DOF) and *why they are connected* (bolted/welded in the real world). These are
   independent concerns that should be separately queryable.

2. **No upgrade path to URDF joint types**: A revolute or prismatic joint in a future
   implementation has no natural home in the flat vocabulary. Adding `revolute` as a
   `linkType` would conflate kinematic DOF with semantic meaning.

The project already adopts ROS TF / URDF conventions for coordinate frames (ADR-016,
ADR-037). Extending URDF joint-type semantics to `SpatialLink` aligns the constraint system
with this established convention and provides a clear taxonomy for future 1-DOF joints.

---

## Decision

`SpatialLink` now carries **two orthogonal fields** instead of one:

### `jointType` — URDF kinematic type

Determines the **degrees of freedom** between source and target frames.
`null` for annotation-only links with no kinematic constraint.

| Value | DOF | URDF equivalent | Constraint solver |
|-------|-----|-----------------|-------------------|
| `'fixed'` | 0 | `<joint type="fixed">` | `_updateFastenedFrames()` drives source CF every frame |
| `'revolute'` | 1 | `<joint type="revolute">` | Future — 1-axis rotation + limits |
| `'continuous'` | 1 | `<joint type="continuous">` | Future — 1-axis rotation, unlimited |
| `'prismatic'` | 1 | `<joint type="prismatic">` | Future — 1-axis translation + limits |
| `'floating'` | 6 | `<joint type="floating">` | Pose tracked; no runtime constraint |
| `'planar'` | 3 | `<joint type="planar">` | Future — free in XY plane + Z rotation |
| `null` | — | — | Annotation only; no solver |

### `semanticType` — Domain meaning annotation

Captures the **intent or relationship** in the problem domain. Always present.

| Value | Old `linkType` | Category | Notes |
|-------|----------------|----------|-------|
| `'fastened'` | `'fastened'` | Geometric | Structurally bolted/welded |
| `'mounts'` | `'mounts'` | Geometric | Source vertices in target local frame |
| `'aligned'` | `'aligned'` | Geometric | Orientation alignment reference |
| `'contains'` | `'contains'` | Topological | Region contains target entity |
| `'adjacent'` | `'adjacent'` | Topological | Shared boundary / neighbour |
| `'above'` | `'above'` | Topological | Vertically above (Z-axis) |
| `'connects'` | `'connects'` | Topological | Path logically connects to target |
| `'references'` | `'references'` | Semantic | Derives positional datum |
| `'represents'` | `'represents'` | Semantic | Depicts / represents target concept |

---

## Constraint Solver Activation Rules

The constraint solver (`_updateFastenedFrames`) activates when **all** of:
- `link.jointType === 'fixed'`
- `link.semanticType !== 'mounts'` (mounts has its own solver path)
- Both `sourceId` and `targetId` resolve to `CoordinateFrame` instances

The mounts solver (`_updateMountedAnnotations`) activates when:
- `link.semanticType === 'mounts'`

This means ANY `fixed` CF-to-CF joint (whether `fastened` or `aligned`) activates the
rigid body constraint. The `semanticType` annotation does not alter constraint behavior
for `fixed` joints — all carry full 6-DoF rigidity.

---

## Serialization Migration

Scene file format bumped from **v1.2 → v1.3**.

| Field | v1.2 | v1.3 |
|-------|------|------|
| `linkType` | present | absent |
| `jointType` | absent | present (`string\|null`) |
| `semanticType` | absent | present (`string`) |

**Backward compat**: `SceneService` auto-migrates v1.2 DTOs using `migrateLinkType()`:

```js
const MIGRATION_MAP = {
  fastened:   ['fixed',  'fastened'],
  mounts:     ['fixed',  'mounts'],
  aligned:    ['fixed',  'aligned'],
  contains:   [null,     'contains'],
  adjacent:   [null,     'adjacent'],
  above:      [null,     'above'],
  connects:   [null,     'connects'],
  references: [null,     'references'],
  represents: [null,     'represents'],
}
```

`SceneImporter` accepts both v1.2 and v1.3 files. v1.2 validation uses `VALID_LEGACY_LINK_TYPES`;
v1.3 validation uses `VALID_JOINT_TYPES` and `VALID_SEMANTIC_TYPES`.

---

## Link Creation UI

`_computeLinkOptions(source, target)` replaces `_computeValidLinkTypes()`. It returns:

```js
[{ jointType: string|null, semanticType: string, label: string }]
```

`UIView.showLinkTypePicker()` accepts `{ linkOptions }` instead of `{ validTypes }`.
The `onSelect` callback receives the full option object (not a string).
Display label format: `"Fixed · Fastened"`, `"Fixed · Aligned"`, `"Adjacent"`, etc.

---

## Why Not Merge into One Field?

A single combined field like `'fixed:fastened'` was considered. Rejected because:
- It requires parsing everywhere that reads the field.
- `semanticType` is useful independently (spatial queries, analytics, scene graph edges).
- `jointType` determines constraint solver participation independently of semantics.
- Future kinematic types (revolute, prismatic) pair with multiple semanticTypes.

---

## Consequences

**Positive**:
- Clear upgrade path to revolute / prismatic joints (ROADMAP 🟢 Low).
- Matches URDF naming convention already established in ADR-016/ADR-037.
- Semantic annotations remain queryable regardless of kinematic type.
- Scene graph edges emit both fields independently, enabling richer tooling.

**Negative**:
- v1.2 scenes require migration on load (handled automatically; transparent to user).
- `SpatialLink` has one more field; all construction sites must be updated.

---

## References

- ADR-030 — SpatialLink original design (§2 vocabulary superseded by this ADR)
- ADR-032 — Geometric host binding / mounts constraint (vocabulary updated)
- ADR-016 — ROS TF coordinate frame conventions
- ADR-037 — Body Frame Architecture
- ROADMAP — "Revolute / prismatic constraints in Node Editor" (🟢 Low backlog)
