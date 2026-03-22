# Domain Layer — Pure Entities

**Responsibility**: Represent business logic and domain entities.

Files: `Cuboid.js`, `Sketch.js`, `ImportedMesh.js`

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

## Entity Capability Contracts (ADR-009, ADR-010, ADR-012)

- `instanceof Sketch` = 2D, not yet extruded. Operations: `extrude(height)`, `rename(name)`
- `instanceof Cuboid` = 3D. Operations: `move()`, `extrudeFace(face, ...)`, `rename(name)`
- `instanceof ImportedMesh` = arbitrary triangle mesh (read-only geometry). Operations: `rename(name)` only
- `Sketch.extrude()` must **not** mutate the Sketch — it returns a new `Cuboid`
- Use `instanceof` for entity type dispatch; never use the `dimension` scalar

## Concurrency Note

Entities do not hold `isProcessing` flags. Lock management is the Service
layer's responsibility. See `docs/CONCURRENCY.md` §4.
