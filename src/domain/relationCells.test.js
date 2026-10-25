/**
 * relationCells — the grid of contact × direction (ADR-168, 2026-10-25).
 * Whether every declarable cell can be realised on geometry is asked in
 * `src/context/SpatialExamples.test.js`, next to the dictionary laid onto it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RELATION_CELLS, UNSTATED, cellId, cellOfSide, sideOfCell, cellById, bothAxesSaid,
} from './relationCells.js'
import { CONTACTS, FACE_TOWARD, ABSOLUTE_TOWARD, RELATIVE_DIRS, arrangementIssues } from './arrangement.js'

const DIRECTIONS = [...FACE_TOWARD, ...ABSOLUTE_TOWARD, ...RELATIVE_DIRS]

test('the grid is the full product of the axes, each with "not said" — derived, so a new value adds its cells', () => {
  assert.equal(RELATION_CELLS.length, (CONTACTS.length + 1) * (DIRECTIONS.length + 1))
  assert.equal(new Set(RELATION_CELLS.map(c => c.id)).size, RELATION_CELLS.length, 'IDs are unique')
})

test('the ID is the cell\'s own values: contact:direction, "_" for not said', () => {
  assert.equal(cellId('touching', '+z'), 'touching:+z')
  assert.equal(cellId(undefined, 'above'), `${UNSTATED}:above`)
  assert.equal(cellId('apart', { dir: 'left', viewer: 'operator' }), 'apart:left', 'the viewer is a parameter, not a cell')
  assert.equal(cellId(undefined, undefined), '_:_')
  for (const c of RELATION_CELLS) assert.equal(c.id, `${c.contact}:${c.direction}`)
})

test('a side and its cell round-trip (up to the viewer)', () => {
  for (const c of RELATION_CELLS) assert.equal(cellOfSide(sideOfCell(c.id, 'v')), c.id)
})

test('the refused cells are exactly those the validator refuses, each with its reason — kept, not dropped', () => {
  const refused = RELATION_CELLS.filter(c => !c.declarable)
  assert.deepEqual(refused.map(c => c.id).sort(),
    ['touching:above', 'touching:back', 'touching:below', 'touching:front', 'touching:left', 'touching:right'])
  for (const c of refused) assert.match(c.reason, /touching, the direction is the partner's face/)
  for (const c of RELATION_CELLS.filter(x => x.declarable)) assert.equal(c.reason, null)
})

test('the grid agrees with the validator cell by cell (no second copy of the rule)', () => {
  const world = {
    actorRefs: new Set(['p']), solidRefs: new Set(['a', 'b']), kinematicLinks: [],
    viewers: new Map([['v', { position: { x: 0, y: 0, z: 0 } }]]),
  }
  for (const c of RELATION_CELLS) {
    const issues = arrangementIssues([{ ref: 'r', by: 'p', subject: 'a', sides: [{ of: 'b', ...sideOfCell(c.id, 'v') }] }], world)
    assert.equal(issues.length === 0, c.declarable, c.id)
  }
})

test('every declarable cell is sayable by words alone: each axis value it fixes has a word', async () => {
  const { canonicalKeyIn } = await import('../context/SynonymQuotient.js')
  for (const c of RELATION_CELLS.filter(x => x.declarable)) {
    for (const v of [c.contact, c.direction].filter(v => v !== UNSTATED)) {
      assert.equal(canonicalKeyIn(v, 'spatial'), v, `${c.id}: "${v}" has no word`)
    }
  }
})

test('bothAxesSaid separates the cells a combination may name', () => {
  assert.equal(bothAxesSaid(cellById('touching:+z')), true)
  assert.equal(bothAxesSaid(cellById('_:+z')), false)
  assert.equal(bothAxesSaid(cellById('touching:_')), false)
})

test('an ID outside the grid is an error, not an empty answer', () => {
  assert.throws(() => cellById('touching:up'), /not a cell of the grid/)
})
