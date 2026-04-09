# ADR-029 — Spatial Annotation System (supersedes ADR-026)

**Status:** Accepted
**Date:** 2026-04-08
**Supersedes:** ADR-026 (Lynch Urban Classification of 2D Map Objects)
**References:** ADR-020, ADR-021, ADR-022, ADR-025, ADR-013, ADR-028

---

## Context

ADR-026 introduced three 2D domain entities (`UrbanPolyline`, `UrbanPolygon`,
`UrbanMarker`) classified via Kevin Lynch's five urban elements (Path, Edge,
District, Node, Landmark).

Two problems with that design emerged in practice:

1. **Scope is too narrow.** The "Urban" prefix implies city-scale use only.
   The same three geometry archetypes (linear, areal, point) and the same
   five structural categories are equally valid at:
   - Building interior layout (corridor, wall, room, doorway, column)
   - Manufacturing / jig design (feed route, area boundary, work zone,
     datum hole, reference feature)
   - Any domain where *the position of a thing carries semantic meaning*.

2. **"Lynch" as a vocabulary name is too specific.** Kevin Lynch's taxonomy
   is the intellectual ancestor, but the categories themselves
   (movement route, boundary, zone, hub, anchor) are abstractions that stand
   on their own without requiring knowledge of Lynch's original work.

The core insight is that this system represents **places with meaning** — spatial
elements whose location is semantically significant and whose mutual relationships
can be reasoned about.  Graph theory provides the right mental model: point
elements are nodes, linear elements are edges, areal elements are hyperedges
(containing sets of nodes).

### Relationship between CoordinateFrame and this system

A key architectural distinction emerged: **`aligns` is a CoordinateFrame
concept, not a SpatialLink concept.**

When two things `align` — e.g. a datum hole and a jig pin — they together
establish a new coordinate basis: the point of alignment *becomes* a new
reference origin, and it is the top of the tolerance chain for everything
derived from it.  This is precisely what a `CoordinateFrame` placed at that
location encodes: the frame *is* the alignment.

For `SpatialLink` (see Out of Scope below), the relevant relationship between
two `AnnotatedPoint` entities is `references` — "A derives its position datum
from B" — which is a semantic relationship between named places, not a
mathematical frame transformation.

## Decision

### Renamed entities

| Old name | New name | Geometry |
|----------|----------|----------|
| `UrbanPolyline` | `AnnotatedLine`   | Linear — ordered vertex sequence |
| `UrbanPolygon`  | `AnnotatedRegion` | Areal  — closed vertex ring |
| `UrbanMarker`   | `AnnotatedPoint`  | Point  — single anchor vertex |

### Renamed field

| Old | New |
|-----|-----|
| `lynchClass` | `placeType` |

### Renamed registry and helpers

| Old | New |
|-----|-----|
| `LynchClassRegistry.js` | `PlaceTypeRegistry.js` |
| `LYNCH_CLASSES` | `PLACE_TYPES` |
| `LYNCH_CLASS_MAP` | `PLACE_TYPE_MAP` |
| `getLynchClassEntry()` | `getPlaceTypeEntry()` |
| `getLynchClassesByGroup()` | `getPlaceTypesByGroup()` |
| `getLynchClassesByGeometry()` | `getPlaceTypesByGeometry()` |

### Renamed command

| Old | New |
|-----|-----|
| `SetLynchClassCommand.js` | `SetPlaceTypeCommand.js` |
| `createSetLynchClassCommand()` | `createSetPlaceTypeCommand()` |

### Renamed service methods and event

| Old | New |
|-----|-----|
| `SceneService.createUrbanPolyline()` | `createAnnotatedLine()` |
| `SceneService.createUrbanPolygon()` | `createAnnotatedRegion()` |
| `SceneService.createUrbanMarker()` | `createAnnotatedPoint()` |
| `SceneService.setLynchClass()` | `setPlaceType()` |
| Domain event `objectLynchClassChanged` | `objectPlaceTypeChanged` |

### Abstracted place-type categories

The five categories are retained but renamed to scale-independent terms:

| Old (Lynch) | New | Geometry | Urban | Building | Manufacturing |
|-------------|-----|----------|-------|----------|---------------|
| Path | **Route** | Linear | Street, walkway | Corridor, aisle | Conveyor, feed path |
| Edge | **Boundary** | Linear | Shoreline, fence | Wall, partition | Area boundary |
| District | **Zone** | Areal | Neighbourhood | Room, department | Work area, cell |
| Node | **Hub** | Point | Intersection, square | Door, stairwell | Datum hole, fixture point |
| Landmark | **Anchor** | Point | Monument, tower | Column, feature | Reference feature, datum |

The graph-theoretic reading:
- **Hub** = node (junction, focal concentration)
- **Anchor** = special node (external reference, the root datum of a tolerance chain)
- **Route** / **Boundary** = edge (directed vs. separating)
- **Zone** = hyperedge / face (bounded region)

### Serialization type strings

Old scene JSON used `"type": "UrbanPolyline"` etc.  New format uses
`"type": "AnnotatedLine"` etc.  The `lynchClass` field is renamed `placeType`.
Old scenes saved before this ADR will not load correctly — no migration shim
is provided (development project, no production data).

---

## Out of scope — SpatialLink (future ADR)

A `SpatialLink` entity would make the semantic relationships between annotated
elements machine-readable as a typed edge in the scene graph:

```js
// Minimal domain entity (not yet implemented)
{
  id:         'link_001',
  sourceId:   'annot_point_A',   // e.g. AnnotatedPoint (Hub: datum hole)
  targetId:   'annot_point_B',   // e.g. AnnotatedPoint (Hub: jig pin)
  linkType:   'references',      // A's position is derived from B as datum
}
```

Candidate `linkType` values:

| linkType | Preposition analogy | Meaning |
|----------|---------------------|---------|
| `references` | "derived from" | A uses B as its positional datum (tolerance chain) |
| `connects` | "leads to" | A route/path connects A to B |
| `contains` | "holds" | Region A contains entity B |
| `adjacent` | "borders" | A and B share a boundary |

Note: `aligns` is deliberately excluded — it is a CoordinateFrame concept
(two frames that share the same origin establish a new datum basis), not a
SpatialLink concept.  The semantic relationship between a datum hole and a
jig pin is `references`, not `aligns`; the mathematical alignment is expressed
by placing a `CoordinateFrame` at the datum location.

Integration with ADR-028's `getSceneGraph()` API:  SpatialLink edges would be
included as `relation: 'spatial'` entries alongside existing `'frame'` and
`'anchor'` relation types.

---

## Consequences

- **Positive:** The system is now useful at city, building, and part-level scales
  without renaming or forking.
- **Positive:** "Urban" and "Lynch" no longer appear in user-visible strings —
  the UI shows "Place Type", "Route", "Hub", "Anchor", etc.
- **Positive:** The five category names (Route/Boundary/Zone/Hub/Anchor) carry
  meaning without requiring the user to know Lynch's original framework.
- **Positive:** The `aligns` vs. `references` distinction is documented,
  preventing future confusion between CoordinateFrame semantics and SpatialLink
  semantics.
- **Neutral:** Existing serialized scenes (if any) require manual migration or
  re-creation.  Acceptable for a development-stage project.
- **Neutral:** The architecture (three entity types, one registry, one command)
  is unchanged — this is a pure vocabulary / naming refactor.

## References

- ADR-020 — Domain Entity Taxonomy
- ADR-021 — Unified Local-Geometry Graph Interface
- ADR-022 — Undo / Redo via Command Pattern
- ADR-025 — IFC Semantic Classification
- ADR-026 — Lynch Urban Classification (superseded)
- ADR-028 — Anchored Annotations & Scene Graph API
- ADR-013 — Domain Events
- PHILOSOPHY.md §2 — Type Is the Capability Contract
- Kevin Lynch, *The Image of the City*, MIT Press, 1960 (intellectual ancestor)
