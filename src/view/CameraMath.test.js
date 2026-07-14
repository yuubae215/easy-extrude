import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusPose, lerpVec } from './CameraMath.js'

const C0 = { x: 0, y: 0, z: 0 }

// ── focusPose: fits the sphere at the right distance, keeps the direction ────

test('focusPose sits `dist` from centre along the given direction', () => {
  const dir = { x: 1, y: -0.7, z: 0.5 }
  const p = focusPose(C0, 5, dir, 50)
  const d = Math.hypot(p.position.x, p.position.y, p.position.z)
  assert.ok(Math.abs(d - p.dist) < 1e-9, 'camera distance equals dist')
  // dist = radius / sin(fov/2) * 1.3
  const expect = 5 / Math.sin(25 * Math.PI / 180) * 1.3
  assert.ok(Math.abs(p.dist - expect) < 1e-6)
  // position is parallel to dir
  const len = Math.hypot(dir.x, dir.y, dir.z)
  assert.ok(Math.abs(p.position.x / p.dist - dir.x / len) < 1e-9)
})

test('focusPose targets the sphere centre and offsets a non-origin centre', () => {
  const center = { x: 10, y: -4, z: 2 }
  const p = focusPose(center, 3, { x: 0, y: -1, z: 0 }, 50)
  assert.deepEqual(p.target, center)
  const d = Math.hypot(p.position.x - center.x, p.position.y - center.y, p.position.z - center.z)
  assert.ok(Math.abs(d - p.dist) < 1e-9, 'distance is measured from the centre, not origin')
})

test('focusPose falls back to a 3/4 view for a zero-length direction', () => {
  const p = focusPose(C0, 2, { x: 0, y: 0, z: 0 }, 50)
  assert.ok(Number.isFinite(p.position.x) && p.position.x > 0)
  assert.ok(p.position.z > 0, 'fallback lifts the camera above the plane')
})

test('focusPose clamps a degenerate (zero) radius without NaN', () => {
  const p = focusPose(C0, 0, { x: 1, y: 0, z: 0 }, 50)
  assert.ok(Number.isFinite(p.dist) && p.dist > 0)
})

// ── lerpVec: identity at the endpoints (the flight lands exactly) ────────────

test('lerpVec is exact at e=0 and e=1 (flight lands on the end pose)', () => {
  const a = { x: 1, y: 2, z: 3 }, b = { x: -4, y: 5, z: 9 }
  assert.deepEqual(lerpVec(a, b, 0), a)
  assert.deepEqual(lerpVec(a, b, 1), b)
  assert.deepEqual(lerpVec(a, b, 0.5), { x: -1.5, y: 3.5, z: 6 })
})
