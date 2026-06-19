import { useUIStore } from '../../store/uiStore.js'

/**
 * DecisionCard — the demo's centerpiece interaction (ADR-047).
 *
 * Shown from step ④. Presents the interval-resolving Decision
 * (d_bench_distance) and the "Approve & settle" button. Approval triggers the
 * ghost-collapse animation via onDemoApproveDecision; afterwards the card
 * flips to its agreed state.
 */
export function DecisionCard() {
  const demo      = useUIStore(s => s.demo)
  const callbacks = useUIStore(s => s.callbacks)

  // Step ④ only — from step ⑤ the card would cover the center of the viewport
  // exactly where the compiled scene appears; the decision stays visible in the
  // inspector's Decision tab.
  if (demo.step !== 3) return null

  // The decision that resolves an interval fact (the ghost's source).
  const decision = demo.decisions.find(d => {
    const fact = demo.facts.find(f => f.ref === d.resolves)
    return Array.isArray(fact?.quantity?.interval)
  })
  if (!decision) return null

  const fact     = demo.facts.find(f => f.ref === decision.resolves)
  const approved = !!demo.approvedDecisions[decision.ref]
  const isMobile = window.innerWidth < 768

  return (
    <div style={{
      position:     'fixed',
      right:        isMobile ? '12px' : '292px',   // left of the 280px inspector
      // Top-anchored: bottom placements either intercepted the StoryBar's ✕
      // or covered the workbench position — the ghost-collapse animation (the
      // demo's centerpiece) must stay visible while the card is on screen.
      top:          '56px',
      width:        isMobile ? 'calc(100vw - 24px)' : '320px',
      maxWidth:     '320px',
      background:   'rgba(28, 30, 36, 0.97)',
      border:       `1px solid ${approved ? '#22C55E' : '#3a7bd5'}`,
      borderRadius: '8px',
      padding:      '12px 14px',
      zIndex:       110,
      color:        '#e8e8e8',
      fontSize:     '12px',
      fontFamily:   'system-ui, -apple-system, sans-serif',
      boxShadow:    '0 4px 24px rgba(0,0,0,0.55)',
      pointerEvents: 'auto',
      lineHeight:   '1.6',
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
        {approved ? '✓ Decision settled' : 'Approve Decision'}
        <span style={{
          float: 'right', fontSize: '10px', padding: '1px 6px', borderRadius: '3px',
          border: `1px solid ${approved ? '#22C55E' : '#f59e0b'}`,
          color: approved ? '#22C55E' : '#f59e0b',
        }}>
          {approved ? 'agreed' : decision.status}
        </span>
      </div>

      <div style={{ color: '#bbb' }}>{fact.subject}</div>

      <div style={{ fontFamily: 'monospace', margin: '6px 0', fontSize: '14px' }}>
        <span style={{ color: '#d5a23a' }}>
          [{fact.quantity.interval[0]}, {fact.quantity.interval[1]}] {fact.quantity.unit}
        </span>
        <span style={{ color: '#666' }}> → </span>
        <span style={{ color: '#5a9bf5', fontWeight: 'bold' }}>
          {decision.nominal} {fact.quantity.unit}
        </span>
      </div>

      <div style={{ color: '#999', fontSize: '11px', marginBottom: '10px' }}>
        {decision.rationale}
        <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#777', marginTop: '4px' }}>
          {decision.ref} · decidedBy: {decision.decidedBy}
        </div>
      </div>

      {approved ? (
        <div style={{ color: '#22C55E', fontSize: '11px' }}>
          The interval was settled to a nominal value, and the workbench was generated in the scene.
        </div>
      ) : (
        <button
          onClick={() => callbacks.onDemoApproveDecision?.(decision.ref)}
          style={{
            width: '100%', padding: '8px', background: '#3a7bd5', border: 'none',
            borderRadius: '5px', color: '#fff', fontWeight: 'bold', fontSize: '13px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Approve & settle — {decision.nominal} {fact.quantity.unit}
        </button>
      )}
    </div>
  )
}
