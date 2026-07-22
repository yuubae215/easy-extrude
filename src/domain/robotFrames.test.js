/**
 * robotFrames.test.js — isRobotBaseFrame predicate (ADR-087).
 *
 * The robot skeleton's visibility is owned by the world-parented root robot_base
 * entity (its Outliner eye, 原則 #4). isRobotBaseFrame identifies that entity so
 * AppController._setObjectVisible / _syncRobotStage share one definition of
 * "which frame is the robot base" (§1.1). THREE-free so the grasp-search test
 * lane can import it.
 *
 * Run with:  node --test src/domain/robotFrames.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isRobotBaseFrame, ROBOT_BASE_FRAME_NAME, TCP_FRAME_NAME } from './robotFrames.js'

test('matches the world-parented root robot_base frame', () => {
  assert.equal(isRobotBaseFrame({ name: ROBOT_BASE_FRAME_NAME, parentId: null }), true)
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
})
