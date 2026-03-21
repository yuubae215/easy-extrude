# ADR-015: BFF + Microservices Architecture

- **Status**: Proposed
- **Date**: 2026-03-20
- **References**: ADR-011, ADR-012, ADR-013

---

## Context

easy-extrude is currently a browser-only single-page application.
All domain entity creation, computation, and state management (Cuboid / Sketch / Vertex / Edge / Face)
is performed in client-side JavaScript.

This design has the following challenges:

1. **UX degradation risk**: Compute-heavy operations such as geometry graph evaluation and STEP import
   block the main thread and degrade Three.js render loop FPS.

2. **Frontend bloat**: Domain logic co-existing in the same process as View / Controller breaks
   the separation of concerns. Even with the ApplicationService layer from ADR-011,
   the question of "where to run heavy computation" remains unsolved.

3. **Difficulty handling future features**:
   - **Node Editor-style geometry graph editing**: Reactive dependency propagation and re-evaluation
     between nodes would become noticeably slow for complex graphs if done in the browser.
   - **STEP / IGES import**: CAD kernel processing requires tens to hundreds of MB of memory;
     it is more practical to delegate to a dedicated service than to handle it with in-browser WASM.
   - **Persistence and sharing**: Scene data and computed geometry should be stored in a server-side DB
     to enable URL sharing, history management, and future collaboration.

4. **Eliminate repository logic**: The frontend should not hold persistence logic
   (CRUD, optimistic locking, exclusive control). It should focus solely on View and Controller roles.

---

## Decision

### 1. Introduce BFF (Backend for Frontend) as an intermediate layer

The frontend knows only the **BFF**. It does not access microservices directly.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser — easy-extrude                                      │
│  View (Three.js) + Controller (AppController)               │
│  Zero knowledge of domain computation, DB, or concurrency   │
└───────────────┬─────────────────────────────────────────────┘
                │  REST (CRUD)
                │  WebSocket (Geometry Stream)
                ▼
┌─────────────────────────────────────────────────────────────┐
│  BFF Server (Node.js)                                        │
│  · JWT authentication gateway                               │
│  · REST routing → proxy to each microservice                │
│  · WebSocket session management → delegate to Geometry Svc  │
│  · Shape responses for frontend (aggregation)               │
│  · Optimistic locking (ETag / If-Match) validation          │
└──────┬──────────────┬──────────────┬───────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌──────────────────────────────┐
│  Scene     │ │  User      │ │  Geometry Service             │
│  Service   │ │  Service   │ │  · Geometry graph evaluation  │
│  Scene     │ │  Auth /    │ │  · Node Editor graph compute  │
│  CRUD + DB │ │  Profile   │ │  · STEP / IGES import         │
│            │ │            │ │  · OBJ / GLTF export          │
└────────────┘ └────────────┘ └──────────────────────────────┘
```

### 2. Protocol selection by use case

| Use case | Protocol | Reason |
|----------|----------|--------|
| Scene save / load | REST (HTTP) | One-shot requests, easy cache control |
| User authentication | REST (HTTP) | Standard JWT flow |
| Geometry graph operations | **WebSocket** | Frequent round-trips: operation → compute → result |
| Node Editor node evaluation | **WebSocket** | Need to receive graph change propagation as a stream |
| STEP / GLTF import | REST (multipart) + WebSocket progress | File upload via REST, progress via WebSocket |

### 3. Limit frontend responsibility to View + Controller

```
Current (client-complete)
  AppController → SceneService → Cuboid / Sketch / Vertex / Edge / Face
                                 ↑ domain computation runs here

After introduction (Thin Client)
  AppController → SceneService → BFF (REST / WebSocket)
                  ↑ locally holds only "display cache"
                    zero knowledge of domain computation or persistence
```

`SceneService` becomes an HTTP / WebSocket client and its only responsibility is
to apply geometry data received in responses to `SceneModel`.
Domain entities (Cuboid / Sketch, etc.) are created and evaluated on the server side.

### 4. WebSocket message design principles

Messages are **operation-based**.

```jsonc
// Front → BFF: graph operation
{ "op": "graph.node.connect", "sessionId": "...", "payload": { "from": "v3", "to": "e7" } }

// BFF → Front: computation result (geometry stream)
{ "type": "geometry.update", "objectId": "obj_0_xxx",
  "payload": { "positions": [...], "indices": [...], "normals": [...] } }

// BFF → Front: progress notification
{ "type": "import.progress", "jobId": "...", "percent": 42 }
```

### 5. Phased migration strategy

Migrate incrementally without breaking the current client-complete behaviour.

| Phase | Description |
|-------|-------------|
| **Phase A** | Build BFF skeleton. Implement scene save/load via REST only. Existing frontend behaviour maintained. |
| **Phase B** | Extract Geometry Service. Establish WebSocket session. Prototype Node Editor UI. |
| **Phase C** | Add STEP import service. Shrink frontend domain entities to cache-only. |
| **Phase D** | Fully thin-client frontend. Eliminate all domain computation from Cuboid / Sketch. |

---

## Consequences

### Benefits

- The frontend is freed from domain computation and can focus on Three.js rendering.
  FPS stability improves; UX does not degrade for complex scenes.
- Geometry Service can be scaled independently (e.g. route heavy STEP conversions to separate instances).
- BFF handles aggregation, authentication, and response shaping in one place,
  so frontend code is insulated from internal microservice changes.
- Keeping CAD libraries (STEP / IGES / GLTF) server-side keeps the browser bundle lightweight.

### Trade-offs / Constraints

- **Latency**: A network round-trip occurs for each graph operation.
  Offline operation would require a separate design (out of scope currently).
- **Migration cost**: Full migration to Phase D requires substantial rework of the current frontend domain layer.
  Progress incrementally from Phase A.
- **WebSocket state management**: A separate design is needed for persisting server-side session and graph state.
  Consistency policy on disconnect / reconnect will be addressed in Phase B ADR.
- **Test strategy**: Frontend unit tests focus on View / Controller, while
  Geometry Service tests become critical. Consider contract tests at service boundaries.

### Open questions (continued in Phase B)

- Should Node Editor graph state be held in a server-side DB or in-memory for the session only?
- Reconnect and delta-sync protocol on WebSocket disconnect
- Persistence format for Geometry Service computation graph (DAG)
