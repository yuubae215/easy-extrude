/**
 * The dictionary's examples are executable (当事者 2026-10-25 — 辞書には語・意味・
 * 例文が必ず在る; 例文は読み物ではなく検査として書く).
 *
 * For every entry of a glossed category (`GLOSSED_CATEGORIES`) — words and
 * phrases (combinations and choices) alike — three things are asked:
 *
 *   1. the example's term folds onto THIS entry, and the contrast's term onto a
 *      DIFFERENT one (the minimal pair is a pair);
 *   2. the entry has a small layout below (`GROUNDING`), and the population is
 *      the dictionary itself — an entry added without one fails here (原則 #31);
 *   3. in that layout the domain's own status reads the example as a match and
 *      the contrast as a mismatch (原則 #33-4 — the word points where it says).
 *      A phrase is grounded once PER CELL it names: a choice's example holds in
 *      the layout of each of its readings — which is what shows it is a choice.
 *
 * And the grid itself: every declarable cell has a layout the status reads as
 * that cell — so "every cell can be said" is shown on geometry, not asserted.
 *
 * The reading is `domain/arrangement.sideStatus` over the geometry of
 * `domain/arrangementGeometry` — the same definition the screen judges with, so
 * an example cannot hold "in the dictionary" and fail on the screen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUOTIENT_TABLE, PHRASE_TABLE, GLOSSED_CATEGORIES, canonicalKeyIn, phraseIn,
} from './SynonymQuotient.js'
import { RELATION_CELLS, sideOfCell, UNSTATED } from '../domain/relationCells.js'
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

/** A declared side saying exactly what a WORD says (one axis value). */
function sideSaying(key) {
  if (CONTACTS.includes(key)) return { contact: key }
  if (RELATIVE_DIRS.includes(key)) return { toward: { dir: key, viewer: 'v' } }
  frameOfToward(key)   // throws on a word outside the vocabulary
  return { toward: key }
}

/** Does the layout read a declared side as a match on every axis it says? */
function sideHolds(side, scene) {
  const st = sideStatus(side, stateOf(scene))
  return Object.values(st).every(v => v === AXIS_STATUS.MATCH || v === AXIS_STATUS.UNDECLARED)
}

/** Does an entry (word or phrase) hold in a layout? A phrase holds when one of its cells does. */
function holds(key, scene) {
  const phrase = PHRASE_TABLE.find(p => p.key === key)
  if (phrase) return phrase.cells.some(id => sideHolds(sideOfCell(id, 'v'), scene))
  return sideHolds(sideSaying(key), scene)
}

/** What a surface term folds onto in a category: a word or a phrase key. */
function foldsOnto(term, cat) {
  return canonicalKeyIn(term, cat) ?? phraseIn(term, cat)?.key ?? null
}

/**
 * A layout that IS a cell: a 100 mm cube placed against a robot-sized partner
 * (200 × 200 × 1000, base on the floor), seen by the viewer at −X. Touching
 * puts the cube flush on the face; apart puts it 300 mm beyond. An unsaid axis
 * takes the plainest value (touching, the +z face) — any one realises "not said".
 */
const cellPartner = box({ x: 0, y: 0, z: 500 }, { x: 200, y: 200, z: 1000 })
function layoutFor(cell) {
  const dir = cell.direction === UNSTATED ? (cell.contact === 'apart' ? 'above' : '+z') : cell.direction
  const apart = cell.contact === 'apart' || ['above', 'below', ...RELATIVE_DIRS].includes(dir)
  const gap = apart ? 300 : 0
  const out = 100 + 50 + gap          // partner half-width + cube half + gap
  const up = 1000 + 50 + gap, down = -50 - gap
  const at = {
    '+x': { x: out, y: 0, z: 500 },  '-x': { x: -out, y: 0, z: 500 },
    '+y': { x: 0, y: out, z: 500 },  '-y': { x: 0, y: -out, z: 500 },
    '+z': { x: 0, y: 0, z: up },     '-z': { x: 0, y: 0, z: down },
    above: { x: 0, y: 0, z: up },    below: { x: 0, y: 0, z: down },
    front: { x: -out, y: 0, z: 500 }, back: { x: out, y: 0, z: 500 },   // the viewer stands at −X
    left: { x: 0, y: out, z: 500 },   right: { x: 0, y: -out, z: 500 },  // its left is +Y
  }[dir]
  return { subject: box(at, { x: 100, y: 100, z: 100 }), partner: cellPartner }
}

const ENTRIES = [...QUOTIENT_TABLE, ...PHRASE_TABLE].filter(e => GLOSSED_CATEGORIES.includes(e.cat))
const isPhrase = (e) => PHRASE_TABLE.includes(e)

test('the population is not empty (the scan is live)', () => {
  assert.ok(ENTRIES.length >= 20, `only ${ENTRIES.length} glossed entries`)
  assert.ok(PHRASE_TABLE.length >= 2)
})

test('every declarable cell of the grid has a layout that reads as exactly that cell', () => {
  const declarable = RELATION_CELLS.filter(c => c.declarable)
  assert.ok(declarable.length > 0)
  for (const cell of declarable) {
    assert.ok(sideHolds(sideOfCell(cell.id, 'v'), layoutFor(cell)), `${cell.id}: its layout does not read as it`)
  }
})

for (const e of ENTRIES) {
  test(`${e.key}: 「${e.example.ja}」 folds onto it, and 「${e.contrast.ja}」 onto another entry`, () => {
    assert.equal(foldsOnto(e.example.term, e.cat), e.key)
    const other = foldsOnto(e.contrast.term, e.cat)
    assert.ok(other !== null, `the contrast term "${e.contrast.term}" folds onto nothing`)
    assert.notEqual(other, e.key, 'the contrast is the same entry — not a minimal pair')
  })

  test(`${e.key}: grounded — the example holds in its layout${isPhrase(e) ? 's (one per cell)' : ''} and the contrast does not`, () => {
    const scenes = isPhrase(e)
      ? e.cells.map(id => RELATION_CELLS.find(c => c.id === id)).map(layoutFor)
      : [GROUNDING[e.key]]
    assert.ok(scenes.every(Boolean), `no layout in GROUNDING for "${e.key}" — an example nobody can run is prose`)
    const contrast = foldsOnto(e.contrast.term, e.cat)
    for (const scene of scenes) {
      assert.ok(holds(e.key, scene), `「${e.example.ja}」 does not hold in one of its layouts`)
      assert.ok(!holds(contrast, scene), `the contrast 「${e.contrast.ja}」 also holds — the pair does not tell the words apart`)
    }
  })
}

test('GROUNDING has a layout for exactly the words (phrases are grounded through their cells)', () => {
  const words = ENTRIES.filter(e => !isPhrase(e)).map(e => e.key)
  assert.deepEqual(Object.keys(GROUNDING).filter(k => !words.includes(k)), [], 'stale rows')
  assert.deepEqual(words.filter(k => !GROUNDING[k]), [], 'words without a layout')
})
