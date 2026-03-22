# ADR-009 — Domain Entity Types: Cuboid and Sketch

**Status:** Accepted
**Date:** 2026-03-20
**References:** ADR-002, ADR-005, ADR-007, docs/ARCHITECTURE.md

---

## Context

Phase 0 represents scene objects as plain JS object literals:

```js
{ id, name, description, dimension, corners, sketchRect, meshView }
```

These are constructed inline in `AppController` with no type safety and no
guaranteed field shape. Every caller must know the exact property names and
provide correct defaults (`corners: []`, `sketchRect: null`, etc.).

As the codebase moves toward DDD, typed entity classes provide:
- A single source of truth for each entity's field schema
- Guaranteed initialization (no missing fields)
- A hook point for Phase 2 behaviour methods (`extrude()`, `move()`, etc.)
- `instanceof`-based dispatch to replace `dimension === 2/3` checks

## Decision

Introduce typed domain entity classes (DDD Phase 1):

| File | Entity | `dimension` |
|------|--------|-------------|
| `src/domain/Cuboid.js` | `Cuboid` | always `3` |
| `src/domain/Sketch.js` | `Sketch` | `2` (promoted to `3` after extrusion) |

Both classes are mutable plain-property containers in Phase 1.
Behaviour methods are deferred to Phase 2.

`meshView` is retained on each entity for now; the view/model separation
that removes it belongs to Phase 4 (domain events / observer pattern).

`SceneModel`'s `SceneObject` typedef becomes the union `Cuboid | Sketch`.

## Consequences

- `AppController._addObject` uses `new Cuboid(id, name, corners, meshView)`.
- `AppController._addSketchObject` uses `new Sketch(id, name, meshView)`.
- `_confirmExtrudePhase` continues to mutate `obj.dimension`, `obj.corners`,
  and `obj.sketchRect` in-place (a Sketch transitions to cuboid shape without
  swapping the object reference). Phase 2 will replace this with an explicit
  `sketch.extrude(height)` method that returns a `Cuboid`.
- `instanceof Cuboid` / `instanceof Sketch` can replace `dimension === 2/3`
  checks when Phase 2 methods are introduced.

**Phase C addendum (BFF):** A third read-only entity type `ImportedMesh`
(`src/domain/ImportedMesh.js`) was introduced for server-computed geometry
that cannot be edited locally. The `SceneObject` union is now
`Cuboid | Sketch | ImportedMesh`. `ImportedMesh` is:
- **Thin-client** — no edit graph, no Vertex/Edge/Face graph. Only `rename()` is supported.
- **Auto-created** — `SceneService._applyGeometryUpdate()` calls
  `createImportedMesh()` when a `geometry.update` message arrives for an
  unknown `objectId`. No explicit `createImportedMesh()` call is required
  from the controller.
- **Guard pattern** — `setMode('edit')` and `_startGrab()` in AppController
  check `instanceof ImportedMesh` and early-return (see ADR-008 addendum).
