/**
 * ContextService.test.js — ADR-050 Phase 1: canonical-document service + load
 * pipeline.
 *
 * Run with:  pnpm test:context  (THREE-free — importFromJson is mocked)
 *
 * The service is a side-effect coordinator over the pure `src/context/*` layer;
 * these tests verify the seams ADR-050 §3 specifies: single-entry load, document
 * immutability, decision approval as a doc mutation, doc-derived projection gate,
 * derivation bookkeeping, and the event contract. The pure projections themselves
 * are covered by ContextPhase4.test.js — here we only assert the wiring.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { ContextService } from './ContextService.js'
import { createBlankDoc } from '../context/DocBuilder.js'

const here = dirname(fileURLToPath(import.meta.url))
const exampleDir = join(here, '../../examples')

const load = name => JSON.parse(readFileSync(join(exampleDir, name), 'utf8'))
const factory  = () => load('factory_context.json')
const conflict = () => load('cell_conflict_context.json')
const region   = () => load('cell_region_context.json')
const phase2   = () => load('cell_phase2_context.json')   // requirements-only: empty layout

/** A fake SceneService recording importFromJson calls; no THREE, no DOM. */
function fakeScene() {
  const calls = []
  return {
    calls,
    async importFromJson(scene, vc, opts) {
      calls.push({ scene, vc, opts })
      return { imported: scene.objects?.length ?? 0, skipped: 0 }
    },
  }
}

const VC = { camera: null, renderer: null, container: null }

// ── loadContext: the single authoritative entry ─────────────────────────────

test('loadContext compiles, imports {clear:true}, and stores doc/result/compiled', async () => {
  const scene = fakeScene()
  const svc = new ContextService(scene)
  const doc = factory()

  const res = await svc.loadContext(doc, VC)

  assert.equal(svc.loaded, true)
  assert.strictEqual(svc.getDoc(), doc)
  assert.ok(svc.getValidatorResult())
  assert.ok(svc.getCompiled().layoutDsl)
  assert.equal(scene.calls.length, 1)
  assert.equal(scene.calls[0].opts.clear, true)
  assert.equal(res.imported, scene.calls[0].scene.objects.length)
})

test('loadContext emits contextLoaded with the payload', async () => {
  const svc = new ContextService(fakeScene())
  let payload = null
  svc.on('contextLoaded', p => { payload = p })

  const doc = factory()
  await svc.loadContext(doc, VC)

  assert.ok(payload)
  assert.strictEqual(payload.doc, doc)
  assert.ok(payload.compiled.layoutDsl)
  assert.ok(payload.importResult)
})

test('loadContext rebuilds derivation bookkeeping (refToId / linkIds / traceByFrom)', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(factory(), VC)

  // factory_context has a workbench entity and fastened/connects constraints.
  assert.ok(svc.getRefToId().size > 0)
  assert.ok(svc.getRefToId().has('workbench'))
  assert.ok(svc.getLinkIds().length > 0)
  // Trace map keys are requirement/decision refs (trace.from).
  assert.ok(svc.getTraceByFrom().size > 0)
})

test('loadContext rejects (does not mutate state) on an invalid document', async () => {
  const svc = new ContextService(fakeScene())
  await assert.rejects(() => svc.loadContext({ version: 'context/0.3', specification: 42 /* malformed layout */ }, VC))
  assert.equal(svc.loaded, false)
  assert.equal(svc.getDoc(), null)
})

// ── Blank / requirements-only docs (no renderable layout) ────────────────────

test('adoptDoc accepts a blank doc, imports an empty scene, and emits contextLoaded', async () => {
  const scene = fakeScene()
  const svc = new ContextService(scene)
  let payload = null
  svc.on('contextLoaded', p => { payload = p })

  const doc = createBlankDoc()
  const res = await svc.adoptDoc(doc, VC)

  assert.equal(svc.loaded, true)
  assert.strictEqual(svc.getDoc(), doc)
  assert.equal(svc.getCompiled(), null)           // no layout compiled for a blank doc
  assert.equal(scene.calls.length, 1)
  assert.equal(scene.calls[0].opts.clear, true)
  assert.equal(scene.calls[0].scene.objects.length, 0)
  assert.equal(res.imported, 0)
  assert.ok(payload)
  assert.strictEqual(payload.doc, doc)
  assert.equal(payload.compiled, null)
  // Derivation bookkeeping is reset to empty (no entities to map).
  assert.equal(svc.getRefToId().size, 0)
  assert.equal(svc.getLinkIds().length, 0)
})

test('loadContext imports an empty scene for a requirements-only (empty-layout) doc', async () => {
  const scene = fakeScene()
  const svc = new ContextService(scene)

  // cell_phase2 is a valid doc whose specification.layout has entities:[]
  // ("要求のみを検証する空レイアウト"). It must load without throwing.
  const doc = phase2()
  const res = await svc.loadContext(doc, VC)

  assert.equal(svc.loaded, true)
  assert.ok(svc.getCompiled().layoutDsl)
  assert.equal(scene.calls.length, 1)
  assert.equal(scene.calls[0].scene.objects.length, 0)
  assert.equal(res.imported, 0)
})

// ── Decision approval is a document mutation (PoC parity → production) ────────

test('approveDecision flips status proposed→agreed in a NEW doc, never mutating the input', async () => {
  const svc = new ContextService(fakeScene())
  const doc = conflict()
  await svc.loadContext(doc, VC)

  const before = svc.getDoc()
  await svc.approveDecision('d_standoff', VC)

  // input doc untouched (PHILOSOPHY #6)
  assert.equal(doc.decisions.find(d => d.ref === 'd_standoff').status, 'proposed')
  // new doc adopted
  assert.notStrictEqual(svc.getDoc(), before)
  assert.equal(svc.getDoc().decisions.find(d => d.ref === 'd_standoff').status, 'agreed')
})

test('approveDecision does NOT regenerate the scene (geometry invariant under status flip)', async () => {
  const scene = fakeScene()
  const svc = new ContextService(scene)
  await svc.loadContext(conflict(), VC)
  assert.equal(scene.calls.length, 1) // only the initial load

  await svc.approveDecision('d_standoff', VC)
  assert.equal(scene.calls.length, 1) // no re-import
})

test('approveDecision emits contextChanged and decisionApproved', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  const events = []
  svc.on('contextChanged',  () => events.push('contextChanged'))
  svc.on('decisionApproved', ({ ref }) => events.push(`decisionApproved:${ref}`))
  await svc.approveDecision('d_standoff', VC)

  assert.ok(events.includes('contextChanged'))
  assert.ok(events.includes('decisionApproved:d_standoff'))
})

test('approvedRefs gate is doc-derived: matrix cell goes proposed → resolved on approval', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  const cellKey = 'vision_engineer|v_camera_standoff'
  assert.equal(svc.projectMatrix().cells[cellKey].state, 'proposed')

  await svc.approveDecision('d_standoff', VC)
  assert.equal(svc.projectMatrix().cells[cellKey].state, 'resolved')
})

test('unapproveDecision reverses approval (agreed → proposed) — the undo path', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)
  await svc.approveDecision('d_standoff', VC)
  assert.equal(svc.getDoc().decisions.find(d => d.ref === 'd_standoff').status, 'agreed')

  await svc.unapproveDecision('d_standoff', VC)
  assert.equal(svc.getDoc().decisions.find(d => d.ref === 'd_standoff').status, 'proposed')
  assert.equal(svc.projectMatrix().cells['vision_engineer|v_camera_standoff'].state, 'proposed')
})

// ── applyAdmissible: region edit regenerates + reports conflict changes ───────

test('applyAdmissible regenerates the scene and re-validates against the new doc', async () => {
  const scene = fakeScene()
  const svc = new ContextService(scene)
  await svc.loadContext(region(), VC)
  assert.equal(scene.calls.length, 1)

  // Move one footprint to a benign location; the call must re-import + re-validate.
  const req = region().requirements.find(r => (r.constrains?.length ?? 0) === 1 && r.admissible?.region)
  const result = await svc.applyAdmissible(req.ref, { region: req.admissible.region }, VC)
  assert.equal(scene.calls.length, 2)
  assert.ok(Array.isArray(result.conflicts))
})

test('conflictsChanged fires only when the conflict set actually differs', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  let fired = 0
  svc.on('conflictsChanged', () => { fired++ })
  // Approving a decision does not change validateContext().conflicts (resolvedBy
  // is set independent of status) → no conflictsChanged.
  await svc.approveDecision('d_standoff', VC)
  assert.equal(fired, 0)
})

// ── projection wrappers thread through doc + validatorResult ──────────────────

test('projection wrappers return populated structures for the conflict scenario', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  const matrix = svc.projectMatrix()
  assert.deepStrictEqual(matrix.actors, ['mech_engineer', 'robot_engineer', 'vision_engineer'])
  assert.ok(svc.projectOrder().length > 0)
  assert.ok(Array.isArray(svc.projectForm()))
})

// ── whyTree / recoverProvenance accessors (ADR-052) ───────────────────────────

test('whyTree returns null before load and the tree after load', async () => {
  const svc = new ContextService(fakeScene())
  assert.equal(svc.whyTree(), null)
  await svc.loadContext(factory(), VC)
  const tree = svc.whyTree()
  assert.ok(tree.nodes.length > 0)
  assert.ok(tree.roots.includes('intent:g_automate'))
})

test('recoverProvenance maps a scene entity id back to its Why provenance', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(factory(), VC)

  // _refToId maps the layout ref → scene id; reverse it for a known ref.
  const sceneId = svc.getRefToId().get('container_a')
  assert.ok(sceneId, 'container_a was compiled into the scene')

  const p = svc.recoverProvenance(sceneId)
  assert.equal(p.found, true)
  assert.ok(p.intents.includes('g_automate'))
})

test('recoverProvenance returns null with no doc loaded', () => {
  const svc = new ContextService(fakeScene())
  assert.equal(svc.recoverProvenance('anything'), null)
})

test('recoverProvenance joins the R6 Gap by variable (additive `gaps` field, ADR-052 Phase 2)', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  const sceneId = svc.getRefToId().get('robot_base_zone')
  assert.ok(sceneId, 'robot_base_zone was compiled into the scene')

  const p = svc.recoverProvenance(sceneId)
  assert.equal(p.found, true)
  // `gaps` is always present (additive contract) and every entry is a validator
  // R6 conflict on one of the entity's constrained variables — the service joins
  // the gap in; recoverProvenance itself never re-implements R6.
  assert.ok(Array.isArray(p.gaps))
  const conflictVars = new Set(svc.getValidatorResult().conflicts.map(c => c.variable))
  for (const g of p.gaps) {
    assert.ok(p.variables.includes(g.variable), 'gap variable is among the constrained variables')
    assert.ok(conflictVars.has(g.variable), 'gap variable is a live R6 conflict')
    assert.equal(typeof g.resolved, 'boolean')
  }
})

test('recoverProvenance returns found:false (with empty gaps) for a non-derived id', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)
  const p = svc.recoverProvenance('not-a-context-entity')
  assert.equal(p.found, false)
  assert.deepEqual(p.gaps, [])
})
