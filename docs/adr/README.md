# Architecture Decision Records (ADR)

This directory records the project's design decisions.

## Rules

- File naming: `ADR-NNN-kebab-case-title.md`
- Status: `Proposed` / `Accepted` / `Deprecated` / `Rejected` / `Superseded by ADR-NNN`
- When superseding a decision, update the old ADR's status and add a new ADR (do not delete)

## Index

| No. | Title | Status | Date | Related |
|-----|-------|--------|------|---------|
| [ADR-001](ADR-001-voxel-based-shape-representation.md) | Voxel-based Shape Representation | **Superseded by ADR-007** | 2026-03-20 | ADR-007 |
| [ADR-002](ADR-002-two-modeling-methods.md) | Two Modeling Methods (Primitive Box / Sketch→Extrude) | Accepted | 2026-03-20 | ADR-004, ADR-007 |
| [ADR-003](ADR-003-orbit-control-middle-click.md) | Orbit Control Migrated to Middle-Click | **Rejected** | 2026-03-20 | ADR-006 |
| [ADR-004](ADR-004-edit-mode-adapts-to-object-type.md) | Edit Mode Adapts to Object Type | Accepted | 2026-03-20 | ADR-002, ADR-005 |
| [ADR-005](ADR-005-object-hierarchy-dimensional-classification.md) | Object Hierarchy with 1D/2D/3D Dimensional Classification | Accepted | 2026-03-20 | ADR-004 |
| [ADR-006](ADR-006-right-click-cancel-context-menu.md) | Right-Click = Cancel / Context Menu | Accepted | 2026-03-20 | — |
| [ADR-007](ADR-007-cuboid-based-shape-representation.md) | **Cuboid-based Shape Representation** | Accepted | 2026-03-20 | ADR-001 |
| [ADR-008](ADR-008-mode-transition-state-machine.md) | **Mode Transition State Machine — Logical Consistency Policy** | Accepted | 2026-03-20 | ADR-002, ADR-004 |
| [ADR-009](ADR-009-domain-entity-types-cuboid-sketch.md) | **Domain Entity Types: Cuboid / Sketch** | Accepted | 2026-03-20 | ADR-002, ADR-005, ADR-007 |
| [ADR-010](ADR-010-domain-entity-behaviour-methods.md) | **Domain Entity Behaviour Methods (DDD Phase 2)** | Accepted | 2026-03-20 | ADR-009 |
| [ADR-011](ADR-011-application-service-scene-service.md) | **Introducing the ApplicationService Layer — SceneService (DDD Phase 3)** | Accepted | 2026-03-20 | ADR-009, ADR-010 |
| [ADR-012](ADR-012-graph-based-geometry-model.md) | **Graph-based Geometry Model (Vertex / Edge / Face / Solid)** | Accepted | 2026-03-20 | ADR-005, ADR-009, ADR-011 |
| [ADR-013](ADR-013-domain-events-scene-service-observable.md) | **Domain Events — Making SceneService Observable (DDD Phase 4)** | Accepted | 2026-03-20 | ADR-011, ADR-010 |
| [ADR-014](ADR-014-edit-mode-sub-element-selection.md) | **Edit Mode Sub-Element Selection (DDD Phase 6)** | Accepted | 2026-03-20 | ADR-004, ADR-012 |
| [ADR-015](ADR-015-bff-microservices-architecture.md) | **BFF + Microservices Architecture** | Accepted | 2026-03-20 | ADR-011, ADR-012, ADR-013 |
| [ADR-016](ADR-016-transform-graph-scene-relationships.md) | **Transform Graph — Spatial Relationships Between Scene Objects** | Accepted | 2026-03-21 | ADR-012, ADR-015 |

## How to Add a New ADR

1. Assign the next sequence number (`NNN = max + 1`)
2. Create the file: `ADR-NNN-title.md`
3. **Add a row to the index table in this README**
4. Add a reference in related existing ADRs' `References` section
5. Commit and push
