import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { enterMotion } from '../../view/ChromeMath.js'
import { tourStepDescriptor, tourVisible } from '../../view/TourMath.js'
import { SCREEN_CLAIM, stageIs } from '../../view/ScreenClaim.js'
import { COLOR, Z, rgba } from '../../theme/tokens.js'
import { BOTTOM_TIER, bottomEdgeOffset, leftEdgeOffset } from '../../view/EdgeOccupancy.js'

/**
 * TourCard — the desktop onboarding tour's quest card (ADR-065 Phase 6).
 *
 * Renders the open quest projected by the pure TourMath from `uiStore.tour`
 * (sole writer AppController). This component only reads and fires the
 * `onTourDismiss` callback — it never advances the tour itself (progress is
 * derived from committed scene facts, not from card clicks).
 *
 * Edge occupancy (#26): anchored to the bottom-left corner, offset past the
 * persistent occupants. Both offsets come from `view/EdgeOccupancy.js`, the one
 * owner of each edge — this file used to cite #26 in a comment while writing
 * `left: 192` and `bottom: 38` as literals, which is precisely the shape the
 * principle forbids (a comment is not a computation; the two drift). Toasts live
 * at bottom-CENTER, so they never collide. An active overlay (Context / demo /
 * template gallery) suppresses the card entirely via `tourVisible` — it does not
 * stack against them, which is also why `floorOpen` is not passed here.
 *
 * Entry slide-fade is Tier A chrome motion ("a new quest arrived"), keyed on
 * the step so each advance re-plays it; reduced motion shows the card in
 * place (the information is the quest text, not the slide — #30/#11).
 */
export function TourCard() {
  const tour          = useUIStore(s => s.tour)
  const contextActive = useUIStore(s => s.context.active)
  const demoActive    = useUIStore(s => s.demo.active)
  // Both "is a full-screen starting point up?" questions read the ONE stage
  // claim (ADR-113) instead of two independent flags.
  const galleryOpen   = useUIStore(s => stageIs(s.stage, SCREEN_CLAIM.CONTEXT_TEMPLATE_GALLERY))
  const homeOpen      = useUIStore(s => stageIs(s.stage, SCREEN_CLAIM.LAUNCH_HOME))
  const callbacks     = useUIStore(s => s.callbacks)
  const reduced       = useReducedMotion()

  if (!tourVisible(tour, { contextActive, demoActive, galleryOpen, homeOpen })) return null
  const step = tourStepDescriptor(tour)
  const done = tour.status === 'done'
  if (!step && !done) return null

  const dismiss = () => callbacks.onTourDismiss?.()

  return (
    <div
      key={step?.id ?? 'done'}
      style={{
        position: 'fixed',
        left: leftEdgeOffset({ isMobile: false }),   // desktop-only card (ADR-065 Phase 6)
        bottom: bottomEdgeOffset({ isMobile: false, tier: BOTTOM_TIER.FLOATING }),
        width: 248,
        zIndex: Z.overlay,
        background: COLOR.surface,
        border: `1px solid ${COLOR.border}`,
        borderLeft: `3px solid ${done ? COLOR.factTone : COLOR.accent}`,
        borderRadius: 6,
        padding: '10px 12px',
        color: COLOR.textPrimary,
        fontFamily: 'sans-serif',
        fontSize: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        pointerEvents: 'auto',
        userSelect: 'none',
        ...enterMotion(reduced),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: done ? COLOR.factTone : COLOR.accent, flex: 1,
        }}>
          {done ? 'Tour complete' : `Getting started · ${step.index}/${step.total}`}
        </span>
        <button
          onClick={dismiss}
          aria-label={done ? 'Close tour' : 'Skip tour'}
          title={done ? 'Close' : 'Skip tour'}
          style={{
            background: 'none', border: 'none', color: COLOR.textSecondary,
            cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px',
          }}
        >
          ✕
        </button>
      </div>

      {done ? (
        <div style={{ marginTop: 6, lineHeight: 1.5 }}>
          You know the core loop — add, move, edit, extrude. The rest is
          discoverable from here.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 6, fontWeight: 'bold', fontSize: 13 }}>
            {step.title}
          </div>
          <div style={{ marginTop: 4, lineHeight: 1.5, color: '#c9c9c9' }}>
            {step.text}
            {step.keys.map(k => <Kbd key={k}>{k}</Kbd>)}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
            {Array.from({ length: step.total }, (_, i) => (
              <span key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i < step.index
                  ? COLOR.accent
                  : rgba(COLOR.textSecondary, 0.35),
              }} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Kbd({ children }) {
  return (
    <kbd style={{
      display: 'inline-block',
      margin: '0 0 0 5px',
      padding: '0 5px',
      border: `1px solid ${COLOR.border}`,
      borderBottomWidth: 2,
      borderRadius: 3,
      background: COLOR.surfaceRaised,
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: '16px',
    }}>
      {children}
    </kbd>
  )
}
