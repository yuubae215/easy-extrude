import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lifecycleDescriptor, boundsOf, voxelFrame, voxelJitter, glitchGate,
} from './CommandFeedbackMath.js'
import { COLOR, DURATION, hexNumber } from '../theme/tokens.js'

test('entity-lifecycle labels map to materialize (appear) / dissolve (vanish)', () => {
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Add "Box.001"' }).kind, 'materialize')
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Add "Sketch"' }).kind, 'materialize')
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Add Frame "TCP"' }).kind, 'materialize')
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Extrude' }).kind, 'materialize')
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Delete "Box"' }).kind, 'dissolve')
})

test('undo inverts the transition; redo re-applies it', () => {
  // undoing an Add removes the entity → dissolve at the removed anchor
  assert.equal(lifecycleDescriptor({ phase: 'undo', label: 'Add "Box"' }).kind, 'dissolve')
  assert.equal(lifecycleDescriptor({ phase: 'undo', label: 'Extrude' }).kind, 'dissolve')
  // undoing a Delete restores the entity → materialize at the added anchor
  assert.equal(lifecycleDescriptor({ phase: 'undo', label: 'Delete "Box"' }).kind, 'materialize')
  // redo re-applies the push transition
  assert.equal(lifecycleDescriptor({ phase: 'redo', label: 'Add "Box"' }).kind, 'materialize')
  assert.equal(lifecycleDescriptor({ phase: 'redo', label: 'Delete "Box"' }).kind, 'dissolve')
})

test('descriptor names the domain-event anchor direction it renders at', () => {
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Add "Box"' }).direction, 'added')
  assert.equal(lifecycleDescriptor({ phase: 'undo', label: 'Add "Box"' }).direction, 'removed')
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Delete "Box"' }).direction, 'removed')
  assert.equal(lifecycleDescriptor({ phase: 'undo', label: 'Delete "Box"' }).direction, 'added')
})

test('materialize is green; dissolve is the SAO-blue accent; durations from tokens', () => {
  const mat = lifecycleDescriptor({ phase: 'push', label: 'Add "Box"' })
  assert.equal(mat.color, hexNumber(COLOR.fxGreen))
  assert.ok(Math.abs(mat.duration - DURATION.voxelMaterialize / 1000) < 1e-12)
  const dis = lifecycleDescriptor({ phase: 'push', label: 'Delete "Box"' })
  assert.equal(dis.color, hexNumber(COLOR.accentActive))
  assert.ok(Math.abs(dis.duration - DURATION.voxelDissolve / 1000) < 1e-12)
})

test('VOLUME DESIGN: routine pose/geometry ops are SILENT in every phase (#30)', () => {
  // The result of these operations is already visible at the anchor — a
  // per-operation pulse carries zero information = decoration = rejected.
  for (const label of ['Move', 'Move 3 objects', 'Rotate Solid', 'Rotate Frame', 'Face Extrude']) {
    for (const phase of ['push', 'undo', 'redo']) {
      assert.equal(lifecycleDescriptor({ phase, label }), null, `${phase} ${label}`)
    }
  }
})

test('unrecognised labels and malformed input degrade to null (#11: silence, not guess)', () => {
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Approve decision d1' }), null)
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Rename "a" → "b"' }), null)
  assert.equal(lifecycleDescriptor({ phase: 'push', label: 'Delete link "fixed·fastened" (a → b)' }), null)
  assert.equal(lifecycleDescriptor({ phase: 'bogus', label: 'Add "Box"' }), null)
  assert.equal(lifecycleDescriptor({ phase: 'push' }), null)
  assert.equal(lifecycleDescriptor(null), null)
  assert.equal(lifecycleDescriptor(undefined), null)
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

test('voxelFrame dissolve: fragments fly OUT, shrink, and fade to zero', () => {
  const f0 = voxelFrame('dissolve', 0)
  const fMid = voxelFrame('dissolve', 0.5)
  const f1 = voxelFrame('dissolve', 1)
  assert.ok(Math.abs(f0.dist - 0.15) < 1e-9 && Math.abs(f0.scale - 1) < 1e-9)
  assert.ok(fMid.dist > f0.dist && f1.dist > fMid.dist)
  assert.ok(Math.abs(f1.dist - 1) < 1e-9)
  assert.ok(f1.opacity < 1e-9)
  assert.ok(fMid.scale < f0.scale && f1.scale < fMid.scale)
  assert.ok(f1.spin > 0)
})

test('voxelFrame materialize: the reverse — shell converges IN, then evaporates', () => {
  const f0 = voxelFrame('materialize', 0)
  const fMid = voxelFrame('materialize', 0.5)
  const f1 = voxelFrame('materialize', 1)
  assert.ok(Math.abs(f0.dist - 1) < 1e-9)
  assert.ok(fMid.dist < f0.dist && f1.dist < fMid.dist)
  assert.ok(Math.abs(f1.dist - 0.1) < 1e-9)
  assert.ok(f0.opacity < 1e-9)                    // fades in from nothing…
  assert.ok(fMid.opacity > 0.8)                   // …fully present mid-flight…
  assert.ok(f1.opacity < 1e-9)                    // …evaporates at the end
})

test('voxelFrame under reduced motion is a static held cue at every progress (#30)', () => {
  for (const kind of ['dissolve', 'materialize']) {
    const held = voxelFrame(kind, 0, true)
    for (const p of [0, 0.3, 0.99]) {
      assert.deepEqual(voxelFrame(kind, p, true), held)
    }
    assert.equal(held.spin, 0)
    assert.ok(held.opacity > 0)                   // information preserved, never nothing
  }
})

test('voxelJitter is deterministic and within [0.55, 1)', () => {
  for (let i = 0; i < 64; i++) {
    const j = voxelJitter(i)
    assert.ok(j >= 0.55 && j < 1)
    assert.equal(j, voxelJitter(i))               // replay-identical
  }
})

test('glitchGate is a deterministic two-level gate', () => {
  const seen = new Set()
  for (let i = 0; i < 24; i++) {
    for (const p of [0, 0.25, 0.5, 0.75]) {
      const g = glitchGate(i, p)
      assert.ok(g === 1 || g === 0.25)
      assert.equal(g, glitchGate(i, p))
      seen.add(g)
    }
  }
  assert.deepEqual([...seen].sort(), [0.25, 1])   // both levels actually occur
})
