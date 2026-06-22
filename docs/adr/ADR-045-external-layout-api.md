# ADR-045 — External Layout API: CLI/REST-Driven Scene Composition

**Status**: Accepted  
**Date**: 2026-06-09  
**Supersedes**: —  
**Related**: ADR-044 (5W1H Function Mapping), ADR-015 (BFF), ADR-022 (Undo/Redo), ADR-030 (SpatialLink), ADR-040 (Solid Data Model), ADR-037 (Body Frame Architecture), ADR-055 (Scene⇄Layout DSL Mutual — the `compileLayout` inverse)

---

## Context

ADR-044 established the 5W1H homomorphism (φ: NL → ExecutionPlan → Code) for in-GUI operations.
That ADR covers the case where a human is operating the browser-based GUI.

The repository's true goal is a step beyond this: **given a requirement context (文脈), automatically
compute a 3D object layout including constraints and return a loadable scene**.

This requires an *external* interface — a CLI and REST API that accept structured requirements and
deterministically compile them into a scene importable by the existing `importFromJson()` path.

The key design constraint from ADR-044 §Constraints applies here too:
> φ must never generate arbitrary code. The AI selects from a pre-defined, safe vocabulary.

In this ADR, that vocabulary is the **Layout DSL** — a structured JSON format that captures
Why / How / What (ADR-044 §1 three-level graph) and maps directly onto the domain model.

---

## The 5W1H Mapping in Layout DSL

```
Why  (return value — was the layout goal achieved?)
  = strategy + strategyOptions  (How — linear / grid / stack / radial / manual)
      entities + constraints     (What — Solid dims, CF offsets, SpatialLink types)
```

| DSL field | 5W1H role | Domain mapping |
|-----------|-----------|----------------|
| `constraints[].semanticType` | **Why** — success condition | SpatialLink.semanticType |
| `constraints[].jointType`    | **Why** — kinematic binding | SpatialLink.jointType (ADR-038) |
| `strategy` + `strategyOptions` | **How** — placement algorithm | LayoutCompiler position engine |
| `entities[].dimensions`      | **What** — geometry          | Solid localCorners (ADR-040) |
| `entities[].frames`          | **What** — pose nodes         | CoordinateFrame hierarchy (ADR-037) |

---

## Decision

### 1. Layout DSL (v1.0)

A declarative JSON format that describes a scene to be compiled:

```json
{
  "version":  "layout/1.0",
  "meta":     { "name": "string", "description": "string" },
  "strategy": "linear | grid | stack | radial | manual",
  "strategyOptions": { "axis": "+X", "spacing": 3000 },
  "entities": [
    {
      "ref":        "unique_ref",
      "type":       "Solid | CoordinateFrame | AnnotatedLine | AnnotatedRegion | AnnotatedPoint",
      "name":       "Human name",
      "ifcClass":   "IfcEquipmentElement | ...",
      "dimensions": { "x": 500, "y": 300, "z": 800 },
      "position":   { "x": 2800, "y": 0, "z": 400 },
      "frames": [
        { "ref": "tcp", "name": "TCP", "translation": { "x": 0, "y": 0, "z": 15 } }
      ]
    }
  ],
  "constraints": [
    {
      "source":       "entity_ref | frame_ref | entity_ref_origin",
      "target":       "entity_ref | frame_ref | entity_ref_origin",
      "jointType":    "fixed | null",
      "semanticType": "fastened | above | adjacent | connects | ...",
      "properties":   {}
    }
  ]
}
```

**Ref namespace:** every entity exposes three ref forms in the constraint graph:
- `<ref>` → the entity itself (Solid ID, AnnotatedPoint ID, etc.)
- `<ref>_origin` → auto-generated Origin CoordinateFrame (Solid only, ADR-037)
- `<frame.ref>` → user-defined child CoordinateFrame

**`position`** is the ADR-040 centroid (`_position`). For a Solid with height `h`, place
bottom at z=0 by setting `position.z = h / 2`.

### 2. LayoutCompiler.js — pure function

Located at `src/layout/LayoutCompiler.js` (shared between client and server).

```
compileLayout(dsl: LayoutDSL) → { version:'1.3', objects[], links[], transformGraph }
```

**Compilation phases:**
1. `validateLayoutDsl(dsl)` — throw on schema violations
2. `buildRefMap(entities)` — ref string → generated deterministic ID
3. `computePositions(entities, strategy, opts)` — strategy → center positions
4. `generateObjects(entities, refMap, positions)` → SceneSerializer v1.3 DTOs
5. `generateLinks(constraints, refMap)` → SpatialLink DTOs
6. Return scene JSON

**localCorners** (Solid): matches `CuboidModel.createInitialCorners()` corner ordering, scaled
by `{dims.x/2, dims.y/2, dims.z/2}`. Orientation is always identity quaternion.

**Origin CF** (ADR-037): generated automatically for every Solid with deterministic ID
`cf_origin_<ref>`. User frames are children of the Origin CF (`parentId = originId`).

**Pure computation** (PHILOSOPHY #3): no Three.js, no DOM, no SceneService. Output is
plain JSON, loadable without a running browser session.

### 3. REST API

Mounted at `/api/layout` with JWT auth (same as `/api/scenes`):

```
POST /api/layout/compile
  Body:     { dsl: LayoutDSL }
  Response: { version:'1.3', objects[], links[], transformGraph }  (SceneSerializer v1.3)
  Errors:   400 { error, details: string[] }

POST /api/layout/scenes
  Body:     { name: string, dsl: LayoutDSL }
  Response: { id, name, created_at, updated_at, data }  (same as POST /api/scenes)
```

### 4. CLI

```bash
# Compile Layout DSL → SceneSerializer v1.3 JSON (no BFF required)
node cli/index.js compile examples/factory_layout.json --pretty

# Compile + persist to BFF DB
node cli/index.js import  examples/factory_layout.json \
  --api-url http://localhost:3001 --name "My Layout"

# NL → Layout DSL via Claude API (ANTHROPIC_API_KEY required)
ANTHROPIC_API_KEY=sk-... node cli/index.js interpret \
  "ロボット3台を1m間隔で配置してボルト締結" --ai

# Or as npm script
pnpm layout compile examples/factory_layout.json --pretty
```

### 5. LLM bridge (interpret command)

The `interpret` command calls Claude API to produce Layout DSL from natural language.
Consistent with ADR-044 §Constraints: **the LLM produces Layout DSL, never executable code**.
The DSL is then validated by `validateLayoutDsl()` before use — if the LLM produces
invalid DSL, the command fails with a clear error (PHILOSOPHY #11).

System prompt provides the full Layout DSL schema and domain rules (IFC class names,
world-frame orientation, unit: mm, ROS REP-103 coordinate system).

---

## Validation Scenario: Factory Cell Automation

`examples/factory_layout.json` encodes the following physical scenario:

```
工場のセル型工程を自動化に置き換えるレイアウト
├─ cell_area      AnnotatedRegion (Zone)  — セル専有面積 4100×1400mm
├─ floor_outlet   AnnotatedPoint (Anchor) — 100V/3芯コンセント, 原点 (0,0,0)
├─ workbench      Solid (IfcFurniture)    — 作業台 500×300×800mm, 中心 (2800, 0, 400)
│  ├─ Origin CF
│  └─ workbench_top CF  — 天面中心 z=+400
├─ base_plate     Solid (IfcElementComponent) — ベースプレート 300×250×30mm
│  ├─ Origin CF
│  └─ robot_mount CF    — 天面中心 z=+15
├─ robot          Solid (IfcTransportElement) — 産業用ロボット 220×220×520mm
│  ├─ Origin CF
│  └─ robot_base CF     — 取付基準面 z=-260
├─ container_a    Solid — バラ積みワークコンテナ 180×120×150mm
└─ container_b    Solid — マトリックス格子コンテナ 180×120×150mm

SpatialLinks:
  base_plate       → workbench        (null/above)    ベースプレート天面設置
  robot_base       → robot_mount      (fixed/fastened) ロボットボルト締結
  container_a      → workbench        (null/above)    コンテナA設置
  container_b      → workbench        (null/above)    コンテナB設置
  floor_outlet     → workbench_origin (null/connects) 電源ケーブル配線 2800mm
```

**Position geometry (mm):**
- Workbench bottom: z=0, top: z=800
- Base plate bottom: z=800, top: z=830  (workbench top + plate thickness)
- Robot bottom: z=830, center: z=1090   (base plate top + robot half-height)
- Containers bottom: z=800, center: z=875

---

## Consequences

### Positive
- **External automation**: CI/CD pipelines and scripts can generate scenes without a running browser
- **LLM-safe**: AI produces DSL (safe vocabulary), never executable code — consistent with ADR-044
- **Zero domain coupling**: `LayoutCompiler` has no Three.js / SceneService dependency; testable with `node --test`
- **Round-trip fidelity**: output passes through `parseImportJson()` unchanged (version 1.3)
- **Deterministic IDs**: `ref`-based ID generation makes outputs reproducible for testing

### Negative / Trade-offs
- **Phase 1: clear-only import**: `importFromJson({clear: true})` replaces the whole scene.
  Merging a layout into an existing scene is deferred to Phase 2.
- **Manual position in Phase 1**: the `strategy` engine handles simple geometric strategies;
  constraint-solver-based automatic positioning (where you describe constraints and the solver
  finds valid positions) is deferred to Phase 2.
- **LLM accuracy ceiling**: the `interpret` command's quality is bounded by the AI's understanding
  of 3D geometry and IFC class names. A well-structured Layout DSL template improves accuracy
  significantly over free-form generation.

---

## Rejected Alternatives

**Server-only LayoutCompiler** — would prevent future browser-side scripting UI and force all
layout generation through the BFF. Rejected in favour of `src/layout/` shared module.

**importFromJson merge mode as Phase 1 default** — the existing command infrastructure ties
`importFromJson` to `AppController` state; a merge path would require changes to the controller
and view layers. Deferred rather than rushed.

**AI generates scene JSON directly** — fragile; AI hallucination produces invalid corner arrays,
wrong quaternion formats, or missing Origin CFs that violate ADR-037. The DSL is a safe
intermediate vocabulary that constrains the AI's output space.
