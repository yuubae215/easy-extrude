import { useUIStore } from '../../store/uiStore.js'
import { ConflictMatrix } from './ConflictMatrix.jsx'
import { NegotiationClusterView } from './NegotiationClusterView.jsx'

/**
 * ContextInspector — requirement tree panel for the Context DSL demo (ADR-047).
 *
 * Right fixed panel (280px). Tabs follow the story step (set by
 * ContextDemoController) but remain user-clickable. Row click fires
 * onDemoItemSelect → 3D highlight via trace links.
 *
 * Desktop-first: hidden under 768px (declared in ADR-047) — EXCEPT the
 * negotiation view (ADR-049 Phase 4), which is a pure data overlay with no 3D
 * dependency, so it renders full-width on mobile (a transient overlay, not a
 * persistent edge panel — PHILOSOPHY #26). Negotiation is detected by the
 * presence of a projected `conflictMatrix`.
 */

const STATUS_COLORS = {
  measured: '#22C55E',
  asserted: '#4fc3f7',
  assumed:  '#f59e0b',
  unknown:  '#f43f5e',
}

const TABS = [
  { id: 'facts',         label: 'Given' },
  { id: 'openQuestions', label: 'OQ' },
  { id: 'decisions',     label: 'Decision' },
  { id: 'trace',         label: 'Trace' },
  { id: 'acceptance',    label: 'Accept' },
  { id: 'conflicts',     label: 'Conflict' },
  { id: 'matrix',        label: 'Matrix' },   // ADR-049 Phase 4
  { id: 'cluster',       label: 'Cluster' },  // ADR-049 Phase 4
]

export function ContextInspector() {
  const demo      = useUIStore(s => s.demo)
  const callbacks = useUIStore(s => s.callbacks)
  const setTab    = useUIStore(s => s.actions.demoSetTab)
  const setFilter = useUIStore(s => s.actions.demoSetPersonaFilter)

  const isMobile      = window.innerWidth < 768
  const isNegotiation = !!demo.conflictMatrix
  // Story/authoring inspector pairs with the 3D scene → desktop only. The
  // negotiation overlay is 3D-independent → allowed full-width on mobile.
  if (isMobile && !isNegotiation) return null
  if (!demo.inspectorTab) return null

  const select = (ref) => callbacks.onDemoItemSelect?.(ref)

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
      <div style={{ padding: '8px 10px 4px', fontWeight: 'bold', fontSize: '12px', color: '#c8c8c8' }}>
        Context Inspector
        <span style={{ float: 'right', fontFamily: 'monospace', fontWeight: 'normal', color: '#666' }}>
          context/0.1
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #3a3a3a' }}>
        {TABS.map(tab => {
          const active = demo.inspectorTab === tab.id
          const badge =
            tab.id === 'openQuestions' ? demo.openQuestions.length :
            tab.id === 'acceptance'    ? demo.blockedChecks.length :
            tab.id === 'conflicts'     ? (demo.conflicts?.filter(c => !c.resolvedBy).length ?? 0) :
            tab.id === 'matrix'        ? (demo.conflictMatrix ? Object.values(demo.conflictMatrix.variableSummary).filter(s => s.inConflict && !s.approved).length : 0) :
            tab.id === 'cluster'       ? (demo.resolutionOrder?.filter(s => !s.approved).length ?? 0) : 0
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
                  marginLeft: '3px', background: tab.id === 'openQuestions' ? '#f43f5e' : '#7a3030',
                  color: '#fff', borderRadius: '7px', padding: '0 4px', fontSize: '9px',
                }}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {demo.inspectorTab === 'facts'         && <FactsTab demo={demo} select={select} />}
        {demo.inspectorTab === 'openQuestions' && <OpenQuestionsTab demo={demo} select={select} />}
        {demo.inspectorTab === 'decisions'     && <DecisionsTab demo={demo} select={select} />}
        {demo.inspectorTab === 'trace'         && <TraceTab demo={demo} select={select} />}
        {demo.inspectorTab === 'acceptance'    && <AcceptanceTab demo={demo} />}
        {demo.inspectorTab === 'conflicts'     && <ConflictsTab demo={demo} select={select} />}
        {demo.inspectorTab === 'matrix'        && (
          <ConflictMatrix
            matrix={demo.conflictMatrix}
            filter={demo.personaFilter}
            onSetFilter={setFilter}
          />
        )}
        {demo.inspectorTab === 'cluster'       && (
          <NegotiationClusterView
            order={demo.resolutionOrder}
            clusters={demo.negotiationClusters}
            filter={demo.personaFilter}
            onApprove={ref => callbacks.onApproveNegotiationDecision?.(ref)}
          />
        )}
      </div>
    </div>
  )
}

// ── Shared row primitives ───────────────────────────────────────────────────

export function Row({ onClick, selected, children }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 7px', marginBottom: '4px', borderRadius: '4px',
        background: selected ? '#2c3a4e' : '#262626',
        border: `1px solid ${selected ? '#3a7bd5' : '#333'}`,
        cursor: onClick ? 'pointer' : 'default',
        lineHeight: '1.5',
      }}
    >
      {children}
    </div>
  )
}

export function Badge({ color, children, pulse = false }) {
  return (
    <span style={{
      display: 'inline-block', padding: '0 5px', borderRadius: '3px',
      border: `1px solid ${color}`, color, fontSize: '9px', marginLeft: '5px',
      verticalAlign: 'middle',
      animation: pulse ? 'ee-demo-pulse 1.2s ease-in-out infinite' : 'none',
    }}>
      {children}
      {pulse && (
        <style>{'@keyframes ee-demo-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }'}</style>
      )}
    </span>
  )
}

export function Ref({ children }) {
  return <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#888' }}>{children}</span>
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function FactsTab({ demo, select }) {
  return demo.facts.map(fact => {
    const unknownAttrs = Object.entries(fact.attrs ?? {}).filter(([, v]) => v === 'unknown')
    return (
      <Row key={fact.ref} onClick={() => select(fact.ref)} selected={demo.selectedItemRef === fact.ref}>
        <div>
          {fact.subject}
          <Badge color={STATUS_COLORS[fact.status] ?? '#888'}>{fact.status}</Badge>
        </div>
        {fact.quantity?.interval && (
          <div style={{ color: '#d5a23a', fontFamily: 'monospace', fontSize: '11px' }}>
            interval [{fact.quantity.interval[0]}, {fact.quantity.interval[1]}] {fact.quantity.unit}
          </div>
        )}
        {unknownAttrs.map(([key]) => (
          <div key={key} style={{ fontSize: '10px' }}>
            <Badge color="#f43f5e" pulse>unknown</Badge>
            <span style={{ color: '#aaa', marginLeft: '4px' }}>{key}</span>
          </div>
        ))}
        <Ref>{fact.ref}</Ref>
      </Row>
    )
  })
}

function OpenQuestionsTab({ demo, select }) {
  return (
    <>
      <div style={{ color: '#999', marginBottom: '6px', fontSize: '11px' }}>
        Open items generated mechanically by the validator — not written by a person.
      </div>
      {demo.openQuestions.map(oq => (
        <Row key={oq.ref} onClick={() => select(oq.ref)} selected={demo.selectedItemRef === oq.ref}>
          <div>
            <Badge color="#f43f5e">{oq.raisedBy.split(':')[0]}</Badge>
            <span style={{ marginLeft: '5px' }}>{oq.summary}</span>
          </div>
          <Ref>{oq.ref}</Ref>
        </Row>
      ))}
      <div style={{ color: '#999', margin: '8px 0 4px', fontSize: '11px' }}>
        Blocked acceptance checks: {demo.blockedChecks.length}
      </div>
      {demo.blockedChecks.map(b => (
        <Row key={b.check}>
          <span style={{ color: '#f43f5e' }}>🚫 {b.check}</span>
          <div style={{ fontSize: '10px', color: '#888' }}>← {b.blockedBy.join(', ')}</div>
        </Row>
      ))}
    </>
  )
}

function DecisionsTab({ demo, select }) {
  return demo.decisions.map(d => {
    const approved = !!demo.approvedDecisions[d.ref]
    const fact = demo.facts.find(f => f.ref === d.resolves)
    return (
      <Row key={d.ref} onClick={() => select(d.ref)} selected={demo.selectedItemRef === d.ref}>
        <div>
          resolves <Ref>{d.resolves}</Ref>
          <Badge color={approved ? '#22C55E' : '#f59e0b'}>{approved ? 'agreed' : d.status}</Badge>
        </div>
        {fact?.quantity?.interval && (
          <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d5a23a' }}>
            [{fact.quantity.interval[0]}, {fact.quantity.interval[1]}] {fact.quantity.unit}
            <span style={{ color: '#5a9bf5' }}> → {d.nominal}</span>
          </div>
        )}
        <div style={{ color: '#999', fontSize: '10px' }}>{d.rationale}</div>
        <Ref>{d.ref} · decidedBy: {d.decidedBy}</Ref>
      </Row>
    )
  })
}

function TraceTab({ demo, select }) {
  return (
    <>
      <div style={{ color: '#999', marginBottom: '6px', fontSize: '11px' }}>
        Every specification element traces back to a requirement. Click a row to highlight it in 3D.
      </div>
      {demo.trace.map((link, i) => (
        <Row key={i} onClick={() => select(link.from)}>
          <Ref>{link.from}</Ref>
          <span style={{ color: '#666', margin: '0 4px' }}>—{link.kind}→</span>
          <Ref>{link.to}</Ref>
        </Row>
      ))}
    </>
  )
}

function ConflictsTab({ demo, select }) {
  const conflicts = demo.conflicts ?? []
  const fmtGap = (gap) => Array.isArray(gap)
    ? `[${gap[0]}, ${gap[1]})`
    : Object.entries(gap).map(([ax, g]) => `${ax}: [${g[0]}, ${g[1]})`).join('  ')
  return (
    <>
      <div style={{ color: '#999', marginBottom: '6px', fontSize: '11px' }}>
        Detected by intersecting admissible regions per shared design variable. Drag zones to overlap and the conflict clears.
        Conflicts are emitted by rules, not written by a person.
      </div>
      {conflicts.length === 0 && (
        <div style={{ color: '#22C55E', fontSize: '11px' }}>✓ No conflicts — all admissible regions intersect</div>
      )}
      {conflicts.map(c => (
        <Row key={c.ref} onClick={() => select(c.variable)} selected={demo.selectedItemRef === c.variable}>
          <div>
            <Badge color={c.resolvedBy ? '#22C55E' : '#cc3333'} pulse={!c.resolvedBy}>
              {c.resolvedBy ? 'resolved' : 'conflict'}
            </Badge>
            <span style={{ marginLeft: '5px' }}>{c.variable}</span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#cc6666' }}>
            gap {fmtGap(c.gap)}
          </div>
          <div style={{ fontSize: '10px', color: '#888' }}>{c.between.join('  ×  ')}</div>
          <Ref>{c.ref}{c.resolvedBy ? ` · by ${c.resolvedBy}` : ''}</Ref>
        </Row>
      ))}
    </>
  )
}

function AcceptanceTab({ demo }) {
  const blockedByCheck = new Map(demo.blockedChecks.map(b => [b.check, b.blockedBy]))
  return demo.acceptance.map(check => {
    const blockedBy = blockedByCheck.get(check.ref)
    return (
      <Row key={check.ref}>
        <div>
          <span style={{ color: blockedBy ? '#f43f5e' : '#22C55E' }}>
            {blockedBy ? '🚫' : '✓'}
          </span>
          <span style={{ marginLeft: '5px' }}>
            {typeof check.predicate === 'object' ? check.predicate.kind : check.predicate}
          </span>
          <Badge color={check.mode === 'static' ? '#4fc3f7' : '#a78bfa'}>{check.mode}</Badge>
        </div>
        {blockedBy && (
          <div style={{ fontSize: '10px', color: '#f43f5e' }}>
            blocked → {blockedBy.join(', ')}
          </div>
        )}
        <Ref>{check.ref}</Ref>
      </Row>
    )
  })
}
