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
