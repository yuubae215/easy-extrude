import { useUIStore } from '../../store/uiStore.js'
import { DeltaChip, LandingFlash, usePrevOnChange } from '../Feedback/FeedbackPrimitives.jsx'
import { checkStatusKeys, checkTransitions, unsettledCount, checkMeter } from '../../view/CheckFeedbackMath.js'

/**
 * ChecksPanel — acceptance-check verdicts with measurement feedback
 * (ADR-062 Phase 4, the `'checks'` tab of the negotiate overlay).
 *
 * Reads `context.checks` (ContextService.projectChecks(): the validator's
 * pass / fail / blocked verdicts joined with each check's baked predicate).
 * The panel derives, never judges (PHILOSOPHY #29):
 *   - a run-over-run unsettled-count delta chip (fewer is better),
 *   - a green landing flash on any check whose status just flipped to pass
 *     (a measurement bake or an answered question unblocking it),
 *   - the worst-margin near-miss meter for robotics predicates — the fill is
 *     the shared ADR-061 curve, the raw numbers (geometry length unit) are
 *     always printed next to it (ADR-061 discipline).
 * A blocked check shows its blocking question refs (answerable on the
 * Questions tab) and no meter — its operands were never evaluated (#11).
 * The previous snapshot is component-local (`usePrevOnChange`), never a store
 * field (ADR-062 §2).
 */

const STATUS_STYLE = {
  pass:    { label: 'pass',    color: '#22C55E', bg: 'rgba(34,197,94,0.08)',  border: '#22C55E55' },
  fail:    { label: 'fail',    color: '#cc3333', bg: 'rgba(204,51,51,0.10)',  border: '#cc333366' },
  blocked: { label: 'blocked', color: '#d5a23a', bg: 'rgba(213,162,58,0.08)', border: '#d5a23a55' },
}

export function ChecksPanel() {
  const checks = useUIStore(s => s.context.checks)

  // Status-aware snapshot: the refs signature alone would miss a status flip
  // on an unchanged check set, so the keys encode ref:status (CheckFeedbackMath).
  const keys = checkStatusKeys(checks)
  const { prev: prevKeys, tick } = usePrevOnChange(keys)
  const transitions = checkTransitions(prevKeys, keys) ?? []
  const passedNow   = new Set(transitions.filter(t => t.to === 'pass').map(t => t.ref))
  const unsettled   = unsettledCount(keys)
  const prevCount   = unsettledCount(prevKeys)
  const delta       = unsettled != null && prevCount != null ? unsettled - prevCount : null

  if (!checks || checks.length === 0) {
    return (
      <div style={{ padding: '12px 8px', textAlign: 'center', color: '#888', fontSize: '11px' }}>
        This document declares no acceptance checks.
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '4px 0 8px', fontSize: '10px', color: '#999', lineHeight: 1.5 }}>
        Acceptance verdicts decided by the validator over measured operands
        (reach margins, contact clearances). A blocked check waits for a fact —
        answer it on the Questions tab and the verdict lands here.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '6px', fontSize: '10px', color: '#c8c8c8' }}>
        <span>
          {unsettled === 0
            ? '✓ All checks pass'
            : `${unsettled} check${unsettled > 1 ? 's' : ''} not passing`}
        </span>
        {/* fewer unsettled checks = progress → goodWhenPositive: false */}
        <DeltaChip value={delta} goodWhenPositive={false} label="open" />
      </div>
      {checks.map(c => (
        <CheckCard key={c.ref} check={c} tick={tick} flash={passedNow.has(c.ref)} />
      ))}
    </div>
  )
}

function CheckCard({ check, tick, flash }) {
  const s = STATUS_STYLE[check.status] ?? STATUS_STYLE.blocked
  // No meter while blocked — the operands were never evaluated (#11).
  const meter = check.status === 'blocked' ? null : checkMeter(check.kind, check.predicate)

  return (
    <LandingFlash tick={tick} active={flash} style={{ borderRadius: '4px', marginBottom: '6px' }}>
      <div style={{
        padding: '6px 8px', borderRadius: '4px',
        background: s.bg, border: `1px solid ${s.border}`,
      }}>
        <div>
          <span style={{
            background: s.color, color: '#fff', borderRadius: '3px',
            padding: '0 5px', fontSize: '9px', fontWeight: 'bold',
          }}>
            {s.label}
          </span>
          <span style={{ marginLeft: '6px', fontFamily: 'monospace', fontSize: '11px', color: '#c8c8c8' }}>
            {check.ref}
          </span>
          {check.kind && (
            <span style={{ marginLeft: '5px', fontSize: '9px', color: '#777' }}>{check.kind}</span>
          )}
        </div>

        {check.status === 'blocked' && check.blockedBy.length > 0 && (
          <div style={{ fontSize: '10px', color: '#d5a23a', marginTop: '3px' }}>
            waiting on {check.blockedBy.join(', ')}
          </div>
        )}

        {check.status === 'fail' && check.violations.map((v, i) => (
          <div key={i} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#cc6666', marginTop: '2px' }}>
            {violationLine(v)}
          </div>
        ))}

        {meter && <MarginMeter meter={meter} status={check.status} />}
      </div>
    </LandingFlash>
  )
}

/**
 * Worst-margin near-miss meter: the fill is the shared ADR-061 curve; the raw
 * worst / required numbers (geometry length unit) are always printed beside it.
 */
function MarginMeter({ meter, status }) {
  const color = status === 'pass' ? '#22C55E' : '#cc6666'
  return (
    <div style={{ marginTop: '4px' }}>
      <div style={{ height: '4px', borderRadius: '2px', background: '#333', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.round(meter.closeness * 100)}%`, height: '100%',
          background: color, transition: 'width 300ms ease',
        }} />
      </div>
      <div style={{ fontSize: '9px', color: '#999', marginTop: '2px', fontFamily: 'monospace' }}>
        worst {fmt(meter.worst)} / required {fmt(meter.required)}
        {' '}({meter.headroom >= 0 ? `+${fmt(meter.headroom)} headroom` : `${fmt(-meter.headroom)} short`})
      </div>
    </div>
  )
}

/** Render one PredicateEngine violation record verbatim (facts, not prose). */
function violationLine(v) {
  if (v == null || typeof v !== 'object') return String(v)
  const { kind, ...rest } = v
  const detail = Object.entries(rest)
    .map(([k, val]) => `${k}=${typeof val === 'object' ? JSON.stringify(val) : val}`)
    .join(' ')
  return `${kind ?? 'violation'} ${detail}`
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}
