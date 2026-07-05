import { Badge, Ref } from './ContextInspector.jsx'
import { DeltaChip, LandingFlash, usePrevOnChange } from '../Feedback/FeedbackPrimitives.jsx'
import { listDelta, settledRefs } from '../../view/FeedbackMath.js'

/**
 * ConflictMatrix — actor × variable grid (ADR-049 Phase 4, §5.3).
 *
 * Read-only persona projection: each row is a shared design variable, each
 * column an actor. A cell shows whether that actor staked a claim on that
 * variable and whether those claims collide (R6). Clicking a column header
 * toggles the persona filter (dims the other actors) — this IS the persona
 * projection. Rendered as a tab inside ContextInspector (no new edge panel,
 * PHILOSOPHY #26).
 *
 * Prop-driven (ADR-050 §4.4): slice-independent so the same presentational
 * component serves both the demo (`demo` slice) and the production ContextLayer
 * (`context` slice). Callers supply the projected matrix, the current persona
 * filter, and the filter toggle.
 *
 * @param {object}   props
 * @param {object|null} props.matrix    — projectConflictMatrix() result
 * @param {string|null} props.filter    — selected actor ref (persona filter)
 * @param {(actor:string|null)=>void} props.onSetFilter — toggle handler
 */

const CELL = {
  none:      { bg: 'transparent', fg: '#555',    border: '#2a2a2a', mark: '' },
  satisfied: { bg: '#16341f',     fg: '#22C55E', border: '#225c34', mark: '●' },
  resolved:  { bg: '#16341f',     fg: '#22C55E', border: '#225c34', mark: '✓' }, // approved = settled
  proposed:  { bg: '#2e2a14',     fg: '#f0b030', border: '#7a6020', mark: '◐' }, // Decision on the table, not yet approved
  conflict:  { bg: '#3a1414',     fg: '#ff6b6b', border: '#cc3333', mark: '✕' },
}

const shortActor = (ref) => ref.split('_')[0]

const fmtGap = (gap) => Array.isArray(gap)
  ? `[${gap[0]}, ${gap[1]})`
  : Object.entries(gap).map(([ax, g]) => `${ax}: [${g[0]}, ${g[1]})`).join('  ')

export function ConflictMatrix({ matrix, filter, onSetFilter }) {
  // Proof-feedback wiring (ADR-062 Phase 3): an approval / region edit already
  // re-validates and re-projects this matrix; the delta chip and the green
  // flash on a freshly-settled variable card only make that fact FELT. The
  // sole fact source is the projected matrix (validator-owned `resolvedBy` /
  // `approved`); the previous snapshot is component-local presentation state.
  // Hooks run before the null-guard (React rule); a null matrix records no history.
  const openVars = matrix
    ? matrix.variables.filter(v => matrix.variableSummary[v].inConflict && !matrix.variableSummary[v].approved)
    : null
  const { prev: prevOpenVars, tick } = usePrevOnChange(openVars)
  const openDelta   = listDelta(prevOpenVars, openVars)
  const settledVars = settledRefs(prevOpenVars, openVars) ?? []

  if (!matrix) {
    return <div style={{ color: '#999', fontSize: '11px' }}>No matrix data</div>
  }
  const { actors, variables, cells, variableSummary } = matrix
  const toggle = (a) => onSetFilter(filter === a ? null : a)

  return (
    <>
      <div style={{ color: '#999', marginBottom: '6px', fontSize: '11px' }}>
        Shared design variables (rows) × actors (columns). <span style={{ color: '#ff6b6b' }}>✕ in conflict</span> /
        <span style={{ color: '#f0b030' }}> ◐ awaiting approval</span> /
        <span style={{ color: '#22C55E' }}> ✓ resolved</span> /
        <span style={{ color: '#22C55E' }}> ● claimed</span> / ↔ = multi-variable coupling.
        Click a column header for the persona projection.
        <DeltaChip value={openDelta} goodWhenPositive={false} label="unsettled" />
      </div>

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '10px' }}>
        <thead>
          <tr>
            <th style={{ borderBottom: '1px solid #3a3a3a' }} />
            {actors.map(a => {
              const sel = filter === a
              const dim = filter && filter !== a
              return (
                <th
                  key={a}
                  onClick={() => toggle(a)}
                  title={`${a} — click for the persona projection`}
                  style={{
                    cursor: 'pointer', padding: '3px 2px', textAlign: 'center',
                    color: sel ? '#5a9bf5' : (dim ? '#555' : '#c8c8c8'),
                    borderBottom: sel ? '2px solid #3a7bd5' : '1px solid #3a3a3a',
                    opacity: dim ? 0.45 : 1,
                  }}
                >
                  {shortActor(a)}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {variables.map(v => (
            <tr key={v}>
              <td
                title={v}
                style={{
                  padding: '3px 4px', color: '#aaa', fontFamily: 'monospace',
                  whiteSpace: 'nowrap', maxWidth: '78px', overflow: 'hidden',
                  textOverflow: 'ellipsis', borderRight: '1px solid #3a3a3a',
                }}
              >
                {v.replace(/^v_/, '')}
              </td>
              {actors.map(a => {
                const cell = cells[`${a}|${v}`]
                const c = CELL[cell.state]
                const dim = filter && filter !== a
                const title = cell.requirements.length
                  ? `${cell.requirements.join(', ')}${cell.coupled ? ' (coupled)' : ''}`
                  : ''
                return (
                  <td
                    key={a}
                    title={title}
                    style={{
                      padding: '4px 2px', textAlign: 'center',
                      background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                      opacity: dim ? 0.3 : 1, fontWeight: cell.state === 'conflict' ? 'bold' : 'normal',
                    }}
                  >
                    {c.mark}{cell.coupled && cell.state !== 'none' ? '↔' : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Per-variable conflict summaries (R6 gap / between / resolution). */}
      <div style={{ marginTop: '10px' }}>
        {variables.filter(v => variableSummary[v].inConflict).map(v => {
          const s = variableSummary[v]
          return (
            // The cell "goes out" visibly: a variable that just left the
            // unsettled set replays the green landing flash (ADR-062 Phase 3).
            <LandingFlash key={v} tick={tick} active={settledVars.includes(v)}
              style={{
                padding: '6px 7px', marginBottom: '4px', borderRadius: '4px',
                background: '#262626', border: '1px solid #333', lineHeight: '1.5',
              }}>
              <div>
                {s.approved
                  ? <Badge color="#22C55E">resolved</Badge>
                  : s.resolvedBy
                    ? <Badge color="#f0b030" pulse>proposed</Badge>
                    : <Badge color="#cc3333" pulse>conflict</Badge>}
                <span style={{ marginLeft: '5px' }}>{v}</span>
              </div>
              {s.gap && (
                <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#cc6666' }}>
                  gap {fmtGap(s.gap)}
                </div>
              )}
              <div style={{ fontSize: '10px', color: '#888' }}>{s.between.join('  ×  ')}</div>
              <Ref>{s.actors.join(', ')}{s.resolvedBy ? ` · by ${s.resolvedBy}` : ''}</Ref>
            </LandingFlash>
          )
        })}
      </div>
    </>
  )
}
