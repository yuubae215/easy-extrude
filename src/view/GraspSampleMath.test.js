/**
 * GraspSampleMath.test.js — the sample line is the tool when one is declared
 * (ADR-155 D3), and the short normal otherwise.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleLines, WHISKER } from './GraspSampleMath.js'

// A workpiece top at the bottom of a bin: floor 810, part 20 tall → top 830.
const TOP = { point: [200, 150, 830], normal: [0, 0, 1] }

test('with an axial tool the line runs from the TCP to the flange, length = tool length', () => {
  const r = sampleLines([TOP], { radius: 5, toolLengthMm: 150 })
  assert.equal(r.kind, 'tool')
  assert.deepEqual(r.positions, [200, 150, 830, 200, 150, 980])
  assert.deepEqual(r.flanges, [[200, 150, 980]])
})

test('the flange stands out of the face along the normal, for every face', () => {
  const side = { point: [100, 0, 50], normal: [-1, 0, 0] }
  const r = sampleLines([side], { radius: 5, toolLengthMm: 120 })
  assert.deepEqual(r.flanges, [[-20, 0, 50]])
})

test('no declared tool length → the short normal whisker and NO flange (nothing invented)', () => {
  for (const toolLengthMm of [null, undefined, 0, -10, Number.NaN]) {
    const r = sampleLines([TOP], { radius: 5, toolLengthMm })
    assert.equal(r.kind, 'normal', String(toolLengthMm))
    assert.deepEqual(r.positions, [200, 150, 830, 200, 150, 830 + 5 * WHISKER])
    assert.deepEqual(r.flanges, [])
  }
})

test('N samples → N segments and N flanges (cardinality, 原則 #31)', () => {
  const samples = Array.from({ length: 9 }, (_, i) => ({ point: [i, 0, 0], normal: [0, 0, 1] }))
  const r = sampleLines(samples, { radius: 1, toolLengthMm: 10 })
  assert.equal(r.positions.length, 9 * 6)
  assert.equal(r.flanges.length, 9)
  assert.deepEqual(sampleLines([], { radius: 1, toolLengthMm: 10 }), { kind: 'tool', positions: [], flanges: [] })
})
