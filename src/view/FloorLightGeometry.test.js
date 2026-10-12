import { test } from 'node:test'
import assert from 'node:assert/strict'
import { edgeBand, lightCurtain } from './FloorLightGeometry.js'

/**
 * The two shapes of the floor light (ADR-166 M3). What is asked: the light
 * fades in the right direction (inward on the floor, upward in the air), it
 * stays inside the shape it annotates, and its size comes from the caller —
 * never from a constant here (#27).
 */

const square = [
  { x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 },
  { x: 1, y: 1, z: 0 },   { x: -1, y: 1, z: 0 },
]

test('edgeBand: the outer ring is lit, the inner ring is dark — light fades inward', () => {
  const b = edgeBand(square, 0.78)
  assert.equal(b.positions.length, square.length * 2 * 3)
  for (let i = 0; i < square.length; i++) {
    assert.equal(b.shade[i * 6], 1, `outer vertex ${i} must be lit`)
    assert.equal(b.shade[i * 6 + 3], 0, `inner vertex ${i} must be dark`)
    // inner vertex is the outer one scaled toward the centroid
    assert.ok(Math.abs(b.positions[i * 6 + 3] - square[i].x * 0.78) < 1e-6)
  }
  assert.equal(b.index.length, square.length * 6, 'one quad per edge, including the closing edge')
  for (const k of b.index) assert.ok(k < square.length * 2, 'index out of range')
})

test('edgeBand degrades to empty geometry rather than throwing', () => {
  for (const [pts, inset] of [[square.slice(0, 2), 0.78], [square, 0], [square, 1], [null, 0.5]]) {
    const b = edgeBand(pts, inset)
    assert.equal(b.positions.length, 0)
    assert.equal(b.index.length, 0)
  }
})

test('lightCurtain: floor lit, top dark, top exactly `height` above the floor', () => {
  const c = lightCurtain(square, true, 0.3)
  const m = square.length + 1                       // closed: first vertex repeated
  assert.equal(c.positions.length, m * 2 * 3)
  for (let i = 0; i < m; i++) {
    assert.equal(c.shade[i * 6], 1, 'floor vertex must be lit')
    assert.equal(c.shade[i * 6 + 3], 0, 'top vertex must be dark — the light fades upward')
    assert.ok(Math.abs(c.positions[i * 6 + 5] - c.positions[i * 6 + 2] - 0.3) < 1e-6)
  }
  assert.equal(c.index.length, (m - 1) * 6)
})

test('lightCurtain arc fractions run 0 → 1 monotonically (the crest has somewhere to travel)', () => {
  const closed = lightCurtain(square, true, 0.1)
  assert.equal(closed.arcs[0], 0)
  assert.ok(Math.abs(closed.arcs[closed.arcs.length - 1] - 1) < 1e-6)
  for (let i = 1; i < closed.arcs.length; i++) assert.ok(closed.arcs[i] > closed.arcs[i - 1])
  const open = lightCurtain(square, false, 0.1)
  assert.equal(open.arcs.length, square.length)
  assert.ok(Math.abs(open.arcs[open.arcs.length - 1] - 1) < 1e-6)
})

test("lightCurtain size is the caller's: it scales with the height it is given (#27)", () => {
  const mm = [{ x: 0, y: 0, z: 0 }, { x: 2800, y: 0, z: 0 }]
  const c = lightCurtain(mm, false, 2800 * 0.04)
  assert.ok(Math.abs(c.positions[5] - 112) < 1e-3)
})

test('lightCurtain degrades to empty geometry rather than throwing', () => {
  const same = [{ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }]
  for (const [pts, h] of [[same, 1], [square, 0], [[square[0]], 1], [undefined, 1]]) {
    const c = lightCurtain(pts, false, h)
    assert.equal(c.positions.length, 0)
    assert.equal(c.arcs.length, 0)
  }
})
