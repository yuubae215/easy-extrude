import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectionAfterProjection } from './selectionAcrossProjection.js'

const reader = ({ live = [], doc = {}, scene = {} } = {}) => ({
  exists:        (id)  => live.includes(id),
  idForDocRef:   (ref) => doc[ref] ?? null,
  idForSceneRef: (ref) => scene[ref] ?? null,
})

test('an ordinary doc edit: same ids come back, the active one stays active', () => {
  const kept = { members: [{ id: 'a', ref: 'A' }, { id: 'b', ref: 'B' }], activeId: 'b' }
  assert.deepEqual(selectionAfterProjection(kept, reader({ live: ['a', 'b'] })), { ids: ['a', 'b'], activeId: 'b' })
})

test('an adoption re-created the object under its compiled id: found by its ref (ADR-159)', () => {
  const kept = { members: [{ id: 'obj_1', ref: 'cube' }], activeId: 'obj_1' }
  const next = selectionAfterProjection(kept, reader({ live: ['solid_cube'], doc: { cube: 'solid_cube' } }))
  assert.deepEqual(next, { ids: ['solid_cube'], activeId: 'solid_cube' })
})

test("the adoption's undo brought the screen original back: found by the scene's own reading", () => {
  const kept = { members: [{ id: 'solid_cube', ref: 'cube' }], activeId: 'solid_cube' }
  const next = selectionAfterProjection(kept, reader({ live: ['obj_1'], scene: { cube: 'obj_1' } }))
  assert.deepEqual(next, { ids: ['obj_1'], activeId: 'obj_1' })
})

test('an entity the edit removed is not guessed at; 0 survivors = nothing to restore', () => {
  const kept = { members: [{ id: 'a', ref: 'A' }, { id: 'gone', ref: 'G' }], activeId: 'gone' }
  assert.deepEqual(selectionAfterProjection(kept, reader({ live: ['a'] })), { ids: ['a'], activeId: 'a' })
  assert.equal(selectionAfterProjection({ members: [{ id: 'gone', ref: null }], activeId: 'gone' }, reader()), null)
  assert.equal(selectionAfterProjection(null, reader()), null)
  assert.equal(selectionAfterProjection({ members: [], activeId: null }, reader()), null)
})

test('a ref that resolves to an id no longer in the scene is not restored', () => {
  const kept = { members: [{ id: 'x', ref: 'X' }], activeId: 'x' }
  assert.equal(selectionAfterProjection(kept, reader({ doc: { X: 'stale' } })), null)
})
