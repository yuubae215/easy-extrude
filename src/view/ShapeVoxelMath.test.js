import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  voxelCells, shatterFrame, shatterDelay, cellProgress, scatterOffset, cellHash,
  VOXEL_BUDGET, SHATTER_SPREAD,
} from './ShapeVoxelMath.js'

// The Zone of the walk the stakeholder watched: a 4 m × 0.6 m lane on the floor (mm).
const lane = (k = 1) => ({
  kind: 'surface', faceUp: true,
  polygons: [[{ x: 0, y: 0, z: 0 }, { x: 4000 * k, y: 0, z: 0 }, { x: 4000 * k, y: 600 * k, z: 0 }, { x: 0, y: 600 * k, z: 0 }]],
})
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

test('a long Zone is cut into many small cells, not a few big blocks (2026-10-19 "coarse")', () => {
  const cut = voxelCells(lane())
  // The old cloud: 40 voxels of radius × 0.11 for every entity.
  const oldEdge = (Math.hypot(4000, 600) / 2) * 0.11
  assert.ok(cut.cells.length >= 400, `${cut.cells.length} cells`)
  assert.ok(cut.cells.length <= VOXEL_BUDGET.surface * 1.2)
  assert.ok(cut.pitch < oldEdge / 3, `pitch ${cut.pitch} vs old edge ${oldEdge}`)
})

test('the cut is the same picture in mm and in m (原則 #27)', () => {
  const mm = voxelCells(lane(1)), m = voxelCells(lane(0.001))
  assert.equal(mm.cells.length, m.cells.length)
  assert.ok(Math.abs(mm.pitch / m.pitch - 1000) < 1e-6)
})

test('every cell lies on the shape, and the cells cover all of it — nothing gathers at a point', () => {
  const cut = voxelCells(lane())
  for (const c of cut.cells) {
    assert.ok(c.p.x > 0 && c.p.x < 4000 && c.p.y > 0 && c.p.y < 600, 'inside the polygon')
    assert.ok(c.p.z > 0, 'a floor sheet faces up — the cells sit on top of it')
  }
  // The landed cloud reaches the shape's ends (the old materialize ended within 0.1 × maxDist of the centre).
  const far = Math.max(...cut.cells.map(c => dist(c.p, cut.center)))
  assert.ok(far > 0.9 * cut.reach, `${far} vs reach ${cut.reach}`)
})

test('a box is cut from its 6 faces, each cell on the outside of its face', () => {
  const h = 50
  const c = [
    { x: h, y: -h, z: -h }, { x: h, y: h, z: -h }, { x: -h, y: h, z: -h }, { x: -h, y: -h, z: -h },
    { x: h, y: -h, z: h }, { x: h, y: h, z: h }, { x: -h, y: h, z: h }, { x: -h, y: -h, z: h },
  ]
  const faces = [[1, 2, 6, 5], [0, 4, 7, 3], [4, 5, 6, 7], [1, 0, 3, 2], [2, 3, 7, 6], [1, 5, 4, 0]]
  const cut = voxelCells({ kind: 'surface', polygons: faces.map(f => f.map(i => c[i])) })
  for (const cell of cut.cells) {
    const out = Math.max(Math.abs(cell.p.x), Math.abs(cell.p.y), Math.abs(cell.p.z))
    assert.ok(out > h, 'outside the box (outward normals)')
    assert.ok(Math.abs(cell.n.x) + Math.abs(cell.n.y) + Math.abs(cell.n.z) > 0.99)
  }
  const tops = cut.cells.filter(cell => cell.n.z > 0.9).length
  const fronts = cut.cells.filter(cell => cell.n.x > 0.9).length
  assert.ok(tops > 0 && tops === fronts, 'equal faces get equal cells')
})

test('a path is cut along its length; a shape with no extent is silent (#11)', () => {
  const path = voxelCells({ kind: 'path', points: [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, { x: 1000, y: 1000, z: 0 }] })
  assert.ok(Math.abs(path.cells.length - VOXEL_BUDGET.path) <= 2)
  assert.equal(voxelCells({ kind: 'path', points: [{ x: 1, y: 1, z: 1 }] }), null)
  assert.equal(voxelCells({ kind: 'surface', polygons: [] }), null)
  assert.equal(voxelCells(null), null)
  assert.throws(() => voxelCells({ kind: 'blob' }), /undeclared shape kind/)
})

test('materialize: every cell flies to its OWN place, lands square, and never overshoots (no spring)', () => {
  let maxSize = 0, lastTravel = Infinity
  for (let i = 0; i <= 100; i++) {
    const f = shatterFrame('materialize', i / 100)
    assert.ok(f.travel <= lastTravel + 1e-12, 'travel only shrinks — it arrives, it does not converge past')
    lastTravel = f.travel
    maxSize = Math.max(maxSize, f.size)
  }
  assert.ok(maxSize <= 1 + 1e-12, `size peaked at ${maxSize} — outBack would exceed 1`)
  const landed = shatterFrame('materialize', 0.68)
  assert.equal(landed.travel, 0)
  assert.equal(landed.spin, 0, 'lands square in the grid')
  assert.equal(shatterFrame('materialize', 1).size, 0, 'then melts into the surface')
  // Position is `land` (outExpo): well past half-way at a quarter of the flight — a line would be at 0.25.
  assert.ok(1 - shatterFrame('materialize', 0.17).travel > 0.75)
})

test('dissolve: the entity breaks where it stands, then its cells leave on `exit`', () => {
  const f0 = shatterFrame('dissolve', 0)
  assert.equal(f0.travel, 0)
  assert.equal(f0.size, 1)
  assert.equal(f0.flash, 1, 'the crack lights toward the stage light')
  // exit (inCubic) holds then goes: at the midpoint the cell is still mostly there.
  assert.ok(shatterFrame('dissolve', 0.5).size > 0.8)
  assert.equal(shatterFrame('dissolve', 1).size, 0)
  assert.ok(shatterFrame('dissolve', 0.5).travel > 0.9, 'position on land (outExpo)')
})

test('reduced motion holds every cell in place at half size, at every progress (#30)', () => {
  for (const kind of ['dissolve', 'materialize']) {
    for (const p of [0, 0.3, 0.9]) assert.deepEqual(shatterFrame(kind, p, true), { travel: 0, size: 0.5, spin: 0, flash: 0 })
  }
  assert.throws(() => shatterFrame('pulse', 0.5), /undeclared kind/)
})

test('the wave runs out from the centre, roughened, inside the spread (motion identity: by distance)', () => {
  const cut = voxelCells(lane())
  const delays = cut.cells.map((c, i) => shatterDelay(c, cut.center, cut.reach, i))
  for (const d of delays) assert.ok(d >= 0 && d <= SHATTER_SPREAD)
  const byDist = cut.cells.map((c, i) => [dist(c.p, cut.center), delays[i]]).sort((a, b) => a[0] - b[0])
  const third = Math.floor(byDist.length / 3)
  const mean = xs => xs.reduce((s, [, d]) => s + d, 0) / xs.length
  assert.ok(mean(byDist.slice(0, third)) < mean(byDist.slice(-third)), 'near cells go first')
  assert.ok(new Set(delays.map(d => d.toFixed(6))).size > delays.length * 0.9, 'not in lockstep')
  assert.equal(cellProgress(1, SHATTER_SPREAD), 1, 'the latest cell lands by global 1')
})

test('cells leave off their own face and away from the centre, each by its own amount', () => {
  const cut = voxelCells(lane())
  const offs = cut.cells.map((c, i) => scatterOffset(c, cut.center, cut.reach, cut.pitch, i))
  const up = offs.filter(o => o.z > 0).length
  assert.ok(up > offs.length * 0.8, 'a floor sheet breaks upward')
  const lens = offs.map(o => Math.hypot(o.x, o.y, o.z))
  assert.ok(Math.max(...lens) > 1.3 * Math.min(...lens), 'not a shell')
  assert.equal(cellHash(7, 2), cellHash(7, 2), 'replay-identical')
})
