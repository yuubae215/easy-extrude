/**
 * ContextController.test.js — ADR-134: `selectTemplate` gates the destructive
 * scene replacement behind `commandStack.canUndo`, not unconditionally.
 *
 * Run via `pnpm test:context` (node --test). THREE-free: driven with a fake
 * `ctrl` (mirrors the `makeCtrl` pattern in GraspController.test.js). The real
 * (DOM-free) `_loadTemplate` is stubbed on the instance so these tests assert
 * only the confirm-gate branch, not the downstream `_viewContext()`/DOM-touching
 * load machinery (that path is exercised by e2e, not this bare-node lane).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextController } from './ContextController.js'

function makeCtrl({ canUndo = false } = {}) {
  return {
    _commandStack: { canUndo },
    _uiView: {
      toasts: [],
      confirmCalls: [],
      showToast(msg, opt) { this.toasts.push({ msg, opt }) },
      showConfirmDialog(message, callback, options) {
        this.confirmCalls.push({ message, callback, options })
      },
    },
    _ctxService: {
      on() {},
    },
  }
}

function setup(opts = {}) {
  const ctrl = makeCtrl(opts)
  const cc   = new ContextController(ctrl)
  const loadCalls = []
  cc._loadTemplate = (meta) => loadCalls.push(meta.id)
  return { ctrl, cc, loadCalls }
}

test('canUndo === false: template loads immediately, no confirm dialog (unedited project has nothing to lose)', () => {
  const { ctrl, cc, loadCalls } = setup({ canUndo: false })
  cc.selectTemplate('cell_simple')
  assert.deepEqual(loadCalls, ['cell_simple'])
  assert.equal(ctrl._uiView.confirmCalls.length, 0)
})

test('canUndo === true: confirm dialog is shown and the load is deferred until it resolves', () => {
  const { ctrl, cc, loadCalls } = setup({ canUndo: true })
  cc.selectTemplate('cell_simple')

  assert.deepEqual(loadCalls, [], 'must not load before the user answers the confirm')
  assert.equal(ctrl._uiView.confirmCalls.length, 1)

  const { callback } = ctrl._uiView.confirmCalls[0]
  callback(false)
  assert.deepEqual(loadCalls, [], 'cancel must not load')

  callback(true)
  assert.deepEqual(loadCalls, ['cell_simple'], 'confirm loads exactly the selected template')
})

test('unknown id: toasts a warning through either canUndo branch, never asks to confirm or loads', () => {
  for (const canUndo of [false, true]) {
    const { ctrl, cc, loadCalls } = setup({ canUndo })
    cc.selectTemplate('does-not-exist')
    assert.deepEqual(loadCalls, [])
    assert.equal(ctrl._uiView.confirmCalls.length, 0)
    assert.equal(ctrl._uiView.toasts.length, 1)
  }
})
