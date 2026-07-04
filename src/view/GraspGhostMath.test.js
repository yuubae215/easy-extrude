/**
 * GraspGhostMath.test.js — ADR-059 stage-1 ghost pure derivations.
 *
 * Run via `pnpm test:context` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  renderableEndEffectorFrame,
  quatRotate,
  approachVector,
  scoreColor,
  ghostLineStyle,
  nearestTargetIndex,
} from './GraspGhostMath.js'

// ── renderableEndEffectorFrame: the capability gate (ADR-059 §A-1) ─────────────

test('gate passes a well-formed endEffector pose and returns its frame', () => {
  const frame = { position: [1, 2, 3], orientation: [0, 0, 0, 1] }
  assert.deepEqual(
    renderableEndEffectorFrame({ kind: 'endEffector', frame }),
    { position: [1, 2, 3], orientation: [0, 0, 0, 1] },
  )
})

test('gate rejects jointSpace, opaque, and absent poses (no heuristic interpretation)', () => {
  assert.equal(renderableEndEffectorFrame({ kind: 'jointSpace', chainRef: 'arm', joints: [0, 0, 0] }), null)
  assert.equal(renderableEndEffectorFrame({ joints: [0, 0, 0] }), null)   // pre-union opaque shape
  assert.equal(renderableEndEffectorFrame(undefined), null)
  assert.equal(renderableEndEffectorFrame(null), null)
})

test('gate rejects malformed frames (wrong lengths, non-numbers, NaN)', () => {
  const bad = (frame) => renderableEndEffectorFrame({ kind: 'endEffector', frame })
  assert.equal(bad(undefined), null)
  assert.equal(bad({ position: [1, 2], orientation: [0, 0, 0, 1] }), null)
  assert.equal(bad({ position: [1, 2, 3], orientation: [0, 0, 1] }), null)
  assert.equal(bad({ position: [1, 2, '3'], orientation: [0, 0, 0, 1] }), null)
  assert.equal(bad({ position: [1, 2, NaN], orientation: [0, 0, 0, 1] }), null)
})

// ── quatRotate / approachVector: the −Z convention (ADR-059 §A-3) ──────────────

const close = (a, b, eps = 1e-12) =>
  a.every((v, i) => Math.abs(v - b[i]) < eps)

test('identity quaternion leaves the vector unchanged', () => {
  assert.ok(close(quatRotate([0, 0, 0, 1], [1, 2, 3]), [1, 2, 3]))
})

test('approach vector of the identity frame is −Z (the documented TCP convention)', () => {
  assert.ok(close(approachVector([0, 0, 0, 1]), [0, 0, -1]))
})

test('approach vector follows the frame: 180° about X maps −Z to +Z', () => {
  // q = [sin(90°), 0, 0, cos(90°)] = [1, 0, 0, 0]
  assert.ok(close(approachVector([1, 0, 0, 0]), [0, 0, 1]))
})

test('approach vector follows the frame: 90° about Y maps −Z to −X', () => {
  const s = Math.SQRT1_2
  assert.ok(close(approachVector([0, s, 0, s]), [-1, 0, 0], 1e-9))
})

// ── scoreColor / ghostLineStyle: score → play (ADR-059 §B-2) ───────────────────

test('scoreColor endpoints are amber (0) and teal (1), and clamp out-of-range', () => {
  assert.equal(scoreColor(0), 0xe0a030)
  assert.equal(scoreColor(1), 0x18c0a8)
  assert.equal(scoreColor(-5), scoreColor(0))
  assert.equal(scoreColor(7), scoreColor(1))
  assert.equal(scoreColor(NaN), scoreColor(0))
})

test('scoreColor is monotone in each channel direction (no hue wrap surprises)', () => {
  const r = (c) => (c >> 16) & 0xff
  const g = (c) => (c >> 8) & 0xff
  const b = (c) => c & 0xff
  const lo = scoreColor(0.2), hi = scoreColor(0.8)
  assert.ok(r(hi) < r(lo))
  assert.ok(g(hi) > g(lo))
  assert.ok(b(hi) > b(lo))
})

test('ghostLineStyle: all three verdicts true → solid, any false/missing → dashed', () => {
  assert.equal(ghostLineStyle({ withinReach: true, ikSolvable: true, interferenceFree: true }), 'solid')
  assert.equal(ghostLineStyle({ withinReach: true, ikSolvable: false, interferenceFree: true }), 'dashed')
  assert.equal(ghostLineStyle({ withinReach: true, ikSolvable: true }), 'dashed')
  assert.equal(ghostLineStyle(undefined), 'dashed')
})

// ── nearestTargetIndex: display-only proximity pick ─────────────────────────────

test('nearestTargetIndex picks the closest centre and honours maxDist', () => {
  const centers = [[10, 0, 0], [1, 1, 0], [0, 0, 5]]
  assert.equal(nearestTargetIndex([0, 0, 0], centers), 1)
  assert.equal(nearestTargetIndex([0, 0, 0], centers, 1), null)   // closest is √2 away
  assert.equal(nearestTargetIndex([0, 0, 0], []), null)
})
