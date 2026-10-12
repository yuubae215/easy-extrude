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

// ── ADR-165 PR2: the floor's read models are projected on entry ──────────────
//
// The browser run found the agreement question asked with no button to press:
// `criteriaLine` was projected only on a later re-projection, never when the
// floor opened over a freshly imported document (原則 #11). The agenda shared
// the gap. Asserted on the store the panels read, not on the service.

test('entering negotiation projects the criteria line and the agenda (not only on the next edit)', async () => {
  const { ContextService } = await import('../service/ContextService.js')
  const { useUIStore } = await import('../store/uiStore.js')
  const elements = ['takt', 'positionAccuracy', 'holdMargin', 'equipmentCost', 'maintainability', 'humanClearance', 'stoppingDistance']
  const svc = new ContextService({ async importFromJson() { return { imported: 0, skipped: 0 } } })
  await svc.loadContext({
    version: 'context/0.6',
    actors: ['a', 'b'].map(ref => ({ ref, role: 'maintainer', endUser: true, mix: { D: 1, Q: 1, C: 1, S: 1 } })),
    requirements: ['a', 'b'].flatMap(o => elements.map(k => ({ ref: `crit_${o}_${k}`, by: o, owner: o, kpi: { name: k }, criterion: { op: '<=', value: 1 }, weight: 1 }))),
    specification: { layout: { version: 'layout/0.1', entities: [] } },
  }, { camera: null, renderer: null, container: null })

  const ctrl = makeCtrl()
  ctrl._ctxService = svc
  const cc = new ContextController(ctrl)
  cc._startNegotiation()

  const { context } = useUIStore.getState()
  assert.deepEqual(context.criteriaLine?.awaiting, ['a', 'b'], 'the agreement widget has its buttons on entry')
  assert.ok(Array.isArray(context.agendaRows))
  assert.ok(context.form.some(q => q.raisedBy === 'R12:unagreed-criteria'))
})

// ── ADR-165 PR3: the criteria hearing runs in the document intake ────────────
//
// The hearing lives outside the floor (ADR-106 D3), so it is driven here with
// the floor CLOSED: its read model must arrive on the document edge, its
// writes must not wait for negotiation, and opening "Try it" must record the
// trial — twice, when the person goes back and changes an expectation.

test('the hearing walks to "Try it" with the floor closed, and each look is recorded', async () => {
  const { ContextService } = await import('../service/ContextService.js')
  const { useUIStore } = await import('../store/uiStore.js')
  const { CRITERIA_HEARING_WIZARD } = await import('../context/WizardCatalog.js')
  const { hearingHistory } = await import('../context/CriteriaHearing.js')
  const elements = ['takt', 'positionAccuracy', 'holdMargin', 'equipmentCost', 'maintainability', 'humanClearance', 'stoppingDistance']
  const svc = new ContextService({ async importFromJson() { return { imported: 0, skipped: 0 } } })

  const ctrl = makeCtrl()
  ctrl._ctxService = svc
  const pushed = []
  ctrl._commandStack = { canUndo: false, push(c) { pushed.push(c) } }
  ctrl._refreshUndoRedoState = () => {}
  const cc = new ContextController(ctrl)
  cc._viewContext = () => ({ camera: null, renderer: null, container: null })

  await svc.loadContext({
    version: 'context/0.6',
    actors: [{ ref: 'a', role: 'ehs', endUser: true, mix: { D: 1, Q: 1, C: 1, S: 1 } }],
    requirements: elements.map(k => ({ ref: `crit_a_${k}`, by: 'a', owner: 'a', kpi: { name: k }, criterion: { op: k === 'humanClearance' ? '>=' : '<=', value: 10 }, weight: 1 })),
    specification: { layout: { version: 'layout/0.1', entities: [] } },
  }, { camera: null, renderer: null, container: null })
  assert.equal(cc.isNegotiation, false, 'the floor stays closed')
  assert.equal(useUIStore.getState().context.criteriaDoc?.actors.length, 1, 'the slice is projected on the document edge')

  const settle = () => new Promise(r => setTimeout(r, 0))
  cc.startWizard(CRITERIA_HEARING_WIZARD.id)
  assert.equal(useUIStore.getState().context.wizard.respondent, 'a')
  cc.wizardNext(); cc.wizardNext(); cc.wizardNext()
  await settle()
  const wiz = useUIStore.getState().context.wizard
  assert.equal(CRITERIA_HEARING_WIZARD.steps[wiz.index].id, 'trial')
  assert.equal(svc.getDoc().criteriaHearing?.trials.length, 1, 'opening "Try it" recorded trial 1')

  // Back to Step 3, loosen safety, try again: two trials, one round with the cut.
  cc.wizardBack()
  cc.hearingAnswer({ elements: { humanClearance: { criterion: { op: '>=', value: 4 } } } })
  await settle()
  cc.wizardNext()
  await settle()
  assert.equal(svc.getDoc().criteriaHearing.trials.length, 2)
  const [round] = hearingHistory(svc.getDoc())
  assert.equal(round.afterTrial, 1)
  assert.equal(round.safetyCut, true)
  assert.equal(useUIStore.getState().context.criteriaDoc.criteriaHearing.trials.length, 2, 'the panel sees what the doc says')
  assert.ok(pushed.length >= 3, 'every write is one undoable command')
  assert.deepEqual(ctrl._uiView.toasts, [], 'nothing was refused')
})
