# Roadmap

## Design Direction (2026-03-20)

This project is a **cuboid-based modeling application**. Each shape is a deformable box defined by 8 corner vertices. Complex scenes are built by placing and deforming multiple cuboid objects. See `docs/adr/` for detailed design decisions.

---

## BFF + Microservices Migration (ADR-015)

The architecture evolves in 4 phases from a browser-only SPA to a thin-client frontend
backed by a BFF and dedicated microservices.

```
Browser (View + Controller)
        │ REST / WebSocket
        ▼
BFF (Node.js) — auth, aggregation, routing
   ├── Scene Service   — scene CRUD + DB
   ├── User Service    — auth / profile
   └── Geometry Service — graph eval, STEP import, export
```

### Phase A — BFF skeleton + Scene persistence *(next)*

| Task | Details | ADR |
|------|---------|-----|
| Scaffold BFF (Node.js / Express or Fastify) | JWT gateway, REST routing stub | ADR-015 |
| Scene save / load REST endpoints | `POST /scenes`, `GET /scenes/:id` | ADR-015 |
| Scene Service + DB schema | Store scene JSON (objects + transform graph) | ADR-015, ADR-016 |
| TransformGraph persistence | Adjacency list: `TransformNode[]` + `TransformEdge[]`; ROS frame + quaternions | ADR-016 |
| `SceneService` → HTTP client | Replace in-memory CRUD with BFF REST calls | ADR-015 |
| Existing frontend behaviour unchanged | Client-complete fallback while BFF is wired up | ADR-015 |

### Phase B — Geometry Service + WebSocket + Node Editor prototype

| Task | Details | ADR |
|------|---------|-----|
| Extract Geometry Service | Geometry graph evaluation migrated server-side | ADR-015 |
| WebSocket session (BFF ↔ Frontend) | Operation-based messages (`graph.node.connect`, `geometry.update`) | ADR-015 |
| Delta-sync protocol on reconnect | Session vs persistence policy; patch vs full-state messages | ADR-016 (open) |
| Node Editor UI prototype | Visual DAG editing; nodes stream geometry results via WebSocket | ADR-016 |
| STEP import prototype | `occt-import-js` in Geometry Service; file upload REST + WebSocket progress | ADR-015 |
| TransformGraph → DAG | Add OperationNodes (cycle detection policy) | ADR-016 |

### Phase C — STEP import + frontend entity shrink

| Task | Details | ADR |
|------|---------|-----|
| STEP import production-ready | Migrate to `opencascade.js` or Python service if B-rep access needed | ADR-015 |
| B-rep topology → graph | Incorporate STEP faces/edges into TransformGraph | ADR-016 (open) |
| Frontend domain entities → cache-only | Cuboid / Sketch / Vertex / Edge / Face hold display data only | ADR-015 |
| GLTF / OBJ export (Geometry Service) | Keep CAD libs server-side; frontend bundle stays lightweight | ADR-015 |

### Phase D — Fully thin client

| Task | Details | ADR |
|------|---------|-----|
| Remove all domain computation from frontend | AppController → SceneService → BFF only | ADR-015 |
| Frontend unit tests — View / Controller only | Contract tests at BFF service boundaries | ADR-015 |
| Independent Geometry Service scaling | Route heavy STEP conversions to separate instances | ADR-015 |

---

## Backlog (frontend features)

| Priority | Item | Complexity | ADR / Notes |
|----------|------|-----------|-------------|
| 🟡 Medium | Object hierarchy + Outliner tree view | Medium | ADR-005 |
| 🟡 Medium | Right-click context menu (currently: cancel only) | Low | ADR-006 |
| 🟡 Medium | Multi-face extrude (Shift+click) | Medium | — |
| 🟡 Medium | Export (OBJ / GLTF) | Low | Phase C via Geometry Service |
| 🟢 Low | 1D objects: MeasureLine, reference line | Medium | ADR-005 |
| 🟢 Low | Assembly groups (virtual TransformNode pivot) | Medium | ADR-016 |
| 🟢 Low | Revolute / prismatic constraints in Node Editor | High | ADR-016 |

---

## Completed

| Item | Date |
|------|------|
| Mobile touch support — Pointer Events API, `_activeDragPointerId`, mobile toolbar, canvas target guard, touch hover sync, face-extrude confirm on `pointerup` | 2026-03-21 |
| Architecture design — BFF + microservices strategy, transform graph (SE(3) tree, ROS frames, quaternions) | 2026-03-21 (ADR-015, ADR-016) |
| DDD Phase 6 — Sub-element selection (1/2/3 keys); Grab snap expanded to all geometry (ADR-014) | 2026-03-20 |
| DDD Phase 5-3 — Edge/Face graph objects; unified selection model; dimension field removed (ADR-012) | 2026-03-20 |
| DDD Phase 5-2 — Event-driven status bar; _refreshObjectModeStatus() | 2026-03-20 |
| DDD Phase 5-1 — Vertex layer in graph model (ADR-012) | 2026-03-20 |
| DDD Phase 4 — Domain events (EventEmitter); SceneService observable (ADR-013) | 2026-03-20 |
| DDD Phase 3 — SceneService ApplicationService layer (ADR-011) | 2026-03-20 |
| DDD Phase 2 — Domain entity behaviour methods (ADR-010) | 2026-03-20 |
| DDD Phase 1 — Typed domain entities Cuboid / Sketch (ADR-009) | 2026-03-20 |
| Method B: Sketch → Extrude (ADR-002) + Edit Mode 2D/3D dispatch (ADR-004) | 2026-03-20 |
| Custom BufferGeometry cuboid + Face Extrude | 2026-03-17 |
| MVC refactor (Model / View / Controller separation) | 2026-03-17 |
| Blender-style Grab controls (G/X/Y/Z, numeric input) | 2026-03-18 |
| ROS world frame (+X forward, +Y left, +Z up) | 2026-03-19 |
| Blender-style UI (header bar, N panel, bottom info bar) | 2026-03-19 |
| Colored status display (`setStatusRich`) | 2026-03-19 |
| Cuboid-based architecture design + ADRs (ADR-007) | 2026-03-20 |
