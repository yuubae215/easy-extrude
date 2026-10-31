/**
 * ArrangementController (ADR-168 S1b) — the document edge and the focus each
 * reach both outputs: the Relations section's model and the 3D picture.
 * THREE-free: the view is a recorded fake built through the injected factory.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ArrangementController } from './ArrangementController.js'
import { reportArrangements } from '../layout/ArrangementReport.js'
import { PANEL_KIND } from '../view/ArrangementStatusMath.js'

const layout = JSON.parse(readFileSync(new URL('../../examples/layout_pick_place_cell.json', import.meta.url), 'utf8'))
const actors = [{ ref: 'ann' }, { ref: 'ben' }]

function rig(arrangements) {
  const handlers = {}
  let doc = arrangements === null ? null : { arrangements }
  const ctxService = {
    on: (ev, fn) => { (handlers[ev] ??= []).push(fn) },
    arrangementReport: () => (doc ? reportArrangements(layout, doc.arrangements, actors) : null),
    getDoc: () => (doc ? { actors, ...doc } : null),
  }
  const written = []
  const store = { getState: () => ({ actions: { contextSetArrangements: (m) => written.push(m) } }) }
  const shown = []
  let built = 0
  const ctrl = new ArrangementController({
    ctxService, store,
    createView: () => { built++; return { show: (p) => shown.push(p), dispose() {} } },
  })
  return {
    ctrl, written, shown,
    get built() { return built },
    emit: (ev) => handlers[ev].forEach(fn => fn()),
    setDoc: (d) => { doc = d },
  }
}

test('the document edge writes the model; nothing broken and nothing selected builds no view', () => {
  const r = rig([{ ref: 'ok', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching' }] }])
  r.emit('contextLoaded')
  assert.equal(r.written.at(-1).kind, PANEL_KIND.LISTED)
  assert.equal(r.built, 0, 'no picture yet, so no meshes allocated')
})

test('a mismatch is drawn with nothing selected (D4), and selecting brings the focused picture', () => {
  const r = rig([
    { ref: 'bad', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'apart' }] },
    { ref: 'ok',  by: 'ann', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching' }] },
  ])
  r.emit('contextLoaded')
  assert.equal(r.built, 1)
  assert.ok(r.shown.at(-1), 'the mismatched relation is on screen')
  r.ctrl.setFocus(['work_1'])
  assert.deepEqual(r.written.at(-1).focusRefs, ['work_1'])
  assert.deepEqual(r.written.at(-1).rows.map(x => x.ref), ['ok'])
  r.ctrl.setFocus(['worktable'])
  assert.deepEqual(r.written.at(-1).rows.map(x => x.ref), ['bad'])
  // N selected = the union of their relations; undeclared selections (null refs) drop out.
  r.ctrl.setFocus(['worktable', null, 'work_1'])
  assert.deepEqual(r.written.at(-1).focusRefs, ['work_1', 'worktable'])
  assert.deepEqual(r.written.at(-1).rows.map(x => x.ref), ['bad', 'ok'])
  // Nothing declared selected = the unfocused view (only the broken relations drawn).
  r.ctrl.setFocus([null])
  assert.deepEqual(r.written.at(-1).focusRefs, [])
})

test('the same focus twice does not redraw; a document edit does', () => {
  const r = rig([{ ref: 'bad', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'apart' }] }])
  r.emit('contextLoaded')
  r.ctrl.setFocus(['part_bin'])
  const n = r.written.length
  r.ctrl.setFocus(['part_bin'])
  assert.equal(r.written.length, n)
  r.setDoc({ arrangements: [] })
  r.emit('contextChanged')
  assert.equal(r.written.at(-1).kind, PANEL_KIND.NONE_DECLARED)
  assert.equal(r.shown.at(-1), null, 'the picture is cleared, not left showing a relation the document no longer says')
})

test('no document is its own answer — not "none declared"', () => {
  const r = rig(null)
  r.emit('contextLoaded')
  assert.equal(r.written.at(-1).kind, PANEL_KIND.NO_DOCUMENT)
})

// ── who is speaking (ADR-168 S2-1) ──

test('nobody speaks until chosen — no default actor, and the panel says why nothing is offered', () => {
  const r = rig([])
  r.emit('contextLoaded')
  assert.equal(r.ctrl.speaker, null)
  assert.equal(r.written.at(-1).speaker.current, null)
  assert.match(r.written.at(-1).speaker.note, /Nobody is speaking/)
  assert.deepEqual(r.written.at(-1).speaker.choices.map(c => c.ref), ['ann', 'ben'])
})

test('choosing a speaker reaches the panel; a ref that is not an actor throws', () => {
  const r = rig([])
  r.emit('contextLoaded')
  r.ctrl.setSpeaker('ben')
  assert.equal(r.written.at(-1).speaker.current, 'ben')
  assert.equal(r.written.at(-1).speaker.note, null)
  assert.throws(() => r.ctrl.setSpeaker('nobody'), /not an actor/)
})

test('the speaker\'s own claims are the pairs not offered again; others\' claims are not theirs', () => {
  const r = rig([
    { ref: 'a1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching' }] },
    { ref: 'b1', by: 'ben', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching' }] },
  ])
  r.emit('contextLoaded')
  assert.deepEqual([...r.ctrl.claimedPairs()], [], 'nobody speaking claims nothing')
  r.ctrl.setSpeaker('ann')
  assert.deepEqual([...r.ctrl.claimedPairs()], ['part_bin|worktable'])
})

test('a speaker the document drops is named once, not silently forgotten', () => {
  const r = rig([])
  r.emit('contextLoaded')
  r.ctrl.setSpeaker('ben')
  r.setDoc({ arrangements: [], actors: [{ ref: 'ann' }] })
  r.emit('contextChanged')
  assert.equal(r.ctrl.speaker, null)
  assert.match(r.written.at(-1).speaker.note, /"ben" is no longer an actor/)
})

test('without a document there is no speaker block', () => {
  const r = rig(null)
  r.emit('contextLoaded')
  assert.equal(r.written.at(-1).speaker, null)
})

// ── unclaimed relations (ADR-168 S2-2) ───────────────────────────────────────

function unclaimedRig({ doc, sceneList = [] }) {
  const handlers = {}
  const sceneHandlers = {}
  let current = doc
  let list = sceneList
  const ctxService = {
    on: (ev, fn) => { (handlers[ev] ??= []).push(fn) },
    arrangementReport: () => (current ? reportArrangements(layout, current.arrangements ?? [], current.actors ?? []) : null),
    getDoc: () => current,
  }
  const written = []
  const store = { getState: () => ({ actions: { contextSetArrangements: (m) => written.push(m) } }) }
  const ctrl = new ArrangementController({
    ctxService, store, createView: () => ({ show() {}, dispose() {} }),
    scene: {
      getUnclaimedRelations: () => list,
      on: (ev, fn) => { (sceneHandlers[ev] ??= []).push(fn) },
      nameOf: (id) => `name(${id})`,
    },
  })
  return {
    ctrl, written,
    emit: (ev) => handlers[ev].forEach(fn => fn()),
    sceneChanged: (next) => { list = next; sceneHandlers.unclaimedRelationsChanged.forEach(fn => fn()) },
  }
}

const unclaimedDoc = (actors) => ({
  actors,
  arrangements: [],
  specification: { layout: { unclaimedRelations: [
    { subject: 'part_bin', of: 'worktable', cell: 'touching:+z', was: 'above', properties: { note: 'Supply bin placed on the top' } },
    { subject: 'output_tray', of: 'worktable', cell: '_:above', was: 'above' },
  ] } },
})

test('no unclaimed relations is no block at all (0 is the normal state of a new file)', () => {
  const r = unclaimedRig({ doc: { actors, arrangements: [], specification: { layout: {} } } })
  r.emit('contextLoaded')
  assert.equal(r.written.at(-1).unclaimed, null)
})

test('the document\'s unclaimed relations are listed with their reading; claiming waits for a speaker, and says so', () => {
  const r = unclaimedRig({ doc: unclaimedDoc(actors) })
  r.emit('contextLoaded')
  const u = r.written.at(-1).unclaimed
  assert.deepEqual(u.rows.map(x => [x.subject, x.of, x.reading, x.was]), [
    ['part_bin', 'worktable', 'resting on', 'above'],
    ['output_tray', 'worktable', 'contact not said, above', 'above'],
  ])
  assert.equal(u.rows[0].note, 'Supply bin placed on the top')
  assert.equal(u.canClaim, false)
  assert.match(u.note, /Choose who is speaking/)
  r.ctrl.setSpeaker('ann')
  assert.equal(r.written.at(-1).unclaimed.canClaim, true)
  assert.equal(r.written.at(-1).unclaimed.note, null)
  assert.equal(r.written.at(-1).unclaimed.rows[0].key, 'part_bin|worktable|touching:+z')
})

test('a pair the speaker already claims is shown as such, not offered', () => {
  const doc = { ...unclaimedDoc(actors), arrangements: [{ ref: 'x', by: 'ann', subject: 'worktable', sides: [{ of: 'part_bin' }] }] }
  const r = unclaimedRig({ doc })
  r.emit('contextLoaded')
  r.ctrl.setSpeaker('ann')
  assert.match(r.written.at(-1).unclaimed.rows[0].blocked, /ann already claims/)
  assert.equal(r.written.at(-1).unclaimed.rows[1].blocked, null)
})

test('a document with no actors says that is why nothing can be claimed', () => {
  const r = unclaimedRig({ doc: unclaimedDoc([]) })
  r.emit('contextLoaded')
  assert.match(r.written.at(-1).unclaimed.note, /no actors/)
  assert.equal(r.written.at(-1).unclaimed.canClaim, false)
})

test('without a document the scene\'s unclaimed relations are listed by name and cannot be claimed', () => {
  const r = unclaimedRig({ doc: null })
  r.sceneChanged([{ subject: 'id1', of: 'id2', cell: '_:_', was: 'adjacent' }])
  const u = r.written.at(-1).unclaimed
  assert.deepEqual(u.rows.map(x => [x.subject, x.of, x.was]), [['name(id1)', 'name(id2)', 'adjacent']])
  assert.equal(u.canClaim, false)
  assert.match(u.note, /no document to write a claim into/)
  r.sceneChanged([])
  assert.equal(r.written.at(-1).unclaimed, null)
})

// ── S3: the declared supports, by scene id, and the event that re-hangs ─────

test('S3: supports come from the document by scene id; a document edge and an unclaimed change both re-hang', () => {
  const handlers = {}
  let doc = { actors, arrangements: [{ ref: 'a1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching', toward: '+z' }] }],
    specification: { layout: { unclaimedRelations: [{ subject: 'output_tray', of: 'worktable', cell: 'touching:+z', was: 'above' }] } } }
  let calls = 0
  const ctrl = new ArrangementController({
    ctxService: {
      on: (ev, fn) => { (handlers[ev] ??= []).push(fn) },
      arrangementReport: () => null,
      getDoc: () => doc,
      sceneIdForRef: (ref) => (ref === 'ghost' ? null : `solid_${ref}`),
    },
    store: { getState: () => ({ actions: { contextSetArrangements() {} } }) },
    createView: () => ({ show() {}, dispose() {} }),
    scene: { getUnclaimedRelations: () => [], on: (ev, fn) => { (handlers[ev] ??= []).push(fn) } },
    onDeclarationsChanged: () => { calls++ },
  })
  handlers.contextLoaded.forEach(fn => fn())
  assert.equal(calls, 1, 'the document edge re-hangs the tree (原則 #32)')
  assert.deepEqual(ctrl.supports(), {
    supports: [{ subject: 'solid_output_tray', of: 'solid_worktable' }, { subject: 'solid_part_bin', of: 'solid_worktable' }],
    contested: [],
  })
  handlers.unclaimedRelationsChanged.forEach(fn => fn())
  assert.equal(calls, 2)
  // Focus and speaker do not move a support — they do not re-hang.
  ctrl.setFocus(['part_bin'])
  assert.equal(calls, 2)
  // A ref the projection made no entity for is left out, not invented.
  doc = { ...doc, arrangements: [{ ref: 'g', by: 'ann', subject: 'ghost', sides: [{ of: 'worktable', contact: 'touching', toward: '+z' }] }] }
  assert.deepEqual(ctrl.supports().supports, [{ subject: 'solid_output_tray', of: 'solid_worktable' }])
})

test('S3: with no document, the scene\'s unclaimed relations (scene ids) are the supports', () => {
  const ctrl = new ArrangementController({
    ctxService: { on() {}, arrangementReport: () => null, getDoc: () => null },
    store: { getState: () => ({ actions: { contextSetArrangements() {} } }) },
    createView: () => ({ show() {}, dispose() {} }),
    scene: { getUnclaimedRelations: () => [{ subject: 's1', of: 's2', cell: 'touching:+z', was: 'above' }], on() {} },
  })
  assert.deepEqual(ctrl.supports(), { supports: [{ subject: 's1', of: 's2' }], contested: [] })
})
