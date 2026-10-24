/**
 * arrangement — the vocabulary of a relation (ADR-168 D1–D5): what can be said,
 * what cannot, who said it, and when two people disagree.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  arrangementIssues, claimConflicts, mobilityBetween, sideStatus, areOpposite, frameOfToward,
  AXIS_STATUS, MOBILITY,
} from './arrangement.js'

const viewerA = { ref: 'operator', type: 'CoordinateFrame', frameRole: 'viewer' }
const viewerB = { ref: 'reviewer', type: 'CoordinateFrame', frameRole: 'viewer' }
const world = (over = {}) => ({
  actorRefs: new Set(['ann', 'ben']),
  solidRefs: new Set(['work', 'bin', 'table', 'jawL', 'jawR']),
  viewers: new Map([['operator', viewerA], ['reviewer', viewerB]]),
  kinematicLinks: [],
  viewerGap: () => null,
  ...over,
})
const arr = (over = {}) => ({ ref: 'a1', by: 'ann', subject: 'work', sides: [{ of: 'bin' }], ...over })
const issues = (list, w = world()) => arrangementIssues(list, w)
const has = (errs, re) => assert.ok(errs.some(e => re.test(e)), `expected ${re} in:\n${errs.join('\n')}`)

test('a well-formed two-thing and a well-formed between say nothing wrong', () => {
  assert.deepEqual(issues([
    arr({ sides: [{ of: 'table', contact: 'touching', toward: '+z' }] }),
    arr({ ref: 'a2', subject: 'work', by: 'ben', sides: [
      { of: 'jawL', contact: 'touching', toward: '+y' },
      { of: 'jawR', contact: 'touching', toward: '-y' },
    ] }),
  ]), [])
})

test('every axis may be left undeclared — undeclared is a value, not an error', () => {
  assert.deepEqual(issues([arr()]), [])
})

test('D5: a claim names WHO claims it, and that actor exists', () => {
  has(issues([arr({ by: undefined })]), /by \(who claims it\) is required/)
  has(issues([arr({ by: 'nobody' })]), /by "nobody" does not reference any actor/)
})

test('subject and sides are Solids of the layout, never the subject itself', () => {
  has(issues([arr({ subject: 'ghost' })]), /subject "ghost" does not reference a Solid/)
  has(issues([arr({ sides: [{ of: 'work' }] })]), /of is the subject itself/)
})

test('sides: 0 is not a relation, 3 is not decided yet', () => {
  has(issues([arr({ sides: [] })]), /has 0 sides/)
  has(issues([arr({ sides: [{ of: 'bin' }, { of: 'table' }, { of: 'jawL' }] })]), /has 3 sides .* not decided yet/)
})

test('D1: a face is said only when touching; above/below and relative only when apart', () => {
  has(issues([arr({ sides: [{ of: 'bin', contact: 'apart', toward: '+z' }] })]), /a face \(\+z\) is said only of a thing touching it/)
  has(issues([arr({ sides: [{ of: 'bin', contact: 'touching', toward: 'above' }] })]), /touching, the direction is the partner's face/)
  has(issues([arr({ sides: [{ of: 'bin', contact: 'touching', toward: { dir: 'left', viewer: 'operator' } }] })]), /touching, the direction is the partner's face/)
})

test('words outside the vocabulary are refused, not guessed', () => {
  has(issues([arr({ sides: [{ of: 'bin', contact: 'on' }] })]), /contact "on" is not one of/)
  has(issues([arr({ sides: [{ of: 'bin', toward: 'on top' }] })]), /is not a face/)
  assert.throws(() => frameOfToward('on top'), /not a declarable direction/)
})

test('D2: front/back/left/right name a declared viewer — even when there is only one', () => {
  const oneViewer = world({ viewers: new Map([['operator', viewerA]]) })
  has(issues([arr({ sides: [{ of: 'bin', contact: 'apart', toward: { dir: 'left' } }] })], oneViewer), /needs the viewer it is seen from/)
  has(issues([arr({ sides: [{ of: 'bin', contact: 'apart', toward: { dir: 'left', viewer: 'camera1' } }] })]), /viewer "camera1" is not a CoordinateFrame with frameRole "viewer"/)
  const refused = world({ viewerGap: () => 'a viewer under a parent frame is not decided yet' })
  has(issues([arr({ sides: [{ of: 'bin', toward: { dir: 'left', viewer: 'operator' } }] })], refused), /not decided yet/)
})

test('D3: two sides must be opposite and both said — that is what "between" means', () => {
  const two = (a, b) => arr({ sides: [{ of: 'jawL', ...a }, { of: 'jawR', ...b }] })
  has(issues([two({ toward: '+y' }, { toward: '+y' })]), /are not opposite/)
  has(issues([two({ toward: '+y' }, {})]), /"between" needs both directions/)
  has(issues([two({ toward: { dir: 'left', viewer: 'operator' } }, { toward: { dir: 'right', viewer: 'reviewer' } })]), /are not opposite/)
  assert.deepEqual(issues([two({ contact: 'apart', toward: { dir: 'left', viewer: 'operator' } }, { contact: 'apart', toward: { dir: 'right', viewer: 'operator' } })]), [])
  has(issues([arr({ sides: [{ of: 'bin' }, { of: 'bin' }] })]), /appears on both sides/)
})

test('D5: one claim per person per pair — a second one would overwrite the first unsaid', () => {
  has(issues([arr(), arr({ ref: 'a2' })]), /"ann" already claims the relation of "work" to "bin"/)
  assert.deepEqual(issues([arr(), arr({ ref: 'a2', by: 'ben' })]), [], 'two people may each claim it')
  has(issues([arr(), arr()]), /ref is used twice/)
})

test('D1: mobility is LOOKED UP from the kinematic links — 0, 1 or a contradiction', () => {
  assert.deepEqual(mobilityBetween([], 'work', 'bin'), { kind: MOBILITY.UNDECLARED })
  assert.deepEqual(mobilityBetween([{ a: 'bin', b: 'work', jointType: 'fixed' }], 'work', 'bin'), { kind: MOBILITY.DECLARED, jointType: 'fixed' })
  const two = [{ a: 'work', b: 'bin', jointType: 'fixed' }, { a: 'bin', b: 'work', jointType: 'prismatic' }]
  assert.deepEqual(mobilityBetween(two, 'work', 'bin'), { kind: MOBILITY.CONTRADICTION, count: 2 })
  has(issues([arr()], world({ kinematicLinks: two })), /2 kinematic links join "work" and "bin"/)
})

test('claim conflicts: same pair, same axis, same frame of reference, different values', () => {
  const c = claimConflicts([
    arr({ ref: 'b', by: 'ben', sides: [{ of: 'bin', contact: 'apart' }] }),
    arr({ ref: 'a', by: 'ann', sides: [{ of: 'bin', contact: 'touching' }] }),
  ])
  assert.equal(c.length, 1)
  assert.deepEqual(c[0].between, ['a', 'b'], 'sorted — deterministic')
  assert.equal(c[0].axis, 'contact')
  assert.deepEqual(c[0].claims.map(x => x.by), ['ann', 'ben'])
})

test('left from one viewer and right from another are NOT a conflict — the viewer is part of the word', () => {
  assert.deepEqual(claimConflicts([
    arr({ ref: 'a', sides: [{ of: 'bin', toward: { dir: 'left', viewer: 'operator' } }] }),
    arr({ ref: 'b', by: 'ben', sides: [{ of: 'bin', toward: { dir: 'right', viewer: 'reviewer' } }] }),
  ]), [])
  const same = claimConflicts([
    arr({ ref: 'a', sides: [{ of: 'bin', toward: { dir: 'left', viewer: 'operator' } }] }),
    arr({ ref: 'b', by: 'ben', sides: [{ of: 'bin', toward: { dir: 'right', viewer: 'operator' } }] }),
  ])
  assert.equal(same.length, 1)
  assert.equal(same[0].axis, 'toward')
})

test('agreeing claims, and claims on different axes, are not conflicts', () => {
  assert.deepEqual(claimConflicts([
    arr({ ref: 'a', sides: [{ of: 'bin', contact: 'touching' }] }),
    arr({ ref: 'b', by: 'ben', sides: [{ of: 'bin', contact: 'touching' }] }),
    arr({ ref: 'c', by: 'ben', subject: 'bin', sides: [{ of: 'table', toward: '+z' }] }),
  ]), [])
})

test('status is per axis and has three values — no score', () => {
  const touchingTop = { contact: 'touching', faces: ['+z'], gap: null, vertical: null, relative: () => [] }
  assert.deepEqual(sideStatus({ of: 'x' }, touchingTop), { contact: AXIS_STATUS.UNDECLARED, toward: AXIS_STATUS.UNDECLARED })
  assert.deepEqual(sideStatus({ of: 'x', contact: 'touching', toward: '+z' }, touchingTop), { contact: 'match', toward: 'match' })
  assert.deepEqual(sideStatus({ of: 'x', contact: 'apart', toward: 'above' }, touchingTop), { contact: 'mismatch', toward: 'mismatch' })

  const leftApart = { contact: 'apart', faces: [], gap: 300, vertical: null, relative: (v) => (v === 'operator' ? ['left'] : ['right']) }
  assert.equal(sideStatus({ of: 'x', toward: { dir: 'left', viewer: 'operator' } }, leftApart).toward, 'match')
  assert.equal(sideStatus({ of: 'x', toward: { dir: 'left', viewer: 'reviewer' } }, leftApart).toward, 'mismatch')

  const overlapping = { contact: 'overlapping', faces: [], gap: null, vertical: null, relative: () => [] }
  assert.equal(sideStatus({ of: 'x', contact: 'touching' }, overlapping).contact, 'mismatch', 'overlapping is observed, never declared')
  assert.deepEqual(Object.values(AXIS_STATUS).sort(), ['match', 'mismatch', 'undeclared'])
})

test('opposites', () => {
  assert.ok(areOpposite('+x', '-x'))
  assert.ok(areOpposite('above', 'below'))
  assert.ok(!areOpposite('+x', 'below'))
  assert.ok(areOpposite({ dir: 'front', viewer: 'v' }, { dir: 'back', viewer: 'v' }))
})

test('clamped: a workpiece between two jaws touches each jaw on the jaw\'s face toward it — read and matched per side', async () => {
  const { observeContact, observeVertical } = await import('./arrangementGeometry.js')
  const work = { center: { x: 0, y: 0, z: 50 }, size: { x: 60, y: 40, z: 25 } }
  const jawLeft  = { center: { x: 0, y:  30, z: 50 }, size: { x: 20, y: 20, z: 40 } }   // on the work's +y side
  const jawRight = { center: { x: 0, y: -30, z: 50 }, size: { x: 20, y: 20, z: 40 } }   // on the work's −y side
  const stateOf = (partner) => ({ ...observeContact(work, partner), vertical: observeVertical(work, partner), relative: () => [] })
  const clamped = { ref: 'c', by: 'ann', subject: 'work', sides: [
    { of: 'jawL', contact: 'touching', toward: '-y' },   // the work is on jawL's −y face
    { of: 'jawR', contact: 'touching', toward: '+y' },
  ] }
  assert.deepEqual(issues([clamped]), [], 'opposite faces: a valid between')
  assert.deepEqual(sideStatus(clamped.sides[0], stateOf(jawLeft)), { contact: 'match', toward: 'match' })
  assert.deepEqual(sideStatus(clamped.sides[1], stateOf(jawRight)), { contact: 'match', toward: 'match' })

  // Open the right jaw by 10 mm: that side is now "between, apart" — and says so.
  const opened = { ...jawRight, center: { ...jawRight.center, y: -40 } }
  assert.deepEqual(sideStatus(clamped.sides[1], stateOf(opened)), { contact: 'mismatch', toward: 'mismatch' })
})
