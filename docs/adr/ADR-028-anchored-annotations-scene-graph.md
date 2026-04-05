# ADR-028: Anchored Annotations & Scene Graph API

- **Status**: Accepted
- **Date**: 2026-04-06
- **References**: ADR-012, ADR-016, ADR-018, ADR-019, ADR-021

---

## Context

Two usability gaps were identified:

### 1. MeasureLine detaches from its measured geometry

When a `MeasureLine` endpoint is placed on a vertex, edge, or face of a geometry
object, and that object is later moved via Grab, the measure line endpoints stay
at their original world positions. The user loses track of what was measured.

Root cause: `MeasureLine.vertices[i].position` is a plain world-space `Vector3`
with no reference to its source geometry element.

### 2. No machine-readable scene connectivity graph

The `parentId` chain on `CoordinateFrame` entities encodes a partial hierarchy,
but there is no query API to export the full scene graph (geometry objects +
frames + anchor relations) as a node/edge structure suitable for connectivity
analysis (e.g., detecting isolated clusters).

---

## Decision

### 1. Vertex anchor reference

Add an optional `anchorRef` field to `Vertex`:

```js
vertex.anchorRef = {
  objectId:  string,                        // scene object ID
  type:      'vertex' | 'edge' | 'face',
  elementId: string,                        // Vertex.id / Edge.id / Face.id
}
```

`anchorRef` is `null` by default (backward-compatible). It is set only when
`SceneService.createMeasureLine()` is called with explicit anchor info.

### 2. Snap target enrichment

`collectSnapTargets()` in `CuboidModel.js` now includes `objectId` and
`elementId` in every returned target object:

```js
{ label, position, type, objectId, elementId }
```

- Graph-based objects (Solid, Profile, MeasureLine): all three fields populated.
- ImportedMesh bounding-box targets: `objectId` populated, `elementId = null`
  (no stable element identity; anchor tracking not supported for these).

### 3. SceneService.createMeasureLine() extended signature

```js
createMeasureLine(p1, p2, camera, renderer, container, anchorRefs = {})
// anchorRefs: { p1?: { objectId, type, elementId }, p2?: { same } }
```

When `anchorRefs.p1` or `.p2` is provided, the corresponding `Vertex.anchorRef`
is set on the created entity.

### 4. Anchor update loop

`SceneService._updateAnchoredMeasures()` is called at the end of every
`_updateWorldPoses()` call (once per animation frame). It re-resolves anchored
vertex positions from their referenced elements:

| `anchorRef.type` | Resolution |
|------------------|-----------|
| `'vertex'`       | `obj.vertices.find(v => v.id === elementId).position` |
| `'edge'`         | midpoint of `edge.v0.position` and `edge.v1.position` |
| `'face'`         | centroid of `face.vertices[*].position` |

If the referenced object or element no longer exists (deleted), the endpoint
stays at its last known position. The anchor is not auto-removed; undo/redo
of the referenced object's deletion will restore the live tracking.

### 5. Serialization

`MeasureLine` DTOs gain two new optional fields:

```jsonc
{
  "type": "MeasureLine", "id": "...", "name": "...",
  "p1": {x,y,z},  "anchorRef0": { "objectId": "...", "type": "vertex", "elementId": "..." } | null,
  "p2": {x,y,z},  "anchorRef1": { ... } | null
}
```

Absence of `anchorRef0`/`anchorRef1` is treated as `null` (backward-compatible
with existing saved scenes).

### 6. Scene graph API

`SceneService.getSceneGraph()` returns:

```js
{
  nodes: [{ id, name, type, parentId }],
  edges: [{ from, to, relation }]
  // relation: 'frame' (parentId chain) | 'anchor' (MeasureLine endpoint)
}
```

This is sufficient to:
- List roots (nodes where `parentId == null`)
- Find connected components (clusters) via BFS/DFS on the undirected edge set
- Verify the scene forms a single tree vs. multiple disconnected subgraphs

### 7. AppController anchor tracking

`_measure.p1Anchor` is added to the measure placement state object. It stores
the anchor reference captured at Phase 1 (first point placement). Both anchors
are passed to `createMeasureLine()` in Phase 2.

---

## Consequences

### Benefits

- MeasureLine endpoints follow their anchored geometry when objects move.
- Scene connectivity is queryable for analysis tooling without new UI.
- Anchor info is persisted with the scene — reopening preserves live tracking.
- `collectSnapTargets` enrichment is backward-compatible (extra fields ignored
  by existing callers).

### Constraints

- Anchoring to ImportedMesh elements is not supported (no stable element IDs).
- If the anchored object is deleted, the measure endpoint freezes at its last
  position. A future enhancement could show a "broken anchor" indicator.
- `getSceneGraph()` returns a snapshot; it is not reactive (no change events).
  Callers should re-query after scene mutations.

### Out of scope (future ADRs)

- **Object-level transform parenting** (Solid/Profile whose world position
  derives from a parent CoordinateFrame) — this is the full ADR-016 transform
  graph applied to geometry objects. Requires new entity field `parentFrameId`
  and a reworked world-pose propagation pass.
- **Broken-anchor indicator** in the Outliner / N panel.
- **Anchor editing** (changing the anchor of an existing MeasureLine).

---

## Notes on cross-object CoordinateFrame chains

ADR-019 Phase B already allows creating a CoordinateFrame whose parent is
another CoordinateFrame (even one that belongs to a different geometry object).
To create a cross-object frame link:

1. Select Frame.A (the target frame, which may belong to Object A).
2. Open Add menu → "Coordinate Frame".
3. The new frame is created with `parentId = Frame.A.id`.
4. Its world pose is recomputed each frame relative to Frame.A's world pose.

No code changes are required to enable this; it was already implemented in
ADR-019 Phase B. This ADR documents the capability explicitly.
