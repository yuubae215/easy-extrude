/**
 * WizardCatalog — the wizard-definition asset registry and its pure FSM
 * (ADR-063 Phase 3, "選択優先インテーク").
 *
 * A wizard is NOT a new write path into the canonical doc: it is an *ordered
 * vessel* around the existing intake forms, whose every commit still flows
 * through the single authoritative path (DocBuilder → createAddDocEntryCommand
 * → ContextService — ADR-063 §3 / PHILOSOPHY #1). What the wizard adds is the
 * BPMN backbone: which question comes first, which choice sources each step
 * offers, and when "next" is honestly allowed.
 *
 * Definition assets are declarative data (§1.1 — step order lives here, never
 * scattered in components). Each step carries TWO predicates:
 *   - `formGaps` — the embedded form's submit predicate, by THE SAME function
 *     reference the standalone IntakePanel form uses (IntakeAssist — a looser
 *     wizard copy would re-open the "passes the form, fails the commit"
 *     divergence; pinned by a reference-identity test, ADR-058 §B-2 と同型).
 *   - `stepGaps` (derived here) — the step-completion gate for `next`, reading
 *     only committed doc entries. Reasons are always printable: the Next button
 *     is disabled iff this list is non-empty AND the list is what the caption
 *     prints (no silent disabled — PHILOSOPHY #11).
 *
 * FSM (ADR-063 §4, designed before the components — 核 §1.4):
 *   state = null (inactive) | { defId, status:'step', index:k } | { defId, status:'review' }
 *           (+ a definition's own fields, kept across transitions — the
 *           criteria hearing's `respondent`, ADR-165 D3)
 *   `next`  — allowed only when stepGaps(...) === []  (illegal `next` returns
 *             the SAME state, never a corrupt one — unrepresentable, not thrown)
 *   `back`  — always allowed (review → last step; step 0 stays)
 *   `exit`  — any time (owner sets state to null)
 *   Commits happen per-step through the CommandStack, so leaving mid-wizard
 *   always leaves a valid working doc (partial progress IS the deliverable —
 *   no all-or-nothing modal commit).
 *
 * Pure: no THREE, no DOM, no I/O, input-immutable — loads under bare
 * `node --test` (PHILOSOPHY #3 / #6).
 *
 * @module context/WizardCatalog
 */
import { actorGaps, variableGaps, requirementGaps } from './IntakeAssist.js'
import { HEARING_STEP, hearingStepGaps } from './CriteriaHearing.js'
import { endUsersOf } from './ActorStance.js'

export const WIZARD_CATALOG_VERSION = 'wizard/1.0'

/** doc key per entry kind — the step gate counts committed entries of its kind. */
const KIND_KEY = Object.freeze({
  actor:       'actors',
  variable:    'variables',
  requirement: 'requirements',
})

/**
 * The initial guided-intake wizard (robot-cell domain first — ADR-063
 * Consequences: initial release keeps density by scoping to one domain).
 * Steps mirror the Why-first order the intake trail already teaches
 * (actors → variables → requirements — ADR-051 §2.0).
 */
export const CELL_INTAKE_WIZARD = Object.freeze({
  id:      'cell-intake',
  version: WIZARD_CATALOG_VERSION,
  name:    'Guided intake',
  steps: Object.freeze([
    Object.freeze({
      id:    'actors',
      kind:  'actor',
      title: 'Who is involved?',
      prompt: 'Pick the people/systems that own requirements. Start from a role in the list — or copy an example actor chip if this project was forked.',
      formGaps:   actorGaps,
      minEntries: 1,
    }),
    Object.freeze({
      id:    'variables',
      kind:  'variable',
      title: 'What is being decided?',
      prompt: 'Declare the shared design variables (a mount height, a cell width…). Unit suggestions come from the KPI catalog — adjust the domain, don’t invent it.',
      formGaps:   variableGaps,
      minEntries: 1,
      // ADR-063 Phase 5 — this step also offers the parametric 3-D asset viewer
      // as a choice source: committing an asset writes variables (+ one fact)
      // through the same command path, satisfying the step gate without typing.
      assetSource: true,
    }),
    Object.freeze({
      id:    'requirements',
      kind:  'requirement',
      title: 'What must hold?',
      prompt: 'Pick a KPI expression asset from the catalog chips, then tweak only its parameters (threshold, target variable). The admissible slider drives the 3D band live.',
      formGaps:   requirementGaps,
      minEntries: 1,
    }),
  ]),
})

/**
 * The criteria hearing (ADR-165 D3 — the character-creation flow, v4): who
 * answers → the QCD + S ratio → expectation and weight per element → try it →
 * heard in full? → agree. Asked **one end user at a time**: the state carries
 * `respondent` (an end user ref), and Steps 2〜4 are that person's.
 *
 * Its gates are not entry counts but `gaps(docLike, state)` — the census of
 * the respondent's blanks (`CriteriaHearing.hearingStepGaps`), so "next" is
 * refused for exactly the blanks R12 would name. The review is the agreement
 * (`review: 'agreement'`); there is no total score anywhere in the flow — how
 * weights combine is core/'s score function (ADR-165 D3, CLAUDE.md 軸 1).
 */
export const CRITERIA_HEARING_WIZARD = Object.freeze({
  id:      'criteria-hearing',
  version: WIZARD_CATALOG_VERSION,
  name:    'Criteria hearing',
  review:  'agreement',
  // The definition's own state: the first end user answers, when there is one.
  initial: (doc) => ({ respondent: endUsersOf(doc)[0]?.ref ?? null }),
  steps: Object.freeze([
    Object.freeze({
      id:    HEARING_STEP.END_USERS,
      kind:  HEARING_STEP.END_USERS,
      title: 'Who is asked?',
      prompt: 'Pick the people who stand as end users of this cell — one or more. Who they are (maintenance, EHS, approver…) is a separate fact from standing as an end user. Each of them answers Steps 2–4.',
      gaps: (docLike, state) => hearingStepGaps(HEARING_STEP.END_USERS, docLike, state?.respondent ?? null),
    }),
    Object.freeze({
      id:    HEARING_STEP.MIX,
      kind:  HEARING_STEP.MIX,
      title: 'What does this cell value?',
      prompt: 'Start with the big words: how much speed, quality, cost and safety matter, relative to each other. All four are asked — safety too, even when nobody says it out loud.',
      gaps: (docLike, state) => hearingStepGaps(HEARING_STEP.MIX, docLike, state?.respondent ?? null),
    }),
    Object.freeze({
      id:    HEARING_STEP.EXPECTATIONS,
      kind:  HEARING_STEP.EXPECTATIONS,
      title: 'Expectation and weight',
      prompt: 'Every element has the same two answers: the expectation (how far it must at least get — the criterion) and the weight (how much going beyond it is worth). A weight of 0 is an answer ("does not matter"); a blank is not.',
      gaps: (docLike, state) => hearingStepGaps(HEARING_STEP.EXPECTATIONS, docLike, state?.respondent ?? null),
    }),
    Object.freeze({
      id:    HEARING_STEP.TRIAL,
      kind:  HEARING_STEP.TRIAL,
      title: 'Try it',
      prompt: 'See what cells these expectations would bring back, and pick the one you like. Opening this step records what you held when you looked — if you go back and change an expectation, the change is kept as "after trial n".',
      gaps: (docLike, state) => hearingStepGaps(HEARING_STEP.TRIAL, docLike, state?.respondent ?? null),
    }),
  ]),
})

/** All registered wizard definitions, by id. Adding a wizard = adding a row. */
export const WIZARD_CATALOG = Object.freeze({
  [CELL_INTAKE_WIZARD.id]:      CELL_INTAKE_WIZARD,
  [CRITERIA_HEARING_WIZARD.id]: CRITERIA_HEARING_WIZARD,
})

// ── FSM transition functions (pure) ──────────────────────────────────────────

/**
 * Enter the wizard at its first step. `extra` carries a definition's own
 * state fields (the hearing's `respondent`); every transition keeps them.
 * @param {object} def — a WIZARD_CATALOG definition
 * @param {object} [extra]
 * @returns {{defId:string, status:'step', index:number}}
 */
export function startWizard(def, extra = {}) {
  return { ...extra, defId: def.id, status: 'step', index: 0 }
}

/**
 * The current step's completion gate: printable reasons `next` is not yet
 * honest. Empty ⇔ `next` allowed. Review has no gate (it is the confirmation
 * surface, not a commit). Counts only committed doc entries — step-local form
 * drafts never influence the gate (they are transient, not a second source —
 * ADR-063 §4 / §1.1).
 *
 * @param {object} def — the wizard definition for `state.defId`
 * @param {{status:string, index?:number}|null} state
 * @param {{actors?:object[], variables?:object[], requirements?:object[]}} docLike
 *        — the canonical doc or its projected slice (same arrays either way)
 * @returns {string[]}
 */
export function wizardStepGaps(def, state, docLike) {
  if (!state || state.status !== 'step') return []
  const step = def?.steps?.[state.index]
  if (!step) return []
  // A step that declares its own gate answers for itself (the criteria
  // hearing counts blanks, not entries); otherwise the entry count by kind.
  if (typeof step.gaps === 'function') return step.gaps(docLike ?? {}, state)
  const key = KIND_KEY[step.kind]
  const n = (docLike?.[key] ?? []).length
  const min = step.minEntries ?? 1
  if (n >= min) return []
  return [`add at least ${min} ${step.kind}${min > 1 ? 's' : ''} to continue (${n} so far)`]
}

/**
 * `next`: advance to the following step, or to review after the last step.
 * When the current step's gate is non-empty the SAME state is returned —
 * an illegal transition is unrepresentable, not an exception (§1.4).
 *
 * @param {object} def
 * @param {{defId:string, status:string, index?:number}} state
 * @param {{actors?:object[], variables?:object[], requirements?:object[]}} docLike
 * @returns {object} next state (possibly the input state, unchanged)
 */
export function nextWizardState(def, state, docLike) {
  if (!state || state.status !== 'step') return state
  if (wizardStepGaps(def, state, docLike).length > 0) return state
  const last = (def?.steps?.length ?? 0) - 1
  const { index: _i, ...rest } = state
  if (state.index >= last) return { ...rest, status: 'review' }
  return { ...rest, status: 'step', index: state.index + 1 }
}

/**
 * `back`: always allowed. Review returns to the last step; the first step
 * stays put (never underflows into a corrupt index).
 *
 * @param {object} def
 * @param {{defId:string, status:string, index?:number}} state
 * @returns {object}
 */
export function prevWizardState(def, state) {
  if (!state) return state
  const last = (def?.steps?.length ?? 0) - 1
  if (state.status === 'review') return { ...state, status: 'step', index: Math.max(last, 0) }
  if (state.status === 'step' && state.index > 0) {
    return { ...state, status: 'step', index: state.index - 1 }
  }
  return state
}

/**
 * Progress-trail projection for rendering: one node per step plus the review
 * node, each flagged done / current / todo. "Done" for a step node means its
 * completion gate passes against the committed doc — a step the user walked
 * past but whose entries were later removed honestly drops back to todo.
 *
 * @param {object} def
 * @param {{status:string, index?:number}|null} state
 * @param {{actors?:object[], variables?:object[], requirements?:object[]}} docLike
 * @returns {{id:string, title:string, status:'done'|'current'|'todo'}[]}
 */
export function wizardTrail(def, state, docLike) {
  const steps = def?.steps ?? []
  const nodes = steps.map((step, i) => {
    const complete = wizardStepGaps(def, { ...(state ?? {}), status: 'step', index: i }, docLike).length === 0
    const current = state?.status === 'step' && state.index === i
    return {
      id: step.id,
      title: step.title,
      status: current ? 'current' : complete ? 'done' : 'todo',
    }
  })
  nodes.push({
    id: 'review',
    title: 'Review',
    status: state?.status === 'review' ? 'current' : 'todo',
  })
  return nodes
}
