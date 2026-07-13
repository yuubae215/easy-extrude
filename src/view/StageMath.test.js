import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGE, hash01, dustField, dustDrift, entryEnvelope, fogDensityFor, flightFrame,
} from './StageMath.js'

// ── determinism (replay-identical stage, no Math.random) ────────────────────

test('dustField is deterministic and stays inside its layer bounds', () => {
  const layer = STAGE.dust[0]
  const a = dustField(layer)
  const b = dustField(layer)
  assert.deepEqual(a, b, 'two builds of the same layer must be identical')
  assert.equal(a.length, layer.count)
  for (const p of a) {
    assert.ok(Math.hypot(p.x, p.y) <= layer.radius + 1e-9, 'inside the disc radius')
    assert.ok(p.z > 0, 'dust floats above the ground plane')
    assert.ok(p.z <= 0.15 + layer.height + 1e-9)
    assert.ok(Number.isFinite(p.phase) && Number.isFinite(p.rate) && Number.isFinite(p.amp))
  }
})

test('dustField particles do not move in lockstep (distinct phases/rates)', () => {
  const pts = dustField(STAGE.dust[1])
  const phases = new Set(pts.map(p => p.phase.toFixed(6)))
  const rates  = new Set(pts.map(p => p.rate.toFixed(6)))
  assert.ok(phases.size > pts.length * 0.9, 'phases must be (near-)unique per particle')
  assert.ok(rates.size > pts.length * 0.9, 'rates must be (near-)unique per particle')
})

test('hash01 is deterministic and in [0,1)', () => {
  for (let i = 0; i < 200; i++) {
    const v = hash01(i, 2)
    assert.equal(v, hash01(i, 2))
    assert.ok(v >= 0 && v < 1)
  }
  assert.notEqual(hash01(7, 0), hash01(7, 1), 'salt yields a different sequence')
})

// ── drift ────────────────────────────────────────────────────────────────────

test('dustDrift is bounded and deterministic; NaN time degrades to zero offset', () => {
  const p = { phase: 1.2, rate: 0.9, amp: 0.6 }
  for (const t of [0, 1.5, 100.25, 9999]) {
    const d = dustDrift(t, p)
    assert.deepEqual(d, dustDrift(t, p))
    assert.ok(Math.abs(d.dx) <= p.amp * 0.5 * 1.5 + 1e-9)
    assert.ok(Math.abs(d.dy) <= p.amp * 0.5 * 1.5 + 1e-9)
    assert.ok(Math.abs(d.dz) <= p.amp * 1.4 + 1e-9)
  }
  assert.deepEqual(dustDrift(NaN, p), { dx: 0, dy: 0, dz: 0 })
})

test('dustDrift actually moves (a frozen ambient layer would be a silent regression)', () => {
  const p = { phase: 0.4, rate: 1, amp: 0.5 }
  const a = dustDrift(0, p)
  const b = dustDrift(3, p)
  assert.ok(Math.abs(a.dz - b.dz) > 1e-3, 'vertical bob must vary over seconds')
})

// ── entry envelope ───────────────────────────────────────────────────────────

test('entryEnvelope: 0 before the window, exactly 1 after entrySeconds, monotone', () => {
  const delay = STAGE.dust[1].entryDelay
  assert.equal(entryEnvelope(0, delay), 0)
  assert.equal(entryEnvelope(delay, delay), 0)
  assert.equal(entryEnvelope(delay + STAGE.entrySeconds, delay), 1)
  assert.equal(entryEnvelope(delay + STAGE.entrySeconds + 60, delay), 1)
  let prev = -1
  for (let t = 0; t <= STAGE.entrySeconds + delay + 0.5; t += 0.05) {
    const v = entryEnvelope(t, delay)
    assert.ok(v >= prev - 1e-12, 'monotone fade-in')
    assert.ok(v >= 0 && v <= 1)
    prev = v
  }
})

test('entryEnvelope: layers are staggered (near layer leads the far layer)', () => {
  const t = STAGE.entrySeconds * 0.4
  assert.ok(
    entryEnvelope(t, STAGE.dust[0].entryDelay) > entryEnvelope(t, STAGE.dust[1].entryDelay),
    'anti-vanilla gate: no mass-synchronised entry',
  )
})

test('entryEnvelope: malformed clock settles to 1 (dust present, never hidden)', () => {
  assert.equal(entryEnvelope(NaN, 0), 1)
  assert.equal(entryEnvelope(undefined, 0.7), 1)
})

// ── fog ──────────────────────────────────────────────────────────────────────

test('fogDensityFor scales inversely with the stage scale (#27)', () => {
  assert.equal(fogDensityFor(1), STAGE.fogDensity)
  assert.equal(fogDensityFor(10), STAGE.fogDensity / 10)
  assert.equal(fogDensityFor(1000), STAGE.fogDensity / 1000)
})

test('fogDensityFor degrades malformed/sub-1 scales to the scale-1 density', () => {
  for (const bad of [0, -3, NaN, undefined, Infinity]) {
    assert.equal(fogDensityFor(bad), STAGE.fogDensity)
  }
})

// ── boot flight ──────────────────────────────────────────────────────────────

test('flightFrame lands EXACTLY on identity at p ≥ 1 (the stage never owns the final pose)', () => {
  for (const p of [1, 1.0001, 5]) {
    assert.deepEqual(flightFrame(p), { dolly: 0, orbit: 0, lift: 0 })
  }
})

test('flightFrame starts at the declared start pose and converges monotonically', () => {
  const start = flightFrame(0)
  assert.equal(start.dolly, STAGE.flight.dolly)
  assert.equal(start.orbit, STAGE.flight.orbit)
  assert.equal(start.lift,  STAGE.flight.lift)
  let prev = Infinity
  for (let p = 0; p <= 1; p += 0.02) {
    const f = flightFrame(p)
    const mag = Math.abs(f.dolly) + Math.abs(f.orbit) + Math.abs(f.lift)
    assert.ok(mag <= prev + 1e-12, 'the flight only approaches the final pose, never retreats')
    prev = mag
  }
})

test('flightFrame clamps malformed progress to the start pose (no NaN camera)', () => {
  for (const bad of [NaN, undefined, -2]) {
    const f = flightFrame(bad)
    assert.ok([f.dolly, f.orbit, f.lift].every(Number.isFinite))
    assert.deepEqual(f, flightFrame(0))
  }
})

test('flight attributes ease on different curves (per-attribute easing, not one tween)', () => {
  const f = flightFrame(0.5)
  const dollyNorm = f.dolly / STAGE.flight.dolly
  const orbitNorm = f.orbit / STAGE.flight.orbit
  assert.ok(Math.abs(dollyNorm - orbitNorm) > 0.02, 'expo dolly must lead the cubic swing')
})
