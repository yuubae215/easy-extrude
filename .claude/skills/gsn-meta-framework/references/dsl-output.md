# `.gsn` DSL Output Format

Read this when the deliverable is a `.gsn` file for the **GSN Assurance VS Code extension**. This is a self-contained emission spec — the skill does not depend on any other skill.

## Entity types

Six keywords: `goal`, `strategy`, `solution`, `context`, `assumption`, `justification`.

Each entity requires:
- the **type keyword** followed by a **unique identifier** with no spaces (PascalCase or snake_case),
- a **`uuid`** line (UUID v4),
- a **`summary`** line, description in double quotes.

```
goal SystemIsSafe
uuid 12345678-1234-5678-1234-567812345678
summary "System X is acceptably safe to operate within operating concept Y"
```

## Hierarchy

Parent/child relationships are expressed by **4-space indentation** — nest children under their parent:

```
goal TopGoal
uuid ...
summary "..."

    strategy Decomp
    uuid ...
    summary "Argument by addressing all identified hazards"

        goal SubGoal1
        uuid ...
        summary "..."

            solution Evidence1
            uuid ...
            summary "..."
```

## Optional properties

- `state Approved` — one of `Approved`, `Disapproved`, `UnderReview`, `ToBeReviewed`, `ToBeDeveloped`. Use `ToBeDeveloped` for goals still resting on assumptions. `state` tracks **freshness of evidence**, not whether support exists at all — see the support labels below.
- `artifacts` — a list of supporting document paths/URLs, each on a `- "…"` line. Paths are resolved **relative to the repo root** and must exist; the linter errors on a dangling path under a `solution` (a solution asserts the evidence is there) and warns under other node types (a context may cite a document still to be written).
- `labels safety-critical, automotive` — classification tags. Two values are **reserved and linted** — see below.
- `groups module-A, phase-1` — grouping.

## Support cardinality — a goal with nothing under it must say so

A goal supported by nothing has no node to inspect. Every check written against the content
a goal *has* passes it in silence, so an unstarted branch reads exactly like a finished one.
The linter therefore tests the **zero itself**: a goal must either be supported (≥1 `strategy`,
`solution`, or sub-`goal`) or carry exactly one reserved label declaring which zero it is.

| Label | Meaning | Requirement | Next action |
|---|---|---|---|
| `support-exploring` | 探索中 — the check that would settle this goal is named, but has not run | ≥1 `assumption` child naming it (usually `"証拠予定: …"`) | run or write that check |
| `support-unexplored` | 未探索 — nothing has been named yet | none | decide what would settle it |

Both are the same `state ToBeDeveloped`, which is why the distinction needs its own field:
one has a falsifiable next step, the other only an admission. `gsn_tool.py stats` reports the
split, so "14/15 ToBeDeveloped" resolves into how much is actually in flight.

The labels are declarations of **absence** — the linter errors if one survives on a goal that
has since gained support, and if `support-exploring` names no assumption ("`support-unexplored`
wearing a costume").

## Namespace

Begin a file (or a module in a multi-file project) with:

```
GOALS safety_analysis
```

## Generating UUIDs

Batch-generate all needed UUIDs up front, then write the file:

```bash
python scripts/gsn_tool.py uuid --count <number-of-entities>
```

They must be unique across the whole model — the linter enforces this.

## Mapping this skill's node roles to the DSL

| Skill node | DSL keyword | Notes |
|---|---|---|
| Goal (G) | `goal` | present-tense true/false claim |
| Strategy (S) | `strategy` | "Argument by …" |
| Solution/Evidence (Sn) | `solution` | leaf evidence |
| Context (C) | `context` | scoping/background |
| Assumption (A) | `assumption` | mark parent goal `state ToBeDeveloped` if it still depends on this |
| Justification (J) | `justification` | approach rationale |
| Counter-argument (CA) | `justification` | no native CA type — emit as a justification like "Withstands challenge: H2 tolerance holds under alt. reading of FTA" |

## Full emission example

```
GOALS safety_analysis

goal SystemXSafe
uuid <uuid-1>
summary "System X is acceptably safe to operate within operating concept Y"
state ToBeReviewed

    context SystemDesign
    uuid <uuid-2>
    summary "System X design (Ref A)"

    strategy AddressHazards
    uuid <uuid-3>
    summary "Argument by addressing all identified hazards"

        goal HazardsMitigated
        uuid <uuid-4>
        summary "All identified hazards are eliminated or sufficiently mitigated"

            goal H1Eliminated
            uuid <uuid-5>
            summary "Hazard H1 is completely eliminated"

                solution DesignDrawing
                uuid <uuid-6>
                summary "Design Drawing (Ref E)"
                artifacts
                - "evidence/design_drawing_E.pdf"

            goal H2Tolerable
            uuid <uuid-7>
            summary "Probability of hazard H2 is reduced to a tolerable level"
            state ToBeDeveloped

                assumption H2Tolerance
                uuid <uuid-8>
                summary "Occurrence probability threshold for H2 is defined as tolerable (Ref D)"

                solution FTA
                uuid <uuid-9>
                summary "FTA (Ref F)"
```

## Before delivering

Run the linter — do not hand-verify what it checks:

```bash
python scripts/gsn_tool.py lint <file>.gsn      # required fields, UUIDs, support cardinality, artifact existence
python scripts/gsn_tool.py stats <file>.gsn     # depth (keep 3–5), fan-out (2–7 per strategy), evidence debt split
python scripts/gsn_tool.py mermaid <file>.gsn   # optional: diagram for review
python scripts/gsn_tool.py selftest             # the linter's own fixtures (run after editing gsn_tool.py)
```

Fix every error the linter reports, re-run until clean, then present the finished `.gsn` file to the user with `present_files` (or leave it in the repo when working in Claude Code).
