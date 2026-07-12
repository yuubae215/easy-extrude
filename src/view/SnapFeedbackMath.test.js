import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  geometrySnapshot, stackSnapshot, snapTransition,
  snapFlashDescriptor, snapFlashFrame,
} from './SnapFeedbackMath.js'
import { COLOR, DURATION, hexNumber } from '../theme/tokens.js'

const TARGET   = { label: 'Vertex', type: 'vertex', position: { x: 1, y: 2, z: 3 } }
const TARGET_B = { label: 'Edge midpoint', type: 'edge', position: { x: 4, y: 5, z: 6 } }

// ── Snapshots ────────────────────────────────────────────────────────────────

test('geometrySnapshot: locked state yields a keyed snapshot at the target', () => {
  const snap = geometrySnapshot(true, TARGET)
  assert.ok(snap)
  assert.equal(typeof snap.key, 'string')
  assert.deepEqual([snap.x, snap.y, snap.z], [1, 2, 3])
})

test('geometrySnapshot: not snapping / malformed target → null (honest silence)', () => {
  assert.equal(geometrySnapshot(false, TARGET), null)
  assert.equal(geometrySnapshot(true, null), null)
  assert.equal(geometrySnapshot(true, { label: 'x' }), null)
  assert.equal(geometrySnapshot(true, { position: { x: NaN, y: 0, z: 0 } }), null)
})

test('geometrySnapshot: distinct targets get distinct keys; same target same key', () => {
  const a1 = geometrySnapshot(true, TARGET)
  const a2 = geometrySnapshot(true, TARGET)
  const b  = geometrySnapshot(true, TARGET_B)
  assert.equal(a1.key, a2.key)
  assert.notEqual(a1.key, b.key)
})

test('stackSnapshot: key quantizes only the landing Z — sliding on one surface holds', () => {
  const a = stackSnapshot(true, { x: 0, y: 0, z: 2.0004 })
  const b = stackSnapshot(true, { x: 9, y: 9, z: 2.0004 }) // slid along the surface
  const c = stackSnapshot(true, { x: 0, y: 0, z: 5 })      // different surface height
  assert.equal(a.key, b.key)
  assert.notEqual(a.key, c.key)
  assert.equal(stackSnapshot(false, { x: 0, y: 0, z: 2 }), null)
  assert.equal(stackSnapshot(true, null), null)
  assert.equal(stackSnapshot(true, { x: 0, y: 0, z: Infinity }), null)
})

// ── Transitions (volume design: transitions only) ───────────────────────────

test('snapTransition: free→locked = engage; target change = retarget', () => {
  const a = geometrySnapshot(true, TARGET)
  const b = geometrySnapshot(true, TARGET_B)
  assert.equal(snapTransition(null, a), 'engage')
  assert.equal(snapTransition(a, b), 'retarget')
})

test('snapTransition: holding the same lock and disengaging are SILENT', () => {
  const a = geometrySnapshot(true, TARGET)
  assert.equal(snapTransition(a, { ...a }), null) // per-frame hold never refires
  assert.equal(snapTransition(a, null), null)     // release: the entity is its own feedback
  assert.equal(snapTransition(null, null), null)
})

test('snapTransition: malformed snapshots → null, never a guessed flash', () => {
  assert.equal(snapTransition(null, { key: 42 }), null)
  assert.equal(snapTransition({ key: 42 }, geometrySnapshot(true, TARGET)), 'engage')
})

// ── Descriptor ───────────────────────────────────────────────────────────────

test('descriptor: geometry lock = snap orange, stack landing = settled green', () => {
  const snap = geometrySnapshot(true, TARGET)
  const g = snapFlashDescriptor('geometry', 'engage', snap, 2)
  const s = snapFlashDescriptor('stack', 'engage', stackSnapshot(true, { x: 0, y: 0, z: 1 }), 2)
  assert.equal(g.color, hexNumber(COLOR.fxSnap))
  assert.equal(s.color, hexNumber(COLOR.fxGreen))
  assert.deepEqual([g.x, g.y, g.z], [1, 2, 3])
})

test('descriptor: retarget is the quieter, shorter sibling of engage', () => {
  const snap = geometrySnapshot(true, TARGET)
  const engage   = snapFlashDescriptor('geometry', 'engage', snap, 2)
  const retarget = snapFlashDescriptor('geometry', 'retarget', snap, 2)
  assert.ok(retarget.duration < engage.duration)
  assert.ok(retarget.intensity < engage.intensity)
})

test('descriptor: duration stays in the micro-transition band (≤ 300 ms)', () => {
  // High-frequency event → short cue (motion time-scale discipline); the
  // token is the machine-pinned bound so the band cannot silently creep.
  assert.ok(DURATION.snapFlash <= 300, 'snapFlash must stay ≤ 300ms')
  const snap = geometrySnapshot(true, TARGET)
  const d = snapFlashDescriptor('geometry', 'engage', snap, 2)
  assert.ok(d.duration <= 0.3)
})

test('descriptor: radius is entity-proportional (#27); missing radius → null', () => {
  const snap = geometrySnapshot(true, TARGET)
  const small = snapFlashDescriptor('geometry', 'engage', snap, 0.05)
  const large = snapFlashDescriptor('geometry', 'engage', snap, 10)
  assert.ok(large.radius > small.radius)
  assert.equal(snapFlashDescriptor('geometry', 'engage', snap, undefined), null)
  assert.equal(snapFlashDescriptor('geometry', 'engage', snap, 0), null)
  assert.equal(snapFlashDescriptor('geometry', 'engage', snap, NaN), null)
})

test('descriptor: malformed transition / channel / snapshot → null', () => {
  const snap = geometrySnapshot(true, TARGET)
  assert.equal(snapFlashDescriptor('geometry', null, snap, 2), null)
  assert.equal(snapFlashDescriptor('geometry', 'hold', snap, 2), null)
  assert.equal(snapFlashDescriptor('nonsense', 'engage', snap, 2), null)
  assert.equal(snapFlashDescriptor('geometry', 'engage', null, 2), null)
  assert.equal(snapFlashDescriptor('geometry', 'engage', { x: NaN, y: 0, z: 0 }, 2), null)
})

// ── Frame curve ──────────────────────────────────────────────────────────────

test('frame: ring pops with overshoot then settles to 1 (never a linear fade)', () => {
  assert.ok(snapFlashFrame(0).ringScale < 0.3)
  // easeOutBack overshoots past the rest scale mid-way…
  const peak = Math.max(...[0.4, 0.5, 0.6, 0.7].map(p => snapFlashFrame(p).ringScale))
  assert.ok(peak > 1, 'ring must overshoot its rest scale (settle beat)')
  // …and lands exactly at rest.
  assert.ok(Math.abs(snapFlashFrame(1).ringScale - 1) < 1e-9)
})

test('frame: echo is staggered — silent until ~22%, then follows', () => {
  assert.equal(snapFlashFrame(0.1).echoOpacity, 0)
  assert.ok(snapFlashFrame(0.5).echoOpacity > 0)
})

test('frame: spark contracts onto the lock point on its own faster timeline', () => {
  const early = snapFlashFrame(0.05)
  const mid   = snapFlashFrame(0.4)
  assert.ok(mid.sparkScale < early.sparkScale)
  assert.ok(snapFlashFrame(0.45).sparkOpacity <= 0.01) // gone before the ring finishes
  assert.ok(snapFlashFrame(0.45).ringOpacity > 0)
})

test('frame: opacity ends at zero; intensity scales the whole cue', () => {
  const end = snapFlashFrame(1)
  assert.ok(end.ringOpacity < 1e-9 && end.echoOpacity < 1e-9 && end.sparkOpacity < 1e-9)
  const full  = snapFlashFrame(0.1, false, 1)
  const quiet = snapFlashFrame(0.1, false, 0.55)
  assert.ok(quiet.ringOpacity < full.ringOpacity)
})

test('frame: reduced motion = static held ring, information preserved (#30/#11)', () => {
  for (const p of [0, 0.5, 1]) {
    const f = snapFlashFrame(p, true, 1)
    assert.deepEqual(f, snapFlashFrame(0, true, 1)) // no movement across progress
    assert.ok(f.ringOpacity > 0, 'the cue must not silently disappear')
    assert.equal(f.sparkOpacity, 0)
  }
})

test('frame: malformed progress/intensity never produces NaN styles', () => {
  for (const f of [snapFlashFrame(NaN), snapFlashFrame(0.5, false, NaN)]) {
    for (const v of Object.values(f)) assert.ok(Number.isFinite(v))
  }
})
