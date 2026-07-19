# Architecture

easy-extrude is a web-based 3D modeling app built on the MVC pattern and
incrementally refactored toward Domain-Driven Design (DDD). Since the
grasp-search backend was co-located (2026-07), the repository is a
**three-layer monorepo**: frontend → contract → backend.

> Maintenance note: this document describes structure at **directory
> granularity** and delegates per-file inventories to the layer READMEs
> (`src/*/README.md`, `core/README.md`, `server/src/*/README.md`). Keyword →
> "read first" lookup lives in `docs/NAVIGATION.md`; decision history lives in
> `docs/adr/README.md` (ADR-001 … ADR-080). Do not re-grow a per-file listing
> here — it drifts.

---

## Monorepo Layers

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Frontend** | `src/` (+ `schema/`, `examples/`, `cli/`) | Browser 3D editor; Layout/Context DSL public schemas, compilers, validators; deterministic core (`SynonymQuotient`, `CanonicalForm`) |
| **Contract** | `packages/grasp-contract` (in-repo neutral canonical source — absorbed from the former git submodule, ADR-082) | BFF ⇄ core-API I/O JSON Schema + `contractVersion` (ADR-074) |
| **Backend** | `server/` (BFF) + `core/` (Python judgement engine + FastAPI, uv-managed) | Constraint *solving*: candidate generation → reach/IK/collision filters → weighted scoring (ADR-075/076); propose-only recommendation lane (ADR-077); bin-picking scene layer (ADR-078) |

Invariants (see `CLAUDE.md` §スコープ境界 for the enforcement rules):

- `src/` never contains solvers (IK / collision / reach / grasp stability).
  The frontend *declares* predicate names in the DSL and *displays* results
  received over the contract. There is no `src/` → `core/` import path.
- **decide / propose verb boundary** (ADR-056/077): equivalence is *decided*
  by the frontend deterministic core; embeddings only *propose/rank* in
  `core/recommendation/` and never return a truth value.
- The contract is never edited in this repo — change it upstream and bump
  `contractVersion` (mismatch is rejected with 400 at the core API, ADR-074).

## Repository Layout

```
easy-extrude/
  src/               # Frontend (MVC + DDD; see per-directory READMEs)
  schema/            # Public JSON Schemas: layout-1.0, context-0.4, scene-1.3 (ADR-064)
  examples/          # Layout/Context DSL gallery seeds (factory, cell_* scenarios)
  templates/         # Hand-written complete DSL templates = backend acceptance
                     #   fixtures (consumed by core/tests/test_templates.py)
  cli/               # `pnpm layout` CLI: compile / import / interpret (ADR-045)
  server/            # BFF (Node/Express): scenes DB, STEP import, WS geometry,
                     #   grasp proxy → core API (ADR-015/017/074)
  core/              # Python judgement engine + FastAPI HTTP boundary
                     #   (engine / api / contract / recommendation / scene)
  packages/
    grasp-contract/  # Neutral I/O contract (@easy-extrude/grasp-contract, in-repo — ADR-082)
  wasm-engine/       # Rust → wasm geometry engine (ADR-027)
  robotics-wasm/     # C++ KDL + ruckig → wasm build lane (ADR-053 §11)
  e2e/               # Playwright smoke tests (ADR-064 Phase 4)
  docs/              # This file, NAVIGATION, ADRs, contracts, philosophy
```

### Frontend `src/` (directory granularity)

```
src/
  main.js       # Entry point: assembles MVC and calls start()
  domain/       # Pure entities: Solid, Profile, MeasureLine, CoordinateFrame,
                #   ImportedMesh, AnnotatedLine/Region/Point, SpatialLink,
                #   IFCClassRegistry, PlaceTypeRegistry
  graph/        # Geometry graph primitives: Vertex, Edge, Face (ADR-012)
  model/        # CuboidModel (pure geometry fns) + SceneModel (aggregate root)
  core/         # Dependency-free infra: EventEmitter, StateMachine,
                #   editorStates + states/ (operation FSM, ADR-039)
  command/      # Undo/redo command classes — one per operation (ADR-022);
                #   includes context-doc commands (ApproveDecision, DocEdit, …)
  service/      # Application services: SceneService, SceneSerializer (v1.3),
                #   Scene{Exporter,Importer}, CommandStack, BffClient,
                #   ContextService, RoboticsService, GeometryEngine, …
  layout/       # Layout DSL v1.0: schema consts, validator, compiler (ADR-045),
                #   decompiler = scene→DSL inverse up to normal form (ADR-055)
  context/      # Context DSL v0.4 pure layer: compiler/validator, DocBuilder,
                #   RequirementGraph, PredicateEngine, CanonicalForm,
                #   SynonymQuotient, intake/wizard/parametric catalogs
                #   (ADR-046/049/050/051/052/056/058/063)
  robotics/     # Pure robotics measurement: Kinematics (FK), Collision,
                #   ComputeBackend (ADR-053)
  engine/       # Committed wasm artifacts: wasm/ (Rust), robotics-wasm/ (C++)
  schema/       # Conformance tests binding DSLs to schema/*.schema.json
  view/         # Three.js + DOM views; paired `*Math.js` pure-computation
                #   modules with unit tests; MotionGovernor + stage/flight/
                #   celebration effects (ADR-065–068)
  components/   # React 19 UI (Context panels, Grasp panel, Outliner, Chrome,
                #   Feedback primitives, Onboarding tour, …)
  store/        # uiStore (zustand) — React-side UI state bridge
  theme/        # Design tokens + motion.js (single reduced-motion boundary)
  controller/   # AppController + ContextController, GraspController,
                #   MapModeController (map/), handler/, snap/, HitTestService,
                #   SelectionManager, UIStateManager
  types/        # Branded JSDoc coordinate types: WorldVector3 / LocalVector3
  utils/        # Small pure helpers
  workers/      # geometry.worker.js
```

---

## Layer Responsibilities (frontend MVC)

Per-layer contracts (permitted/prohibited tables, ownership rules) live in
`src/{domain,graph,model,core,service,view,controller}/README.md`. Summary:

| Layer | Responsibility |
|-------|---------------|
| **Domain** | Pure entities; no Three.js / DOM / I/O. Depends on nothing. |
| **Model** | `CuboidModel` pure geometry functions; `SceneModel` aggregate root holding `_objects` / `_links` / `_activeId` / mode state / `editSelection`. No Three.js. |
| **Service** | The permitted side-effect boundary: CRUD + factories, observable domain events (ADR-013), BFF I/O, world-pose cache, lock ownership. |
| **View** | Three.js + DOM side-effect sink. Pure companion `*Math.js` modules keep animation/layout math testable (pure/side-effect separation). |
| **Components + store** | React 19 panels (Context, Grasp, Outliner, Chrome) fed via `src/store/uiStore.js` (zustand); bridged from the controller — React never reaches into the Model directly. |
| **Controller** | Thin translation of input events into Model/Service calls and View updates; `setMode()` is the sole mode-transition entry point (ADR-008). Split by concern: App / Context / Grasp / MapMode + handler/, snap/. |

**Visual state ownership** (ADR-008 contract): every visual flag has exactly
one owner method — e.g. `hlMesh.visible` ← `setFaceHighlight()`,
`cuboid.visible`/`wireframe.visible` ← `setVisible()`, `boxHelper.visible` ←
`setObjectSelected()`. See `src/view/README.md`.

---

## Data Flow

```
User input
    |
    v
Controllers (AppController / ContextController / GraspController / MapModeController)
    |-- Update SceneModel via SceneService (addObject / setMode / …)
    |-- Call classic Views directly (meshView.updateGeometry / …)
    |-- Push React UI state into uiStore (components re-render from the store)
    |
    v
requestAnimationFrame loop (AppController.start())
    |-- SceneView.render()      → Three.js renders meshes
    |-- per-frame sync          → mounted annotations, link views, stage/motion ticks
    |-- GizmoView.update()      → redraws gizmo
```

Views are updated only by controllers (Views do not reference the Model).
Service → Controller communication is event-driven (`objectAdded`,
`objectRemoved`, `objectRenamed`, `activeChanged`, … — see `docs/EVENTS.md`).

Full-stack path for grasp search (ADR-054/074/076):

```
UI (GraspController) → Layout DSL → BFF /api/grasp-search → core API /grasp-search
                                   (contract schema, contractVersion guard)
```

---

## SceneObject Structure

The type (`instanceof`) determines available operations. There is no
`dimension` field (removed in ADR-012).

**Solid** (3D, ADR-020; data model redesigned in ADR-040):
```javascript
{
  id:           string,        // "obj_0_1234567890"
  name:         string,        // "Cube", "Cube.001"
  description:  string,
  ifcClass:     string|null,   // IFC4 class (ADR-025); drives label + tint (ADR-070)
  // ADR-040 primary triple — world corners are derived:
  _position:    Vector3,       // body-frame origin (world)
  orientation:  Quaternion,    // body rotation (ADR-036/040)
  localCorners: LocalVector3[8],
  vertices:     Vertex[8],     // world corners, kept in sync (_rebuildWorldCorners)
  faces:        Face[6],       // ADR-012
  edges:        Edge[12],      // ADR-012
  meshView:     MeshView,
}
```

**Profile** (2D, unextruded, ADR-020):
```javascript
{
  id:       string,
  name:     string,           // "Sketch.001"
  vertices: Vertex[4],        // LocalGeometry graph (ADR-021)
  edges:    Edge[4],
  meshView: MeshView,
}
```

**MeasureLine** (1D annotation):
```javascript
{
  id:       string,
  name:     string,
  vertices: Vertex[2],        // [start, end]
  edges:    Edge[1],
  meshView: MeasureLineView,
}
```

**CoordinateFrame** (Pose Graph node, ADR-018/019/033/034/037):
```javascript
{
  id:          string,
  name:        string,
  parentId:    string,        // parent object/frame id; may be a Solid id
  translation: Vector3,       // local translation relative to parent
  rotation:    Quaternion,    // local rotation relative to parent (ROS RPY convention)
  localOffset: LocalVector3[],// SE(3) handle points in local space (ADR-033)
  meshView:    CoordinateFrameView,
}
```
World pose is derived by `SceneService._worldPoseCache` (topological sort),
never stored on the entity. ADR-033 abolished auto-Origin frames; **ADR-037
(body frame architecture) reinstated them** — `createSolid()` now creates a
body `Origin` frame, matching the ROS/URDF link-frame model.

**ImportedMesh** (thin client, read-only): `{ id, name, meshView }` —
geometry streamed from the server via WebSocket; no local graph.

**AnnotatedLine / AnnotatedRegion / AnnotatedPoint** (2D map annotations,
ADR-029): LocalGeometry entities with a `placeType`
(Route/Boundary/Zone/Hub/Anchor via `PlaceTypeRegistry`); created in Map Mode
(ADR-031/072/073), undoable via `AddAnnotationCommand`.

**SpatialLink** (typed semantic edge, ADR-030; two-axis since ADR-038/043):
```javascript
{
  id:           string,
  sourceId:     string,
  targetId:     string,
  jointType:    string|null,  // URDF-style kinematic axis: "fixed" | "revolute" | … (ADR-038)
  semanticType: string,       // domain meaning: "mounts" | "fastened" | "aligned" |
                              // "adjacent" | "above" | "contains" | "connects" |
                              // "bounded_by" | "references" | "represents"
  properties:   object,
}
```
The old single `linkType` field (scene ≤ v1.2) is migrated by
`migrateLinkType()`. `SpatialLink` is not a `SceneObject` — it lives in
`SceneModel._links` (with `_mountsIndex` / `_mountedByIndex` for O(1) lookup),
serializes as `scene.links[]`, and renders per-frame via
`SceneService._linkViews`.

`Profile.extrude(height)` does not mutate the Profile; it returns a new
`Solid`. `SceneService.extrudeSketch(id, height)` swaps the entities and emits
the lifecycle events (delete → add).

---

## Coordinate System

**ROS world frame (+X forward, +Y left, +Z up)**. Right-handed. Three.js
`camera.up = (0,0,1)`. XY plane (Z=0) is the ground plane.

```
      6─────7
     /|    /|    +Z up
    5─────4 |    +Y left
    | 2───|─3    +X front
    |/    |/
    1─────0
```

Coordinate spaces are statically distinguished by branded JSDoc types
(`WorldVector3` / `LocalVector3`, `src/types/spatial.js`) enforced by
`pnpm typecheck` (ADR-021 Phase 3).

---

## Domain Model — Entity Taxonomy (ADR-020/021)

Entities fall into two graphs: **Boundary Graph** (local geometry) and
**Pose Graph** (spatial relationships). Type (`instanceof`) determines
behaviour.

### Boundary Graph — LocalGeometry interface (ADR-021)

All local-geometry entities share `vertices[]`, `edges[]`, `faces[]` and
`corners` / `move()`:

| Dimension | Entity | Creating verb | vertices | edges | faces |
|-----------|--------|---------------|----------|-------|-------|
| 0D | `Vertex` | — | — | — | — |
| 1D | `MeasureLine` | **Measure** (M key) | 2 | 1 | 0 |
| 2D | `Profile` | **Sketch**: draw a rectangle | 4 | 4 | 0 |
| 2D | `AnnotatedLine` | **Map Mode**: route/boundary drag or multi-click | n≥2 | n-1 | 0 |
| 2D | `AnnotatedRegion` | **Map Mode**: zone drag rectangle | n≥3 | n | 0 |
| 2D | `AnnotatedPoint` | **Map Mode**: hub/anchor click | 1 | 0 | 0 |
| 3D | `Solid` | **Extrude**: `Profile.extrude(h)` → new Solid | 8 | 12 | 6 |

Verbs do not mutate entities; they **return a new entity of higher
dimension**. `SceneService` deletes the old entity and registers the new one
under the same ID.

### Pose Graph — CoordinateFrame (ADR-018/019/033/037)

`CoordinateFrame` is a named SE(3) node in a kinematic tree (not a
LocalGeometry entity). `parentId` links form the tree; depth-first topological
sort propagates poses in one pass; world pose is cached in
`SceneService._worldPoseCache`. Body frames (ADR-037) make the CF the primary
entity with visual geometry attached — the ROS/URDF link model. Fastened
chains propagate through CF links with cycle detection (ADR-035).

### Semantic edges — SpatialLink (ADR-030/038/043)

Directed, typed edge between any two scene entities, carrying an optional
kinematic `jointType` (URDF taxonomy, ADR-038) and a mandatory
`semanticType` (geometric / topological / semantic categories — see struct
above). Mounting (`mounts`) positions an annotation relative to a
`CoordinateFrame` host, updated per frame (ADR-032).

### Proxy entity — ImportedMesh

Thin-client placeholder for server-evaluated geometry (STEP import);
geometry lives on the server and streams via WebSocket (ADR-017/027).

---

## DSL / Contract Surface (wire rigor — PHILOSOPHY #29)

All wires are either **contracted** (closed, versioned JSON Schema) or
**explicitly declared uncontracted** (ADR-064 Phase 3):

| Wire | Contract | Where |
|------|----------|-------|
| Layout DSL v1.0 | `schema/layout-1.0.schema.json` | authored / LLM-generated; compiled by `src/layout/LayoutCompiler.js` (ADR-045); inverse `LayoutDecompiler.js` round-trips scene → DSL up to normal form (ADR-055) |
| Context DSL v0.4 | `schema/context-0.4.schema.json` | requirement context: Facts / Decisions / OpenQuestions / KPIs / regions / robotics predicates (ADR-046/049/053); compiles to Layout DSL |
| Scene JSON v1.3 | `schema/scene-1.3.schema.json` | `SceneSerializer` round-trip; validated at BFF `/api/scenes` (ADR-064 Phase 3) |
| BFF ⇄ core API | `packages/grasp-contract` (in-repo, ADR-082) | grasp search request/response + diagnostics; `contractVersion` guarded (ADR-074/079) |
| ws geometry / import | declared uncontracted | declarations at `server/src/ws/sessionManager.js` / `server/src/routes/import.js` |

Semantic validation stays in `src/layout/LayoutValidator.js` /
`src/context/ContextValidator.js`; the JSON Schemas bind *shape* only.

### Layout API (ADR-045)

External CLI and REST API for generating scenes without a browser session:

```
NL text (optional, --ai)
    │  Claude API → Layout DSL   (LLM generates DSL, never code — ADR-044)
    ▼
Layout DSL v1.0 JSON             ← encodes 5W1H (ADR-044/052)
    │  compileLayout()           (pure, src/layout/LayoutCompiler.js)
    ▼
Scene v1.3 JSON                  ← SceneImporter-compatible
    │  importFromJson()
    ▼
SceneService domain state        ← Solid / CoordinateFrame / SpatialLink
```

Endpoints: `POST /api/layout/compile`, `POST /api/layout/scenes`; CLI:
`pnpm layout compile|import|interpret` (`--ai` bridges Claude API → DSL).
Ref namespace for constraints: `"<ref>"` (entity), `"<ref>_origin"`
(auto body frame, ADR-037), `"<frame.ref>"` (user-defined child CF).

---

## History

The DDD migration (Phases 0–22, 2026-03 → 2026-06: state container →
entities → services → events → graph model → undo/redo → mobile → IFC → map
annotations → wasm → spatial links → layout API) is recorded in the ADR index
— the phase-by-phase table formerly kept here duplicated it and is retired.
Canonical history: `git log` + `docs/adr/README.md`. Highlights since:
Context DSL and requirement negotiation (ADR-046…052), robotics KPI methods
(ADR-053), grasp search UI + backend co-location (ADR-054…061, 074…079),
rigor retrofit / CI gates / schema promotion (ADR-064), motion & playfulness
program (ADR-065…068, 080), UX parity pass (ADR-069…073).

---

## Related Documents

- `docs/NAVIGATION.md` — keyword → "read first" index (+ design-change impact table)
- `docs/adr/README.md` — ADR index (ADR-001 … ADR-080; searchable via `/adr <topic>`)
- `docs/STATE_TRANSITIONS.md` — mode FSM, operation state machine (ADR-039), component lifecycles
- `docs/SCREEN_DESIGN.md` / `docs/LAYOUT_DESIGN.md` — information architecture / UI layout
- `docs/EVENTS.md` — domain events, keyboard/pointer events
- `docs/CONCURRENCY.md` — optimistic vs pessimistic locking strategy
- `docs/CODE_CONTRACTS.md` — coding rules derived from real bugs (index + detail files)
- `docs/PHILOSOPHY.md` — design principles (digest: `.claude/rules/10-principles.md`)
- `core/README.md` / `server/src/*/README.md` — backend layer documentation
