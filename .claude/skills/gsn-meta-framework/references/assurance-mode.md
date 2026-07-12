# ASSURANCE Mode — Standardized GSN Assurance / Safety Cases

Goal: produce a GSN (or claim-tree) argument that a system has a desired property (safety, security, dependability, compliance), written to a **standardized scheme that minimizes modeler-to-modeler variation**. The deliverable is a documented argument artifact.

**Mode check:** if the subject is a codebase you can run commands against, the evidence can be *executed* rather than cited — switch to (or blend in) `references/verification-mode.md`. Stay in ASSURANCE when evidence lives in documents, analyses, and reviews outside the execution environment.

## Workflow

1. **Fix the top-level Goal.** One claim, noun-phrase + verb-phrase, present tense, positive, scoped. Attach Context nodes that remove ambiguity (design ref, operating concept, definitions).
2. **Choose a Strategy** = pick a decomposition pattern (below) that matches where the work sits in the lifecycle.
3. **Emit sub-Goals** in the pattern's standard form.
4. **Recurse** until each leaf Goal is directly supportable by evidence.
5. **Attach Solutions (evidence)** at leaves; attach Assumptions/Justifications where the argument leans on premises or approach choices.
6. **Mark provisional support.** Where a Goal currently rests on an Assumption, flag it To-Be-Developed so later testing/analysis can replace the assumption with a Solution.

## Node notation scheme (keep this exact, to reduce variation)

**Goal:** `G[ID]: [Subject] [verb phrase indicating state] [qualifier/condition]`
- `G1: System X is acceptably safe to operate within operating concept Y`
- `G1.1: All identified hazards are eliminated or sufficiently mitigated`
- `G1.1.1: Hazard H1 is completely eliminated through design measures`

**Strategy:** `S[ID]: Argument by [decomposition approach] [of/for what aspect]`
- `S1: Argument by addressing all identified hazards`
- `S1.1: Argument by separate analysis of each hazard`

**Hierarchical numbering:** top Goal `G1`; its Strategy `S1`; second-level Goals `G1.1, G1.2…`; their Strategies `S1.1, S1.2…`; third-level `G1.1.1…`. Solutions at a leaf: `Sn1.1.1`. Context/Assumption/Justification: `C1`, `A1`, `J1`, attached to the node they qualify.

## Standard verb phrases for Goals

- State: `is [state]` — *is acceptably safe*
- Property: `has [property]` — *has sufficient reliability*
- Completion: `is [completely/sufficiently] [past participle]` — *is completely eliminated / is sufficiently mitigated*
- Compliance: `complies with [standard]`
- Capability: `can [capability] under [conditions]`

## The six decomposition patterns

### 1. By Components
- **Use when:** architecture is established, subsystem responsibilities are clear. Design phase.
- **Strategy:** `S[ID]: Argument by decomposition across system components`
- **Sub-goals:** `G[ID].1: Control system meets safety requirements` / `…Communication interface…` / `…Power system…`

### 2. By Properties
- **Use when:** multiple quality attributes each need their own argument. Design verification.
- **Strategy:** `S[ID]: Argument by satisfaction of required properties`
- **Sub-goals:** `G[ID].1: System achieves required safety level` / `…required reliability targets` / `…required security requirements`

### 3. By Hazards
- **Use when:** hazard analysis (HAZOP/FMEA/FTA) done, specific hazards identified. Safety verification / safety case.
- **Strategy:** `S[ID]: Argument by addressing all identified hazards`
- **Sub-goals:** `G[ID].1: Hazard H1 (collision risk) is mitigated to acceptable level` / `…H2 (loss of control)…` / `…H3 (electrical failure)…`

### 4. By Lifecycle
- **Use when:** must argue safety across the whole lifecycle; demonstrating standards compliance (IEC 61508, ISO 26262). Certification.
- **Strategy:** `S[ID]: Argument by demonstration across system lifecycle`
- **Sub-goals:** `G[ID].1: Safety requirements in design phase are adequately met` / `…implementation phase…executed` / `…operational phase…maintained`

### 5. By Requirements
- **Use when:** requirements spec exists and each requirement needs verification. System verification / regulatory compliance.
- **Strategy:** `S[ID]: Argument by satisfaction of all requirements`
- **Sub-goals:** `G[ID].1: Functional requirement FR1 is satisfied` / `…Safety requirement SR1…` / `…Performance requirement PR1…`

### 6. By Test Strategy
- **Use when:** V&V phase; different test approaches demonstrate correctness/safety. QA process.
- **Strategy:** `S[ID]: Argument by comprehensive test strategy`
- **Sub-goals:** `G[ID].1: Unit tests confirm correctness of all functions` / `…Integration tests…interaction between components` / `…System tests…overall requirements compliance`

## Lifecycle-phase → pattern map

| Phase | Key activities | Recommended pattern |
|---|---|---|
| Concept | establish requirements, stakeholder needs | By Properties |
| Requirements definition | detail functional/non-functional reqs | By Requirements |
| Design | architecture + component design | By Components |
| Safety analysis | hazard analysis, risk assessment | By Hazards |
| Implementation & test | coding, unit/integration/system test | By Test Strategy |
| Certification / compliance | verify against regulation, prepare evidence | By Lifecycle |

## Worked skeleton

```
G1: System X is acceptably safe to operate within operating concept Y
    C1: System X design (Ref A)
    C2: Concept Y operation (Ref B)
    S1: Argument by addressing all identified hazards
        C3: Hazards identified from FHA (Ref C)
        G1.1: All identified hazards are eliminated or sufficiently mitigated
            S1.1: Argument by separate analysis of each hazard
                G1.1.1: Hazard H1 is completely eliminated
                    Sn1.1.1: Design Drawing (Ref E)
                G1.1.2: Probability of hazard H2 is reduced to a tolerable level
                    C4: Definition of tolerance (Ref D)
                    Sn1.1.2: FTA (Ref F)
```

## Common failure modes to avoid

- **False rigour:** a neat tree is not a valid argument. It's harder to spot a *missing* branch than to review what's present — actively ask "what hazard/requirement/component did this decomposition omit?"
- **Oversimplified top Goal:** `System X is safe` loses scope; always carry the operating concept/parameters.
- **Orphan evidence:** never staple a Solution to a Goal without the decomposition making the link explicit.
- **Assumptions masquerading as evidence:** mark them, and plan their replacement.

## Emitting a `.gsn` file

If the user wants a file for the GSN Assurance VS Code extension, read `references/dsl-output.md` and emit there; generate UUIDs and lint with `scripts/gsn_tool.py` (`uuid`, then `lint`) before delivering. Otherwise deliver the indented Markdown tree above (optionally with a Mermaid diagram — `scripts/gsn_tool.py mermaid` can generate one from a `.gsn` file).
