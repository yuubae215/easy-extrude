/**
 * arrangementGeometry — the STATE of a relation, read from poses (ADR-168 D4).
 * Numbers are the single-arm pick & place template's (examples/layout_pick_place_cell.json).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  observeContact, observeVertical, observeRelative,
  CONTACT_TOLERANCE_MM, OBSERVED_CONTACT,
} from './arrangementGeometry.js'

const box = (center, size, extra = {}) => ({ center, size, ...extra })
const workbench = box({ x: 0, y: 0, z: 400 }, { x: 600, y: 500, z: 800 })
const bin = box({ x: 200, y: 150, z: 875 }, { x: 200, y: 150, z: 150 }, { inner: { x: 184, y: 134, z: 140 } })
const work1 = box({ x: 150, y: 115, z: 822.5 }, { x: 60, y: 40, z: 25 })
// 30° about Z, as the template's Workpiece 3.
const rot30 = { x: 0, y: 0, z: 0.258819, w: 0.965926 }

test('a bin standing on the workbench touches its +z face', () => {
  const r = observeContact(bin, workbench)
  assert.equal(r.contact, OBSERVED_CONTACT.TOUCHING)
  assert.deepEqual(r.faces, ['+z'])
})

test('the workbench is under the bin: from its side the bin is touched on -z', () => {
  const r = observeContact(workbench, bin)
  assert.equal(r.contact, OBSERVED_CONTACT.TOUCHING)
  assert.deepEqual(r.faces, ['-z'])
})

test('a workpiece in a bin touches the INNER floor (the shell, not the outer box) on +z', () => {
  const r = observeContact(work1, bin)
  assert.equal(r.contact, OBSERVED_CONTACT.TOUCHING)
  assert.deepEqual(r.faces, ['+z'])
})

test('the same workpiece against a SOLID box of the bin\'s size overlaps — the cavity is what makes it touching', () => {
  const solidBin = { ...bin, inner: null }
  assert.equal(observeContact(work1, solidBin).contact, OBSERVED_CONTACT.OVERLAPPING)
})

test('a rotated workpiece (30°) on the inner floor still touches +z', () => {
  const work3 = box({ x: 240, y: 125, z: 822.5 }, { x: 60, y: 40, z: 25 }, { rotation: rot30 })
  assert.equal(observeContact(work3, bin).contact, OBSERVED_CONTACT.TOUCHING)
  assert.ok(observeContact(work3, bin).faces.includes('+z'))
})

test('lifted by more than the tolerance it is apart, with the gap as a lower bound', () => {
  const lifted = { ...bin, center: { ...bin.center, z: bin.center.z + 50 } }
  const r = observeContact(lifted, workbench)
  assert.equal(r.contact, OBSERVED_CONTACT.APART)
  assert.equal(r.gap, 50)
  assert.deepEqual(r.faces, [])
})

test('within the tolerance it still touches; just outside it does not', () => {
  const at = (dz) => observeContact({ ...bin, center: { ...bin.center, z: bin.center.z + dz } }, workbench).contact
  assert.equal(at(CONTACT_TOLERANCE_MM * 0.9), OBSERVED_CONTACT.TOUCHING)
  assert.equal(at(CONTACT_TOLERANCE_MM * 1.1), OBSERVED_CONTACT.APART)
})

test('side by side, touching reads the side face', () => {
  const a = box({ x: 0, y: 0, z: 50 }, { x: 100, y: 100, z: 100 })
  const b = box({ x: 100, y: 0, z: 50 }, { x: 100, y: 100, z: 100 })
  assert.deepEqual(observeContact(b, a).faces, ['+x'])
  assert.deepEqual(observeContact(a, b).faces, ['-x'])
})

test('the partner\'s rotation decides which face is which (intrinsic frame)', () => {
  // The partner turned 90° about Z: its +x now points to world +y.
  const q90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
  const partner = box({ x: 0, y: 0, z: 50 }, { x: 100, y: 100, z: 100 }, { rotation: q90 })
  const north = box({ x: 0, y: 100, z: 50 }, { x: 100, y: 100, z: 100 })
  assert.deepEqual(observeContact(north, partner).faces, ['+x'])
})

test('vertical is read in the world: above, below, or neither', () => {
  const high = box({ x: 0, y: 0, z: 1500 }, { x: 100, y: 100, z: 100 })
  assert.equal(observeVertical(high, workbench), 'above')
  assert.equal(observeVertical(workbench, high), 'below')
  assert.equal(observeVertical(bin, workbench), null, 'touching is not "above" — the two words are two facts')
})

test('relative directions are the viewer\'s: turning the viewer round swaps left and right, front and back', () => {
  const a = box({ x: 0, y: 500, z: 50 }, { x: 100, y: 100, z: 100 })
  const b = box({ x: 0, y: 0, z: 50 }, { x: 100, y: 100, z: 100 })
  const facingPlusX = { position: { x: -2000, y: 0, z: 1600 } }
  const turned = { position: { x: 2000, y: 0, z: 1600 }, rotation: { x: 0, y: 0, z: 1, w: 0 } }
  assert.deepEqual(observeRelative(a, b, facingPlusX), ['left'])
  assert.deepEqual(observeRelative(a, b, turned), ['right'])

  const near = box({ x: -500, y: 0, z: 50 }, { x: 100, y: 100, z: 100 })
  assert.deepEqual(observeRelative(near, b, facingPlusX), ['front'])
  assert.deepEqual(observeRelative(near, b, turned), ['back'])
})

test('several relative directions can hold at once, and none inside the dead band', () => {
  const b = box({ x: 0, y: 0, z: 50 }, { x: 100, y: 100, z: 100 })
  const diag = box({ x: -300, y: 300, z: 50 }, { x: 100, y: 100, z: 100 })
  const viewer = { position: { x: -2000, y: 0, z: 1600 } }
  assert.deepEqual(observeRelative(diag, b, viewer), ['front', 'left'])
  assert.deepEqual(observeRelative(b, b, viewer), [])
})
