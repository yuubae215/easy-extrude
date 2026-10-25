/**
 * The dictionary's examples are executable (当事者 2026-10-25 — 辞書には語・意味・
 * 例文が必ず在る; 例文は読み物ではなく検査として書く).
 *
 * For every entry of a glossed category (`GLOSSED_CATEGORIES`) — words and
 * combinations alike — three things are asked:
 *
 *   1. the example's term folds onto THIS entry, and the contrast's term onto a
 *      DIFFERENT one (the minimal pair is a pair);
 *   2. the entry has a small layout below (`GROUNDING`), and the population is
 *      the dictionary itself — an entry added without one fails here (原則 #31);
 *   3. in that layout the domain's own status reads the example as a match and
 *      the contrast as a mismatch (原則 #33-4 — the word points where it says).
 *
 * The reading is `domain/arrangement.sideStatus` over the geometry of
 * `domain/arrangementGeometry` — the same definition the screen judges with, so
 * an example cannot hold "in the dictionary" and fail on the screen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUOTIENT_TABLE, COMBINATION_TABLE, GLOSSED_CATEGORIES, canonicalKeyIn, combinationIn,
} from './SynonymQuotient.js'
import { sideStatus, frameOfToward, AXIS_STATUS, CONTACTS, RELATIVE_DIRS } from '../domain/arrangement.js'
import {
  observeContact, observeFaceSides, observeVertical, observeRelative,
} from '../domain/arrangementGeometry.js'

const box = (center, size, extra = {}) => ({ center, size, ...extra })

// The single-arm cell's numbers (examples/layout_pick_place_cell.json).
const workbench = box({ x: 0, y: 0, z: 400 }, { x: 600, y: 500, z: 800 })
const binOnBench = box({ x: 200, y: 150, z: 875 }, { x: 200, y: 150, z: 150 })
const lampOverBench = box({ x: 0, y: 0, z: 1200 }, { x: 100, y: 100, z: 100 })
const robot = box({ x: 0, y: 0, z: 500 }, { x: 200, y: 200, z: 1000 })
const trayAt = (x, y) => box({ x, y, z: 50 }, { x: 100, y: 100, z: 100 })
const boxOnFloor = box({ x: 0, y: 0, z: 50 }, { x: 100, y: 100, z: 100 })
const toolAt = (x, y) => box({ x, y, z: 50 }, { x: 40, y: 40, z: 40 })
/** A viewer standing at −X, facing +X (REP-103: its left is +Y). */
const viewer = { position: { x: -1000, y: 0, z: 0 } }

/** entry key → { subject, partner } where the example holds and the contrast does not. */
const GROUNDING = {
  touching:   { subject: binOnBench,     partner: workbench },
  apart:      { subject: lampOverBench,  partner: workbench },
  above:      { subject: lampOverBench,  partner: workbench },
  below:      { subject: workbench,      partner: lampOverBench },
  '+z':       { subject: binOnBench,     partner: workbench },
  '-z':       { subject: workbench,      partner: binOnBench },
  '+x':       { subject: trayAt(150, 0),  partner: robot },
  '-x':       { subject: trayAt(-150, 0), partner: robot },
  '+y':       { subject: trayAt(0, 150),  partner: robot },
  '-y':       { subject: trayAt(0, -150), partner: robot },
  front:      { subject: toolAt(-300, 0), partner: boxOnFloor },
  back:       { subject: toolAt(300, 0),  partner: boxOnFloor },
  left:       { subject: toolAt(0, 300),  partner: boxOnFloor },
  right:      { subject: toolAt(0, -300), partner: boxOnFloor },
  resting_on: { subject: binOnBench,     partner: workbench },
}

/** The state of a side, as `layout/ArrangementReport` builds it. */
function stateOf({ subject, partner }) {
  return {
    ...observeContact(subject, partner),
    faceSides: observeFaceSides(subject, partner),
    vertical: observeVertical(subject, partner),
    relative: () => observeRelative(subject, partner, viewer),
  }
}

/** A declared side saying exactly what a dictionary key (word or combination) says. */
function sideSaying(key) {
  const combo = COMBINATION_TABLE.find(c => c.key === key)
  if (combo) return { ...combo.axes }
  if (CONTACTS.includes(key)) return { contact: key }
  if (RELATIVE_DIRS.includes(key)) return { toward: { dir: key, viewer: 'v' } }
  frameOfToward(key)   // throws on a word outside the vocabulary
  return { toward: key }
}

/** Does the layout read the side as a match on every axis it declares? */
function holds(key, scene) {
  const st = sideStatus(sideSaying(key), stateOf(scene))
  return Object.values(st).every(v => v === AXIS_STATUS.MATCH || v === AXIS_STATUS.UNDECLARED)
}

/** What a surface term folds onto in a category: a word or a combination key. */
function foldsOnto(term, cat) {
  return canonicalKeyIn(term, cat) ?? combinationIn(term, cat)?.key ?? null
}

const ENTRIES = [...QUOTIENT_TABLE, ...COMBINATION_TABLE].filter(e => GLOSSED_CATEGORIES.includes(e.cat))

test('the population is not empty (the scan is live)', () => {
  assert.ok(ENTRIES.length >= 15, `only ${ENTRIES.length} glossed entries`)
  assert.ok(COMBINATION_TABLE.length >= 1)
})

for (const e of ENTRIES) {
  test(`${e.key}: 「${e.example.ja}」 folds onto it, and 「${e.contrast.ja}」 onto another entry`, () => {
    assert.equal(foldsOnto(e.example.term, e.cat), e.key)
    const other = foldsOnto(e.contrast.term, e.cat)
    assert.ok(other !== null, `the contrast term "${e.contrast.term}" folds onto nothing`)
    assert.notEqual(other, e.key, 'the contrast is the same entry — not a minimal pair')
  })

  test(`${e.key}: grounded — the example holds in its layout and the contrast does not`, () => {
    const scene = GROUNDING[e.key]
    assert.ok(scene, `no layout in GROUNDING for "${e.key}" — an example nobody can run is prose`)
    assert.ok(holds(e.key, scene), `「${e.example.ja}」 does not hold in its layout`)
    assert.ok(!holds(foldsOnto(e.contrast.term, e.cat), scene), `the contrast 「${e.contrast.ja}」 also holds — the pair does not tell the words apart`)
  })
}

test('GROUNDING has no layout for an entry the dictionary does not have (no stale rows)', () => {
  const keys = new Set(ENTRIES.map(e => e.key))
  assert.deepEqual(Object.keys(GROUNDING).filter(k => !keys.has(k)), [])
})

test('a combination fixes values a single side can declare together (the domain accepts it)', async () => {
  const { arrangementIssues } = await import('../domain/arrangement.js')
  for (const c of COMBINATION_TABLE) {
    const issues = arrangementIssues(
      [{ ref: 'r', by: 'a', subject: 's', sides: [{ of: 'p', ...c.axes }] }],
      { actorRefs: new Set(['a']), solidRefs: new Set(['s', 'p']), viewers: new Map(), kinematicLinks: [] },
    )
    assert.deepEqual(issues, [], `${c.key}: ${issues.join('; ')}`)
  }
})
