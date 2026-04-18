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
    AnnotatedLine.js              # Domain entity: 2D map route annotation (ADR-029)
    AnnotatedRegion.js            # Domain entity: 2D map boundary/zone annotation (ADR-029)
    AnnotatedPoint.js             # Domain entity: 2D map hub/anchor annotation (ADR-029)
    SpatialLink.js                # Domain entity: typed semantic edge between entities (ADR-030)
    PlaceTypeRegistry.js          # Place type registry for map annotations (ADR-029)
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
    SetPlaceTypeCommand.js        # Undo/redo: place type assignment for map annotations (ADR-029)
    CreateCoordinateFrameCommand.js # Undo/redo: create CoordinateFrame node (ADR-018/019)
    ReparentFrameCommand.js       # Undo/redo: reparent CoordinateFrame in pose graph (ADR-019)
    CreateSpatialLinkCommand.js   # Undo/redo: create typed semantic edge (ADR-030)
    DeleteSpatialLinkCommand.js   # Undo/redo: delete typed semantic edge (ADR-030)
    MountAnnotationCommand.js     # Undo/redo: mount annotation to CoordinateFrame host (ADR-032)
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
    SpatialLinkView.js            # Dashed line + directional arrowhead; color-coded by linkType (ADR-030)
    AnnotatedLineView.js          # Polyline view for map route annotations (ADR-029)
    AnnotatedRegionView.js        # Filled polygon + rim ring view for map zones (ADR-029)
    AnnotatedPointView.js         # Crosshair-pulse marker for map hubs/anchors (ADR-029)
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
| `SpatialLinkView` | Dashed line + directional arrowhead between entity centroids. Color-coded by `linkType`. |
| `AnnotatedLineView` | Polyline for map routes. Animated particle effect for Route type. |
| `AnnotatedRegionView` | Filled polygon with rim ring. ShapeGeometry + polygon hole for correct non-circular shapes. |
| `AnnotatedPointView` | Point marker with crosshair-pulse animation. |

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

**CoordinateFrame** (Pose Graph node, ADR-018/019/020/033):
```javascript
{
  id:          string,
  name:        string,    // "Interface Frame.001" — created with explicit user intent only (ADR-033)
  parentId:    string,    // parent object/frame id; may be a Solid id (implicit local space)
  translation: Vector3,   // local translation relative to parent
  rotation:    Quaternion,// local rotation relative to parent (ROS RPY convention)
  localOffset: LocalVector3[], // SE(3) handle points in local space — NOT corners (WorldVector3[])
  meshView:    CoordinateFrameView,
}
```
World pose is derived by `SceneService._worldPoseCache` (topological sort), not stored on the entity.
Auto-generation of Origin frames on Solid creation was **abolished in ADR-033**; frames are created
only when an explicit relationship (mount, assembly mate) requires them.

**ImportedMesh** (thin client, read-only):
```javascript
{
  id:      string,
  name:    string,
  meshView: ImportedMeshView, // geometry streamed from server via WebSocket
}
```

**AnnotatedLine / AnnotatedRegion / AnnotatedPoint** (2D map annotations, ADR-029):
```javascript
// AnnotatedLine — map route (polyline)
{
  id:        string,
  name:      string,
  placeType: string,     // "Route" | "Boundary" (PlaceTypeRegistry)
  vertices:  Vertex[n],  // n ≥ 2; LocalGeometry interface
  edges:     Edge[n-1],
  meshView:  AnnotatedLineView,
}
// AnnotatedRegion — map zone (polygon)
{
  id:        string,
  name:      string,
  placeType: string,     // "Zone" (PlaceTypeRegistry)
  vertices:  Vertex[n],  // n ≥ 3; closed polygon
  edges:     Edge[n],
  meshView:  AnnotatedRegionView,
}
// AnnotatedPoint — map landmark / hub
{
  id:        string,
  name:      string,
  placeType: string,     // "Hub" | "Anchor" (PlaceTypeRegistry)
  vertices:  Vertex[1],  // single point; LocalGeometry interface
  edges:     Edge[0],
  meshView:  AnnotatedPointView,
}
```

**SpatialLink** (typed semantic edge, ADR-030):
```javascript
{
  id:       string,
  sourceId: string,  // id of the source entity
  targetId: string,  // id of the target entity
  linkType: string,  // "mounts" | "fastened" | "aligned" | "adjacent" |
                     // "above" | "contains" | "connects" | "references" | "represents"
}
```
`SpatialLink` is not a `SceneObject` — it lives in `SceneModel._links` (keyed by id).
It is serialized in `scene.links[]`. Managed via `SceneService.createSpatialLink()` /
`detachSpatialLink()`. Rendered per-frame by `SceneService._linkViews`.

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
| 2D | `AnnotatedLine` | **Map Mode**: route/boundary drag or multi-click | n≥2 | n-1 | 0 |
| 2D | `AnnotatedRegion` | **Map Mode**: zone drag rectangle | n≥3 | n | 0 |
| 2D | `AnnotatedPoint` | **Map Mode**: hub/anchor click | 1 | 0 | 0 |
| 3D | `Solid` | **Extrude**: `Profile.extrude(h)` → new Solid | 8 | 12 | 6 |

Verbs do not mutate entities; they **return a new entity of higher dimension**.
`SceneService` deletes the old entity and registers the new one under the same ID.

### Pose Graph — CoordinateFrame (ADR-018/019/020)

`CoordinateFrame` is a named SE(3) node in a kinematic tree (not a LocalGeometry entity).
- `parentId` links form the tree; depth-first topological sort propagates poses in one pass.
- World pose is cached in `SceneService._worldPoseCache` — never stored on the entity.
- Named frames on a geometry enable assembly-mate-style positioning (future: `matchedFrameId`).

### Semantic edges — SpatialLink (ADR-030)

`SpatialLink` is a directed, typed semantic edge between any two scene entities.
It is not a `SceneObject` and has no geometry of its own.

| Category | linkType values |
|----------|----------------|
| Geometric | `mounts` `fastened` `aligned` |
| Topological | `adjacent` `above` `contains` `connects` |
| Semantic | `references` `represents` |

Links are stored in `SceneModel._links` (and `_mountsIndex` / `_mountedByIndex` for O(1)
lookup). `SceneService._linkViews` renders each link as a dashed line + arrowhead per frame.
Mounting (`mounts` link) positions an annotation relative to a `CoordinateFrame` host
and updates per frame via `SceneService._updateMountedAnnotations()`.

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
| **Phase 11** | Lynch urban classification → `PlaceTypeRegistry`; `AnnotatedLine/Region/Point` entities; map toolbar; `SetPlaceTypeCommand` (ADR-026, superseded by ADR-029) | Done 2026-04-04 |
| **Phase 12** | Wasm geometry engine — `GeometryEngine`, `occt-import-js`; COOP/COEP service worker; `SharedArrayBuffer` on GitHub Pages (ADR-027) | Done 2026-04-05 |
| **Phase 13** | Anchored annotations scene graph — `AnnotatedPoint/Line/Region` can attach to `CoordinateFrame` hosts; `SceneService._mountsIndex` (ADR-028) | Done 2026-04-06 |
| **Phase 14** | Coordinate space type safety — `WorldVector3` / `LocalVector3` branded JSDoc types; `tsconfig.json`; `pnpm typecheck` CI gate; `CoordinateFrame.localOffset` vs `Solid.corners` structural separation (ADR-021 Phase 3) | Done 2026-04-07 |
| **Phase 15** | Spatial annotation system refactor — `UrbanPolyline/Polygon/Marker` → `AnnotatedLine/Region/Point`; `LynchClassRegistry` → `PlaceTypeRegistry`; categories Route/Boundary/Zone/Hub/Anchor (ADR-029 supersedes ADR-026) | Done 2026-04-08 |
| **Phase 16** | SpatialLink — typed semantic edges; `SceneModel._links`; `CreateSpatialLinkCommand` / `DeleteSpatialLinkCommand`; `SpatialLinkView` dashed arrowhead; `L` key two-phase creation flow; Outliner badge; N-panel section; serialization v1.2 (ADR-030 Phases 1–4) | Done 2026-04-09 |
| **Phase 17** | Map Mode interaction model — three-state `drawState` (idle/drawing/pending); naming-before-confirm; Mobile = single drag, PC = multi-click Line / drag Region / click Point; endpoint snapping PC-only 20 px; Route/Zone/Anchor visual overhaul (ADR-031) | Done 2026-04-11 |
| **Phase 18** | Geometric host binding — `MountAnnotationCommand`; `SceneService._mountsIndex/_mountedByIndex`; per-frame `_updateMountedAnnotations()`; grab plane constraint to host XY; CoordinateFrame delete warning; long-press Mount/Unmount/Add Interface Frame (ADR-032 H-1 to H-6) | Done 2026-04-15 |
| **Phase 19** | CoordinateFrame interface contract — auto-Origin abolished; frames created only on explicit user intent; `CoordinateFrame.localOffset` replaces `corners`; `_grabHandlesOf()` helper; `AddSolidCommand.undo()` hide-before-detach (ADR-033 C-3/C-4) | Done 2026-04-15 |
| **Phase 20** | Node Editor topology editing — port drag-to-create; output port drag + temp dashed line + `onLinkRequested`; `showLinkTypePicker`; edge click select + Delete → `DeleteSpatialLinkCommand`; `_createSpatialLinkDirect()` shared method (ADR-030 Phase S-2) | Done 2026-04-16 |
| **Phase 21** | MeasureLine Edit Mode (1D) — `setEndpointHover(index)` / `clearEndpointHover()`; `_enterEditMode1D()`; `editSubstate='1d'`; endpoint hover + camera-facing drag plane; post-hoc `createMoveCommand`; `canEdit` allows MeasureLine | Done 2026-04-17 |

---

## Related Documents

- `docs/adr/README.md` — Architecture Decision Record index (ADR-001 … ADR-033)
- `docs/STATE_TRANSITIONS.md` — Mode state transition details
- `docs/ROADMAP.md` — BFF migration roadmap and feature backlog
- `docs/CONCURRENCY.md` — Optimistic vs pessimistic locking strategy
- `docs/CODE_CONTRACTS.md` — Coding rules derived from real bugs (index + detail files)
- `docs/PHILOSOPHY.md` — Design principles distilled from post-mortems and ADRs
