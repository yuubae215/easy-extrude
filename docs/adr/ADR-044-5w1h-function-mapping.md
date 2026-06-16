# ADR-044 — 5W1H Function Mapping: Homomorphic Bridge Between Natural Language and Automation

**Status**: Draft  
**Date**: 2026-06-01  
**Supersedes**: —  
**Related**: ADR-030 (SpatialLink), ADR-039 (Operation State Machine), ADR-041 (Semantic Inference), ADR-022 (Undo/Redo Command Pattern), ADR-052 (5W1H ユビキタス言語 — 本 φ を文脈全体へ一般化), ADR-051 (要件入力 — φ を入口 D の抽出ブリッジに), ADR-046 (Context DSL)

---

## Context

easy-extrude exposes a rich set of operations (grab, rotate, create-solid, fasten-frame, spatial
links, map annotations, etc.) but users must know the exact tool name or keyboard shortcut to
invoke them. There is no path from "I want to constrain this box inside this zone" to the
appropriate two-click sequence (`L` key → pick zone → choose `bounded_by`).

The deeper goal is a pipeline that closes the gap between human intent and automated execution:

```
Natural language → Requirement parsing → Function selection → Automated execution
```

The critical design constraint: **AI must never generate arbitrary code**. Arbitrary code generation
is fragile (hallucination, invariant violations, undo-stack corruption). The safe alternative is to
constrain the AI to *selecting from a pre-defined registry of safe operations* — like Scratch blocks
that can only connect in valid ways.

This ADR defines the structural contract for that constraint mechanism.

---

## Mathematical Foundation

The mapping from human intent to executable functions is a **homomorphism**:

```
φ : M_intent → M_code
```

Where:
- **M_intent** — the world of human semantic concepts, composed by natural language connectors  
  (`"そして"`, `"〜したあと"`, `"次に"`, `"and then"`, `"then"`)
- **M_code** — the world of registered, safe functions in the system, composed by sequential  
  pipeline execution (`;`)

**The homomorphic property:**

```
φ(A ∘ B) = φ(A) ; φ(B)
```

A user who composes two intents sequentially ("create a box, then fix it") produces the same
result as the sequential execution of the individually mapped functions. The structure is preserved
across the mapping.

**Why homomorphism, not isomorphism:**  
φ is intentionally many-to-one (surjective). Many natural language expressions
(`"move"`, `"place"`, `"drag"`, `"位置を変える"`, `"配置する"`) map to one function descriptor
(`grab-move`). This surjection abstracts away language noise, projecting it onto a discrete, safe
set of operations. Ambiguity is resolved at the boundary; once inside M_code, execution is
deterministic.

**φ⁻¹ (partial inverse — macro recording):**  
Because each command maps to exactly one descriptor ID (by registry construction), the reverse
direction `CommandStack → FunctionDescriptor[]` is well-defined as a partial inverse. It is NOT
a full inverse of φ (synonym information is discarded), but it IS sufficient to reconstruct a
human-readable execution plan from a sequence of manual operations — enabling "macro recording
without programming."

---

## Decision

Implement a **5W1H Function Mapping System** as a structural bridge between natural language and
automation programs. The system consists of four components:

### 1. The 5W1H Graph Structure

Every operation is described as a three-level directed graph:

```
Why  (top)    — Goal / return value / success condition
  │
How  (middle) — The function or algorithm that achieves the Why
  │
What (bottom) — The arguments / concrete data the How operates on
```

In code terms:
```
return_value  (Why: was the goal achieved? success / failure / pending)
  = function_name  (How: one of several possible methods for this goal)
    (arguments)    (What: concrete entities, specs, sub-functions)
```

Example (connector insertion):
```
connected: boolean  (Why: is the connector mated?)
  = insert_connector  (How: wiggle-insert vs. straight-insert)
    (plug_spec, socket_spec, insertion_fn)  (What: geometry + sub-method)
```

`context.requiredSelection` plays the role of Scratch block connectors — it determines which
descriptors can validly follow which in a sequence. Only compatible blocks connect.

### 2. FunctionDescriptor — Unit of the Homomorphism

```js
/**
 * @typedef {Object} FunctionDescriptor
 * @property {string} id
 * @property {{ description: string, successCondition: string, keywords: string[],
 *              returnType: 'void'|'status'|'entity' }} why
 * @property {{ description: string, invoke: string, alternatives: string[] }} how
 * @property {{ parameters: Array<{name: string, entityType: string, description: string}> }} what
 * @property {{ modes: string[], requiredSelection: string[] }} context
 */
```

- **`why.keywords`**: bilingual (EN + JA). English is canonical (matches function signatures);
  Japanese is additive. Example: `['move', 'grab', 'drag', '移動', '配置', 'グラブ']`
- **`how.invoke`**: action key dispatched by `AppController._executeRecommendation()`
- **`context.modes`**: editor modes where this descriptor is available (empty = all modes)
- **`context.requiredSelection`**: entity types that must be selected (empty = no restriction)

### 3. ExecutionPlan — The SSOT

The system introduces one canonical intermediate representation that acts as the
**Single Source of Truth (SSOT)** between natural language and code:

```js
/** @typedef {Array<{ id: string, params: Record<string, any> }>} ExecutionPlan */

// Example:
const plan = [
  { id: 'create-solid', params: { position: 'center' } },
  { id: 'scale-solid',  params: { factor: 2 } },
  { id: 'fasten-frame', params: {} },
];
```

All components read from and write to `ExecutionPlan`:
- `SequenceParser` produces it from NL
- Q&A Wizard UI presents it one step at a time
- Block Editor UI presents it as re-orderable blocks
- `SequenceExecutor` consumes it to drive `AppController`

Because `ExecutionPlan` is a plain data array, the two UI modes are thin rendering shells with
no business logic. Switching between wizard and block view is a view-layer concern — the data
never changes.

### 4. Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Natural Language                                  │
│  「Aを右に移動して、そのあと固定して」                          │
└────────────────────┬────────────────────────────────────────┘
                     │  φ  (FunctionMatcher + SpatialCommandParser)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: ExecutionPlan (SSOT / Puzzle Blocks)              │
│  [{ id: 'grab-move', params: { target: 'A', axis: '+X' } },│
│   { id: 'fasten-frame', params: {} }]                      │
└────────────────────┬────────────────────────────────────────┘
                     │  dispatch  (AppController._executeRecommendation)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Executable Code                                   │
│  _startGrab(); SceneService.fastenFrame();                  │
│  (CommandStack records each step — full undo support)       │
└─────────────────────────────────────────────────────────────┘
```

**Bi-directional mapping:**
- **φ (forward)**: Layer 1 → Layer 2 → Layer 3  
  User types natural language; system matches, binds parameters, and executes.
- **φ⁻¹ (reverse)**: Layer 3 → Layer 2 → Layer 1  
  User performs operations manually; system reads `CommandStack`, maps each command back to its
  descriptor ID, synthesises an `ExecutionPlan`, and offers:  
  *「この一連の操作をマクロとして保存しますか？」*  
  User confirms → plan saved to registry as a reusable sequence.

---

## Phase Roadmap

### Phase 1 — Intent Identification

Map a single natural language query to a single descriptor, produce a 1-element `ExecutionPlan`,
and present a minimal Q&A wizard confirmation: *「〇〇を実行しますか？ [Enter] [Esc]」*

**Components:**
- `src/service/FunctionRegistry.js` — pure data; ~12 initial descriptor entries
- `src/service/FunctionMatcher.js` — pure computation; TF cosine similarity; no external model
- `src/view/UIView.js` — command palette (triggered by `?` key) + minimal wizard
- `src/controller/AppController.js` — key binding, `_executeRecommendation(descriptor)`

**Matching algorithm — Term-Frequency Cosine Similarity:**
1. Pre-compute normalised TF vectors from each descriptor's keywords + description at module load
2. Tokenise query: split on whitespace + punctuation; for Japanese, also extract character bigrams
3. Compute `cosine_similarity(query_vec, descriptor_vec)` for each descriptor
4. Filter by `context.modes` and `context.requiredSelection`
5. Return top-5 (score > 0)

Extension hook: `setEmbeddingFn(async (text) => Float32Array)` — when set, replaces TF vectors
with semantic embeddings (e.g., Claude API). Falls back to TF when unavailable.

**Initial registry (12 entries):**

| id | why | how.invoke | requiredSelection |
|----|-----|------------|-------------------|
| `grab-move` | Translate objects to a new position | `grab` | any |
| `rotate-solid` | Rotate a solid around its centre | `rotate` | Solid |
| `create-solid` | Add a new 3D box to the scene | `create-solid` | none |
| `extrude-sketch` | Extrude a 2D sketch into a 3D solid | `extrude` | Profile |
| `delete-object` | Remove the selected object | `delete` | any |
| `fasten-frame` | Fix a coordinate frame rigidly to another | `fasten-frame` | CoordinateFrame |
| `create-spatial-link` | Annotate a relationship between two entities | `link-mode` | any |
| `create-coordinate-frame` | Add a reference frame to a solid | `add-frame` | Solid |
| `set-place-type` | Classify a map annotation | `set-place-type` | AnnotatedLine\|AnnotatedRegion\|AnnotatedPoint |
| `measure-distance` | Measure the distance between two points | `measure` | none |
| `create-zone` | Draw a zone polygon on the map | `map-zone` | none |
| `create-route` | Draw a route path on the map | `map-route` | none |

### Phase 2 — Spatial Parameter Extraction

Parse spatial tokens from the query and resolve them to function arguments automatically.

Example: *「Aを右に移動して」* →
- operation: `grab-move`
- extracted params: `{ target: 'A', axis: '+X' }`

**Component:** `SpatialCommandParser` — maps directional tokens
(`right/left/above/below/between` and `右/左/上/下/間`) to axis constraints and entity
references. Binds extracted params to `FunctionDescriptor.what.parameters` before execution.

### Phase 3 — Multi-Step Sequence Control

User inputs a composite requirement; the system decomposes it into an `ExecutionPlan` and
presents it via the hybrid UI before executing.

Example: *「中心に立方体を作って、2倍に拡大したあと、固定して」*  
→ `[{id:'create-solid'}, {id:'scale-solid', params:{factor:2}}, {id:'fasten-frame'}]`

**Hybrid UI — two views of the same SSOT:**

| Mode | Trigger | UX |
|------|---------|-----|
| Q&A Wizard (default) | auto | Step-by-step confirmation, one prompt per step |
| Block Editor | "詳細編集" | Drag-reorder, inline parameter edit, Scratch-like visual |

**SequenceParser** maps language conjunctions (`"そして"`, `"〜したあと"`, `"次に"`,
`"and then"`, `"then"`) to array boundaries — realising `φ(A ∘ B) = φ(A) ; φ(B)`.

**SequenceExecutor** iterates `ExecutionPlan`, dispatches each step to `AppController`, and
records one `Command` per step on the undo stack — full undo support for automated sequences.

**Safety: Human-in-the-loop is mandatory.**  
Before executing any multi-step plan, the UI presents the interpreted `ExecutionPlan` for review.
The user confirms (Enter) or cancels (Esc). Destructive operations (`delete-object`) additionally
require explicit confirmation even within a plan.

**φ⁻¹ (macro recording):**  
`CommandStack → descriptor IDs → ExecutionPlan → NL summary`. System offers:  
*「この操作をマクロとして保存しますか？」* — user confirms → plan saved as reusable sequence.

---

## Constraints

1. **Registry as the safe execution space** — operations not in the registry cannot be
   executed via this pathway. Every new operation implemented in the codebase must ship with
   a `FunctionDescriptor`. The registry IS the system's machine-readable manual; its coverage
   determines the reachable automation space.
2. **Pure computation** — `FunctionRegistry.js` is pure data; `FunctionMatcher.js` is a pure
   function. No DOM, no Three.js, no I/O. Consistent with `SemanticInferencer.js` (ADR-041).
3. **Layer separation** — matching logic lives in `src/service/`, rendering in `src/view/`,
   wiring in `src/controller/`. Domain layer (`src/domain/`) is never modified by this system.
4. **φ never generates code** — the matcher returns a descriptor ID; `AppController` dispatches
   to already-implemented handlers. The matching step cannot produce side effects.
5. **Human-in-the-loop for multi-step** — `SequenceExecutor` never auto-executes without
   showing the `ExecutionPlan` for user review first.

---

## Consequences

### Positive

- Users can describe intent in natural language (EN or JA) and reach any registered operation
  without knowing its name, key binding, or toolbar location.
- The registry doubles as machine-readable documentation: its `why.description` and `how.invoke`
  are the authoritative spec for what the system can do.
- SSOT (`ExecutionPlan`) decouples UI from logic — wizard, block editor, or future voice interface
  all use the same data structure; switching UI is a view-layer concern only.
- φ⁻¹ enables macro recording without any new infrastructure — `CommandStack` already exists.
- TF cosine matching requires no external service, no corpus loading, no network — works offline.
- Full undo support: each step in a `SequenceExecutor` run pushes one `Command`, so the entire
  automated sequence is undoable step-by-step via the existing undo stack.

### Negative / Trade-offs

- **Registry coverage ceiling**: operations not in the registry are unreachable via NL. Engineers
  must add a descriptor for every new operation (this is also the intended development rule).
- **TF cosine accuracy**: weaker than semantic embeddings for rare synonyms or paraphrases. Phase
  2+ should integrate the `setEmbeddingFn` hook with an embeddings API.
- **Phase 3 complexity**: `SequenceParser` must handle ambiguous language connectors
  (does `"それ"` refer to the last entity or the whole previous step?). LLM integration is
  strongly recommended for Phase 3 decomposition.
- **Partial inverse only**: φ⁻¹ discards synonym information — macro recording produces a plan
  with canonical descriptor IDs, not the user's original wording.

---

## Rejected Alternatives

**Ask AI to generate arbitrary code directly** — fragile; AI hallucination can produce invalid
method calls, violate domain invariants, and corrupt the undo stack. Rejected in favour of the
registry-constrained approach.

**Keyword exact-match only** — too brittle; natural language variation requires at minimum
token overlap scoring. TF cosine provides a principled baseline with no external dependency.

**Single-layer (NL → code, no intermediate representation)** — without `ExecutionPlan` as SSOT,
UI modes (wizard / block editor) would each need separate parsing and dispatch logic, diverging
over time. The SSOT keeps all UI modes in sync by construction.

**Isomorphic (1-to-1) mapping** — would require a unique phrase for every synonym of every
operation. Impossible to enumerate; the surjective homomorphism is the correct structure.
