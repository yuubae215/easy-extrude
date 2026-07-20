import { useMemo, useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { renderableEndEffectorFrame } from '../../view/GraspGhostMath.js'
import { funnelStages, dominantStage, funnelDelta, nearMissCloseness } from '../../view/GraspFunnelMath.js'
import { domainKpis, ladderRisks } from '../../view/GraspLadderMath.js'
import { DeltaChip, useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { DURATION, EASING } from '../../theme/tokens.js'

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

export function GraspSearchPanel() {
  const grasp     = useUIStore(s => s.context.grasp)
  const callbacks = useUIStore(s => s.callbacks)

  const [reach, setReach]         = useState(0.6)
  const [clearance, setClearance] = useState(0.4)
  const [topN, setTopN]           = useState(5)
  // Client-side sort key: 'total' or an objective name. Never re-runs the query
  // (a grasp request is invariant — ADR-057 §Rendering).
  const [sortKey, setSortKey]     = useState('total')

  const status   = grasp?.status ?? 'idle'
  const busy     = status === 'compiling' || status === 'solving'
  const run = () => callbacks.onRunGraspSearch?.({
    weights: { reach: Number(reach), clearance: Number(clearance) },
    topN:    Number(topN),
  })

  // Objective names present across the returned candidates (for sort buttons).
  const objectiveKeys = useMemo(() => {
    if (status !== 'results') return []
    const keys = new Set()
    for (const c of grasp.candidates ?? []) {
      for (const k of Object.keys(c.score?.objectiveScores ?? {})) keys.add(k)
    }
    return [...keys].sort()
  }, [status, grasp])

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

      {/* Objective weights + topN */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <NumField label="reach"     value={reach}     step="0.1" onChange={setReach} />
        <NumField label="clearance" value={clearance} step="0.1" onChange={setClearance} />
        <NumField label="topN"      value={topN}      step="1" min="1" onChange={setTopN} />
      </div>

      <button
        onClick={run}
        disabled={busy}
        style={{
          padding: '6px 14px', borderRadius: '5px', border: '1px solid #3a7bd5',
          background: busy ? '#2a3a52' : '#1d4f8f', color: '#dceaff',
          cursor: busy ? 'default' : 'pointer', fontSize: '12px', fontWeight: 'bold',
        }}
      >
        {busy ? 'Running…' : 'Run grasp search'}
      </button>

      <StatusLine grasp={grasp} />

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

function StatusLine({ grasp }) {
  const status = grasp?.status ?? 'idle'
  const map = {
    'idle':      { text: 'Ready.', color: '#999' },
    'no-layout': { text: 'No renderable layout to search.', color: '#caa' },
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
    { key: 'opening',   miss: diagnostics.openingNearestMiss,   what: 'opening short by' },
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

function Candidate({ c, selected, onSelect, onHover }) {
  const sc = c.score ?? {}
  const chip = (label, ok) => (
    <span style={{
      fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
      background: ok ? '#1f3a1f' : '#3a1f1f', color: ok ? '#9d9' : '#d99',
      border: `1px solid ${ok ? '#357035' : '#703535'}`,
    }}>{label}{ok ? ' ✓' : ' ✗'}</span>
  )
  const objectiveScores = sc.objectiveScores ?? null
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
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: objectiveScores ? '6px' : 0 }}>
        {chip('reach', sc.withinReach)}
        {typeof sc.visible === 'boolean' && chip('seen', sc.visible)}
        {chip('IK', sc.ikSolvable)}
        {chip('clear', sc.interferenceFree)}
        {typeof sc.graspable === 'boolean' && chip('grasp', sc.graspable)}
      </div>
      {/* objectiveScores bars — the order-explaining signal (ADR-057 G2). Absent on
          legacy solvers → bars omitted, totalScore alone (degrade — §1.3). */}
      {objectiveScores && Object.entries(objectiveScores).map(([k, v]) => (
        <ObjectiveBar key={k} label={k} value={typeof v === 'number' ? v : 0} />
      ))}
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
