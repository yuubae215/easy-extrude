/**
 * The pure rules behind the render-style swap (`domain/robotVisualStyle.js`).
 *
 * WHY THESE LIVE IN A PURE MODULE AT ALL: `RobotStage.setRenderStyle` cannot
 * be exercised by any `node --test` lane — it needs THREE and a `DOMParser`
 * for `URDFLoader.parse`. So every line of the async swap shipped with zero
 * coverage, and two defects lived there undetected until they were reproduced
 * in a browser (ADR-148). The decisions that do NOT need a browser are pulled
 * out here so the lane that runs on every commit can hold them.
 *
 * What this file deliberately CANNOT see, stated rather than implied: the
 * write itself (material re-cloning, pose carry-over, group attachment) and
 * the set-level adoption on `sync()`. Those are pinned in
 * `e2e/robot-appearance.spec.js`, the only lane that can construct a stage.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ROBOT_RENDER_STYLE, assertRenderStyle, settledStyle, isRedundantStyleRequest,
} from './robotVisualStyle.js'

const { SKELETON, REALISTIC } = ROBOT_RENDER_STYLE

test('the vocabulary is exactly the two geometries this app ships', () => {
  assert.deepEqual(Object.values(ROBOT_RENDER_STYLE), ['skeleton', 'realistic'])
})

test('an undeclared style throws — it does not fall through to the default', () => {
  // The shape this exists to stop: `style === REALISTIC ? … : skeleton` drew
  // the SKELETON for a typo and then RECORDED the typo as the stage's style,
  // so "the declared default" and "a kind nobody thought about" became
  // indistinguishable (原則 #31).
  for (const bogus of ['realstic', 'Realistic', '', null, undefined, 0, {}]) {
    assert.throws(() => assertRenderStyle(bogus), /undeclared render style/,
      `${JSON.stringify(bogus)} must throw, not silently mean "skeleton"`)
  }
})

test('a declared style passes through unchanged', () => {
  assert.equal(assertRenderStyle(SKELETON), SKELETON)
  assert.equal(assertRenderStyle(REALISTIC), REALISTIC)
})

test('the settled style is the pending one while a load is in flight', () => {
  assert.equal(settledStyle(SKELETON, null), SKELETON)       // nothing in flight
  assert.equal(settledStyle(SKELETON, REALISTIC), REALISTIC) // heading for realistic
  assert.equal(settledStyle(REALISTIC, SKELETON), SKELETON)  // heading back
})

test('with nothing in flight, redundancy is just "already showing it"', () => {
  assert.equal(isRedundantStyleRequest(SKELETON, SKELETON, null), true)
  assert.equal(isRedundantStyleRequest(REALISTIC, SKELETON, null), false)
})

test('THE REGRESSION: the request that cancels an in-flight load is NOT redundant', () => {
  // skeleton drawn, realistic in the air, and now someone asks for skeleton
  // again. Comparing against the DRAWN style calls this redundant and returns
  // early — without bumping the supersession token — so the realistic load
  // lands and the request that fired LAST loses. Reproduced in a browser
  // before the fix: last request 'skeleton', final state ["realistic"].
  assert.equal(isRedundantStyleRequest(SKELETON, SKELETON, REALISTIC), false)
  // …and the mirror: asking again for the style already in flight IS redundant.
  assert.equal(isRedundantStyleRequest(REALISTIC, SKELETON, REALISTIC), true)
})

test('the same request twice in a row settles on the second one, both orders', () => {
  // Two requests is the smallest number that can tell the two readings apart —
  // at one request per check they agree, which is why a single-switch check
  // was green over this defect (/whiteboard §5, ADR-098→101 の先例).
  for (const [a, b] of [[REALISTIC, SKELETON], [SKELETON, REALISTIC]]) {
    let committed = a === REALISTIC ? SKELETON : REALISTIC
    let pending = null
    for (const requested of [a, b]) {
      if (isRedundantStyleRequest(requested, committed, pending)) continue
      pending = requested          // a load starts; nothing commits yet
    }
    assert.equal(settledStyle(committed, pending), b,
      `after requesting ${a} then ${b}, the stage must be heading for ${b}`)
  }
})
