import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ShadowCasterWatch } from './ShadowCasterWatch.js'

const caster = (geometry = {}) => ({ castShadow: true, geometry, matrixWorld: { elements: new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)) } })
const overlay = () => ({ castShadow: false, geometry: {}, matrixWorld: { elements: new Array(16).fill(0) } })

test('a still scene does not redraw the shadow after the first frame', () => {
  const w = new ShadowCasterWatch()
  const a = caster(), b = caster(), o = overlay()
  assert.equal(w.changed([a, b, o]), true, 'first frame draws')
  for (let i = 0; i < 5; i++) assert.equal(w.changed([a, b, o]), false)
})

test('a caster that moves, changes shape, appears or disappears redraws it', () => {
  const w = new ShadowCasterWatch()
  const a = caster(), b = caster()
  w.changed([a, b])
  a.matrixWorld.elements[12] = 5
  assert.equal(w.changed([a, b]), true, 'moved')
  assert.equal(w.changed([a, b]), false)
  b.geometry = {}
  assert.equal(w.changed([a, b]), true, 'new geometry')
  assert.equal(w.changed([a]), true, 'b hidden')
  assert.equal(w.changed([a]), false)
  assert.equal(w.changed([a, b]), true, 'b shown again')
})

test('what does not cast never redraws it (camera, hover, glow live elsewhere)', () => {
  const w = new ShadowCasterWatch()
  const a = caster(), o = overlay()
  w.changed([a, o])
  o.matrixWorld.elements[12] = 9
  assert.equal(w.changed([a, o]), false)
  assert.equal(w.changed([a]), false, 'an overlay leaving is not a caster leaving')
  w.invalidate()
  assert.equal(w.changed([a]), true)
})
