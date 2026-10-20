import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PictureWatch } from './PictureWatch.js'

const I = () => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })
const camera = () => ({ matrixWorld: I(), projectionMatrix: I() })
const color = (r = 1, g = 1, b = 1) => ({ isColor: true, r, g, b })
const mesh = () => ({
  matrixWorld: I(),
  geometry: { attributes: { position: { version: 0, array: new Float32Array(9) }, big: { version: 0, array: new Float32Array(5000) } }, drawRange: { start: 0, count: Infinity } },
  material: { version: 0, opacity: 1, color: color(), uniforms: { time: { value: 0 } } },
})

test('a still picture is not drawn again (ADR-166 M7)', () => {
  const w = new PictureWatch(), cam = camera(), a = mesh(), b = mesh()
  assert.equal(w.changed(cam, [a, b]), true, 'first frame draws')
  for (let i = 0; i < 5; i++) assert.equal(w.changed(cam, [a, b]), false)
})

test('anything the renderer reads changes the picture — nothing has to declare that it animates', () => {
  const w = new PictureWatch(), cam = camera(), a = mesh(), b = mesh()
  const step = (what, mutate, drawn = [a, b], extra) => {
    mutate()
    assert.equal(w.changed(cam, drawn, extra), true, what)
    assert.equal(w.changed(cam, drawn, extra), false, `${what} — then still`)
  }
  w.changed(cam, [a, b])
  step('camera moved', () => { cam.matrixWorld.elements[12] = 1 })
  step('zoom (projection)', () => { cam.projectionMatrix.elements[0] = 2 })
  step('a body moved', () => { a.matrixWorld.elements[13] = 3 })
  step('a cue faded', () => { a.material.opacity = 0.5 })
  step('a cue recoloured', () => { b.material.color.g = 0.2 })
  step('a shader clock ticked', () => { a.material.uniforms.time.value = 1 })
  step('a line was rewritten in place', () => { b.geometry.attributes.position.array[4] = 2; b.geometry.attributes.position.version++ })
  step('a large mesh was rewritten', () => { b.geometry.attributes.big.version++ })
  step('a new shape', () => { a.geometry = mesh().geometry })
  step('a material swapped', () => { b.material = mesh().material })
  step('hidden', () => {}, [a])
  step('shown again', () => {}, [a, b])
  step('the canvas resized', () => {}, [a, b], [800, 600])
  step('the order changed', () => {}, [b, a], [800, 600])
})

test('a light coming on is a change in the picture', () => {
  const w = new PictureWatch(), cam = camera()
  const key = { isLight: true, intensity: 0, color: color(), matrixWorld: I() }
  w.changed(cam, [key])
  key.intensity = 2.8
  assert.equal(w.changed(cam, [key]), true)
})

test('float round-off is not a change (a still orbit camera re-derives itself every frame)', () => {
  const w = new PictureWatch(), cam = camera(), a = mesh()
  cam.matrixWorld.elements[12] = 2915.5441
  w.changed(cam, [a])
  cam.matrixWorld.elements[12] += 4.5e-13
  cam.matrixWorld.elements[0] -= 2.2e-16
  assert.equal(w.changed(cam, [a]), false)
  cam.matrixWorld.elements[12] += 0.01
  assert.equal(w.changed(cam, [a]), true, 'a hundredth of a unit is a move')
})

test('a small line rewritten with the same values is not a change (frame axes re-set every frame)', () => {
  const w = new PictureWatch(), cam = camera(), a = mesh()
  w.changed(cam, [a])
  a.geometry.attributes.position.version += 2
  assert.equal(w.changed(cam, [a]), false)
})

test('three bumping a material version while drawing is not a change (two-pass transparency)', () => {
  const w = new PictureWatch(), cam = camera(), a = mesh()
  w.changed(cam, [a])
  a.material.version += 2
  assert.equal(w.changed(cam, [a]), false)
  a.material.transparent = true
  assert.equal(w.changed(cam, [a]), true, 'becoming transparent is')
})
