# ADR-054 — UI → DSL → BFF → Grasp API Verification Walkthrough

**Status**: Accepted
**Date**: 2026-06-22
**Supersedes**: —
**Related**: ADR-045 (Layout DSL / REST API), ADR-050 (Context-First Project Model),
ADR-046 (Context DSL), ADR-015 (BFF + Microservices), ADR-017 (WebSocket / Geometry
Service), ADR-053 (robotics KPI methods — the predicates the solver answers)

---

## Context

The pieces of the thread "the UI produces a layout declaration, sends it through the
BFF server, and requests the external grasp-search **API**" already exist
independently, but were never wired together end to end:

- **Forward compile** (ADR-045): `Layout DSL → compileLayout() → Scene JSON v1.3`
  (pure, `src/layout/`), exposed by the BFF as `POST /api/layout/compile`.
- **Grasp boundary**: `POST /api/grasp/search` validates the request against the neutral
  contract `@easy-extrude/grasp-contract`, stamps the canonical `contractVersion`,
  delegates the actual solving to the external grasp-search service, and detects drift
  at both ends (400 inbound mismatch/non-conformance, 502 upstream drift/non-conformance,
  503 upstream unreachable).
- **Frontend client** `src/service/BffClient.js`: scene CRUD + STEP import + WebSocket —
  but **no** `compileLayout` and **no** `graspSearch` methods, and no UI to drive them.

The open question was the *canonical access route*: where does the UI get a Layout DSL?
The answer follows from the existing architecture rather than inventing anything:

> **The canonical route is Context-first (ADR-050 / ADR-046).** A user authors or loads a
> Context document (Template Gallery / `.ctx.json` import / intake); `ContextService`
> already derives the scene via `compileContext → compileLayout → importFromJson`. The
> Layout DSL is the intermediate `compileContext` produces and `ContextService` already
> holds — **`ContextService.getCompiled().layoutDsl`**.

This respects the repository scope boundary (CLAUDE.md "スコープ境界"): this repo is the
**declaration & schema** layer. We do **not** reverse-engineer a DSL from the live scene
(a lossy inverse), and we do **not** solve constraints — the external grasp-search
service owns IK / collision / reach / ranking. The walkthrough only *declares* a request
and *displays* the solver's answer.

## Decision

The walkthrough is a thin client + UI layer over the existing pure compilers and the
existing BFF endpoints. **The BFF and the contract are unchanged** (scope boundary).

### 1. The user-story thread

```
[User] author/load Context (Template Gallery | import .ctx.json | intake)   ← existing (ADR-050/051)
   └─ ContextService.loadContext → compileContext → compileLayout → scene    ← existing
[User] Context ▾ → "Grasp Search…", set objective weights + topN
   └─ layoutDsl = ContextService.getCompiled().layoutDsl                     ← canonical extraction
   ├─ Step A (round-trip verify):  BffClient.compileLayout(layoutDsl)
   │     → POST /api/layout/compile → Scene JSON v1.3 → "BFF compile OK"
   └─ Step B (grasp request):      BffClient.graspSearch(request)
         → POST /api/grasp/search → BFF stamps contractVersion + delegates
         → external grasp-search service (GRASP_SEARCH_URL) → ranked candidates
[UI] render candidates (rank / pose.joints / score.{withinReach, ikSolvable,
     interferenceFree, totalScore}); 400/502/503 surface their reason as toasts (PHILOSOPHY #11)
```

Step A is a *verification* step: the BFF reproduces the scene from the **same** DSL the
UI derived, proving the declaration round-trips across the network. It is not strictly
required for the grasp request (the contract references the layout by `layoutVersion`,
not inline) but it is the cheap, honest proof the UI→BFF leg works before the more
expensive solver call.

### 2. BffClient additions

Two methods are added to `src/service/BffClient.js`, reusing the existing token plumbing
(the routes are JWT-protected, so `fetchToken()` precedes them via `SceneService.connectBff()`):

- `compileLayout(dsl)` → `POST /layout/compile`, returns Scene JSON v1.3.
- `graspSearch(request)` → `POST /grasp/search`, returns `{ candidates }`.

Both go through a new private `_postContract(path, body)` that **surfaces the BFF's
`{ error, details }` envelope and HTTP status** instead of collapsing every 5xx into an
opaque `BffUnavailableError`. The walkthrough must show *why* it failed — contract
mismatch (400), upstream drift/non-conformance (502), upstream unreachable (503). A
genuine BFF network failure (the BFF itself down) still throws `BffUnavailableError`.

### 3. Request assembly conforms to the vendored schema; the UI never stamps the version

The request is assembled to fit `grasp-search-request.schema.json` exactly
(`additionalProperties:false` at the top level):

```json
{ "layoutVersion": "layout/1.0", "graspSearch": { "objectiveWeights": { "reach": 0.6, "clearance": 0.4 }, "topN": 5 } }
```

The layout content is referenced by `layoutVersion` (the contract keeps the grasp-search
declaration open on purpose — the detailed shape is owned by the Layout DSL schema). The
UI **must not** set `contractVersion`: the BFF owns and stamps the canonical value, and a
*present* mismatch from the UI would be rejected with 400. The contract is read-only here
(`vendor/grasp-contract`, a git submodule); to change it, edit the upstream schema and
bump `contractVersion` (CLAUDE.md "BFF と契約").

### 4. UI surface

`ContextController.runGraspSearch({ weights, topN })` coordinates the thread (a *query*,
not a doc mutation — geometry is invariant — so it does **not** touch the CommandStack).
It reads `getCompiled()?.layoutDsl` (toast + return when there is no renderable layout —
blank / requirements-only docs have none, PHILOSOPHY #11), ensures a JWT'd `BffClient`
(`SceneService.connectBff()` on demand), runs Step A then Step B, and pushes results into
the `context.grasp` uiStore slice.

`GraspSearchPanel.jsx` is a transient modal (z-index 300, above all edge panels —
PHILOSOPHY #26; 3-D-independent ⇒ usable full-width on mobile) opened from the
`Context ▾` menu. It shows the source-layout summary, objective-weight + topN inputs, a
Run button, a status line, the ranked candidate list (rank, scores, joints), and the
error envelope with its `details`.

### 5. Scope boundary

The UI and the BFF only **declare** the request and **display** the solver's response. No
IK / collision / reach / ranking is implemented here (CLAUDE.md AI guard) — that is the
external grasp-search service's responsibility (ADR-053 names the predicates it answers:
`robot_reach`, `collision_free`, …). The BFF endpoints are reused unchanged; the contract
submodule is read-only.

## Consequences

### Positive

- Proves the full thread (UI declaration → BFF → external API → UI) end to end with no
  new server code and no contract change — the lowest-risk way to validate the seam.
- Follows the canonical Context-first route, so the walkthrough doubles as a smoke test
  of the ADR-050/045 pipeline.
- Failure reasons (400/502/503) reach the user verbatim, so a missing/incompatible
  grasp-search service is a clear message, not a silent hang.

### Negative / Trade-offs

- Requires the `vendor/grasp-contract` submodule to be initialised and the external
  grasp-search service to be reachable (`GRASP_SEARCH_URL`) for a *successful* run; when
  it is down the walkthrough stops cleanly at a 503 toast (the graceful path).
- The Layout DSL is only available when a Context with a non-empty layout is loaded;
  blank / requirements-only docs surface a guiding toast instead of opening the panel.

## Rejected Alternatives

- **Reverse-compile a Layout DSL from the live scene** (`buildLayoutDslFromScene`). The
  scene→DSL inverse is lossy (it drops the declarative "why" — strategy, intent) and would
  be substantial new code. The canonical artifact is the Context doc, which already holds
  the Layout DSL as a compile intermediate — no inverse is needed.
- **Send the request straight from the UI to the grasp-search service.** That bypasses the
  BFF's contract validation / version stamping and the scope boundary; the BFF is the one
  place that enforces the neutral contract at both ends.
- **Add the layout/scene inline to the grasp request.** The contract references the layout
  by `layoutVersion` and keeps the declaration open on purpose; inlining would require a
  contract change, which is upstream-owned, not a change to make here.

## Validation Scenario

1. `git submodule update --init vendor/grasp-contract && pnpm install`.
2. Contract boundary regression: `pnpm test:contract` (12 tests).
3. Start the BFF pointed at the **real** grasp-search service:
   `GRASP_SEARCH_URL=<url> JWT_SECRET=dev node server/index.js`; health at
   `GET /api/health`.
4. `pnpm dev` → load a Context (Context ▾ → New Project template, or import `.ctx.json`).
5. Context ▾ → **Grasp Search…** → set weights/topN → **Run**. Expect "BFF compile OK"
   then ranked candidates with scores. If the service is down, expect a clear 503 toast.
6. Quality gates: `pnpm test:context` (incl. `BffClient.test.js`), `tsc --noEmit`,
   `vite build` — all clean.
