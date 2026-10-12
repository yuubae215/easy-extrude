import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gapOf, GAP, GAP_FACE } from './CriteriaGapMath.js'

test('the face follows the direction of the expectation', () => {
  assert.equal(gapOf({ op: '<=', value: 10 }, { value: 4 }), GAP.MEETS)
  assert.equal(gapOf({ op: '<=', value: 10 }, { value: 9.5 }), GAP.TIGHT)
  assert.equal(gapOf({ op: '<=', value: 10 }, { value: 12 }), GAP.MISSES)
  assert.equal(gapOf({ op: '>=', value: 300 }, { value: 800 }), GAP.MEETS)
  assert.equal(gapOf({ op: '>=', value: 300 }, { value: 200 }), GAP.MISSES)
})

test('strict comparisons are strict at the boundary', () => {
  assert.equal(gapOf({ op: '<', value: 10 }, { value: 10 }), GAP.MISSES)
  assert.equal(gapOf({ op: '<=', value: 10 }, { value: 10 }), GAP.TIGHT)
})

test('a range that straddles the expectation is "?", not a guess', () => {
  assert.equal(gapOf({ op: '<=', value: 4.2 }, { value: 4, range: [3.4, 4.6] }), GAP.UNSURE)
  assert.equal(gapOf({ op: '<=', value: 6 }, { value: 4, range: [3.4, 4.6] }), GAP.MEETS)
  assert.equal(gapOf({ op: '<=', value: 3 }, { value: 4, range: [3.4, 4.6] }), GAP.MISSES)
})

test('every gap has a face, and an undeclared comparison throws (#31)', () => {
  for (const g of Object.values(GAP)) assert.ok(GAP_FACE[g])
  assert.throws(() => gapOf({ op: '~', value: 1 }, { value: 1 }), /no gap declared/)
})
