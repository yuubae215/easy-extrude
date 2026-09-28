/**
 * hollowBody.test.js — a tray is ONE body (outer + inner), its shell is derived
 * once, and W/D/H name the local axes with W ≥ D as a tray's normal form (ADR-155).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DIMENSION_WORDS, SHELL_ROLES, hollowBodyGap, trayNormalFormGap,
  shellParts, shellCornerSets, sizeInWords,
} from './hollowBody.js'

const BIN_OUT = { x: 200, y: 150, z: 150 }
const BIN_IN  = { x: 184, y: 134, z: 140 }

test('W/D/H name +x / +y / +z, in that order — one table (ADR-155 D4)', () => {
  assert.deepEqual(DIMENSION_WORDS.map(d => `${d.word}${d.axis}`), ['Wx', 'Dy', 'Hz'])
  assert.equal(sizeInWords(BIN_OUT), 'W 200 × D 150 × H 150')
})

test('thicknesses are derived: walls (outer − inner)/2, floor outer.H − inner.H', () => {
  const parts = shellParts(BIN_OUT, BIN_IN)
  assert.deepEqual(parts.map(p => p.role), SHELL_ROLES)
  const [floor, wxn, , wyn] = parts
  assert.equal(floor.half.z * 2, 10)
  assert.equal(wxn.half.x * 2, 8)
  assert.equal(wyn.half.y * 2, 8)
  // floor bottom = body bottom; walls stand on the floor up to the rim.
  assert.equal(floor.center.z - floor.half.z, -75)
  assert.equal(wxn.center.z - wxn.half.z, -65)
  assert.equal(wxn.center.z + wxn.half.z, 75)
})

test('the cavity is empty and the parts do not overlap', () => {
  const parts = shellParts(BIN_OUT, BIN_IN)
  const cavityCenter = { x: 0, y: 0, z: -75 + 10 + 70 }
  const inside = (p, q) => ['x', 'y', 'z'].every(a => Math.abs(q[a] - p.center[a]) < p.half[a] - 1e-9)
  for (const p of parts) assert.ok(!inside(p, cavityCenter), `${p.role} fills the cavity`)
  const overlap = (p, q) => ['x', 'y', 'z'].every(a => Math.abs(p.center[a] - q.center[a]) < p.half[a] + q.half[a] - 1e-9)
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) assert.ok(!overlap(parts[i], parts[j]), `${parts[i].role} × ${parts[j].role}`)
  }
  // Volume of the shell = outer − cavity (nothing counted twice, nothing missing).
  const vol = p => 8 * p.half.x * p.half.y * p.half.z
  const shell = parts.reduce((s, p) => s + vol(p), 0)
  assert.equal(shell, 200 * 150 * 150 - 184 * 134 * 140)
})

test('hollowBodyGap: inner must be > 0 and strictly inside outer on every axis', () => {
  assert.equal(hollowBodyGap(BIN_OUT, BIN_IN), null)
  assert.match(hollowBodyGap(BIN_OUT, { ...BIN_IN, x: 200 }), /inner W/)
  assert.match(hollowBodyGap(BIN_OUT, { ...BIN_IN, y: 151 }), /inner D/)
  assert.match(hollowBodyGap(BIN_OUT, { ...BIN_IN, z: 150 }), /inner H/)
  assert.match(hollowBodyGap(BIN_OUT, { ...BIN_IN, z: 0 }), /inner H must be > 0/)
  assert.throws(() => shellParts(BIN_OUT, { ...BIN_IN, x: 200 }), /hollowBody/)
})

test('trayNormalFormGap: W ≥ D, a square is legitimate', () => {
  assert.equal(trayNormalFormGap(BIN_OUT), null)
  assert.equal(trayNormalFormGap({ x: 100, y: 100, z: 10 }), null)
  assert.match(trayNormalFormGap({ x: 150, y: 200, z: 150 }), /W ≥ D/)
})

test('shellCornerSets: the shell rides the outer corners — moved and turned alike', () => {
  const box = (o, c, q = null) => {
    // outer corners in the Solid order, optionally turned 90° about z, then moved to c
    const h = { x: o.x / 2, y: o.y / 2, z: o.z / 2 }
    const local = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
      .map(([a, b, d]) => ({ x: a * h.x, y: b * h.y, z: d * h.z }))
    return local.map(p => (q ? { x: -p.y, y: p.x, z: p.z } : p)).map(p => ({ x: p.x + c.x, y: p.y + c.y, z: p.z + c.z }))
  }
  const sets = shellCornerSets(box(BIN_OUT, { x: 0, y: 0, z: 0 }), BIN_OUT, BIN_IN)
  const parts = shellParts(BIN_OUT, BIN_IN)
  assert.equal(sets.length, 5)
  for (const [i, set] of sets.entries()) {
    assert.equal(set.length, 8)
    const p = parts[i]
    assert.deepEqual(set[0], { x: p.center.x - p.half.x, y: p.center.y - p.half.y, z: p.center.z - p.half.z })
    assert.deepEqual(set[6], { x: p.center.x + p.half.x, y: p.center.y + p.half.y, z: p.center.z + p.half.z })
  }
  // Turned 90° about z and moved: the −x wall ends up on world −y.
  const turned = shellCornerSets(box(BIN_OUT, { x: 500, y: 0, z: 0 }, 'z90'), BIN_OUT, BIN_IN)
  const wxn = turned[1]
  const cy = wxn.reduce((s, c) => s + c.y, 0) / 8
  const cx = wxn.reduce((s, c) => s + c.x, 0) / 8
  assert.ok(Math.abs(cx - 500) < 1e-9 && Math.abs(cy - -96) < 1e-9, `got (${cx}, ${cy})`)
})
