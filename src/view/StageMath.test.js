import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLOR, DURATION } from '../theme/tokens.js'
import {
  STAGE, STAGE_LIGHT, BACKDROP, GRID_FADE, gridFade, lightOn, poolBreath, stageLightFrame, flightFrame,
} from './StageMath.js'

// ── one light (ADR-166 M2 — §1.1) ───────────────────────────────────────────

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p)
  }
  return out
}

test('the stage light colour has exactly one reader — StageMath (one light source, never two)', () => {
  // M3 lays the Map annotations on the floor as light. If they read the token
  // themselves, the room has two light definitions that agree only by luck.
  // The census is over the token's READERS, derived from source — a list of
  // "allowed views" would be the place-list ADR-102 removed from the vocabulary.
  const readers = sourceFiles(SRC)
    .filter(f => /COLOR\.stageLight\b/.test(readFileSync(f, 'utf8')))
    .map(f => relative(SRC, f).split('\\').join('/'))
  assert.deepEqual(readers, ['view/StageMath.js'],
    'read the stage light through StageMath.STAGE_LIGHT, not COLOR.stageLight')
  assert.equal(STAGE_LIGHT.color, COLOR.stageLight)
})

test('the retired Void Grid atmosphere stays gone (no fog, no dust)', () => {
  // ADR-166 M2 retired it; a retired shape is counted, not remembered (原則 #31 —
  // retirement rot shows up as green, not as a miss).
  const stage = readFileSync(join(SRC, 'view/SceneStage.js'), 'utf8')
  assert.doesNotMatch(stage, /new THREE\.Fog/, 'the work cell has no fog')
  assert.doesNotMatch(stage, /THREE\.Points\b/, 'the work cell has no dust')
  assert.ok(!('fogDensity' in STAGE) && !('dust' in STAGE))
})

test('the backdrop is lit at the centre and falls off to the edge', () => {
  const lum = hex => {
    const n = parseInt(hex.slice(1), 16)
    return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
  }
  const [first, last] = [BACKDROP.stops[0], BACKDROP.stops[BACKDROP.stops.length - 1]]
  assert.equal(first[0], 0)
  assert.equal(last[0], 1)
  assert.ok(lum(first[1]) > lum(last[1]), 'centre brighter than edge')
})

test('gridFade: full inside the light, gone at the half-span, monotone, scale-free (#27)', () => {
  assert.ok(GRID_FADE.inner > 0 && GRID_FADE.inner < GRID_FADE.outer && GRID_FADE.outer <= 1)
  for (const half of [10, 10000]) {
    assert.equal(gridFade(0, half), 1)
    assert.equal(gridFade(GRID_FADE.inner * half, half), 1)
    assert.equal(gridFade(GRID_FADE.outer * half, half), 0)
    assert.equal(gridFade(Math.SQRT2 * half, half), 0, 'the square corners are gone — the grid reads as a disc')
    let prev = Infinity
    for (let r = 0; r <= half * 1.5; r += half / 50) {
      const v = gridFade(r, half)
      assert.ok(v <= prev + 1e-12)
      prev = v
    }
  }
  assert.equal(gridFade(0.5 * 10, 10), gridFade(0.5 * 10000, 10000), 'same fraction, same fade at any scale')
  assert.equal(gridFade(NaN, 10), 1)
})

test('the grid shader is built from GRID_FADE (one source for the radii)', () => {
  const view = readFileSync(join(SRC, 'view/SceneView.js'), 'utf8')
  assert.match(view, /GRID_FADE\.inner \* half, GRID_FADE\.outer \* half/)
  assert.match(view, /smoothstep\( uGridFade\.x, uGridFade\.y/)
})

// ── the light comes on as the flight lands ───────────────────────────────────

test('lightOn: dark before the flight lands, exactly on after, monotone (outExpo) between', () => {
  const { delay, seconds } = STAGE.lightOn
  assert.equal(lightOn(0), 0)
  assert.equal(lightOn(delay), 0)
  assert.equal(lightOn(delay + seconds), 1)
  assert.equal(lightOn(delay + seconds + 60), 1)
  let prev = -Infinity
  for (let t = 0; t <= delay + seconds + 0.2; t += 0.02) {
    const v = lightOn(t)
    assert.ok(v >= prev - 1e-12, 'never dims while coming on')
    prev = v
  }
  // outExpo, not linear: past half by a fifth of the window (gate 1)
  assert.ok(lightOn(delay + seconds * 0.2) > 0.5)
})

test('lightOn is derived from the boot flight, not tuned beside it', () => {
  const flight = DURATION.bootReveal / 1000
  assert.ok(STAGE.lightOn.delay > 0 && STAGE.lightOn.delay < flight,
    'the light comes on during the flight — the landing is the boundary it marks')
})

test('lightOn: a malformed clock leaves the light on (never a dark room)', () => {
  assert.equal(lightOn(NaN), 1)
  assert.equal(lightOn(undefined), 1)
})

// ── the idle breath ──────────────────────────────────────────────────────────

test('poolBreath stays in [1 − depth, 1], returns to 1 each period, and never sits still', () => {
  const { period, depth } = STAGE.breath
  assert.ok(period >= 2 && period <= 6, 'idle loop band 2–6 s (motion-language §2)')
  assert.equal(poolBreath(0), 1)
  assert.ok(Math.abs(poolBreath(period) - 1) < 1e-12)
  assert.ok(Math.abs(poolBreath(period / 2) - (1 - depth)) < 1e-12)
  for (let t = 0; t < period * 2; t += 0.1) {
    const v = poolBreath(t)
    assert.ok(v >= 1 - depth - 1e-12 && v <= 1 + 1e-12)
  }
  assert.equal(poolBreath(NaN), 1)
})

// ── reduced motion ───────────────────────────────────────────────────────────

test('stageLightFrame under reduced motion is the static lit cell — same frame at every t', () => {
  const lit = { poolOpacity: STAGE_LIGHT.pool.opacity, rimIntensity: STAGE_LIGHT.rimIntensity }
  for (const t of [0, 0.5, 3, 100, NaN]) assert.deepEqual(stageLightFrame(t, true), lit)
})

test('stageLightFrame with motion: dark at boot, fully lit after landing, breath only on the pool', () => {
  assert.deepEqual(stageLightFrame(0, false), { poolOpacity: 0, rimIntensity: 0 })
  const after = STAGE.lightOn.delay + STAGE.lightOn.seconds
  const f = stageLightFrame(after, false)
  assert.equal(f.rimIntensity, STAGE_LIGHT.rimIntensity, 'the rim does not breathe — bodies must not flicker')
  assert.ok(f.poolOpacity <= STAGE_LIGHT.pool.opacity && f.poolOpacity > 0)
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
