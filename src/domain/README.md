# Domain Layer — Pure Entities

**Responsibility**: Represent business logic and domain entities.

Files: `Solid.js`, `Profile.js`, `ImportedMesh.js`, `MeasureLine.js`, `CoordinateFrame.js`

---

## Meta Model: Complete Purity

Code in this layer **must have no side effects**.

| Prohibited | Reason |
|------------|--------|
| `import` from `three` | Three.js is a rendering side effect — belongs in View. |
| References to `window` / `document` | DOM is a side effect — belongs in Controller/View. |
| `fetch`, WebSocket, DB | I/O is a side effect — belongs in Service. |
| Direct mutation of external state | Creates unpredictable side effects — go through Service. |

## Dependency Direction

```
Domain ← Model ← Service ← Controller ← View
```

Domain depends on nothing. Every other layer depends on Domain.

## Entity Taxonomy (ADR-020, ADR-021)

```
SceneObject (union)
  ├─ Geometry        — occupies 3D space; user-visible shape
  │   ├─ Solid         (deformable 3D solid; editable; LocalGeometry)
  │   └─ ImportedMesh  (server-computed read-only geometry)
  ├─ Frame           — SE(3) reference frame; no intrinsic shape
  │   └─ CoordinateFrame
  ├─ Annotation      — measurement overlay; LocalGeometry
  │   └─ MeasureLine
  └─ Draft           — transient 2D cross-section; LocalGeometry
      └─ Profile
```

## Entity Capability Contracts (ADR-009, ADR-010, ADR-012, ADR-020)

- `instanceof Profile` = 2D, not yet extruded. Operations: `setRect(p1,p2)`, `extrude(height)`, `rename(name)`
- `instanceof Solid` = 3D solid. Operations: `move()`, `extrudeFace(face, ...)`, `rename(name)`
- `instanceof ImportedMesh` = arbitrary triangle mesh (read-only geometry). Operations: `move()`, `rename(name)`
- `instanceof MeasureLine` = two-point measurement annotation. LocalGeometry: `vertices[2]`, `edges[1]`. Operations: `move()`, `setEndpoints()`, `rename(name)`
- `instanceof CoordinateFrame` = SE(3) named reference frame. Operations: `move()`, `rename(name)`. World pose managed by `SceneService._worldPoseCache`.
- `Profile.extrude()` must **not** mutate the Profile — it returns a new `Solid`
- Use `instanceof` for entity type dispatch; never use a `dimension` scalar

## LocalGeometry Interface (ADR-021)

`Solid`, `Profile`, and `MeasureLine` all implement the LocalGeometry interface:

```js
interface LocalGeometry {
  vertices: Vertex[]
  edges:    Edge[]
  faces:    Face[]   // empty for 1D and 2D entities
  get corners(): Vector3[]
  rename(name: string): void
  move(startCorners: Vector3[], delta: Vector3): void
}
```

## Concurrency Note

Entities do not hold `isProcessing` flags. Lock management is the Service
layer's responsibility. See `docs/CONCURRENCY.md` §4.
