/**
 * robotFrames.test.js — robot identity, roster resolution and the 0/1/N states
 * (ADR-087 predicate; ADR-090 identity + cardinality).
 *
 * These are the evidence for ADR-090's three goals, at the layer that owns them:
 *   G1 「ロボットが指せること」 — resolveRobots gives every robot a stable id, so a
 *      second robot is addressable and a rename changes nothing.
 *   G2 「解いた前提を偽らないこと」 — selectRobot returns null rather than guessing,
 *      which is what lets the grasp gate refuse instead of solving for a ghost.
 *   G3 「0 台が正当な状態であること」 — an empty roster is a legal, named state.
 *
 * THREE-free so the grasp-search test lane can import the same module the app does.
 *
 * Run with:  node --test src/domain/robotFrames.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isRobotBaseFrame, isRobotTcpFrame, resolveRobots, selectRobot, robotCardinality,
  nextRobotBaseName, nextRobotTcpName, robotBaseSeedPose, Robot,
  ROBOT_ROLE, ROBOT_CARDINALITY, ROBOT_BASE_FRAME_NAME, TCP_FRAME_NAME,
} from './robotFrames.js'

// ── Identity: the declared role, with the legacy name as a ramp ───────────────

test('the declared role identifies a base frame regardless of its name', () => {
  assert.equal(isRobotBaseFrame({ id: 'a', name: 'left arm', parentId: null, robotRole: ROBOT_ROLE.BASE }), true)
  // A rename is a label change — it cannot un-robot the entity (ADR-090 G1).
  assert.equal(isRobotBaseFrame({ id: 'a', name: 'robot_base_2', parentId: null, robotRole: ROBOT_ROLE.BASE }), true)
})

test('the declared role wins over the legacy name in BOTH directions', () => {
  // A tcp that happens to be named robot_base is not a base…
  assert.equal(isRobotBaseFrame({ id: 't', name: ROBOT_BASE_FRAME_NAME, parentId: null, robotRole: ROBOT_ROLE.TCP }), false)
  // …and a base is not a tcp.
  assert.equal(isRobotTcpFrame({ id: 'b', name: TCP_FRAME_NAME, robotRole: ROBOT_ROLE.BASE }), false)
})

test('legacy scenes (no role field) still resolve by the world-parented name', () => {
  assert.equal(isRobotBaseFrame({ name: ROBOT_BASE_FRAME_NAME, parentId: null }), true)
  assert.equal(isRobotTcpFrame({ name: TCP_FRAME_NAME }), true)
})

test('rejects a robot_base-named frame that is NOT world-parented', () => {
  // tcp hangs off robot_base; a robot_base name under a parent is not the root.
  assert.equal(isRobotBaseFrame({ name: ROBOT_BASE_FRAME_NAME, parentId: 'base' }), false)
})

test('rejects the tcp frame and other names', () => {
  assert.equal(isRobotBaseFrame({ name: TCP_FRAME_NAME, parentId: 'base' }), false)
  assert.equal(isRobotBaseFrame({ name: 'Origin', parentId: null }), false)
  assert.equal(isRobotBaseFrame({ name: 'Cube', parentId: null }), false)
})

test('rejects nullish input', () => {
  assert.equal(isRobotBaseFrame(null), false)
  assert.equal(isRobotBaseFrame(undefined), false)
  assert.equal(isRobotTcpFrame(null), false)
})

// ── Roster resolution: 0 / 1 / N ─────────────────────────────────────────────

const base = (id, name, role = ROBOT_ROLE.BASE) => ({ id, name, parentId: null, robotRole: role })
const tcp  = (id, name, parentId) => ({ id, name, parentId, robotRole: ROBOT_ROLE.TCP })

test('zero robots is a resolvable state, not an error or a default (ADR-090 G3)', () => {
  const objects = [{ id: 'c', name: 'Cube', parentId: null }, { id: 'o', name: 'Origin', parentId: 'c' }]
  const robots = resolveRobots(objects)
  assert.deepEqual(robots, [])
  assert.equal(robotCardinality(robots), ROBOT_CARDINALITY.NONE)
  // Nothing invents a robot to fill the hole — that seed rule overruling the scene
  // is exactly ADR-090 §力学(4).
  assert.equal(selectRobot(robots, null), null)
})

test('one robot pairs its base with the tcp child', () => {
  const objects = [base('b', 'robot_base'), tcp('t', 'tcp', 'b')]
  const robots  = resolveRobots(objects)
  assert.equal(robots.length, 1)
  assert.equal(robots[0].id, 'b')                       // identity = the base ENTITY id
  assert.equal(robots[0].label, 'robot_base')
  assert.equal(robots[0].tcpFrame.id, 't')
  assert.equal(robots[0].hasTcp, true)
  assert.equal(robotCardinality(robots), ROBOT_CARDINALITY.SINGLE)
})

test('N robots each keep their OWN tcp — pairing is by parentId, not by name', () => {
  const objects = [
    base('b1', 'robot_base'), tcp('t1', 'tcp', 'b1'),
    base('b2', 'robot_base_2'), tcp('t2', 'tcp_2', 'b2'),
  ]
  const robots = resolveRobots(objects)
  assert.deepEqual(robots.map(r => r.id), ['b1', 'b2'])
  assert.deepEqual(robots.map(r => r.tcpFrame.id), ['t1', 't2'])
  assert.equal(robotCardinality(robots), ROBOT_CARDINALITY.MULTI)
})

test('two robots sharing a name are still two distinct robots (names are labels)', () => {
  // The pre-ADR-090 defect in one line: name-based identity collapses these two.
  const objects = [
    base('b1', 'robot_base'), tcp('t1', 'tcp', 'b1'),
    base('b2', 'robot_base'), tcp('t2', 'tcp', 'b2'),
  ]
  const robots = resolveRobots(objects)
  assert.equal(robots.length, 2)
  assert.notEqual(robots[0].id, robots[1].id)
})

test('a base with no tcp is a real state (hasTcp false), not a dropped robot', () => {
  const robots = resolveRobots([base('b', 'robot_base')])
  assert.equal(robots.length, 1)
  assert.equal(robots[0].hasTcp, false)
  assert.equal(robots[0].tcpFrame, null)
})

test('legacy pre-TF-tree scene: a world-parented tcp is adopted by the single base', () => {
  // The shape SceneService._upgradeLegacyRobotFrames re-homes; resolution must work
  // BEFORE that runs, since the upgrade asks this module which frames are robots.
  const objects = [
    { id: 'b', name: ROBOT_BASE_FRAME_NAME, parentId: null },
    { id: 't', name: TCP_FRAME_NAME, parentId: null },
  ]
  const robots = resolveRobots(objects)
  assert.equal(robots.length, 1)
  assert.equal(robots[0].tcpFrame.id, 't')
})

test('a stray world-parented tcp is NOT adopted once several robots exist', () => {
  // With N bases the legacy guess is unsafe (whose tcp is it?) — so it is not made.
  const objects = [
    base('b1', 'robot_base'), base('b2', 'robot_base_2'),
    { id: 't', name: TCP_FRAME_NAME, parentId: null },
  ]
  assert.deepEqual(resolveRobots(objects).map(r => r.hasTcp), [false, false])
})

// ── Selection: 0 / 1 / N (原則 #25 — the named predicate) ─────────────────────

test('one robot is selected implicitly, whatever the stored selection says', () => {
  const robots = resolveRobots([base('b', 'robot_base'), tcp('t', 'tcp', 'b')])
  assert.equal(selectRobot(robots, null)?.id, 'b')
  assert.equal(selectRobot(robots, 'stale-id')?.id, 'b')
})

test('N robots require an explicit pick — no silent "first one wins" (ADR-090 G2)', () => {
  const robots = resolveRobots([base('b1', 'a'), base('b2', 'b')])
  assert.equal(selectRobot(robots, null), null)
  assert.equal(selectRobot(robots, 'gone'), null)
  assert.equal(selectRobot(robots, 'b2')?.id, 'b2')
})

// ── Naming + seed placement ──────────────────────────────────────────────────

test('added robots take the next free names', () => {
  assert.equal(nextRobotBaseName([]), 'robot_base')
  assert.equal(nextRobotTcpName([]), 'tcp')
  const one = [base('b', 'robot_base'), tcp('t', 'tcp', 'b')]
  assert.equal(nextRobotBaseName(one), 'robot_base_2')
  assert.equal(nextRobotTcpName(one), 'tcp_2')
  const two = [...one, base('b2', 'robot_base_2'), tcp('t2', 'tcp_2', 'b2')]
  assert.equal(nextRobotBaseName(two), 'robot_base_3')
})

test('the n-th robot is offset so it does not spawn inside the previous one', () => {
  const first  = robotBaseSeedPose(0)
  const second = robotBaseSeedPose(1)
  assert.deepEqual(first.position, { x: -2, y: 2, z: 0 })     // ADR-083 default kept
  assert.notDeepEqual(second.position, first.position)
  assert.deepEqual(second.rotation, { x: 0, y: 0, z: 0, w: 1 })
})

test('a Robot aggregate is frozen — its identity cannot be reassigned', () => {
  const r = new Robot({ id: 'b', name: 'robot_base' }, null)
  assert.throws(() => { r.baseFrame = { id: 'x' } }, TypeError)
})
