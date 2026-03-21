# ADR-017: WebSocket Session Design and Geometry Service (Phase B)

- **Status**: Accepted
- **Date**: 2026-03-21
- **Implemented (Phase B)**: 2026-03-21
- **References**: ADR-015, ADR-016

---

## Context

Phase A established REST-based scene persistence via the BFF.
Phase B adds real-time geometry evaluation through a WebSocket channel and extracts
a Geometry Service module that runs server-side graph computation.

Key requirements for Phase B:

1. **WebSocket session** — bidirectional channel for operation-based geometry updates
2. **Geometry Service** — server-side DAG evaluation; clients receive computed geometry
3. **STEP import** — file upload via REST + progress notifications via WebSocket
4. **Node Editor prototype** — UI that visualises and edits the geometry DAG
5. **TransformGraph → DAG** — extend TransformNode/Edge to OperationNodes with cycle detection

---

## Decision

### 1. WebSocket session lifecycle

Each browser tab opens one WebSocket connection to `ws://host/api/ws`.
The BFF assigns a `sessionId` (UUID) on upgrade and sends it as the first message.

```
Client → Server:  { op, sessionId, payload }
Server → Client:  { type, sessionId, payload }   (may be unsolicited push)
```

Sessions are **in-memory only** (no DB persistence of the open session).
The geometry graph for the session is persisted in the Scene document on save.
On reconnect, the client sends `session.resume` with the last known `sceneId`
to restore server-side graph state from the DB.

### 2. Message protocol (Phase B operations)

| Direction | op / type | Payload |
|-----------|-----------|---------|
| C→S | `session.resume` | `{ sceneId }` |
| C→S | `graph.node.add` | `{ node: OperationNode }` |
| C→S | `graph.node.remove` | `{ nodeId }` |
| C→S | `graph.edge.add` | `{ edge: OperationEdge }` |
| C→S | `graph.edge.remove` | `{ edgeId }` |
| C→S | `graph.node.setParam` | `{ nodeId, param, value }` |
| C→S | `import.step` | `{ jobId, filename, data: base64 }` |
| S→C | `session.ready` | `{ sessionId }` |
| S→C | `geometry.update` | `{ objectId, positions[], indices[], normals[] }` |
| S→C | `graph.snapshot` | `{ graph: OperationGraph }` |
| S→C | `import.progress` | `{ jobId, percent, status }` |
| S→C | `error` | `{ code, message, requestOp }` |

### 3. Geometry Service module (in-process, Phase B)

The Geometry Service runs inside the BFF process for Phase B (no separate network hop).
In Phase C+, it can be extracted to a dedicated process if scaling becomes needed.

Location: `server/src/geometry/`

```
geometry/
  geometryGraph.js     — OperationGraph class (DAG: nodes + edges)
  nodeTypes.js         — CuboidNode, SketchNode, ExtrudeNode, StepImportNode
  evaluator.js         — topological sort + per-node evaluation
  meshEncoder.js       — converts evaluated geometry to wire-protocol arrays
```

### 4. OperationGraph — DAG with cycle detection

OperationNodes extend TransformNodes (ADR-016) with:
- `type`: `"cuboid"` | `"sketch"` | `"extrude"` | `"stepImport"` | `"transform"`
- `params`: node-type-specific parameter map
- `outputs`: evaluated geometry (cached after evaluation)

OperationEdges extend TransformEdges with:
- `dataType`: `"geometry"` | `"transform"` | `"control"` (what flows through the edge)

Cycle detection uses DFS on add-edge; a `CycleError` is returned to the client
via a `{ type: "error", code: "CYCLE_DETECTED" }` message.

### 5. STEP import prototype

STEP files arrive as base64 in a `import.step` WebSocket message (Phase B prototype).
The BFF decodes and passes to `occt-import-js` WASM.
Progress is emitted as `import.progress` messages.
On completion, a `StepImportNode` is added to the OperationGraph.

For Phase B, `occt-import-js` is loaded lazily on first use.
If the WASM fails to load, the BFF returns `{ code: "STEP_UNAVAILABLE" }`.

### 6. Delta-sync on reconnect

**Policy**: full-graph snapshot on resume (not delta-patch) for Phase B.

On `session.resume`:
1. BFF loads the scene from DB
2. Rebuilds the in-memory OperationGraph
3. Sends a `graph.snapshot` message with the full graph
4. Re-evaluates all nodes and sends `geometry.update` for each

Delta-patch is deferred to Phase C (when graph sizes justify the complexity).

### 7. Frontend integration

`BffClient` gains a `connectWs()` method returning a typed `WsChannel` object
with `send(op, payload)` and `on(type, handler)`.

`SceneService` holds one `WsChannel` instance when BFF is connected.
Graph operations (`addOperationNode`, `removeOperationNode`, `setNodeParam`)
send the corresponding WebSocket message and update local state on `geometry.update`.

### 8. Node Editor UI

A resizable side panel (`NodeEditorView`) renders the OperationGraph as an SVG/Canvas DAG.
Nodes are draggable rectangles; edges are Bezier curves.
In Phase B, editing is limited to:
- Selecting a node (shows params in a sidebar)
- Changing a numeric param (sends `graph.node.setParam`)
- Triggering STEP import (opens file picker, sends `import.step`)

Full DAG editing (add/remove nodes and edges) is deferred to Phase C.

---

## Consequences

### Benefits

- Clean separation between REST (save/load) and WebSocket (live geometry updates)
- In-process Geometry Service keeps Phase B latency low; easy to extract later
- `graph.snapshot` on reconnect keeps the sync protocol simple for Phase B
- Node Editor prototype enables UX validation before committing to full implementation

### Trade-offs / Constraints

- **In-memory session state**: if the BFF restarts all live sessions are lost.
  Clients should detect disconnect and perform `session.resume` on reconnect.
- **Full snapshot on reconnect**: for large graphs this sends more data than needed.
  Acceptable for Phase B prototype; switch to delta-patch in Phase C if latency hurts.
- **STEP via WebSocket (base64)**: convenient for prototype but not optimal for large files.
  Phase C should switch to multipart HTTP upload + WebSocket progress.
- **No horizontal BFF scaling** in Phase B: in-memory sessions require sticky routing.
  Phase C+ can add Redis session storage if multi-instance is needed.

### Open questions (Phase C)

- Delta-sync message format (JSON Patch / custom diff)
- Multi-instance BFF session sharing (Redis pub/sub)
- B-rep topology extraction from STEP and integration with OperationGraph
- Node Editor editing of DAG topology (add/remove nodes and edges via UI)
