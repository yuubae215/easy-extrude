import { useUIStore } from '../../store/uiStore.js'

/**
 * WhyBreadcrumb — φ⁻¹ provenance presentation for a selected scene entity
 * (ADR-052 Phase 2).
 *
 * The 3-D scene is a *What/How projection* of the canonical document that drops
 * the Why (ADR-049 invariant 9 / ADR-052 §1): from the mesh alone you cannot tell
 * why a placement exists. This panel reverses that — when an entity is selected in
 * the negotiation overlay, ContextController.showProvenance climbs the doc's
 * derived→source edges (ProvenanceTree.recoverProvenance) and pushes the result
 * here. It reads top-down in 5W1H order: Why (the KPI / criterion / Intent the
 * placement serves) → How (the decisions / obligations / constraints) → What (the
 * selected entity + facts), with the measured-vs-target Gap (R6, joined by
 * ContextService) flagged red when live, green when Decision-settled.
 *
 * Presentational + slice-bound to `context.provenance`; the climb itself is pure
 * (ProvenanceTree). Empty state nudges the user to click a derived entity.
 */

const fmtGap = (gap) => Array.isArray(gap)
  ? `[${gap[0]}, ${gap[1]})`
  : Object.entries(gap ?? {}).map(([ax, g]) => `${ax}: [${g[0]}, ${g[1]})`).join('  ')

const KIND_LABEL = {
  intent:      'Intent',
  requirement: 'Requirement',
  acceptance:  'Acceptance',
  decision:    'Decision',
  obligation:  'Obligation',
  constraint:  'Constraint',
  entity:      'Entity',
  fact:        'Fact',
  variable:    'Variable',
  ref:         'Ref',
}

export function WhyBreadcrumb() {
  const prov = useUIStore(s => s.context.provenance)

  if (!prov) {
    return (
      <div style={{ color: '#888', fontSize: '11px', lineHeight: 1.6 }}>
        Select a derived entity in the 3D view (such as an admissible zone) to trace,
        climbing upward, <b style={{ color: '#aaa' }}>which KPI, criterion, or Intent</b>
        the placement exists to satisfy (its Why).
        <div style={{ marginTop: '6px', color: '#666' }}>
          The scene is a What/How projection that drops the Why; this recovery is its inverse.
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontSize: '11px', lineHeight: 1.5 }}>
      {/* Selected entity (the What leaf the breadcrumb starts from) */}
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888', fontSize: '10px' }}>Selected</span>
        <div style={{ fontWeight: 'bold', color: '#e8e8e8' }}>
          {prov.node?.label ?? prov.entityRef}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#777' }}>{prov.entityRef}</div>
      </div>

      {/* Plain-language narration (doc → NL, the φ⁻¹ return leg — ADR-052 Phase 4) */}
      {prov.narrative && (
        <div style={{
          fontSize: '11px', lineHeight: 1.6, color: '#cdd6e0', marginBottom: '10px',
          padding: '6px 8px', borderRadius: '4px', background: '#5a9bf514',
          borderLeft: '2px solid #5a9bf5',
        }}>
          {prov.narrative}
        </div>
      )}

      {/* Why — the apex: KPIs + criteria + intents the placement serves */}
      <Layer title="Why — why this placement is needed" color="#5a9bf5">
        {prov.kpis.length === 0 && prov.intents.length === 0 && prov.why.length === 0 && (
          <Empty>No upstream requirement with a Why was reached</Empty>
        )}
        {prov.kpis.map(k => (
          <div key={k.requirement} style={cardStyle('#5a9bf5')}>
            <div>
              <Tag color="#3a5a8a">KPI</Tag>
              <span style={{ marginLeft: '5px', fontWeight: 'bold' }}>{k.name || k.requirement}</span>
            </div>
            {k.expr && <div style={mono}>{k.expr}</div>}
            {k.criterion && (
              <div style={{ color: '#9bd', marginTop: '2px' }}>
                criterion: {k.criterion.op} {k.criterion.value} {k.unit}
              </div>
            )}
            <Ref>{k.requirement}</Ref>
          </div>
        ))}
        {/* Requirements without a KPI (e.g. a sketch-derived admissible, R9) */}
        {prov.why.filter(n => n.kind === 'requirement' && !n.data?.kpi).map(n => (
          <div key={n.id} style={cardStyle('#5a9bf5')}>
            <div><Tag color="#3a5a8a">Requirement</Tag><span style={{ marginLeft: '5px' }}>{n.label}</span></div>
            <Ref>{n.ref}</Ref>
          </div>
        ))}
        {prov.intents.map(ref => (
          <div key={ref} style={cardStyle('#7a6ad5')}>
            <Tag color="#534a8a">Intent</Tag><span style={{ marginLeft: '5px' }}>{ref}</span>
          </div>
        ))}
      </Layer>

      {/* Gap — measured-vs-target (R6, joined by ContextService) */}
      {prov.gaps?.length > 0 && (
        <Layer title="Gap — measured vs. target" color="#cc6666">
          {prov.gaps.map(g => (
            <div key={g.variable} style={cardStyle(g.resolved ? '#22C55E' : '#cc3333')}>
              <Tag color={g.resolved ? '#226644' : '#7a3030'}>{g.resolved ? 'resolved' : 'conflict'}</Tag>
              <span style={{ marginLeft: '5px' }}>{g.variable}</span>
              <div style={{ ...mono, color: g.resolved ? '#8c8' : '#cc6666' }}>gap {fmtGap(g.gap)}</div>
            </div>
          ))}
        </Layer>
      )}

      {/* How — the decisions / obligations / constraints reached */}
      {prov.how.length > 0 && (
        <Layer title="How — how it is achieved" color="#d59b3a">
          {prov.how.map(n => (
            <div key={n.id} style={cardStyle('#d59b3a')}>
              <Tag color="#8a6a2a">{KIND_LABEL[n.kind] ?? n.kind}</Tag>
              <span style={{ marginLeft: '5px' }}>{n.label}</span>
              <Ref>{n.ref}</Ref>
            </div>
          ))}
        </Layer>
      )}
    </div>
  )
}

// ── Small presentational primitives (self-contained — no demo coupling) ─────────

function Layer({ title, color, children }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{
        color, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase',
        letterSpacing: '0.04em', borderBottom: `1px solid ${color}44`, paddingBottom: '2px', marginBottom: '4px',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Tag({ color, children }) {
  return (
    <span style={{
      background: color, color: '#fff', borderRadius: '3px', padding: '0 5px',
      fontSize: '9px', fontWeight: 'bold',
    }}>
      {children}
    </span>
  )
}

function Ref({ children }) {
  return <div style={{ fontFamily: 'monospace', fontSize: '9px', color: '#777', marginTop: '2px' }}>{children}</div>
}

function Empty({ children }) {
  return <div style={{ color: '#888', fontSize: '10px' }}>{children}</div>
}

const mono = { fontFamily: 'monospace', fontSize: '10px', color: '#bbb', marginTop: '2px' }

const cardStyle = (accent) => ({
  padding: '5px 7px', marginBottom: '4px', borderRadius: '4px',
  background: `${accent}14`, borderLeft: `2px solid ${accent}`,
})
