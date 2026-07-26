/**
 * originFrame.test.js — the Origin CF identity rule, and its cardinality.
 *
 * The predicates are one-liners; what needs pinning is the CARDINALITY contract
 * (原則 #31), because 0 and N are the states that do not look like states:
 *
 *   0 — a Solid with no Origin CF (pre-ADR-037 scene). Must answer `null`, not a
 *       silently invented frame.
 *   1 — the steady state.
 *   N — several Solids, each with its OWN Origin. All N frames share the name, so
 *       a fixture with a single Solid can never show that `findOriginFrame` is
 *       actually discriminating on the parent. Same shape as ADR-093's lockstep
 *       defect: the bug only exists at N.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ORIGIN_FRAME_NAME,
  isOriginFrame,
  isOriginFrameName,
  findOriginFrame,
} from './originFrame.js'

/** Minimal duck-typed entity — these predicates are THREE-free by contract. */
const frame = (id, name, parentId) => ({ id, name, parentId })

test('isOriginFrame — the body frame, and nothing else', () => {
  assert.equal(isOriginFrame(frame('o', ORIGIN_FRAME_NAME, 'cube')), true)

  assert.equal(isOriginFrame(frame('f', 'Frame 1', 'o')), false)
  assert.equal(isOriginFrame(frame('r', 'robot_base', null)), false)
  // Case- and whitespace-sensitive: the name IS the rule, so near-misses are misses.
  assert.equal(isOriginFrame(frame('x', 'origin', 'cube')), false)
  assert.equal(isOriginFrame(frame('x', 'Origin ', 'cube')), false)
  // A label that merely mentions the word is not the body frame.
  assert.equal(isOriginFrame(frame('x', 'World Origin', null)), false)

  // Absent input is a miss, not a throw — callers pass unresolved lookups straight in.
  assert.equal(isOriginFrame(null), false)
  assert.equal(isOriginFrame(undefined), false)
  assert.equal(isOriginFrame({}), false)
})

test('isOriginFrameName — the reserved name, asked before a rename lands', () => {
  assert.equal(isOriginFrameName(ORIGIN_FRAME_NAME), true)
  assert.equal(isOriginFrameName('Frame 1'), false)
  assert.equal(isOriginFrameName('origin'), false)
  assert.equal(isOriginFrameName(null), false)
  assert.equal(isOriginFrameName(undefined), false)
})

test('findOriginFrame — cardinality 1: the parent’s own body frame', () => {
  const objects = [
    frame('cube', 'Cube', null),
    frame('cube_origin', ORIGIN_FRAME_NAME, 'cube'),
    frame('mount', 'camera_mount', 'cube_origin'),
  ]
  assert.equal(findOriginFrame(objects, 'cube')?.id, 'cube_origin')
})

test('findOriginFrame — cardinality 0: a Solid with no Origin answers null', () => {
  // The pre-ADR-037 shape that _ensureOriginFrames repairs. The predicate must
  // NOT invent a frame here: the repair is an explicit, named, side-effecting
  // step, and a silent default is exactly the ADR-090 ghost-robot failure.
  const legacy = [frame('cube', 'Cube', null)]
  assert.equal(findOriginFrame(legacy, 'cube'), null)

  // A parent that is not the Origin's parent gets null too, even though an
  // Origin exists in the scene — scope is the whole point.
  const objects = [
    frame('cube', 'Cube', null),
    frame('cube_origin', ORIGIN_FRAME_NAME, 'cube'),
    frame('line', 'Measure 1', null),
  ]
  assert.equal(findOriginFrame(objects, 'line'), null)

  // No parent to scope by → no answer (never "the first Origin in the scene").
  assert.equal(findOriginFrame(objects, null), null)
  assert.equal(findOriginFrame(objects, undefined), null)
  assert.equal(findOriginFrame(null, 'cube'), null)
})

test('findOriginFrame — cardinality N: N Solids each resolve to their OWN Origin', () => {
  // The case a single-Solid fixture cannot see. All three Origins share the name;
  // only the parent scope tells them apart. If the parent filter were ever
  // dropped, this is the test that fails — the 1-Solid tests above would not.
  const objects = [
    frame('a', 'Cube', null),
    frame('a_origin', ORIGIN_FRAME_NAME, 'a'),
    frame('b', 'Cube 2', null),
    frame('b_origin', ORIGIN_FRAME_NAME, 'b'),
    frame('c', 'Cube 3', null),
    frame('c_origin', ORIGIN_FRAME_NAME, 'c'),
  ]

  assert.equal(findOriginFrame(objects, 'a')?.id, 'a_origin')
  assert.equal(findOriginFrame(objects, 'b')?.id, 'b_origin')
  assert.equal(findOriginFrame(objects, 'c')?.id, 'c_origin')

  // Iteration order must not leak into the answer: reversing the scene must not
  // change which Origin each Solid gets.
  const reversed = [...objects].reverse()
  assert.equal(findOriginFrame(reversed, 'a')?.id, 'a_origin')
  assert.equal(findOriginFrame(reversed, 'c')?.id, 'c_origin')
})

test('findOriginFrame — an illegal duplicate is reported, not hidden', () => {
  // Two Origins under one Solid is an illegal state (nothing creates it, and the
  // reserved-name guard keeps rename from reaching it). Should it ever occur, the
  // predicate answers with the first match rather than throwing or returning null
  // — the caller stays on a working path and the surplus frame is visible in the
  // Outliner rather than silently swallowing the lookup.
  const objects = [
    frame('cube', 'Cube', null),
    frame('origin_1', ORIGIN_FRAME_NAME, 'cube'),
    frame('origin_2', ORIGIN_FRAME_NAME, 'cube'),
  ]
  assert.equal(findOriginFrame(objects, 'cube')?.id, 'origin_1')
})

test('findOriginFrame accepts an already-parent-scoped child list', () => {
  // SceneService / ExtrudeSketchCommand pass getChildren(parentId), which is
  // already filtered; the redundant parentId filter must not reject it.
  const children = [
    frame('cube_origin', ORIGIN_FRAME_NAME, 'cube'),
    frame('note', 'Point 1', 'cube'),
  ]
  assert.equal(findOriginFrame(children, 'cube')?.id, 'cube_origin')
})
