import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { enterMotion } from '../../view/ChromeMath.js'
import { tourStepDescriptor, tourVisible } from '../../view/TourMath.js'
import { COLOR, Z, rgba } from '../../theme/tokens.js'

/**
 * TourCard — the desktop onboarding tour's quest card (ADR-065 Phase 6).
 *
 * Renders the open quest projected by the pure TourMath from `uiStore.tour`
 * (sole writer AppController). This component only reads and fires the
 * `onTourDismiss` callback — it never advances the tour itself (progress is
 * derived from committed scene facts, not from card clicks).
 *
 * Edge occupancy (#26): anchored to the bottom-left corner, offset past the
 * two persistent occupants — the Outliner (left 0–180, desktop-always) and
 * the InfoBar (bottom 0–26). Toasts live at bottom-CENTER, so they never
 * collide. An active overlay (Context / demo / template gallery) suppresses
 * the card entirely via `tourVisible` — it does not stack against them.
 *
 * Entry slide-fade is Tier A chrome motion ("a new quest arrived"), keyed on
 * the step so each advance re-plays it; reduced motion shows the card in
 * place (the information is the quest text, not the slide — #30/#11).
 */
export function TourCard() {
  const tour          = useUIStore(s => s.tour)
  const contextActive = useUIStore(s => s.context.active)
  const demoActive    = useUIStore(s => s.demo.active)
  const galleryOpen   = useUIStore(s => s.templateGalleryOpen)
  const callbacks     = useUIStore(s => s.callbacks)
  const reduced       = useReducedMotion()

  if (!tourVisible(tour, { contextActive, demoActive, galleryOpen })) return null
  const step = tourStepDescriptor(tour)
  const done = tour.status === 'done'
  if (!step && !done) return null

  const dismiss = () => callbacks.onTourDismiss?.()

  return (
    <div
      key={step?.id ?? 'done'}
      style={{
        position: 'fixed',
        left: 192,           // Outliner (180) + gutter — #26 offset past the occupant
        bottom: 38,          // InfoBar (26) + gutter
        width: 248,
        zIndex: Z.overlay,
        background: COLOR.bgPanel,
        border: `1px solid ${COLOR.border}`,
        borderLeft: `3px solid ${done ? COLOR.fxGreen : COLOR.accentActive}`,
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
          color: done ? COLOR.fxGreen : COLOR.accentActive, flex: 1,
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
                  ? COLOR.accentActive
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
      background: COLOR.bgButton,
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: '16px',
    }}>
      {children}
    </kbd>
  )
}
