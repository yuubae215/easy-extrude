# QC Validator — Code Quality & Standards Compliance

Perform a QC review on the files specified in `$ARGUMENTS`, or on all recently changed source files if no argument is given.

## Steps

### 1. Identify target files

- If `$ARGUMENTS` is provided, review those files.
- Otherwise, run `git diff --name-only HEAD~1 HEAD` (fallback: `git status --short`) and review modified `.js` files under `src/` and `server/src/`.

### 2. Read reference documents

Read these before evaluating:
- `docs/ARCHITECTURE.md` — layer responsibilities and ownership contracts
- `.claude/MENTAL_MODEL.md` — accumulated rules from real bugs

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

#### D. DDD / Entity Contracts (MENTAL_MODEL §1, ADR-009–012)

- [ ] Type dispatch uses `instanceof Sketch` / `instanceof Cuboid` — not a `dimension` property.
- [ ] `Sketch.extrude()` returns a new `Cuboid` and does not mutate `Sketch` itself.
- [ ] `SceneService.extrudeSketch()` is used for the entity swap (not direct `_objects` mutation).
- [ ] `Cuboid` always exposes: `faces: Face[6]`, `edges: Edge[12]`, `move()`, `extrudeFace()`.

#### E. Event / Observable Contracts (ADR-013)

- [ ] `SceneService` emits domain events (`objectAdded`, `objectRemoved`, `objectRenamed`, `activeChanged`) for every state change that views need to react to.
- [ ] Views subscribe via `SceneService.on(event, handler)` — not via direct polling or controller callbacks.

#### F. Visual State Ownership (MENTAL_MODEL §1)

- [ ] `hlMesh.visible` set only inside `setFaceHighlight()`.
- [ ] `cuboid.visible` / `wireframe.visible` set only inside `setVisible()`.
- [ ] `boxHelper.visible` set only inside `setObjectSelected()`.

#### G. Mode Transition Contract (ADR-008, MENTAL_MODEL §1)

- [ ] All mode changes go through `AppController.setMode(mode)`.
- [ ] When switching active objects from Edit Mode, `setMode('object')` is called first.

#### H. Vite / Build Config

- [ ] `vite.config.js` `base` is `/easy-extrude/` — not changed to `/` or any other path.

#### I. Documentation

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
