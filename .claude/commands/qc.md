# QC Validator — Code Quality & Standards Compliance

Perform a QC review on the files specified in `$ARGUMENTS`, or on all recently changed source files if no argument is given.

## Steps

### 1. Identify target files

- If `$ARGUMENTS` is provided, review those files.
- Otherwise, run `git diff --name-only HEAD~1 HEAD` (fallback: `git status --short`) and review modified `.js` files under `src/` and `server/src/`.

### 2. Read reference documents

Read these before evaluating:
- `docs/ARCHITECTURE.md` — layer responsibilities and ownership contracts
- `docs/CODE_CONTRACTS.md` — accumulated rules from real bugs

### 3. Read each target file in full

### 4. Evaluate against the QC checklist

#### A. Layer Responsibility (ARCHITECTURE.md §Layer Responsibilities)

- [ ] `CuboidModel.js` contains **only pure functions** — no `this`, no side effects, no Three.js imports.
- [ ] `SceneModel.js` holds state only — no DOM access, no Three.js scene manipulation.
- [ ] `SceneService.js` is the sole entry point for entity creation, CRUD, and `extrudeSketch`. Controllers do not create entities directly.
- [ ] View classes (`MeshView`, `UIView`, `SceneView`, etc.) do not mutate domain state directly.
- [ ] `AppController` handles input and view coordination only — no domain logic.

#### B. Import Conventions

- [ ] Three.js addons imported from `three/addons/...` (not `three/examples/...`).
- [ ] No circular imports between `domain/`, `model/`, `service/`, `view/`, `controller/`.
- [ ] `server/` code does not import from `src/` (browser-side code).

#### C. Naming Conventions

- [ ] Files: `PascalCase.js` for classes, `camelCase.js` for utilities.
- [ ] Private class members prefixed with `_`.
- [ ] Event names: `camelCase` strings (`objectAdded`, `objectRenamed`, etc.).
- [ ] ADR files: `ADR-NNN-kebab-case-title.md`.

#### D. DDD / Entity Contracts (CODE_CONTRACTS §1, ADR-009–012)

- [ ] Type dispatch uses `instanceof Sketch` / `instanceof Cuboid` — not a `dimension` property.
- [ ] `Sketch.extrude()` returns a new `Cuboid` and does not mutate `Sketch` itself.
- [ ] `SceneService.extrudeSketch()` is used for the entity swap (not direct `_objects` mutation).
- [ ] `Cuboid` always exposes: `faces: Face[6]`, `edges: Edge[12]`, `move()`, `extrudeFace()`.
- [ ] `ImportedMesh` has no `corners` / vertex graph; code that iterates selected objects and accesses `.corners` guards with `selObj.corners` or `instanceof ImportedMesh`.
- [ ] `MeasureLine` holds `p1`/`p2` (`THREE.Vector3`) + `MeasureLineView`. It has no vertex/edge/face graph and must be excluded from `collectSnapTargets` and `_hitAnyObject` raycasting.
- [ ] Edit Mode and Grab are blocked for both `ImportedMesh` and `MeasureLine`; blocks emit a toast before returning.
- [ ] Every method called via `_meshView` in `AppController` exists as a no-op on `MeasureLineView` (see CODE_CONTRACTS §1 — MeasureLineView No-Op Interface Completeness for the full required list).

#### E. Event / Observable Contracts (ADR-013)

- [ ] `SceneService` emits domain events (`objectAdded`, `objectRemoved`, `objectRenamed`, `activeChanged`) for every state change that views need to react to.
- [ ] Views subscribe via `SceneService.on(event, handler)` — not via direct polling or controller callbacks.

#### F. Visual State Ownership (CODE_CONTRACTS §1)

- [ ] `hlMesh.visible` set only inside `setFaceHighlight()`.
- [ ] `cuboid.visible` / `wireframe.visible` set only inside `setVisible()`.
- [ ] `boxHelper.visible` set only inside `setObjectSelected()`.

#### G. Mode Transition Contract (ADR-008, CODE_CONTRACTS §1)

- [ ] All mode changes go through `AppController.setMode(mode)`.
- [ ] When switching active objects from Edit Mode, `setMode('object')` is called first.

#### H. Mobile Toolbar Slots (CODE_CONTRACTS §3)

- [ ] Every mode exposes exactly **4 slots** (matching the widest mode, Edit 3D).

| Mode | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
|------|--------|--------|--------|--------|
| Object | Add | Edit | Delete | Stack |
| Edit 2D sketch | ← Object | Extrude | *(spacer)* | *(spacer)* |
| Edit 2D extrude | Confirm | Cancel | *(spacer)* | *(spacer)* |
| Edit 3D | ← Object | Vertex | Edge | Face |
| Grab active | Confirm | Stack | Cancel | *(spacer)* |

- [ ] Slots that are absent for a given mode use `{ spacer: true }` (not conditional rendering), so toolbar width never changes.
- [ ] Grab, Edit are disabled for `ImportedMesh` and `MeasureLine`. Delete remains enabled for all types.

#### I. Vite / Build Config

- [ ] `vite.config.js` `base` is `/easy-extrude/` — not changed to `/` or any other path.

#### J. Documentation

- [ ] New non-obvious design decisions have an ADR or reference an existing one.
- [ ] `docs/adr/README.md` index is updated when a new ADR file is added.
- [ ] `CLAUDE.md` navigation table references new docs if added.

### 5. Report findings

For each issue:

```
[CATEGORY] File:line — Description
  Rule violated: <checklist item letter>
  Suggested fix: <one-line suggestion>
```

Categories: **LAYER** · **IMPORT** · **NAMING** · **DDD** · **EVENT** · **VISUAL** · **MODE** · **BUILD** · **DOCS**

If no issues are found, output: `✓ QC: no issues found in <file list>`.

### 6. Summary

```
QC result: N issues across X files. Categories: <list of categories with counts>.
```
