/**
 * RobotRevealMath — the waiting light and the arm's arrival (ADR-166 M4d3b).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REVEAL_SECONDS, BEACON, BASE_DIAMETER, BEACON_CUE, ARM_REVEAL_CUE, beaconFrame, armReveal,
} from './RobotRevealMath.js'
import { CUE_REST, settledCue, retargetCue } from './CueFollowMath.js'
import { IDLE_PERIOD } from './IdleMotionMath.js'
import { STAGE_LIGHT } from './StageMath.js'
import { phaseFor } from './MapVisualMath.js'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

test('the waiting light is the ONE stage light, not a colour of its own', () => {
  assert.equal(BEACON.color, STAGE_LIGHT.color)
})

test('the light marks the spot — twice the pedestal across', () => {
  assert.equal(2 * BEACON.radius, 2 * BASE_DIAMETER)  // diameter = 2 × the pedestal's
})

test('the arrival is inside the response band (≤ 300 ms)', () => {
  assert.ok(REVEAL_SECONDS > 0 && REVEAL_SECONDS <= 0.3)
})

test('waiting, the light breathes on the `unresolved` period (4 s) between lo and hi', () => {
  const seg = settledCue(1)
  const P = IDLE_PERIOD.unresolved
  const a = beaconFrame(0.7, 'robot-1', seg).opacity
  assert.ok(close(beaconFrame(0.7 + P, 'robot-1', seg).opacity, a, 1e-9), 'one period later = the same frame')
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < 400; i++) {
    const o = beaconFrame((i / 400) * P, 'robot-1', seg).opacity
    lo = Math.min(lo, o); hi = Math.max(hi, o)
  }
  assert.ok(close(lo, BEACON.lo, 1e-3) && close(hi, BEACON.hi, 1e-3), `range ${lo}..${hi}`)
})

test('N arms waiting at once do not breathe together — phase from the robot id (ADR-093 D1)', () => {
  const seg = settledCue(1)
  assert.notEqual(phaseFor('robot-1'), phaseFor('robot-2'))
  assert.notEqual(beaconFrame(1.0, 'robot-1', seg).opacity, beaconFrame(1.0, 'robot-2', seg).opacity)
})

test('the same clock twice draws the same frame (clock, not frames)', () => {
  const seg = settledCue(1)
  assert.deepEqual(beaconFrame(2.5, 'r', seg), beaconFrame(2.5, 'r', seg))
})

test('reduced motion: the light is still, at the middle of its range', () => {
  const seg = settledCue(1)
  for (const t of [0, 1, 2.3, 3.9]) {
    assert.equal(beaconFrame(t, 'r', seg, true).opacity, (BEACON.lo + BEACON.hi) / 2)
  }
})

test('landing: the light holds, then leaves on `exit` (inCubic), shrinking to exitScale', () => {
  const t0 = 10
  const seg = retargetCue(t0, settledCue(1), 0, BEACON_CUE)
  const mid = beaconFrame(t0 + REVEAL_SECONDS / 2, 'r', seg)
  // inCubic read as a leaving presence: 1 − (½)³ = 0.875 — a linear exit would be 0.5.
  assert.ok(close(mid.present, 0.875), `present at mid-exit = ${mid.present}`)
  const gone = beaconFrame(t0 + REVEAL_SECONDS, 'r', seg)
  assert.equal(gone.present, 0)
  assert.equal(gone.opacity, 0)
  assert.equal(gone.scale, BEACON.exitScale)
  assert.equal(beaconFrame(t0, 'r', seg, true).present, 0, 'reduced: gone at once')
})

test('the arm arrives on `fade` (outQuad) over REVEAL_SECONDS', () => {
  const t0 = 4
  const seg = retargetCue(t0, CUE_REST, 1, ARM_REVEAL_CUE)
  // outQuad at the midpoint is 0.75 — a linear arrival would be 0.5.
  assert.ok(close(armReveal(t0 + REVEAL_SECONDS / 2, seg), 0.75))
  assert.equal(armReveal(t0 + REVEAL_SECONDS, seg), 1)
  assert.equal(armReveal(t0, seg), 0)
  assert.equal(armReveal(t0, seg, true), 1, 'reduced: at once')
})

test('an arm drawn from birth has nothing to arrive from', () => {
  assert.equal(armReveal(0, settledCue(1)), 1)
})
