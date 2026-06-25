import { useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'

/**
 * GraspSearchPanel — UI → DSL → BFF → grasp-search verification walkthrough
 * (ADR-057).
 *
 * A transient modal (z-index above all edge panels — PHILOSOPHY #26) that runs
 * the canonical thread: the loaded Context's Layout DSL
 * (`ContextService.getCompiled().layoutDsl`) is sent through the BFF — first a
 * round-trip `compileLayout` (scene reproduced server-side), then a grasp-search
 * request the BFF delegates to the external solver. The panel only *declares* the
 * request (objective weights + topN) and *displays* the ranked candidates; the
 * UI never solves (scope boundary). Failures surface their reason — contract
 * mismatch (400), upstream drift (502), service unreachable (503) — never a
 * silent no-op (PHILOSOPHY #11).
 *
 * Presentational: open/closed is `graspPanelOpen`; result lives in
 * `context.grasp`; actions are fired through registered callbacks.
 */

const BORDER = '1px solid #3a3a3a'

export function GraspSearchPanel() {
  const open      = useUIStore(s => s.graspPanelOpen)
  const grasp     = useUIStore(s => s.context.grasp)
  const callbacks = useUIStore(s => s.callbacks)

  const [reach, setReach]         = useState(0.6)
  const [clearance, setClearance] = useState(0.4)
  const [topN, setTopN]           = useState(5)

  if (!open) return null

  const close   = () => callbacks.onCloseGraspPanel?.()
  const running = grasp?.status === 'running' || grasp?.status === 'compiled'
  const run = () => callbacks.onRunGraspSearch?.({
    weights: { reach: Number(reach), clearance: Number(clearance) },
    topN:    Number(topN),
  })

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif', pointerEvents: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 94vw)', maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          background: '#222', border: '1px solid #444', borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: BORDER, display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#e8e8e8' }}>Grasp Search</span>
          <span style={{ marginLeft: '8px', fontSize: '11px', color: '#888' }}>
            UI → DSL → BFF → grasp-search (verify)
          </span>
          <button
            onClick={close}
            title="Close"
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: '#999', cursor: 'pointer', fontSize: '18px', lineHeight: 1,
            }}
          >×</button>
        </div>

        <div style={{ padding: '16px 18px', overflowY: 'auto' }}>
          {/* Source layout */}
          <div style={{ fontSize: '12px', color: '#bbb', marginBottom: '14px' }}>
            Source layout:{' '}
            <code style={{ color: '#9ad' }}>{grasp?.layout?.version ?? '—'}</code>
            {' · '}
            <span>{grasp?.layout?.entities ?? 0} entit{(grasp?.layout?.entities === 1) ? 'y' : 'ies'}</span>
          </div>

          {/* Objective weights + topN */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <NumField label="reach"     value={reach}     step="0.1" onChange={setReach} />
            <NumField label="clearance" value={clearance} step="0.1" onChange={setClearance} />
            <NumField label="topN"      value={topN}      step="1" min="1" onChange={setTopN} />
          </div>

          <button
            onClick={run}
            disabled={running}
            style={{
              padding: '8px 16px', borderRadius: '5px', border: '1px solid #3a7bd5',
              background: running ? '#2a3a52' : '#1d4f8f', color: '#dceaff',
              cursor: running ? 'default' : 'pointer', fontSize: '13px', fontWeight: 'bold',
            }}
          >
            {running ? 'Running…' : 'Run grasp search'}
          </button>

          {/* Status line */}
          <StatusLine grasp={grasp} />

          {/* Candidates */}
          {grasp?.status === 'done' && (
            <div style={{ marginTop: '12px' }}>
              {grasp.candidates.length === 0 && (
                <div style={{ fontSize: '12px', color: '#caa' }}>
                  No candidates returned (the solver found no feasible pose).
                </div>
              )}
              {grasp.candidates.map((c, i) => <Candidate key={c.rank ?? i} c={c} />)}
            </div>
          )}

          {/* Error detail */}
          {grasp?.status === 'error' && grasp.error && (
            <div style={{
              marginTop: '12px', padding: '10px 12px', borderRadius: '5px',
              background: '#3a2222', border: '1px solid #6a3333', color: '#f0c0c0', fontSize: '12px',
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {grasp.error.status ? `HTTP ${grasp.error.status} — ` : ''}{grasp.error.message}
              </div>
              {(grasp.error.details ?? []).map((d, i) => (
                <div key={i} style={{ color: '#d8a8a8' }}>· {d}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NumField({ label, value, onChange, step, min }) {
  return (
    <label style={{ fontSize: '11px', color: '#aaa', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {label}
      <input
        type="number" value={value} step={step} min={min}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '78px', padding: '5px 7px', borderRadius: '4px',
          border: '1px solid #444', background: '#1a1a1a', color: '#e0e0e0', fontSize: '13px',
        }}
      />
    </label>
  )
}

function StatusLine({ grasp }) {
  if (!grasp) return null
  const map = {
    idle:     { text: 'Ready.', color: '#999' },
    running:  { text: 'Compiling layout on BFF…', color: '#cc9' },
    compiled: { text: 'BFF compile OK — requesting grasp candidates…', color: '#9c9' },
    done:     { text: `Done — ${grasp.candidates?.length ?? 0} candidate(s).`, color: '#9c9' },
    error:    { text: 'Failed — see detail below.', color: '#d99' },
  }
  const s = map[grasp.status] ?? map.idle
  return <div style={{ marginTop: '10px', fontSize: '12px', color: s.color }}>{s.text}</div>
}

function Candidate({ c }) {
  const sc = c.score ?? {}
  const chip = (label, ok) => (
    <span style={{
      fontSize: '10px', padding: '1px 6px', borderRadius: '3px',
      background: ok ? '#1f3a1f' : '#3a1f1f', color: ok ? '#9d9' : '#d99',
      border: `1px solid ${ok ? '#357035' : '#703535'}`,
    }}>{label}{ok ? ' ✓' : ' ✗'}</span>
  )
  return (
    <div style={{ padding: '8px 10px', border: BORDER, borderRadius: '5px', marginBottom: '6px', background: '#262626' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#e8e8e8' }}>#{c.rank}</span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ad' }}>
          score {typeof sc.totalScore === 'number' ? sc.totalScore.toFixed(3) : '—'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
        {chip('reach', sc.withinReach)}
        {chip('IK', sc.ikSolvable)}
        {chip('clear', sc.interferenceFree)}
      </div>
      {c.pose?.joints && (
        <div style={{ marginTop: '5px', fontSize: '11px', color: '#999' }}>
          joints: [{c.pose.joints.map(j => (typeof j === 'number' ? j.toFixed(3) : j)).join(', ')}]
        </div>
      )}
    </div>
  )
}
