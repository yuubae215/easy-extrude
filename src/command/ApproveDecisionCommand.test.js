/**
 * ApproveDecisionCommand.test.js — ADR-050 Phase 2.
 *
 * Verifies the undoable approval seam: execute() flips the canonical document's
 * Decision status proposed→agreed (driving the matrix to `resolved`), undo()
 * reverses it, and neither path regenerates the scene (status flip is geometry-
 * invariant). THREE-free — importFromJson is mocked.
 *
 * Run with:  pnpm test:context
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { ContextService } from '../service/ContextService.js'
import { createApproveDecisionCommand } from './ApproveDecisionCommand.js'

const here = dirname(fileURLToPath(import.meta.url))
const conflict = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_conflict_context.json'), 'utf8'))

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
const CELL = 'vision_engineer|v_camera_standoff'

test('execute() approves the decision: status agreed + matrix cell resolved', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  const cmd = createApproveDecisionCommand(svc, 'd_standoff', VC)
  cmd.execute()

  assert.equal(svc.getDoc().decisions.find(d => d.ref === 'd_standoff').status, 'agreed')
  assert.equal(svc.projectMatrix().cells[CELL].state, 'resolved')
})

test('undo() reverses the approval: status proposed + matrix cell proposed', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  const cmd = createApproveDecisionCommand(svc, 'd_standoff', VC)
  cmd.execute()
  cmd.undo()

  assert.equal(svc.getDoc().decisions.find(d => d.ref === 'd_standoff').status, 'proposed')
  assert.equal(svc.projectMatrix().cells[CELL].state, 'proposed')
})

test('approval is geometry-invariant: neither execute nor undo regenerates the scene', async () => {
  const scene = fakeScene()
  const svc = new ContextService(scene)
  await svc.loadContext(conflict(), VC)
  assert.equal(scene.calls.length, 1) // initial load only

  const cmd = createApproveDecisionCommand(svc, 'd_standoff', VC)
  cmd.execute()
  cmd.undo()
  assert.equal(scene.calls.length, 1) // no re-import on approve / unapprove
})

test('re-execute (redo) re-approves — round-trips cleanly', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)

  const cmd = createApproveDecisionCommand(svc, 'd_standoff', VC)
  cmd.execute()
  cmd.undo()
  cmd.execute() // redo path
  assert.equal(svc.getDoc().decisions.find(d => d.ref === 'd_standoff').status, 'agreed')
  assert.equal(svc.projectMatrix().cells[CELL].state, 'resolved')
})
