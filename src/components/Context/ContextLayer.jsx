import { useUIStore } from '../../store/uiStore.js'
import { ConflictMatrix } from '../ContextDemo/ConflictMatrix.jsx'
import { NegotiationClusterView } from '../ContextDemo/NegotiationClusterView.jsx'
import { FormPanel } from './FormPanel.jsx'
import { AgendaPanel } from './AgendaPanel.jsx'
import { WhyBreadcrumb } from './WhyBreadcrumb.jsx'
import { WhyTreeView } from './WhyTreeView.jsx'
import { FeedbackDefs, DeltaChip, LandingFlash, usePrevOnChange } from '../Feedback/FeedbackPrimitives.jsx'
import { CelebrationDefs, ContextCelebration } from '../Feedback/Celebration.jsx'
import { listDelta, settledRefs } from '../../view/FeedbackMath.js'
import { FLOOR_TAB, FLOOR_TABS } from '../../view/FloorTabs.js'
import { BOTTOM_TIER, bottomEdgeOffset, floorHeight } from '../../view/EdgeOccupancy.js'

/**
 * ContextLayer — the floor: where claims are settled, and where the record of
 * settling them lives (ADR-050, re-addressed by ADR-106).
 *
 * Reads the persistent `context` slice (driven by ContextController over the
 * canonical document owned by ContextService), in contrast to ContextDemoLayer
 * which reads the transient tutorial `demo` slice. The floor has three modes
 * (ADR-050 §4.3 / §6):
 *   - `negotiate` (Phase 2) — conflict matrix + resolution order; approval is
 *     undoable (`onApproveContextDecision` → createApproveDecisionCommand).
 *   - `author` (Phase 3) — live region-authoring readout: the 3-D widgets do the
 *     editing, this panel lists the live R6 conflicts (green when clear).
 *   - `ghost` (Phase 3) — actor-coloured footprint ghosts in 3-D; this panel shows
 *     the conflict matrix whose actor-column persona filter dims the ghosts.
 *
 * ## Why it is at the bottom (ADR-106 D1)
 *
 * The container used to be a 280px strip on the right edge, and its contents are
 * an `actor × variable` **table** — a wide thing in the narrowest possible frame.
 * The tabs were the visible symptom (`w_tab = 280/n − 4`; at n=10 that is 24px and
 * the word "Overview" needs ~45), but widening the strip would only have bought
 * time: the mismatch is between the container's shape and its contents' shape.
 *
 * The strip also had two other residents on the same edge (the N panel and the
 * tutorial Inspector), and the collision was being worked around in three mutually
 * unaware ways — shift, delete, and cover. The third is why opening the floor used
 * to hide the world gizmo and the projection toggle. Moving the address deletes
 * the reason all three were written (ADR-106 D2).
 *
 * It does **not** cover the 3-D view: `d_ref` is a spatial quantity, and a
 * negotiation whose subject is hidden is the failure this move exists to fix. The
 * bottom edge is a shared resource too, so the occupancy is computed by ONE owner
 * (`view/EdgeOccupancy.js`, 原則 #26 / D6) — the InfoBar keeps its position and
 * height, and everything else at that edge steps up rather than being deleted.
 *
 * ## What is in it, and what is not (ADR-106 D3)
 *
 * Two duties only: **resolution** (owners are plural — agreement is required) and
 * **its record**. Discovery (Checks / Grasp) and input (Assets / Wizard / Intake)
 * moved out to addresses named in `view/FloorTabs.js`; they were here because of
 * history, not design. The Matrix / Cluster presentational components are shared
 * with the demo (prop-driven, ADR-050 §4.4).
 */

const TITLE = {
  negotiate: 'Negotiate',
  author:    'Author',
  ghost:     'Region Ghosts',
}

const fmtGap = (gap) => Array.isArray(gap)
  ? `[${gap[0]}, ${gap[1]})`
  : Object.entries(gap ?? {}).map(([ax, g]) => `${ax}: [${g[0]}, ${g[1]})`).join('  ')

export function ContextLayer() {
  const ctx       = useUIStore(s => s.context)
  const selection = useUIStore(s => s.selection)
  const callbacks = useUIStore(s => s.callbacks)
  const setTab    = useUIStore(s => s.actions.contextSetTab)
  const setFilter = useUIStore(s => s.actions.contextSetPersonaFilter)

  // Proof-feedback wiring (ADR-062 Phase 3): the header conflict count gets a
  // run-over-run delta chip + a green flash when conflicts just cleared. Facts
  // come from validator-owned `ctx.conflicts` (`resolvedBy` included); hooks run
  // before the active-guard (React rule); history is component-local.
  const liveConflictRefs = ctx.active ? (ctx.conflicts ?? []).filter(c => !c.resolvedBy).map(c => c.ref) : null
  const { prev: prevLiveRefs, tick: conflictTick } = usePrevOnChange(liveConflictRefs)
  const conflictDelta = listDelta(prevLiveRefs, liveConflictRefs)
  const clearedNow    = (settledRefs(prevLiveRefs, liveConflictRefs) ?? []).length > 0

  if (!ctx.active) return null

  const isMobile = window.innerWidth < 768
  const liveConflicts = liveConflictRefs.length
  // negotiate shows the resolution + record tabs (Questions only when the doc has
  // open ones); ghost shows matrix only (read-only persona filter); author has no
  // tabs at all — the 3-D widgets do the editing and the panel is a readout.
  const tabs =
    ctx.mode === 'negotiate'
      ? FLOOR_TABS.filter(t => t.when !== 'hasForm' || ctx.form?.length > 0)
    : ctx.mode === 'ghost' ? FLOOR_TABS.filter(t => t.id === FLOOR_TAB.MATRIX)
    : []

  return (
    <div style={{
      position:   'fixed',
      // 下部の展開パネル (ADR-106 D1)。3D を覆わず、常設しない。
      // 下端の占有量は EdgeOccupancy ただ 1 箇所が計算する (原則 #26 / D6) —
      // InfoBar は位置も高さも変えず、場はその上に開く (原則 #15 Fixed Slots)。
      left:       '0',
      right:      '0',
      bottom:     `${bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.FLOOR })}px`,
      height:     `${floorHeight({ isMobile })}px`,
      background: 'rgba(30, 30, 30, 0.96)',
      borderTop:  '1px solid #3a3a3a',
      // Below the edge docks (Outliner / N panel, z:90 → they keep their own
      // width and step up instead of being covered) and below the gizmo tier,
      // because covering the subject of the negotiation is the defect this move
      // exists to remove. It used to be z:100 over everything at the right edge.
      zIndex:     85,
      display:    'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize:   '12px',
      color:      '#e8e8e8',
      pointerEvents: 'auto',
      boxSizing:  'border-box',
    }}>
      <FeedbackDefs />
      <CelebrationDefs />
      {/* Celebration (ADR-065 Phase 4): ONE watcher at the overlay root — it
          sees all three fact lists regardless of the active tab (a panel-local
          watcher would lose its history on tab switch), and mounting exactly
          one enforces the budget of 1 concurrent celebration structurally. */}
      <ContextCelebration />
      <div style={{ padding: '8px 10px 4px', fontWeight: 'bold', display: 'flex', alignItems: 'baseline' }}>
        <span style={{ color: '#c8c8c8' }}>{TITLE[ctx.mode] ?? 'Context'}</span>
        <span style={{ marginLeft: '6px', fontWeight: 'normal', fontSize: '10px', color: '#888' }}>
          {ctx.docMeta?.name ?? 'Context'}
        </span>
        <button
          onClick={() => callbacks.onContextExit?.()}
          title="Close"
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
              tab.id === FLOOR_TAB.MATRIX    ? (ctx.conflictMatrix ? Object.values(ctx.conflictMatrix.variableSummary).filter(s => s.inConflict && !s.approved).length : 0) :
              tab.id === FLOOR_TAB.CLUSTER   ? (ctx.resolutionOrder?.filter(s => !s.approved).length ?? 0) :
              tab.id === FLOOR_TAB.QUESTIONS ? (ctx.form?.length ?? 0) :
              tab.id === FLOOR_TAB.AGENDA    ? (ctx.agendaRows?.filter(r => !r.settled).length ?? 0) :
              tab.id === FLOOR_TAB.WHY       ? (ctx.provenance?.gaps?.filter(g => !g.resolved).length ?? 0) : 0
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                style={{
                  // No `flex: 1`. The tab row does not have to divide a fixed
                  // 280px any more, so labels get the width they need — the
                  // container's shape is the fix, not a smaller font (D1).
                  padding: '6px 14px', background: 'transparent', border: 'none',
                  borderBottom: active ? '2px solid #3a7bd5' : '2px solid transparent',
                  color: active ? '#5a9bf5' : '#999', cursor: 'pointer', fontSize: '11px',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
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

      <LandingFlash tick={conflictTick} active={clearedNow}
        style={{ padding: '4px 8px 0', fontSize: '10px', color: liveConflicts ? '#cc6666' : '#22C55E' }}>
        {liveConflicts ? `${liveConflicts} unresolved conflict${liveConflicts > 1 ? 's' : ''}` : '✓ All conflicts resolved'}
        {' '}
        <DeltaChip value={conflictDelta} goodWhenPositive={false} label="conflicts" />
      </LandingFlash>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {/* Authoring is where a drag on someone else's claim becomes a proposal,
            so the floor is rendered here too — otherwise the proposal a gesture
            just created would have nowhere to appear (PHILOSOPHY #11). */}
        {ctx.mode === 'author' && <><AuthorConflicts conflicts={ctx.conflicts} /><AgendaPanel /></>}

        {ctx.mode === 'negotiate' && ctx.inspectorTab === FLOOR_TAB.AGENDA && <AgendaPanel />}

        {(ctx.mode === 'negotiate' || ctx.mode === 'ghost') && ctx.inspectorTab === FLOOR_TAB.MATRIX && (
          <ConflictMatrix
            matrix={ctx.conflictMatrix}
            filter={ctx.personaFilter}
            onSetFilter={setFilter}
            // The variable header is a WINDOW onto the one selection (ADR-107 D2):
            // it fires a verb and reads the display copy — it holds no selection
            // state of its own, which is what keeps the entrance count at five.
            selectedVariables={selection.kind === 'variables' ? selection.members : []}
            onSelectVariable={callbacks.onSelectVariable}
          />
        )}
        {ctx.mode === 'negotiate' && ctx.inspectorTab === FLOOR_TAB.CLUSTER && (
          <NegotiationClusterView
            order={ctx.resolutionOrder}
            clusters={ctx.negotiationClusters}
            filter={ctx.personaFilter}
            onApprove={ref => callbacks.onApproveContextDecision?.(ref)}
          />
        )}
        {ctx.mode === 'negotiate' && ctx.inspectorTab === FLOOR_TAB.QUESTIONS && (
          <FormPanel />
        )}
        {ctx.mode === 'negotiate' && ctx.inspectorTab === FLOOR_TAB.WHY && (
          <WhyBreadcrumb />
        )}
        {ctx.mode === 'negotiate' && ctx.inspectorTab === FLOOR_TAB.TREE && (
          <WhyTreeView />
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
        Drag each actor's admissible zone directly in 3D. Overlap clears the conflict (green); separation brings it back (red).
        Committing writes the change back to the document as an undoable requirement edit (3D is the input device, the contract is the text DSL).
      </div>
      {conflicts.length === 0 && (
        <div style={{ color: '#22C55E', fontSize: '11px' }}>✓ No conflicts — all admissible regions intersect</div>
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
