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

/**
 * Two entities, exactly one of them graspable (ADR-117). The entity COUNT (2) is
 * what the layout-meta assertions read; the single Solid is what makes the target
 * roster resolve to cardinality 'single', so these runs need no explicit pick.
 * Before ADR-117 the fixture was `[{}, {}]` — two shapeless objects — which is
 * exactly why nothing here noticed that the request carried no target geometry.
 */
const LAYOUT = {
  version:  'layout/1.0',
  entities: [
    { ref: 'widget', type: 'Solid', name: 'Widget',
      position: { x: 600, y: 0, z: 400 }, dimensions: { x: 60, y: 60, z: 40 } },
    { ref: 'tcp_pick', type: 'AnnotatedPoint', name: 'TCP 教示点',
      position: { x: 600, y: 0, z: 500 } },
  ],
}

/**
 * A minimal fake uiStore mirroring the slice + actions GraspController touches.
 * Dependency-free (no zustand) so this runs in the THREE/node_modules-free
 * `test:context` lane. `contextSetGrasp` replaces the slice wholesale, matching
 * the real store's discriminated-union contract.
 */
function fakeStore() {
  const state = {
    context: { grasp: null, inspectorTab: 'matrix' },
    nPanelVisible: false,
    actions: {
      registerCallback() {},
      contextSetGrasp(grasp) { state.context.grasp = grasp },
      contextSetTab(tab)     { state.context.inspectorTab = tab },
      // ADR-106 D3 — the grasp panel's host is the N panel, beside the robot it
      // is about. The entry surfaces that panel instead of selecting a floor tab.
      setNPanelVisible(v)    { state.nPanelVisible = v },
      // ADR-090 — the derived robot roster the panel reads (sole writer: the
      // controller under test, via refreshRobots()).
      contextSetRobots(robots) { state.context.robots = robots },
      // ADR-117 / ADR-119 — the derived target roster, now carrying each target's
      // resolved grasp-location declaration (same sole writer).
      contextSetGraspTargets(t) { state.context.graspTargets = t },
    },
  }
  return { getState: () => state, _state: state }
}

/** Contract-v4 diagnostics fixture: candidates present, nothing reach-rejected. */
const DIAG_OK = {
  candidatesGenerated: 4,
  rejectedByReach: 0,
  rejectedByVisibility: 0,
  rejectedByIk: 1,
  rejectedByInterference: 1,
  rejectedByGrasp: 0,
  feasible: 2,
  returned: 2,
  reachNearestMiss: null,
  occlusionNearestMiss: null,
  openingNearestMiss: null,
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

/**
 * Fake scene + world-pose service mirroring the robot_base / tcp resolution
 * GraspController now performs (ADR-084 §2, TF tree revised). robot_base is the
 * world-parented root; tcp is its CHILD (parentId f_base). worldPoseOf returns
 * the composed WORLD pose (as SceneService does), so the resolved `robot`
 * payload is deterministic in this THREE-free lane. tcpOrientation is the tcp's
 * world quaternion — here identity, matching the default base + local-identity.
 */
const ROBOT_POSES = {
  robot_base: { position: { x: -2, y: 2, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
  tcp:        { position: { x: -2, y: 2, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
}
function fakeRobotScene() {
  const objects = new Map([
    ['f_base', { id: 'f_base', name: 'robot_base', parentId: null }],
    ['f_tcp',  { id: 'f_tcp',  name: 'tcp',        parentId: 'f_base' }],
  ])
  const poseById = { f_base: ROBOT_POSES.robot_base, f_tcp: ROBOT_POSES.tcp }
  return {
    scene:   { objects },
    service: { worldPoseOf: (id) => poseById[id] ?? null },
  }
}

function makeCtrl({ bff = null, layoutDsl = LAYOUT, loaded = true, isNegotiation = true, connectSets = undefined, robotScene = true } = {}) {
  const robot = robotScene ? fakeRobotScene() : { scene: undefined, service: {} }
  return {
    _uiView: {
      toasts: [],
      showToast(msg, opt) { this.toasts.push({ msg, opt }) },
    },
    _scene: robot.scene,
    _service: {
      bff,
      ...robot.service,
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
function setup(opts = {}, deps = {}) {
  const store = fakeStore()
  const ctrl  = makeCtrl(opts)
  const gc    = new GraspController(ctrl, store, deps)
  return { gc, ctrl, store, grasp: () => store.getState().context.grasp }
}

/** A BFF that records the request it was handed (the wiring assertions read it). */
function recordingBff() {
  const rec = { sent: null }
  rec.bff = {
    async compileLayout() { return { objects: [] } },
    async graspSearch(req) { rec.sent = req; return { candidates: [], diagnostics: DIAG_OK } },
  }
  return rec
}

/** LAYOUT with a grasp-location declaration on the one graspable Solid. */
function layoutWithFeature(graspFeature) {
  return {
    ...LAYOUT,
    entities: LAYOUT.entities.map(e => (e.ref === 'widget' ? { ...e, graspFeature } : e)),
  }
}

// ── openGrasp ────────────────────────────────────────────────────────────────

test('openGrasp seeds idle + surfaces the N panel when a layout is renderable', () => {
  const { gc, store, grasp } = setup({})
  gc.openGrasp()
  assert.equal(grasp().status, 'idle')
  assert.deepEqual(grasp().layout, { version: 'layout/1.0', entities: 2 })
  // The seeded slice IS the panel's availability; the entry only has to make its
  // host visible (ADR-106 D3). No floor tab is selected — the floor is not the host.
  assert.equal(store.getState().nPanelVisible, true)
  assert.equal(store.getState().context.inspectorTab, 'matrix')
})

test('openGrasp guides (no seed, no panel) when there is no renderable layout', () => {
  const { gc, ctrl, store, grasp } = setup({ layoutDsl: null })
  gc.openGrasp()
  assert.equal(grasp(), null)
  assert.equal(store.getState().nPanelVisible, false)
  assert.equal(ctrl._uiView.toasts.length, 1)
})

test('openGrasp does NOT open the floor when a doc is loaded (ADR-106 D3)', () => {
  // Before ADR-106 this test asserted the opposite — the grasp panel was a tab
  // of the negotiation overlay, so reaching it required entering a negotiation.
  // "Can this robot pick this up" has ONE owner; it never needed the room built
  // for questions with several.
  const { gc, ctrl, grasp } = setup({ isNegotiation: false, loaded: true })
  gc.openGrasp()
  assert.equal(ctrl._ctxCtrl.isNegotiation, false)
  assert.equal(grasp().status, 'idle')
})

test('openGrasp with no context auto-loads the starter and opens the panel (fast entry)', async () => {
  const { gc, ctrl, store, grasp } = setup({ isNegotiation: false, loaded: false })
  let requested = null
  // Stub the ctxCtrl quick-start: mark negotiation live + a renderable layout,
  // mirroring a real example load, and resolve true.
  ctrl._ctxCtrl.quickStartExample = async (id) => {
    requested = id
    ctrl._ctxCtrl.isNegotiation = true
    ctrl._ctxService.loaded = true          // a context now exists (layout renderable via getCompiled)
    return true
  }
  gc.openGrasp()
  await Promise.resolve(); await Promise.resolve()   // let the quick-start promise settle
  assert.equal(requested, 'cell_robotics')
  assert.equal(grasp().status, 'idle')
  assert.equal(store.getState().nPanelVisible, true)
})

test('openGrasp with no context and no example loader falls back to honest guidance', () => {
  const { gc, ctrl, store } = setup({ isNegotiation: false, loaded: false })
  // Default fake ctxCtrl has no quickStartExample — the THREE-free minimal stub.
  gc.openGrasp()
  assert.equal(ctrl._uiView.toasts.at(-1).opt.type, 'warn')
  assert.equal(store.getState().nPanelVisible, false)
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
  assert.deepEqual(g.request.layoutVersion, 'layout/1.0')
  assert.deepEqual(g.request.graspSearch.objectiveWeights, { reach: 0.6, clearance: 0.4 })
  assert.equal(g.request.graspSearch.topN, 5)
  // ADR-129 D2: 据付姿勢もワイヤに載る (ベースフレームは常に向きを持つので、
  // 送ることは発明ではない — 同じ事実を worldPoseOf が TCP について既に解いている)。
  assert.deepEqual(g.request.graspSearch.robot,
    { base: [-2, 2, 0], baseOrientation: [0, 0, 0, 1], tcpOrientation: [0, 0, 0, 1] })
  // ADR-117 — the object being grasped rides the request. This assertion is the
  // regression itself: without `target.surfaceSamples`, core/ generates zero
  // candidates and every run returns a well-formed, permanently empty answer.
  assert.equal(g.request.graspSearch.target.surfaceSamples.length, 9)
  for (const s of g.request.graspSearch.target.surfaceSamples) {
    assert.deepEqual(s.normal, [0, 0, 1])
    assert.equal(s.point[2], 420, 'top face of the 40-tall widget centred at z=400')
  }
  // The only Solid in the fixture is the target, so nothing is left to obstruct
  // it — a DECLARED empty list, not an omitted key.
  assert.deepEqual(g.request.graspSearch.obstacles, [])
})

test('掴む対象が宣言されていない layout では no-target で止まる (ADR-117)', async () => {
  // 対象 0 個。以前はここで request がそのまま出て、core/ が候補 0 件の
  // 「正しい形の答え」を返していた — 検査は緑、探索は死んでいる (ADR-116 と同型)。
  const noSolids = { version: 'layout/1.0', entities: [
    { ref: 'p', type: 'AnnotatedPoint', name: 'point', position: { x: 0, y: 0, z: 0 } },
  ] }
  const { gc, grasp } = setup({ bff: okBff, layoutDsl: noSolids })
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'no-target')
  assert.equal(g.targetCount, 0)
  assert.match(g.reason, /no solid with graspable geometry/i)
})

test('掴める対象が N 個あって未選択なら no-target — 先頭へ既定で倒さない (ADR-117)', async () => {
  const twoSolids = { version: 'layout/1.0', entities: [
    { ref: 'pedestal', type: 'Solid', name: '台座',
      position: { x: 0, y: 0, z: 200 }, dimensions: { x: 220, y: 220, z: 400 } },
    { ref: 'widget', type: 'Solid', name: 'Widget',
      position: { x: 600, y: 0, z: 400 }, dimensions: { x: 60, y: 60, z: 40 } },
  ] }
  const { gc, grasp } = setup({ bff: okBff, layoutDsl: twoSolids })
  await gc.runGraspSearch({})
  assert.equal(grasp().status, 'no-target')
  assert.equal(grasp().targetCount, 2)

  // 明示的に選べば通り、選んだものが対象として載る。
  gc.selectGraspTarget('widget')
  await gc.runGraspSearch({})
  const g = grasp()
  assert.equal(g.status, 'results')
  assert.equal(g.request.graspSearch.target.surfaceSamples[0].point[2], 420)
  // 選ばなかったほうの実体は障害物として宣言される (自分自身は除外される)。
  assert.equal(g.request.graspSearch.obstacles.length, 1)
  assert.deepEqual(g.request.graspSearch.obstacles[0].center, [0, 0, 200])
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
    candidatesGenerated: 8, rejectedByReach: 8, rejectedByVisibility: 0, rejectedByIk: 0,
    rejectedByInterference: 0, rejectedByGrasp: 0,
    feasible: 0, returned: 0, reachNearestMiss: 0.12,
    occlusionNearestMiss: null, openingNearestMiss: null,
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

// ── Domain declarations: camera / gripper ride the request (ADR-081 Dec. 5) ────

test('camera and gripper declarations ride the request open payload verbatim', async () => {
  let sent = null
  const bff = {
    async compileLayout() { return { objects: [] } },
    async graspSearch(req) { sent = req; return { candidates: [], diagnostics: DIAG_OK } },
  }
  const { gc } = setup({ bff })
  const camera  = { position: [0, 0, 1.2], viewAxis: [0, 0, -1], fovHalfAngle: 0.6 }
  const gripper = { maxOpening: 0.06, fingerClearance: 0.01 }
  await gc.runGraspSearch({ weights: { reach: 1 }, topN: 3, camera, gripper })
  assert.deepEqual(sent.graspSearch.camera, camera)     // declaration only — no reshaping
  assert.deepEqual(sent.graspSearch.gripper, gripper)
  assert.deepEqual(sent.graspSearch.robot,
    { base: [-2, 2, 0], baseOrientation: [0, 0, 0, 1], tcpOrientation: [0, 0, 0, 1] })
})

// ── The declarations actually REACH the request (ADR-116's lesson) ───────────
//
// Each of the three below was, before this change, a value that existed and was
// never sent: a correct thing nobody read. That failure mode is invisible from
// the producing side — the URDF is right, the panel field is right, the solver is
// right — so the assertion has to be made at the WIRE, on the request the BFF
// was actually handed.

test('URDF 由来の運動学宣言が request に載る — ADR-127 の解析解が初めて画面に届く経路', async () => {
  const kinematics = { kind: 'universalRobots', dh: { d1: 0.1625, a2: -0.425, a3: -0.3922, d4: 0.1333, d5: 0.0997, d6: 0.0996 } }
  const rec = recordingBff()
  const { gc } = setup({ bff: rec.bff }, { robotKinematics: kinematics })
  await gc.runGraspSearch({})
  assert.deepEqual(rec.sent.graspSearch.robot.kinematics, kinematics)
  // ...and it rides ON the robot it describes, not beside it: the base pose and
  // the structure are two facts about one arm.
  assert.deepEqual(rec.sent.graspSearch.robot.base, [-2, 2, 0])
})

test('運動学の宣言が無ければ鍵ごと落とす — 素朴コーン判定のまま (ADR-127 D3)', async () => {
  const rec = recordingBff()
  const { gc } = setup({ bff: rec.bff })       // no robotKinematics injected
  await gc.runGraspSearch({})
  assert.equal('kinematics' in rec.sent.graspSearch.robot, false)
})

test('宣言されたリーチ範囲が plan{} で載り、未宣言なら鍵ごと落ちる (ADR-120 / 原則 #31)', async () => {
  const rec  = recordingBff()
  const plan = { reachMin: 0.2, reachMax: 0.85, wristConeHalfAngle: 1.05 }
  const { gc } = setup({ bff: rec.bff })
  await gc.runGraspSearch({ plan })
  assert.deepEqual(rec.sent.graspSearch.plan, plan)

  const rec2 = recordingBff()
  const { gc: gc2 } = setup({ bff: rec2.bff })
  await gc2.runGraspSearch({})
  // Omitted, NOT zeroed: a declared-zero envelope and an undeclared one must not
  // produce the same request, or `reach_margin` cannot tell "no margin" from
  // "never measured".
  assert.equal('plan' in rec2.sent.graspSearch, false)
})

// ── Where to grasp: the declaration reaches the wire, and wins (ADR-119 D2/D3) ─

test('宣言された面だけが request のサンプルになる — 導出面と混ざらない (D3)', async () => {
  const rec = recordingBff()
  const { gc } = setup({
    bff: rec.bff,
    layoutDsl: layoutWithFeature({ kind: 'faces', faces: [{ face: '-z' }] }),
  })
  await gc.runGraspSearch({ gripper: { kind: 'suction', cupDiameter: 0.04 } })
  const samples = rec.sent.graspSearch.target.surfaceSamples
  assert.ok(samples.length > 0)
  // Suction derives '+z'. Not one derived sample may appear — asserting only
  // that the declared face is present would pass under a merge.
  for (const s of samples) assert.equal(s.normal[2], -1)
})

test('宣言が無いときは導出のまま — 語彙を足しても既存の答えが動かない', async () => {
  const withNothing = recordingBff()
  const withAnywhere = recordingBff()
  const a = setup({ bff: withNothing.bff })
  const b = setup({ bff: withAnywhere.bff, layoutDsl: layoutWithFeature({ kind: 'anywhere' }) })
  const gripper = { kind: 'suction', cupDiameter: 0.04 }
  await a.gc.runGraspSearch({ gripper })
  await b.gc.runGraspSearch({ gripper })
  // Same samples on the wire — which is exactly why the DISTINCTION between the
  // two states cannot be evidenced here and is evidenced in the pure layer
  // (graspFeature.test.js) instead. Named so the omission is deliberate.
  assert.deepEqual(
    withAnywhere.sent.graspSearch.target.surfaceSamples,
    withNothing.sent.graspSearch.target.surfaceSamples,
  )
})

test('平行ジョーに 1 面だけの宣言は BFF へ行く前に止まり、理由が出る (ADR-118 の再演を防ぐ)', async () => {
  let reached = 0
  const bff = {
    async compileLayout() { reached += 1; return { objects: [] } },
    async graspSearch()   { reached += 1; return { candidates: [], diagnostics: DIAG_OK } },
  }
  const { gc, ctrl, grasp } = setup({
    bff, layoutDsl: layoutWithFeature({ kind: 'faces', faces: [{ face: '+x' }] }),
  })
  await gc.runGraspSearch({ gripper: { kind: 'parallelJaw', maxOpening: 0.08 } })
  assert.equal(reached, 0, '幅が測れない要求を投げてはならない')
  assert.equal(grasp().status, 'no-target')
  assert.match(grasp().reason, /opposed/)
  assert.ok(ctrl._uiView.toasts.length > 0, '無言で止まるのが最悪の失敗 (原則 #11)')
})

test('読めない宣言は導出へ落ちず停止する — 「宣言したのに無視された」を作らない', async () => {
  let reached = 0
  const bff = {
    async compileLayout() { reached += 1; return { objects: [] } },
    async graspSearch()   { reached += 1; return { candidates: [], diagnostics: DIAG_OK } },
  }
  const { gc, grasp } = setup({ bff, layoutDsl: layoutWithFeature({ kind: 'somewhere' }) })
  await gc.runGraspSearch({})
  assert.equal(reached, 0)
  assert.equal(grasp().status, 'no-target')
})

test('setGraspFeature は文書編集の唯一の入口へ委譲し、投影を読み直す (§1.1)', async () => {
  const { gc, ctrl, store } = setup({})
  const calls = []
  ctrl._ctxCtrl.setGraspFeature = (ref, feature) => {
    calls.push({ ref, feature })
    // The document is the authority: emulate the recompile the real doc-edit does.
    ctrl._ctxService.getCompiled = () => ({ layoutDsl: layoutWithFeature(feature) })
    return Promise.resolve()
  }
  gc.openGrasp()
  await gc.setGraspFeature('widget', { kind: 'faces', faces: [{ face: '+y' }, { face: '-y' }] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ref, 'widget')
  // The projection reflects what the DOCUMENT now says — not what we sent.
  assert.equal(store.getState().context.graspTargets.feature.state, 'declared-faces')
  assert.deepEqual(
    store.getState().context.graspTargets.feature.faces.map(f => f.face),
    ['+y', '-y'],
  )
})

test('宣言を消すと「宣言していない」へ戻る — anywhere ではない', async () => {
  const { gc, ctrl, store } = setup({ layoutDsl: layoutWithFeature({ kind: 'anywhere' }) })
  ctrl._ctxCtrl.setGraspFeature = (ref, feature) => {
    ctrl._ctxService.getCompiled = () => ({ layoutDsl: feature ? layoutWithFeature(feature) : LAYOUT })
    return Promise.resolve()
  }
  gc.openGrasp()
  assert.equal(store.getState().context.graspTargets.feature.state, 'declared-anywhere')
  await gc.setGraspFeature('widget', null)
  assert.equal(store.getState().context.graspTargets.feature.state, 'derived')
})

// ── 0 / 1 / N robots: the gate and the selection (ADR-090) ───────────────────

test('a robot-less scene lands in no-robot and never reaches the BFF (ADR-090 Dec. 4)', async () => {
  let calls = 0
  const bff = {
    async compileLayout() { calls += 1; return { objects: [] } },
    async graspSearch()    { calls += 1; return { candidates: [], diagnostics: DIAG_OK } },
  }
  const { gc, ctrl, grasp } = setup({ bff, robotScene: false })
  await gc.runGraspSearch({})
  // The old behaviour omitted `robot` and let core/ substitute an infinite-reach
  // ghost at the origin (§力学(3)) — plausible candidates, none executable.
  assert.equal(grasp().status, 'no-robot')
  assert.equal(calls, 0)                                   // nothing was solved
  assert.match(grasp().reason, /No robot in the scene/)
  assert.equal(ctrl._uiView.toasts.length, 1)              // the reason is surfaced (#11)
})

/** Two robots, each a base + tcp pair carrying declared roles (ADR-090). */
function fakeTwoRobotScene() {
  const objects = new Map([
    ['f_base', { id: 'f_base', name: 'robot_base',   parentId: null,    robotRole: 'base' }],
    ['f_tcp',  { id: 'f_tcp',  name: 'tcp',          parentId: 'f_base', robotRole: 'tcp' }],
    ['g_base', { id: 'g_base', name: 'robot_base_2', parentId: null,    robotRole: 'base' }],
    ['g_tcp',  { id: 'g_tcp',  name: 'tcp_2',        parentId: 'g_base', robotRole: 'tcp' }],
  ])
  const poseById = {
    f_base: { position: { x: -2, y: 2, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
    f_tcp:  { position: { x: -2, y: 2, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
    g_base: { position: { x: -2, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
    g_tcp:  { position: { x: -2, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 1, w: 0 } },
  }
  return { objects, worldPoseOf: (id) => poseById[id] ?? null }
}

/** Attach a two-robot scene to an existing fake ctrl, keeping bff / connectBff. */
function useTwoRobots(gc) {
  const two = fakeTwoRobotScene()
  gc._ctrl._scene = { objects: two.objects }
  gc._ctrl._service.worldPoseOf = two.worldPoseOf
  gc.refreshRobots()
}

test('N robots with no pick refuse to run — "which one" is never guessed', async () => {
  let calls = 0
  const bff = {
    async compileLayout() { calls += 1; return { objects: [] } },
    async graspSearch()    { calls += 1; return { candidates: [], diagnostics: DIAG_OK } },
  }
  const { gc, store, grasp } = setup({ bff })
  useTwoRobots(gc)
  assert.equal(store.getState().context.robots.cardinality, 'multi')
  assert.equal(store.getState().context.robots.selectedId, null)

  await gc.runGraspSearch({})
  assert.equal(grasp().status, 'no-robot')
  assert.equal(calls, 0)
  assert.match(grasp().reason, /2 robots/)
})

test('the picked robot is the one solved for — its own base / tcp ride the wire', async () => {
  let sent = null
  const bff = {
    async compileLayout() { return { objects: [] } },
    async graspSearch(req) { sent = req; return { candidates: [], diagnostics: DIAG_OK } },
  }
  const { gc, store } = setup({ bff })
  useTwoRobots(gc)
  gc.selectRobot('g_base')
  assert.equal(store.getState().context.robots.selectedId, 'g_base')

  await gc.runGraspSearch({})
  // The SECOND robot's geometry, and still the singular ADR-084 wire shape: no id,
  // no array — identity stayed on the front, so the contract never moved.
  assert.deepEqual(sent.graspSearch.robot,
    { base: [-2, 0, 0], baseOrientation: [0, 0, 0, 1], tcpOrientation: [0, 0, 1, 0] })
  assert.ok(!('robots' in sent.graspSearch))
  assert.ok(!('robotId' in sent.graspSearch.robot))
})

test('a selection whose robot left the scene is dropped, not silently reused', async () => {
  const { gc, store, grasp } = setup({})
  useTwoRobots(gc)
  gc.selectRobot('g_base')
  // The second robot is deleted (its frames leave the scene).
  gc._ctrl._scene.objects.delete('g_base')
  gc._ctrl._scene.objects.delete('g_tcp')
  gc.refreshRobots()

  // One robot left → implicit selection resolves to it (no UI needed, 原則 #15).
  assert.equal(store.getState().context.robots.cardinality, 'single')
  assert.equal(store.getState().context.robots.selectedId, 'f_base')
  assert.equal(grasp(), null)                       // no run was attempted
})

test('refreshRobots publishes the roster as a labelled read-model', () => {
  const { gc, store } = setup({})
  gc.refreshRobots()
  const robots = store.getState().context.robots
  assert.equal(robots.cardinality, 'single')
  assert.deepEqual(robots.list, [{ id: 'f_base', label: 'robot_base', hasTcp: true }])
})

test('a legacy world-parented tcp (parentId null) still resolves via the name fallback', async () => {
  let sent = null
  const bff = {
    async compileLayout() { return { objects: [] } },
    async graspSearch(req) { sent = req; return { candidates: [], diagnostics: DIAG_OK } },
  }
  // Robot scene where tcp predates the TF-tree revision — still world-parented.
  const objects = new Map([
    ['f_base', { id: 'f_base', name: 'robot_base', parentId: null }],
    ['f_tcp',  { id: 'f_tcp',  name: 'tcp',        parentId: null }],
  ])
  const poseById = { f_base: ROBOT_POSES.robot_base, f_tcp: ROBOT_POSES.tcp }
  const { gc } = setup({ bff, robotScene: false })
  gc._ctrl._scene = { objects }
  gc._ctrl._service.worldPoseOf = (id) => poseById[id] ?? null   // keep bff / connectBff
  await gc.runGraspSearch({})
  assert.deepEqual(sent.graspSearch.robot,
    { base: [-2, 2, 0], baseOrientation: [0, 0, 0, 1], tcpOrientation: [0, 0, 0, 1] })
})

test('an undeclared camera / gripper omits the key entirely (vacuously-true gate)', async () => {
  let sent = null
  const bff = {
    async compileLayout() { return { objects: [] } },
    async graspSearch(req) { sent = req; return { candidates: [], diagnostics: DIAG_OK } },
  }
  const { gc } = setup({ bff })
  await gc.runGraspSearch({ camera: null, gripper: undefined })
  assert.ok(!('camera' in sent.graspSearch))
  assert.ok(!('gripper' in sent.graspSearch))
})

// ── captureViewportCamera (ADR-081 Dec. 5 「今この視点から見えるか」) ──────────

/** Column-major identity matrixWorld (camera at origin looking down world −Z). */
const CAM_IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

test('captureViewportCamera snapshots the active camera as a wire declaration', () => {
  const { gc, ctrl } = setup({})
  let updated = 0
  ctrl._sceneView = {
    activeCamera: {
      position: { x: 1, y: -2, z: 3 },
      matrixWorld: { elements: CAM_IDENTITY },
      fov: 60,
      updateMatrixWorld() { updated += 1 },
    },
  }
  const snap = gc.captureViewportCamera()
  assert.equal(updated, 1)                       // fresh matrix, not a stale frame
  assert.deepEqual(snap.position, [1, -2, 3])
  assert.deepEqual(snap.viewAxis, [0, 0, -1])
  assert.ok(Math.abs(snap.fovHalfAngle - Math.PI / 6) < 1e-3)
})

test('captureViewportCamera: ortho camera (no fov) degrades to fovHalfAngle null', () => {
  const { gc, ctrl } = setup({})
  ctrl._sceneView = {
    activeCamera: { position: { x: 0, y: 0, z: 5 }, matrixWorld: { elements: CAM_IDENTITY } },
  }
  const snap = gc.captureViewportCamera()
  assert.deepEqual(snap.viewAxis, [0, 0, -1])
  assert.equal(snap.fovHalfAngle, null)
})

test('captureViewportCamera returns null without a camera (THREE-free lane) — never a guess', () => {
  const { gc } = setup({})
  assert.equal(gc.captureViewportCamera(), null)
})
