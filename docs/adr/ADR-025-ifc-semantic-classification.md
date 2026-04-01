# ADR-025 — IFC Semantic Classification of Scene Objects

**Status:** Accepted
**Date:** 2026-04-01
**Author:** Claude Code

## Context

easy-extrude allows users to model 3D geometry (Solid, ImportedMesh) by
drawing and extruding shapes.  Once a scene contains many objects — walls,
columns, slabs, doors — they all look similar in the outliner and N-panel:
just a name and a colour-coded bounding box.  There is no machine-readable
indication of what each object *means* in the built environment.

The IFC (Industry Foundation Classes) standard — used by virtually every BIM
authoring tool — defines a vocabulary of semantic entity types such as
`IfcWall`, `IfcColumn`, `IfcSlab`, and `IfcDoor`.  Assigning an IFC class to
an object gives it a semantic identity that:

1. Makes the scene immediately more legible to human readers (colour badge,
   text label).
2. Enables future features: filtered export, rule-based validation, quantity
   take-off, IFC file generation.
3. Does not require changing the geometry model — it is pure metadata.

The user motivation was explicitly stated: *"直方体とかだとオブジェクトが何か
分からないので意味付けをしたかった"* — "I wanted to give meaning to what
otherwise is just an anonymous box."

## Decision

Introduce an **optional IFC class field** on the two persistent geometry
entities `Solid` and `ImportedMesh`.  Classification is surfaced through the
N-panel and the Outliner.  Assignment and removal are undoable commands.

### Scope

| Entity       | Classifiable | Rationale |
|---|---|---|
| `Solid`          | ✓ | Primary persistent geometry entity |
| `ImportedMesh`   | ✓ | Read-only geometry may already carry IFC identity |
| `Profile`        | ✗ | Transient draft; disappears on extrude |
| `CoordinateFrame`| ✗ | Reference frame, not a building element |
| `MeasureLine`    | ✗ | Annotation, not a building element |

### Data model

```
Solid.ifcClass:       string | null   // e.g. 'IfcWall' or null
ImportedMesh.ifcClass: string | null
```

The value is an IFC4 class name string.  `null` means "unclassified".

### Registry

`src/domain/IFCClassRegistry.js` exports a curated list of ~23 commonly used
IFC4 classes grouped into five categories: Structural, Architectural, Site,
Equipment, Generic.  Each entry carries a display label and a hex colour code
for visual representation.

The full IFC schema (800+ classes) is intentionally not exposed.
Discoverability and usability take priority over completeness.

### UX

**N-panel (Properties panel):**
- A new "IFC Class" section appears between the Dimensions and Description
  sections for `Solid` and `ImportedMesh` objects.
- The current class is shown as a coloured badge (colour derived from the
  registry entry) or "Not set" in muted grey.
- A "Set / Change" button opens a floating picker overlay with a search input
  and grouped list of IFC classes.
- A "✕" button clears the classification.

**Outliner:**
- A small coloured badge appears to the right of the object name when a class
  is assigned.  It is hidden when the class is null.

**Undo/Redo:**
- `SetIfcClassCommand` records old and new class names.
- Assignment and clearing are both undoable.

### Persistence

`SceneSerializer` includes `ifcClass` in the `Solid` and `ImportedMesh` DTOs.
Older saved scenes (without the field) default to `null` on load (backward
compatible, because `dto.ifcClass ?? null`).

### Domain event

`SceneService` emits `'objectIfcClassChanged'(id, ifcClass)` after every
assignment.  `AppController` subscribes and forwards to `OutlinerView`.

## Alternatives Considered

### A — Store IFC class as a separate service-level map

Keep IFC class data entirely outside domain entities (a `Map<id, string>` in
`SceneService`).  

Rejected: the class is intrinsic identity metadata, not a view concern.  It
belongs with the entity, like `name` and `description`.

### B — Use a numeric enum instead of a string class name

Define `IFC_CLASS.WALL = 0`, etc. for a compact storage format.

Rejected: IFC class names are already stable identifiers in an international
standard.  String storage is directly readable in JSON exports and avoids
a translation table.

### C — Support the full IFC4 schema (800+ classes)

Present a complete class hierarchy picker.

Rejected for now.  A curated list of ~23 classes covers >95% of practical use
cases and is far more usable than an overwhelming hierarchy.  The registry can
be extended incrementally.

## Consequences

- **Positive:** Objects gain machine-readable semantic meaning.  The scene is
  more legible at a glance (colour badges in outliner and N-panel).
- **Positive:** Backward-compatible serialization — old scenes continue to load.
- **Positive:** Foundation for IFC file export, rule-based queries, and BIM
  workflows.
- **Neutral:** `Solid` and `ImportedMesh` constructors are unchanged; the field
  is post-construction-assigned like `description`.
- **Negative (minor):** The outliner row is slightly wider when a badge is shown.
  Mitigated by `maxWidth: 52px` clipping.

## References

- ADR-020 — Domain Entity Taxonomy (Solid / Profile / Frame / Annotation)
- ADR-021 — Unified Local-Geometry Graph Interface
- ADR-022 — Undo / Redo via Command Pattern
- ADR-013 — Domain Events — Making SceneService Observable
- [IFC4 ADD2 specification](https://standards.buildingsmart.org/IFC/DEV/IFC4_2/FINAL/HTML/)
- [BonsaiBIM](https://bonsaibim.org/) — Blender add-on (IFC authoring reference)
