# WebSocket Layer — Session Management

**Responsibility**: Manage per-connection WebSocket sessions, dispatch incoming messages to
graph operation handlers, and stream geometry results back to clients.

Files: `sessionManager.js`

---

## Meta Model

| Permitted | Prohibited |
|-----------|------------|
| Creating and removing `Session` objects | Direct DB queries (must go through `services/`) |
| Dispatching ops to geometry handlers | HTTP routing or Express middleware |
| Calling `geometry/` functions for evaluation | Holding shared mutable state across sessions |

Each session is isolated. Sessions do **not** share graph state.

## Session Lifecycle

```
WebSocket connect  →  createSession(ws)    →  send session.ready
                                           →  client sends session.resume
WebSocket close    →  removeSession(id)
```

Sessions are stored in-memory only. All sessions are lost on BFF restart.
Clients must reconnect and send `session.resume` to restore graph state from the DB.

## WebSocket Protocol (ADR-017)

### Client → Server (`op` field)

| op | Payload | Description |
|----|---------|-------------|
| `session.resume` | `{ sceneId? }` | Resume or start a session; loads graph from DB if sceneId is provided |
| `graph.node.add` | `{ node }` | Add a node to the operation graph |
| `graph.node.remove` | `{ nodeId }` | Remove a node and its connected edges |
| `graph.edge.add` | `{ edge }` | Connect two nodes; throws if it would create a cycle |
| `graph.edge.remove` | `{ edgeId }` | Disconnect two nodes |
| `graph.node.setParam` | `{ nodeId, param, value }` | Update a node parameter and re-evaluate downstream |
| `import.step` | `{ jobId, filename, data: base64, scale? }` | Parse a STEP file and add it as a `stepImport` node |

### Server → Client (`type` field)

| type | Payload | Description |
|------|---------|-------------|
| `session.ready` | `{ sessionId }` | Sent immediately on connect |
| `graph.snapshot` | `{ nodes, edges }` | Full graph state after `session.resume` |
| `graph.node.add` | `{ node }` | Echo after a node is successfully added |
| `graph.node.remove` | `{ nodeId }` | Echo after a node is removed |
| `graph.edge.add` | `{ edge }` | Echo after an edge is added |
| `graph.edge.remove` | `{ edgeId }` | Echo after an edge is removed |
| `graph.node.setParam` | `{ nodeId, param, value }` | Echo after a param is updated |
| `geometry.update` | `{ objectId, positions, normals, indices }` | Geometry buffers for a node |
| `import.progress` | `{ jobId, percent, status }` | STEP import progress |
| `error` | `{ code, message, requestOp }` | Structured error response |

## Autosave

After every mutating op, `_autosave(session)` fire-and-forgets a DB write of the current
graph state back to the scene row. Errors are logged but never propagated to the client.
See MENTAL_MODEL §3.5 for the async/await contract.
