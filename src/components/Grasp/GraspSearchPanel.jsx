import { useEffect, useMemo, useState } from 'react'
import { useUIStore, UNDECLARED_REACH } from '../../store/uiStore.js'
import { renderableEndEffectorFrame } from '../../view/GraspGhostMath.js'
import { funnelStages, dominantStage, funnelDelta, nearMissCloseness, specResultRows } from '../../view/GraspFunnelMath.js'
import { domainKpis, ladderRisks } from '../../view/GraspLadderMath.js'
import { objectiveRows, unevaluatedNote } from '../../view/GraspScoreMath.js'
import {
  OBJECTIVE, objectivesForHand, DEFAULT_OBJECTIVE_WEIGHT,
  GRIPPER_KIND, reachDeclarationGaps,
} from '../../context/GraspDeclarationCatalog.js'
import { facesForGripperKind } from '../../domain/graspTargets.js'
import { graspFeatureGaps, graspFeatureSummary } from '../../domain/graspFeature.js'
import { sourceLabel } from '../../domain/searchGeometry.js'
import { MASS_DECLARATION_STATE } from '../../domain/targetMass.js'
import { phaseRows, analysisSummary, analysisFreshness, analysisAvailability } from '../../view/GraspPhaseMath.js'
import { DeltaChip, useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { NumField, SortChip, PICKER } from './GraspFields.jsx'
import { COLOR, DURATION, EASING } from '../../theme/tokens.js'

/**
 * A `transition: width` for a data bar fill (ADR-068 polish) so the bar glides
 * to its new fraction instead of snapping. Reduced motion drops the transition
 * (the number is the information, not the glide — PHILOSOPHY #30). Presentation
 * only; the fraction still comes verbatim from the contract diagnostics (#29).
 */
function barTransition(reduced) {
  return reduced ? undefined : `width ${DURATION.drawer}ms ${EASING.out}`
}

/**
 * GraspSearchPanel — UI → DSL → BFF → grasp-search verification (ADR-054 thread,
 * ADR-057 placement + scoring).
 *
 * Rendered as the `'grasp'` tab **inside** the production ContextLayer's right dock
 * (ADR-057 §B) — no longer a central modal, so the canvas stays visible and no new
 * screen-edge footprint is claimed (it rides on the existing 280px dock — PHILOSOPHY
 * #26). Presentational: it reads the `context.grasp` discriminated union (the sole
 * writer is GraspController — PHILOSOPHY #5) and fires registered callbacks; it owns
 * no FSM state, only the local form inputs.
 *
 * Input is organised as domain cards — Seen (which camera) / Reached (robot base
 * + weights) — per ADR-081 Decision 5. Since ADR-164 the declarations themselves
 * live on the panels of the entities that own them (the camera's field of view
 * on the camera — D3; the hand on the tcp — D1); these cards pick the premise and
 * READ what is declared, with ▸ to the owner. The gap list is the Run button's
 * submit predicate (reasons printed — #11). Every gate is solved in core/.
 *
 * Scoring is built from the contract's `score` only (ADR-057 §F): the three boolean
 * chips plus labelled `objectiveScores` bars (objective name → 0..1, comparable
 * across requests on an absolute basis per the contract). Ranking never comes from
 * the ghost — score-first is invariant (ADR-057).
 *
 * Stage-1 spatial ghost (ADR-059): a candidate whose pose passes the pure
 * capability gate (`renderableEndEffectorFrame` — typed `kind:'endEffector'` +
 * shape check) gets hover-preview / click-commit ghost callbacks; anything else
 * (jointSpace / malformed) shows an honest "spatial view unavailable" caption
 * instead — poses are never heuristically interpreted (PHILOSOPHY #11).
 */

const BORDER = '1px solid #3a3a3a'

/**
 * Whether this build serves fabricated grasp answers (ADR-117). Build-time
 * constant, so a normal build renders nothing and the branch is dropped.
 */
const GRASP_STUB = import.meta.env.VITE_GRASP_STUB === '1'

/**
 * StubBadge — the label that keeps a demo from being mistaken for a measurement.
 *
 * `docs/dogfooding/` exists to collect values a practitioner actually obtained,
 * and those records are the evidence under the GSN branch
 * `DefaultsAreAcceptableToPractitioner`. A stubbed number recorded as a real one
 * poisons exactly that evidence — and the person most likely to make the mistake
 * is the reviewer who was handed a URL and never saw a terminal. So the fiction
 * is stated on the screen where the numbers are read, not only in a console line
 * or a devtools header (原則 #11: the reason travels with the thing).
 */
function StubBadge() {
  if (!GRASP_STUB) return null
  return (
    <div style={{
      marginTop: '8px', padding: '6px 8px', borderRadius: '4px',
      // Declared roles, not fresh literals: "take care" already has a colour
      // (ADR-100 — a near-duplicate of an existing tone is the defect that ADR
      // was written about).
      background: COLOR.surfaceSunken,
      border: `1px solid ${COLOR.cautionTone}`,
      color: COLOR.cautionTone,
      fontSize: '10px', lineHeight: 1.5,
    }}>
      <strong>Stubbed results.</strong> This build answers grasp searches locally with a
      coarse stand-in, so the UI can be reviewed without a backend. The ranking,
      distances and scores are fabricated — do not record them as measured values.
    </div>
  )
}

// ── Domain-card form parsing (local, pure) ───────────────────────────────────
//
// Form fields hold strings; these parse them into the wire-shaped declaration
// the gap predicates (GraspDeclarationCatalog) and the request consume. A
// blank field parses to NaN (never a silent 0 — Number('') is 0, the #11 trap).
const parseNum = (s) => (typeof s === 'string' && s.trim() === '') ? NaN : Number(s)

/**
 * Submit gaps contributed by the robot roster (ADR-090) — pure, mirroring the
 * camera / gripper gap predicates. Reads the DERIVED `context.robots` read-model
 * (authority: the scene, via GraspController.refreshRobots):
 *
 *   0 robots           → the scene has no premise to solve against. Rather than
 *                        omitting `robot` from the request and letting core/
 *                        substitute an infinite-reach ghost at the origin
 *                        (ADR-090 §力学(3)), say so and disable Run.
 *   N with no selection → "which one" is unanswered; picking is the user's call,
 *                        never a silent "first one wins".
 *   1 robot            → no gap and no selector (原則 #15 — the slot stays, the
 *                        card shows which robot is implied).
 *
 * A robot with no tcp frame is NOT a gap: an absent `tcpOrientation` has a
 * documented core/ fallback (the base→candidate proxy axis, ADR-084 §3), so the
 * card notes it instead of blocking — the gaps here mirror the controller's gate
 * exactly, or a disabled Run would forbid a run the controller would allow.
 *
 * @param {{list: {id: string, label: string, hasTcp: boolean}[], selectedId: string|null}} robots
 * @returns {string[]}
 */
/**
 * Why Run cannot proceed on the OBJECT side (ADR-117) — the twin of
 * `robotDeclarationGaps`. Returned as printed reasons, never as a bare disabled
 * button (原則 #11). An unpicked target used to be no gap at all, which is
 * precisely how the request went out with no geometry.
 *
 * @param {{list: {ref: string, label: string}[], selectedRef: string|null}} targets
 * @returns {string[]}
 */
function targetDeclarationGaps(targets) {
  const list = targets?.list ?? []
  if (list.length === 0) return ['no graspable solid in this layout — nothing to pick up']
  const selected = list.length === 1 ? list[0] : list.find(t => t.ref === targets?.selectedRef)
  if (!selected) return [`${list.length} graspable objects — pick which one to grasp`]
  return []
}

function robotDeclarationGaps(robots) {
  const list = robots?.list ?? []
  if (list.length === 0) return ['no robot in the scene — add one with Shift+A → Robot']
  const selected = list.length === 1 ? list[0] : list.find(r => r.id === robots?.selectedId)
  if (!selected) return [`${list.length} robots in the scene — pick which one to solve for`]
  return []
}

/**
 * Submit gaps from the camera roster (ADR-164 D3) — the robot rule, except that
 * 0 is NOT a gap: with no camera the search does not ask "can it be seen" (the
 * visibility stage passes everything). N with no pick, or an unreadable camera,
 * mirrors the controller's `no-camera` gate exactly.
 */
function cameraDeclarationGaps(cameras) {
  const list = cameras?.list ?? []
  if (list.length === 0) return []
  if (!cameras?.selectedId) return [`${list.length} cameras in the scene — pick which one "can it be seen" is asked from`]
  const sel = cameras.selected
  if (sel?.state === 'malformed') return [`camera "${sel.label}": ${sel.errors?.[0] ?? 'cannot be read'}`]
  return []
}

export function GraspSearchPanel() {
  const grasp     = useUIStore(s => s.context.grasp)
  const robots       = useUIStore(s => s.context.robots)
  const graspTargets = useUIStore(s => s.context.graspTargets)
  const graspRelations = useUIStore(s => s.context.graspRelations)
  const graspAnalysis = useUIStore(s => s.context.graspAnalysis)
  const bffConnected  = useUIStore(s => s.bffConnected)
  const callbacks = useUIStore(s => s.callbacks)

  const [reach, setReach]         = useState(0.6)
  const [clearance, setClearance] = useState(0.4)
  const [stability, setStability] = useState(1.0)
  const [holdWeight, setHoldWeight] = useState(DEFAULT_OBJECTIVE_WEIGHT[OBJECTIVE.SUCTION_HOLD])
  const [topN, setTopN]           = useState(5)
  // Client-side sort key: 'total' or an objective name. Never re-runs the query
  // (a grasp request is invariant — ADR-057 §Rendering).
  const [sortKey, setSortKey]     = useState('total')

  // The vision CAMERA is a scene entity (ADR-164 D3): its pose and field of view
  // are declared on its own panel, and this panel only picks which one (0 / 1 / N)
  // — the roster arrives derived, like the robots'.
  const cameras = useUIStore(s => s.context.cameras)
  // The HAND is not form state any more (ADR-152 D3): it is declared on the
  // search subject's tcp and arrives in the roster projection. This card is a
  // view of it; every edit goes to the scene through one undoable command.
  const handProj = robots?.hand ?? null
  const hand     = handProj?.hand ?? null
  const handKind = hand?.kind ?? null
  // 探索の**設定** (重み) は今日ここ — React state — に住み、**キーを持たない**:
  // リロードで消え、export に載らず、undo の外に居る。ハンドは ADR-152 D3 で tcp に、
  // カメラは ADR-164 D3 でシーンの実体に住んだ。残る重みの持ち主は ADR-165 (場の判定基準)
  // が決めており、移るまでここに居る — `DECLARATION_OWNERS` の `movesWith` がそれを
  // 名指しする。文書への住所は**未実装** (ADR-129 の MVP の外)。**DEF-033**。
  // The reach envelope (ADR-128) is declared on the ROBOT's own panel now
  // (ADR-164 D1 — the ARM domain, `ArmDeclarations`); Run only reads it.
  // Read for the search SUBJECT — each arm declares its own (no row = undeclared).
  const reachDecl = useUIStore(s => s.context.reachDeclarations[s.context.robots.selectedId] ?? UNDECLARED_REACH)
  const selectEntity = (id) => { if (id) callbacks.outlinerOnSelect?.(id) }

  const planParams = useMemo(() => ({
    reachMin:           parseNum(reachDecl.reachMin),
    reachMax:           parseNum(reachDecl.reachMax),
    wristConeHalfAngle: parseNum(reachDecl.wristConeHalfAngle),
  }), [reachDecl])
  // The gap lists ARE the submit predicate (ADR-058 UX discipline): non-empty
  // disables Run and every reason is printed below the button.
  // Which camera "can it be seen" is asked from (ADR-164 D3) — 0 is a state (not
  // asked), N with no pick is a gap; mirrors the controller's `no-camera` gate.
  const visionGaps = cameraDeclarationGaps(cameras)
  // The hand's own gaps mirror the controller's gate: unreadable, or contradicting
  // the tool mount (ADR-152 D3). An UNDECLARED hand is not a gap — it is a state.
  const gripGaps   = handProj?.state === 'malformed'
    ? handProj.errors.map(e => `hand: ${e}`)
    : handProj?.mountGap ? [handProj.mountGap] : []
  // A grasp is solved FOR a robot (ADR-090): with none in the scene, or several
  // and no pick, there is no premise — so it is a submit gap like any missing
  // declaration, printed under a disabled Run rather than discovered by failing.
  const robotGaps  = robotDeclarationGaps(robots)
  const targetGaps = targetDeclarationGaps(graspTargets)
  const reachGaps  = reachDecl.enabled ? reachDeclarationGaps(planParams) : []
  // WHERE-to-grasp gaps (ADR-119 D2/D3): an unreadable declaration, or a single
  // face under a parallel jaw. Mirrors the controller's own gate exactly — a
  // disabled Run that forbids a run the controller would allow (or the reverse)
  // is the divergence 原則 #11 is about.
  const featureGaps = graspFeatureGaps(graspTargets?.feature ?? null, handKind)
  // WHICH hand the target's grasp is declared for (ADR-164 D2) — computed by the
  // controller from the same relation its own gate reads, so the two cannot differ.
  const relationGaps = graspRelations?.targetHandGap ? [graspRelations.targetHandGap] : []
  const gaps       = [...robotGaps, ...targetGaps, ...featureGaps, ...relationGaps, ...visionGaps, ...gripGaps, ...reachGaps]

  // Keep the viewport overlay showing what Run WOULD send (ADR-128). The hand
  // kind lives in this form, so the panel is what knows when the answer changed —
  // the controller cannot observe a local useState. Re-runs on the three inputs
  // that move the samples: which object, what was declared about it, which hand.
  useEffect(() => {
    callbacks.onPreviewGraspSamples?.()
    // The hand (its shape and the mount) changes the declaration picture too —
    // the preview hand and the finger sections are drawn from it (ADR-152 D6).
  }, [callbacks, handKind, handProj, graspTargets?.selectedRef, graspTargets?.feature, graspTargets?.massProperties, graspTargets?.lift])

  const status   = grasp?.status ?? 'idle'
  const busy     = status === 'compiling' || status === 'solving'
  const run = () => callbacks.onRunGraspSearch?.({
    // Wire keys must be core/'s registered objective names — an unregistered key
    // is dropped silently by the solver, which is how the sliders spent their
    // whole life controlling nothing (ADR-117).
    // Which objectives are asked for follows the hand (`objectivesForHand` —
    // `suction_hold` only under a cup, ADR-156 D4); the values are the sliders.
    weights: Object.fromEntries(objectivesForHand(handKind).map(o => [o, Number({
      [OBJECTIVE.REACH_MARGIN]:       reach,
      [OBJECTIVE.APPROACH_CLEARANCE]: clearance,
      [OBJECTIVE.GRASP_STABILITY]:    stability,
      [OBJECTIVE.SUCTION_HOLD]:       holdWeight,
    }[o])])),
    topN:     Number(topN),
    // Omitted, not zeroed, when undeclared (ADR-120 / 原則 #31).
    plan:     reachDecl.enabled ? planParams : null,
  })

  // Objective names present across the returned candidates (for sort buttons).
  // Deliberately the RETURNED keys, not the requested ones: an objective nobody
  // could evaluate has nothing to sort by (ADR-120 — it is named in the
  // candidate's "not measured" line instead of offered as a dead chip).
  const objectiveKeys = useMemo(() => {
    if (status !== 'results') return []
    const keys = new Set()
    for (const c of grasp.candidates ?? []) {
      for (const k of Object.keys(c.score?.objectiveScores ?? {})) keys.add(k)
    }
    return [...keys].sort()
  }, [status, grasp])

  // The weights THIS RUN requested — the population every candidate's score rows
  // are counted against (ADR-120 D3 / PHILOSOPHY #31). Read from the run's own
  // record rather than the live sliders, which may have moved since Run.
  const requestedWeights = status === 'results'
    ? (grasp.request?.graspSearch?.objectiveWeights ?? null)
    : null

  const sorted = useMemo(() => {
    if (status !== 'results') return []
    const list = [...(grasp.candidates ?? [])]
    const valueOf = (c) => sortKey === 'total'
      ? (c.score?.totalScore ?? -Infinity)
      : (c.score?.objectiveScores?.[sortKey] ?? -Infinity)
    return list.sort((a, b) => valueOf(b) - valueOf(a))
  }, [status, grasp, sortKey])

  return (
    // `overflow-wrap` is inherited: every reason, ref and path in this panel wraps
    // instead of running off a phone's edge (ADR-157 D8 — a reason cut in half is
    // not a reason, 原則 #11).
    <div style={{ fontSize: '12px', color: '#ddd', overflowWrap: 'anywhere' }}>
      <div style={{ color: '#888', fontSize: '10px', marginBottom: '8px', lineHeight: 1.5 }}>
        UI → DSL → BFF → grasp-search (verify). The request is a query — geometry is unchanged,
        so it is not on the undo stack.
      </div>

      {/* Source layout — WHERE each half came from is shown, not inferred
          (ADR-132 D3 / 原則 #31). "the document declares no grasp location here"
          and "no document was consulted" produce identical targets; only this
          line separates them. */}
      <div style={{ fontSize: '11px', color: '#bbb', marginBottom: '10px' }}>
        Source layout:{' '}
        <code style={{ color: '#9ad' }}>{grasp?.layout?.version ?? '—'}</code>
        {' · '}
        <span>{grasp?.layout?.entities ?? 0} entit{(grasp?.layout?.entities === 1) ? 'y' : 'ies'}</span>
        {grasp?.layout?.geometrySource && (
          <div style={{ color: '#888', fontSize: '10px', marginTop: '3px' }}>
            geometry: <span style={{ color: '#9ad' }}>{sourceLabel(grasp.layout.geometrySource)}</span>
            {' · '}
            grasp locations: <span style={{ color: '#9ad' }}>{sourceLabel(grasp.layout.declarationSource)}</span>
            {grasp.layout.unconvertible > 0 && (
              <span style={{ color: COLOR.cautionTone }}>
                {' · '}{grasp.layout.unconvertible} object(s) the search cannot express
              </span>
            )}
          </div>
        )}
      </div>

      {/* Three domain declaration cards (ADR-081 Decision 5): 見える / 届く /
          掴める. Each card only DECLARES (camera / robot base / gripper) —
          the gates themselves are solved in core/ and their results come back
          through the contract funnel below. */}
      <DomainCard title="Seen" domain="vision" alwaysOn offHint={null}>
        {/* WHICH camera "can it be seen" is asked from (ADR-164 D3). The camera
            is a scene entity; its pose and field of view are declared on its own
            panel (▸). 0 cameras = visibility is not asked — a state, said here. */}
        <CameraPicker cameras={cameras} onSelect={(id) => callbacks.onSelectCamera?.(id)} />
        <CameraOwnerLine cameras={cameras} onSelect={selectEntity} />
      </DomainCard>

      <DomainCard title="Reached" domain="path" alwaysOn
        offHint={null}
      >
        {/* Which robot this search is solved for (ADR-090 Decision 3). A fixed
            slot: it is always here, and reports 0 / 1 / N honestly instead of
            appearing only when several robots exist (原則 #15). */}
        <RobotPicker robots={robots} onSelect={(id) => callbacks.onSelectRobot?.(id)} />
        {/* ADR-117 — the object side of the premise, beside the robot side. */}
        <TargetPicker targets={graspTargets} onSelect={(ref) => callbacks.onSelectGraspTarget?.(ref)} />
        {/* ADR-164 D1/D2 — what the object, the hand, the arm and the grasp
            relation declare is edited on THEIR panels (select them); this check
            only reads it, and says where each one lives. HOW to grasp and how to
            lift moved to the grasp relation's panel (D2) — the relation is the
            owner of both, not the robot this panel was opened from. */}
        <OwnerDeclarationLinks
          targets={graspTargets}
          robots={robots}
          handProj={handProj}
          reachDecl={reachDecl}
          relations={graspRelations}
          handKind={handKind}
          onSelect={selectEntity}
          onSelectRelation={(ref) => callbacks.onSelectGraspRelation?.(ref)}
        />
        <div style={{ fontSize: '10px', color: '#889', marginBottom: '5px' }}>
          robot placement follows its <code style={{ color: '#9ad' }}>base</code> /{' '}
          <code style={{ color: '#9ad' }}>tcp</code> frames
          <span style={{ color: '#667' }}> — move / aim them in the viewport (G / R) or the N-panel</span>
          {/* 据付姿勢の仮定を**述べる** (ADR-129 D2)。`jointLimits` の不在を「無限」と
              読ませなかったのと同じ判断だが (ADR-127 D4)、違いは*仮定を消せない*こと —
              向き無しでは解けないので core/ は恒等で解くしかなく、だから言うしかない。
              言わなければ「直立と決めた」と「述べていない」が画面上で同じ顔になる。 */}
          {!robots?.selectedId && (
            <div style={{ color: '#caa', marginTop: '2px' }}>
              no robot chosen — its mounting orientation cannot be read yet
            </div>
          )}
        </div>
        <div data-declaration="objectiveWeights" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <NumField label="reach weight"     value={reach}     step="0.1" onChange={setReach} />
          <NumField label="clearance weight" value={clearance} step="0.1" onChange={setClearance} />
          <NumField label="stability weight" value={stability} step="0.1" onChange={setStability} />
          {/* Fixed slot (原則 #15): always here, disabled unless a cup is declared —
              under jaws suction_hold cannot be evaluated and is not asked for. */}
          <NumField label="hold weight" value={holdWeight} step="0.1" onChange={setHoldWeight}
            disabled={handKind !== GRIPPER_KIND.SUCTION}
            title={handKind !== GRIPPER_KIND.SUCTION ? 'suction hold is scored only for a suction hand' : undefined} />
        </div>
      </DomainCard>


      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginTop: '2px' }}>
        <span data-declaration="topN"><NumField label="topN" value={topN} step="1" min="1" onChange={setTopN} /></span>
        <button
          onClick={run}
          disabled={busy || gaps.length > 0}
          style={{
            padding: '6px 14px', borderRadius: '5px', border: '1px solid #3a7bd5',
            background: (busy || gaps.length > 0) ? '#2a3a52' : '#1d4f8f', color: '#dceaff',
            cursor: (busy || gaps.length > 0) ? 'default' : 'pointer', fontSize: '12px', fontWeight: 'bold',
          }}
        >
          {busy ? 'Running…' : 'Run grasp search'}
        </button>
      </div>
      {/* The gap list is the submit predicate — a disabled Run always prints
          its reasons (never a silent disabled, PHILOSOPHY #11). */}
      {gaps.map((g, i) => (
        <div key={i} style={{ fontSize: '10px', color: '#caa', marginTop: '3px' }}>· {g}</div>
      ))}

      <StatusLine grasp={grasp} />
      <StubBadge />

      {/* Rejection funnel (contract v3 diagnostics) — instant "what happened"
          feedback, especially when the list is empty. Presentation only:
          everything below derives from the wire facts via GraspFunnelMath. */}
      {status === 'results' && (
        <DiagnosticsFunnel diagnostics={grasp.diagnostics} prev={grasp.prevDiagnostics} />
      )}
      {status === 'results' && (
        <SpecResults rows={specResultRows(grasp.diagnostics, grasp.candidates ?? [])} />
      )}
      {/* ADR-157 — interference by motion phase, and the background all-phase
          analysis. The analysis card keeps its slot whatever the status
          (原則 #15): disabled with the reason when it cannot run. */}
      {status === 'results' && <InterferencePhaseRows rows={phaseRows(grasp.diagnostics)} />}
      <InterferenceAnalysisCard
        grasp={grasp}
        analysisState={graspAnalysis ?? null}
        availability={analysisAvailability({
          stubLane: GRASP_STUB, bffConnected: bffConnected === true,
          grasp, analysisState: graspAnalysis ?? null,
        })}
        onRun={() => callbacks.onRunInterferenceAnalysis?.()}
      />

      {/* Sort controls + candidates */}
      {status === 'results' && (
        <div style={{ marginTop: '10px' }}>
          {(grasp.candidates ?? []).length === 0 && !grasp.diagnostics && (
            <div style={{ fontSize: '11px', color: '#caa' }}>
              No candidates returned (the solver found no feasible pose).
            </div>
          )}

          {(grasp.candidates ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: '#888' }}>sort:</span>
              <SortChip label="total" active={sortKey === 'total'} onClick={() => setSortKey('total')} />
              {objectiveKeys.map(k => (
                <SortChip key={k} label={k} active={sortKey === k} onClick={() => setSortKey(k)} />
              ))}
            </div>
          )}

          {sorted.map((c, i) => (
            <Candidate
              key={c.rank ?? i}
              c={c}
              requestedWeights={requestedWeights}
              selected={grasp.selectedRank === c.rank}
              onSelect={() => callbacks.onSelectGraspCandidate?.(c.rank)}
              onHover={(rank) => callbacks.onHoverGraspCandidate?.(rank)}
            />
          ))}
        </div>
      )}

      {/* Error detail */}
      {status === 'error' && (
        <div style={{
          marginTop: '10px', padding: '8px 10px', borderRadius: '5px',
          background: '#3a2222', border: '1px solid #6a3333', color: '#f0c0c0', fontSize: '11px',
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            {grasp.httpStatus ? `HTTP ${grasp.httpStatus} — ` : ''}{grasp.message}
            <span style={{ color: '#c98', marginLeft: '4px' }}>({grasp.stage})</span>
          </div>
          {(grasp.details ?? []).map((d, i) => (
            <div key={i} style={{ color: '#d8a8a8' }}>· {d}</div>
          ))}
        </div>
      )}
    </div>
  )
}





// ── Domain declaration cards (ADR-081 Decision 5) ────────────────────────────

/**
 * One card per verification domain (Seen / Reached / Grasped). A disabled
 * card keeps its slot and states the consequence of not declaring (Fixed
 * Slots — PHILOSOPHY #15; the vacuously-true gate is stated, never implied).
 * The Path card is `alwaysOn`: reach / IK / interference always run.
 */
function DomainCard({ title, domain, declaration, enabled, onToggle, alwaysOn, offHint, offExtra, children }) {
  const on = alwaysOn || enabled
  return (
    <div data-declaration={declaration} style={{ marginBottom: '8px', padding: '7px 9px', borderRadius: '5px', background: '#222', border: BORDER }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: on ? '6px' : '3px' }}>
        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#cdd' }}>{title}</span>
        <span style={{ fontSize: '9px', color: '#667' }}>({domain})</span>
        {alwaysOn ? (
          <span style={{ marginLeft: 'auto', fontSize: '9px', color: '#7a9' }}>always on</span>
        ) : (
          <label style={{ marginLeft: 'auto', fontSize: '10px', color: '#aaa', display: 'flex', gap: '4px', cursor: 'pointer', alignItems: 'center' }}>
            <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} />
            declare
          </label>
        )}
      </div>
      {on ? children : (
        <>
          <div style={{ fontSize: '10px', color: '#776' }}>{offHint}</div>
          {offExtra}
        </>
      )}
    </div>
  )
}

/**
 * Robot picker — "which robot is this grasp for?" (ADR-090 Decision 3).
 *
 * One component, three cardinalities, always occupying the same slot:
 *   none   — an honest empty state naming the way out (Add menu), not a blank
 *            dropdown the user can only stare at (原則 #11/#15).
 *   single — the implied robot's label, read-only: no choice to make.
 *   multi  — a real <select>, unset until the user picks (no default: solving for
 *            an arm nobody chose is the failure this whole ADR is about).
 */
/**
 * OwnerDeclarationLinks — what the object, the hand and the arm have declared,
 * READ here and edited on their owners' panels (ADR-164 D1).
 *
 * The check (this panel) stays beside its subject (ADR-110) but no longer holds
 * the declarations of three other entities: each line states the declaration's
 * state — never a default (ADR-120) — and `▸` selects the entity that owns it,
 * whose N panel carries the editor. A line whose owner is not on screen says so
 * instead of offering a link that lands nowhere (原則 #11).
 */
function OwnerDeclarationLinks({ targets, robots, handProj, reachDecl, relations, handKind, onSelect, onSelectRelation }) {
  const subject = (robots?.list ?? []).find(r => r.id === robots?.selectedId) ?? null
  const targetRow = (targets?.list ?? []).find(t => t.ref === targets?.selectedRef) ?? null
  const mp = targets?.massProperties ?? null
  const massWord = !mp ? null
    : mp.mass.state === MASS_DECLARATION_STATE.DECLARED ? `${mp.mass.kg} kg`
      : mp.mass.state === MASS_DECLARATION_STATE.UNDECLARED ? 'not declared' : 'unreadable'
  const handWord = !handProj ? null
    : handProj.state === 'declared' ? (handProj.hand?.kind === GRIPPER_KIND.SUCTION ? 'suction' : 'parallel jaw')
      : handProj.state === 'malformed' ? 'unreadable' : 'not declared'
  // The target's grasp relation (ADR-164 D2): how to grasp + how to lift live on
  // it. Summarised in the words the editor uses, never re-derived here.
  const relation = targetRow ? (relations?.list ?? []).find(r => r.objectRef === targetRow.ref) ?? null : null
  const derivedFaces = (() => { try { return [...facesForGripperKind(handKind ?? null)] } catch { return [] } })()
  const graspRow = targetRow && {
    key: 'grasp', label: 'how to grasp',
    // The summary already says "not declared — sampling …" for the silent state.
    word: graspFeatureSummary(targets?.feature ?? null, derivedFaces),
    // An object with no grasp declaration has no relation yet: the way in is the
    // object (declare there → the relation appears). The relation's own row
    // otherwise.
    ...(relation
      ? { owner: `grasp: ${relation.objectLabel} × ${relation.tcpLabel ?? 'hand not declared'}`, relationRef: relation.objectRef }
      : { owner: `grasp: ${targetRow.label}`, relationRef: targetRow.ref }),
  }
  const rows = [
    graspRow,
    targetRow && massWord && { key: 'mass', label: 'object mass', word: massWord, owner: targetRow.label, id: targetRow.sceneId },
    subject && handWord && { key: 'hand', label: 'hand', word: handWord, owner: `${subject.label} tcp`, id: subject.tcpId },
    subject && {
      key: 'reach', label: 'reach envelope',
      word: reachDecl?.enabled ? `${reachDecl.reachMin}–${reachDecl.reachMax} m` : 'not declared (reach margin NOT MEASURED)',
      owner: subject.label, id: subject.id,
    },
  ].filter(Boolean)
  if (rows.length === 0) return null
  return (
    <div style={{ fontSize: '10px', color: COLOR.textSecondary, margin: '4px 0 6px' }}>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'flex', gap: '4px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span>{r.label}: {r.word}</span>
          {r.relationRef ? (
            <button type="button" onClick={() => onSelectRelation(r.relationRef)}
              data-testid={`owner-link-${r.key}`}
              title={`edit on ${r.owner}'s panel`}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: COLOR.infoTone, fontSize: '10px' }}>
              ▸ {r.owner}
            </button>
          ) : r.id ? (
            <button type="button" onClick={() => onSelect(r.id)}
              data-testid={`owner-link-${r.key}`}
              title={`edit on ${r.owner}'s panel`}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: COLOR.infoTone, fontSize: '10px' }}>
              ▸ {r.owner}
            </button>
          ) : (
            <span>— declared on {r.owner}, which is not in the scene</span>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * CameraPicker — WHICH camera "can it be seen" is asked from (ADR-164 D3). The
 * robot picker's three shapes; the empty state is a state, not a gap.
 */
function CameraPicker({ cameras, onSelect }) {
  const list = cameras?.list ?? []
  return (
    <PickerRow
      label="camera"
      cardinality={cameras?.cardinality ?? 'none'}
      value={cameras?.selectedId ?? ''}
      options={list.map(c => ({ value: c.id, label: c.label }))}
      onSelect={onSelect}
      none={<>none in scene — visibility is not asked (add one with <code style={PICKER.hint}>Shift+A → Camera</code>)</>}
      single={<>{list[0]?.label}</>}
    />
  )
}

/** What the asked-from camera declares, read here and edited on its own panel (▸). */
function CameraOwnerLine({ cameras, onSelect }) {
  const sel = cameras?.selected
  if (!sel) return null
  const fov = sel.state === 'malformed' ? 'unreadable'
    : sel.fovHalfAngle != null ? `field of view ±${sel.fovHalfAngle} rad` : 'no field of view (line of sight only)'
  return (
    <div style={{ fontSize: '10px', color: COLOR.textSecondary, margin: '4px 0 2px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      <span>{fov}</span>
      <button type="button" onClick={() => onSelect(sel.id)}
        data-testid="owner-link-camera"
        title={`edit on ${sel.label}'s panel`}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: COLOR.infoTone, fontSize: '10px' }}>
        ▸ {sel.label}
      </button>
    </div>
  )
}

function RobotPicker({ robots, onSelect }) {
  const list = robots?.list ?? []
  return (
    <PickerRow
      label="robot"
      cardinality={robots?.cardinality ?? 'none'}
      value={robots?.selectedId ?? ''}
      options={list.map(r => ({ value: r.id, label: r.label }))}
      onSelect={onSelect}
      none={<>none in scene — add one with <code style={PICKER.hint}>Shift+A → Robot</code></>}
      single={<>
        {list[0]?.label}
        {list[0]?.hasTcp === false && (
          <span style={PICKER.muted}> (no tcp — wrist aim falls back to the approach axis)</span>
        )}
      </>}
    />
  )
}


/**
 * One premise picker row, in the three shapes the cardinality allows:
 *   none   — an honest empty state naming the way out, not a blank dropdown the
 *            user can only stare at (原則 #11/#15).
 *   single — the implied choice, read-only: there is nothing to decide.
 *   multi  — a real <select>, unset until picked. No default: solving for a
 *            subject nobody chose is the failure ADR-090 and ADR-117 are about.
 */
function PickerRow({ label, cardinality, value, options, onSelect, none, single }) {
  return (
    <div style={PICKER.row}>
      <span style={PICKER.label}>{label}</span>
      {cardinality === 'none'   && <span style={PICKER.muted}>{none}</span>}
      {cardinality === 'single' && <span style={PICKER.chosen}>{single}</span>}
      {cardinality === 'multi'  && (
        <select
          value={value}
          onChange={(e) => onSelect(e.target.value || null)}
          style={PICKER.select}
        >
          <option value="">— pick one of {options.length} —</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  )
}

/**
 * TargetPicker — WHICH OBJECT the search is about (ADR-117).
 *
 * Deliberately the same three shapes as RobotPicker, because it is the same
 * question asked of the other half of the premise:
 *   none   — the layout declares nothing graspable. An honest empty state, not a
 *            dropdown with no options (原則 #11/#15).
 *   single — the implied object's label, read-only: no choice to make.
 *   multi  — a real <select>, unset until picked. No "first solid" default: on
 *            the quick-start cell the first solid is the robot's own pedestal,
 *            so a default would silently declare "grasp your own plinth".
 */
function TargetPicker({ targets, onSelect }) {
  const list = targets?.list ?? []
  return (
    <PickerRow
      label="object"
      cardinality={targets?.cardinality ?? 'none'}
      value={targets?.selectedRef ?? ''}
      options={list.map(t => ({ value: t.ref, label: t.label }))}
      onSelect={onSelect}
      none="nothing graspable in this layout — add a solid to pick up"
      single={list[0]?.label}
    />
  )
}



function StatusLine({ grasp }) {
  const status = grasp?.status ?? 'idle'
  const map = {
    'idle':      { text: 'Ready.', color: '#999' },
    'no-layout': { text: 'No renderable layout to search.', color: '#caa' },
    // ADR-090 Decision 4 — the gate that replaced silently solving for a ghost
    // robot. Carries its own reason, so the line never says just "failed".
    'no-robot':  { text: grasp?.reason ?? 'No robot to solve for.', color: '#caa' },
    // ADR-117 — the twin gate. Before it, an absent target was not a state at
    // all: the request simply went out without geometry and came back with a
    // perfectly well-formed "0 candidates generated" (原則 #31).
    'no-target': { text: grasp?.reason ?? 'No object to grasp.', color: '#caa' },
    // ADR-164 D3 — N cameras and none picked (or an unreadable one). 0 cameras
    // never lands here: then visibility is simply not asked.
    'no-camera': { text: grasp?.reason ?? 'No camera picked.', color: '#caa' },
    'compiling': { text: 'Compiling layout on BFF…', color: '#cc9' },
    'solving':   { text: 'BFF compile OK — requesting grasp candidates…', color: '#9c9' },
    'results':   {
      text: grasp?.diagnostics
        ? `Done — ${grasp?.candidates?.length ?? 0} candidate(s) (${grasp.diagnostics.feasible} feasible of ${grasp.diagnostics.candidatesGenerated} generated).`
        : `Done — ${grasp?.candidates?.length ?? 0} candidate(s).`,
      color: '#9c9',
    },
    'error':     { text: 'Failed — see detail below.', color: '#d99' },
  }
  const s = map[status] ?? map.idle
  return <div style={{ marginTop: '8px', fontSize: '11px', color: s.color }}>{s.text}</div>
}

// ── Rejection funnel (contract v4 `diagnostics`, ADR-081 domain stages) ───────
//
// The wire carries only the solver-decided funnel counts + the per-domain
// nearest-misses; everything visual here (stage labels, bar widths, dominant
// highlight, delta chips, the near-miss meter curves, the KPI → fallback-ladder
// forecast, all wording) is client-derived presentation via the pure
// GraspFunnelMath / GraspLadderMath helpers (PHILOSOPHY #29 / ADR-060/081). No
// reach / IK / visibility / collision / grasp judgment is re-implemented
// client-side.

const STAGE_LABELS = { reach: 'reach', ik: 'IK', grasp: 'grasp', visibility: 'visible', interference: 'clearance' }


/**
 * InterferencePhaseRows (ADR-157 D2/D3) — where the interference rejections
 * happened, one row per motion phase. An unevaluated phase shows its REASON
 * and no number: "0 rejected" and "not judged" must never look alike (ADR-120).
 */
function InterferencePhaseRows({ rows }) {
  if (!rows) return null
  return (
    <div style={{ marginTop: '8px', fontSize: '10px', color: COLOR.textSecondary }}>
      <div style={{ marginBottom: '2px' }}>clearance by motion phase (rejected first here)</div>
      {rows.map(r => (
        <div key={r.phase} style={{ display: 'flex', gap: '6px', alignItems: 'baseline', marginBottom: '3px' }}>
          <span style={{ minWidth: '110px', color: r.evaluated ? COLOR.textPrimary : COLOR.textSecondary }}>{r.label}</span>
          {r.evaluated
            ? <span style={{ color: r.rejected > 0 ? COLOR.cautionTone : COLOR.factTone }}>{r.rejected}</span>
            : <span style={{ color: COLOR.textSecondary, flex: 1 }}>{r.note}</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * InterferenceAnalysisCard (ADR-157 D6) — every phase judged to the end, run in
 * the background against the real backend. Its state is its own slot, so the
 * search and the rest of the app keep working while it runs; a result for a
 * search that has since been re-run is kept and marked stale (derived).
 */
function InterferenceAnalysisCard({ grasp, analysisState, availability, onRun }) {
  const freshness = analysisFreshness(analysisState, grasp)
  const done = analysisState?.status === 'done'
  const summary = done ? analysisSummary(analysisState.analysis, analysisState.obstacleLabels) : null
  return (
    <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '5px', background: COLOR.surfaceSunken, border: `1px solid ${COLOR.border}` }}>
      <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginBottom: '5px' }}>
        where does it hit? — every phase judged to the end, in the background
      </div>
      <div>
        <button
          onClick={onRun}
          disabled={!availability.enabled}
          title={availability.reason ?? undefined}
          style={{
            padding: '3px 10px', borderRadius: '4px', border: `1px solid ${COLOR.infoTone}`, fontSize: '11px',
            background: availability.enabled ? COLOR.infoTone : COLOR.surfaceRaised, color: COLOR.textPrimary,
            cursor: availability.enabled ? 'pointer' : 'default',
          }}
        >
          {analysisState?.status === 'running' ? 'Analysing…' : 'Analyse all phases'}
        </button>
      </div>
      {/* A disabled button always says why (原則 #11 / #15). */}
      {!availability.enabled && availability.reason && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginTop: '4px' }}>{availability.reason}</div>
      )}
      {freshness === 'stale' && (
        <div style={{ fontSize: '10px', color: COLOR.cautionTone, marginTop: '4px' }}>
          stale — this analysis is of an earlier search. Run it again for the current one.
        </div>
      )}
      {analysisState?.status === 'failed' && (
        <div style={{ fontSize: '10px', color: COLOR.dangerTone, marginTop: '4px' }}>failed — {analysisState.message}</div>
      )}
      {summary && (
        <div style={{ marginTop: '6px', fontSize: '10px', color: COLOR.textSecondary, opacity: freshness === 'stale' ? 0.6 : 1 }}>
          <div style={{ marginBottom: '3px' }}>{summary.candidatesAnalysed} candidates reached clearance; hits per phase (a candidate can hit in several):</div>
          {summary.phases.map(p => (
            <div key={p.phase} style={{ marginBottom: '3px' }}>
              <div style={{ color: p.collided > 0 ? COLOR.cautionTone : COLOR.factTone }}>{p.label}: {p.collided}</div>
              {p.hits.map((h, i) => (
                <div key={i} style={{ paddingLeft: '10px', color: COLOR.textSecondary }}>
                  · {h.partLabel} × {h.obstacle} — {h.candidates}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Per-spec results (ADR-152 D4/D6 — the strategy's confirmation): each spec in
 * priority order with `returned / feasible / generated`. A spec with feasible
 * candidates that returned none (priority order, an earlier spec won) reads
 * differently from one that had nothing — both are shown, never folded away.
 */
function SpecResults({ rows }) {
  if (!rows) return null
  return (
    <div style={{ marginTop: '8px', fontSize: '10px', color: COLOR.textSecondary }}>
      <div style={{ marginBottom: '2px' }}>by grasp spec (returned / feasible / generated)</div>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: 'flex', gap: '6px' }}>
          <span style={{ minWidth: '14px' }}>{i + 1}</span>
          <span style={{ flex: 1, color: r.returned > 0 ? COLOR.infoTone : COLOR.textSecondary }}>{r.id}</span>
          <span>{r.returned} / {r.feasible} / {r.generated}</span>
        </div>
      ))}
    </div>
  )
}

function DiagnosticsFunnel({ diagnostics, prev }) {
  const funnel = funnelStages(diagnostics)
  if (!funnel) return null   // legacy / absent diagnostics → degrade silently

  // "Surface samples empty" input guide: nothing was even generated, so no
  // stage bar can explain anything — guide the input instead (PHILOSOPHY #11).
  if (funnel.generated === 0) {
    return (
      <div style={{
        marginTop: '10px', padding: '8px 10px', borderRadius: '5px',
        background: '#332a1d', border: '1px solid #6a5533', color: '#e8cf9f', fontSize: '11px', lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>0 candidate poses generated</div>
        The target's surface sampling came back empty, so there was nothing to
        filter. Check that the layout contains graspable geometry (a solid the
        gripper could actually touch) and that it is where you expect it.
      </div>
    )
  }

  const dominant = dominantStage(diagnostics)
  const delta    = funnelDelta(prev, diagnostics)
  const kpis     = domainKpis(diagnostics)
  const risks    = ladderRisks(kpis)
  // One meter per measurable domain nearest-miss (ADR-081): reach (Path),
  // occlusion (Vision), opening (Grasp). Null facts render no meter.
  const meters = [
    { key: 'reach',     miss: diagnostics.reachNearestMiss,     what: 'missed reach by' },
    { key: 'occlusion', miss: diagnostics.occlusionNearestMiss, what: 'occluded by' },
    // Contract v5 (ADR-118): the label comes from the wire's `kind`, so a suction
    // seal shortfall is never printed as an "opening". Reporting one quantity under
    // the other's name is the failure the union was added to prevent.
    {
      key:  'grasp',
      miss: diagnostics.graspNearestMiss?.shortfall ?? null,
      what: diagnostics.graspNearestMiss?.kind === 'sealPatch'
        ? 'seal patch short by'
        : 'opening short by',
    },
  ].map(m => ({ ...m, closeness: nearMissCloseness(m.miss) }))
   .filter(m => m.closeness != null)

  return (
    <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '5px', background: '#222', border: BORDER }}>
      <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px' }}>
        rejection funnel — {funnel.generated} generated
        {delta && <DeltaChip value={delta.generated} goodWhenPositive label="gen" />}
      </div>

      {funnel.stages.map(s => (
        <FunnelRow
          key={s.key}
          label={STAGE_LABELS[s.key] ?? s.key}
          stage={s}
          dominant={s.key === dominant}
          delta={delta ? delta[s.key] : null}
        />
      ))}

      {/* Survivors */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px', fontSize: '10px' }}>
        <span style={{ width: '64px', textAlign: 'right', color: '#9d9' }}>feasible</span>
        <span style={{ color: '#9d9', fontWeight: 'bold' }}>{funnel.feasible}</span>
        <span style={{ color: '#777' }}>→ returned {funnel.returned}</span>
        {delta && <DeltaChip value={delta.feasible} goodWhenPositive label="feasible" />}
      </div>

      {meters.map(m => (
        <NearMissMeter key={m.key} label={m.key} what={m.what} miss={m.miss} closeness={m.closeness} />
      ))}

      {risks.length > 0 && <LadderRisks risks={risks} kpis={kpis} />}
    </div>
  )
}

/**
 * Operation-fallback ladder forecast (ADR-081 Decision 3): the KPI → ladder
 * table lookup from GraspLadderMath, rendered deepest risk first. Wording and
 * levels come verbatim from the single-owner table — this is an empirical
 * forecast of rework depth, not an assurance verdict, so it is captioned as
 * such.
 */
function LadderRisks({ risks, kpis }) {
  return (
    <div style={{ marginTop: '7px', paddingTop: '6px', borderTop: '1px solid #333' }}>
      <div style={{ fontSize: '10px', color: '#888', marginBottom: '3px' }}>
        fallback-ladder forecast (heuristic, not a guarantee)
        {kpis && (
          <span style={{ color: '#667', marginLeft: '6px' }}>
            seen {(kpis.vision.rate * 100).toFixed(0)}% · path {(kpis.path.rate * 100).toFixed(0)}% · grasp {(kpis.grasp.rate * 100).toFixed(0)}%
          </span>
        )}
      </div>
      {risks.map(r => (
        <div key={`${r.domain}-${r.level}`} style={{ display: 'flex', gap: '6px', alignItems: 'baseline', marginTop: '2px' }}>
          <span style={{
            fontSize: '9px', fontWeight: 'bold', padding: '1px 5px', borderRadius: '3px',
            background: r.level >= 5 ? '#3a2222' : '#332a1d',
            color: r.level >= 5 ? '#d99' : '#eb7',
            border: `1px solid ${r.level >= 5 ? '#6a3333' : '#6a5533'}`,
          }}>L{r.level}</span>
          <span style={{ fontSize: '10px', color: '#bba' }}>
            {r.reason}
            <span style={{ color: '#776' }}> → {r.label} ({r.cost})</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function FunnelRow({ label, stage, dominant, delta }) {
  const reduced = useReducedMotion()
  const pct = Math.max(0, Math.min(1, stage.fraction)) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
      <span style={{
        width: '64px', fontSize: '10px', textAlign: 'right',
        color: dominant ? '#eb7' : '#aaa', fontWeight: dominant ? 'bold' : 'normal',
      }}>{label}</span>
      <div style={{ flex: 1, height: '9px', background: '#1a1a1a', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: dominant ? '#b58432' : '#3a6a9d', transition: barTransition(reduced) }} />
      </div>
      <span style={{
        width: '34px', fontSize: '10px',
        color: stage.rejected > 0 ? (dominant ? '#eb7' : '#c99') : '#666',
      }}>−{stage.rejected}</span>
      {delta != null && <DeltaChip value={delta} goodWhenPositive={false} />}
      {dominant && (
        <span style={{ fontSize: '9px', color: '#eb7', whiteSpace: 'nowrap' }}>← biggest filter</span>
      )}
    </div>
  )
}

// DeltaChip moved to the shared FeedbackPrimitives (ADR-062 Phase 1) — same
// rendering, now reused by FormPanel / ConflictMatrix / ContextLayer.

/**
 * "Almost passed" meter, one per measurable domain nearest-miss (ADR-081):
 * reach / occlusion / opening are wire facts (the smallest amount by which a
 * rejected pose missed that domain's pass boundary, in the request's geometry
 * unit); the fill curve and the wording are derived feel.
 */
function NearMissMeter({ label, what, miss, closeness }) {
  const reduced = useReducedMotion()
  const pct = closeness * 100
  const feel = closeness >= 0.9 ? 'so close!' : closeness >= 0.5 ? 'almost' : 'far off'
  return (
    <div style={{ marginTop: '7px', paddingTop: '6px', borderTop: '1px solid #333' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ width: '64px', fontSize: '10px', color: '#eb7', textAlign: 'right' }}>{label} miss</span>
        <div style={{ flex: 1, height: '7px', background: '#1a1a1a', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #7a5a24, #e8b04a)', transition: barTransition(reduced) }} />
        </div>
        <span style={{ fontSize: '9px', color: '#eb7', whiteSpace: 'nowrap' }}>{feel}</span>
      </div>
      <div style={{ fontSize: '9px', color: '#997', marginTop: '2px', marginLeft: '70px' }}>
        closest rejected pose {what} {miss} (geometry unit)
      </div>
    </div>
  )
}

function Candidate({ c, requestedWeights, selected, onSelect, onHover }) {
  const sc = c.score ?? {}
  const chip = (label, ok) => (
    <span style={{
      fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
      background: ok ? '#1f3a1f' : '#3a1f1f', color: ok ? '#9d9' : '#d99',
      border: `1px solid ${ok ? '#357035' : '#703535'}`,
    }}>{label}{ok ? ' ✓' : ' ✗'}</span>
  )
  // Every objective the run ASKED FOR, marked with whether the solver could
  // evaluate it (ADR-120). Absence of a key means "not measured", which is a
  // different fact from a 0 score — so the row keeps its slot and says so
  // (PHILOSOPHY #15 fixed slots, #11 no silent omission) instead of vanishing.
  const objectives = objectiveRows(requestedWeights, sc.objectiveScores)
  const notMeasured = unevaluatedNote(objectives)
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => onHover(c.rank)}
      onMouseLeave={() => onHover(null)}
      style={{
        padding: '7px 9px', borderRadius: '5px', marginBottom: '6px', cursor: 'pointer',
        background: selected ? '#243044' : '#262626',
        border: `1px solid ${selected ? '#3a7bd5' : '#3a3a3a'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
        <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#e8e8e8' }}>#{c.rank}</span>
        {/* Which grasp spec produced it (contract v7) — a wire fact, not a guess
            from the pose. null = the derived faces (fallback / no spec). */}
        {c.graspSpecId != null && (
          <span style={{ fontSize: '10px', color: COLOR.infoTone }}>via {c.graspSpecId}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9ad' }}>
          score {typeof sc.totalScore === 'number' ? sc.totalScore.toFixed(3) : '—'}
        </span>
      </div>
      {/* Five domain-stage chips (contract v4, ADR-081): visible/graspable are
          vacuously true when the request declared no camera/gripper; on legacy
          v3 payloads the two chips are simply absent (degrade, no guessing). */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: objectives ? '6px' : 0 }}>
        {chip('reach', sc.withinReach)}
        {typeof sc.visible === 'boolean' && chip('seen', sc.visible)}
        {chip('IK', sc.ikSolvable)}
        {chip('clear', sc.interferenceFree)}
        {typeof sc.graspable === 'boolean' && chip('grasp', sc.graspable)}
      </div>
      {/* objectiveScores bars — the order-explaining signal (ADR-057 G2). Absent on
          legacy solvers with no recorded request → nothing drawn (degrade — §1.3). */}
      {objectives?.rows.map(r => (
        r.evaluated
          ? <ObjectiveBar key={r.name} label={r.name} value={r.value} verdict={r.verdict} />
          : <ObjectiveUnmeasured key={r.name} label={r.name} />
      ))}
      {notMeasured && (
        <div style={{ fontSize: '9px', color: '#997', marginTop: '3px', marginLeft: '70px' }}>
          {notMeasured}
        </div>
      )}
      <PoseFooter pose={c.pose} />
      <ArmPreviewFooter reachSolution={sc.reachSolution} />
    </div>
  )
}

/**
 * Who decided the arm this row poses — the wire fact, stated (ADR-144 D2/D4).
 *
 * The row says what the CONTRACT carries, never what the client managed to find:
 * `solved` is `core/`'s configuration, anything else means nobody solved one and
 * whatever arm appears was solved by the client alone — which is why it appears
 * translucent.
 *
 * **The wording changed with ADR-147 and the change matters.** It used to say
 * "approximation (position only)", which was true of the sampling search it
 * described. The client now runs the same closed form `core/` runs, so the pose
 * is exact, orientation included — calling it approximate would understate it in
 * the wrong direction and invite someone to "improve" a number that is already
 * machine-precise. What is actually missing is every judgement that is not
 * kinematics: interference, visibility, graspability, score. The caption names
 * THAT.
 *
 * Phrasing it as "any arm shown" rather than "the arm shown" keeps it true in the
 * case where the pose is out of reach and the skeleton stays at rest
 * (PHILOSOPHY #11: the caption may not promise a preview the solver may decline
 * to produce).
 */
function ArmPreviewFooter({ reachSolution }) {
  if (!reachSolution) return null
  if (reachSolution.kind === 'solved') {
    return (
      <div style={{ marginTop: '3px', fontSize: '10px', color: '#7a9' }}>
        arm: solver's joint solution
      </div>
    )
  }
  return (
    <div style={{ marginTop: '3px', fontSize: '10px', color: '#886' }}>
      arm: no joint solution on the wire — any arm shown is solved by this
      browser and checked against nothing (no interference or visibility)
    </div>
  )
}

/**
 * Honest spatial-capability caption (ADR-059 §A-1): the SAME pure gate the
 * controller uses decides what the row promises — a passing pose invites the
 * ghost gesture; a failing one states why the spatial view is unavailable
 * (never a silent omission — PHILOSOPHY #11).
 */
function PoseFooter({ pose }) {
  if (!pose) return null
  if (renderableEndEffectorFrame(pose)) {
    return (
      <div style={{ marginTop: '5px', fontSize: '10px', color: '#7a9' }}>
        3D ghost: hover to preview · click to place
      </div>
    )
  }
  if (pose.kind === 'jointSpace' && Array.isArray(pose.joints)) {
    return (
      <div style={{ marginTop: '5px', fontSize: '10px', color: '#888' }}>
        joints ({pose.chainRef ?? '—'}): [{pose.joints.map(j => (typeof j === 'number' ? j.toFixed(3) : j)).join(', ')}]
        <span style={{ color: '#666' }}> · spatial view unavailable (jointSpace — ADR-059 stage 2)</span>
      </div>
    )
  }
  return (
    <div style={{ marginTop: '5px', fontSize: '10px', color: '#886' }}>
      spatial view unavailable (unrecognized pose shape)
    </div>
  )
}

/**
 * The same row, for an objective the solver could NOT evaluate (ADR-120 D3).
 *
 * It keeps the label's slot and the track's width so the reader can see that the
 * objective was asked for (PHILOSOPHY #15), but there is deliberately no filled
 * bar and no number: a 0%-wide bar would read as "scored 0", which is exactly the
 * confusion this ADR removes. The track is drawn empty and the value column says
 * so in words.
 */
function ObjectiveUnmeasured({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
      <span style={{ width: '64px', fontSize: '9px', color: '#888', textAlign: 'right' }}>{label}</span>
      <div style={{
        // Tokens, not new literals: an empty track reports no state, so it takes
        // the chrome ground and the chrome border (ADR-100 — a colour with
        // nothing to report is neutral, and near-duplicates are the defect).
        flex: 1, height: '7px', borderRadius: '4px', background: COLOR.surface,
        border: `1px dashed ${COLOR.border}`, boxSizing: 'border-box',
      }} />
      <span style={{ width: '30px', fontSize: '9px', color: '#997' }}>n/m</span>
    </div>
  )
}

function ObjectiveBar({ label, value, verdict = null }) {
  const reduced = useReducedMotion()
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
      <span style={{ width: '64px', fontSize: '9px', color: '#aaa', textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, height: '7px', background: '#1a1a1a', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#3a7bd5', transition: barTransition(reduced) }} />
      </div>
      <span style={{ width: '30px', fontSize: '9px', color: '#9ad' }}>{value.toFixed(2)}</span>
      {/* A decided fact derived from the 0 (ADR-156 D6) — the candidate is kept
          so WHY it is bad stays readable. */}
      {verdict === 'falls' && (
        <span data-verdict="falls" title="the object falls off the cup here (utilisation ≥ 1)"
          style={{ fontSize: '9px', color: COLOR.cautionTone, border: `1px solid ${COLOR.cautionTone}`, borderRadius: '3px', padding: '0 3px' }}>
          falls
        </span>
      )}
    </div>
  )
}


