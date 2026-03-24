# ADR Validator — Architecture Decision Record Compliance

Validate that recently changed code (or the files in `$ARGUMENTS`) complies with the project's accepted ADRs.

## Steps

### 1. Identify target files

- If `$ARGUMENTS` is provided, review those files.
- Otherwise, run `git diff --name-only HEAD~1 HEAD` (fallback: `git status --short`) and collect modified `.js` files under `src/` and `server/src/`.

### 2. Load the ADR index

Read `docs/adr/README.md` and note all **Accepted** ADRs.
Skip ADRs with status `Rejected` or `Superseded`.

### 3. Select relevant ADRs

For each target file, match it against the table below to determine which ADRs govern it.
Only load the full text of relevant ADRs (to avoid unnecessary reads).

| File pattern | Relevant ADRs |
|---|---|
| `src/controller/AppController.js` | ADR-008, ADR-006, ADR-003 |
| `src/domain/Cuboid.js`, `src/domain/Sketch.js` | ADR-009, ADR-010, ADR-012 |
| `src/domain/ImportedMesh.js` | ADR-009, ADR-015 (read-only, no vertex graph) |
| `src/domain/MeasureLine.js` | ADR-009, ADR-014 (not editable, no graph) |
| `src/graph/Vertex.js`, `Edge.js`, `Face.js` | ADR-012 |
| `src/model/SceneModel.js` | ADR-005, ADR-008, ADR-014 |
| `src/service/SceneService.js` | ADR-011, ADR-013, ADR-015 |
| `src/view/MeshView.js` | ADR-008 (visual state ownership) |
| `src/view/ImportedMeshView.js` | ADR-008, ADR-015 |
| `src/view/MeasureLineView.js` | ADR-008 (no-op interface completeness) |
| `src/view/UIView.js` | ADR-002, ADR-004 |
| `server/` | ADR-015, ADR-016, ADR-017 |
| Any new modeling/geometry code | ADR-007 (cuboid representation, not voxel) |
| Any mode/state transition code | ADR-008 |
| Any orbit/mouse control change | ADR-006 (right-click = cancel) |

Read each relevant ADR file from `docs/adr/`.

### 4. Check compliance per ADR

For each relevant ADR, verify the changed code follows its **Decision** and **Consequences** sections.

Key contracts to enforce:

**ADR-007** — Shape Representation is Cuboid-based (not voxel).
- No integer-snap grid, no voxel coordinates. Shapes are axis-aligned cuboids with float corners.

**ADR-008** — Mode Transition State Machine.
- All mode changes via `AppController.setMode()`. No direct `_selectionMode` mutation outside `setMode`.
- `setMode('object')` called before any active-object swap when in edit mode.

**ADR-009 / ADR-010** — Entity types and behaviour.
- `Sketch` and `Cuboid` are the only entity classes. No plain objects used as scene entities.
- Behaviour methods (`move`, `extrudeFace`, `extrude`, `rename`) live on entities — not in the controller.

**ADR-011** — ApplicationService layer.
- `SceneService` is the sole entry point for entity lifecycle operations.
- Controllers must not call `SceneModel` directly for entity creation / deletion.

**ADR-012** — Graph-based geometry (`Vertex`, `Edge`, `Face`).
- `Cuboid` has `vertices: Vertex[]`, `edges: Edge[12]`, `faces: Face[6]`.
- `get corners()` on `Cuboid` / `Sketch` provides backward-compat access.
- `extrudeFace` takes a `Face` object, not a numeric index.

**ADR-013** — Domain Events / Observable.
- `SceneService` emits events for all state changes. Views must not be updated by direct controller calls after a domain event is defined.

**ADR-014** — Edit Mode Sub-Element Selection.
- `SceneModel.editSelection` is a `Set<Vertex|Edge|Face>`.
- Edit select mode is one of `'vertex'`, `'edge'`, `'face'`.

**ADR-015** — BFF Architecture.
- Frontend (`src/`) contains only View + Controller + domain model.
- Geometry computation and STEP import live in `server/`.
- Communication via REST (`/api`) and WebSocket (`/api/ws`).

**ADR-016** — Transform Graph.
- Spatial relationships between objects are stored as SE(3) transforms (position + quaternion).
- No Euler angles in the graph layer.

**ADR-017** — WebSocket Session Design.
- WebSocket path: `/api/ws`. One session per connection. `SessionManager` handles lifecycle.

### 5. Report findings

For each violation:

```
[ADR-NNN] File:line — Description of the violation
  ADR rule: <quoted snippet from the ADR decision>
  Suggested fix: <one-line suggestion>
```

If no violations are found, output: `✓ ADR-validate: all checked ADRs satisfied in <file list>`.

### 6. Flag gaps (optional but encouraged)

If the diff introduces a non-obvious design choice that is **not** covered by any existing ADR, output:

```
[GAP] File:line — <describe the uncovered decision>
  Suggestion: consider creating ADR-NNN for this.
```

### 7. Summary

```
ADR-validate result: N violations, G gaps across X files.
ADRs checked: ADR-NNN, ADR-NNN, ...
```
