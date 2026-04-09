# ADR-030 — SpatialLink: Typed Semantic Edges Between Annotated Elements

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-04-09 |
| **References** | ADR-029, ADR-028, ADR-013, ADR-020, ADR-022 |

---

## Context

ADR-029 defines three annotation entity types (`AnnotatedLine`, `AnnotatedRegion`,
`AnnotatedPoint`) and their place-type classifications (Route, Boundary, Zone, Hub, Anchor).
While each entity carries semantic meaning via its `placeType`, the *relationships* between
entities — spatial proximity, topological containment, datum derivation — remain implicit.
They are visible to the user's eye but invisible to the system.

ADR-028's `getSceneGraph()` already supports typed edges:

- `'frame'` — CoordinateFrame parent-child chains
- `'anchor'` — MeasureLine endpoint anchor references

The architecture is ready to accept a third relation type: `'spatial'`.

ADR-029 explicitly defers `SpatialLink` (see §Out of scope) and defines its minimal shape:

```js
{
  id:       'link_001',
  sourceId: 'annot_point_A',
  targetId: 'annot_point_B',
  linkType: 'references',
}
```

This ADR designs and implements that entity.

### Relationship to CoordinateFrame

`aligns` is deliberately excluded from the `linkType` vocabulary (see ADR-029).
When two things align — a datum hole and a jig pin — they establish a new coordinate
basis: the alignment *is* a `CoordinateFrame`. The mathematical relationship is expressed
by placing a frame at the datum location. The semantic relationship between the two
annotated points is `references` — "A derives its positional datum from B" — which is a
meaning-carrying relationship, not a geometric transform.

---

## Decision

### 1. Domain entity

`SpatialLink` is a first-class domain entity in `src/domain/SpatialLink.js`.

```js
class SpatialLink {
  constructor(id, sourceId, targetId, linkType) {
    this.id       = id
    this.sourceId = sourceId   // ID of any scene entity
    this.targetId = targetId   // ID of any scene entity
    this.linkType = linkType   // see §2
  }
}
```

`SpatialLink` is stored in `SceneModel` alongside other entities. It is NOT a geometry
entity — it has no `meshView`, no `corners`, no `move()`. `AppController` must guard
Grab / Edit / Stack / Duplicate for `SpatialLink` the same way it does for `MeasureLine`.

### 2. linkType vocabulary

| linkType | Directed? | Meaning |
|----------|-----------|---------|
| `references` | yes | Source derives its positional datum from target (tolerance chain) |
| `connects` | no | A route logically connects source to target |
| `contains` | yes | Region source spatially contains entity target |
| `adjacent` | no | Source and target share a boundary or are spatially neighbouring |

`aligns` is not included — it is a CoordinateFrame concept (see Context above).

### 3. SceneService API

```js
// Create
createSpatialLink(sourceId, targetId, linkType)
  // → emits spatialLinkAdded({ link: SpatialLink })

// Delete
deleteSpatialLink(linkId)
  // → emits spatialLinkRemoved({ linkId })

// Query
getLinksOf(entityId)
  // → SpatialLink[] — all links where sourceId or targetId === entityId
```

### 4. Command layer

| Command factory | Undo action |
|-----------------|-------------|
| `createSpatialLinkCommand(link)` | `deleteSpatialLink(link.id)` |
| `deleteSpatialLinkCommand(link)` | recreate with same `id`, `sourceId`, `targetId`, `linkType` |

Both commands follow the `createXCommand` factory naming convention (CODE_CONTRACTS §Architecture).

### 5. Scene graph integration

`getSceneGraph()` includes SpatialLink edges as `relation: 'spatial'`:

```js
{
  nodes: [{ id, name, type, parentId }],
  edges: [
    { from: 'annot_point_A', to: 'annot_point_B', relation: 'spatial', linkType: 'references' },
    // … existing 'frame' and 'anchor' entries
  ]
}
```

### 6. Serialization

`SceneSerializer` includes SpatialLinks as a top-level `"links"` array (version bump to `1.2`):

```jsonc
{
  "version": "1.2",
  "objects": [...],
  "links": [
    {
      "type": "SpatialLink",
      "id": "link_001",
      "sourceId": "annot_point_A",
      "targetId": "annot_point_B",
      "linkType": "references"
    }
  ]
}
```

`SceneImporter` restores links after all entity IDs are mapped (same deferred pattern as
CoordinateFrame `parentId` resolution). Absence of `"links"` is treated as `[]` — backward
compatible with v1.0 / v1.1 scenes.

### 7. Rendering (Phase 3)

`SpatialLinkView` renders a dashed line or directed arrow between the world centroids of
source and target entities. It updates each animation frame via the `_updateWorldPoses()`
loop. Color is coded by `linkType`:

| linkType | Color |
|----------|-------|
| `references` | amber `#F59E0B` |
| `connects` | cyan `#06B6D4` |
| `contains` | violet `#8B5CF6` |
| `adjacent` | slate `#64748B` |

`SpatialLinkView` must implement a complete no-op interface for every `MeshView` method
called through polymorphic references in `AppController` (PHILOSOPHY #17 — Polymorphic
Interfaces Must Be Complete).

### 8. Creation UI (Phase 4)

Two-phase selection flow:

1. Select source entity → press `L` key (or Add menu → "Spatial Link")
2. Status bar prompts "Click target entity"
3. Click target → link-type picker overlay appears (four buttons)
4. Confirm → `CreateSpatialLinkCommand` pushed to undo stack

N-panel shows a "Spatial Links" section for the selected entity listing all links where
it is source or target, with a delete button per link. Outliner displays a small badge
icon when an entity participates in one or more SpatialLinks.

---

## Consequences

### Benefits

- Spatial relationships are machine-readable — `getSceneGraph()` can detect semantically
  isolated clusters, datum chains, and containment hierarchies
- `getLinksOf(entityId)` enables future analytics (how many things reference this datum?)
- Serialization preserves relationships; reopening a scene restores them exactly

### Constraints

- `SpatialLink` has no geometry — cannot be grabbed, extruded, edited, or stacked
- `AppController` must add `instanceof SpatialLink` guards (same pattern as MeasureLine)
- `SpatialLinkView` must satisfy PHILOSOPHY #17 (polymorphic interface completeness)
- Deleting a source or target entity does NOT auto-delete the link — the link becomes
  "dangling". `getLinksOf()` callers should filter links where the referenced entity no
  longer exists. A future enhancement could show a "broken link" indicator.

### Out of scope

- **Constraint solving**: `SpatialLink` is semantic, not geometric. Making `references`
  drive world-position updates (like CoordinateFrame parenting) requires a separate
  constraint-solver ADR.
- **Directed graph visualization** (force layout, Sankey diagram) — deferred to a future UX ADR.
- **Multi-hop path queries** (shortest path between two entities) — deferred.

---

## References

- ADR-029 — Spatial Annotation System (defines entity types; defers SpatialLink)
- ADR-028 — Anchored Annotations & Scene Graph API (`getSceneGraph()` structure)
- ADR-013 — Domain Events
- ADR-020 — Domain Entity Taxonomy
- ADR-022 — Undo / Redo via Command Pattern
- PHILOSOPHY #17 — Polymorphic Interfaces Must Be Complete
- PHILOSOPHY #2 — Type Is the Capability Contract
