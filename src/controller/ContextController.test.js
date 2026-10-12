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

// ── ADR-165 PR4: "Try it" asks core/, and the look records what was shown ─────
//
// The fake BFF stands where the real one does (`ctrl._service.bff`). Two
// properties are asked that one pass cannot see: an answer that arrives after
// the line moved is DROPPED (the line it describes is no longer the document's),
// and a solver that cannot be reached still records the look with `seen: []`
// and says why — never a silent no-op, never a fabricated candidate.

const ELEMENTS = ['takt', 'positionAccuracy', 'holdMargin', 'equipmentCost', 'maintainability', 'humanClearance', 'stoppingDistance']

function wireAnswer(refs) {
  return {
    contractVersion: 9,
    candidates: [{ id: 'nominal:gantry', label: 'Gantry', actuals: ELEMENTS.map(k => ({ key: k, value: 5, basis: 'nominal', range: [4, 6] })) }],
    interest: refs.flatMap(r => ['D', 'Q', 'C', 'S'].map(c => ({ actor: r, category: c, value: c === 'S' ? 1 : 0 }))),
    proposal: { kind: 'notAsked' },
  }
}

async function hearingSetup(bff, endUsers = ['a']) {
  const { ContextService } = await import('../service/ContextService.js')
  const svc = new ContextService({ async importFromJson() { return { imported: 0, skipped: 0 } } })
  const ctrl = makeCtrl()
  ctrl._ctxService = svc
  ctrl._service = { bff }
  const pushed = []
  ctrl._commandStack = { canUndo: false, push(c) { pushed.push(c) } }
  ctrl._refreshUndoRedoState = () => {}
  const cc = new ContextController(ctrl)
  cc._viewContext = () => ({ camera: null, renderer: null, container: null })
  await svc.loadContext({
    version: 'context/0.6',
    actors: endUsers.map(r => ({ ref: r, role: 'ehs', endUser: true, mix: { D: 1, Q: 1, C: 1, S: 1 } })),
    requirements: endUsers.flatMap(r => ELEMENTS.map(k => ({ ref: `crit_${r}_${k}`, by: r, owner: r, kpi: { name: k }, criterion: { op: k === 'humanClearance' ? '>=' : '<=', value: 10 }, weight: 1 }))),
    specification: { layout: { version: 'layout/0.1', entities: [] } },
  }, { camera: null, renderer: null, container: null })
  return { svc, ctrl, cc, pushed }
}

const settle = () => new Promise(r => setTimeout(r, 0))

test('"Try it" records the candidates core/ showed, and the interest lands on the store', async () => {
  const { useUIStore } = await import('../store/uiStore.js')
  const { CRITERIA_HEARING_WIZARD } = await import('../context/WizardCatalog.js')
  const asked = []
  const { svc, cc, ctrl } = await hearingSetup({ async criteriaTrial(req) { asked.push(req); return wireAnswer(['a']) } })
  cc.startWizard(CRITERIA_HEARING_WIZARD.id)
  cc.wizardNext(); cc.wizardNext()
  await cc.wizardNext()
  await settle()
  assert.equal(asked.length, 1)
  assert.equal(asked[0].line.endUsers[0].ref, 'a')
  assert.equal(asked[0].line.endUsers[0].elements.length, 7, 'the whole line is sent, in catalog order')
  assert.equal('contractVersion' in asked[0], false, 'the BFF stamps the version, not the client')
  const [trial] = svc.getDoc().criteriaHearing.trials
  assert.deepEqual(trial.seen.map(c => c.id), ['nominal:gantry'])
  assert.deepEqual(trial.seen[0].actuals[0], { key: 'takt', value: 5, basis: 'nominal', range: [4, 6] })
  const ind = useUIStore.getState().context.criteriaIndicator
  assert.equal(ind.status, 'results')
  assert.equal(ind.interest.length, 4)
  // The pick is the person's, on that look.
  cc.hearingChoose('nominal:gantry')
  await settle()
  assert.equal(svc.getDoc().criteriaHearing.trials[0].chosen, 'nominal:gantry')
  assert.deepEqual(ctrl._uiView.toasts, [])
})

test('an answer that arrives after the line moved is dropped, never recorded as what was seen', async () => {
  const { CRITERIA_HEARING_WIZARD } = await import('../context/WizardCatalog.js')
  let release
  const gate = new Promise(r => { release = r })
  const { svc, cc } = await hearingSetup({ async criteriaTrial() { await gate; return wireAnswer(['a']) } })
  cc.startWizard(CRITERIA_HEARING_WIZARD.id)
  cc.wizardNext(); cc.wizardNext()
  const pending = cc.wizardNext()
  // While core/ is thinking, the person goes back and loosens safety.
  cc.hearingAnswer({ elements: { humanClearance: { criterion: { op: '>=', value: 4 } } } })
  await settle()
  release()
  await pending
  await settle()
  assert.equal(svc.getDoc().criteriaHearing?.trials?.length ?? 0, 0, 'the answer described a line the document no longer states')
})

test('an unreachable solver still records the look with seen = [] and names why', async () => {
  const { useUIStore } = await import('../store/uiStore.js')
  const { CRITERIA_HEARING_WIZARD } = await import('../context/WizardCatalog.js')
  const { svc, cc } = await hearingSetup(null)
  cc.startWizard(CRITERIA_HEARING_WIZARD.id)
  cc.wizardNext(); cc.wizardNext()
  await cc.wizardNext()
  await settle()
  assert.deepEqual(svc.getDoc().criteriaHearing.trials[0].seen, [])
  const ind = useUIStore.getState().context.criteriaIndicator
  assert.equal(ind.status, 'unavailable')
  assert.match(ind.message, /not reachable/)
})

test('a change to the agreed line carries the margin core/ assessed — or says it was not assessed', async () => {
  const { agreeToLine } = await import('../context/CriteriaLine.js')
  const { useUIStore } = await import('../store/uiStore.js')
  const asked = []
  const offerings = [{ actor: 'b', key: 'humanClearance', from: 400, to: 200 }]
  const bff = { async criteriaTrial(req) { asked.push(req); return { ...wireAnswer(['a', 'b']), proposal: { kind: 'evaluated', baseline: 'x', proposed: 'y', offerings } } } }
  const { svc, cc } = await hearingSetup(bff, ['a', 'b'])
  await svc.applyContextDoc(agreeToLine(agreeToLine(svc.getDoc(), 'a'), 'b'), { camera: null, renderer: null, container: null })
  assert.ok(svc.getDoc().criteriaAgreement?.agreed, 'the line is agreed (v1)')
  const target = { kind: 'requirement.criterion', ref: 'crit_a_takt' }
  const pushed = []
  cc._ctrl._commandStack = { canUndo: false, push(c) { pushed.push(c) } }
  await cc.proposeChange(target, { op: '<=', value: 10 }, { op: '<=', value: 8 }, 'faster', 'a')
  assert.equal(asked.length, 1)
  const takt = (l) => l.endUsers.find(u => u.ref === 'a').elements.find(e => e.key === 'takt').value
  assert.equal(takt(asked[0].line), 10)
  assert.equal(takt(asked[0].proposedLine), 8, 'the proposed line is the line with the change written')
  const p = svc.getDoc().proposals.at(-1)
  assert.deepEqual(p.margin, { kind: 'evaluated', baseline: 'x', proposed: 'y', offerings })

  // b reads it, then may approve.
  useUIStore.getState().actions.contextGrantKey('b')
  try {
    assert.equal(cc.marginReadGuardsFor(p.ref).ok, true)
    cc.readProposalMargin(p.ref)
    await settle()
    assert.deepEqual(svc.getDoc().proposals.at(-1).offeringsReadBy, ['b'])
  } finally {
    useUIStore.getState().actions.contextRevokeKey('b')
  }

  // Unreachable solver: the margin says so (never "inside").
  cc._ctrl._service = { bff: null }
  await cc.proposeChange(target, { op: '<=', value: 10 }, { op: '<=', value: 9 }, 'a bit faster', 'a')
  const q = svc.getDoc().proposals.at(-1)
  assert.equal(q.margin.kind, 'unassessed')
  assert.match(q.margin.reason, /not reachable/)
})
