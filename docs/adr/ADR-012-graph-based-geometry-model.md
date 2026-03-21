# ADR-012: Graph-based Geometry Model (Vertex / Edge / Face / Solid)

- **Status**: Accepted (Phase 5-1: Vertex layer implemented. Phase 5-3: Edge / Face / selection model foundation / dimension removal implemented)
- **Date**: 2026-03-20
- **References**: ADR-005, ADR-009, ADR-011

---

## Context

The current `Cuboid` entity holds 8 vertices as `corners: Vector3[8]`, with faces
implicitly defined by `FACES[i].corners` (arrays of vertex indices).
`Sketch` uses its own `sketchRect: { p1, p2 }` representation.

This design has the following drawbacks:
- Vertex, edge, and face selection cannot be expressed uniformly (operations like G→V, G→E are hard to add)
- Switching types via a `dimension` field makes it easy for state transitions and method sets to diverge
  (an actual bug: `move()` / `extrudeFace()` were missing on Sketch)

---

## Decision

In future phases, build all geometry entities on top of a graph structure.

### Base Graph

```
Vertex  = { id, position: Vector3 }
Edge    = { id, v0: Vertex, v1: Vertex }
Face    = { id, vertices: Vertex[N] }   // N=4 for quads
```

### Dimensional Entities

| Dimension | Entity | Composition |
|-----------|--------|-------------|
| 0D | `Vertex` | 1 point |
| 1D | `Edge` | 2 Vertices |
| 2D | `Face` | Closed cycle of Edges |
| 3D | `Cuboid` | Closed polyhedron of Faces (6 faces × 4 vertices) |

### Verbs (operations that raise dimension)

| Verb | Transform | Description |
|------|-----------|-------------|
| `Sketch` | 1D → 2D | Creates a Face from a Vertex pair |
| `Extrude` | 2D → 3D | Creates a Cuboid from a Face |

Verbs do not mutate the source entity; they return a new entity of higher dimension.
`SceneService` deletes the old entity and registers the new one under the same ID.

### Unified Selection Model

```js
selection: Set<Vertex | Edge | Face>
```

G→V (vertex selection), G→E (edge selection), G→F (face selection) all operate on the same selection system.
The current Edit Mode "face hover / face drag" becomes a special case of Face selection in this model.

### Mapping from Current Implementation

```
corners: Vector3[8]  →  Vertex[8]
FACES[i].corners     →  Face[i].vertices  (vertex index references)
(implicit edges)     →  Edge[] made explicit
```

---

## Consequences

**Benefits**
- Vertex, edge, and face level selection and manipulation can be implemented uniformly
- The `dimension` field is no longer needed; entity type determines behaviour
- The "state transitioned but methods didn't follow" problem is structurally impossible
- The model becomes closer to Blender's BMesh, improving compatibility with future feature extensions

**Constraints / Costs**
- The current `corners[8]` / `FACES`-based geometry computation (`CuboidModel.js`) needs a full rewrite
- `MeshView`'s `BufferGeometry` construction logic also needs updating
- Migration cost is high; start after existing functionality stabilises

## Implementation Status

### Phase 5-1 (Done 2026-03-20)

Added `src/graph/Vertex.js`. `Cuboid.vertices` / `Sketch.vertices` hold `Vertex[8]`.
The `get corners()` getter returns `Vector3[]`, keeping `CuboidModel.js` / `MeshView` / `AppController` unchanged.
`SceneService.createCuboid()` generates `Vertex[]` and passes them to `Cuboid`.

### Phase 5-3 (Done 2026-03-20)

Added `src/graph/Edge.js`, `src/graph/Face.js`.

Added `faces: Face[6]`, `edges: Edge[12]` to `Cuboid` (auto-built from FACES definitions in constructor).
Changed `extrudeFace(fi, ...)` to `extrudeFace(face, ...)`, operating directly on `Face.vertices`.

Changed `Sketch.extrude()` to return a new `Cuboid` without mutation (conforming to the verb pattern).
`SceneService.extrudeSketch(id, height)` replaces the Sketch with the Cuboid.

Removed the `dimension` field from `Cuboid` / `Sketch`.
Branches in `AppController.setMode()` / `_updateNPanel()` changed to use `instanceof Sketch`.

Changed `AppController._hoveredFace` / `_dragFace` to `Face|null` (foundation for the unified selection model).
Added `SceneModel.editSelection: Set<Vertex|Edge|Face>` (initialised as empty Set).
