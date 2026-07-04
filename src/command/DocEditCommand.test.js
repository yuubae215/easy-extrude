/**
 * DocEditCommand unit tests (ADR-058 Phase 2) — THREE-free, bare `node --test`.
 *
 * The generic before/after snapshot command underlying the in-place edit / remove
 * paths (and, by delegation, AddDocEntryCommand). Same fake-ContextService pattern.
 * Run with: pnpm test:context
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createDocEditCommand } from './DocEditCommand.js'
import { createBlankDoc, addActor, updateActor, removeDocEntry } from '../context/DocBuilder.js'

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

describe('createDocEditCommand', () => {
  let service, beforeDoc, afterDoc

  beforeEach(() => {
    service   = makeService()
    beforeDoc = addActor(createBlankDoc('p'), { ref: 'a_x', role: 'developer' })
    afterDoc  = updateActor(beforeDoc, { ref: 'a_x', role: 'maintainer' })
  })

  it('execute() applies afterDoc with regenerate:true', async () => {
    const cmd = createDocEditCommand(service, beforeDoc, afterDoc, 'Edit Actor', vc)
    await cmd.execute()
    assert.equal(service.calls.length, 1)
    assert.deepEqual(service.calls[0].doc, afterDoc)
    assert.equal(service.calls[0].opts.regenerate, true)
  })

  it('undo() restores beforeDoc with regenerate:true', async () => {
    const cmd = createDocEditCommand(service, beforeDoc, afterDoc, 'Edit Actor', vc)
    await cmd.execute()
    await cmd.undo()
    assert.equal(service.calls.length, 2)
    assert.deepEqual(service.calls[1].doc, beforeDoc)
  })

  it('execute() does not mutate the snapshots', async () => {
    const cmd = createDocEditCommand(service, beforeDoc, afterDoc, 'Edit Actor', vc)
    const snap = JSON.parse(JSON.stringify(beforeDoc))
    await cmd.execute()
    assert.deepEqual(beforeDoc, snap)
  })

  it('supports a remove edit (afterDoc has the entry gone)', async () => {
    const removed = removeDocEntry(beforeDoc, 'actor', 'a_x')
    const cmd = createDocEditCommand(service, beforeDoc, removed, 'Remove Actor', vc)
    await cmd.execute()
    assert.equal(service.calls[0].doc.actors.length, 0)
    await cmd.undo()
    assert.equal(service.calls[1].doc.actors.length, 1)
  })
})
