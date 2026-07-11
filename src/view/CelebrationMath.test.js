/**
 * CelebrationMath tests (ADR-065 Phase 4, named rule 4).
 *
 * The load-bearing invariants:
 *   - initial load is NOT a transition (prev = null → nothing fires),
 *   - malformed / undecodable snapshots degrade to false/null (#11),
 *   - pickCelebration returns AT MOST ONE descriptor with a fixed priority,
 *   - descriptors derive from tokens and unknown kinds yield null.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CELEBRATION_MILESTONES,
  clearedTransition,
  allGreenTransition,
  commandMilestone,
  celebrationDescriptor,
  pickCelebration,
  particleFrame,
} from './CelebrationMath.js'
import { COLOR, DURATION } from '../theme/tokens.js'

// ── clearedTransition ────────────────────────────────────────────────────────

test('clearedTransition fires only on non-empty → empty', () => {
  assert.equal(clearedTransition(['c1'], []), true)
  assert.equal(clearedTransition(['c1', 'c2'], []), true)
  assert.equal(clearedTransition(['c1'], ['c1']), false) // still open
  assert.equal(clearedTransition([], []), false)         // was already clear — a state, not a transition
  assert.equal(clearedTransition([], ['c1']), false)     // opened, not cleared
})

test('clearedTransition: initial load is not a transition (null prev)', () => {
  assert.equal(clearedTransition(null, []), false)
  assert.equal(clearedTransition(undefined, []), false)
})

test('clearedTransition degrades on malformed input', () => {
  assert.equal(clearedTransition('x', []), false)
  assert.equal(clearedTransition(['c1'], 'y'), false)
  assert.equal(clearedTransition(['c1'], null), false)
})

// ── allGreenTransition ───────────────────────────────────────────────────────

test('allGreenTransition fires when the last non-pass check flips', () => {
  assert.equal(allGreenTransition(['a:pass', 'b:fail'], ['a:pass', 'b:pass']), true)
  assert.equal(allGreenTransition(['a:blocked'], ['a:pass']), true)
})

test('allGreenTransition does not fire on a standing all-green state', () => {
  assert.equal(allGreenTransition(['a:pass', 'b:pass'], ['a:pass', 'b:pass']), false)
})

test('allGreenTransition: zero checks all pass is vacuous, not a win', () => {
  assert.equal(allGreenTransition(['a:fail'], []), false)
})

test('allGreenTransition: initial load is not a transition (null prev)', () => {
  assert.equal(allGreenTransition(null, ['a:pass']), false)
})

test('allGreenTransition degrades on undecodable status keys', () => {
  assert.equal(allGreenTransition(['a:fail'], ['a:???']), false)
  assert.equal(allGreenTransition(['nocolon'], ['a:pass']), false)
})

// ── commandMilestone ─────────────────────────────────────────────────────────

test('commandMilestone returns the largest milestone crossed upward', () => {
  assert.equal(commandMilestone(9, 10), 10)
  assert.equal(commandMilestone(24, 26), 25)
  assert.equal(commandMilestone(0, 50), 50) // several crossed → the largest
})

test('commandMilestone never fires downward, flat, or between milestones', () => {
  assert.equal(commandMilestone(10, 9), null)  // undo
  assert.equal(commandMilestone(10, 10), null)
  assert.equal(commandMilestone(11, 24), null)
})

test('commandMilestone degrades on non-finite input (initial load has no prev)', () => {
  assert.equal(commandMilestone(null, 10), null)
  assert.equal(commandMilestone(undefined, 10), null)
  assert.equal(commandMilestone(9, NaN), null)
})

test('milestones stay within the CommandStack.MAX=50 reachable range', () => {
  assert.ok(CELEBRATION_MILESTONES.every(m => m <= 50))
  assert.ok(Object.isFrozen(CELEBRATION_MILESTONES))
})

// ── celebrationDescriptor ────────────────────────────────────────────────────

test('descriptors derive from tokens', () => {
  const d = celebrationDescriptor('all-green')
  assert.equal(d.color, COLOR.fxGreen)
  assert.equal(d.durationMs, DURATION.celebration)
  assert.equal(typeof d.label, 'string')
  assert.ok(d.particles > 0)
})

test('milestone descriptor requires a finite milestone number', () => {
  assert.equal(celebrationDescriptor('milestone', { milestone: 25 }).label, '25 operations this session')
  assert.equal(celebrationDescriptor('milestone'), null)
  assert.equal(celebrationDescriptor('milestone', { milestone: NaN }), null)
})

test('unknown kinds yield null, never a guessed celebration', () => {
  assert.equal(celebrationDescriptor('confetti-everywhere'), null)
  assert.equal(celebrationDescriptor(undefined), null)
})

// ── pickCelebration (budget 1, fixed priority) ───────────────────────────────

const cleared    = { prev: ['x'], cur: [] }
const notCleared = { prev: ['x'], cur: ['x'] }
const wentGreen  = { prev: ['a:fail'], cur: ['a:pass'] }
const stillRed   = { prev: ['a:fail'], cur: ['a:fail'] }

test('pickCelebration returns at most ONE descriptor, biggest win first', () => {
  // All three transitions on one re-projection → all-green wins.
  const all = pickCelebration({ checks: wentGreen, conflicts: cleared, questions: cleared })
  assert.equal(all.kind, 'all-green')
  // No check transition → conflicts beat questions.
  const two = pickCelebration({ checks: stillRed, conflicts: cleared, questions: cleared })
  assert.equal(two.kind, 'conflicts-cleared')
  const one = pickCelebration({ checks: stillRed, conflicts: notCleared, questions: cleared })
  assert.equal(one.kind, 'questions-cleared')
})

test('pickCelebration: nothing fired → null; malformed → null', () => {
  assert.equal(pickCelebration({ checks: stillRed, conflicts: notCleared, questions: notCleared }), null)
  assert.equal(pickCelebration({}), null)
  assert.equal(pickCelebration(null), null)
})

test('pickCelebration: initial load (null prevs everywhere) fires nothing', () => {
  assert.equal(pickCelebration({
    checks:    { prev: null, cur: ['a:pass'] },
    conflicts: { prev: null, cur: [] },
    questions: { prev: null, cur: [] },
  }), null)
})

// ── particleFrame ────────────────────────────────────────────────────────────

test('particleFrame flies out, lifts, and fades under motion', () => {
  const start = particleFrame(0)
  const mid   = particleFrame(0.5)
  const end   = particleFrame(1)
  assert.equal(start.dist, 0)
  assert.ok(mid.dist > start.dist && end.dist > mid.dist)
  assert.equal(end.opacity, 0)
  assert.ok(end.scale < start.scale)
})

test('particleFrame clamps progress outside [0,1]', () => {
  assert.deepEqual(particleFrame(-1), particleFrame(0))
  assert.deepEqual(particleFrame(2), particleFrame(1))
})

test('particleFrame under reduced motion is a static held cue, not nothing', () => {
  const a = particleFrame(0.1, true)
  const b = particleFrame(0.9, true)
  assert.deepEqual(a, b)          // frozen — no movement
  assert.ok(a.opacity > 0)        // …but visibly present (#11)
})
