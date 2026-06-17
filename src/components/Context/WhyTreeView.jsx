import { useUIStore } from '../../store/uiStore.js'
import { narrateWhyTree } from '../../context/ProvenanceNarrative.js'

/**
 * WhyTreeView — bird's-eye view of the whole Why-rooted 5W1H tree
 * (ADR-052 Phase 3).
 *
 * Where WhyBreadcrumb (Phase 2) shows the *upward* φ⁻¹ climb from a single
 * selected scene entity, this panel renders the **entire** canonical document as
 * the single Why-rooted tree that ADR-052 §2.1 contracts it to be: Why (KPI /
 * criterion / Acceptance / Intent) at the apex, How (decisions / obligations /
 * constraints) in the middle, What (entities / facts / variables) at the leaves.
 *
 * It is the panoramic complement to the breadcrumb — the structure that
 * `buildWhyTree(ctx)` exposes is just the already-scattered doc relations
 * synthesised into one typed graph (no new data structure — ProvenanceTree
 * contract). The Why **roots** (the apexes nothing climbs above) are surfaced
 * first so the reader sees what every placement ultimately serves.
 *
 * Presentational + slice-bound to `context.whyTree` (pushed by
 * ContextController from ContextService.whyTree()). Shares the visual language
 * of WhyBreadcrumb (Layer / Tag / cards) so the two Why views read as one family.
 */

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

// Per-kind accent — Why blues/purples, How amber, What green/grey.
const KIND_COLOR = {
  intent:      '#7a6ad5',
  requirement: '#5a9bf5',
  acceptance:  '#5ab0d5',
  decision:    '#d59b3a',
  obligation:  '#d5853a',
  constraint:  '#b5953a',
  entity:      '#5aa86a',
  fact:        '#6a9a5a',
  variable:    '#8aa86a',
  ref:         '#888888',
}

const LAYER_META = {
  why:  { title: 'Why — KPI / クライテリア / Acceptance / Intent', color: '#5a9bf5' },
  how:  { title: 'How — Decision / Obligation / Constraint',       color: '#d59b3a' },
  what: { title: 'What — Entity / Fact / Variable',                color: '#5aa86a' },
}

export function WhyTreeView() {
  const tree = useUIStore(s => s.context.whyTree)

  if (!tree || tree.nodes.length === 0) {
    return (
      <div style={{ color: '#888', fontSize: '11px', lineHeight: 1.6 }}>
        正準ドキュメントを <b style={{ color: '#aaa' }}>Why ルートの 5W1H ツリー</b> として
        俯瞰します (ADR-052 §2.1)。アクター・変数・要件を追加すると、ここにツリーが現れます。
      </div>
    )
  }

  const rootSet = new Set(tree.roots)
  const byLayer = { why: [], how: [], what: [] }
  for (const n of tree.nodes) (byLayer[n.layer] ?? byLayer.what).push(n)
  // Within Why, surface the roots first (the apexes nothing climbs above).
  byLayer.why.sort((a, b) => (rootSet.has(b.id) - rootSet.has(a.id)) || a.id.localeCompare(b.id))

  return (
    <div style={{ fontSize: '11px', lineHeight: 1.5 }}>
      {/* Plain-language overview (doc → NL — ADR-052 Phase 4) */}
      <div style={{
        fontSize: '11px', lineHeight: 1.6, color: '#cdd6e0', marginBottom: '8px',
        padding: '6px 8px', borderRadius: '4px', background: '#5a9bf514',
        borderLeft: '2px solid #5a9bf5',
      }}>
        {narrateWhyTree(tree, { lang: 'ja' })}
      </div>

      <div style={{ color: '#999', marginBottom: '8px', lineHeight: 1.5 }}>
        シーンは Why を落とす What/How 射影 (invariant 9)。このツリーが正準 doc 側に保持された
        <b style={{ color: '#aaa' }}> 全体の来歴構造</b>です。各エッジは派生 (What) → 源泉 (Why) に向きます。
      </div>

      {['why', 'how', 'what'].map(layer => {
        const nodes = byLayer[layer]
        const meta = LAYER_META[layer]
        return (
          <Layer key={layer} title={meta.title} color={meta.color} count={nodes.length}>
            {nodes.length === 0 && <Empty>（この層のノードはありません）</Empty>}
            {nodes.map(n => {
              const accent = KIND_COLOR[n.kind] ?? meta.color
              const isRoot = rootSet.has(n.id)
              return (
                <div key={n.id} style={cardStyle(accent)}>
                  <div>
                    <Tag color={accent}>{KIND_LABEL[n.kind] ?? n.kind}</Tag>
                    {isRoot && (
                      <span
                        title="Why ルート — これより上に遡れる要求はありません"
                        style={{
                          marginLeft: '4px', background: '#3a5a8a', color: '#cfe2ff',
                          borderRadius: '3px', padding: '0 4px', fontSize: '8px', fontWeight: 'bold',
                        }}
                      >
                        ▲ root
                      </span>
                    )}
                    <span style={{ marginLeft: '5px', fontWeight: isRoot ? 'bold' : 'normal' }}>{n.label}</span>
                  </div>
                  {n.kind === 'requirement' && n.data?.kpi?.expr && (
                    <div style={mono}>{n.data.kpi.expr}</div>
                  )}
                  {n.kind === 'requirement' && n.data?.criterion && (
                    <div style={{ color: '#9bd', marginTop: '1px' }}>
                      クライテリア: {n.data.criterion.op} {n.data.criterion.value} {n.data.kpi?.unit ?? ''}
                    </div>
                  )}
                  <Ref>{n.ref}</Ref>
                </div>
              )
            })}
          </Layer>
        )
      })}

      <div style={{ color: '#666', fontSize: '9px', marginTop: '6px' }}>
        {tree.nodes.length} ノード · {tree.edges.length} エッジ · {tree.roots.length} Why ルート
      </div>
    </div>
  )
}

// ── Small presentational primitives (shared visual language with WhyBreadcrumb) ──

function Layer({ title, color, count, children }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{
        color, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase',
        letterSpacing: '0.04em', borderBottom: `1px solid ${color}44`, paddingBottom: '2px',
        marginBottom: '4px', display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{title}</span>
        <span style={{ color: `${color}aa` }}>{count}</span>
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
