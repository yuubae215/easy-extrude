/**
 * WizardCatalog tests — wizard definition asset + pure FSM (ADR-063 Phase 3).
 * Bare `node --test`, THREE-free.
 *
 * Load-bearing assertions:
 *   - each step's `formGaps` is THE IntakeAssist predicate by reference (the
 *     embedded form and the standalone IntakePanel form share one submit
 *     predicate — ADR-058 §B-2 same-reference rule, no looser wizard copy);
 *   - the `next` gate: an incomplete step returns the SAME state (illegal
 *     transitions unrepresentable, §1.4), a complete one advances, the last
 *     step advances to review;
 *   - `back` is always allowed and never underflows.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WIZARD_CATALOG,
  WIZARD_CATALOG_VERSION,
  CELL_INTAKE_WIZARD,
  startWizard,
  wizardStepGaps,
  nextWizardState,
  prevWizardState,
  wizardTrail,
} from './WizardCatalog.js'
import { actorGaps, variableGaps, requirementGaps } from './IntakeAssist.js'

const DEF = CELL_INTAKE_WIZARD

const emptyDoc = { actors: [], variables: [], requirements: [] }
const fullDoc = {
  actors:       [{ ref: 'a_robot', role: 'developer' }],
  variables:    [{ ref: 'v_reach', unit: 'mm', domain: [0, 1000] }],
  requirements: [{ ref: 'r_reach', by: 'a_robot', constrains: ['v_reach'] }],
}

test('catalog registers the cell-intake wizard under its version', () => {
  assert.equal(WIZARD_CATALOG_VERSION, 'wizard/1.0')
  assert.equal(WIZARD_CATALOG[DEF.id], DEF)
  assert.equal(DEF.version, WIZARD_CATALOG_VERSION)
  assert.equal(DEF.steps.length, 3)
  assert.deepEqual(DEF.steps.map(s => s.kind), ['actor', 'variable', 'requirement'])
})

test('each step formGaps is the IntakeAssist predicate by REFERENCE (no wizard re-implementation)', () => {
  assert.equal(DEF.steps[0].formGaps, actorGaps)
  assert.equal(DEF.steps[1].formGaps, variableGaps)
  assert.equal(DEF.steps[2].formGaps, requirementGaps)
})

test('startWizard enters step 0', () => {
  assert.deepEqual(startWizard(DEF), { defId: DEF.id, status: 'step', index: 0 })
})

test('wizardStepGaps names the missing kind with a printable reason; empty when satisfied', () => {
  const s0 = startWizard(DEF)
  const gaps = wizardStepGaps(DEF, s0, emptyDoc)
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /actor/)
  assert.match(gaps[0], /0 so far/)
  assert.deepEqual(wizardStepGaps(DEF, s0, fullDoc), [])
  // review has no gate — it is a confirmation surface, not a commit
  assert.deepEqual(wizardStepGaps(DEF, { defId: DEF.id, status: 'review' }, emptyDoc), [])
})

test('next on an incomplete step returns the SAME state (illegal transition unrepresentable)', () => {
  const s0 = startWizard(DEF)
  assert.equal(nextWizardState(DEF, s0, emptyDoc), s0)
})

test('next walks step 0 → 1 → 2 → review when each gate passes', () => {
  let s = startWizard(DEF)
  s = nextWizardState(DEF, s, fullDoc)
  assert.deepEqual(s, { defId: DEF.id, status: 'step', index: 1 })
  s = nextWizardState(DEF, s, fullDoc)
  assert.deepEqual(s, { defId: DEF.id, status: 'step', index: 2 })
  s = nextWizardState(DEF, s, fullDoc)
  assert.deepEqual(s, { defId: DEF.id, status: 'review' })
  // review is terminal for `next`
  assert.equal(nextWizardState(DEF, s, fullDoc), s)
})

test('a later step gate reads its OWN kind (actors alone do not open requirements)', () => {
  const s2 = { defId: DEF.id, status: 'step', index: 2 }
  const doc = { ...fullDoc, requirements: [] }
  assert.equal(wizardStepGaps(DEF, s2, doc).length, 1)
  assert.equal(nextWizardState(DEF, s2, doc), s2)
})

test('back is always allowed: review → last step, step k → k−1, step 0 stays', () => {
  const review = { defId: DEF.id, status: 'review' }
  assert.deepEqual(prevWizardState(DEF, review), { defId: DEF.id, status: 'step', index: 2 })
  const s1 = { defId: DEF.id, status: 'step', index: 1 }
  assert.deepEqual(prevWizardState(DEF, s1), { defId: DEF.id, status: 'step', index: 0 })
  const s0 = startWizard(DEF)
  assert.equal(prevWizardState(DEF, s0), s0)
})

test('wizardTrail marks done/current/todo from committed entries, plus the review node', () => {
  const s1 = { defId: DEF.id, status: 'step', index: 1 }
  const doc = { ...emptyDoc, actors: fullDoc.actors }
  const trail = wizardTrail(DEF, s1, doc)
  assert.deepEqual(trail.map(n => n.status), ['done', 'current', 'todo', 'todo'])
  assert.equal(trail[3].id, 'review')
  const reviewTrail = wizardTrail(DEF, { defId: DEF.id, status: 'review' }, fullDoc)
  assert.deepEqual(reviewTrail.map(n => n.status), ['done', 'done', 'done', 'current'])
})

test('a step walked past whose entries were later removed honestly drops back to todo', () => {
  const s2 = { defId: DEF.id, status: 'step', index: 2 }
  const doc = { ...fullDoc, variables: [] } // variables removed after passing step 1
  const trail = wizardTrail(DEF, s2, doc)
  assert.deepEqual(trail.map(n => n.status), ['done', 'todo', 'current', 'todo'])
})

test('transition functions are input-immutable', () => {
  const s0 = startWizard(DEF)
  const frozen = Object.freeze({ ...s0 })
  const docFrozen = Object.freeze({
    actors: Object.freeze([...fullDoc.actors]),
    variables: Object.freeze([...fullDoc.variables]),
    requirements: Object.freeze([...fullDoc.requirements]),
  })
  nextWizardState(DEF, frozen, docFrozen)
  prevWizardState(DEF, frozen)
  wizardStepGaps(DEF, frozen, docFrozen)
  wizardTrail(DEF, frozen, docFrozen)
  assert.deepEqual(frozen, s0)
})
