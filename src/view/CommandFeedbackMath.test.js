import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lifecycleDescriptor, boundsOf,
  voxelDelay, localProgress, STAGGER_SPREAD,
} from './CommandFeedbackMath.js'
import { STAGE_LIGHT } from './StageMath.js'
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
  assert.equal(mat.color, hexNumber(COLOR.factTone))
  assert.ok(Math.abs(mat.duration - DURATION.voxelMaterialize / 1000) < 1e-12)
  const dis = lifecycleDescriptor({ phase: 'push', label: 'Delete "Box"' })
  assert.equal(dis.color, hexNumber(COLOR.infoTone))
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

test('voxelDelay is deterministic, within [0, SPREAD), and scatters neighbours apart', () => {
  let adjacentTogether = 0
  for (let i = 0; i < 64; i++) {
    const d = voxelDelay(i)
    assert.ok(d >= 0 && d < STAGGER_SPREAD)
    assert.equal(d, voxelDelay(i))                       // replay-identical
    if (Math.abs(voxelDelay(i) - voxelDelay(i + 1)) < 0.02) adjacentTogether++
  }
  // golden-ratio scatter: adjacent indices should almost never share a delay
  assert.ok(adjacentTogether <= 2, `neighbours detach together too often (${adjacentTogether})`)
})

test('localProgress: every voxel spans [delay, delay+(1−SPREAD)] and lands by global 1', () => {
  // delay 0 completes early (at global 1−SPREAD) then holds at 1
  assert.equal(localProgress(0, 0), 0)
  assert.ok(Math.abs(localProgress(1 - STAGGER_SPREAD, 0) - 1) < 1e-9)
  assert.equal(localProgress(1, 0), 1)                   // held at the end
  // the latest voxel (delay = SPREAD) only just finishes at global 1
  assert.equal(localProgress(STAGGER_SPREAD, STAGGER_SPREAD), 0)
  assert.ok(Math.abs(localProgress(1, STAGGER_SPREAD) - 1) < 1e-9)
  // malformed delay degrades to 0 offset (no crash, no NaN)
  assert.equal(localProgress(0.5, NaN), localProgress(0.5, 0))
  assert.equal(localProgress(NaN, 0), 0)
})

test('the boundary flash lights toward the ONE stage light, not a private white (M4d3)', () => {
  for (const label of ['Add "Box"', 'Delete "Box"']) {
    const d = lifecycleDescriptor({ phase: 'push', label })
    assert.equal(d.flash, hexNumber(STAGE_LIGHT.color), label)
    assert.notEqual(d.flash, 0xffffff)
    assert.notEqual(d.flash, d.color, 'the state tone (the fact) stays its own colour')
  }
})

