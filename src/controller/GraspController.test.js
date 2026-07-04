/**
 * GraspController.test.js — ADR-057 grasp-search FSM transitions.
 *
 * Run via `pnpm test:context` (node --test). THREE-free: the controller is driven
 * with a fake `ctrl` (fake BffClient + fake ContextService/ContextController) and
 * the real (DOM-free) uiStore, mirroring ContextService.test.js. We assert the
 * terminal states of the discriminated union the FSM produces — the proof that
 * declare→compile→solve→render and its error branches land in legal states only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { GraspController } from './GraspController.js'
import { BffUnavailableError } from '../service/BffClient.js'

const LAYOUT = { version: 'layout/1.0', entities: [{}, {}] }

/**
 * A minimal fake uiStore mirroring the slice + actions GraspController touches.
 * Dependency-free (no zustand) so this runs in the THREE/node_modules-free
 * `test:context` lane. `contextSetGrasp` replaces the slice wholesale, matching
 * the real store's discriminated-union contract.
 */
function fakeStore() {
  const state = {
    context: { grasp: null, inspectorTab: 'matrix' },
    actions: {
      registerCallback() {},
      contextSetGrasp(grasp) { state.context.grasp = grasp },
      contextSetTab(tab)     { state.context.inspectorTab = tab },
    },
  }
  return { getState: () => state, _state: state }
}

/** Contract-v3 diagnostics fixture: candidates present, nothing reach-rejected. */
const DIAG_OK = {
  candidatesGenerated: 4,
  rejectedByReach: 0,
  rejectedByIk: 1,
  rejectedByInterference: 1,
  feasible: 2,
  returned: 2,
  reachNearestMiss: null,
}

const okBff = {
  async compileLayout() { return { objects: [{}, {}, {}] } },
  async graspSearch() {
    return {
      candidates: [
        { rank: 1, score: { totalScore: 0.9, withinReach: true, ikSolvable: true, interferenceFree: true, objectiveScores: { reach: 0.8, clearance: 0.6 } } },
        { rank: 2, score: { totalScore: 0.7, withinReach: true, ikSolvable: false, interferenceFree: true } },
      ],
      diagnostics: DIAG_OK,
    }
  },
}

function makeCtrl({ bff = null, layoutDsl = LAYOUT, loaded = true, isNegotiation = true, connectSets = undefined } = {}) {
  return {
    _uiView: {
      toasts: [],
      showToast(msg, opt) { this.toasts.push({ msg, opt }) },
    },
    _service: {
      bff,
      async connectBff() { if (connectSets !== undefined) this.bff = connectSets },
    },
    _ctxService: {
      loaded,
      getCompiled: () => (layoutDsl ? { layoutDsl } : null),
    },
    _ctxCtrl: {
      isNegotiation,
      enterNegotiation() { this.isNegotiation = true },
    },
  }
}

/** Build a controller + fresh fake store; returns both. */
function setup(opts = {}) {
  const store = fakeStore()
  const ctrl  = makeCtrl(opts)
  const gc    = new GraspController(ctrl, store)
  return { gc, ctrl, store, grasp: () => store.getState().context.grasp }
}

// ── openGrasp ────────────────────────────────────────────────────────────────

test('openGrasp seeds idle + selects the grasp tab when a layout is renderable', () => {
  const { gc, store, grasp } = setup({})
  gc.openGrasp()
  assert.equal(grasp().status, 'idle')
  assert.deepEqual(grasp().layout, { version: 'layout/1.0', entities: 2 })
  assert.equal(store.getState().context.inspectorTab, 'grasp')
})

test('openGrasp guides (no seed, no tab) when there is no renderable layout', () => {
  const { gc, ctrl, store, grasp } = setup({ layoutDsl: null })
  gc.openGrasp()
  assert.equal(grasp(), null)
  assert.notEqual(store.getState().context.inspectorTab, 'grasp')
  assert.equal(ctrl._uiView.toasts.length, 1)
})

test('openGrasp enters negotiate first when inactive but a doc is loaded', () => {
  const { gc, ctrl, grasp } = setup({ isNegotiation: false, loaded: true })
  gc.openGrasp()
  assert.equal(ctrl._ctxCtrl.isNegotiation, true)
  assert.equal(grasp().status, 'idle')
})

// ── runGraspSearch: happy path ─────────────────────────────────────────────────

test('runGraspSearch lands in results with the candidates (and selectedRank null)', async () => {
  const { gc, grasp } = setup({ bff: okBff })
  await gc.runGraspSearch({ weights: { reach: 0.6, clearance: 0.4 }, topN: 5 })
  const g = grasp()
  assert.equal(g.status, 'results')
  assert.equal(g.candidates.length, 2)
  assert.equal(g.selectedRank, null)
  assert.equal(g.compiledObjects, 3)
  assert.deepEqual(g.request, { layoutVersion: 'layout/1.0', graspSearch: { objectiveWeights: { reach: 0.6, clearance: 0.4 }, topN: 5 } })
})

// ── runGraspSearch: contract-v3 diagnostics (rejection funnel) ─────────────────

test('results carries the wire diagnostics verbatim; first run has no prevDiagnostics', async () => {
  const { gc, grasp } = setup({ bff: okBff })
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'results')
  assert.deepEqual(g.diagnostics, DIAG_OK)      // pass-through wire fact, no reshaping
  assert.equal(g.prevDiagnostics, null)
})

test('a second run carries the previous run diagnostics for the delta view', async () => {
  const first  = { ...DIAG_OK }
  const second = { ...DIAG_OK, rejectedByIk: 0, feasible: 3, returned: 3 }
  let call = 0
  const bff = {
    async compileLayout() { return { objects: [{}] } },
    async graspSearch() { call += 1; return { candidates: [], diagnostics: call === 1 ? first : second } },
  }
  const { gc, grasp } = setup({ bff })
  await gc.runGraspSearch({})
  await gc.runGraspSearch({})
  const g = grasp()
  assert.deepEqual(g.diagnostics, second)
  assert.deepEqual(g.prevDiagnostics, first)    // explicit derived carry-over
})

test('zero-candidate response lands in results with the funnel explaining why', async () => {
  const diag = {
    candidatesGenerated: 8, rejectedByReach: 8, rejectedByIk: 0, rejectedByInterference: 0,
    feasible: 0, returned: 0, reachNearestMiss: 0.12,
  }
  const bff = {
    async compileLayout() { return { objects: [{}] } },
    async graspSearch() { return { candidates: [], diagnostics: diag } },
  }
  const { gc, grasp } = setup({ bff })
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'results')             // an empty ranking is a legal result
  assert.equal(g.candidates.length, 0)
  assert.deepEqual(g.diagnostics, diag)
  assert.equal(g.diagnostics.reachNearestMiss, 0.12)
})

test('a pre-v3 response without diagnostics degrades to diagnostics:null', async () => {
  const bff = {
    async compileLayout() { return { objects: [{}] } },
    async graspSearch() { return { candidates: [{ rank: 1, score: { totalScore: 0.5, withinReach: true, ikSolvable: true, interferenceFree: true } }] } },
  }
  const { gc, grasp } = setup({ bff })
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'results')
  assert.equal(g.diagnostics, null)
  assert.equal(g.prevDiagnostics, null)
})

test('an error run does not leak diagnostics into the error state', async () => {
  // First run succeeds (results + diagnostics), second run fails at solve —
  // the error state must not carry stale funnel facts (illegal-state guard).
  let call = 0
  const bff = {
    async compileLayout() { return { objects: [{}] } },
    async graspSearch() {
      call += 1
      if (call === 1) return { candidates: [], diagnostics: DIAG_OK }
      throw Object.assign(new Error('boom'), { status: 502 })
    },
  }
  const { gc, grasp } = setup({ bff })
  await gc.runGraspSearch({})
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'error')
  assert.equal(g.diagnostics, undefined)
  assert.equal(g.prevDiagnostics, undefined)
})

// ── runGraspSearch: error branches (legal error states only) ───────────────────

test('compile failure → error{stage:compile} with httpStatus + details', async () => {
  const err = Object.assign(new Error('bad DSL'), { status: 400, details: ['entities required'] })
  const bff = { async compileLayout() { throw err }, async graspSearch() { return { candidates: [] } } }
  const { gc, grasp } = setup({ bff })
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'error')
  assert.equal(g.stage, 'compile')
  assert.equal(g.httpStatus, 400)
  assert.deepEqual(g.details, ['entities required'])
  assert.equal(g.candidates, undefined)   // illegal-state guard: error carries no candidates
})

test('solve failure → error{stage:solve} with upstream status', async () => {
  const err = Object.assign(new Error('upstream drift'), { status: 502, details: ['contractVersion mismatch'] })
  const bff = { async compileLayout() { return { objects: [] } }, async graspSearch() { throw err } }
  const { gc, grasp } = setup({ bff })
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'error')
  assert.equal(g.stage, 'solve')
  assert.equal(g.httpStatus, 502)
})

test('BffUnavailableError on any step → error{stage:bff}', async () => {
  const bff = { async compileLayout() { throw new BffUnavailableError(new Error('ECONNREFUSED')) }, async graspSearch() { return { candidates: [] } } }
  const { gc, grasp } = setup({ bff })
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'error')
  assert.equal(g.stage, 'bff')
})

test('no BFF (and connectBff cannot reach one) → error{stage:bff}', async () => {
  const { gc, grasp } = setup({ bff: null, connectSets: null })
  await gc.runGraspSearch({})
  assert.equal(grasp().status, 'error')
  assert.equal(grasp().stage, 'bff')
})

test('no renderable layout → no-layout state, never compiling', async () => {
  const { gc, grasp } = setup({ bff: okBff, layoutDsl: null })
  await gc.runGraspSearch({})
  assert.equal(grasp().status, 'no-layout')
})

test('Run is a no-op while compiling/solving (no overlapping requests)', async () => {
  const { gc, store, grasp } = setup({ bff: okBff })
  store.getState().actions.contextSetGrasp({ status: 'solving', layout: { version: 'x', entities: 1 }, request: {} })
  await gc.runGraspSearch({})
  assert.equal(grasp().status, 'solving')   // untouched
})

// ── selectCandidate (the deferred-ghost hook seat) ─────────────────────────────

test('selectCandidate sets selectedRank only in results', () => {
  const { gc, store, grasp } = setup({ bff: okBff })
  // not in results yet → no-op
  gc.selectCandidate(2)
  assert.equal(grasp(), null)

  store.getState().actions.contextSetGrasp({
    status: 'results', layout: { version: 'x', entities: 1 }, request: {}, candidates: [{ rank: 1 }, { rank: 2 }], selectedRank: null,
  })
  gc.selectCandidate(2)
  assert.equal(grasp().selectedRank, 2)
  assert.equal(grasp().status, 'results')
})

// ── Stage-1 spatial ghost wiring (ADR-059) ─────────────────────────────────────

/** THREE-free fake GraspGhostView recording the controller's calls. */
function fakeGhost() {
  return {
    calls: [],
    showCandidate(spec) { this.calls.push(['show', spec]) },
    setTargetGeometry(g) { this.calls.push(['target', g]) },
    setWorldCap(cap)     { this.calls.push(['cap', cap]) },
    clear()              { this.calls.push(['clear']) },
    tick(...args)        { this.calls.push(['tick', args]) },
    dispose()            { this.calls.push(['dispose']) },
  }
}

const EE_POSE = { kind: 'endEffector', frame: { position: [1, 2, 3], orientation: [0, 0, 0, 1] } }
const JS_POSE = { kind: 'jointSpace', chainRef: 'arm', joints: [0, 0, 0] }

/** Results-state setup with a ghost factory; returns the ghost instance list. */
function ghostSetup(candidates) {
  const store = fakeStore()
  const ctrl  = makeCtrl({})
  const ghosts = []
  const gc = new GraspController(ctrl, store, {
    createGhostView: () => { const g = fakeGhost(); ghosts.push(g); return g },
  })
  store.getState().actions.contextSetGrasp({
    status: 'results', layout: { version: 'x', entities: 1 }, request: {}, candidates, selectedRank: null,
  })
  return { gc, store, ghosts, grasp: () => store.getState().context.grasp }
}

test('selecting a gated endEffector candidate shows a select-mode ghost with the typed frame', () => {
  const { gc, ghosts } = ghostSetup([{ rank: 1, pose: EE_POSE, score: { totalScore: 0.9 } }])
  gc.selectCandidate(1)
  assert.equal(ghosts.length, 1)
  const show = ghosts[0].calls.find(c => c[0] === 'show')
  assert.ok(show)
  assert.equal(show[1].mode, 'select')
  assert.equal(show[1].rank, 1)
  assert.deepEqual(show[1].frame, { position: [1, 2, 3], orientation: [0, 0, 0, 1] })
})

test('selecting a jointSpace candidate never constructs a ghost (capability gate — no heuristics)', () => {
  const { gc, ghosts, grasp } = ghostSetup([{ rank: 1, pose: JS_POSE, score: { totalScore: 0.5 } }])
  gc.selectCandidate(1)
  assert.equal(grasp().selectedRank, 1)   // selection itself still works
  assert.equal(ghosts.length, 0)          // but no ghost is fabricated
})

test('hover previews (mode hover), leaving reverts to the selected candidate (mode select)', () => {
  const { gc, ghosts } = ghostSetup([
    { rank: 1, pose: EE_POSE, score: { totalScore: 0.9 } },
    { rank: 2, pose: { ...EE_POSE, frame: { position: [4, 5, 6], orientation: [0, 0, 0, 1] } }, score: { totalScore: 0.4 } },
  ])
  gc.selectCandidate(1)
  gc.hoverCandidate(2)
  gc.hoverCandidate(null)
  const shows = ghosts[0].calls.filter(c => c[0] === 'show').map(c => [c[1].mode, c[1].rank])
  assert.deepEqual(shows, [['select', 1], ['hover', 2], ['select', 1]])
})

test('a new run and disposeGhost clean up the ghost (PHILOSOPHY #9)', async () => {
  const { gc, ghosts } = ghostSetup([{ rank: 1, pose: EE_POSE, score: { totalScore: 0.9 } }])
  gc.selectCandidate(1)
  assert.equal(ghosts.length, 1)
  await gc.runGraspSearch({})           // new run clears the stale ghost first
  assert.ok(ghosts[0].calls.some(c => c[0] === 'clear'))
  gc.disposeGhost()
  assert.ok(ghosts[0].calls.some(c => c[0] === 'dispose'))
})
