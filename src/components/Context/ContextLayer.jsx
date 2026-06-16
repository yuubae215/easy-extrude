import { useUIStore } from '../../store/uiStore.js'
import { ConflictMatrix } from '../ContextDemo/ConflictMatrix.jsx'
import { NegotiationClusterView } from '../ContextDemo/NegotiationClusterView.jsx'
import { FormPanel } from './FormPanel.jsx'
import { IntakePanel } from './IntakePanel.jsx'

/**
 * ContextLayer — production Context-first overlay (ADR-050).
 *
 * Reads the persistent `context` slice (driven by ContextController over the
 * canonical document owned by ContextService), in contrast to ContextDemoLayer
 * which reads the transient tutorial `demo` slice. The overlay has three modes
 * (ADR-050 §4.3 / §6):
 *   - `negotiate` (Phase 2) — conflict matrix + resolution order; approval is
 *     undoable (`onApproveContextDecision` → createApproveDecisionCommand).
 *   - `author` (Phase 3) — live region-authoring readout: the 3-D widgets do the
 *     editing, this panel lists the live R6 conflicts (green when clear).
 *   - `ghost` (Phase 3) — actor-coloured footprint ghosts in 3-D; this panel shows
 *     the conflict matrix whose actor-column persona filter dims the ghosts.
 *
 * Data-only overlay with no persistent edge-panel footprint, so full-width on
 * mobile is allowed (a transient overlay, not a persistent edge panel — PHILOSOPHY
 * #26). The Matrix / Cluster presentational components are shared with the demo
 * (prop-driven, ADR-050 §4.4).
 */

const TITLE = {
  negotiate: '交渉設計',
  author:    '領域オーサリング',
  ghost:     '許容領域ゴースト',
}

const fmtGap = (gap) => Array.isArray(gap)
  ? `[${gap[0]}, ${gap[1]})`
  : Object.entries(gap ?? {}).map(([ax, g]) => `${ax}: [${g[0]}, ${g[1]})`).join('  ')

export function ContextLayer() {
  const ctx       = useUIStore(s => s.context)
  const callbacks = useUIStore(s => s.callbacks)
  const setTab    = useUIStore(s => s.actions.contextSetTab)
  const setFilter = useUIStore(s => s.actions.contextSetPersonaFilter)

  if (!ctx.active) return null

  const isMobile = window.innerWidth < 768
  const liveConflicts = (ctx.conflicts ?? []).filter(c => !c.resolvedBy).length
  // negotiate shows matrix + cluster + questions (if any open); ghost shows matrix
  // only (read-only persona filter); author has no matrix — only the conflict list.
  const tabs =
    ctx.mode === 'negotiate' ? [
      { id: 'matrix',    label: 'Matrix' },
      { id: 'cluster',   label: 'Cluster' },
      ...(ctx.form?.length > 0 ? [{ id: 'questions', label: 'Questions' }] : []),
      { id: 'intake',    label: 'Intake' },
    ]
    : ctx.mode === 'ghost' ? [{ id: 'matrix', label: 'Matrix' }]
    : []

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
        <span style={{ color: '#c8c8c8' }}>{TITLE[ctx.mode] ?? 'Context'}</span>
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

      {tabs.length > 1 && (
        <div style={{ display: 'flex', borderBottom: '1px solid #3a3a3a' }}>
          {tabs.map(tab => {
            const active = ctx.inspectorTab === tab.id
            const badge =
              tab.id === 'matrix'    ? (ctx.conflictMatrix ? Object.values(ctx.conflictMatrix.variableSummary).filter(s => s.inConflict && !s.approved).length : 0) :
              tab.id === 'cluster'   ? (ctx.resolutionOrder?.filter(s => !s.approved).length ?? 0) :
              tab.id === 'questions' ? (ctx.form?.length ?? 0) : 0
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
      )}

      <div style={{ padding: '4px 8px 0', fontSize: '10px', color: liveConflicts ? '#cc6666' : '#22C55E' }}>
        {liveConflicts ? `未解消の衝突 ${liveConflicts} 件` : '✓ すべての衝突が確定済'}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {ctx.mode === 'author' && <AuthorConflicts conflicts={ctx.conflicts} />}

        {(ctx.mode === 'negotiate' || ctx.mode === 'ghost') && ctx.inspectorTab === 'matrix' && (
          <ConflictMatrix
            matrix={ctx.conflictMatrix}
            filter={ctx.personaFilter}
            onSetFilter={setFilter}
          />
        )}
        {ctx.mode === 'negotiate' && ctx.inspectorTab === 'cluster' && (
          <NegotiationClusterView
            order={ctx.resolutionOrder}
            clusters={ctx.negotiationClusters}
            filter={ctx.personaFilter}
            onApprove={ref => callbacks.onApproveContextDecision?.(ref)}
          />
        )}
        {ctx.mode === 'negotiate' && ctx.inspectorTab === 'questions' && (
          <FormPanel />
        )}
        {ctx.mode === 'negotiate' && ctx.inspectorTab === 'intake' && (
          <IntakePanel />
        )}
      </div>
    </div>
  )
}

/** Live R6 conflict list for the authoring overlay — the 3-D widgets do the edit. */
function AuthorConflicts({ conflicts = [] }) {
  return (
    <>
      <div style={{ color: '#999', marginBottom: '6px', fontSize: '11px', lineHeight: 1.5 }}>
        各担当の設置許容ゾーンを 3D で直接ドラッグ。重なれば衝突は消え (緑)、離れれば再発する (赤)。
        確定するとアンドゥ可能な要求編集としてドキュメントに書き戻される (3D は入力デバイス、契約はテキスト DSL — invariant 9)。
      </div>
      {conflicts.length === 0 && (
        <div style={{ color: '#22C55E', fontSize: '11px' }}>✓ 衝突なし — すべての許容領域が交差している</div>
      )}
      {conflicts.map(c => (
        <div key={c.ref} style={{
          padding: '6px 8px', marginBottom: '5px', borderRadius: '4px',
          background: c.resolvedBy ? 'rgba(34,197,94,0.08)' : 'rgba(204,51,51,0.10)',
          border: `1px solid ${c.resolvedBy ? '#22C55E55' : '#cc333366'}`,
        }}>
          <div>
            <span style={{
              background: c.resolvedBy ? '#22C55E' : '#cc3333', color: '#fff',
              borderRadius: '3px', padding: '0 5px', fontSize: '9px', fontWeight: 'bold',
            }}>
              {c.resolvedBy ? 'resolved' : 'conflict'}
            </span>
            <span style={{ marginLeft: '5px' }}>{c.variable}</span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#cc6666', marginTop: '2px' }}>
            gap {fmtGap(c.gap)}
          </div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>{(c.between ?? []).join('  ×  ')}</div>
        </div>
      ))}
    </>
  )
}
