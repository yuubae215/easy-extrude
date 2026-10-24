/**
 * ArrangementReport — declared relations read against a real layout (ADR-168 S1),
 * the validator rule R15 over a Context document, and the viewer's round trip.
 * The layout is the single-arm pick & place template.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reportArrangements, hostByRef } from './ArrangementReport.js'
import { compileLayout } from './LayoutCompiler.js'
import { decompileLayout } from './LayoutDecompiler.js'
import { validateLayoutDsl } from './LayoutValidator.js'
import { validateContext } from '../context/ContextValidator.js'
import { docFromLayout } from '../context/DocBuilder.js'
import { CONTEXT_DSL_VERSION } from '../context/ContextDslSchema.js'

const template = JSON.parse(readFileSync(new URL('../../examples/layout_pick_place_cell.json', import.meta.url), 'utf8'))
const actors = [{ ref: 'ann' }, { ref: 'ben' }]
/** The template plus one declared viewer standing in front of the cell (−X), facing +X. */
const withViewer = () => {
  const layout = JSON.parse(JSON.stringify(template))
  layout.entities.push({ ref: 'operator', type: 'CoordinateFrame', name: 'Operator', frameRole: 'viewer', position: { x: -1500, y: 0, z: 1600 } })
  return layout
}
const side = (report, i = 0) => report.sides[i]

test('the bin on the workbench: touching its +z face matches; "above" does not — touching is not above', () => {
  const r = reportArrangements(template, [
    { ref: 'a1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching', toward: '+z' }] },
    { ref: 'a2', by: 'ben', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'apart', toward: 'above' }] },
  ], actors)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(side(r.reports[0]).status, { contact: 'match', toward: 'match' })
  assert.deepEqual(side(r.reports[1]).status, { contact: 'mismatch', toward: 'mismatch' })
  assert.equal(side(r.reports[0]).state.contact, 'touching')
  assert.deepEqual(side(r.reports[0]).state.faces, ['+z'])
})

test('two people disagreeing about the bin is a claim conflict, kept side by side — nothing overwritten', () => {
  const r = reportArrangements(template, [
    { ref: 'a1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching' }] },
    { ref: 'a2', by: 'ben', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'apart' }] },
  ], actors)
  assert.equal(r.reports.length, 2)
  assert.equal(r.conflicts.length, 1)
  assert.deepEqual(r.conflicts[0].between, ['a1', 'a2'])
})

test('a workpiece sits on the bin\'s INNER floor (+z), and its mobility is the template\'s fastened link — looked up, not declared', () => {
  const r = reportArrangements(template, [
    { ref: 'w1', by: 'ann', subject: 'work_1', sides: [{ of: 'part_bin', contact: 'touching', toward: '+z' }] },
  ], actors)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(side(r.reports[0]).status, { contact: 'match', toward: 'match' })
  // work_1_origin → part_bin_floor (fixed): both refs resolve to their Solids.
  assert.deepEqual(side(r.reports[0]).mobility, { kind: 'declared', jointType: 'fixed' })
})

test('with no kinematic link the mobility is undeclared — never filled in', () => {
  const r = reportArrangements(template, [
    { ref: 'b', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable' }] },
  ], actors)
  assert.deepEqual(side(r.reports[0]).mobility, { kind: 'undeclared' })
})

test('front/back/left/right are read from the declared viewer: seen from the front of the cell, the bin (+y) is on the left of the tray (−y)', () => {
  const layout = withViewer()
  const r = reportArrangements(layout, [
    { ref: 'l', by: 'ann', subject: 'part_bin', sides: [{ of: 'output_tray', contact: 'apart', toward: { dir: 'left', viewer: 'operator' } }] },
    { ref: 'r', by: 'ben', subject: 'part_bin', sides: [{ of: 'output_tray', contact: 'apart', toward: { dir: 'right', viewer: 'operator' } }] },
  ], actors)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(side(r.reports[0]).status, { contact: 'match', toward: 'match' })
  assert.equal(side(r.reports[1]).status.toward, 'mismatch')
  assert.equal(r.conflicts.length, 1, 'same viewer, opposite words: a conflict')
})

test('a shape error stops the reading and is returned — nothing is dropped silently', () => {
  const r = reportArrangements(template, [{ ref: 'x', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'apart', toward: { dir: 'left' } }] }], actors)
  assert.equal(r.reports.length, 0)
  assert.ok(r.errors.some(e => /needs the viewer it is seen from/.test(e)))
})

test('hostByRef: an Origin and a user frame belong to their Solid', () => {
  const h = hostByRef(template.entities)
  assert.equal(h.get('work_1_origin'), 'work_1')
  assert.equal(h.get('part_bin_floor'), 'part_bin')
  assert.equal(h.get('robot_base'), 'robot_base')
})

// ── R15 through the Context validator ────────────────────────────────────────

const docWith = (arrangements, layout = template) => {
  const doc = docFromLayout(layout)
  doc.actors = actors
  doc.arrangements = arrangements
  return doc
}

test('a new document is written as context/0.7', () => {
  assert.equal(CONTEXT_DSL_VERSION, 'context/0.7')
  assert.equal(docFromLayout(template).version, 'context/0.7')
})

test('R15: a valid arrangement passes; its conflicts are reported beside R6\'s, not as errors', () => {
  const res = validateContext(docWith([
    { ref: 'a1', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching' }] },
    { ref: 'a2', by: 'ben', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'apart' }] },
  ]))
  assert.deepEqual(res.errors, [])
  assert.equal(res.arrangementConflicts.length, 1)
})

test('R15: an arrangement by nobody, or about a thing not in the layout, is an error', () => {
  const res = validateContext(docWith([
    { ref: 'a1', subject: 'part_bin', sides: [{ of: 'worktable' }] },
    { ref: 'a2', by: 'ann', subject: 'ghost', sides: [{ of: 'worktable' }] },
  ]))
  assert.ok(res.errors.some(e => /by \(who claims it\) is required/.test(e)))
  assert.ok(res.errors.some(e => /subject "ghost"/.test(e)))
  assert.deepEqual(res.arrangementConflicts, [])
})

test('R15 is silent on a document without arrangements (no rule fires on absence of a claim)', () => {
  const res = validateContext(docWith(undefined))
  assert.deepEqual(res.arrangementConflicts, [])
  assert.ok(!res.errors.some(e => /arrangement/.test(e)))
})

// ── The viewer: layout rules and the round trip ──────────────────────────────

test('a viewer is not a robot frame, not a vision camera, not a TF child (for now)', () => {
  const bad = (extra) => {
    const layout = withViewer()
    Object.assign(layout.entities.at(-1), extra)
    return validateLayoutDsl(layout).errors.join('\n')
  }
  assert.match(bad({ robotRole: 'base' }), /cannot also be a robot frame/)
  assert.match(bad({ camera: {} }), /cannot also be a vision camera/)
  assert.match(bad({ parentRef: 'robot_base' }), /under a parent frame is not decided yet/)
  assert.match(bad({ frameRole: 'watcher' }), /frameRole "watcher" is not one of viewer/)
  assert.deepEqual(validateLayoutDsl(withViewer()).errors, [])
})

test('the viewer survives layout → scene → layout (dropping it would orphan every relative direction)', () => {
  const scene = compileLayout(withViewer())
  const frame = scene.objects.find(o => o.type === 'CoordinateFrame' && o.name === 'Operator')
  assert.equal(frame.frameRole, 'viewer')
  const back = decompileLayout(scene).dsl
  const viewer = back.entities.find(e => e.name === 'Operator')
  assert.equal(viewer.frameRole, 'viewer')
  // Ordinary frames stay byte-identical: no frameRole key at all.
  assert.ok(!('frameRole' in back.entities.find(e => e.robotRole === 'base')))
})

test('a live viewer frame is written to the save file; an ordinary frame writes null', async () => {
  const { serializeScene } = await import('../service/SceneSerializer.js')
  const { CoordinateFrame } = await import('../domain/CoordinateFrame.js')
  const viewer = new CoordinateFrame('cf_op', 'Operator', null, null)
  viewer.frameRole = 'viewer'
  const plain = new CoordinateFrame('cf_plain', 'Plain', null, null)
  const out = serializeScene({ objects: new Map([['cf_op', viewer], ['cf_plain', plain]]), links: new Map() })
  assert.equal(out.objects.find(o => o.id === 'cf_op').frameRole, 'viewer')
  assert.equal(out.objects.find(o => o.id === 'cf_plain').frameRole, null)
})
