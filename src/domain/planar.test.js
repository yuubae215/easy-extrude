/**
 * planar.test.js — the closed-form XY polygon geometry the place words stand on
 * (ADR-170 S3). Edge cases are the point: an edge shared is not an area shared.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pointInPolygonXY, signedAreaXY, convexHullXY, isConvexXY, convexOverlapAreaXY } from './planar.js'

const sq = (x0, y0, s) => [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }]

test('point in polygon: inside / outside', () => {
  assert.equal(pointInPolygonXY(5, 5, sq(0, 0, 10)), true)
  assert.equal(pointInPolygonXY(15, 5, sq(0, 0, 10)), false)
})

test('shoelace area is signed by orientation', () => {
  assert.equal(signedAreaXY(sq(0, 0, 10)), 100)
  assert.equal(signedAreaXY([...sq(0, 0, 10)].reverse()), -100)
})

test('hull of a box\'s 8 corners is its plan rectangle', () => {
  const corners = []
  for (const z of [0, 50]) for (const [x, y] of [[0, 0], [10, 0], [10, 20], [0, 20]]) corners.push({ x, y, z })
  const hull = convexHullXY(corners)
  assert.equal(hull.length, 4)
  assert.equal(Math.abs(signedAreaXY(hull)), 200)
})

test('convexity: a square is, an L is not, a flat ring is not', () => {
  assert.equal(isConvexXY(sq(0, 0, 10)), true)
  const L = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }]
  assert.equal(isConvexXY(L), false)
  assert.equal(isConvexXY([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]), false)
})

test('overlap area: partial, nested, identical, edge-only, apart, either orientation', () => {
  assert.equal(convexOverlapAreaXY(sq(0, 0, 10), sq(5, 5, 10)), 25)
  assert.equal(convexOverlapAreaXY(sq(0, 0, 10), sq(2, 2, 3)), 9)
  assert.equal(convexOverlapAreaXY(sq(0, 0, 10), sq(0, 0, 10)), 100)
  assert.equal(convexOverlapAreaXY(sq(0, 0, 10), sq(10, 0, 10)), 0)
  assert.equal(convexOverlapAreaXY(sq(0, 0, 10), sq(30, 0, 10)), 0)
  assert.equal(convexOverlapAreaXY([...sq(0, 0, 10)].reverse(), [...sq(5, 5, 10)].reverse()), 25)
})

test('a concave ring is refused, not clipped wrongly', () => {
  const L = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }]
  assert.throws(() => convexOverlapAreaXY(L, sq(0, 0, 5)), /convex/)
})
