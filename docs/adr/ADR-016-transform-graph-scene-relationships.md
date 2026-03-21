# ADR-016: Transform Graph — Spatial Relationships Between Scene Objects

- **Status**: Proposed
- **Date**: 2026-03-21
- **References**: ADR-012, ADR-015

---

## Context

The BFF + microservices architecture introduced in ADR-015 has the Geometry Service managing
the scene's geometry graph. As a first step, the **spatial position and orientation relationships**
(relative transforms) between scene objects need to be expressed as a graph structure.

The current frontend manages objects independently in world coordinates,
with no mechanism to express parent-child or constraint relationships between objects.

In the future, we want to extend to a **Node Editor** where dependency relationships and
parametric operations between objects can be visually edited — like Blender's Geometry Nodes.
This design forms the foundation for that.

---

## Decision

### 1. Represent as an SE(3) transform tree

Express the scene's spatial relationships as a **directed tree**.
Each node holds a relative transform (SE(3)) from its parent node.

```
world (root)
  ├── tnode_A  [translation: [1,0,0], rotation: identity]
  │     └── tnode_B  [translation: [0,2,0], rotation: quat]   ← relative to A origin
  └── tnode_C  [translation: [0,0,0], rotation: identity]
```

The coordinate system maintains the existing **ROS world frame (+X forward, +Y left, +Z up)** (ADR-008).
Rotation is expressed as **quaternions [qx, qy, qz, qw]** to avoid gimbal lock.

### 2. Data structures

#### TransformNode

```jsonc
{
  "id": "tnode_001",
  "objectId": "obj_0_xxx",          // SceneObject ID (null = virtual node)
  "label": "Cuboid_A",
  "transform": {
    "translation": [1.0, 0.0, 0.0], // Relative position from parent node origin (m)
    "rotation":    [0.0, 0.0, 0.0, 1.0]  // Quaternion [qx, qy, qz, qw]
  }
}
```

A virtual node with `objectId: null` can be used as a pivot for groups or assemblies (future).

#### TransformEdge

```jsonc
{
  "id": "tedge_001",
  "parentId": "tnode_world",    // Parent TransformNode id ("world" = root)
  "childId":  "tnode_001",
  "constraint": "fixed"         // Only "fixed" in the current phase
}
```

#### Planned constraint extensions (Node Editor phase)

| Value | Meaning |
|-------|---------|
| `"fixed"` | Fixed relative transform (current phase) |
| `"revolute"` | 1-axis rotational DOF (future) |
| `"prismatic"` | 1-axis translational DOF (future) |
| `"free"` | 6 DOF (future: for assembly simulation) |

### 3. Persistence format (Geometry Service DB schema)

The graph is stored as an **adjacency list**.

```jsonc
// Scene document (e.g. MongoDB / PostgreSQL JSON column)
{
  "sceneId": "scene_xxx",
  "transformGraph": {
    "nodes": [ /* TransformNode[] */ ],
    "edges": [ /* TransformEdge[] */ ]
  }
}
```

Persist directly in this format in Phase A (REST scene save).
Extend node types to a DAG (directed acyclic graph) in Phase B (Node Editor).

### 4. Extension path to Node Editor

The current TransformNode / TransformEdge correspond to the initial form of the Node Editor.
In the future, add OperationNodes (STEP import, boolean operations, parametric modifiers)
and extend to a configuration where geometry flows between nodes as streams.

```
Current (Phase A):
  TransformNode ─(fixed)─→ TransformNode

Future (Node Editor):
  StepImportNode ──┐
                   ├─→ BooleanOpNode ─→ TransformNode
  CuboidNode ──────┘
```

OperationNode output geometry is streamed to the frontend via WebSocket (ADR-015).

### 5. Frontend impact

In Phase A, `SceneService` only needs to fetch the transform graph from the BFF REST endpoint
and apply it to `SceneModel`. The frontend receives the graph structure **read-only**
and converts it to a Three.js Object3D hierarchy for rendering.

Graph editing operations (parenting, transform changes) are sent to the Geometry Service via BFF,
and the updated graph is received in response (no write logic on the frontend).

---

## Consequences

### Benefits

- Same philosophy as ROS TF / URDF, making future robotics integration straightforward.
- Quaternion representation maps directly to/from ROS frame conversions.
- Adjacency list format is flexible for graph additions/removals and easy to extend with node types for the Node Editor.
- Virtual nodes with `objectId: null` allow future grouping and assembly pivots.

### Trade-offs / Constraints

- **Tree only (current phase)**: Only strict tree structure is supported currently.
  Add an ADR and extend the design when DAG (shared subgraphs) becomes needed.
- **World coordinate transform cost**: Deep trees require composing all ancestor transforms.
  Cache computed coordinates on the Geometry Service side (frontend receives pre-composed coordinates).
- **WebSocket sync design is a Phase B ADR**: Delta-sync protocol on disconnect/reconnect,
  and session vs persistence policy for graph state, will be decided in Phase B ADR.

### Open questions (continued in Phase B)

- Persistence format for OperationNode (cycle detection policy for DAG edges)
- Graph delta representation in WebSocket messages (full-state vs patch)
- How to incorporate B-rep topology from STEP import into the graph
