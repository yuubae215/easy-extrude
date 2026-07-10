import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MotionGovernor } from './MotionGovernor.js'

/** Fake transient effect: finishes at `doneAt` seconds; records disposal. */
function fakeFx(doneAt = Infinity) {
  return {
    doneAt,
    disposed: false,
    reduced: null,
    tick(t) { return t >= this.doneAt },
    dispose() { this.disposed = true },
  }
}

test('spawn hands the reduced-motion preference to the factory (single boundary)', () => {
  let pref = false
  const gov = new MotionGovernor({ reduced: () => pref })
  const a = gov.spawn(reduced => Object.assign(fakeFx(), { reduced }))
  pref = true
  const b = gov.spawn(reduced => Object.assign(fakeFx(), { reduced }))
  assert.equal(a.reduced, false)
  assert.equal(b.reduced, true, 'a mid-session flip affects the next spawn')
})

test('default preference read is safe in a non-browser environment (false = motion allowed)', () => {
  const gov = new MotionGovernor()
  const fx = gov.spawn(reduced => Object.assign(fakeFx(), { reduced }))
  assert.equal(fx.reduced, false)
})

test('tick prunes finished effects and disposes them (#9 symmetry)', () => {
  const gov = new MotionGovernor({ reduced: () => false })
  const early = gov.spawn(() => fakeFx(1))
  const late = gov.spawn(() => fakeFx(5))
  gov.tick(0.5)
  assert.equal(gov.count, 2)
  gov.tick(2)
  assert.equal(gov.count, 1)
  assert.equal(early.disposed, true)
  assert.equal(late.disposed, false)
  gov.tick(6)
  assert.equal(gov.count, 0)
  assert.equal(late.disposed, true)
})

test('budget evicts the OLDEST effect with dispose (undo/redo mashing worst case)', () => {
  const gov = new MotionGovernor({ reduced: () => false })
  const all = []
  for (let i = 0; i < MotionGovernor.BUDGET + 3; i++) {
    all.push(gov.spawn(() => fakeFx()))
  }
  assert.equal(gov.count, MotionGovernor.BUDGET)
  assert.ok(all[0].disposed && all[1].disposed && all[2].disposed, 'oldest three evicted')
  assert.equal(all[3].disposed, false)
})

test('disposeAll disposes every live effect and empties the governor', () => {
  const gov = new MotionGovernor({ reduced: () => false })
  const a = gov.spawn(() => fakeFx())
  const b = gov.spawn(() => fakeFx())
  gov.disposeAll()
  assert.equal(gov.count, 0)
  assert.ok(a.disposed && b.disposed)
})
