import { useUIStore } from '../../store/uiStore.js'
import { ConflictMatrix } from '../ContextDemo/ConflictMatrix.jsx'
import { NegotiationClusterView } from '../ContextDemo/NegotiationClusterView.jsx'

/**
 * ContextLayer — production Context-first overlay (ADR-050 Phase 2).
 *
 * Reads the persistent `context` slice (driven by ContextController over the
 * canonical document owned by ContextService), in contrast to ContextDemoLayer
 * which reads the transient tutorial `demo` slice. Phase 2 renders the
 * negotiation view (conflict matrix + resolution order) — a data-only overlay
 * with no 3D dependency, so it is allowed full-width on mobile (a transient
 * overlay, not a persistent edge panel — PHILOSOPHY #26).
 *
 * The Matrix / Cluster presentational components are shared with the demo
 * (prop-driven, ADR-050 §4.4); here they read the `context` slice and fire
 * production callbacks: approval goes through `onApproveContextDecision` →
 * ContextController → createApproveDecisionCommand (undoable, ADR-050 §3.5).
 */

const TABS = [
  { id: 'matrix',  label: 'Matrix' },
  { id: 'cluster', label: 'Cluster' },
]

export function ContextLayer() {
  const ctx       = useUIStore(s => s.context)
  const callbacks = useUIStore(s => s.callbacks)
  const setTab    = useUIStore(s => s.actions.contextSetTab)
  const setFilter = useUIStore(s => s.actions.contextSetPersonaFilter)

  if (!ctx.active) return null

  const isMobile = window.innerWidth < 768
  const liveConflicts = (ctx.conflicts ?? []).filter(c => !c.resolvedBy).length

  return (
    <div style={{
      position:   'fixed',
      top:        '40px',
      bottom:     '26px',
      ...(isMobile
        ? { left: '0', right: '0', width: 'auto' }
        : { right: '0', width: '280px' }),
      background: 'rgba(30, 30, 30, 0.96)',
      borderLeft: '1px solid #3a3a3a',
      zIndex:     100,
      display:    'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize:   '12px',
      color:      '#e8e8e8',
      pointerEvents: 'auto',
      boxSizing:  'border-box',
    }}>
      <div style={{ padding: '8px 10px 4px', fontWeight: 'bold', display: 'flex', alignItems: 'baseline' }}>
        <span style={{ color: '#c8c8c8' }}>交渉設計</span>
        <span style={{ marginLeft: '6px', fontWeight: 'normal', fontSize: '10px', color: '#888' }}>
          {ctx.docMeta?.name ?? 'Context'}
        </span>
        <button
          onClick={() => callbacks.onContextExit?.()}
          title="閉じる"
          style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            color: '#888', cursor: 'pointer', fontSize: '14px', lineHeight: '1',
            padding: '0 2px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #3a3a3a' }}>
        {TABS.map(tab => {
          const active = ctx.inspectorTab === tab.id
          const badge =
            tab.id === 'matrix'  ? (ctx.conflictMatrix ? Object.values(ctx.conflictMatrix.variableSummary).filter(s => s.inConflict && !s.approved).length : 0) :
            tab.id === 'cluster' ? (ctx.resolutionOrder?.filter(s => !s.approved).length ?? 0) : 0
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              style={{
                flex: 1, padding: '6px 2px', background: 'transparent', border: 'none',
                borderBottom: active ? '2px solid #3a7bd5' : '2px solid transparent',
                color: active ? '#5a9bf5' : '#999', cursor: 'pointer', fontSize: '10px',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
              {badge > 0 && (
                <span style={{
                  marginLeft: '3px', background: '#7a3030', color: '#fff',
                  borderRadius: '7px', padding: '0 4px', fontSize: '9px',
                }}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ padding: '4px 8px 0', fontSize: '10px', color: liveConflicts ? '#cc6666' : '#22C55E' }}>
        {liveConflicts ? `未解消の衝突 ${liveConflicts} 件` : '✓ すべての衝突が確定済'}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {ctx.inspectorTab === 'matrix' && (
          <ConflictMatrix
            matrix={ctx.conflictMatrix}
            filter={ctx.personaFilter}
            onSetFilter={setFilter}
          />
        )}
        {ctx.inspectorTab === 'cluster' && (
          <NegotiationClusterView
            order={ctx.resolutionOrder}
            clusters={ctx.negotiationClusters}
            filter={ctx.personaFilter}
            onApprove={ref => callbacks.onApproveContextDecision?.(ref)}
          />
        )}
      </div>
    </div>
  )
}
