import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as MapVisualMath from './MapVisualMath.js'
import {
  phaseFor, livePulse, entryFrame, ENTRY_POP,
  hubPingFrame, hubCoreFrame, HUB_PING_RINGS, HUB_PING_PERIOD,
  anchorFrame, ANCHOR_PERIOD,
  zoneFillFrame, zoneRimFrame, hatchOffset,
  ZONE_FILL_MIN, ZONE_FILL_MAX, ZONE_RIM_RINGS, ZONE_RIM_PERIOD,
  routeFlowFrame, ROUTE_HEADS, ROUTE_TRAIL,
  boundaryTickFrame,
} from './MapVisualMath.js'

/**
 * These tests are where the anti-vanilla rules are ASKED (CLAUDE.md「After fixing
 * a bug」Q3): the two defects ADR-093 fixes are population lockstep (PHILOSOPHY
 * #31 — invisible with one entity) and linear interpolation. Prose cannot hold
 * either; both are asserted here as properties, so a future "simplification"
 * back to `opacity = 1 - phase` fails the suite instead of shipping.
 */

// ── The module-wide contract: every frame function has a static branch ──────
//
// The defect this replaces: none of the three annotation views consulted the
// reduced-motion boundary at all, while every view written after ADR-065 does.
// A prose rule would have been re-broken by the next function added here, so the
// rule is asked as a PROPERTY, and the table below is enumerated against the
// module's real exports — a new `*Frame` export that forgets its reduced branch
// fails the suite instead of shipping (PHILOSOPHY #31: enumerate the required
// kinds and check the count; never walk only what happens to be registered).

/** name → (t, reduced) invoker. Must cover every exported frame function. */
const FRAME_FUNCTIONS = {
  entryFrame:        (t, reduced) => entryFrame(t, 0, reduced),
  hubPingFrame:      (t, reduced) => hubPingFrame(t, 0.3, 0, { reduced }),
  hubCoreFrame:      (t, reduced) => hubCoreFrame(t, 0.3, { reduced }),
  anchorFrame:       (t, reduced) => anchorFrame(t, 0.3, { reduced }),
  zoneFillFrame:     (t, reduced) => zoneFillFrame(t, 0.3, { reduced }),
  zoneRimFrame:      (t, reduced) => zoneRimFrame(t, 0.3, 0, { reduced }),
  hatchOffset:       (t, reduced) => hatchOffset(t, 0.3, reduced),
  routeFlowFrame:    (t, reduced) => routeFlowFrame(t, 1, 1, 0.3, { reduced }),
  boundaryTickFrame: (t, reduced) => boundaryTickFrame(t, 0.4, 0.3, reduced),
}

test('the reduced-motion table covers every exported frame function', () => {
  // `livePulse` and `phaseFor` are helpers, not frames: they have no static
  // branch to check (a phase is not motion). Everything else must be registered.
  const helpers = new Set(['phaseFor', 'livePulse'])
  const exported = Object.entries(MapVisualMath)
    .filter(([name, v]) => typeof v === 'function' && !helpers.has(name))
    .map(([name]) => name)
  assert.deepEqual(
    exported.sort(), Object.keys(FRAME_FUNCTIONS).sort(),
    'a frame function was added to MapVisualMath without registering it here — ' +
    'register it (and give it a reduced branch) or classify it as a helper',
  )
})

test('every frame function is perfectly static under reduced motion', () => {
  for (const [name, invoke] of Object.entries(FRAME_FUNCTIONS)) {
    const a = invoke(1.7, true)
    const b = invoke(913.4, true)
    assert.deepEqual(a, b, `${name} still moves under reduced motion`)
  }
})

test('every frame function still shows something under reduced motion', () => {
  // A static frame must be a CUE, never a blank one (PHILOSOPHY #11/#30): a
  // silently invisible annotation is the worst failure mode of "reduce motion".
  for (const [name, invoke] of Object.entries(FRAME_FUNCTIONS)) {
    const f = invoke(4.2, true)
    if (typeof f === 'number') {
      assert.ok(f > 0, `${name} collapses to nothing under reduced motion`)
      continue
    }
    if ('opacity' in f) assert.ok(f.opacity > 0, `${name} is invisible under reduced motion`)
    if ('scale' in f)   assert.ok(f.scale > 0,   `${name} collapses to zero size under reduced motion`)
  }
})

test('every frame function survives a malformed clock', () => {
  for (const [name, invoke] of Object.entries(FRAME_FUNCTIONS)) {
    for (const bad of [NaN, Infinity, undefined]) {
      const f = invoke(bad, false)
      const values = typeof f === 'number' ? [f] : Object.values(f)
      for (const v of values) {
        assert.ok(Number.isFinite(v), `${name} produced ${v} for clock ${bad} (P12)`)
      }
    }
  }
})

// ── phaseFor — the anti-lockstep seed (#31) ──────────────────────────────────

test('phaseFor is deterministic and bounded to [0,1)', () => {
  for (const key of ['annot_point_1', 'annot_region_1753400000000', 'x']) {
    const a = phaseFor(key)
    assert.equal(a, phaseFor(key), 'same id must give the same phase across reloads')
    assert.ok(a >= 0 && a < 1, `phase out of range: ${a}`)
  }
})

test('phaseFor returns 0 for a missing id (single-entity scenes unchanged)', () => {
  assert.equal(phaseFor(null), 0)
  assert.equal(phaseFor(undefined), 0)
  assert.equal(phaseFor(''), 0)
})

test('phaseFor de-syncs a population of sibling ids (the #31 defect)', () => {
  // Ids minted milliseconds apart differ in their last digits only — the exact
  // case a weak hash would collapse into lockstep again.
  const ids = Array.from({ length: 8 }, (_, i) => `annot_point_${1753400000000 + i}`)
  const phases = ids.map(phaseFor).sort((a, b) => a - b)
  assert.equal(new Set(phases).size, 8, 'sibling ids must not share a phase')
  // No two neighbours closer than 1% of the cycle: visually distinguishable.
  for (let i = 1; i < phases.length; i++) {
    assert.ok(phases[i] - phases[i - 1] > 0.01, `phases too close: ${phases[i - 1]} vs ${phases[i]}`)
  }
})

test('two entities never ping on the same frame', () => {
  const a = phaseFor('annot_point_1753400000001')
  const b = phaseFor('annot_point_1753400000002')
  const t = 4.0
  const fa = hubPingFrame(t, a, 0)
  const fb = hubPingFrame(t, b, 0)
  assert.ok(Math.abs(fa.scale - fb.scale) > 0.05, 'sibling Hubs must not share a ping frame')
})

// ── livePulse ───────────────────────────────────────────────────────────────

test('livePulse stays inside the sum of its amplitudes', () => {
  const def = { a1: 0.1, f1: 1.7, a2: 0.05, f2: 2.9 }
  for (let t = 0; t < 20; t += 0.13) {
    const v = livePulse(t, 0.37, def)
    assert.ok(Math.abs(v) <= def.a1 + def.a2 + 1e-9, `livePulse out of bounds at t=${t}: ${v}`)
  }
})

// ── entryFrame ──────────────────────────────────────────────────────────────

test('entryFrame lands exactly on the identity frame and stays there', () => {
  const end = entryFrame(10 + ENTRY_POP, 10)
  assert.equal(end.scale, 1)
  assert.equal(end.opacity, 1)
  const after = entryFrame(30, 10)
  assert.equal(after.scale, 1)
  assert.equal(after.opacity, 1)
})

test('entryFrame overshoots in scale while opacity stays bounded (two curves)', () => {
  let sawOvershoot = false
  for (let e = 0; e < ENTRY_POP; e += 0.005) {
    const f = entryFrame(e, 0)
    if (f.scale > 1.02) sawOvershoot = true
    assert.ok(f.opacity >= 0 && f.opacity <= 1, `opacity out of range: ${f.opacity}`)
    assert.ok(f.scale > 0, 'scale must stay positive (a zero scale is a lost frame)')
  }
  assert.ok(sawOvershoot, 'the entry pop must overshoot — a linear rise is the vanilla failure')
})

test('entryFrame holds the static frame under reduced motion and on bad clocks', () => {
  assert.deepEqual(entryFrame(0.1, 0, true), { scale: 1, opacity: 1 })
  assert.deepEqual(entryFrame(NaN, 0), { scale: 1, opacity: 1 })
  assert.deepEqual(entryFrame(0.1, NaN), { scale: 1, opacity: 1 })
})

// ── Hub ─────────────────────────────────────────────────────────────────────

test('hubPingFrame expands while fading, within bounds', () => {
  let prevScale = -Infinity, prevOpacity = Infinity
  for (let p = 0; p < 1; p += 0.02) {
    const f = hubPingFrame(p * HUB_PING_PERIOD, 0, 0)
    assert.ok(f.scale >= prevScale - 1e-9, 'ping radius must never shrink mid-flight')
    assert.ok(f.opacity <= prevOpacity + 1e-9, 'ping alpha must never rise mid-flight')
    assert.ok(f.opacity >= 0 && f.opacity <= 1)
    prevScale = f.scale
    prevOpacity = f.opacity
  }
})

test('hubPingFrame is eased, not linear (quality gate 1)', () => {
  // At the cycle midpoint an easeOutExpo ping has already covered most of its
  // reach; a linear ramp would sit at exactly half. This assertion is the gate.
  const mid = hubPingFrame(HUB_PING_PERIOD * 0.5, 0, 0)
  const full = hubPingFrame(HUB_PING_PERIOD * 0.999, 0, 0)
  const covered = (mid.scale - 1) / (full.scale - 1)
  assert.ok(covered > 0.75, `ping distance looks linear (covered ${covered.toFixed(2)} at midpoint)`)
})

test('hubPingFrame rings are spread across the cycle, never in unison', () => {
  const t = 1.234
  const frames = Array.from({ length: HUB_PING_RINGS }, (_, i) => hubPingFrame(t, 0, i))
  const scales = new Set(frames.map(f => f.scale.toFixed(4)))
  assert.equal(scales.size, HUB_PING_RINGS, 'the rings of one Hub must not overlap exactly')
})

test('hubPingFrame urgency raises the peak and shortens the period', () => {
  const calm = hubPingFrame(0.001, 0, 0)
  const urgent = hubPingFrame(0.001, 0, 0, { urgent: true })
  assert.ok(urgent.opacity > calm.opacity, 'a violated Hub must be hotter, not only faster')
})

test('Hub holds a visible cue under reduced motion', () => {
  const held = hubPingFrame(5, 0.3, 0, { reduced: true })
  assert.ok(held.opacity > 0.1, 'reduced motion must keep the broadcast cue, not blank it (#11)')
  assert.ok(held.scale > 1)
  const core = hubCoreFrame(5, 0.3, { reduced: true })
  assert.equal(core.scale, 1)
  assert.ok(core.haloOpacity > 0)
})

test('hubCoreFrame keeps the halo non-negative for every phase', () => {
  for (let t = 0; t < 12; t += 0.07) {
    for (const ph of [0, 0.21, 0.73]) {
      const f = hubCoreFrame(t, ph)
      assert.ok(f.haloOpacity >= 0, `negative halo alpha at t=${t}`)
      assert.ok(f.scale > 0.5 && f.scale < 1.5)
      assert.ok(f.haloScale > 0)
    }
  }
})

// ── Anchor ──────────────────────────────────────────────────────────────────

test('anchorFrame holds perfectly still for most of the cycle', () => {
  let stillFrames = 0, total = 0
  for (let p = 0; p < 1; p += 0.01) {
    const f = anchorFrame(p * ANCHOR_PERIOD, 0)
    if (f.scale === 1) stillFrames++
    total++
    assert.ok(f.scale >= 1 && f.scale < 1.5, `anchor scale out of range: ${f.scale}`)
    assert.ok(f.tickOpacity > 0 && f.tickOpacity <= 1)
  }
  assert.ok(stillFrames / total > 0.5, 'a datum marker must be still more than it moves')
})

test('anchorFrame urgency moves further and faster', () => {
  const peakOf = (urgent) => {
    let max = 0
    for (let t = 0; t < 10; t += 0.01) max = Math.max(max, anchorFrame(t, 0, { urgent }).scale)
    return max
  }
  assert.ok(peakOf(true) > peakOf(false))
})

// ── Zone ────────────────────────────────────────────────────────────────────

test('zoneFillFrame stays inside its declared band and is seamless at the loop', () => {
  for (let t = 0; t < 30; t += 0.11) {
    const { opacity } = zoneFillFrame(t, 0.42)
    assert.ok(opacity >= ZONE_FILL_MIN - 1e-9 && opacity <= ZONE_FILL_MAX + 1e-9,
      `fill opacity out of band: ${opacity}`)
  }
  // sin² has zero velocity at both ends → the wrap frame equals the start frame.
  const head = zoneFillFrame(0, 0).opacity
  const tail = zoneFillFrame(6.4 - 1e-6, 0).opacity
  assert.ok(Math.abs(head - tail) < 1e-3, 'the breathe must not jump at the loop seam')
})

test('zoneFillFrame de-syncs siblings and reduced motion parks mid-band', () => {
  const a = zoneFillFrame(3, phaseFor('annot_region_1')).opacity
  const b = zoneFillFrame(3, phaseFor('annot_region_2')).opacity
  assert.ok(Math.abs(a - b) > 0.01, 'sibling Zones must not breathe in unison')
  const held = zoneFillFrame(3, 0.5, { reduced: true }).opacity
  assert.ok(held > ZONE_FILL_MIN && held < ZONE_FILL_MAX)
})

test('zoneRimFrame is eased outward and spread across rings', () => {
  const mid = zoneRimFrame(ZONE_RIM_PERIOD * 0.5, 0, 0)
  const full = zoneRimFrame(ZONE_RIM_PERIOD * 0.999, 0, 0)
  const covered = (mid.scale - 1) / (full.scale - 1)
  assert.ok(covered > 0.6, `rim radius looks linear (covered ${covered.toFixed(2)})`)
  const t = 0.77
  const scales = new Set(Array.from({ length: ZONE_RIM_RINGS }, (_, i) => zoneRimFrame(t, 0, i).scale.toFixed(4)))
  assert.equal(scales.size, ZONE_RIM_RINGS)
})

test('zoneRimFrame falls back to the default period on malformed input', () => {
  const bad = zoneRimFrame(1, 0, 0, { period: 0 })
  const good = zoneRimFrame(1, 0, 0, { period: ZONE_RIM_PERIOD })
  assert.deepEqual(bad, good)
})

test('hatchOffset crawls forward in time and freezes under reduced motion', () => {
  const a = hatchOffset(0, 0.3)
  const b = hatchOffset(10, 0.3)
  assert.ok(b.u > a.u && b.v > a.v, 'the hatch must drift')
  const r1 = hatchOffset(0, 0.3, true)
  const r2 = hatchOffset(99, 0.3, true)
  assert.deepEqual(r1, r2, 'reduced motion must freeze the hatch, not remove it')
})

// ── Route ───────────────────────────────────────────────────────────────────

test('routeFlowFrame keeps every bead on the polyline', () => {
  for (let t = 0; t < 20; t += 0.09) {
    for (let h = 0; h < ROUTE_HEADS; h++) {
      for (let s = 0; s <= ROUTE_TRAIL; s++) {
        const f = routeFlowFrame(t, h, s, 0.31)
        assert.ok(f.frac >= 0 && f.frac < 1, `frac off the line: ${f.frac}`)
        assert.ok(f.scale > 0, 'a bead must never collapse to zero scale')
        assert.ok(f.opacity > 0 && f.opacity <= 1)
      }
    }
  }
})

test('routeFlowFrame trails lag behind their head and taper', () => {
  const head = routeFlowFrame(0, 0, 0, 0)
  const tail = routeFlowFrame(0, 0, ROUTE_TRAIL, 0)
  assert.ok(tail.opacity < head.opacity, 'the trail must fade — that is the 余韻')
  assert.ok(tail.scale < head.scale, 'the trail must taper')
  // Forward flow puts the trail behind the head in arc-length terms.
  assert.ok(tail.frac > head.frac, 'at t=0 the trail sits behind the head (wrapped)')
})

test('routeFlowFrame heads do not travel in lockstep', () => {
  const t = 7.3
  const fracs = Array.from({ length: ROUTE_HEADS }, (_, h) => routeFlowFrame(t, h, 0, 0.2).frac)
  const gaps = fracs.slice(1).map((f, i) => Math.abs(f - fracs[i]))
  const spread = Math.max(...gaps) - Math.min(...gaps)
  assert.ok(spread > 1e-3, 'per-head speed variance must break the rigid convoy')
})

test('routeFlowFrame reverses with direction (the tact-time fact)', () => {
  const fwd = routeFlowFrame(1, 0, 0, 0, { direction: 1 }).frac
  const rev = routeFlowFrame(1, 0, 0, 0, { direction: -1 }).frac
  assert.notEqual(fwd, rev)
})

test('routeFlowFrame parks a populated channel under reduced motion', () => {
  const a = routeFlowFrame(1, 2, 0, 0.4, { reduced: true })
  const b = routeFlowFrame(99, 2, 0, 0.4, { reduced: true })
  assert.deepEqual(a, b, 'reduced motion must park the beads, not hide the channel')
  assert.ok(a.opacity > 0)
})

// ── Boundary ────────────────────────────────────────────────────────────────

test('boundaryTickFrame never blanks a tick (the hatch is information)', () => {
  for (let t = 0; t < 12; t += 0.05) {
    for (let a = 0; a <= 1; a += 0.05) {
      const v = boundaryTickFrame(t, a, 0.2)
      assert.ok(v >= 0.25 - 1e-9 && v <= 1 + 1e-9, `tick intensity out of range: ${v}`)
    }
  }
  assert.equal(boundaryTickFrame(NaN, 0.5, 0), 0.55)
  assert.equal(boundaryTickFrame(1, NaN, 0), boundaryTickFrame(1, 0, 0))
})

test('boundaryTickFrame crest travels along the wall and wraps', () => {
  const peakTimeFor = (arc) => {
    let best = 0, bestT = 0
    for (let t = 0; t < 5.2; t += 0.01) {
      const v = boundaryTickFrame(t, arc, 0)
      if (v > best) { best = v; bestT = t }
    }
    return { best, bestT }
  }
  const start = peakTimeFor(0.05)
  const mid = peakTimeFor(0.5)
  assert.ok(mid.bestT > start.bestT, 'the crest must arrive later further along the wall')
  assert.ok(start.best > 0.9 && mid.best > 0.9, 'every tick must be reached by the crest')
  // Wrap: a tick at 0.98 is nearer the crest at 0.02 than a naive |a-c| suggests.
  assert.ok(boundaryTickFrame(0, 0.98, 0) > 0.25, 'the wall must wrap for the nearest crest')
})
