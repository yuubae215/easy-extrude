/**
 * ADR-168 S1b — every word of a relation can be checked on screen, and that is
 * counted (原則 #33-4).
 *
 * The census half: the population is the DOMAIN vocabulary (every declarable
 * contact and direction of `domain/arrangement.js`), not the table — a table
 * measured against itself is a place-list (ADR-102). Words with no row in
 * `CONFIRMATION_BY_WORD` must be 0, and the table may not keep rows for words the
 * domain no longer declares (a retired word that still "has a picture" is the
 * rot 原則 #32 is about).
 *
 * The picture half: for a layout where each word HOLDS, the picture contains the
 * primitive its row names, drawn where the word points (the patch on the inner
 * floor, the face on the partner, the guide between the two heights, the viewer
 * where it stands). The picture judges nothing — it is drawn in one neutral
 * role whatever the status — and the status is a separate mark whose only
 * coloured value is a mismatch / conflict (C4, party 2026-10-24), so 「不一致は
 * 画面で必ず見える」(ADR-168 D4) is a counted fact, not a hope.
 *
 * What this evidence cannot see (declared): whether the drawn picture READS as
 * the word to a person — that is measured only on the real screen (docs/dogfooding/).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CONFIRMATION_BY_WORD, DECLARABLE_WORDS, confirmationFor, toneFor, STATUS_TONE, PICTURE_TONE, CONFLICT_TONE,
  arrangementPicture, arrangementPanel, focusedReports, panelHeadline, PANEL_KIND, faceCorners,
} from './ArrangementStatusMath.js'
import { CONTACTS, FACE_TOWARD, ABSOLUTE_TOWARD, RELATIVE_DIRS, AXIS_STATUS } from '../domain/arrangement.js'
import { reportArrangements } from '../layout/ArrangementReport.js'
import { COLOR } from '../theme/tokens.js'

const template = JSON.parse(readFileSync(new URL('../../examples/layout_pick_place_cell.json', import.meta.url), 'utf8'))
const actors = [{ ref: 'ann' }, { ref: 'ben' }]
/** The template plus a viewer in front of the cell (−X), facing +X. */
const layout = (() => {
  const l = JSON.parse(JSON.stringify(template))
  l.entities.push({ ref: 'operator', type: 'CoordinateFrame', name: 'Operator', frameRole: 'viewer', position: { x: -1500, y: 0, z: 1600 } })
  return l
})()
const report = (arrangements) => {
  const r = reportArrangements(layout, arrangements, actors)
  assert.deepEqual(r.errors, [])
  return r
}
const kinds = (pic) => pic.items.map(i => i.kind)

// ── census ───────────────────────────────────────────────────────────────────

test('宣言できる語のうち確認の絵を持たないものは 0 個 (母集団は domain の語彙)', () => {
  const population = [...CONTACTS, ...FACE_TOWARD, ...ABSOLUTE_TOWARD, ...RELATIVE_DIRS]
  assert.ok(population.length >= 14, `the population came out suspiciously small: ${population}`)
  assert.deepEqual(population.filter(w => !(w in CONFIRMATION_BY_WORD)), [],
    'a declarable word with no picture — add a CONFIRMATION_BY_WORD row')
  assert.deepEqual([...DECLARABLE_WORDS].sort(), [...population].sort())
})

test('the table keeps no row for a word the domain does not declare', () => {
  const population = new Set(DECLARABLE_WORDS)
  assert.deepEqual(Object.keys(CONFIRMATION_BY_WORD).filter(w => !population.has(w)), [])
})

test('a word with no picture throws rather than drawing nothing', () => {
  assert.throws(() => confirmationFor('on'), /no confirming picture/)
  assert.throws(() => toneFor('maybe'), /no tone/)
})

test('every status tone is a declared colour role (ADR-100 — no new colours)', () => {
  for (const status of Object.values(AXIS_STATUS)) assert.ok(toneFor(status) in COLOR, status)
  assert.ok(PICTURE_TONE in COLOR && CONFLICT_TONE in COLOR)
  assert.notEqual(STATUS_TONE.match, STATUS_TONE.mismatch)
})

test('C4: only a mismatch (and a conflict) is coloured; a match is not a judgement colour', () => {
  // The status tones that are not plain text roles — must be exactly the mismatch.
  const TEXT_ROLES = new Set(['textPrimary', 'textSecondary'])
  const coloured = Object.entries(STATUS_TONE).filter(([, t]) => !TEXT_ROLES.has(t)).map(([s]) => s)
  assert.deepEqual(coloured, [AXIS_STATUS.MISMATCH])
  assert.equal(CONFLICT_TONE, STATUS_TONE[AXIS_STATUS.MISMATCH])
  // The picture's role is the neutral figure, never a state tone.
  assert.equal(PICTURE_TONE, 'entityDefault')
})

// ── the picture of each word, where it holds ─────────────────────────────────

test('touching + a face: the patch lies on the bin\'s INNER floor and the declared face is painted on the bin', () => {
  const r = report([{ ref: 'w1', by: 'ann', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching', toward: '+z' }] }])
  const pic = arrangementPicture(r, ['work_1'])
  assert.ok(kinds(pic).includes(confirmationFor('touching').picture))
  assert.ok(kinds(pic).includes(confirmationFor('+z').picture))
  const patch = pic.items.find(i => i.kind === 'contactPatch')
  const floorZ = r.bodies.work_1.center.z - r.bodies.work_1.size.z / 2
  assert.ok(patch.corners.every(c => Math.abs(c[2] - floorZ) < 1e-6), 'the patch is under the workpiece, not on the rim')
  assert.equal(patch.tone, PICTURE_TONE)
  const face = pic.items.find(i => i.kind === 'facePaint')
  assert.deepEqual(face.corners, faceCorners(r.bodies.part_bin, '+z'))
  assert.ok(face.corners.every(c => c[2] === r.bodies.part_bin.center.z + r.bodies.part_bin.size.z / 2))
})

test('apart + above: a separation line with the gap as a lower bound, and a vertical guide between the two heights', () => {
  // Nothing in the template floats, so add a lamp hanging over the bench.
  const l = JSON.parse(JSON.stringify(layout))
  l.entities.push({ ref: 'lamp', type: 'Solid', name: 'Lamp', position: { x: 0, y: 0, z: 1500 }, dimensions: { x: 100, y: 100, z: 100 } })
  const r = reportArrangements(l, [{ ref: 'l1', by: 'ann', subject: 'lamp', sides: [{ of: 'worktable', contact: 'apart', toward: 'above' }] }], actors)
  assert.deepEqual(r.errors, [])
  const pic = arrangementPicture(r, ['lamp'])
  assert.ok(kinds(pic).includes(confirmationFor('apart').picture))
  assert.ok(kinds(pic).includes(confirmationFor('above').picture))
  assert.match(pic.items.find(i => i.kind === 'separation').caption, /^apart \(≥ \d/)
  const guide = pic.items.find(i => i.kind === 'verticalGuide')
  assert.equal(guide.from[2], 800, 'from the bench top')
  assert.equal(guide.to[2], r.bodies.lamp.center.z - 50, 'to the lamp\'s bottom')
  assert.equal(guide.tone, PICTURE_TONE)
})

test('a relative direction draws the viewer where it stands, facing +X, and the lines it is read against', () => {
  const r = report([{ ref: 'b1', by: 'ann', subject: 'part_bin', sides: [{ of: 'output_tray', contact: 'apart', toward: { dir: 'left', viewer: 'operator' } }] }])
  const pic = arrangementPicture(r, ['part_bin'])
  const v = pic.items.find(i => i.kind === confirmationFor('left').picture)
  assert.ok(v, 'viewerAxes drawn')
  assert.deepEqual(v.viewer, [-1500, 0, 1600])
  assert.ok(v.facing[0] > v.viewer[0] && v.facing[1] === v.viewer[1], 'the arrow points along the viewer\'s +X')
  const tray = r.bodies.output_tray.center
  for (const [a, b] of v.lines) {
    const mid = [0, 1, 2].map(k => (a[k] + b[k]) / 2)
    assert.deepEqual(mid.map(Math.round), [tray.x, tray.y, tray.z].map(Math.round), 'each line runs through the partner')
  }
  const left = v.quadrantLabels.find(q => q.text === 'left')
  assert.ok(left.at[1] > tray.y, 'the viewer\'s left is +Y for a viewer facing +X')
})

test('a mismatched axis keeps its picture neutral; the mark says it, in the mismatch tone (C4)', () => {
  const r = report([{ ref: 'a2', by: 'ben', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'apart', toward: 'above' }] }])
  const pic = arrangementPicture(r, ['part_bin'])
  // The bin stands on the bench: it touches, so `apart` and `above` both fail.
  for (const item of pic.items.filter(i => i.kind !== 'caption')) assert.equal(item.tone, PICTURE_TONE, item.kind)
  const caption = pic.items.find(i => i.kind === 'caption')
  assert.equal(caption.tone, toneFor(AXIS_STATUS.MISMATCH))
  assert.match(caption.text, /contact ✗ · direction ✗/)
})

test('an undeclared axis is drawn as the observed fact, neutral, with the undeclared mark — never as a match', () => {
  const r = report([{ ref: 'u1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable' }] }])
  const pic = arrangementPicture(r, ['part_bin'])
  assert.equal(pic.items.find(i => i.kind === 'contactPatch').tone, PICTURE_TONE)
  assert.match(pic.items.find(i => i.kind === 'caption').text, /contact – · direction –/)
  assert.ok(!kinds(pic).includes('facePaint'), 'no direction was declared, so none is painted')
})

// ── 「不一致は画面で必ず見える」 — without selecting anything ───────────────────

test('with nothing selected, exactly the mismatched and the conflicting relations are drawn', () => {
  const r = report([
    { ref: 'ok',  by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching', toward: '+z' }] },
    { ref: 'bad', by: 'ann', subject: 'output_tray', sides: [{ of: 'worktable', contact: 'apart' }] },
    { ref: 'c1',  by: 'ann', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching' }] },
    { ref: 'c2',  by: 'ben', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'apart' }] },
  ])
  assert.deepEqual(focusedReports(r, []).map(x => x.ref), ['bad', 'c1', 'c2'])
  const pic = arrangementPicture(r, [])
  const conflict = pic.items.find(i => i.kind === 'caption' && /^conflict/.test(i.text))
  assert.ok(conflict, 'the claim conflict is named on screen')
  assert.match(conflict.text, /ann says touching \/ ben says apart/)
  assert.equal(conflict.tone, CONFLICT_TONE)
})

test('with nothing broken and nothing selected, nothing is drawn', () => {
  const r = report([{ ref: 'ok', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching' }] }])
  assert.equal(arrangementPicture(r, []), null)
  assert.equal(arrangementPicture(null, []), null)
})

test('a selected entity brings every relation that names it — as subject or as a side', () => {
  const r = report([
    { ref: 'x1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching' }] },
    { ref: 'x2', by: 'ann', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching' }] },
    { ref: 'x3', by: 'ann', subject: 'output_tray', sides: [{ of: 'worktable', contact: 'touching' }] },
  ])
  assert.deepEqual(focusedReports(r, ['part_bin']).map(x => x.ref), ['x1', 'x2'])
})

test('N selected things bring the union of the relations that name any of them (party 2026-10-24)', () => {
  const r = report([
    { ref: 'x1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching' }] },
    { ref: 'x2', by: 'ann', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching' }] },
    { ref: 'x3', by: 'ann', subject: 'output_tray', sides: [{ of: 'worktable', contact: 'touching' }] },
  ])
  assert.deepEqual(focusedReports(r, ['work_1', 'output_tray']).map(x => x.ref), ['x2', 'x3'])
  assert.deepEqual(arrangementPanel(r, ['work_1', 'output_tray']).rows.map(x => x.ref), ['x2', 'x3'])
})

// ── the panel ────────────────────────────────────────────────────────────────

test('the panel says which zero it is: no document / none declared / invalid', () => {
  assert.equal(arrangementPanel(null, []).kind, PANEL_KIND.NO_DOCUMENT)
  assert.equal(arrangementPanel(report([]), []).kind, PANEL_KIND.NONE_DECLARED)
  const bad = reportArrangements(layout, [{ ref: 'z', by: 'nobody', subject: 'part_bin', sides: [{ of: 'worktable' }] }], actors)
  const m = arrangementPanel(bad, [])
  assert.equal(m.kind, PANEL_KIND.INVALID)
  assert.ok(m.errors.length > 0, 'the errors are carried, not dropped (原則 #11)')
  for (const kind of Object.values(PANEL_KIND)) {
    assert.equal(typeof panelHeadline({ kind, errors: ['e'], summary: { relations: 1, mismatched: 0, conflicts: 0 } }), 'string')
  }
  assert.throws(() => panelHeadline({ kind: 'mystery' }), /no headline/)
})

test('the panel rows carry declared vs observed per axis, the status, and the looked-up mobility', () => {
  const r = report([
    { ref: 'w1', by: 'ann', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'apart', toward: { dir: 'left', viewer: 'operator' } }] },
    { ref: 'w2', by: 'ben', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching' }] },
  ])
  const m = arrangementPanel(r, ['work_1'])
  assert.equal(m.kind, PANEL_KIND.LISTED)
  assert.deepEqual(m.summary, { relations: 2, mismatched: 1, conflicts: 1 })
  const side = m.rows[0].sides[0]
  assert.deepEqual(side.contact, { declared: 'apart', observed: 'touching', status: 'mismatch' })
  assert.equal(side.toward.declared, 'left (seen by operator)')
  assert.equal(side.toward.observed, 'touching +z')
  assert.equal(side.mobility, 'fixed', 'work_1 is fastened to the bin floor in the template')
  assert.equal(m.conflicts.length, 1)
  assert.deepEqual(m.conflicts[0].claims.map(c => `${c.by}:${c.value}`), ['ann:apart', 'ben:touching'])
  assert.match(panelHeadline(m), /2 relations · 1 mismatched · 1 conflict$/)
})
