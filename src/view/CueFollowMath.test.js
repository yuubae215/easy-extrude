/**
 * CueFollowMath.test.js — a state cue follows its target (ADR-166 M4a).
 *
 * The questions each consumer (MeshView / CoordinateFrameView / RegionGhostView /
 * the map annotations' selection) relies on, asked once here:
 *   - the same request twice does not restart (an idempotent caller is not a trigger)
 *   - a reversal mid-flight continues from the level on screen
 *   - arrival lands (`land`), release fades (`fade`), both inside the response band
 *   - a violation arrives at once (Tier F) and leaves an afterglow
 *   - reduced motion and malformed clocks land on the target at once
 *   - the layered blend keeps the priority: at full level the highest cue wins
 *
 * Structurally NOT seen here (declared): whether a view actually calls tick(t)
 * every frame — a view that is never ticked keeps its last pixels. The tick is
 * wired in AppController's loop (Solid / Profile / CoordinateFrame) and in
 * ContextController's ghost-mode tick; the M4a stills are the evidence for that.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CUE_REST, settledCue, cueLevel, retargetCue, blendLayers,
  HOVER_CUE, SELECTION_CUE, VIOLATION_CUE, DIM_CUE, ANNOTATION_SELECTION_CUE,
  SELECT_LAND, HOVER_LAND, CUE_RELEASE, VIOLATION_AFTERGLOW,
} from './CueFollowMath.js'
import { easeOutExpo, easeOutQuad } from './MotionMath.js'
import { SELECT_LAND as MAP_SELECT_LAND, UNSELECTED } from './MapVisualMath.js'

const PROFILES = { HOVER_CUE, SELECTION_CUE, VIOLATION_CUE, DIM_CUE, ANNOTATION_SELECTION_CUE }

test('every leg sits inside the response band (≤ 300 ms) and is a named curve', () => {
  for (const [name, p] of Object.entries(PROFILES)) {
    for (const leg of [p.rise, p.fall]) {
      assert.ok(leg.duration >= 0 && leg.duration <= 0.3, `${name}: ${leg.duration}s is outside the band`)
      assert.equal(typeof leg.curve, 'function', `${name}: a leg without a chosen curve`)
    }
  }
  assert.ok(HOVER_LAND <= SELECT_LAND, 'hover is the more frequent cue — it is the shorter one')
})

test('the map annotations and the cube land selection in the same time (one source)', () => {
  assert.equal(MAP_SELECT_LAND, SELECT_LAND)
  assert.equal(UNSELECTED, CUE_REST)
})

test('arrival lands on outExpo, release fades on outQuad', () => {
  const on = retargetCue(10, CUE_REST, true, HOVER_CUE)
  const p = 0.3
  assert.ok(Math.abs(cueLevel(10 + HOVER_LAND * p, on, HOVER_CUE) - easeOutExpo(p)) < 1e-12)
  assert.equal(cueLevel(10 + HOVER_LAND, on, HOVER_CUE), 1)
  const off = retargetCue(20, on, false, HOVER_CUE)
  assert.ok(Math.abs(cueLevel(20 + CUE_RELEASE * p, off, HOVER_CUE) - (1 - easeOutQuad(p))) < 1e-12)
  assert.equal(cueLevel(20 + CUE_RELEASE, off, HOVER_CUE), 0)
})

test('the same request twice does not restart the landing', () => {
  const seg = retargetCue(5, CUE_REST, true, SELECTION_CUE)
  const tMid = 5 + SELECT_LAND * 0.5
  assert.equal(retargetCue(tMid, seg, true, SELECTION_CUE), seg, 'identical segment — no replay')
  assert.equal(retargetCue(tMid, seg, 1, SELECTION_CUE), seg, 'a boolean and its 0/1 are the same request')
})

test('a reversal mid-flight continues from the level on screen — in both directions', () => {
  for (const [name, motion] of Object.entries(PROFILES)) {
    const on = retargetCue(5, CUE_REST, true, motion)
    const t1 = 5 + 0.03
    const before = cueLevel(t1, on, motion)
    const off = retargetCue(t1, on, false, motion)
    assert.ok(Math.abs(cueLevel(t1, off, motion) - before) < 1e-12, `${name}: jumped at the reversal`)
    const t2 = t1 + 0.02
    const mid = cueLevel(t2, off, motion)
    const again = retargetCue(t2, off, true, motion)
    // An immediate arrival (the violation's) is the one leg allowed to jump.
    if (motion.rise.duration > 0) {
      assert.ok(Math.abs(cueLevel(t2, again, motion) - mid) < 1e-12, `${name}: jumped at the second reversal`)
    }
    assert.equal(cueLevel(t2 + 1, again, motion), 1)
  }
})

test('a violation arrives at once (Tier F) and leaves an afterglow', () => {
  const on = retargetCue(3, CUE_REST, true, VIOLATION_CUE)
  assert.equal(cueLevel(3, on, VIOLATION_CUE), 1, 'a fact is not eased in')
  const off = retargetCue(4, on, false, VIOLATION_CUE)
  const half = cueLevel(4 + VIOLATION_AFTERGLOW / 2, off, VIOLATION_CUE)
  assert.ok(half > 0 && half < 1, 'the afterglow is still on screen half-way')
  assert.equal(cueLevel(4 + VIOLATION_AFTERGLOW, off, VIOLATION_CUE), 0)
})

test('reduced motion and malformed clocks land on the target at once', () => {
  for (const [name, motion] of Object.entries(PROFILES)) {
    const reduced = retargetCue(5, CUE_REST, true, motion, true)
    assert.equal(cueLevel(5, reduced, motion, true), 1, `${name}: reduced`)
    assert.equal(cueLevel(NaN, retargetCue(5, CUE_REST, true, motion), motion), 1, `${name}: NaN read`)
    assert.equal(cueLevel(5, retargetCue(NaN, CUE_REST, true, motion), motion), 1, `${name}: NaN request`)
  }
  assert.equal(cueLevel(1, null, HOVER_CUE), 0)
})

test('a settled segment does not animate into its first state', () => {
  const s = settledCue(1)
  assert.equal(cueLevel(0, s, DIM_CUE), 1)
  assert.equal(retargetCue(7, s, true, DIM_CUE), s)
})

test('the layered blend keeps the priority composition and is continuous between', () => {
  const base = [0, 0, 0], hover = [0.1, 0.1, 0.1], sel = [0.3, 0.2, 0.1], viol = [0.5, 0, 0]
  const out = [0, 0, 0]
  assert.deepEqual(blendLayers(out, base, [[hover, 1], [sel, 1], [viol, 1]]), viol, 'violation wins at full level')
  assert.deepEqual(blendLayers(out, base, [[hover, 1], [sel, 1], [viol, 0]]), sel, 'selection over hover')
  assert.deepEqual(blendLayers(out, base, [[hover, 0], [sel, 0], [viol, 0]]), base)
  const half = blendLayers([0, 0, 0], base, [[hover, 0], [sel, 0.5], [viol, 0]])
  assert.ok(Math.abs(half[0] - 0.15) < 1e-12, 'half-way between, not a swap')
})
