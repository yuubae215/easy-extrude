---
name: gsn-meta-framework
description: Goal Structuring Notation (GSN) as a three-mode meta-thinking and verification framework, routed by intent. ASSURANCE builds standardized safety/security/compliance argument artifacts with fixed notation and six lifecycle-mapped decomposition patterns; REASONING scaffolds chain-of-thought with KPIs, Devil's-Advocate counter-arguments, and bias-exposing noise injection; VERIFICATION builds evidence-executable claim trees for codebases where leaf evidence is actual command output (tests, coverage, static analysis, git). Use for any GSN, claim tree, assurance/safety case, or standards-compliance argument (ISO 26262, IEC 61508, DO-178C); for rigorous self-critical reasoning about hard decisions or trade-offs; or to verify code claims with evidence — "is this PR safe to merge", "prove the refactor preserved behavior", "is coverage adequate", release readiness, ADR justification, security reviews. Trigger even on bare mentions of "GSN", "assurance case", "claim tree", ".gsn", or "reason through this carefully".
---

# GSN Meta-Thinking & Verification Framework

GSN's native job is documenting *assurance cases* — structured arguments that a system has a desired property. The same skeleton (Goal → Strategy → sub-Goals → Evidence, plus Context / Assumption / Justification) also scaffolds rigorous reasoning, and — in an agentic environment like Claude Code — becomes a **verification engine**: leaf goals map to executable checks, and the tree fills itself with real evidence instead of citations. This skill supports all three and **routes automatically from the user's input**.

## Step 0 — Route the request (do this first, silently)

Classify intent. Do not ask which mode to use unless signals genuinely conflict — infer it.

**ASSURANCE** — deliverable is a *documented argument artifact*. Signals: safety, security, dependability, certification, compliance standards, hazards, FMEA/FTA/HAZOP, requirements verification; wants a GSN file / claim tree / safety case; wants standardized goal wording with low modeler-to-modeler variation.
→ read `references/assurance-mode.md`

**REASONING** — deliverable is a *well-reasoned conclusion*. Signals: a hard question, decision, trade-off, ethical dilemma, forecast, strategy; wants the *thinking* stress-tested ("reason through", "steelman", "is this argument sound").
→ read `references/reasoning-mode.md`

**VERIFICATION** — deliverable is a *claim about a codebase backed by executed evidence*. Signals: a repository is present or referenced; "is this PR safe to merge", "did the refactor preserve behavior", "is coverage adequate", "is this production-ready", "security review", ADRs needing justification, release readiness. Requires the ability to run commands; if there is no execution environment, fall back to ASSURANCE and mark evidence `ToBeDeveloped`.
→ read `references/verification-mode.md`

**BLENDED** — e.g. "build the safety case AND pressure-test it": build in ASSURANCE or VERIFICATION, then run REASONING's counter-argument pass against the finished tree before finalizing. If genuinely ambiguous, ask one short question offering the candidate modes.

**Whenever the deliverable includes a `.gsn` file** (for the GSN Assurance VS Code extension), additionally read `references/dsl-output.md` and use `scripts/gsn_tool.py` (below) before delivering.

## Choosing the output format

| Output | When | Modes |
|---|---|---|
| `.gsn` DSL file | User wants a VS Code GSN Assurance file, or asks for `.gsn` | Any (finalized trees) |
| Markdown / indented GSN tree | Readable in chat, a doc, a PR description, or a review artifact | All |
| Mermaid diagram | Visual review; embed in Markdown or generate from `.gsn` via the script | All |
| Reasoning report | Conclusion + argument trail + what survived criticism | REASONING |
| Verification report | Verdict + tree + evidence log (commands, output, commit hash) | VERIFICATION |

For Markdown trees use 4-space indentation and prefix nodes with type + hierarchical ID: `G1`, `S1`, `G1.1`, `C1`, `A1`, `J1`, `Sn1` (solution), `CA1.1` (counter-argument).

## Shared vocabulary (all modes — keep stable so views stay interoperable)

- **Goal (G)** — a single claim: *noun phrase + verb phrase*, evaluable as true/false. Present tense, positive framing, concrete qualifiers. "System X is acceptably safe to operate within operating concept Y", never "System X is safe".
- **Strategy (S)** — how a Goal decomposes into sub-Goals. Phrased "Argument by [approach]".
- **Solution / Evidence (Sn)** — concrete support at a leaf: a document, test result, proof, dataset, citation — or, in VERIFICATION, an executed command with its captured output.
- **Context (C)** — scoping information that disambiguates a Goal or Strategy.
- **Assumption (A)** — a premise taken as true, to be replaced by evidence as work matures.
- **Justification (J)** — why an approach or conclusion is valid.

## Standard Goal verb phrases (use these to reduce wording variation)

- State: "…**is** [state]" — *is acceptably safe*
- Property: "…**has** [property]" — *has sufficient reliability*
- Completion: "…is [completely/sufficiently] [past participle]" — *is sufficiently mitigated*
- Compliance: "…**complies with** [standard]"
- Capability: "…**can** [capability] under [conditions]"

Everywhere: consistent present tense; positive assertions over negations; concrete qualifiers ("within operating parameters Y") over generalities; every Goal must be checkable as true/false against evidence.

## The six decomposition patterns (selector — full detail in assurance-mode.md)

1. **By Components** — architecture defined; split across subsystems. *Design.*
2. **By Properties** — multiple quality attributes (safety, reliability, security). *Design verification.*
3. **By Hazards** — hazard analysis done; one branch per hazard. *Safety case.*
4. **By Lifecycle** — design→implementation→test→operation→decommission. *Certification.*
5. **By Requirements** — one branch per requirement. *System verification.*
6. **By Test Strategy** — unit/integration/system. *V&V.*

VERIFICATION mode adds code-native variants of these (by module, by risk surface, by behavioral contract, by quality gate) — see `references/verification-mode.md`.

## Reasoning-strengthening machinery (REASONING; optional pass for BLENDED)

Full protocol in `references/reasoning-mode.md`: seven-KPI evaluation to find the weakest dimension, a Devil's-Advocate counter-argument cycle (challenge assumptions / doubt evidence / attack conclusions, then Refute · Modify · Acknowledge · Integrate), deliberate noise injection to expose bias, and an iterate-to-convergence loop. **Keep it proportional** — a quick question gets one light counter-argument pass, not a seven-KPI ritual.

## Tooling — `scripts/gsn_tool.py` (stdlib-only, no install)

Use it for every `.gsn` deliverable; do not hand-verify what the linter checks.

```bash
python scripts/gsn_tool.py uuid --count 12          # batch-generate UUIDs before writing a file
python scripts/gsn_tool.py lint model.gsn           # validate: indent, required fields, UUID uniqueness/format, depth, fan-out
python scripts/gsn_tool.py mermaid model.gsn        # emit a Mermaid flowchart (add -o out.md to write a file)
python scripts/gsn_tool.py stats model.gsn          # node counts, depth, ToBeDeveloped ratio (evidence debt)
```

## Quality bar before finishing (all modes)

- Top-level Goal is clearly stated, correctly scoped, and not oversimplified.
- Every Goal reads as a single true/false claim in standard verb-phrase form.
- Every leaf is backed by a Solution genuinely *pertinent* to its Goal — no orphaned goals, no evidence stapled on without a stated link.
- Assumptions are marked as such and flagged for later replacement by evidence.
- In VERIFICATION, every Solution records the command, the relevant output, and the commit it ran against; anything not actually executed is an Assumption, not evidence.
- In REASONING/BLENDED, the surviving conclusion states its confidence and what criticism it withstood — never project false rigour. A neat tree is not a valid argument; actively ask "what did this decomposition omit?"
