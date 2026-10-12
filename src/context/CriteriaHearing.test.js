/**
 * CriteriaHearing — the hearing flow and the history before agreement
 * (ADR-165 D3 / D4, PR3).
 *
 * This file is the maturity PATH of the GSN goal
 * TheHearingIsWalkedOnePersonAtATimeAndWhatWasSeenIsKept
 * (docs/gsn/adr-165-…gsn).
 *
 * The fixtures are built so that "one pass" and "the real shape" disagree:
 * the same person tries **twice** (a second trial must not overwrite the
 * first — one pass would never see it), two end users answer the same flow
 * (Steps 2–4 belong to the respondent, not to the document), an answer given
 * before the first trial (a first answer, not a change), and a person who
 * agreed (from then on the history is the proposal's, not the trial's).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  HEARING_STEP, hearingStepGaps, recordTrial, trialGuards, trialsOfActor,
  hearingHistory, criteriaSliceOf,
} from './CriteriaHearing.js'
import { agreeToLine, lineHistory, LINE_CHANGE } from './CriteriaLine.js'
import { applyQuestionAnswer } from './FormApplication.js'
import { CRITERIA_ELEMENTS } from './CriteriaCatalog.js'
import { CONTEXT_DSL_VERSION } from './ContextDslSchema.js'
import { validateContext } from './ContextValidator.js'
import {
  CRITERIA_HEARING_WIZARD, WIZARD_CATALOG, startWizard, nextWizardState, wizardStepGaps, wizardTrail,
} from './WizardCatalog.js'

const answer = (owner, e) => ({
  ref: `crit_${owner}_${e.key}`, by: owner, owner,
  kpi: { name: e.key, unit: e.unit }, criterion: { op: e.op, value: 10 }, weight: 1,
})
const endUser = (ref) => ({ ref, role: 'maintainer', endUser: true, mix: { D: 3, Q: 2, C: 1, S: 4 } })
const heard = (refs) => ({
  version: CONTEXT_DSL_VERSION,
  actors: refs.map(endUser),
  requirements: refs.flatMap(r => CRITERIA_ELEMENTS.map(e => answer(r, e))),
})
/** The respondent answers through the same transform the floor's form uses. */
const say = (doc, who, elements) =>
  applyQuestionAnswer(doc, { ref: 'hearing', target: who, answerKind: 'criteria' }, { elements })

// ── the step gates ask the census of the respondent, not the document ─────────

test('Step 1 is refused with no end user — a hearing with no one to hear does not start', () => {
  const gaps = hearingStepGaps(HEARING_STEP.END_USERS, { actors: [{ ref: 'x', role: 'maintainer' }] }, null)
  assert.match(gaps.join(' '), /at least one person who stands as an end user/)
  assert.deepEqual(hearingStepGaps(HEARING_STEP.END_USERS, heard(['a']), 'a'), [])
  assert.match(hearingStepGaps(HEARING_STEP.END_USERS, heard(['a']), null).join(' '), /pick who is answering/)
})

test('Step 2 names the blank categories — safety is asked even when nobody mentions it', () => {
  const doc = heard(['a'])
  doc.actors[0].mix = { D: 5, Q: 3, C: 1 }
  assert.match(hearingStepGaps(HEARING_STEP.MIX, doc, 'a').join(' '), /still blank: S/)
  doc.actors[0].mix = { D: 0, Q: 0, C: 0, S: 0 }
  assert.match(hearingStepGaps(HEARING_STEP.MIX, doc, 'a').join(' '), /all zeros/)
})

test('N=2: the gates are the respondent\'s — b\'s blanks do not block a, and a\'s answers do not pass b', () => {
  const doc = heard(['a', 'b'])
  doc.requirements = doc.requirements.filter(r => !(r.owner === 'b' && r.kpi.name === 'humanClearance'))
  assert.deepEqual(hearingStepGaps(HEARING_STEP.EXPECTATIONS, doc, 'a'), [])
  assert.match(hearingStepGaps(HEARING_STEP.EXPECTATIONS, doc, 'b').join(' '), /2 answers still blank — humanClearance/)
})

test('an undeclared step throws instead of passing (PHILOSOPHY #31)', () => {
  assert.throws(() => hearingStepGaps('nope', heard(['a']), 'a'), /no gate declared/)
})

test('the wizard keeps the respondent across next / back, and its gate is the census', () => {
  const def = CRITERIA_HEARING_WIZARD
  assert.equal(WIZARD_CATALOG[def.id], def)
  const doc = heard(['a', 'b'])
  let s = startWizard(def, def.initial(doc))
  assert.equal(s.respondent, 'a', 'the first end user answers first')
  s = nextWizardState(def, s, doc)
  assert.equal(s.index, 1)
  assert.equal(s.respondent, 'a')
  const blank = { ...doc, actors: [{ ...doc.actors[0], mix: undefined }, doc.actors[1]] }
  assert.equal(nextWizardState(def, s, blank), s, 'a blank refuses next — the same state, never a corrupt one')
  assert.match(wizardStepGaps(def, s, blank).join(' '), /still blank: D, Q, C, S/)
  // The trail asks each step for the respondent too.
  assert.deepEqual(wizardTrail(def, s, doc).map(n => n.status), ['done', 'current', 'done', 'todo', 'todo'])
})

test('no step of the hearing carries a total score — weights are combined by core/ (ADR-165 D3)', () => {
  // The flow is vocabulary + gates. A summed score in src/ would be a second
  // score function (CLAUDE.md 軸 1); the slice the panel reads has no such key.
  const slice = criteriaSliceOf(recordTrial(heard(['a']), 'a'))
  assert.deepEqual(Object.keys(slice).sort(), ['actors', 'criteriaAgreement', 'criteriaHearing', 'requirements'])
  assert.deepEqual(Object.keys(slice.criteriaHearing.trials[0]).sort(), ['actor', 'line', 'seen'])
})

// ── the trial and the history before agreement (D4) ───────────────────────────

test('a trial records what the person held when they looked; seen = [] is a declared zero', () => {
  const doc = recordTrial(heard(['a']), 'a')
  const [t] = trialsOfActor(doc, 'a')
  assert.equal(t.actor, 'a')
  assert.deepEqual(t.seen, [])
  assert.deepEqual(t.line.elements.takt, { criterion: { op: '<=', value: 10 }, weight: 1 })
  assert.equal(validateContext(doc).errors.length, 0, JSON.stringify(validateContext(doc).errors))
})

test('a trial is refused with blanks, for a non-end-user, and after agreement — never silently', () => {
  const blank = heard(['a'])
  blank.requirements.pop()
  assert.match(trialGuards(blank, 'a').reasons.join(' '), /still blank/)
  assert.throws(() => recordTrial(blank, 'a'), /cannot record a trial/)
  assert.match(trialGuards(heard(['a']), 'zz').reasons.join(' '), /does not stand as an end user/)
  const agreed = agreeToLine(heard(['a']), 'a')
  assert.match(trialGuards(agreed, 'a').reasons.join(' '), /agreed to the line/)
})

test('walking back and forth without changing anything is not a new trial', () => {
  const once = recordTrial(heard(['a']), 'a')
  assert.equal(recordTrial(once, 'a'), once)
})

test('answers before the first trial are first answers, not history', () => {
  const doc = say(heard(['a']), 'a', { takt: { criterion: { op: '<=', value: 6 } } })
  assert.deepEqual(hearingHistory(doc), [])
  assert.deepEqual(hearingHistory(recordTrial(doc, 'a')), [], 'nothing changed after the trial yet')
})

test('a change after trial 1 is a round "after trial 1", with its direction', () => {
  let doc = recordTrial(heard(['a']), 'a')
  doc = say(doc, 'a', { takt: { criterion: { op: '<=', value: 12 } } })
  const [r] = hearingHistory(doc)
  assert.equal(r.actor, 'a')
  assert.equal(r.afterTrial, 1)
  assert.deepEqual(r.seen, [])
  assert.equal(r.changes.length, 1)
  assert.equal(r.changes[0].element, 'takt')
  assert.equal(r.changes[0].change, LINE_CHANGE.LOOSENED)
  assert.equal(r.safetyCut, false)
})

test('the same person tries twice: trial 2 does not overwrite trial 1 — two rounds remain', () => {
  // The shape one pass cannot see (whiteboard §5): with a single trial the
  // round is "trial → now", and an overwriting second trial would look green.
  let doc = recordTrial(heard(['a']), 'a')
  doc = say(doc, 'a', { humanClearance: { criterion: { op: '>=', value: 4 } } })   // loosen safety for takt
  doc = recordTrial(doc, 'a')
  doc = say(doc, 'a', { takt: { weight: 3 } })
  assert.equal(trialsOfActor(doc, 'a').length, 2)
  const rounds = hearingHistory(doc)
  assert.deepEqual(rounds.map(r => r.afterTrial), [1, 2])
  assert.equal(rounds[0].safetyCut, true, 'loosening "never touch a person" is safety cut')
  assert.equal(rounds[0].changes[0].element, 'humanClearance')
  assert.equal(rounds[1].changes[0].change, LINE_CHANGE.WEIGHT_RAISED)
  assert.equal(rounds[1].safetyCut, false)
})

test('N=2: each person\'s rounds are their own', () => {
  let doc = recordTrial(recordTrial(heard(['a', 'b']), 'a'), 'b')
  doc = say(doc, 'b', { stoppingDistance: { criterion: { op: '<=', value: 5 } } })
  const rounds = hearingHistory(doc)
  assert.deepEqual(rounds.map(r => r.actor), ['b'])
  assert.equal(rounds[0].changes[0].change, LINE_CHANGE.TIGHTENED)
})

test('after agreement the trial half ends at the agreed snapshot; later moves are proposals (lineHistory)', () => {
  let doc = recordTrial(heard(['a']), 'a')
  doc = say(doc, 'a', { takt: { criterion: { op: '<=', value: 12 } } })
  doc = agreeToLine(doc, 'a')
  const rounds = hearingHistory(doc)
  assert.equal(rounds.length, 1)
  assert.deepEqual(rounds[0].changes[0].to, { op: '<=', value: 12 })
  assert.deepEqual(lineHistory(doc), [], 'no proposal yet — the two halves do not double-count')
})

test('a trial by nobody is an error (R14)', () => {
  const doc = { ...heard(['a']), criteriaHearing: { trials: [{ actor: 'ghost', line: { mix: {}, elements: {} }, seen: [] }] } }
  assert.match(validateContext(doc).errors.join(' '), /criteriaHearing\.trials\[0\]: "ghost"/)
})

// ── archetypes are a starting point, never an answer (DEF-065, stakeholder 2026-10-12) ──

test('every archetype states all four categories, safety included, and none is all zero', async () => {
  const { MIX_ARCHETYPES, CRITERIA_CATEGORIES } = await import('./CriteriaCatalog.js')
  assert.ok(MIX_ARCHETYPES.length > 0)
  for (const a of MIX_ARCHETYPES) {
    assert.deepEqual(Object.keys(a.mix).sort(), [...CRITERIA_CATEGORIES].sort(), a.key)
    assert.ok(a.mix.S > 0, `${a.key} leaves safety at 0`)
  }
})

test('an archetype is not an answer: the census still counts the ratio blank until it is saved', () => {
  const doc = heard(['a'])
  doc.actors[0].mix = undefined
  assert.match(hearingStepGaps(HEARING_STEP.MIX, doc, 'a').join(' '), /still blank: D, Q, C, S/)
})
