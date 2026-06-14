import { useUIStore } from '../../store/uiStore.js'
import { Badge, Ref } from './ContextInspector.jsx'

/**
 * NegotiationClusterView — resolution-order ("meeting design") visualization
 * (ADR-049 Phase 4, §R7 / §8 Phase 4).
 *
 * Read-only. Renders projectResolutionOrder() as a numbered vertical list:
 * each step is either a single-variable conflict (single Decision) or a
 * negotiation cluster (n-ary Decision), shown with the variables, involved
 * actors, upstream dependencies ("← after"), and the Decision that resolves it
 * (read-only — the n-ary approval interaction is deferred). Contracting clusters
 * makes the dependency graph a DAG; the order is its topological sort (DSM
 * partitioning). The persona filter dims steps the selected actor is not part of.
 */

const shortActor = (ref) => ref.split('_')[0]

export function NegotiationClusterView() {
  const order     = useUIStore(s => s.demo.resolutionOrder)
  const clusters  = useUIStore(s => s.demo.negotiationClusters)
  const filter    = useUIStore(s => s.demo.personaFilter)
  const callbacks = useUIStore(s => s.callbacks)

  if (!order || order.length === 0) {
    return <div style={{ color: '#22C55E', fontSize: '11px' }}>✓ 衝突・交渉クラスターなし</div>
  }

  // A step can only be approved once every upstream step it depends on is
  // approved — the n-ary cluster waits for its single-variable conflicts to
  // settle first (ADR-049 invariant 8, DSM partitioning order).
  const approvedByRef = Object.fromEntries(order.map(s => [s.ref, s.approved]))
  const allApproved   = order.every(s => s.approved)
  const approve = (ref) => callbacks.onApproveNegotiationDecision?.(ref)

  return (
    <>
      <div style={{ color: '#999', marginBottom: '8px', fontSize: '11px' }}>
        クラスターを縮約すると依存は DAG になり、合同 Decision を積む順序が導ける (DSM partitioning)。
        単一変数の衝突は独立に確定でき、結合クラスターは n-ary Decision で同時確定 (ADR-049 不変条件8)。
        上から順に承認していく。
      </div>

      {allApproved && (
        <div style={{
          color: '#22C55E', fontSize: '11px', marginBottom: '8px',
          padding: '5px 7px', background: '#16341f', border: '1px solid #225c34', borderRadius: '4px',
        }}>
          ✓ すべての Decision が確定 — 交渉クラスターは解消済み
        </div>
      )}

      {order.map((step, i) => {
        const dim = filter && !step.actors.includes(filter)
        const isCluster = step.kind === 'cluster'
        return (
          <div key={step.ref} style={{ opacity: dim ? 0.35 : 1 }}>
            {i > 0 && (
              <div style={{ textAlign: 'center', color: '#555', fontSize: '11px', lineHeight: '1' }}>↓</div>
            )}
            <div style={{
              padding: '7px 8px', marginBottom: '2px', borderRadius: '4px',
              background: '#262626',
              border: `1px solid ${isCluster ? '#a86a30' : '#3a4a5e'}`,
              lineHeight: '1.5',
            }}>
              <div>
                <span style={{
                  display: 'inline-block', width: '16px', height: '16px', borderRadius: '50%',
                  background: '#3a3a3a', color: '#c8c8c8', textAlign: 'center',
                  fontSize: '10px', lineHeight: '16px', marginRight: '6px',
                }}>
                  {step.order + 1}
                </span>
                <Badge color={isCluster ? '#d5a23a' : '#5a9bf5'}>
                  {isCluster ? 'n-ary' : 'single'}
                </Badge>
                <span style={{ marginLeft: '5px', fontFamily: 'monospace', fontSize: '10px' }}>
                  {step.variables.join(' + ')}
                </span>
              </div>

              <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
                {step.actors.map(shortActor).join('  ·  ')}
              </div>

              {step.dependsOn.length > 0 && (
                <div style={{ fontSize: '10px', color: '#7a7a7a' }}>
                  ← after: {step.dependsOn.join(', ')}
                </div>
              )}

              <div style={{ marginTop: '3px' }}>
                {step.approved ? (
                  <Badge color="#22C55E">resolved · {step.resolvedBy} ✓</Badge>
                ) : step.resolvedBy ? (
                  (() => {
                    const unmet = step.dependsOn.filter(d => !approvedByRef[d])
                    const ready = unmet.length === 0
                    return (
                      <>
                        <button
                          onClick={() => ready && approve(step.resolvedBy)}
                          disabled={!ready}
                          title={ready
                            ? `${step.resolvedBy} を承認して ${step.variables.join(' + ')} を確定`
                            : `先に ${unmet.join(', ')} を確定`}
                          style={{
                            padding: '3px 9px', borderRadius: '4px', fontSize: '10px',
                            fontFamily: 'inherit', cursor: ready ? 'pointer' : 'not-allowed',
                            color: ready ? '#fff' : '#777',
                            background: ready ? (isCluster ? '#a86a30' : '#3a6abf') : '#2a2a2a',
                            border: `1px solid ${ready ? (isCluster ? '#d5a23a' : '#5a9bf5') : '#3a3a3a'}`,
                          }}
                        >
                          {isCluster ? '合同確定' : '確定'} · {step.resolvedBy}
                        </button>
                        {!ready && (
                          <div style={{ fontSize: '10px', color: '#c8923a', marginTop: '2px' }}>
                            ← 先に {unmet.join(', ')} を確定
                          </div>
                        )}
                      </>
                    )
                  })()
                ) : (
                  <Badge color="#f59e0b" pulse>未確定 (Decision 未提案)</Badge>
                )}
              </div>
              <Ref>{step.ref}</Ref>
            </div>
          </div>
        )
      })}

      <div style={{ color: '#999', margin: '10px 0 4px', fontSize: '11px' }}>
        交渉クラスター (R7): {clusters?.length ?? 0} 件
      </div>
      {(clusters ?? []).map(nc => (
        <div key={nc.ref} style={{
          padding: '6px 7px', marginBottom: '4px', borderRadius: '4px',
          background: '#262626', border: '1px solid #333', lineHeight: '1.5',
        }}>
          <div style={{ fontSize: '10px', color: '#aaa' }}>
            {nc.requirements.join('  ×  ')}
          </div>
          <Ref>{nc.ref}</Ref>
        </div>
      ))}
    </>
  )
}
