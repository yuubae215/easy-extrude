# ADR-010 — Domain Entity Behaviour Methods (DDD Phase 2)

**Status:** Accepted
**Date:** 2026-03-20
**References:** ADR-009, docs/ARCHITECTURE.md

---

## Context

After Phase 1, `Cuboid` and `Sketch` are typed containers but own no behaviour.
Business logic that belongs to the domain — how to extrude, move, or rename an
entity — lives in `AppController`, scattered across event handlers and helper
methods.

This makes `AppController` harder to reason about and prevents the entities from
being tested in isolation.

## Decision

Move domain-level mutation logic from `AppController` into the entities (DDD Phase 2):

| Method | Entity | Replaces |
|--------|--------|---------|
| `rename(name)` | `Cuboid`, `Sketch` | `SceneModel.renameObject` inline mutation |
| `move(startCorners, delta)` | `Cuboid` | `startCorners.forEach(...)` in grab / drag handlers |
| `extrudeFace(fi, savedFaceCorners, normal, dist)` | `Cuboid` | inline loop in `_onMouseMove` face-drag branch |
| `extrude(height)` | `Sketch` | direct mutations in `_confirmExtrudePhase` |

`AppController` calls these methods instead of mutating entity fields directly.
It retains ownership of: interaction state, raycasting, view updates, and
Three.js math (delta computation, projection).

`Sketch.extrude(height)`:
- Requires `sketchRect` to already be set.
- Mutates the Sketch in-place: `corners`, `dimension` (promoted to 3).
- Returns the new `corners` array so the caller can pass it to `meshView.updateGeometry`.
- Phase 3 (aggregate root) will evaluate whether to swap the Sketch for a Cuboid instance.

## Consequences

- Domain entities now import from `src/model/CuboidModel.js` (`FACES`,
  `buildCuboidFromRect`) — this is the intended direction; `CuboidModel.js`
  is a pure-function library, not a layer boundary.
- `AppController._confirmExtrudePhase` no longer directly assigns `obj.corners`,
  `obj.dimension`, or `obj.sketchRect`.
- `SceneModel.renameObject` is retained for backward compatibility; it will be
  removed or delegated in Phase 3.
- `instanceof Cuboid` / `instanceof Sketch` dispatch (noted in ADR-009) is not
  yet needed; method dispatch is uniform across both types where applicable.
