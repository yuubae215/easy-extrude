# VERIFICATION Mode — Evidence-Executable GSN for Codebases

Goal: settle a claim about a codebase — "safe to merge", "behavior preserved", "coverage adequate", "production-ready" — with a GSN tree whose leaves are **executed checks**, not citations. The tree is built top-down like any assurance case, but every Solution is a command that was actually run, with its output captured and its commit recorded. The deliverable is a **verification report** (and optionally a `.gsn` file kept in the repo).

The defining rule: **anything not actually executed is an Assumption, not evidence.** If a check cannot be run (no environment, missing credentials, flaky infra), attach an Assumption node, mark the parent goal `ToBeDeveloped`, and say so in the verdict. Never present an unexecuted check as a Solution.

## Workflow

1. **Fix the top-level Goal** as a scoped, falsifiable claim. Attach Context: repo, branch/commit (`git rev-parse HEAD`), the diff under discussion, the definition of the property ("safe to merge" per this team's gates).
2. **Survey before decomposing.** Read the diff / module map first (`git diff --stat`, project layout, CI config). Decomposition patterns chosen blind produce trees that miss the actual risk.
3. **Choose a decomposition pattern** (below) and emit sub-Goals in standard verb-phrase form.
4. **Recurse until each leaf Goal maps to one executable check.** A good leaf is one command (or one short script) whose pass/fail directly settles the Goal.
5. **Execute the checks.** Run them; capture the salient output. Prefer machine-checkable exit criteria (exit code, coverage %, count = 0) over eyeballed logs.
6. **Attach Solutions with provenance.** Each Solution records: the command, the decisive output excerpt, the commit hash, and the date. Failures are findings, not embarrassments — keep the failing Solution, mark the parent Goal unsatisfied, and surface it in the verdict.
7. **Deliver the verdict** in the report template below. A verdict is one of: **HOLDS**, **HOLDS-WITH-ASSUMPTIONS** (list them), or **DOES-NOT-HOLD** (name the failing branch).

## Code-native decomposition patterns

Use the classic six patterns when they fit (a hazard analysis exists, a requirements spec exists…). For everyday engineering claims, these variants map better:

### V1. By Behavioral Contract — "the refactor preserved behavior"
- **Strategy:** `Argument by preservation of observable contracts`
- **Sub-goals:** public API surface unchanged → check: API-diff / exported-symbol diff; test suite passes identically → check: run suite on both revisions; serialized formats/DB schema unchanged → check: schema dump diff; performance within tolerance → check: benchmark delta.

### V2. By Risk Surface — "this PR is safe to merge"
- **Strategy:** `Argument by coverage of the change's risk surfaces`
- **Sub-goals:** one branch per surface the diff actually touches — changed modules, their reverse dependencies (`grep`/import analysis), config/migration files, security-sensitive paths (auth, input parsing, secrets). Derive the branches from the diff, not from a generic checklist.

### V3. By Quality Gate — "this is release-/production-ready"
- **Strategy:** `Argument by satisfaction of all release gates`
- **Sub-goals:** one branch per gate: build succeeds, tests pass, coverage ≥ threshold, lint/type-check clean, no known critical vulnerabilities (audit tools), docs/changelog updated. Take the gate list from the project's CI config where one exists — the project's own gates outrank a generic list.

### V4. By Test Adequacy — "our coverage is adequate"
- **Strategy:** `Argument by adequacy of testing across risk-weighted areas`
- **Sub-goals:** critical paths have dedicated tests (name them); coverage per critical module meets target → check: coverage report; edge/error paths exercised → check: search for negative tests; a mutation- or fault-injection spot check on the highest-risk function where tooling allows. Raw total coverage % alone never settles this Goal — pair it with the critical-path branch.

### V5. By Module (code analogue of By Components)
- **Strategy:** `Argument by decomposition across modules/services`
- Use when the claim spans an architecture: one branch per module, each recursing into V2–V4 as appropriate.

## Evidence quality ladder

When choosing checks, prefer higher rungs; note the rung when the argument leans on a low one.

1. **Executed, deterministic** — test run, type check, build, schema diff. Strongest.
2. **Executed, statistical/heuristic** — benchmarks, fuzz runs, mutation samples. Strong, state variance.
3. **Static inspection** — grep results, dependency graphs, manual code reading with quoted lines. Medium; cite file:line.
4. **Historical** — git blame/log, past incident links, CI history. Supporting context only.
5. **Testimony** — comments, docs, "the author says". This is an Assumption wearing a costume — model it as `A`, not `Sn`.

## Freshness and persistence

- Every Solution carries `(commit <short-hash>, <date>)`. Evidence from a different commit than the claim's Context is **stale** — either re-run or mark the parent `ToBeReviewed`.
- For recurring claims (release readiness, security posture), suggest keeping the tree in the repo, e.g. `docs/assurance/<claim>.gsn`, and re-running leaf checks per release. The `state` field tracks drift: fresh evidence `Approved`, stale `ToBeReviewed`, unexecuted `ToBeDeveloped`. `scripts/gsn_tool.py stats` reports the ToBeDeveloped ratio as an "evidence debt" number.

## Verification report template

```
# Claim: [top-level Goal]
**Verdict: HOLDS / HOLDS-WITH-ASSUMPTIONS / DOES-NOT-HOLD**
Context: repo @ <commit>, [diff/branch], property definition

## Argument structure
[indented GSN tree — Goals, Strategies, and at each leaf the check name]

## Evidence log
| ID | Check (command) | Result | Rung | Commit |
|----|-----------------|--------|------|--------|
| Sn1.1 | `pytest -q` | 214 passed | 1 | abc1234 |
| ...  |

## Open assumptions / unexecuted checks
- A1: ... (why it couldn't be executed, what would settle it)

## Findings (if any branch failed)
- G1.2 DOES NOT HOLD: [what failed, decisive output excerpt, suggested fix]
```

## Worked micro-example

Claim: *"PR #142 is safe to merge into main."*

```
G1: PR #142 is safe to merge into main per this repo's gates
    C1: main @ abc1234; PR diff touches auth/session.py, api/routes.py
    C2: "Safe" = CI gates in .github/workflows/ci.yml + no new auth regressions
    S1: Argument by coverage of the change's risk surfaces
        G1.1: Existing behavior of touched modules is preserved
            Sn1.1: `pytest tests/auth tests/api -q` → 89 passed (abc1234, 2026-07-11)
        G1.2: Reverse dependencies of session.py are unaffected
            Sn1.2: `grep -rl "import session" --include=*.py` → 3 callers, all covered by Sn1.1's suites
        G1.3: The change introduces no new auth risk
            Sn1.3: `bandit -r auth/` → 0 new findings vs main
        G1.4: Project CI gates pass
            A1: CI not runnable locally (needs staging secrets) — ToBeDeveloped
Verdict: HOLDS-WITH-ASSUMPTIONS (A1: confirm CI green before merge)
```

## Common failure modes to avoid

- **Checklist theater:** running generic checks that don't touch the diff's actual risk. Derive branches from the change.
- **Green-suite fallacy:** "tests pass" only supports "preserved behavior" for behavior the tests exercise — say what the suite does *not* cover.
- **Evidence laundering:** summarizing a log as "looks fine". Quote the decisive line or number.
- **Silent staleness:** reusing yesterday's run on today's commit without saying so.

## Emitting a `.gsn` file

Read `references/dsl-output.md`. Put the command in the Solution `summary`; put the captured output file (if saved) in `artifacts`; use `state` to encode freshness as above. Lint with `scripts/gsn_tool.py lint` before delivering.
