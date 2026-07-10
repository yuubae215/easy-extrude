import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landingDescriptor, boundsOf, pulseFrame } from './CommandFeedbackMath.js'
import { COLOR, hexNumber } from '../theme/tokens.js'

test('recognised core-modeling labels map to spawn/settle descriptors', () => {
  assert.equal(landingDescriptor({ phase: 'push', label: 'Add "Box.001"' }).kind, 'spawn')
  assert.equal(landingDescriptor({ phase: 'push', label: 'Add Frame "TCP"' }).kind, 'spawn')
  assert.equal(landingDescriptor({ phase: 'push', label: 'Extrude' }).kind, 'spawn')
  assert.equal(landingDescriptor({ phase: 'push', label: 'Face Extrude' }).kind, 'spawn')
  assert.equal(landingDescriptor({ phase: 'push', label: 'Move' }).kind, 'settle')
  assert.equal(landingDescriptor({ phase: 'push', label: 'Move 3 objects' }).kind, 'settle')
  assert.equal(landingDescriptor({ phase: 'push', label: 'Rotate Solid' }).kind, 'settle')
  assert.equal(landingDescriptor({ phase: 'push', label: 'Rotate Frame' }).kind, 'settle')
})

test('spawn pops (green, overshoot); settle is calm blue', () => {
  const spawn = landingDescriptor({ phase: 'push', label: 'Add "Box"' })
  assert.deepEqual(
    { color: spawn.color, overshoot: spawn.overshoot, expand: spawn.expand },
    { color: hexNumber(COLOR.fxGreen), overshoot: true, expand: 1 })
  const settle = landingDescriptor({ phase: 'push', label: 'Move' })
  assert.deepEqual(
    { color: settle.color, overshoot: settle.overshoot },
    { color: hexNumber(COLOR.fxBlue), overshoot: false })
})

test('undo renders a CONTRACTING amber rewind; redo a blue replay', () => {
  const rewind = landingDescriptor({ phase: 'undo', label: 'Move' })
  assert.deepEqual(
    { kind: rewind.kind, expand: rewind.expand, color: rewind.color },
    { kind: 'rewind', expand: -1, color: hexNumber(COLOR.fxAmber) })
  const replay = landingDescriptor({ phase: 'redo', label: 'Add "Box"' })
  assert.deepEqual({ kind: replay.kind, expand: replay.expand }, { kind: 'replay', expand: 1 })
})

test('undoing a command that REMOVES its entity yields no descriptor (no honest anchor)', () => {
  assert.equal(landingDescriptor({ phase: 'undo', label: 'Add "Box"' }), null)
  assert.equal(landingDescriptor({ phase: 'undo', label: 'Add Frame "TCP"' }), null)
  // …but undoing Face Extrude keeps its entity → rewind is honest
  assert.equal(landingDescriptor({ phase: 'undo', label: 'Face Extrude' }).kind, 'rewind')
})

test('unrecognised labels and malformed input degrade to null (#11: silence, not guess)', () => {
  assert.equal(landingDescriptor({ phase: 'push', label: 'Approve decision d1' }), null)
  assert.equal(landingDescriptor({ phase: 'push', label: 'Delete "Box"' }), null)
  assert.equal(landingDescriptor({ phase: 'push', label: 'Rename "a" → "b"' }), null)
  assert.equal(landingDescriptor({ phase: 'bogus', label: 'Move' }), null)
  assert.equal(landingDescriptor({ phase: 'push' }), null)
  assert.equal(landingDescriptor(null), null)
  assert.equal(landingDescriptor(undefined), null)
})

test('boundsOf computes min/max midpoint centre and half-diagonal radius', () => {
  const b = boundsOf([
    { x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, { x: 1, y: 1, z: 1 },
  ])
  assert.deepEqual(b.center, { x: 1, y: 2, z: 3 })
  assert.ok(Math.abs(b.radius - Math.sqrt(4 + 16 + 36) / 2) < 1e-12)
})

test('boundsOf degrades malformed input to null', () => {
  assert.equal(boundsOf(null), null)
  assert.equal(boundsOf([]), null)
  assert.equal(boundsOf([{ x: 0, y: 0 }]), null)
  assert.equal(boundsOf([{ x: 0, y: NaN, z: 0 }]), null)
  assert.equal(boundsOf('corners'), null)
})

test('pulseFrame: expanding pulse grows and fades; endpoints honest', () => {
  const desc = { expand: 1, overshoot: false }
  const f0 = pulseFrame(desc, 0)
  const fMid = pulseFrame(desc, 0.5)
  const f1 = pulseFrame(desc, 1)
  assert.ok(Math.abs(f0.scale - 0.4) < 1e-9 && Math.abs(f0.opacity - 0.85) < 1e-9)
  assert.ok(fMid.scale > f0.scale && fMid.scale < 1.6)
  assert.ok(Math.abs(f1.scale - 1.6) < 1e-9 && f1.opacity === 0)
})

test('pulseFrame: rewind (expand −1) CONTRACTS from 1.6 to 0.4', () => {
  const desc = { expand: -1, overshoot: false }
  assert.ok(Math.abs(pulseFrame(desc, 0).scale - 1.6) < 1e-9)
  assert.ok(Math.abs(pulseFrame(desc, 1).scale - 0.4) < 1e-9)
})

test('pulseFrame under reduced motion is a static held cue at every progress', () => {
  const desc = { expand: 1, overshoot: true }
  for (const p of [0, 0.3, 0.99]) {
    assert.deepEqual(pulseFrame(desc, p, true), { scale: 1, opacity: 0.35 })
  }
})
