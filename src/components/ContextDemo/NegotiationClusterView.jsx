import { Badge, Ref } from './ContextInspector.jsx'
import { DeltaChip, LandingFlash, usePrevOnChange } from '../Feedback/FeedbackPrimitives.jsx'
import { listDelta, settledRefs } from '../../view/FeedbackMath.js'

/**
 * NegotiationClusterView — resolution-order ("meeting design") visualization
 * (ADR-049 Phase 4, §R7 / §8 Phase 4).
 *
 * Read-only. Renders projectResolutionOrder() as a numbered vertical list:
 * each step is either a single-variable conflict (single Decision) or a
 * negotiation cluster (n-ary Decision), shown with the variables, involved
 * actors, upstream dependencies ("← after"), and the Decision that resolves it.
 * Contracting clusters makes the dependency graph a DAG; the order is its
 * topological sort (DSM partitioning). The persona filter dims steps the
 * selected actor is not part of.
 *
 * Prop-driven (ADR-050 §4.4): slice-independent so the same presentational
 * component serves both the demo (`demo` slice) and the production ContextLayer
 * (`context` slice).
 *
 * @param {object}   props
 * @param {Array}    props.order    — projectResolutionOrder() result
 * @param {Array}    props.clusters — negotiationClusters (R7 output)
 * @param {string|null} props.filter — selected actor ref (persona filter)
 * @param {(decisionRef:string)=>void} props.onApprove — approve handler
 */

const shortActor = (ref) => ref.split('_')[0]

export function NegotiationClusterView({ order, clusters, filter, onApprove }) {
  // Proof-feedback wiring (ADR-062 Phase 3): approval flows through the
  // CommandStack and re-projects this order; the flash on a freshly-settled
  // step and the unsettled-count delta chip only display that fact. Hooks run
  // before the empty-guard (React rule); previous snapshot is component-local.
  const openSteps = Array.isArray(order) ? order.filter(s => !s.approved).map(s => s.ref) : null
  const { prev: prevOpenSteps, tick } = usePrevOnChange(openSteps)
  const openDelta    = listDelta(prevOpenSteps, openSteps)
  const settledSteps = settledRefs(prevOpenSteps, openSteps) ?? []

  if (!order || order.length === 0) {
    return <div style={{ color: '#22C55E', fontSize: '11px' }}>✓ No conflicts or negotiation clusters</div>
  }

  // A step can only be approved once every upstream step it depends on is
  // approved — the n-ary cluster waits for its single-variable conflicts to
  // settle first (ADR-049 invariant 8, DSM partitioning order).
  const approvedByRef = Object.fromEntries(order.map(s => [s.ref, s.approved]))
  const allApproved   = order.every(s => s.approved)
  const approve = (ref) => onApprove?.(ref)

  return (
    <>
      <div style={{ color: '#999', marginBottom: '8px', fontSize: '11px' }}>
        Contracting clusters turns the dependencies into a DAG, giving the order in which to stack joint Decisions (DSM partitioning).
        Single-variable conflicts can be settled independently; coupled clusters are settled together with an n-ary Decision.
        Approve from the top down.
        <DeltaChip value={openDelta} goodWhenPositive={false} label="unsettled" />
      </div>

      {allApproved && (
        <LandingFlash tick={tick} active={settledSteps.length > 0} style={{
          color: '#22C55E', fontSize: '11px', marginBottom: '8px',
          padding: '5px 7px', background: '#16341f', border: '1px solid #225c34', borderRadius: '4px',
        }}>
          ✓ All Decisions settled — negotiation clusters resolved
        </LandingFlash>
      )}

      {order.map((step, i) => {
        const dim = filter && !step.actors.includes(filter)
        const isCluster = step.kind === 'cluster'
        return (
          <div key={step.ref} style={{ opacity: dim ? 0.35 : 1 }}>
            {i > 0 && (
              <div style={{ textAlign: 'center', color: '#555', fontSize: '11px', lineHeight: '1' }}>↓</div>
            )}
            {/* A step that just settled replays the green landing flash. */}
            <LandingFlash tick={tick} active={settledSteps.includes(step.ref)} style={{
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
                            ? `Approve ${step.resolvedBy} to settle ${step.variables.join(' + ')}`
                            : `Settle ${unmet.join(', ')} first`}
                          style={{
                            padding: '3px 9px', borderRadius: '4px', fontSize: '10px',
                            fontFamily: 'inherit', cursor: ready ? 'pointer' : 'not-allowed',
                            color: ready ? '#fff' : '#777',
                            background: ready ? (isCluster ? '#a86a30' : '#3a6abf') : '#2a2a2a',
                            border: `1px solid ${ready ? (isCluster ? '#d5a23a' : '#5a9bf5') : '#3a3a3a'}`,
                          }}
                        >
                          {isCluster ? 'Settle jointly' : 'Settle'} · {step.resolvedBy}
                        </button>
                        {!ready && (
                          <div style={{ fontSize: '10px', color: '#c8923a', marginTop: '2px' }}>
                            ← Settle {unmet.join(', ')} first
                          </div>
                        )}
                      </>
                    )
                  })()
                ) : (
                  <Badge color="#f59e0b" pulse>unsettled (no Decision proposed)</Badge>
                )}
              </div>
              <Ref>{step.ref}</Ref>
            </LandingFlash>
          </div>
        )
      })}

      <div style={{ color: '#999', margin: '10px 0 4px', fontSize: '11px' }}>
        Negotiation clusters: {clusters?.length ?? 0}
      </div>
      {(clusters ?? []).map(nc => {
        const dim = filter && !nc.actors?.includes(filter)
        return (
          <div key={nc.ref} style={{
            padding: '6px 7px', marginBottom: '4px', borderRadius: '4px',
            background: '#262626', border: '1px solid #333', lineHeight: '1.5',
            opacity: dim ? 0.35 : 1,
          }}>
            <div style={{ fontSize: '10px', color: '#aaa' }}>
              {nc.requirements.join('  ×  ')}
            </div>
            <Ref>{nc.ref}</Ref>
          </div>
        )
      })}
    </>
  )
}
