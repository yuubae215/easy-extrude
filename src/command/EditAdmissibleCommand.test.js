/**
 * EditAdmissibleCommand.test.js — ADR-050 Phase 3.
 *
 * Verifies the undoable region-edit seam: execute() rewrites the canonical
 * document's admissible region (regenerating the derived scene), the live R6
 * conflict follows from the new region, and undo() restores the original region
 * (and conflict). THREE-free — importFromJson is mocked.
 *
 * Run with:  pnpm test:context
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { ContextService } from '../service/ContextService.js'
import { createEditAdmissibleCommand } from './EditAdmissibleCommand.js'

const here = dirname(fileURLToPath(import.meta.url))
const region = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_region_context.json'), 'utf8'))

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
const REQ = 'r_vision_footprint'
const VAR = 'v_base_footprint'
const ORIG = { region: { x: [600, 1200], y: [-300, 300] } }  // disjoint from mech [1300,1800] → gap [1200,1300]
const MOVED = { region: { x: [300, 900], y: [-300, 300] } }  // still disjoint → wider gap [900,1300]
// NOTE: the edit keeps the v_base_footprint conflict alive. A region that fully
// resolved it would orphan decision d_footprint (resolves a conflict R6 no longer
// emits) and compileContext would reject the doc (ADR-049 invariant 7) — a real
// domain rule, exercised separately by the controller, not the command seam.

const varConflict = (svc) =>
  svc.getValidatorResult().conflicts.find(c => c.variable === VAR) ?? null

test('execute() rewrites the admissible region and regenerates the scene', async () => {
  const scene = fakeScene()
  const svc = new ContextService(scene)
  await svc.loadContext(region(), VC)
  assert.equal(scene.calls.length, 1)        // initial load
  assert.ok(varConflict(svc))                // disjoint footprints conflict

  const cmd = createEditAdmissibleCommand(svc, REQ, ORIG, MOVED, VC)
  await cmd.execute()

  const edited = svc.getDoc().requirements.find(r => r.ref === REQ)
  assert.deepEqual(edited.admissible.region, MOVED.region)
  assert.equal(edited.admissible.source, 'stated')
  assert.equal(scene.calls.length, 2)        // region edit regenerated (geometry changed)
  assert.ok(varConflict(svc))                // still disjoint — conflict persists with the new gap
})

test('undo() restores the original region', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(region(), VC)

  const cmd = createEditAdmissibleCommand(svc, REQ, ORIG, MOVED, VC)
  await cmd.execute()
  await cmd.undo()

  const restored = svc.getDoc().requirements.find(r => r.ref === REQ)
  assert.deepEqual(restored.admissible.region, ORIG.region)
})

test('redo (re-execute) re-applies the edit — round-trips cleanly', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(region(), VC)

  const cmd = createEditAdmissibleCommand(svc, REQ, ORIG, MOVED, VC)
  await cmd.execute()
  await cmd.undo()
  await cmd.execute() // redo path
  assert.deepEqual(svc.getDoc().requirements.find(r => r.ref === REQ).admissible.region, MOVED.region)
})

test('the source document is never mutated (input-immutable — PHILOSOPHY #6)', async () => {
  const doc = region()
  const svc = new ContextService(fakeScene())
  await svc.loadContext(doc, VC)

  await createEditAdmissibleCommand(svc, REQ, ORIG, MOVED, VC).execute()

  // The originally-loaded object still carries the original region.
  assert.deepEqual(doc.requirements.find(r => r.ref === REQ).admissible.region, ORIG.region)
})
