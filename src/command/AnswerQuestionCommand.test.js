/**
 * AnswerQuestionCommand.test.js — ADR-050 Phase 4.
 *
 * Verifies the undoable form-answer seam: execute() applies afterDoc (driving
 * scene regeneration), undo() restores beforeDoc (also regenerating), and the
 * before/after snapshots are never mutated (input-immutable — PHILOSOPHY #6).
 * THREE-free — importFromJson is mocked.
 *
 * Run with:  pnpm test:context
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { ContextService } from '../service/ContextService.js'
import { createAnswerQuestionCommand } from './AnswerQuestionCommand.js'
import { applyQuestionAnswer } from '../context/FormApplication.js'

const here    = dirname(fileURLToPath(import.meta.url))
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

// The conflict context has r_eoat_clearance with no KPI — a natural R9 question target.
const QUESTION_KPI = {
  ref:        'oq_kpi_r_eoat_clearance',
  target:     'r_eoat_clearance',
  answerKind: 'kpiCriterion',
}
const ANSWER_KPI = {
  kpi:       { name: 'clearance', expr: 'eoat_clearance(v_robot_base_x)', unit: 'mm' },
  criterion: { op: '>=', value: 50 },
}

test('execute() applies afterDoc and regenerates scene', async () => {
  const scene = fakeScene()
  const svc   = new ContextService(scene)
  await svc.loadContext(conflict(), VC)
  const beforeDoc = svc.getDoc()
  const afterDoc  = applyQuestionAnswer(beforeDoc, QUESTION_KPI, ANSWER_KPI)

  const cmd = createAnswerQuestionCommand(svc, QUESTION_KPI.ref, beforeDoc, afterDoc, VC)
  await cmd.execute()

  const req = svc.getDoc().requirements.find(r => r.ref === 'r_eoat_clearance')
  assert.ok(req.kpi, 'KPI should be set after execute')
  assert.equal(req.kpi.name, 'clearance')
  assert.equal(scene.calls.length, 2, 'scene regenerated once on execute (initial load + execute)')
})

test('undo() restores beforeDoc and regenerates scene', async () => {
  const scene = fakeScene()
  const svc   = new ContextService(scene)
  await svc.loadContext(conflict(), VC)
  const beforeDoc = svc.getDoc()
  const afterDoc  = applyQuestionAnswer(beforeDoc, QUESTION_KPI, ANSWER_KPI)

  const cmd = createAnswerQuestionCommand(svc, QUESTION_KPI.ref, beforeDoc, afterDoc, VC)
  await cmd.execute()
  await cmd.undo()

  const req = svc.getDoc().requirements.find(r => r.ref === 'r_eoat_clearance')
  assert.ok(!req.kpi, 'KPI should be absent after undo')
  assert.equal(scene.calls.length, 3, 'scene regenerated on undo as well')
})

test('before/after docs are not mutated (PHILOSOPHY #6 — input-immutable)', async () => {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(conflict(), VC)
  const beforeDoc = svc.getDoc()
  const afterDoc  = applyQuestionAnswer(beforeDoc, QUESTION_KPI, ANSWER_KPI)

  const snapBefore = JSON.parse(JSON.stringify(beforeDoc))
  const snapAfter  = JSON.parse(JSON.stringify(afterDoc))

  const cmd = createAnswerQuestionCommand(svc, QUESTION_KPI.ref, beforeDoc, afterDoc, VC)
  await cmd.execute()
  await cmd.undo()

  assert.deepStrictEqual(beforeDoc, snapBefore, 'beforeDoc must not be mutated')
  assert.deepStrictEqual(afterDoc,  snapAfter,  'afterDoc must not be mutated')
})

test('redo after undo re-applies afterDoc (round-trip)', async () => {
  const scene = fakeScene()
  const svc   = new ContextService(scene)
  await svc.loadContext(conflict(), VC)
  const beforeDoc = svc.getDoc()
  const afterDoc  = applyQuestionAnswer(beforeDoc, QUESTION_KPI, ANSWER_KPI)

  const cmd = createAnswerQuestionCommand(svc, QUESTION_KPI.ref, beforeDoc, afterDoc, VC)
  await cmd.execute()   // call 2
  await cmd.undo()      // call 3
  await cmd.execute()   // call 4 — redo

  const req = svc.getDoc().requirements.find(r => r.ref === 'r_eoat_clearance')
  assert.ok(req.kpi, 'KPI should be set again after redo')
  assert.equal(scene.calls.length, 4)
})
