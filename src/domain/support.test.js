/**
 * support (ADR-168 S3) — which thing rests on which, from the declarations.
 * The rule asked here: one normal form for two readings (原則 #28), and a pair
 * whose statements disagree is contested — named, never silently a support.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supportsOf, restsOn, SUPPORT_CELL, SUPPORTED_BY_CELL } from './support.js'
import { cellById } from './relationCells.js'

const claim = (subject, of, side, by = 'ann') => ({ ref: `${by}-${subject}-${of}`, by, subject, sides: [{ of, ...side }] })

test('the two cells a support is said with are cells of the grid', () => {
  assert.ok(cellById(SUPPORT_CELL).declarable)
  assert.ok(cellById(SUPPORTED_BY_CELL).declarable)
})

test('0 declarations — 0 supports, 0 contested (stated, not undefined)', () => {
  assert.deepEqual(supportsOf(), { supports: [], contested: [] })
  assert.deepEqual(supportsOf({ arrangements: [], unclaimed: [] }), { supports: [], contested: [] })
})

test('touching the partner\'s top — the subject rests on the partner', () => {
  const r = supportsOf({ arrangements: [claim('bin', 'table', { contact: 'touching', toward: '+z' })] })
  assert.deepEqual(r.supports, [{ subject: 'bin', of: 'table' }])
})

test('touching the partner\'s bottom — the same fact said from below: the PARTNER rests on the subject', () => {
  const r = supportsOf({ arrangements: [claim('table', 'bin', { contact: 'touching', toward: '-z' })] })
  assert.deepEqual(r.supports, [{ subject: 'bin', of: 'table' }])
})

test('both readings together are one support, not a conflict (原則 #28)', () => {
  const r = supportsOf({ arrangements: [
    claim('bin', 'table', { contact: 'touching', toward: '+z' }, 'ann'),
    claim('table', 'bin', { contact: 'touching', toward: '-z' }, 'ben'),
  ] })
  assert.deepEqual(r, { supports: [{ subject: 'bin', of: 'table' }], contested: [] })
})

test('unclaimed relations count, read through their cell', () => {
  const r = supportsOf({ unclaimed: [{ subject: 'bin', of: 'table', cell: 'touching:+z', was: 'above' }] })
  assert.deepEqual(r.supports, [{ subject: 'bin', of: 'table' }])
})

test('not a support: apart above, touching a side, contact alone, an unstated cell', () => {
  const r = supportsOf({
    arrangements: [
      claim('lamp', 'table', { contact: 'apart', toward: 'above' }),
      claim('box', 'wall', { contact: 'touching', toward: '+x' }),
      claim('pen', 'desk', { contact: 'touching' }),
    ],
    unclaimed: [{ subject: 'a', of: 'b', cell: '_:_', was: 'adjacent' }],
  })
  assert.deepEqual(r, { supports: [], contested: [] })
})

test('contested: one says resting on top, another says apart', () => {
  const r = supportsOf({ arrangements: [
    claim('bin', 'table', { contact: 'touching', toward: '+z' }, 'ann'),
    claim('bin', 'table', { contact: 'apart' }, 'ben'),
  ] })
  assert.deepEqual(r, { supports: [], contested: [{ a: 'bin', b: 'table' }] })
})

test('contested: each says the other rests on it', () => {
  const r = supportsOf({ arrangements: [
    claim('bin', 'table', { contact: 'touching', toward: '+z' }, 'ann'),
    claim('table', 'bin', { contact: 'touching', toward: '+z' }, 'ben'),
  ] })
  assert.deepEqual(r.contested, [{ a: 'bin', b: 'table' }])
  assert.deepEqual(r.supports, [])
})

test('contested: a claim against an unclaimed relation on the face', () => {
  const r = supportsOf({
    arrangements: [claim('bin', 'table', { contact: 'touching', toward: '+x' })],
    unclaimed: [{ subject: 'bin', of: 'table', cell: 'touching:+z', was: 'above' }],
  })
  assert.deepEqual(r.contested, [{ a: 'bin', b: 'table' }])
})

test('the output does not depend on the order the declarations arrive in', () => {
  const arrangements = [
    claim('b', 't', { contact: 'touching', toward: '+z' }),
    claim('a', 't', { contact: 'touching', toward: '+z' }),
    claim('c', 't', { contact: 'touching', toward: '+z' }, 'x'), claim('c', 't', { contact: 'apart' }, 'y'),
  ]
  assert.deepEqual(supportsOf({ arrangements }), supportsOf({ arrangements: [...arrangements].reverse() }))
})

test('restsOn reads only the support cell and its inverse', () => {
  assert.deepEqual(restsOn('a', 'b', { contact: 'touching', toward: '+z' }), { subject: 'a', of: 'b' })
  assert.deepEqual(restsOn('a', 'b', { contact: 'touching', toward: '-z' }), { subject: 'b', of: 'a' })
  assert.equal(restsOn('a', 'b', { contact: 'apart', toward: '+z' }), null)
  assert.equal(restsOn('a', 'b', {}), null)
})

test('supportsOf mutates nothing it is given', () => {
  const arrangements = Object.freeze([Object.freeze(claim('a', 'b', Object.freeze({ contact: 'touching', toward: '+z' })))])
  assert.doesNotThrow(() => supportsOf({ arrangements }))
})
