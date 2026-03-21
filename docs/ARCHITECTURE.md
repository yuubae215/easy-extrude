# Architecture

easy-extrude is a web-based 3D modeling app built on the MVC pattern,
being incrementally refactored toward Domain-Driven Design (DDD).

---

## Overview

```
src/
  main.js                      # Entry point: assembles MVC and calls start()
  domain/
    Cuboid.js                  # Domain entity: 3D cuboid (holds faces, edges)
    Sketch.js                  # Domain entity: 2D sketch (unextruded state only)
  graph/
    Vertex.js                  # Graph primitive: vertex { id, position: Vector3 }
    Edge.js                    # Graph primitive: edge { id, v0: Vertex, v1: Vertex }
    Face.js                    # Graph primitive: face { id, vertices: Vertex[4], name, index }
  model/
    CuboidModel.js             # Pure functions: geometry computation (stateless)
    SceneModel.js              # Aggregate root: scene objects + mode state + editSelection
  service/
    SceneService.js            # ApplicationService: entity creation, CRUD, extrudeSketch
  view/
    SceneView.js               # Three.js scene / camera / renderer
    MeshView.js                # Per-object mesh and visual state
    UIView.js                  # DOM UI (header / N panel / status bar)
    GizmoView.js               # World-axis gizmo (top-right)
    OutlinerView.js            # Scene hierarchy sidebar (left)
  controller/
    AppController.js           # Input handling + view coordination
```

---

## Layer Responsibilities

### Model

| Module | Responsibility |
|--------|---------------|
| `CuboidModel.js` | Pure functions only. No side effects. Geometry construction, normal computation, coordinate transforms. |
| `SceneModel.js` | Holds domain state: `_objects` / `_activeId` / `_selectionMode` / `_editSubstate` / `_editSelection` |

`SceneModel` is a pure state container with no dependency on Three.js.
It will split into entities (Cuboid, Sketch) and a repository during future DDD migration.

### View

| Module | Responsibility |
|--------|---------------|
| `SceneView` | Three.js initialisation (renderer / camera / OrbitControls / grid / lighting) |
| `MeshView` | 1 object = 1 MeshView. Owns mesh / wireframe / highlight / sketch rect |
| `UIView` | Blender-style DOM UI. `setStatusRich()` / `updateNPanel()` / `showAddMenu()` etc. |
| `GizmoView` | Draws axis gizmo on a small canvas (top-right). Click to snap camera. |
| `OutlinerView` | Left sidebar. Provides callbacks for object list, visibility toggle, delete, rename. |

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

A SceneObject is either a `Cuboid` or a `Sketch`. The type (`instanceof`) determines available operations.

**Cuboid** (3D):
```javascript
{
  id:          string,            // "obj_0_1234567890"
  name:        string,            // "Cube", "Cube.001"
  description: string,
  vertices:    Vertex[8],         // Graph-based vertices; get corners() projects to Vector3[]
  faces:       Face[6],           // Explicit face objects (ADR-012)
  edges:       Edge[12],          // Explicit edge objects (ADR-012)
  meshView:    MeshView,
}
```

**Sketch** (2D, unextruded):
```javascript
{
  id:          string,            // "obj_0_1234567890"
  name:        string,            // "Sketch.001"
  description: string,
  sketchRect:  { p1, p2 } | null, // Drawn rectangle
  meshView:    MeshView,
}
```

`Sketch.extrude(height)` does not mutate the Sketch; it returns a new `Cuboid`.
`SceneService.extrudeSketch(id, height)` replaces the Sketch with the Cuboid in the scene.

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

## Domain Model — Dimensions and Verbs

Entities are classified by dimension; operations are defined as verbs that raise the dimension.
Type (`instanceof`) determines behaviour; there is no `dimension` field (removed in ADR-012 Phase 5-3).

| Dimension | Entity | Creating verb |
|-----------|--------|---------------|
| 0D | `Vertex` | — |
| 1D | `Edge` | — |
| 2D | `Face` / `Sketch` | **Sketch**: draw a rectangle |
| 3D | `Cuboid` | **Extrude**: `Sketch.extrude(h)` → new Cuboid |

Verbs do not mutate entities; they **return a new entity of higher dimension**.
`SceneService` deletes the old entity and registers the new one under the same ID.

This structurally prevents the "state transitioned but methods didn't follow" problem.

### Graph-based model (ADR-012)

```
Vertex  = { id, position: Vector3 }
Edge    = { id, v0: Vertex, v1: Vertex }
Face    = { id, vertices: Vertex[4], name, index }
Cuboid  = { vertices: Vertex[8], faces: Face[6], edges: Edge[12], ... }
```

Explicit `Face` / `Edge` objects form the foundation for future G→V / G→E / G→F selection models.
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

---

## Related Documents

- `docs/adr/README.md` — Architecture Decision Record index
- `docs/STATE_TRANSITIONS.md` — Mode state transition details
- `docs/ROADMAP.md` — Feature roadmap
- `.claude/MENTAL_MODEL.md` — Coding policies learned from bugs
