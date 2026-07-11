import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TOUR_STEPS, startTour, nextTourState, tourStepDescriptor,
  tourAnchor, tourVisible,
} from './TourMath.js'

// Fresh desktop boot: one solid, selected, object mode, nothing committed.
const bootFacts = () => ({
  solidCount: 1, hasSelection: true, mode: 'object',
  lastLabel: null, lastPhase: null,
})

// ── Catalog shape ────────────────────────────────────────────────────────────

test('TOUR_STEPS is a frozen ordered trail with unique ids and total predicates', () => {
  assert.ok(Object.isFrozen(TOUR_STEPS))
  assert.ok(TOUR_STEPS.length >= 3)
  const ids = TOUR_STEPS.map(s => s.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const s of TOUR_STEPS) {
    assert.ok(Object.isFrozen(s))
    assert.equal(typeof s.title, 'string')
    assert.equal(typeof s.text, 'string')
    assert.equal(typeof s.anchor, 'string')
    assert.equal(typeof s.done, 'function')
    // every done predicate is total on valid facts (no throw, boolean-ish)
    assert.equal(typeof (!!s.done(bootFacts())), 'boolean')
  }
})

test('the add step anchors the Outliner "+ Add" button', () => {
  assert.equal(TOUR_STEPS[0].id, 'add')
  assert.equal(TOUR_STEPS[0].anchor, 'outliner-add')
})

// ── startTour ────────────────────────────────────────────────────────────────

test('startTour on fresh boot facts opens the add quest', () => {
  assert.deepEqual(startTour(bootFacts()), { status: 'active', step: 'add' })
})

test('startTour skips steps the facts already satisfy', () => {
  // Two solids and a selection → add and select are already demonstrated.
  const facts = { ...bootFacts(), solidCount: 2 }
  assert.deepEqual(startTour(facts), { status: 'active', step: 'grab' })
})

test('startTour opens the first quest the facts leave open', () => {
  const facts = {
    solidCount: 3, hasSelection: true, mode: 'edit',
    lastLabel: 'Face Extrude', lastPhase: 'push',
  }
  // add/select/edit/extrude are satisfied; grab still wants a Move landing
  // (one lastLabel cannot satisfy both grab and extrude — the trail is
  // honest about which affordance remains undemonstrated).
  assert.deepEqual(startTour(facts), { status: 'active', step: 'grab' })
  assert.deepEqual(
    startTour({ ...facts, lastLabel: 'Move', lastPhase: 'push' }),
    { status: 'active', step: 'extrude' })
})

test('startTour degrades to null on malformed facts — no wrong hint (#11)', () => {
  assert.equal(startTour(null), null)
  assert.equal(startTour({}), null)
  assert.equal(startTour({ ...bootFacts(), solidCount: NaN }), null)
  assert.equal(startTour({ ...bootFacts(), solidCount: -1 }), null)
  assert.equal(startTour({ ...bootFacts(), hasSelection: 1 }), null)
  assert.equal(startTour({ ...bootFacts(), mode: '' }), null)
  assert.equal(startTour({ ...bootFacts(), lastPhase: 'preview' }), null)
})

// ── nextTourState ────────────────────────────────────────────────────────────

test('nextTourState returns the SAME reference while the quest is open', () => {
  const state = { status: 'active', step: 'add' }
  assert.equal(nextTourState(state, bootFacts()), state)
})

test('nextTourState advances when the open quest completes, skipping satisfied steps', () => {
  const state = { status: 'active', step: 'add' }
  // Adding a box auto-selects it → select is skipped, grab opens.
  const facts = { ...bootFacts(), solidCount: 2, lastLabel: 'Add "Box.002"', lastPhase: 'push' }
  assert.deepEqual(nextTourState(state, facts), { status: 'active', step: 'grab' })
})

test('grab completes only on a committed Move push, not undo or another label', () => {
  const state = { status: 'active', step: 'grab' }
  const base = { ...bootFacts(), solidCount: 2 }
  assert.equal(nextTourState(state, { ...base, lastLabel: 'Move', lastPhase: 'undo' }), state)
  assert.equal(nextTourState(state, { ...base, lastLabel: 'Rotate Solid', lastPhase: 'push' }), state)
  assert.deepEqual(
    nextTourState(state, { ...base, lastLabel: 'Move 3 objects', lastPhase: 'push' }),
    { status: 'active', step: 'edit' })
})

test('the last quest completion lands on done', () => {
  const state = { status: 'active', step: 'extrude' }
  const facts = {
    solidCount: 2, hasSelection: true, mode: 'edit',
    lastLabel: 'Face Extrude', lastPhase: 'push',
  }
  assert.deepEqual(nextTourState(state, facts), { status: 'done' })
})

test('nextTourState never regresses: an undone box does not resurrect add', () => {
  const state = { status: 'active', step: 'grab' }
  const facts = { ...bootFacts(), solidCount: 1, lastLabel: 'Add "Box.002"', lastPhase: 'undo' }
  assert.equal(nextTourState(state, facts), state)
})

test('nextTourState holds the same state on malformed facts and passes null/done through', () => {
  const state = { status: 'active', step: 'add' }
  assert.equal(nextTourState(state, null), state)
  assert.equal(nextTourState(state, { junk: true }), state)
  assert.equal(nextTourState(null, bootFacts()), null)
  const done = { status: 'done' }
  assert.equal(nextTourState(done, bootFacts()), done)
})

test('a corrupt state (unknown step id) degrades to null — no wrong hint (#11)', () => {
  assert.equal(nextTourState({ status: 'active', step: 'fly' }, bootFacts()), null)
})

// ── Rendering projections ────────────────────────────────────────────────────

test('tourStepDescriptor projects the open quest with its trail position', () => {
  const d = tourStepDescriptor({ status: 'active', step: 'grab' })
  assert.equal(d.id, 'grab')
  assert.equal(d.index, 3)
  assert.equal(d.total, TOUR_STEPS.length)
  assert.ok(Array.isArray(d.keys))
  assert.equal(tourStepDescriptor(null), null)
  assert.equal(tourStepDescriptor({ status: 'done' }), null)
  assert.equal(tourStepDescriptor({ status: 'active', step: 'fly' }), null)
})

test('tourAnchor derives from the same descriptor (one state, one anchor — §1.1)', () => {
  assert.equal(tourAnchor({ status: 'active', step: 'add' }), 'outliner-add')
  assert.equal(tourAnchor({ status: 'active', step: 'grab' }), 'canvas')
  assert.equal(tourAnchor({ status: 'done' }), null)
  assert.equal(tourAnchor(null), null)
})

test('tourVisible suppresses under any overlay without touching the state', () => {
  const state = { status: 'active', step: 'add' }
  assert.equal(tourVisible(state), true)
  assert.equal(tourVisible(state, {}), true)
  assert.equal(tourVisible(state, { contextActive: true }), false)
  assert.equal(tourVisible(state, { demoActive: true }), false)
  assert.equal(tourVisible(state, { galleryOpen: true }), false)
  assert.equal(tourVisible({ status: 'done' }), true)
  assert.equal(tourVisible(null), false)
  assert.equal(tourVisible({ status: 'weird' }), false)
})
