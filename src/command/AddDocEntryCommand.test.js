/**
 * AddDocEntryCommand unit tests (ADR-051 Phase 1) — THREE-free, bare `node --test`.
 *
 * Uses the same fake-ContextService pattern as AnswerQuestionCommand.test.js.
 * Run with: pnpm test:context
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createAddDocEntryCommand } from './AddDocEntryCommand.js'
import { createBlankDoc, addActor } from '../context/DocBuilder.js'

/** Minimal ContextService stub recording applyContextDoc calls. */
function makeService() {
  const calls = []
  return {
    calls,
    async applyContextDoc(doc, _vc, opts) {
      calls.push({ doc: JSON.parse(JSON.stringify(doc)), opts: { ...opts } })
      return {}
    },
  }
}

const vc = { camera: null, renderer: null, container: null }

describe('createAddDocEntryCommand', () => {
  let service, beforeDoc, afterDoc

  beforeEach(() => {
    service   = makeService()
    beforeDoc = createBlankDoc('before')
    afterDoc  = addActor(beforeDoc, { ref: 'a_x', role: 'developer' })
  })

  it('execute() calls applyContextDoc with afterDoc and regenerate:true', async () => {
    const cmd = createAddDocEntryCommand(service, beforeDoc, afterDoc, 'Actor 追加', vc)
    await cmd.execute()
    assert.equal(service.calls.length, 1)
    assert.deepEqual(service.calls[0].doc, afterDoc)
    assert.equal(service.calls[0].opts.regenerate, true)
  })

  it('undo() calls applyContextDoc with beforeDoc and regenerate:true', async () => {
    const cmd = createAddDocEntryCommand(service, beforeDoc, afterDoc, 'Actor 追加', vc)
    await cmd.execute()
    await cmd.undo()
    assert.equal(service.calls.length, 2)
    assert.deepEqual(service.calls[1].doc, beforeDoc)
    assert.equal(service.calls[1].opts.regenerate, true)
  })

  it('execute() does not mutate beforeDoc', async () => {
    const cmd = createAddDocEntryCommand(service, beforeDoc, afterDoc, 'Actor 追加', vc)
    const snap = JSON.parse(JSON.stringify(beforeDoc))
    await cmd.execute()
    assert.deepEqual(beforeDoc, snap)
  })

  it('redo round-trip: execute → undo → execute applies afterDoc twice', async () => {
    const cmd = createAddDocEntryCommand(service, beforeDoc, afterDoc, 'Actor 追加', vc)
    await cmd.execute()
    await cmd.undo()
    await cmd.execute()
    assert.equal(service.calls.length, 3)
    assert.deepEqual(service.calls[0].doc, afterDoc)
    assert.deepEqual(service.calls[1].doc, beforeDoc)
    assert.deepEqual(service.calls[2].doc, afterDoc)
  })
})
