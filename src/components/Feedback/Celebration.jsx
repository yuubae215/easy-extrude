import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion, usePrevOnChange } from './FeedbackPrimitives.jsx'
import { checkStatusKeys } from '../../view/CheckFeedbackMath.js'
import { pickCelebration } from '../../view/CelebrationMath.js'
import { COLOR, DURATION, rgba } from '../../theme/tokens.js'

/**
 * Celebration — the DOM burst for a "won moment" (ADR-065 Phase 4, Widening 2;
 * named rule 4).
 *
 * DISCIPLINE:
 *   - Input is always a fact TRANSITION between two committed snapshots
 *     (validator conflicts → ∅, projectForm questions → ∅, checkResults →
 *     all pass) decided by the pure `pickCelebration`. Initial load fires
 *     nothing (prev = null); malformed snapshots fire nothing (#11).
 *   - Budget: at most ONE concurrent celebration, enforced STRUCTURALLY —
 *     the overlay mounts one `<ContextCelebration>` which watches all three
 *     fact lists and renders one descriptor. This survives tab switches
 *     (a panel-local watcher would lose its history on unmount), which is why
 *     the wiring sits at the overlay root, not inside ChecksPanel/ConflictMatrix.
 *   - Transient + component-local: the previous snapshots live in
 *     `usePrevOnChange` React state; nothing is persisted anywhere, nothing
 *     rides the wire.
 *   - Reduced motion: a static glowing banner with the same label — the
 *     information ("you just cleared everything") is preserved, only the
 *     spectacle is dropped (PHILOSOPHY #30 / #11). It holds until the next
 *     fact change, like the LandingFlash static tint precedent.
 */

const CELEBRATION_CSS = `
@keyframes eaCelebrateBanner {
  0%   { transform: scale(0.7);  opacity: 0; }
  12%  { transform: scale(1.08); opacity: 1; }
  22%  { transform: scale(1);    opacity: 1; }
  80%  { transform: scale(1);    opacity: 1; }
  100% { transform: scale(0.96); opacity: 0; }
}
@keyframes eaCelebrateParticle {
  0%   { transform: translate(0, 0) scale(1); opacity: 0.95; }
  100% { transform: translate(var(--ea-dx), var(--ea-dy)) scale(0.4); opacity: 0; }
}
`

/** Mount once per overlay root (FeedbackDefs pattern — duplicates are harmless). */
export function CelebrationDefs() {
  return <style>{CELEBRATION_CSS}</style>
}

/**
 * Presentational one-shot burst. Replays when `tick` changes while a
 * descriptor is present (LandingFlash key-remount pattern). Positioned
 * absolutely over the parent (which must be `position: relative|fixed`);
 * pointer-events pass through.
 */
export function CelebrationBurst({ descriptor, tick }) {
  const reduced = useReducedMotion()
  if (!descriptor) return null
  const { label, color, particles, durationMs } = descriptor

  const banner = (
    <div style={{
      padding: '6px 14px', borderRadius: '14px',
      background: rgba(COLOR.bgPanel, 0.92),
      border: `1px solid ${color}`,
      boxShadow: `0 0 14px ${rgba(color, 0.55)}`,
      color, fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap',
      ...(reduced ? {} : { animation: `eaCelebrateBanner ${durationMs}ms ease-out both` }),
    }}>
      ✓ {label}
    </div>
  )

  return (
    <div key={tick ?? 'idle'} style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', overflow: 'hidden', zIndex: 1,
    }}>
      {banner}
      {!reduced && Array.from({ length: particles }, (_, i) => {
        // Deterministic radial fan (no Math.random — replays identically).
        const angle = (i / particles) * 2 * Math.PI
        const dist  = 60 + (i % 3) * 22
        return (
          <span key={i} style={{
            position: 'absolute',
            width: '6px', height: '6px', borderRadius: '50%',
            background: color,
            '--ea-dx': `${Math.cos(angle) * dist}px`,
            '--ea-dy': `${Math.sin(angle) * dist - 18}px`,
            animation: `eaCelebrateParticle ${Math.round(durationMs * 0.55)}ms ease-out both`,
          }} />
        )
      })}
    </div>
  )
}

/**
 * The production overlay's single celebration watcher: reads the three fact
 * lists from the `context` slice, keeps their previous snapshots component-
 * local, and renders at most one burst per re-projection (priority lives in
 * the pure `pickCelebration`).
 */
export function ContextCelebration() {
  const conflicts = useUIStore(s => s.context.conflicts)
  const form      = useUIStore(s => s.context.form)
  const checks    = useUIStore(s => s.context.checks)

  const liveConflictRefs = (conflicts ?? []).filter(c => !c.resolvedBy).map(c => c.ref)
  const questionRefs     = (form ?? []).map(q => q.ref)
  const checkKeys        = checkStatusKeys(checks)

  const conflictHist = usePrevOnChange(liveConflictRefs)
  const questionHist = usePrevOnChange(questionRefs)
  const checkHist    = usePrevOnChange(checkKeys)

  const descriptor = pickCelebration({
    checks:    { prev: checkHist.prev,    cur: checkKeys },
    conflicts: { prev: conflictHist.prev, cur: liveConflictRefs },
    questions: { prev: questionHist.prev, cur: questionRefs },
  })

  // Key the burst on the WINNING fact's own tick (not a combined one): a
  // `usePrevOnChange` prev persists until its list next changes, so the
  // descriptor can stay truthy across UNRELATED re-projections — a combined
  // tick would then remount and dishonestly replay a stale win. The winning
  // list's own tick changes exactly when that transition landed (and its next
  // change resets prev to the emptied state, turning the predicate false), so
  // this key replays once per real win.
  const winTick =
    descriptor?.kind === 'all-green'         ? checkHist.tick :
    descriptor?.kind === 'conflicts-cleared' ? conflictHist.tick :
    descriptor?.kind === 'questions-cleared' ? questionHist.tick : null
  return <CelebrationBurst descriptor={descriptor} tick={`${descriptor?.kind}:${winTick}`} />
}
