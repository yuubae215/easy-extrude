# Geometry Layer — Operation Graph & Evaluation

**Responsibility**: Define the DAG data structure, evaluate geometry nodes in topological order,
and encode results for transmission over WebSocket.

Files: `geometryGraph.js`, `evaluator.js`, `nodeTypes.js`, `meshEncoder.js`

---

## Meta Model

| Permitted | Prohibited |
|-----------|------------|
| Pure graph mutations and traversals | Any DB access |
| Geometry computation (positions, normals, indices) | WebSocket or HTTP I/O |
| Serialisation to / from plain JSON | Referencing Express or `ws` objects |

All functions in this layer are **pure** (deterministic, no I/O side effects) except for
`cachedGeometry` being written onto node objects (intentional mutable cache).

## Files

| File | Responsibility |
|------|----------------|
| `geometryGraph.js` | `OperationGraph` class — nodes, edges, cycle detection (DFS), topological sort, JSON serialisation |
| `evaluator.js` | `evaluateGraph()` (full pass) and `evaluateSubgraph()` (incremental dirty-propagation) |
| `nodeTypes.js` | Registry of node type handlers — each handler exposes `evaluate(node, inputs)` and `defaultParams` |
| `meshEncoder.js` | `encodeGeometryUpdate()`, `encodeGraphSnapshot()` — encode geometry for WebSocket transport |

## Key Contracts (ADR-017)

- `OperationGraph.addEdge()` throws `CycleError` if the edge would create a cycle. Callers must catch this.
- `evaluateGraph()` runs all nodes; `evaluateSubgraph(graph, changedNodeId)` marks the changed node and all its downstream dependants dirty, then re-evaluates only those nodes.
- `node.cachedGeometry` is the mutable cache written by the evaluator. It is excluded from `toJSON()` serialisation.
- `OperationGraph.fromJSON()` reconstructs a graph from a plain object (stored in the DB `data` column under `operationGraph`).

## Node geometry format

Every node handler's `evaluate()` returns:

```js
{
  positions: number[],   // flat Float32 XYZ triples
  normals:   number[],   // flat Float32 XYZ triples (same length as positions)
  indices:   number[],   // triangle index triples
}
```

An empty result (`positions.length === 0`) is excluded from the results map.
