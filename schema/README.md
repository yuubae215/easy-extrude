# DSL Schemas — the shape contract for Layout DSL and Context DSL

Closed, versioned JSON Schema artifacts for the two DSLs this repository
declares as its public surface (CLAUDE.md「宣言とスキーマの層」). They give the
Layout / Context DSL the same rigor grasp-contract received: a machine-checked
shape contract with `additionalProperties:false` and a version field
(ADR-064 Phase 2, PHILOSOPHY #29 — rigor is the default for every wire).

| Schema | Wire form | Source of vocabulary |
|--------|-----------|----------------------|
| `layout-1.0.schema.json`  | `layout/1.0` (ADR-045, ADR-055) | `src/layout/LayoutDslSchema.js` |
| `context-0.4.schema.json` | `context/0.1`–`context/0.4` (ADR-046, ADR-049, ADR-053) | `src/context/ContextDslSchema.js` |

## Shape vs. meaning

These schemas are the **shape** contract only: the closed set of fields and the
enum vocabularies. The **meaning** contract stays in the JS validators and is
not duplicated here:

- `LayoutValidator.js` — ref resolution, ref uniqueness, `<ref>_origin` targets.
- `ContextValidator.js` — R1–R9 (orphan-spec, conflicts, negotiation clusters,
  blocked acceptance, stated→derived promotion, role-KPI obligations). A schema
  cannot express "every spec element has a trace link"; that is meaning, not shape.

Some inner nodes are **deliberately open** (`additionalProperties:true`), the
same way grasp-contract keeps `graspSearchDeclaration` open: `Fact.attrs`,
`constraint.properties`, and `meta.baseline` hold domain-extensible content.

## Single source of truth (§1.1)

The schema enums and the `*DslSchema.js` constants are two representations of
the same vocabulary. They are pinned together by the drift-binding tests in
`src/schema/LayoutSchema.test.js` and `src/schema/ContextSchema.test.js`: if a
constant gains a value the schema does not (or vice versa), CI fails. There is
no second definition that can silently drift.

## Validating an instance

```bash
node schema/tools/validate.mjs layout-1.0  examples/factory_layout.json
node schema/tools/validate.mjs context-0.4 examples/cell_robotics_context.json
cat my-doc.json | node schema/tools/validate.mjs context-0.4 -
```

`pnpm test` (the CI gate) runs the conformance + drift tests automatically —
every `examples/*.json` must conform, and a smuggled field must be rejected.
