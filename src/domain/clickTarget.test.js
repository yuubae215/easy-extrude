/**
 * The click-resolution rule (ADR-140), asked where it is now writable: a pure
 * function. The rule spent its life inside three pointer handlers, where asking
 * it required a camera, a renderer and a pointer — which is why three copies of
 * it drifted apart without a single test noticing (原則 #3).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CLICK_TARGET_KIND as K,
  CLICK_SCOPE_RANK,
  BODY_RANK,
  RETIRED_CLICK_RULES,
  clickScopeRank,
  chooseClickTarget,
} from './clickTarget.js'

/** Nothing is within anything — the default for cases with no frame involved. */
const nothingWithin = () => false

const cand = (kind, id, distance) => ({ kind, obj: { id }, distance })

// ── The change ADR-140 makes ────────────────────────────────────────────────

test('a solid beats the robot only by being NEARER', () => {
  const solid = cand(K.SOLID, 'pedestal', 3)
  const robot = cand(K.ROBOT, 'robot_base', 9)
  assert.equal(chooseClickTarget([solid, robot], nothingWithin).obj.id, 'pedestal')
})

test('the robot wins when the robot is nearer — the defect this ADR closes', () => {
  // The bundled pick-and-place cells put a floor slab and a pedestal along the
  // ray behind the arm. Before ADR-140 the arm lost to both unconditionally,
  // because it was consulted only when NOTHING else was hit.
  const robot = cand(K.ROBOT, 'robot_base', 2)
  const solid = cand(K.SOLID, 'floor', 40)
  assert.equal(chooseClickTarget([solid, robot], nothingWithin).obj.id, 'robot_base')
})

test('distance decides even when the solid is hit first in the candidate list', () => {
  // Ordering must not carry information — the pre-ADR-140 rule was ordering.
  const robot = cand(K.ROBOT, 'robot_base', 1)
  const solid = cand(K.SOLID, 'table', 2)
  assert.equal(chooseClickTarget([solid, robot], nothingWithin).obj.id, 'robot_base')
  assert.equal(chooseClickTarget([robot, solid], nothingWithin).obj.id, 'robot_base')
})

test('an exact tie keeps the solid — a declared stable order, not chance', () => {
  const solid = cand(K.SOLID, 'block', 5)
  const robot = cand(K.ROBOT, 'robot_base', 5)
  assert.equal(chooseClickTarget([solid, robot], nothingWithin).obj.id, 'block')
  assert.equal(chooseClickTarget([robot, solid], nothingWithin).obj.id, 'block')
})

// ── What ADR-140 preserves ──────────────────────────────────────────────────

test('a frame within the body underneath it wins regardless of depth', () => {
  // PHILOSOPHY #22 — the narrower scope. Unchanged from before ADR-140.
  const frame = cand(K.FRAME, 'cf_of_block', 80)
  const solid = cand(K.SOLID, 'block', 2)
  const within = (f, b) => f.id === 'cf_of_block' && b.id === 'block'
  assert.equal(chooseClickTarget([frame, solid], within).obj.id, 'cf_of_block')
})

test('an unrelated frame does not shadow the body — its tap box is generous', () => {
  const frame = cand(K.FRAME, 'cf_of_something_else', 1)
  const solid = cand(K.SOLID, 'block', 9)
  assert.equal(chooseClickTarget([frame, solid], nothingWithin).obj.id, 'block')
})

test("a robot's own tcp frame still beats the skeleton", () => {
  // The tcp frame is a CHILD of the base frame (ADR-090), so containment holds
  // and the narrower target wins — clicking the tool point selects the tool
  // point, not the whole arm.
  const frame = cand(K.FRAME, 'tcp', 6)
  const robot = cand(K.ROBOT, 'robot_base', 2)
  const within = (f, b) => f.id === 'tcp' && b.id === 'robot_base'
  assert.equal(chooseClickTarget([frame, robot], within).obj.id, 'tcp')
})

test("the robot's own BASE frame resolves to the same entity either way", () => {
  // `isCfDescendantOf(base, base.id)` is false — a frame is not its own
  // descendant — so the body wins. The body IS the base frame, so the answer is
  // the same entity. This is asserted rather than assumed, because "the rule
  // picks the other branch but the outcome is identical" is exactly the kind of
  // coincidence that stops being true when someone edits one branch.
  const frame = cand(K.FRAME, 'robot_base', 5)
  const robot = cand(K.ROBOT, 'robot_base', 2)
  assert.equal(chooseClickTarget([frame, robot], nothingWithin).obj.id, 'robot_base')
})

test('an annotation is outranked by any body, however far behind', () => {
  const ann   = cand(K.ANNOTATION, 'dim_line', 1)
  const solid = cand(K.SOLID, 'block', 100)
  assert.equal(chooseClickTarget([ann, solid], nothingWithin).obj.id, 'block')
})

test('an annotation wins when it is all there is', () => {
  const ann = cand(K.ANNOTATION, 'dim_line', 7)
  assert.equal(chooseClickTarget([ann], nothingWithin).obj.id, 'dim_line')
})

test('nothing hit resolves to null, and nulls in the list are ignored', () => {
  assert.equal(chooseClickTarget([], nothingWithin), null)
  assert.equal(chooseClickTarget([null, undefined], nothingWithin), null)
  assert.equal(chooseClickTarget(null, nothingWithin), null)
  // A candidate without an entity is not a candidate.
  assert.equal(chooseClickTarget([{ kind: K.SOLID, obj: null, distance: 1 }], nothingWithin), null)
})

test('a candidate with no usable distance still wins its rank when alone', () => {
  // The bounding-box fallbacks can report a hit whose depth is not meaningful.
  // Treating that as "infinitely far" keeps it losing every comparison it should
  // lose, without making it vanish when it is the only thing under the cursor.
  const ann = { kind: K.ANNOTATION, obj: { id: 'region' }, distance: undefined }
  assert.equal(chooseClickTarget([ann], nothingWithin).obj.id, 'region')

  const near = cand(K.ANNOTATION, 'near', 3)
  assert.equal(chooseClickTarget([ann, near], nothingWithin).obj.id, 'near')
})

// ── The vocabulary is closed (原則 #31) ─────────────────────────────────────

test('an undeclared kind throws instead of silently taking some rank', () => {
  assert.throws(() => clickScopeRank('gizmo'), /undeclared click-target kind/)
  assert.throws(() => clickScopeRank(undefined), /undeclared click-target kind/)
})

test('an undeclared kind throws even when it would have LOST', () => {
  // A rule that only notices unknown kinds when they happen to win is a rule
  // that passes its own suite and fails in the field.
  const near    = cand(K.SOLID, 'block', 1)
  const unknown = { kind: 'gizmo', obj: { id: 'g' }, distance: 999 }
  assert.throws(() => chooseClickTarget([near, unknown], nothingWithin),
    /undeclared click-target kind/)
})

test('every declared kind has a rank, and solid and robot share it', () => {
  // Counting the KINDS, not the rows that happen to be there: a kind added to
  // the vocabulary without a rank is the 0 that has no field to appear in.
  for (const kind of Object.values(K)) {
    assert.equal(typeof clickScopeRank(kind), 'number', `${kind} has no declared rank`)
  }
  assert.equal(Object.keys(CLICK_SCOPE_RANK).length, Object.values(K).length)
  assert.equal(clickScopeRank(K.SOLID), clickScopeRank(K.ROBOT),
    'a robot arm is a body like any other — sharing the rank is what sends them to distance')
  assert.equal(clickScopeRank(K.SOLID), BODY_RANK)
  assert.ok(clickScopeRank(K.FRAME) < BODY_RANK)
  assert.ok(clickScopeRank(K.ANNOTATION) > BODY_RANK)
})

test('the retired shapes are named, so their removal is counted', () => {
  assert.deepEqual([...RETIRED_CLICK_RULES], ['robot-last-resort', 'per-handler-chain'])
})
