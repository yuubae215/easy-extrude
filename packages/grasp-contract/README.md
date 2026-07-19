# @easy-extrude/grasp-contract

Neutral I/O contract shared by the BFF and the grasp-search and recommendation
services. Language-agnostic source of truth = JSON Schema; TypeScript and Python
both derive/validate from it.

## Where this repo sits (three repos, three jobs)

| Repo | Job | What never leaks out of it |
|---|---|---|
| **private** | Proof/search API logic (grasp solving, equivalence evidence) | Internal representations, solver details |
| **public** | Playful, game-feel UI + BFF that makes data entry painless | Presentation (approach vectors, ghost colors, animation) — derived client-side, never on the wire |
| **contract** (this repo) | The canonical contract schema, and nothing else | — it has no code to leak; it depends on nothing |

Both other repos depend on this one; this one depends on neither. The schema is
the source of truth: consumers generate types, they do not redefine the
contract. Rigor on the Wire, Play in the Client. (ADR-0006)

## What's inside

- `contract-version.json` — the canonical `contractVersion`, a single integer
  shared by every endpoint. Mismatch is rejected with 400 before the payload is
  read. To change the contract: edit the schema here and bump it. (ADR-0004)
- `schema/grasp-search-request.schema.json` — input (camelCase wire form).
- `schema/grasp-search-response.schema.json` — output (top-N ranking + score
  breakdown). `pose` is a closed kind-discriminated union
  (`endEffector` | `jointSpace`), not opaque and not a bag of optional siblings.
  Two layers, inverse rules: the decision/score layer stays closed/strict, while
  pose grows only by *adding a kind* (which bumps contractVersion). (ADR-0005)
  Also carries a required, closed `diagnostics` object — the per-search rejection
  funnel (`candidatesGenerated`, `rejectedBy*`, `feasible`, `returned`,
  `reachNearestMiss`) — so a client can explain an empty or thin result without
  any presentation riding the wire. (ADR-0007)
- `schema/recommendation-request.schema.json` — input (camelCase wire form).
- `schema/recommendation-response.schema.json` — output (ranking of equivalence
  *candidates*; never a boolean equivalence verdict).
- `examples/` — one canonical, known-good instance per endpoint. Start here:
  copy one, edit it, validate it. The test suite validates every example against
  its schema, so they cannot drift.

## Quick start for consumers

Validate a payload you are about to send (or just produced) without standing up
anything:

```sh
npm install
npm run validate -- grasp-search-request path/to/payload.json
cat payload.json | npm run validate -- recommendation-response -
```

`ok` + exit 0 means it conforms and its `contractVersion` matches the canonical
one. Anything else prints exactly why it would be rejected on the wire — the
same judgement the envelope + schema make at runtime.

Generating types:

- TypeScript: point `json-schema-to-typescript` (or similar) at `schema/*.schema.json`.
- Python: point `datamodel-code-generator` at the same files.

The instances in `examples/` are the fixtures your generated readers should be
able to consume — the conformance tests already prove they narrow type-safely
by switching on `kind`.

## Changing the contract

1. Edit the schema (`schema/*.schema.json`).
2. Bump `contract-version.json` by +1 — the only version-advancing operation.
3. Update the affected `examples/*.json` (tests fail loudly if you forget).
4. `npm test` — conformance must be all green (CI runs the same on every PR).
5. If the change is a design decision (new kind, new endpoint, new invariant),
   record it as an ADR in `docs/adr/`.

What the contract will not accept, by design: presentation fields on `pose`
(derive them client-side from the frame + convention), verdict fields on
recommendation proposals (the contract proposes, it does not decide), and
unknown fields in any decision/score layer.

## Conformance tests

`npm install && npm run test:contract` validates every canonical example
against its schema (drift detection at both ends), proves the `pose` union
reads type-safely by switching on `kind`, and pins the closed layers: opaque /
mixed / unknown-kind poses are rejected, and the score and proposal layers
reject smuggled fields.

## ADRs

Design decisions are recorded under `docs/adr/`:

- ADR-0004 — a single `contractVersion` is shared across every endpoint;
  mismatch is a 400 at the envelope. Adding an endpoint does not introduce a
  per-endpoint version.
- ADR-0005 — `pose` is a closed kind-discriminated union; the only intentional
  growth point is adding a kind.
- ADR-0006 — the three-repo responsibility split this repo is one corner of.
- ADR-0007 — grasp-search responses carry a required, closed `diagnostics`
  rejection funnel (aggregate solver-decided facts, no presentation) so clients
  can explain empty or thin results.

Architecture topology: `docs/architecture.mermaid`.
