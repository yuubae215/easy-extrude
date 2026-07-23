/**
 * UrdfChain.test.js — pure URDF→chain parser + derived tcp seed (ADR-088).
 *
 * These tests are the EVIDENCE (§1.2) that the tcp flange seed is single-sourced
 * on the URDF + rest pose: parsing the shipped skeleton and running FK at the
 * rest pose reproduces the position ADR-084 hand-copied as a constant, and
 * changing the rest pose makes the seed follow with no constant left to edit.
 *
 * THREE-free / DOM-free — runs under bare `node --test`.
 *
 * Run with:  node --test src/robotics/UrdfChain.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseUrdfChain, restPoseToQ, deriveFlangeSeed, MalformedUrdf } from './UrdfChain.js'
import { forwardKinematics } from './Kinematics.js'
import { ROBOT_REST_POSE } from '../domain/robotConfig.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const URDF = readFileSync(join(HERE, '../../public/robot/skeleton_arm.urdf'), 'utf8')

test('parses the skeleton into the 6-joint UR serial chain, base→flange order', () => {
  const chain = parseUrdfChain(URDF)
  assert.deepEqual(
    chain.joints.map(j => j.name),
    ['shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint', 'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint'],
  )
  // origins / axes / limits carried through for FK
  const lift = chain.joints[1]
  assert.equal(lift.type, 'revolute')
  assert.deepEqual(lift.origin.rpy, [1.570796327, 0, 0])
  assert.deepEqual(lift.axis, [0, 0, 1])
  assert.deepEqual(chain.joints[0].limit, { lower: -6.2832, upper: 6.2832 })
})

test('restPoseToQ maps named angles to an ordered q vector (absent joints = 0)', () => {
  const chain = parseUrdfChain(URDF)
  // pan (0) lift (-1.0) elbow (1.2) wrist_1 (-1.8) wrist_2 (-1.5708) wrist_3 (0)
  assert.deepEqual(restPoseToQ(chain, ROBOT_REST_POSE), [0, -1.0, 1.2, -1.8, -1.5708, 0])
})

test('derived flange seed reproduces ADR-084 hand-copied constant (regression baseline)', () => {
  const seed = deriveFlangeSeed(URDF, ROBOT_REST_POSE)
  // The old constant was (-0.717, -0.133, 0.346), read off the real urdf-loader
  // render — matched here to 3dp straight from the URDF FK.
  assert.ok(Math.abs(seed.x - (-0.717)) < 5e-4, `x=${seed.x}`)
  assert.ok(Math.abs(seed.y - (-0.133)) < 5e-4, `y=${seed.y}`)
  assert.ok(Math.abs(seed.z - 0.346) < 5e-4, `z=${seed.z}`)
})

test('the seed FOLLOWS the rest pose — no hand-copied constant survives (ADR-088)', () => {
  // A different rest pose must move the seed. If a constant were still the source
  // of truth this would keep returning the old flange position.
  const restA = ROBOT_REST_POSE
  const restB = { ...ROBOT_REST_POSE, shoulder_pan_joint: Math.PI / 2 }
  const seedA = deriveFlangeSeed(URDF, restA)
  const seedB = deriveFlangeSeed(URDF, restB)
  assert.notDeepEqual(seedB, seedA)
  // pan is the base yaw: it rotates the (x,y) flange offset about world +Z, so a
  // 90° pan must swap the base-frame x/y roughly (x→y, y→-x), z unchanged.
  assert.ok(Math.abs(seedB.z - seedA.z) < 1e-9, 'z is invariant under base yaw')
  assert.ok(Math.abs(seedB.x - (-seedA.y)) < 1e-9 && Math.abs(seedB.y - seedA.x) < 1e-9, 'x/y rotate 90°')
})

test('the seed derivation equals a straight FK call (no hidden transform)', () => {
  const chain = parseUrdfChain(URDF)
  const { position } = forwardKinematics(chain, restPoseToQ(chain, ROBOT_REST_POSE))
  assert.deepEqual(deriveFlangeSeed(URDF, ROBOT_REST_POSE), { x: position.x, y: position.y, z: position.z })
})

test('rejects malformed / empty URDF input (no silent 0,0,0)', () => {
  assert.throws(() => parseUrdfChain(''), MalformedUrdf)
  assert.throws(() => parseUrdfChain('<robot></robot>'), MalformedUrdf)
  assert.throws(() => parseUrdfChain(null), MalformedUrdf)
})

test('rejects a branching (non-serial) kinematic tree — outside the shipped subset', () => {
  const branching = `<robot>
    <joint name="a" type="fixed"><parent link="root"/><child link="l1"/></joint>
    <joint name="b" type="fixed"><parent link="root"/><child link="l2"/></joint>
  </robot>`
  assert.throws(() => parseUrdfChain(branching), MalformedUrdf)
})
