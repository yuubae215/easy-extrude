import { useEffect, useMemo, useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { renderableEndEffectorFrame } from '../../view/GraspGhostMath.js'
import { funnelStages, dominantStage, funnelDelta, nearMissCloseness } from '../../view/GraspFunnelMath.js'
import { domainKpis, ladderRisks } from '../../view/GraspLadderMath.js'
import { objectiveRows, unevaluatedNote } from '../../view/GraspScoreMath.js'
import {
  CAMERA_PRESETS, matchingPresetId, gripperPresetsFor,
  cameraDeclarationGaps, gripperDeclarationGaps, OBJECTIVE,
  GRIPPER_KIND, DECLARED_GRIPPER_KINDS,
  REACH_PRESETS, reachDeclarationGaps,
} from '../../context/GraspDeclarationCatalog.js'
import { facesForGripperKind } from '../../domain/graspTargets.js'
import {
  DECLARABLE_FACES, GRASP_FEATURE_KIND, GRASP_FEATURE_STATE, inPlaneAxesOrThrow,
  graspFeatureGaps, graspFeatureSummary,
} from '../../domain/graspFeature.js'
import { DeltaChip, useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
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
 * Input is organised as three domain declaration cards — Seen (camera) /
 * Reached (robot base + weights) / Grasped (gripper) — per ADR-081 Decision 5.
 * Cards seed from GraspDeclarationCatalog presets (fork & tweak, ADR-063's
 * selection-first premise), the vision card can copy the live viewport camera
 * ("use current view" → onCaptureViewportCamera), and each enabled card's gap
 * list is the Run button's submit predicate (reasons printed — #11). The cards
 * only DECLARE; every gate is solved in core/ behind the contract.
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
// blank field parses to NaN (never a silent 0 — Number('') is 0, the #11
// trap), except the OPTIONAL fovHalfAngle / fingerClearance, where blank
// means "leave the key out".

const parseNum = (s) => (typeof s === 'string' && s.trim() === '') ? NaN : Number(s)
const isBlank  = (s) => typeof s === 'string' && s.trim() === ''

function parseCameraForm(v) {
  const cam = { position: v.position.map(parseNum), viewAxis: v.viewAxis.map(parseNum) }
  if (!isBlank(v.fovHalfAngle)) cam.fovHalfAngle = parseNum(v.fovHalfAngle)
  return cam
}

/**
 * Parse the Grasped card into the wire's kind-discriminated hand declaration
 * (ADR-118). The kind decides which fields even exist, so it is carried through
 * rather than inferred — reading `maxOpening` off a suction form would be the
 * flat-object shape the union exists to prevent.
 */
function parseGripperForm(g) {
  if (g.kind === GRIPPER_KIND.SUCTION) {
    const out = { kind: GRIPPER_KIND.SUCTION, cupDiameter: parseNum(g.cupDiameter) }
    if (!isBlank(g.sealTiltTolerance)) out.sealTiltTolerance = parseNum(g.sealTiltTolerance)
    return out
  }
  const out = { kind: GRIPPER_KIND.PARALLEL_JAW, maxOpening: parseNum(g.maxOpening) }
  if (!isBlank(g.fingerClearance)) out.fingerClearance = parseNum(g.fingerClearance)
  return out
}

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

export function GraspSearchPanel() {
  const grasp     = useUIStore(s => s.context.grasp)
  const robots       = useUIStore(s => s.context.robots)
  const graspTargets = useUIStore(s => s.context.graspTargets)
  const callbacks = useUIStore(s => s.callbacks)

  const [reach, setReach]         = useState(0.6)
  const [clearance, setClearance] = useState(0.4)
  const [stability, setStability] = useState(1.0)
  const [topN, setTopN]           = useState(5)
  // Client-side sort key: 'total' or an objective name. Never re-runs the query
  // (a grasp request is invariant — ADR-057 §Rendering).
  const [sortKey, setSortKey]     = useState('total')

  // Domain declaration cards (ADR-081 Decision 5). Both cards seed from their
  // catalog's FIRST preset (selection-first premise, ADR-063 — never a blank
  // numeric form); the toggle controls whether the declaration rides the
  // request at all (off = key omitted = that gate passes vacuously).
  const [vision, setVision] = useState(() => ({
    enabled: false,
    position:     CAMERA_PRESETS[0].params.position.map(String),
    viewAxis:     CAMERA_PRESETS[0].params.viewAxis.map(String),
    fovHalfAngle: String(CAMERA_PRESETS[0].params.fovHalfAngle),
  }))
  const [grip, setGrip] = useState(() => {
    const jaw = gripperPresetsFor(GRIPPER_KIND.PARALLEL_JAW)[0].params
    const cup = gripperPresetsFor(GRIPPER_KIND.SUCTION)[0].params
    // Both kinds' fields are seeded so switching kind never lands on a blank form
    // (selection-first premise, ADR-063); only the active kind's fields are read.
    return {
      enabled: false,
      kind: GRIPPER_KIND.PARALLEL_JAW,
      maxOpening:        String(jaw.maxOpening),
      fingerClearance:   String(jaw.fingerClearance),
      cupDiameter:       String(cup.cupDiameter),
      sealTiltTolerance: String(cup.sealTiltTolerance),
    }
  })
  const [captureNote, setCaptureNote] = useState(null)
  // The reach envelope (ADR-128). Seeded from the catalog's first preset like
  // every other declaration card, and OFF by default — an envelope nobody
  // declared must stay undeclared, because an invented one produces a
  // `reach_margin` that looks measured and is not (ADR-120 / kernel §5).
  const [reachDecl, setReachDecl] = useState(() => ({
    enabled: false,
    reachMin:           String(REACH_PRESETS[0].params.reachMin),
    reachMax:           String(REACH_PRESETS[0].params.reachMax),
    wristConeHalfAngle: String(REACH_PRESETS[0].params.wristConeHalfAngle),
  }))

  const camParams  = useMemo(() => parseCameraForm(vision), [vision])
  const gripParams = useMemo(() => parseGripperForm(grip), [grip])
  const planParams = useMemo(() => ({
    reachMin:           parseNum(reachDecl.reachMin),
    reachMax:           parseNum(reachDecl.reachMax),
    wristConeHalfAngle: parseNum(reachDecl.wristConeHalfAngle),
  }), [reachDecl])
  // The gap lists ARE the submit predicate (ADR-058 UX discipline): non-empty
  // disables Run and every reason is printed below the button.
  const visionGaps = vision.enabled ? cameraDeclarationGaps(camParams) : []
  const gripGaps   = grip.enabled ? gripperDeclarationGaps(gripParams) : []
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
  const featureGaps = graspFeatureGaps(graspTargets?.feature ?? null, grip.enabled ? grip.kind : null)
  const gaps       = [...robotGaps, ...targetGaps, ...featureGaps, ...visionGaps, ...gripGaps, ...reachGaps]

  const applyCameraPreset = (p) => setVision(v => ({
    ...v,
    position:     p.params.position.map(String),
    viewAxis:     p.params.viewAxis.map(String),
    fovHalfAngle: String(p.params.fovHalfAngle),
  }))
  // A preset carries its own kind (ADR-118), so applying one sets the kind too —
  // otherwise picking a suction preset while the jaw kind is active would fill
  // fields nothing reads.
  const applyGripperPreset = (p) => setGrip(g => ({
    ...g,
    kind: p.params.kind,
    ...(p.params.kind === GRIPPER_KIND.SUCTION
      ? {
          cupDiameter:       String(p.params.cupDiameter),
          sealTiltTolerance: String(p.params.sealTiltTolerance),
        }
      : {
          maxOpening:      String(p.params.maxOpening),
          fingerClearance: String(p.params.fingerClearance),
        }),
  }))

  // "Use current view" (ADR-081 §5): the controller snapshots the active
  // viewport camera; a null (no camera) is reported, never silently ignored.
  const captureCamera = () => {
    const snap = callbacks.onCaptureViewportCamera?.() ?? null
    if (!snap) { setCaptureNote('viewport camera unavailable'); return }
    setCaptureNote(null)
    setVision(v => ({
      ...v, enabled: true,
      position: snap.position.map(String),
      viewAxis: snap.viewAxis.map(String),
      fovHalfAngle: snap.fovHalfAngle != null ? String(snap.fovHalfAngle) : v.fovHalfAngle,
    }))
  }

  // Keep the viewport overlay showing what Run WOULD send (ADR-128). The hand
  // kind lives in this form, so the panel is what knows when the answer changed —
  // the controller cannot observe a local useState. Re-runs on the three inputs
  // that move the samples: which object, what was declared about it, which hand.
  const gripKindForSamples = grip.enabled ? grip.kind : null
  useEffect(() => {
    callbacks.onPreviewGraspSamples?.(gripKindForSamples)
  }, [callbacks, gripKindForSamples, graspTargets?.selectedRef, graspTargets?.feature])

  const status   = grasp?.status ?? 'idle'
  const busy     = status === 'compiling' || status === 'solving'
  const run = () => callbacks.onRunGraspSearch?.({
    // Wire keys must be core/'s registered objective names — an unregistered key
    // is dropped silently by the solver, which is how the sliders spent their
    // whole life controlling nothing (ADR-117).
    weights: {
      [OBJECTIVE.REACH_MARGIN]:       Number(reach),
      [OBJECTIVE.APPROACH_CLEARANCE]: Number(clearance),
      [OBJECTIVE.GRASP_STABILITY]:    Number(stability),
    },
    topN:     Number(topN),
    camera:   vision.enabled ? camParams : null,
    gripper:  grip.enabled ? gripParams : null,
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
    <div style={{ fontSize: '12px', color: '#ddd' }}>
      <div style={{ color: '#888', fontSize: '10px', marginBottom: '8px', lineHeight: 1.5 }}>
        UI → DSL → BFF → grasp-search (verify). The request is a query — geometry is unchanged,
        so it is not on the undo stack.
      </div>

      {/* Source layout */}
      <div style={{ fontSize: '11px', color: '#bbb', marginBottom: '10px' }}>
        Source layout:{' '}
        <code style={{ color: '#9ad' }}>{grasp?.layout?.version ?? '—'}</code>
        {' · '}
        <span>{grasp?.layout?.entities ?? 0} entit{(grasp?.layout?.entities === 1) ? 'y' : 'ies'}</span>
      </div>

      {/* Three domain declaration cards (ADR-081 Decision 5): 見える / 届く /
          掴める. Each card only DECLARES (camera / robot base / gripper) —
          the gates themselves are solved in core/ and their results come back
          through the contract funnel below. */}
      <DomainCard
        title="Seen" domain="vision"
        enabled={vision.enabled}
        onToggle={(on) => setVision(v => ({ ...v, enabled: on }))}
        offHint="no camera declared — visibility passes everything"
        offExtra={
          // The one-tap capture stays reachable with the card OFF (ADR-081 §5
          // 「ワンタップで写し取る」): tapping it declares AND fills in one gesture.
          <CaptureButton onClick={captureCamera} note={captureNote} />
        }
      >
        <PresetChips
          presets={CAMERA_PRESETS}
          activeId={matchingPresetId(CAMERA_PRESETS, camParams)}
          onPick={applyCameraPreset}
        />
        <CaptureButton onClick={captureCamera} note={captureNote} />
        <Vec3Fields label="position" values={vision.position}
          onChange={(pos) => setVision(v => ({ ...v, position: pos }))} />
        <Vec3Fields label="view axis" values={vision.viewAxis}
          onChange={(ax) => setVision(v => ({ ...v, viewAxis: ax }))} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <NumField label="FOV half angle (rad)" value={vision.fovHalfAngle} step="0.05"
            onChange={(s) => setVision(v => ({ ...v, fovHalfAngle: s }))} />
        </div>
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
        {/* ADR-119 D2/D3 — and WHERE on that object (ADR-128). Sits under the
            object it is about, not in its own card: "which thing" and "where on
            it" are two halves of one premise. */}
        <GraspLocationEditor
          targets={graspTargets}
          gripperKind={grip.enabled ? grip.kind : null}
          onSet={(ref, feature) => callbacks.onSetGraspFeature?.(ref, feature)}
        />
        <div style={{ fontSize: '10px', color: '#889', marginBottom: '5px' }}>
          robot placement follows its <code style={{ color: '#9ad' }}>base</code> /{' '}
          <code style={{ color: '#9ad' }}>tcp</code> frames
          <span style={{ color: '#667' }}> — move / aim them in the viewport (G / R) or the N-panel</span>
        </div>
        {/* The reach envelope (ADR-128 / ADR-120). Until this existed, the front
            declared no `plan{}` at all, so `reach_margin` had NO absolute basis
            and came back permanently unmeasured — while a "reach weight" slider
            sat right below it, weighting an objective nothing could evaluate.
            OFF by default, and off means the key is OMITTED: an undeclared
            envelope stays visibly different from a declared zero (原則 #31). */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#aaa', margin: '4px 0' }}>
          <input
            type="checkbox"
            checked={reachDecl.enabled}
            onChange={e => setReachDecl(r => ({ ...r, enabled: e.target.checked }))}
          />
          declare reach envelope
          {!reachDecl.enabled && (
            <span style={{ color: '#778' }}>— undeclared, so reach margin is NOT MEASURED</span>
          )}
        </label>
        {reachDecl.enabled && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <NumField label="reach min" value={reachDecl.reachMin} step="0.05"
              onChange={(s) => setReachDecl(r => ({ ...r, reachMin: s }))} />
            <NumField label="reach max" value={reachDecl.reachMax} step="0.05"
              onChange={(s) => setReachDecl(r => ({ ...r, reachMax: s }))} />
            <NumField label="wrist cone (rad)" value={reachDecl.wristConeHalfAngle} step="0.05"
              onChange={(s) => setReachDecl(r => ({ ...r, wristConeHalfAngle: s }))} />
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <NumField label="reach weight"     value={reach}     step="0.1" onChange={setReach} />
          <NumField label="clearance weight" value={clearance} step="0.1" onChange={setClearance} />
          <NumField label="stability weight" value={stability} step="0.1" onChange={setStability} />
        </div>
      </DomainCard>

      <DomainCard
        title="Grasped" domain="grasp"
        enabled={grip.enabled}
        onToggle={(on) => setGrip(g => ({ ...g, enabled: on }))}
        offHint="no gripper declared — graspability passes everything"
      >
        {/* The kind comes first: it decides which fields below even exist
            (ADR-118). Not a dropdown of presets — the hand type is a different
            question from which model of that hand. */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
          {DECLARED_GRIPPER_KINDS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setGrip(g => ({ ...g, kind: k }))}
              style={{
                flex: 1, fontSize: '11px', padding: '3px 6px', borderRadius: '4px',
                cursor: 'pointer',
                background: grip.kind === k ? COLOR.accentSoft : COLOR.surfaceSunken,
                color:      grip.kind === k ? COLOR.accent : '#bbb',
                border: `1px solid ${grip.kind === k ? COLOR.accent : '#444'}`,
              }}
            >
              {k === GRIPPER_KIND.SUCTION ? 'suction' : 'parallel jaw'}
            </button>
          ))}
        </div>
        <PresetChips
          presets={gripperPresetsFor(grip.kind)}
          activeId={matchingPresetId(gripperPresetsFor(grip.kind), gripParams)}
          onPick={applyGripperPreset}
        />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {grip.kind === GRIPPER_KIND.SUCTION ? (
            <>
              <NumField label="cup diameter" value={grip.cupDiameter} step="0.005"
                onChange={(s) => setGrip(g => ({ ...g, cupDiameter: s }))} />
              <NumField label="seal tilt (rad)" value={grip.sealTiltTolerance} step="0.05"
                onChange={(s) => setGrip(g => ({ ...g, sealTiltTolerance: s }))} />
            </>
          ) : (
            <>
              <NumField label="max opening" value={grip.maxOpening} step="0.005"
                onChange={(s) => setGrip(g => ({ ...g, maxOpening: s }))} />
              <NumField label="finger clearance" value={grip.fingerClearance} step="0.005"
                onChange={(s) => setGrip(g => ({ ...g, fingerClearance: s }))} />
            </>
          )}
        </div>
      </DomainCard>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginTop: '2px' }}>
        <NumField label="topN" value={topN} step="1" min="1" onChange={setTopN} />
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

function NumField({ label, value, onChange, step, min }) {
  return (
    <label style={{ fontSize: '10px', color: '#aaa', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {label}
      <input
        type="number" value={value} step={step} min={min}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '64px', padding: '4px 6px', borderRadius: '4px',
          border: '1px solid #444', background: '#1a1a1a', color: '#e0e0e0', fontSize: '12px',
        }}
      />
    </label>
  )
}

function SortChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: '10px', padding: '2px 7px', borderRadius: '10px', cursor: 'pointer',
        border: `1px solid ${active ? '#3a7bd5' : '#444'}`,
        background: active ? '#1d3a5f' : 'transparent',
        color: active ? '#9cf' : '#aaa', fontFamily: 'inherit',
      }}
    >{label}</button>
  )
}

// ── Domain declaration cards (ADR-081 Decision 5) ────────────────────────────

/**
 * One card per verification domain (Seen / Reached / Grasped). A disabled
 * card keeps its slot and states the consequence of not declaring (Fixed
 * Slots — PHILOSOPHY #15; the vacuously-true gate is stated, never implied).
 * The Path card is `alwaysOn`: reach / IK / interference always run.
 */
function DomainCard({ title, domain, enabled, onToggle, alwaysOn, offHint, offExtra, children }) {
  const on = alwaysOn || enabled
  return (
    <div style={{ marginBottom: '8px', padding: '7px 9px', borderRadius: '5px', background: '#222', border: BORDER }}>
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

/** "Use current view" capture button + its honest unavailable note (#11). */
function CaptureButton({ onClick, note }) {
  return (
    <div style={{ marginTop: '4px', marginBottom: '4px' }}>
      <button
        onClick={onClick}
        title="Copy the current viewport camera into this declaration"
        style={{
          fontSize: '10px', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer',
          border: '1px solid #3a6a5d', background: '#1d3a33', color: '#9dc8b8',
        }}
      >📷 use current view</button>
      {note && (
        <div style={{ fontSize: '10px', color: '#caa', marginTop: '3px' }}>{note}</div>
      )}
    </div>
  )
}

/**
 * Preset chip row (fork & tweak — ADR-063/058): picking a chip seeds the
 * card's fields; the active chip is DERIVED by value equality
 * (`matchingPresetId`), so any edit forks to "custom" with no stored flag.
 */
function PresetChips({ presets, activeId, onPick }) {
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px', alignItems: 'center' }}>
      <span style={{ fontSize: '10px', color: '#888' }}>preset:</span>
      {presets.map(p => (
        <SortChip key={p.id} label={p.label} active={p.id === activeId} onClick={() => onPick(p)} />
      ))}
      {activeId == null && <span style={{ fontSize: '9px', color: '#997' }}>custom (forked)</span>}
    </div>
  )
}

/** Labelled x/y/z triple of number inputs (form-local string values). */
function Vec3Fields({ label, values, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginTop: '4px' }}>
      <span style={{ fontSize: '10px', color: '#aaa', width: '58px', textAlign: 'right' }}>{label}</span>
      {['x', 'y', 'z'].map((axis, i) => (
        <input
          key={axis} type="number" value={values[i]} step="0.05"
          aria-label={`${label} ${axis}`}
          onChange={e => { const next = [...values]; next[i] = e.target.value; onChange(next) }}
          style={{
            width: '52px', padding: '3px 5px', borderRadius: '4px',
            border: '1px solid #444', background: '#1a1a1a', color: '#e0e0e0', fontSize: '11px',
          }}
        />
      ))}
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
 * The shared shape of both premise pickers (ADR-117).
 *
 * The robot picker and the object picker ask the same question about the two
 * halves of the same premise — "which one, of 0 / 1 / N?" — and the answer is
 * rendered identically down to the placeholder wording. Writing the second one
 * as a copy would have duplicated six colour literals along with the markup,
 * which is what the ADR-100 ratchet objected to; sharing the row removes the
 * duplication instead of declaring a budget for it.
 */
const PICKER = Object.freeze({
  row:    { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' },
  label:  { fontSize: '10px', color: '#889', minWidth: '38px' },
  muted:  { fontSize: '10px', color: '#caa' },
  chosen: { fontSize: '11px', color: '#cde' },
  hint:   { color: '#9ad' },
  select: {
    background: '#1f2530', color: '#dceaff', border: '1px solid #3a4a60',
    borderRadius: '4px', fontSize: '11px', padding: '2px 4px', flex: 1,
  },
})

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

/**
 * GraspLocationEditor — WHERE on the object to grasp (ADR-119 D2/D3, ADR-128).
 *
 * ## Why this control exists at all
 *
 * Before it, where to grasp was 100% derived from the hand (ADR-118) and the
 * user had no way to say "grasp it here" — but nothing on screen said the choice
 * had been made for them. This block does two jobs, and the SECOND one is the
 * reason the ADR was written: it prints what this run is actually sampling, so
 * "I never said" is visible rather than invisible (原則 #31).
 *
 * ## Why declaring is not the same as clearing
 *
 * Three of the buttons are not variations of one another:
 *   `anywhere`  — declared, deliberately not narrowed.
 *   face chips  — declared and narrowed; the samples come from these faces ONLY,
 *                 never unioned with the derived set (ADR-119 D3).
 *   `clear`     — removes the declaration, back to "nobody said". A user who
 *                 changed their mind must be able to reach that state again;
 *                 without a clear, the only way back would be an undeclared-
 *                 looking `anywhere`, which is a different statement.
 *
 * Writes go to the DOCUMENT through one undoable doc-edit (原則 #1), so a
 * declaration survives reload and export — a run-local toggle would evaporate.
 */
function GraspLocationEditor({ targets, gripperKind, onSet }) {
  const ref     = targets?.selectedRef ?? null
  const feature = targets?.feature ?? null
  // Faces the hand would sample on its own — the sentence's other half ("not
  // declared — sampling +z"). Asking the domain rather than restating the table
  // keeps ADR-118's answer in one place (§1.1).
  const derived = useMemo(() => {
    try { return [...facesForGripperKind(gripperKind ?? null)] } catch { return [] }
  }, [gripperKind])

  const declaredFaces = feature?.state === GRASP_FEATURE_STATE.DECLARED_FACES
    ? feature.faces.map(f => f.face)
    : []
  const summary = graspFeatureSummary(feature, derived)
  const gaps    = graspFeatureGaps(feature, gripperKind ?? null)

  // Toggling a face rewrites the whole declaration (the document holds a value,
  // not a diff). Removing the last face CLEARS rather than writing `faces: []` —
  // an empty list would declare nowhere to grasp, which comes back as a
  // well-formed zero-candidate answer (原則 #31).
  const toggleFace = (face) => {
    const next = declaredFaces.includes(face)
      ? declaredFaces.filter(f => f !== face)
      : [...declaredFaces, face]
    onSet(ref, next.length === 0
      ? null
      : { kind: GRASP_FEATURE_KIND.FACES, faces: next.map(f => ({ face: f })) })
  }

  /** その面に宣言されている領域 (無ければ面全体 = null)。 */
  const regionOf = (f, face) => {
    if (f?.state !== GRASP_FEATURE_STATE.DECLARED_FACES) return null
    return f.faces.find(x => x.face === face)?.region ?? null
  }

  /**
   * 面の領域を書き換える。**面の宣言と同じ 1 つの doc-edit** を通る (原則 #1) —
   * 領域だけの別経路を作ると、同じ宣言に書き手が 2 つできる。
   * `null` = 面全体へ戻す = 鍵の削除 (「面全体」を値として書くのではない — ADR-128 D3)。
   */
  const setRegion = (face, region) => {
    const faces = declaredFaces.map(f => {
      const cur = regionOf(feature, f)
      if (f !== face) return cur ? { face: f, region: cur } : { face: f }
      return region ? { face: f, region } : { face: f }
    })
    onSet(ref, { kind: GRASP_FEATURE_KIND.FACES, faces })
  }

  if (!ref) return null

  return (
    <div style={{ marginTop: '6px', marginBottom: '6px' }}>
      <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '3px' }}>where to grasp</div>

      {/* 面と、面上の**領域 (region)** の両方がここから書ける (ADR-129 D3)。
          どちらの軸が u かは `inPlaneAxesOrThrow` が既に決定的に持っているので、
          画面はその名前を**表示するだけ** — 第二の源を作らない (DEF-031 が
          先送りの理由に挙げた「どちらが u か」の権威は既に在り、要ったのは
          呼び出しだけだった)。 */}
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '4px' }}>
        {DECLARABLE_FACES.map(face => (
          <FaceChip
            key={face}
            label={face}
            active={declaredFaces.includes(face)}
            onClick={() => toggleFace(face)}
          />
        ))}
      </div>

      {/* 領域は宣言された面ごとに 1 つ。面を宣言していないときは出さない —
          「どこでもよい」に領域は無く、空の欄は書ける気にさせるだけである。 */}
      {declaredFaces.map(face => (
        <FaceRegionEditor
          key={face}
          face={face}
          region={regionOf(feature, face)}
          onChange={(next) => setRegion(face, next)}
        />
      ))}

      <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
        <FaceChip
          label="anywhere"
          active={feature?.state === GRASP_FEATURE_STATE.DECLARED_ANYWHERE}
          onClick={() => onSet(ref, { kind: GRASP_FEATURE_KIND.ANYWHERE })}
          grow
        />
        <FaceChip
          label="clear"
          active={false}
          disabled={feature?.state === GRASP_FEATURE_STATE.DERIVED}
          onClick={() => onSet(ref, null)}
          grow
        />
      </div>

      {/* The sentence that makes an unmade choice visible. Deliberately printed
          in BOTH directions — a declaration is echoed back, and its absence is
          stated rather than left blank (原則 #11/#31). */}
      <div style={{
        fontSize: '10px', lineHeight: 1.45,
        color: feature?.state === GRASP_FEATURE_STATE.DERIVED ? '#889' : '#9ad',
      }}>
        {summary}
      </div>
      {gaps.map((g, i) => (
        <div key={i} style={{ fontSize: '10px', color: '#caa', marginTop: '2px' }}>· {g}</div>
      ))}
    </div>
  )
}

/**
 * FaceRegionEditor — 面の**どのあたり**を掴むか (ADR-129 D3 / DEF-031)。
 *
 * ## 軸の名前はここで決めない
 *
 * どちらの面内軸が u かは `inPlaneAxesOrThrow` が決定的に持っている。画面はその
 * 名前を**表示するだけ**で、`+z なら u は x` のような対応表をここに書き写さない —
 * 書き写した瞬間に第二の源になり、ドメイン側の軸割当を変えた日に画面だけが古い
 * 名前で嘘をつく (§1.1)。DEF-031 は「どちらが u かを画面上で正しく名指しする設計が
 * 要る」ことを先送りの理由に挙げたが、その権威は既に在り、要ったのは呼び出しだけだった。
 *
 * ## 値は面に対する割合であって、長さではない
 *
 * 0–1 の正規化なので、箱の寸法を変えても「面の右半分」は右半分のままである
 * (ミリで書くと、リサイズした日に領域が黙って面からはみ出す — `readRegion` の
 * doc がその理由を持っている)。
 *
 * ## 確認は 3D が担う — 新しい確認面を作らない
 *
 * 領域を狭めるとサンプル点が減るのが `GraspSampleView` にそのまま出る
 * (ADR-128 D1 の「入力はパネル・確認は 3D」を継ぐ)。だからここに数字以外の
 * プレビューを足さない。
 */
function FaceRegionEditor({ face, region, onChange }) {
  const [uAxis, vAxis] = inPlaneAxesOrThrow(face)
  const cur = region ?? { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }
  const narrowed = region != null

  // 空欄は 0 ではない (Number('') === 0 の罠)。読めない値は書かず、その場に留める。
  const edit = (key) => (e) => {
    const v = e.target.value
    if (v.trim() === '') return
    const n = Number(v)
    if (!Number.isFinite(n)) return
    onChange({ ...cur, [key]: n })
  }

  return (
    <div style={{ marginBottom: '4px', paddingLeft: '4px', borderLeft: `2px solid ${COLOR.border}` }}>
      <div style={{ ...PICKER.label, minWidth: undefined, marginBottom: '2px' }}>
        {face} region — u = {uAxis}, v = {vAxis} (0–1 of the face)
      </div>
      <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
        <RegionInput label={`${uAxis}min`} value={cur.uMin} onChange={edit('uMin')} />
        <RegionInput label={`${uAxis}max`} value={cur.uMax} onChange={edit('uMax')} />
        <RegionInput label={`${vAxis}min`} value={cur.vMin} onChange={edit('vMin')} />
        <RegionInput label={`${vAxis}max`} value={cur.vMax} onChange={edit('vMax')} />
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={!narrowed}
          title="この面ぜんぶに戻す (領域の鍵を消す)"
          style={{
            fontSize: '9px', padding: '2px 5px', borderRadius: '3px',
            background: 'transparent',
            color: COLOR.textSecondary,
            opacity: narrowed ? 1 : 0.45,
            border: `1px solid ${COLOR.border}`,
            cursor: narrowed ? 'pointer' : 'default',
          }}
        >full face</button>
      </div>
      {/* 宣言されていないことを**述べる** — 空欄は「面全体」とも「言い忘れ」とも
          読めるので、どちらであるかを画面が言う (原則 #31)。 */}
      {!narrowed && (
        <div style={{ ...PICKER.label, minWidth: undefined, marginTop: '2px' }}>
          not narrowed — the whole face is sampled
        </div>
      )}
    </div>
  )
}

/** 領域 1 辺の数値欄 (0–1)。 */
function RegionInput({ label, value, onChange }) {
  return (
    <label style={{ ...PICKER.label, display: 'flex', alignItems: 'center', gap: '2px', minWidth: undefined }}>
      {label}
      {/* 数値欄の見た目は premise picker と同じ器を使う (PICKER.select) —
          同じ役割の入力に色を書き足すと、ADR-100 の ratchet が数える
          「宣言の外にある色」が増える。器を共有すれば増えない。 */}
      <input
        type="number" step="0.05" min="0" max="1"
        defaultValue={value}
        onChange={onChange}
        style={{ ...PICKER.select, flex: undefined, width: '42px', padding: '1px 2px' }}
      />
    </label>
  )
}

/** A small toggle chip — the face vocabulary and the two declaration verbs. */
function FaceChip({ label, active, onClick, disabled, grow }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: grow ? 1 : undefined,
        fontSize: '10px', padding: '3px 6px', borderRadius: '4px',
        cursor: disabled ? 'default' : 'pointer',
        background: active ? COLOR.accentSoft : COLOR.surfaceSunken,
        color: disabled ? '#666' : active ? COLOR.accent : '#bbb',
        border: `1px solid ${active ? COLOR.accent : '#444'}`,
      }}
    >
      {label}
    </button>
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
          ? <ObjectiveBar key={r.name} label={r.name} value={r.value} />
          : <ObjectiveUnmeasured key={r.name} label={r.name} />
      ))}
      {notMeasured && (
        <div style={{ fontSize: '9px', color: '#997', marginTop: '3px', marginLeft: '70px' }}>
          {notMeasured}
        </div>
      )}
      <PoseFooter pose={c.pose} />
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

function ObjectiveBar({ label, value }) {
  const reduced = useReducedMotion()
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
      <span style={{ width: '64px', fontSize: '9px', color: '#aaa', textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, height: '7px', background: '#1a1a1a', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#3a7bd5', transition: barTransition(reduced) }} />
      </div>
      <span style={{ width: '30px', fontSize: '9px', color: '#9ad' }}>{value.toFixed(2)}</span>
    </div>
  )
}
