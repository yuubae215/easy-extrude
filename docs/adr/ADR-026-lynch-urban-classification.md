# ADR-026 — Lynch Urban Classification of 2D Map Objects

**Status:** Superseded by ADR-029
**Date:** 2026-04-01
**Author:** Claude Code

## Context

easy-extrude is evolving toward city-scale urban planning in addition to
building-element modeling.  When viewing a scene from above (bird's-eye /
map perspective), 3D objects at building scale are insufficient to represent
the urban environment.  Users need 2D map-scale entities — roads, district
boundaries, focal points — that carry semantic meaning at the city level.

The IFC classification system (ADR-025) addresses building-element semantics
for 3D entities (`Solid`, `ImportedMesh`): walls, columns, slabs, etc.
However, IFC does not describe urban morphology at the map scale.

Kevin Lynch's *The Image of the City* (1960) provides a complementary
vocabulary of five elements that structure how people mentally perceive and
navigate cities:

| Element | Japanese | Geometry | Meaning |
|---------|----------|----------|---------|
| **Path** | パス | Linear | Channels of movement — streets, walkways, transit |
| **Edge** | エッジ | Linear | Boundaries — shorelines, walls, fences, railroad cuts |
| **District** | 地区 | Areal | Areas with identifiable common character |
| **Node** | ノード | Point | Strategic focal points — junctions, squares |
| **Landmark** | ランドマーク | Point | Memorable external reference points — towers, monuments |

Lynch's framework was chosen because:
1. It is a widely recognised standard in urban design, urban planning, and
   urban morphology research.
2. It maps cleanly onto three geometry archetypes (linear, areal, point),
   allowing strong typing.
3. It is complementary to IFC — Lynch describes *how people experience the
   city*; IFC describes *what building elements are made of*.
4. The vocabulary is small (5 terms) and highly discoverable.

## Decision

Introduce **three new persistent 2D domain entities** and a **Lynch class
registry**, parallel to the IFC system (ADR-025).

### New domain entities

| Entity | Geometry | Valid `lynchClass` values |
|--------|----------|--------------------------|
| `UrbanPolyline` | Ordered vertex sequence (N ≥ 2); N-1 open edges | `'Path'`, `'Edge'`, `null` |
| `UrbanPolygon`  | Closed vertex ring (N ≥ 3); N closing edges | `'District'`, `null` |
| `UrbanMarker`   | Single anchor vertex | `'Node'`, `'Landmark'`, `null` |

All three implement the **LocalGeometry interface** (ADR-021):
- `vertices: Vertex[]`
- `edges: Edge[]`
- `faces: []` (always empty — 2D entities have no faces)
- `get corners(): Vector3[]`
- `move(startCorners, delta): void`
- `rename(name): void`

Each entity carries a static factory helper (`fromPoints` / `fromPoint`) to
construct the V/E graph from raw coordinates without coupling to the service.

### Data model

```
UrbanPolyline.lynchClass:  'Path' | 'Edge' | null
UrbanPolygon.lynchClass:   'District' | null
UrbanMarker.lynchClass:    'Node' | 'Landmark' | null
```

`null` means "unclassified urban element".

### Registry

`src/domain/LynchClassRegistry.js` — parallel to `IFCClassRegistry.js`:

```javascript
{ name: 'Path',     group: 'Linear', geometry: 'polyline', color: '#4A90D9' }
{ name: 'Edge',     group: 'Linear', geometry: 'polyline', color: '#E74C3C' }
{ name: 'District', group: 'Areal',  geometry: 'polygon',  color: '#27AE60' }
{ name: 'Node',     group: 'Point',  geometry: 'marker',   color: '#F39C12' }
{ name: 'Landmark', group: 'Point',  geometry: 'marker',   color: '#9B59B6' }
```

The `geometry` field enables the picker UI to filter valid classes per entity
type without additional runtime checks.

### Service layer

`SceneService` gains three creation methods and one classification method:

```javascript
createUrbanPolyline(points: Vector3[], name?: string): UrbanPolyline
createUrbanPolygon(points: Vector3[], name?: string):  UrbanPolygon
createUrbanMarker(point: Vector3, name?: string):      UrbanMarker
setLynchClass(id: string, lynchClass: string|null): void
```

`setLynchClass` enforces the type contract at runtime:
only `UrbanPolyline`, `UrbanPolygon`, and `UrbanMarker` are classifiable.

Domain event emitted: `'objectLynchClassChanged'(id, lynchClass)`.

### Undo/Redo

`SetLynchClassCommand` mirrors `SetIfcClassCommand` (ADR-025, ADR-022).

### Persistence

`SceneSerializer` handles all three new types.  DTOs include `lynchClass`
for forward compatibility; old scenes without urban entities load unaffected
(no new fields on existing types).

### Separation from IFC

| Dimension | IFC (ADR-025) | Lynch (ADR-026) |
|-----------|---------------|-----------------|
| Scale | Building element | Urban / city map |
| Entities | `Solid`, `ImportedMesh` (3D) | `UrbanPolyline`, `UrbanPolygon`, `UrbanMarker` (2D) |
| Standard | IFC4 (buildingSMART) | Lynch 1960 |
| Classes | 23 curated | 5 (complete set) |
| Field | `ifcClass` | `lynchClass` |
| Event | `objectIfcClassChanged` | `objectLynchClassChanged` |

## UX (deferred to next session)

The UI for creating and classifying Lynch entities is planned separately.
See `docs/ROADMAP.md` (Lynch urban elements — Phase 1) and
`docs/SCREEN_DESIGN.md` (Lynch section).

Intended UX pattern (mirrors IFC):
- **Add menu**: new entries "Urban Path / Edge", "Urban District", "Urban Marker"
- **N-panel**: "Lynch Class" section with coloured badge, Set/Change button, clear button
- **Outliner**: coloured badge (Lynch color) next to entity name when classified
- **Picker overlay**: filtered by geometry type (only valid Lynch classes shown)

## Alternatives Considered

### A — Single `UrbanObject` entity with geometry-type enum

One entity class with `geometryType: 'polyline'|'polygon'|'marker'` and
`lynchClass` field.

Rejected: collapses distinct geometry topologies into a runtime property,
violating **Principle 2** (Type Is the Capability Contract, PHILOSOPHY.md).
`instanceof UrbanPolyline` is unambiguous; `urbanObj.geometryType === 'polyline'`
is fragile and harder to guard.

### B — Extend existing entities (Profile, MeasureLine) with lynchClass

Attach `lynchClass` to existing 2D/1D entities rather than introducing new types.

Rejected: `Profile` is transient (disappears on extrude); `MeasureLine` is an
annotation tool with its own measurement semantics.  Urban map entities are
persistent, independent scene objects — they deserve their own type identity.

### C — ISO 19103 / OGC Simple Features for geometry primitives

Use a standard geography vocabulary (Point, LineString, Polygon) as the
geometry model.

Rejected for now: this codebase uses the V/E/F LocalGeometry interface
(ADR-021) as its geometry model.  `UrbanPolyline/Polygon/Marker` implement
that interface directly, keeping architectural consistency.  OGC alignment
can be added as metadata or export format later without affecting the domain
model.

## Consequences

- **Positive:** City-scale urban morphology can be represented and semantically
  annotated within the same scene as building-scale 3D objects.
- **Positive:** Lynch and IFC are orthogonal — each can be used independently
  or together (e.g., a building `Solid` classified as `IfcBuilding` inside a
  `UrbanPolygon` classified as `'District'`).
- **Positive:** Backward-compatible — existing scenes are unaffected.
- **Positive:** Three-type design follows the natural Lynch topology: linear /
  areal / point — future geometry editing (Edit Mode for polylines, polygon
  reshaping) has a clear structural hook.
- **Positive:** `UrbanPolylineView`, `UrbanPolygonView`, and `UrbanMarkerView`
  are fully implemented (rendering layer complete). `meshView` is populated on
  creation; HTML label labels are updated each animation frame.
- **Neutral:** Node is fixed to `UrbanMarker` (point geometry). If area-type
  Nodes (e.g. large plazas) are needed in the future, `UrbanPolygon` can also
  accept `lynchClass = 'Node'` — the registry `geometry` field is the only
  constraint, and it can be widened.

## References

- Kevin Lynch, *The Image of the City*, MIT Press, 1960.
- ADR-020 — Domain Entity Taxonomy (Solid / Profile / Frame / Annotation)
- ADR-021 — Unified Local-Geometry Graph Interface
- ADR-022 — Undo / Redo via Command Pattern
- ADR-025 — IFC Semantic Classification of Scene Objects
- ADR-013 — Domain Events — Making SceneService Observable
- PHILOSOPHY.md §2 — Type Is the Capability Contract
