/**
 * A Layout file that puts one thing on two floors is reported, not loaded
 * silently (ADR-170 S1 — D5 / D6). The check runs on the DSL before it
 * becomes a scene, so a file is never rewritten to fit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateLayoutDsl } from './LayoutValidator.js'

const zone = (ref, z, extra = {}) => ({
  ref, type: 'AnnotatedRegion', name: ref, placeType: 'Zone',
  vertices: [{ x: 0, y: 0, z }, { x: 1000, y: 0, z }, { x: 1000, y: 1000, z }, { x: 0, y: 1000, z }],
  ...extra,
})
const box = { ref: 'w', type: 'Solid', name: 'Work', position: { x: 500, y: 500, z: 50 }, dimensions: { x: 100, y: 100, z: 100 } }
const contains = (source, target) => ({ source, target, jointType: null, semanticType: 'contains' })
const dsl = (entities, constraints) => ({ version: 'layout/1.1', entities, constraints })
const d5 = (r) => r.errors.filter(e => e.includes('ADR-170'))

test('belonging to two zones on one floor is a valid file', () => {
  const r = validateLayoutDsl(dsl([zone('a', 0), zone('b', 0), box], [contains('a', 'w'), contains('b', 'w')]))
  assert.deepEqual(d5(r), [])
})

test('belonging to zones on two floors is reported with both zones and their heights', () => {
  const r = validateLayoutDsl(dsl([zone('a', 0), zone('m', 4000), box], [contains('a', 'w'), contains('m', 'w')]))
  assert.equal(r.valid, false)
  assert.equal(d5(r).length, 1)
  assert.match(d5(r)[0], /"w" belongs to zones at more than one elevation: "a" \(Z = 0\), "m" \(Z = 4000\)/)
})

test('a contains from a Region that is not a zone is not belonging', () => {
  const note = zone('n', 4000, { placeType: undefined })
  const r = validateLayoutDsl(dsl([zone('a', 0), note, box], [contains('a', 'w'), contains('n', 'w')]))
  assert.deepEqual(d5(r), [])
})

test('a zone whose vertices do not share one Z has no elevation, and says so', () => {
  const tilted = zone('t', 0)
  tilted.vertices[2].z = 300
  const r = validateLayoutDsl(dsl([tilted, box], []))
  assert.match(d5(r)[0], /Zone "t"\) vertices must share one Z/)
})

test('a basement is a zone below Z = 0 — not an error', () => {
  const r = validateLayoutDsl(dsl([zone('pit', -3000), box], [contains('pit', 'w')]))
  assert.deepEqual(d5(r), [])
})
