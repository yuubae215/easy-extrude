# REASONING Mode — GSN-Scaffolded Chain of Thought

Goal: reach a well-reasoned conclusion to a hard question, decision, trade-off, or dilemma. GSN supplies the skeleton (Goal → Strategy → sub-Goals → Evidence, plus Context/Assumption/Justification); on top of it, add three mechanisms — multi-dimensional KPIs, counter-arguments, and noise injection — and iterate to convergence. The deliverable is usually a **reasoning report**: the conclusion plus the argument trail and what survived criticism.

**Mode check:** if any branch of the argument rests on a claim about a codebase you can execute against ("option B is cheaper because the migration is small"), don't estimate it — hop into `references/verification-mode.md` for that branch and attach real command output as its Solution. Executed evidence raises ES more than any amount of prose.

## Role mapping

- **From the user:** Goal (the question), Context (background/constraints), Assumptions (optional stated premises).
- **You generate:** Strategy (how to decompose the problem), Solutions (answers + their evidential support), Counter-Arguments (CA), Noise (NI).
- **Results:** Justification (the logically-supported conclusion) and Refutation Resistance (the argument as strengthened by surviving criticism).

## Proportionality — scale the machinery to the stakes

- **Light** (a single tricky question): one Strategy, a short CA pass on the main assumption, no full KPI table. State a confidence at the end.
- **Medium** (a real decision or trade-off): full CA cycle, one or two NI injections, a KPI read to find and fix the weakest dimension.
- **Heavy** (high-stakes / ethical / adversarial): full iterate-to-convergence loop with the seven KPIs and a meta-cognitive summary.

Do not perform theatrical numeric scoring for trivial questions. The KPIs are a lens for finding weak spots, not a ritual.

## The seven KPIs (targets in parentheses)

- **LC — Logical Coherence** (0.90): do the nodes actually entail each other? Scale −1.0…+1.0.
- **ES — Evidence Strength** (0.85): reliability × relevance × completeness of the support.
- **CP — Completeness** (0.90): 1 − (gaps / steps). Missing premises, skipped steps, unconsidered alternatives.
- **RB — Robustness** (0.80): resistance to counter-arguments, alternative hypotheses, edge cases, uncertainty.
- **EF — Efficiency** (0.75): economy of reasoning; avoid needless complexity.
- **CI — Creativity / Insight** (0.60): non-obvious approaches, genuine insight, paradigm shifts.
- **OP — Overall** (target 0.85, convergence 0.90) = LC·0.25 + ES·0.20 + CP·0.20 + RB·0.15 + EF·0.10 + CI·0.10.

Treat scores as calibrated self-estimates, not measurements. Use the gaps to decide what to work on: the biggest gap to its target is the next thing to fix. Robustness gets priority weighting — if RB is below target, run a harder counter-argument pass before anything else.

## Counter-argument cycle (Devil's Advocate)

For each major argument step, attack it on three fronts, then respond.

**Challenge the assumption** — `CA[n.1]` assume its opposite; `CA[n.2]` conditions that weaken it; `CA[n.3]` an alternative premise.
**Doubt the evidence** — `CA[n.4]` reliability; `CA[n.5]` relevance; `CA[n.6]` an alternative reading of the same evidence.
**Attack the conclusion** — `CA[n.7]` what would make it false; `CA[n.8]` limits of its applicability; `CA[n.9]` an alternative conclusion.

Generic challenge lenses to draw from: *if the premise were false…? / could this evidence support a different conclusion? / where does this break? / does it hold at larger/smaller scale? / does it survive the passage of time?*

**Lifecycle-integrated variant** (for the heavy loop): take the current key assumption, *provisionally hold it true* and build its conclusion, then *flip* and build the case that it's false, then integrate — usually replacing single-theory dependence with a pluralistic synthesis.

**Respond to each CA** with one of:
- **Refute** — show the CA is flawed; strengthen the original.
- **Modify** — add a condition/limit; adjust the premise or conclusion.
- **Acknowledge** — concede validity; state the resulting uncertainty and scope limit.
- **Integrate** — fold the CA's insight in to build a stronger, multi-perspective argument.

Track the effect: a good CA pass should raise RB.

## Noise injection (bias exposure + creativity)

Deliberately contaminate the reasoning, then detect and overcome it — this surfaces hidden bias and forces new angles.

- **Bias injection (NI_BIAS):** inject one of — confirmation bias (only supportive evidence), anchoring, availability, representativeness, hindsight, or a cultural/framing bias. Then name it, detect it, and return to a neutral view.
- **Misinformation injection (NI_MISINFO):** introduce a plausible-but-false premise, pseudo-evidence, a formally-valid fallacy, a distorted context, or a manipulated statistic. Then analyze its effect and correct it. (Use only inside your own reasoning to test robustness — never present injected falsehoods to the user as fact.)
- **Forced alternative hypotheses (NI_ALT):** for a key claim, generate three — an *opposing* hypothesis, a *complementary* (partial-fix) hypothesis, and a *paradigm-shift* hypothesis.

If bias risk accumulates across steps, inject a de-biasing noise specifically to break it. If CI is falling, inject a creativity-boost (a thought experiment that changes the frame) to open new dimensions.

## Iterate to convergence (heavy loop)

```
ITERATION[0]  build the initial GSN tree; score all KPIs; gap analysis; pick priorities
  → counter-argument cycle    (raises RB)
  → noise injection cycle     (raises CI, exposes bias)
ITERATION[n]  target the biggest gap; if RB < target, intensify CAs; if CI dropped, boost
CONVERGENCE   met when ≥6/7 KPIs are at target AND OP ≥ 0.90
FINAL         state conclusion with confidence + robustness + insight level;
              emit meta-cognitive summary
```

Meta-cognitive summary should capture: how the reasoning evolved (initial → after CA integration → after de-biasing → optimized), key insights the process produced, which enhancement helped most, and the final confidence profile.

## Report template

```
# [Question]

## Conclusion
[the answer], stated plainly.
Confidence: [OP or a qualitative level]  ·  Robustness: [RB]  ·  Insight: [CI]

## Argument structure (GSN)
G1 … S1 … G1.1 / G1.2 … with Solutions at the leaves
(indented tree or Mermaid)

## What it survived
- Counter-arguments raised and how each was handled (Refute/Modify/Acknowledge/Integrate)
- Biases exposed by noise injection and how they were corrected
- Remaining uncertainties / scope limits

## How the reasoning evolved
[brief meta-cognitive summary — only for medium/heavy runs]
```

## Worked micro-example (light→medium)

`G1: Adopt policy P for the team`
`S1: Argument by weighing costs, benefits, and reversibility`
`  G1.1: Benefits outweigh costs  → Sn: [data/estimate]`
`  G1.2: The move is reversible if it fails → Sn: [rollback plan]`
`CA[1]: assume benefits are overstated (optimism bias) → NI_BIAS` → response: **Modify** (add a pilot before full rollout) → RB up.
`J1: Adopt P as a time-boxed pilot with a defined rollback trigger.` Confidence: medium; withstood the optimism-bias challenge by de-risking rather than committing fully.

## If the user wants the result as a `.gsn` file

A finalized reasoning tree can be emitted in GSN DSL — read `references/dsl-output.md`. Represent counter-arguments as `justification` nodes ("Withstands challenge: …") since the DSL has no native CA type.
