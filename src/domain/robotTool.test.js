/**
 * robotTool — the tool bolted to the flange (ADR-150 D4/D5).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { TOOL_LENGTH_M, toolParts } from './robotTool.js'
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
