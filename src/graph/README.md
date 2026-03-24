# Graph Layer — Geometric Topology Primitives

**Responsibility**: Represent the topological elements (vertices, edges, faces)
that make up the geometry of domain entities.

Files: `Vertex.js`, `Edge.js`, `Face.js`

---

## Meta Model: Pure Data, Stable Identity

Graph primitives are pure value objects with stable `id`s. They hold no
rendering state and perform no side effects. They are owned exclusively by
`Cuboid` (and `Sketch` for vertices).

| Prohibited | Reason |
|------------|--------|
| `import` from `three` (except `Vector3` type hint) | Rendering concern — belongs in View. |
| References to `SceneModel`, `SceneService`, or any View | Graph must not depend outward. |
| Mutable `id` fields | IDs are the stable identity used for selection tracking. |

## Ownership Contracts (ADR-012)

```
Cuboid.vertices : Vertex[8]   — 8 corners of the box
Cuboid.edges    : Edge[12]    — 12 edges connecting pairs of vertices
Cuboid.faces    : Face[6]     — 6 faces, each referencing 4 vertices in CCW order
```

`Sketch.vertices` holds the 4 corner `Vertex` objects of the 2D rectangle.
`Sketch.edges` and `Sketch.faces` are not present — they exist only on `Cuboid`.

`ImportedMesh` and `MeasureLine` have **no** vertex/edge/face graph. Any code
that iterates selected objects and accesses `.corners`, `.edges`, or `.faces`
must guard with `instanceof Cuboid` (or check `obj.faces != null`).

## Element Summary

| Class | Fields | Notes |
|-------|--------|-------|
| `Vertex` | `id`, `position: THREE.Vector3` | `position` is mutable; use `clone()` to snapshot |
| `Edge` | `id`, `v0: Vertex`, `v1: Vertex` | References live `Vertex` objects — position changes propagate automatically |
| `Face` | `id`, `vertices: Vertex[4]`, `name`, `index` | `get corners()` returns `Vector3[]` for compatibility with `CuboidModel` pure functions |

`Face.index` is the 0-based position in `Cuboid.faces` (0–5). It is stored on
the `Face` so callers can pass a `Face` object to methods that still accept an
index (e.g. `MeshView.setFaceHighlight(face.index, ...)`).

## References

- ADR-012 — Graph-based geometry model (Phases 5-1 through 5-3)
- `src/domain/README.md` — Entity capability contracts
- `MENTAL_MODEL.md §1` — Entity capability contracts and `instanceof` guards
