/**
 * robotTool — the tool bolted to the flange (ADR-150 D4/D5).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  TOOL_LENGTH_M, toolParts,
  DEFAULT_TOOL_MOUNT, axialToolLengthM, toolMountOf, toolMountGap, tcpMarkerPose,
  toolMountEditBlockedReason, TOOL_MOUNT_UNDECLARED_REASON, TOOL_MOUNT_NOT_AXIAL_REASON,
  TOOL_MOUNT_EDIT_DEFERRED_REASON,
} from './robotTool.js'
import { parseUrdfChain } from '../robotics/UrdfChain.js'
import { forwardKinematics } from '../robotics/Kinematics.js'
import { forwardKinematics as dhForwardKinematics } from '../robotics/urKinematics.js'

test('the declared tool length is the agreed 150 mm (both hand kinds share it)', () => {
  assert.equal(TOOL_LENGTH_M, 0.15)
})

test('the drawn fingertips end exactly at the TCP the solver was given', () => {
  const tips = toolParts(TOOL_LENGTH_M)
    .filter(p => p.part === 'finger')
    .map(p => p.center[2] + p.size[2] / 2)
  assert.equal(tips.length, 2)
  for (const tip of tips) assert.ok(Math.abs(tip - TOOL_LENGTH_M) < 1e-12, `tip at ${tip}`)
  // …and nothing is drawn behind the flange face or beyond the TCP.
  for (const p of toolParts(TOOL_LENGTH_M)) {
    const half = p.shape === 'cylinder' ? p.size[1] / 2 : p.size[2] / 2
    assert.ok(p.center[2] - half >= -1e-12 && p.center[2] + half <= TOOL_LENGTH_M + 1e-12, p.part)
  }
})

test('the jaws straddle ±X — the closing axis the jaw gate measures (ADR-150 D5)', () => {
  const xs = toolParts(TOOL_LENGTH_M).filter(p => p.part === 'finger').map(p => p.center[0]).sort()
  assert.ok(xs[0] < 0 && xs[1] > 0)
  assert.equal(xs[0], -xs[1])
})

test('a non-positive tool length is refused, not drawn as nothing', () => {
  assert.throws(() => toolParts(0))
  assert.throws(() => toolParts(-0.1))
  assert.throws(() => toolParts(NaN))
})

test('the link the tool is drawn on (wrist_3_link) IS the DH flange frame, orientation included', () => {
  // The cross-language FK fixture pins POSITION only. The tool needs the whole
  // frame: +Z is where it sticks out, +X is where its jaws close. If the URDF's
  // last link were rotated relative to the DH flange, the drawn tool would
  // point somewhere the solved one does not — silently, since both look like a
  // gripper on an arm.
  const urdf = fs.readFileSync(new URL('../../public/robot/skeleton_arm.urdf', import.meta.url), 'utf8')
  const chain = parseUrdfChain(urdf)
  const dh = { d1: 0.1625, a2: -0.425, a3: -0.3922, d4: 0.1333, d5: 0.0997, d6: 0.0996 }
  let seed = 1
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  let worst = 0
  for (let n = 0; n < 40; n++) {
    const q = Array.from({ length: 6 }, () => (rnd() * 2 - 1) * Math.PI)
    const { quaternion: { x, y, z, w } } = forwardKinematics(chain, q)
    const R = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    const m = dhForwardKinematics(dh, q)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(R[r][c] - m[r * 4 + c]))
  }
  assert.ok(worst < 1e-8, `wrist_3_link vs DH flange rotation differs by ${worst}`)
})

// ── ADR-151: the tool mount is the source; the TCP is the shared interface ────

const tcpWith = (mount, extra = {}) => ({
  robotRole: 'tcp', mountedOn: 'flange',
  translation: { ...mount.translation }, rotation: { ...mount.rotation }, ...extra,
})

test('the default mount IS the default tool length, in scene mm (one number, two units)', () => {
  assert.deepEqual(DEFAULT_TOOL_MOUNT.translation, { x: 0, y: 0, z: 150 })
  assert.deepEqual(DEFAULT_TOOL_MOUNT.rotation, { x: 0, y: 0, z: 0, w: 1 })
  assert.equal(axialToolLengthM(DEFAULT_TOOL_MOUNT), TOOL_LENGTH_M)
})

test('the tool length follows the declared mount, not the default (ADR-151 D1)', () => {
  const mount = { translation: { x: 0, y: 0, z: 212.5 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }
  assert.equal(axialToolLengthM(mount), 0.2125)
  // q and −q are the same rotation — a sign flip is not a rotated tool.
  assert.equal(axialToolLengthM({ ...mount, rotation: { x: 0, y: 0, z: 0, w: -1 } }), 0.2125)
})

test('an offset or rotated mount has NO axial length — it is refused, never projected (stage 1)', () => {
  const offset  = { translation: { x: 30, y: 0, z: 150 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }
  const rotated = { translation: { x: 0, y: 0, z: 150 }, rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } }
  const onFace  = { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }
  for (const m of [offset, rotated, onFace, null]) assert.equal(axialToolLengthM(m), null)
})

test('toolMountGap names each of its gaps — 0 tcp, a non-axial tcp, and none (ADR-151 D7)', () => {
  assert.equal(toolMountGap({ tcpFrame: null }), TOOL_MOUNT_UNDECLARED_REASON)
  // A pre-ADR-151 tcp (no mount declared) is NOT a mount: its value was a
  // base-relative rest pose. It must not be read as one (原則 #31).
  const legacy = { robotRole: 'tcp', translation: { x: -716, y: -133, z: 345 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }
  assert.equal(toolMountGap({ tcpFrame: legacy }), TOOL_MOUNT_UNDECLARED_REASON)
  const bent = tcpWith({ translation: { x: 0, y: 20, z: 150 }, rotation: DEFAULT_TOOL_MOUNT.rotation })
  assert.equal(toolMountGap({ tcpFrame: bent }), TOOL_MOUNT_NOT_AXIAL_REASON)
  assert.equal(toolMountGap({ tcpFrame: tcpWith(DEFAULT_TOOL_MOUNT) }), null)
})

test('toolMountOf is a snapshot — the caller cannot write the tcp through it', () => {
  const tcp = tcpWith(DEFAULT_TOOL_MOUNT)
  const mount = toolMountOf({ tcpFrame: tcp })
  mount.translation.z = 999
  assert.equal(tcp.translation.z, 150)
})

test('the TCP marker stands exactly where the drawn fingertips end (ADR-151 D2)', () => {
  // The claim the dogfooder's screenshot broke: the TCP label and the tool tip
  // were different points. Both are now read off ONE mount, so this asks that
  // the two readers agree, in the flange frame the arm draws them in.
  const pose = tcpMarkerPose(DEFAULT_TOOL_MOUNT)
  const tips = toolParts(axialToolLengthM(DEFAULT_TOOL_MOUNT))
    .filter(p => p.part === 'finger').map(p => p.center[2] + p.size[2] / 2)
  for (const tip of tips) assert.ok(Math.abs(tip - pose.position[2]) < 1e-12)
  assert.deepEqual(pose.position.slice(0, 2), [0, 0])
  // World-sized (decision b): a fraction of the reach, so it scales with the tool.
  assert.ok(Math.abs(pose.axisLength - 0.4 * TOOL_LENGTH_M) < 1e-12)
  assert.equal(tcpMarkerPose(null), null)
})

test('the marker carries the mount rotation — a rotated TCP is drawn rotated, not snapped to the flange', () => {
  const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
  const pose = tcpMarkerPose({ translation: { x: 10, y: 20, z: 100 }, rotation: q })
  assert.deepEqual(pose.quaternion, q)
  assert.deepEqual(pose.position, [0.01, 0.02, 0.1])
})

test('only a flange-mounted tcp is edit-locked, and the lock always carries its reason', () => {
  assert.equal(toolMountEditBlockedReason(tcpWith(DEFAULT_TOOL_MOUNT)), TOOL_MOUNT_EDIT_DEFERRED_REASON)
  assert.equal(toolMountEditBlockedReason({ robotRole: 'base' }), null)
  assert.equal(toolMountEditBlockedReason({ name: 'user_frame' }), null)
  assert.equal(toolMountEditBlockedReason(null), null)
})
