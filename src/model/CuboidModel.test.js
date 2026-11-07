/**
 * A new default solid is born resting on the ground plane (Z=0).
 *
 * Where a new solid stands has ONE writer: `createInitialCorners`. It used to
 * be born centred on the origin (half below grade) and lifted afterwards by
 * the boot starter only — the lift ran after `objectAdded` had anchored the
 * lifecycle voxels, so on the Empty template they converged a half-extent
 * below the cube, and an Add-menu cube stayed half underground until the
 * `grounded` floor clamp (ADR-097) popped it up on the first grab.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createInitialCorners, DEFAULT_HALF_EXTENT, getCentroid } from './CuboidModel.js'

test('the default cube rests on the ground plane: bottom Z = 0, top Z = full extent', () => {
  const corners = createInitialCorners()
  const zs = corners.map(c => c.z)
  assert.equal(Math.min(...zs), 0)
  assert.equal(Math.max(...zs), 2 * DEFAULT_HALF_EXTENT)
  const c = getCentroid(corners)
  assert.deepEqual([c.x, c.y, c.z], [0, 0, DEFAULT_HALF_EXTENT])
})

test('corner ordering is unchanged: 0-3 bottom, 4-7 top', () => {
  const corners = createInitialCorners()
  for (let i = 0; i < 4; i++) assert.equal(corners[i].z, 0)
  for (let i = 4; i < 8; i++) assert.equal(corners[i].z, 2 * DEFAULT_HALF_EXTENT)
})

test('the starter scene does not move the cube after it is added (no second writer of its pose)', () => {
  const src = readFileSync(new URL('../controller/AppController.js', import.meta.url), 'utf8')
  const start = src.indexOf('  _seedStarterScene() {')
  assert.ok(start >= 0, '_seedStarterScene not found')
  const body = src.slice(start, src.indexOf('\n  }\n', start))
  assert.doesNotMatch(body, /setPose|_restStarterCube/,
    'a pose write after _addObject() moves the cube away from where objectAdded anchored its voxels')
})
