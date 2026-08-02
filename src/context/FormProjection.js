/**
 * FormProjection — project the validator's unsatisfied OpenQuestions into a
 * dynamic intake form (ADR-049 Phase 2, §5.1).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 *
 * There is no static question list. Every form question is the projection of an
 * OpenQuestion that some rule (R1 / R4 / R8 / R9) emitted against the current
 * graph. Answering a question removes the condition that raised it, so the next
 * validation emits one fewer OpenQuestion: "all answered = all rules silent =
 * empty form." Completion is therefore machine-checkable — `projectForm` returns
 * `[]` exactly when the graph has no open questions.
 *
 * The projection is decoupled from validation: it reads only the `openQuestions`
 * already produced by `validateContext`, so it never re-runs the rules.
 *
 * @module context/FormProjection
 */

/**
 * Answer kinds tell a form renderer what input widget each question needs and
 * what shape the answer must take to satisfy the raising rule.
 */
export const ANSWER_KIND = {
  QUANTITY:      'quantity',      // a {value, unit} for an unknown fact attribute (R1)
  ACTOR_REF:     'actorRef',      // an actor ref to assign an obligation (R4)
  KPI_CRITERION: 'kpiCriterion',  // a (kpi, criterion) backing a stated region (R9)
  REQUIREMENT:   'requirement',   // a new requirement contributing a mandatory KPI (R8)
  OWNER:         'owner',         // who may write a claim, or "none" (R10 — ADR-104 D2)
}

/**
 * Map an OpenQuestion's raising rule to the answer kind it expects.
 *
 * **An undeclared rule throws** (PHILOSOPHY #31). This table used to fall
 * through to `QUANTITY`, which meant a new rule got a numeric input box and an
 * answer that could not clear it — the form would never empty, and the
 * machine-checkable completion property above would fail with no indication of
 * why. A fall-through makes "we decided this rule wants a quantity"
 * indistinguishable from "nobody thought about this rule": the absence of a
 * decision, wearing the costume of one. Adding R10 (ADR-104) is what surfaced
 * it; the guard is what keeps R11 from re-finding it.
 */
const KIND_BY_RULE = {
  'R1:unknown-attr':     ANSWER_KIND.QUANTITY,
  'R4:unassigned-scope': ANSWER_KIND.ACTOR_REF,
  'R8:role-kpi-catalog': ANSWER_KIND.REQUIREMENT,
  'R9:stated-without-kpi': ANSWER_KIND.KPI_CRITERION,
  'R10:undeclared-owner': ANSWER_KIND.OWNER,
}

/**
 * Project a validator result's OpenQuestions into structured form questions.
 *
 * @param {{ openQuestions: object[] }} result — output of validateContext()
 * @returns {Array<{ ref: string, raisedBy: string, target: string, prompt: string, answerKind: string }>}
 *          sorted by ref (deterministic)
 */
export function projectForm(result) {
  const questions = (result?.openQuestions ?? []).map(oq => {
    const answerKind = KIND_BY_RULE[oq.raisedBy]
    if (!answerKind) {
      throw new Error(
        `[FormProjection] rule "${oq.raisedBy}" raised an OpenQuestion but declares no answer kind. ` +
        `Declared rules: ${Object.keys(KIND_BY_RULE).join(', ')}. ` +
        'Add the rule to KIND_BY_RULE (and its application to FormApplication) — a default here ' +
        'would render an input that cannot clear the question (PHILOSOPHY #31).')
    }
    return {
      ref:      oq.ref,
      raisedBy: oq.raisedBy,
      target:   oq.about,
      prompt:   oq.summary,
      answerKind,
    }
  })

  return questions.sort((x, y) => x.ref.localeCompare(y.ref))
}
