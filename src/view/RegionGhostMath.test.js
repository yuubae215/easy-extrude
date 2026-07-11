/**
 * RegionGhostMath.test.js — ADR-065 Phase 5 region-resolve pure derivations.
 *
 * Run via `pnpm test` (bare node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gapBandRects,
  regionResolveTransitions,
  resolveFrame,
  RESOLVE_RECOLOR_SPLIT,
  GAP_COLOR,
  RESOLVE_COLOR,
} from './RegionGhostMath.js'

/** A ghost with one empty axis (x gap [400, 600]) and a common y range. */
const conflictGhost = (over = {}) => ({
  variable: 'v_pos',
  axes: ['x', 'y'],
  domain: { x: [0, 1000], y: [0, 800] },
  state: 'conflict',
  intersection: {
    empty: true,
    emptyAxes: ['x'],
    gap: { x: [600, 400] },          // stored [hi, lo] as RegionGeometry emits
    box: { x: [600, 400], y: [100, 300] },
  },
  ...over,
})

const settledGhost = (over = {}) => ({
  variable: 'v_pos',
  axes: ['x', 'y'],
  state: 'resolved',
  intersection: { empty: true, emptyAxes: ['x'], gap: { x: [600, 400] }, box: { x: [600, 400], y: [100, 300] } },
  ...over,
})

// ── gapBandRects: single-source band geometry ────────────────────────────────────

test('gapBandRects spans the gap on the empty axis and the common range on the other', () => {
  const rects = gapBandRects(conflictGhost())
  assert.equal(rects.length, 1)
  assert.deepEqual(rects[0], { axis: 'x', x: [400, 600], y: [100, 300], gap: [400, 600] })
})

test('gapBandRects falls back to the domain when the other axis has no common range', () => {
  const g = conflictGhost()
  g.intersection.box.y = [300, 100]  // inverted = empty common range
  const rects = gapBandRects(g)
  assert.deepEqual(rects[0].y, [0, 800])
})

test('gapBandRects yields nothing for non-empty or malformed intersections (#11)', () => {
  assert.deepEqual(gapBandRects(conflictGhost({ intersection: { empty: false, emptyAxes: [], gap: {}, box: {} } })), [])
  assert.deepEqual(gapBandRects(null), [])
  assert.deepEqual(gapBandRects({}), [])
  const bad = conflictGhost()
  bad.intersection.gap.x = [NaN, 400]
  assert.deepEqual(gapBandRects(bad), [])
})

// ── regionResolveTransitions: recognition of a settled cell ──────────────────────

test('conflict → resolved yields one transition carrying the OLD gap band', () => {
  const out = regionResolveTransitions([conflictGhost()], [settledGhost()])
  assert.equal(out.length, 1)
  assert.equal(out[0].variable, 'v_pos')
  assert.deepEqual(out[0].rects[0].gap, [400, 600])
})

test('conflict → satisfied (region edit made the intersection non-empty) also fires', () => {
  const next = settledGhost({
    state: 'satisfied',
    intersection: { empty: false, emptyAxes: [], gap: {}, box: { x: [450, 550], y: [100, 300] } },
  })
  assert.equal(regionResolveTransitions([conflictGhost()], [next]).length, 1)
})

test('proposed → resolved fires; conflict → conflict / proposed does not', () => {
  assert.equal(regionResolveTransitions([conflictGhost({ state: 'proposed' })], [settledGhost()]).length, 1)
  assert.equal(regionResolveTransitions([conflictGhost()], [conflictGhost()]).length, 0)
  assert.equal(regionResolveTransitions([conflictGhost()], [conflictGhost({ state: 'proposed' })]).length, 0)
})

test('a variable that disappeared is NOT a resolution (never claim an uncommitted settlement)', () => {
  assert.equal(regionResolveTransitions([conflictGhost()], []).length, 0)
})

test('initial projection is not a transition: prev null/malformed yields [] (#11)', () => {
  assert.deepEqual(regionResolveTransitions(null, [settledGhost()]), [])
  assert.deepEqual(regionResolveTransitions(undefined, undefined), [])
  assert.deepEqual(regionResolveTransitions([{ state: 'conflict' }], [settledGhost()]), [])
})

test('reverse transition (undo: resolved → conflict) fires nothing', () => {
  assert.equal(regionResolveTransitions([settledGhost()], [conflictGhost()]).length, 0)
})

// ── resolveFrame: recolor → dissolve curve ───────────────────────────────────────

test('resolveFrame recolours at constant opacity, then fades fully green', () => {
  const start = resolveFrame(0)
  assert.deepEqual(start, { mix: 0, opacity: 0.3 })
  const midRecolor = resolveFrame(RESOLVE_RECOLOR_SPLIT / 2)
  assert.ok(midRecolor.mix > 0 && midRecolor.mix < 1)
  assert.equal(midRecolor.opacity, 0.3)
  const midFade = resolveFrame((1 + RESOLVE_RECOLOR_SPLIT) / 2)
  assert.equal(midFade.mix, 1)
  assert.ok(midFade.opacity > 0 && midFade.opacity < 0.3)
  assert.deepEqual(resolveFrame(1), { mix: 1, opacity: 0 })
  assert.deepEqual(resolveFrame(5), { mix: 1, opacity: 0 })   // clamped
})

test('resolveFrame under reduced motion holds a static settled cue (never nothing)', () => {
  assert.deepEqual(resolveFrame(0, true), { mix: 1, opacity: 0.3 })
  assert.deepEqual(resolveFrame(0.9, true), { mix: 1, opacity: 0.3 })
})

test('resolveFrame renders nothing on a non-finite progress (#11 honest silence)', () => {
  assert.deepEqual(resolveFrame(NaN), { mix: 1, opacity: 0 })
  assert.deepEqual(resolveFrame(Infinity), { mix: 1, opacity: 0 })
})

test('colour constants: gap red and token-derived resolve green are distinct 24-bit colours', () => {
  for (const c of [GAP_COLOR, RESOLVE_COLOR]) assert.ok(c >= 0 && c <= 0xffffff)
  assert.notEqual(GAP_COLOR, RESOLVE_COLOR)
})
