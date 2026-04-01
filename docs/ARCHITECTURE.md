# Architecture

easy-extrude is a web-based 3D modeling app built on the MVC pattern,
incrementally refactored toward Domain-Driven Design (DDD).

---

## Overview

```
src/
  main.js                         # Entry point: assembles MVC and calls start()
  domain/
    Solid.js                      # Domain entity: 3D deformable solid (ADR-020)
    Profile.js                    # Domain entity: 2D cross-section profile (ADR-020)
    MeasureLine.js                # Domain entity: 1D distance annotation
    CoordinateFrame.js            # Domain entity: named SE(3) reference frame (ADR-018/019)
    ImportedMesh.js               # Domain entity: read-only server-computed geometry
    IFCClassRegistry.js           # IFC semantic class registry (ADR-025)
  graph/
    Vertex.js                     # Graph primitive: vertex { id, position: Vector3 }
    Edge.js                       # Graph primitive: edge { id, v0: Vertex, v1: Vertex }
    Face.js                       # Graph primitive: face { id, vertices: Vertex[4], name, index }
  model/
    CuboidModel.js                # Pure functions: geometry computation (stateless)
    SceneModel.js                 # Aggregate root: scene objects + mode state + editSelection
  command/
    MoveCommand.js                # Undo/redo: object move (Grab, Face Extrude) (ADR-022)
    AddSolidCommand.js            # Undo/redo: add solid (ADR-022)
    DeleteCommand.js              # Undo/redo: soft-delete (ADR-022)
    ExtrudeSketchCommand.js       # Undo/redo: Profile → Solid entity swap (ADR-022)
    RenameCommand.js              # Undo/redo: rename (ADR-022)
    FrameRotateCommand.js         # Undo/redo: CoordinateFrame rotation (ADR-022)
    SetIfcClassCommand.js         # Undo/redo: IFC class assignment (ADR-025)
  service/
    SceneService.js               # ApplicationService: entity creation, CRUD, observable events
    SceneSerializer.js            # Scene save / load: domain → JSON round-trip (BFF)
    SceneExporter.js              # Export scene to JSON file (pure computation)
    SceneImporter.js              # Import scene from JSON file (pure computation)
    CommandStack.js               # Undo/redo stack (MAX=50) (ADR-022)
    BffClient.js                  # REST + WebSocket client for BFF (WsChannel)
  view/
    SceneView.js                  # Three.js scene / camera / renderer
    MeshView.js                   # Per-object mesh and visual state
    CoordinateFrameView.js        # Axis arrows + origin sphere; depth rendering; rotation
    ImportedMeshView.js           # Triangle mesh (BufferGeometry); updateGeometryBuffers()
    MeasureLineView.js            # Dashed line + distance label; no-op MeshView interface
    NodeEditorView.js             # SVG DAG panel; draggable nodes; STEP import trigger
    UIView.js                     # DOM UI (header / N panel / status bar / mobile toolbar)
    GizmoView.js                  # World-axis gizmo (top-right)
    OutlinerView.js               # Scene hierarchy sidebar; multi-level indentation
  controller/
    AppController.js              # Input handling + view coordination
```

---

## Layer Responsibilities

### Model

| Module | Responsibility |
|--------|---------------|
| `CuboidModel.js` | Pure functions only. No side effects. Geometry construction, normal computation, coordinate transforms. |
| `SceneModel.js` | Holds domain state: `_objects` / `_activeId` / `_selectionMode` / `_editSubstate` / `_editSelection` |

`SceneModel` is a pure state container with no dependency on Three.js.

### View

| Module | Responsibility |
|--------|---------------|
| `SceneView` | Three.js initialisation (renderer / camera / OrbitControls / grid / lighting); `fitCameraToSphere()` |
| `MeshView` | 1 Solid/Profile = 1 MeshView. Owns mesh / wireframe / highlight / snap display |
| `CoordinateFrameView` | Axis arrows + origin sphere. Depth override (X-ray) when selected. `updateRotation(q)` |
| `ImportedMeshView` | Thin-client triangle mesh. `updateGeometryBuffers(pos, nrm, idx)`. No edit geometry |
| `MeasureLineView` | Dashed amber line + HTML distance label. Implements no-op MeshView interface |
| `NodeEditorView` | SVG DAG panel. Draggable nodes, param editor, STEP import trigger, unit dialog |
| `UIView` | Blender-style DOM UI. `setStatusRich()` / `updateNPanel()` / `showAddMenu()` / `enableSaveLoad()` |
| `GizmoView` | Draws axis gizmo on a small canvas (top-right). Click to snap camera. |
| `OutlinerView` | Left sidebar. Multi-level indentation for nested frames. Visibility toggle, delete, rename. |

**Visual state ownership** (ADR-008 contract):

| Element | Owner |
|---------|-------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

### Controller

`AppController` responsibilities:

- Bind and dispatch DOM events (`_bindEvents`)
- Hold interaction state (drag, hover, grab, sketch phase, etc.)
- Read/write `SceneModel` domain state
- Call Views to update rendering
- Animation loop (`start()`)
- `setMode()` — sole entry point for mode transitions (ADR-008)

---

## Data Flow

```
User input
    |
    v
AppController (_onMouseDown / _onKeyDown etc.)
    |-- Update SceneModel (addObject / setMode / setActiveId etc.)
    |-- Call Views directly (meshView.updateGeometry / uiView.setStatus etc.)
    |
    v
requestAnimationFrame loop
    |-- SceneView.render()  → Three.js renders meshes
    |-- GizmoView.update()  → Redraws gizmo
```

Views are updated only by the controller (Views do not reference the Model directly).

---

## SceneObject Structure

The type (`instanceof`) determines available operations. There is no `dimension` field (removed in ADR-012).

**Solid** (3D, ADR-020):
```javascript
{
  id:       string,       // "obj_0_1234567890"
  name:     string,       // "Cube", "Cube.001"
  vertices: Vertex[8],    // LocalGeometry graph; get corners() → Vector3[]
  faces:    Face[6],      // ADR-012
  edges:    Edge[12],     // ADR-012
  meshView: MeshView,
}
```

**Profile** (2D, unextruded, ADR-020):
```javascript
{
  id:       string,       // "obj_0_1234567890"
  name:     string,       // "Sketch.001"
  vertices: Vertex[4],    // LocalGeometry graph (ADR-021)
  edges:    Edge[4],      // LocalGeometry graph (ADR-021)
  meshView: MeshView,
}
```

**MeasureLine** (1D annotation):
```javascript
{
  id:       string,
  name:     string,
  vertices: Vertex[2],    // [start, end]; LocalGeometry graph (ADR-021)
  edges:    Edge[1],
  meshView: MeasureLineView,
}
```

**CoordinateFrame** (Pose Graph node, ADR-018/019/020):
```javascript
{
  id:          string,
  name:        string,    // "Origin" (auto) or "Frame.001" (manual)
  parentId:    string,    // parent object/frame id
  translation: Vector3,   // local translation relative to parent
  rotation:    Quaternion,// local rotation relative to parent (ROS RPY convention)
  meshView:    CoordinateFrameView,
}
```
World pose is derived by `SceneService._worldPoseCache` (topological sort), not stored on the entity.

**ImportedMesh** (thin client, read-only):
```javascript
{
  id:      string,
  name:    string,
  meshView: ImportedMeshView, // geometry streamed from server via WebSocket
}
```

`Profile.extrude(height)` does not mutate the Profile; it returns a new `Solid`.
`SceneService.extrudeSketch(id, height)` replaces the Profile with the Solid in the scene.

---

## Coordinate System

**ROS world frame (+X forward, +Y left, +Z up)**. Right-handed. Three.js `camera.up = (0,0,1)`.
XY plane (Z=0) is the ground plane.

```
      6─────7
     /|    /|    +Z up
    5─────4 |    +Y left
    | 2───|─3    +X front
    |/    |/
    1─────0
```

---

## Domain Model — Entity Taxonomy (ADR-020/021)

Entities fall into two graphs: **Boundary Graph** (local geometry) and **Pose Graph** (spatial relationships).
Type (`instanceof`) determines behaviour; there is no `dimension` field.

### Boundary Graph — LocalGeometry interface (ADR-021)

All local-geometry entities share `vertices[]`, `edges[]`, `faces[]` and `corners` / `move()`:

| Dimension | Entity | Creating verb | vertices | edges | faces |
|-----------|--------|---------------|----------|-------|-------|
| 0D | `Vertex` | — | — | — | — |
| 1D | `MeasureLine` | **Measure** (M key) | 2 | 1 | 0 |
| 2D | `Profile` | **Sketch**: draw a rectangle | 4 | 4 | 0 |
| 3D | `Solid` | **Extrude**: `Profile.extrude(h)` → new Solid | 8 | 12 | 6 |

Verbs do not mutate entities; they **return a new entity of higher dimension**.
`SceneService` deletes the old entity and registers the new one under the same ID.

### Pose Graph — CoordinateFrame (ADR-018/019/020)

`CoordinateFrame` is a named SE(3) node in a kinematic tree (not a LocalGeometry entity).
- `parentId` links form the tree; depth-first topological sort propagates poses in one pass.
- World pose is cached in `SceneService._worldPoseCache` — never stored on the entity.
- Named frames on a geometry enable assembly-mate-style positioning (future: `matchedFrameId`).

### Proxy entity — ImportedMesh

`ImportedMesh` is a thin-client placeholder for server-evaluated geometry.
It has no local vertex/edge/face graph; geometry lives on the server and is streamed via WebSocket.

### Graph-based model (ADR-012)

```
Vertex  = { id, position: Vector3 }
Edge    = { id, v0: Vertex, v1: Vertex }
Face    = { id, vertices: Vertex[4], name, index }
Solid   = { vertices: Vertex[8], faces: Face[6], edges: Edge[12], ... }
Profile = { vertices: Vertex[4], edges: Edge[4], ... }
MeasureLine = { vertices: Vertex[2], edges: Edge[1], ... }
```

`SceneModel.editSelection: Set<Vertex|Edge|Face>` holds the unified selection set.

---

## DDD Migration Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 0** | SceneModel as state container. AppController holds business logic. | Done 2026-03-20 |
| **Phase 1** | New `Cuboid` / `Sketch` domain entities (ADR-009) | Done 2026-03-20 |
| **Phase 2** | Domain entities own behaviour methods (ADR-010) | Done 2026-03-20 |
| **Phase 3** | New `SceneService` (ApplicationService) (ADR-011) | Done 2026-03-20 |
| **Phase 4** | Domain events — `SceneService` becomes Observable (ADR-013) | Done 2026-03-20 |
| **Phase 5-1** | Added `Vertex` layer. `Cuboid.vertices: Vertex[8]` (ADR-012) | Done 2026-03-20 |
| **Phase 5-2** | Status bar migrated to event-driven updates | Done 2026-03-20 |
| **Phase 5-3** | `Edge` / `Face` layer, `dimension` removed, unified selection model foundation (ADR-012) | Done 2026-03-20 |
| **Phase 6** | Sub-element selection (1/2/3 keys), Grab snap across all geometry (ADR-014) | Done 2026-03-20 |
| **Phase 7** | Entity taxonomy redesign — `Cuboid`→`Solid`, `Sketch`→`Profile`; unified LocalGeometry interface for `MeasureLine`/`Profile`; `CoordinateFrame._worldPos` moved to `SceneService._worldPoseCache`; Euler convention corrected to ROS RPY (ADR-020, ADR-021) | Done 2026-03-26 |
| **Phase 8** | Undo / Redo via Command Pattern — `CommandStack`, `MoveCommand`, `AddSolidCommand`, `DeleteCommand` (soft-delete), `ExtrudeSketchCommand`, `RenameCommand`, `FrameRotateCommand` (ADR-022) | Done 2026-03-27 |
| **Phase 9** | Mobile UX — touch gesture model (single-finger orbit, long-press Grab), mobile toolbar fixed-slot layout, `_moreMenuBtn` header overflow fix (ADR-023, ADR-024) | Done 2026-03-29 |
| **Phase 10** | IFC semantic classification — `IFCClassRegistry`, `SetIfcClassCommand`; N-panel class picker for Solid / ImportedMesh (ADR-025) | Done 2026-04-01 |

---

## Related Documents

- `docs/adr/README.md` — Architecture Decision Record index (ADR-001 … ADR-025)
- `docs/STATE_TRANSITIONS.md` — Mode state transition details
- `docs/ROADMAP.md` — BFF migration roadmap and feature backlog
- `docs/CONCURRENCY.md` — Optimistic vs pessimistic locking strategy
- `docs/CODE_CONTRACTS.md` — Coding rules derived from real bugs (index + detail files)
- `docs/PHILOSOPHY.md` — Design principles distilled from post-mortems and ADRs
