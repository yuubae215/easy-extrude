import { useUIStore } from '../../store/uiStore.js'
import { COLOR } from '../../theme/tokens.js'
import { DISCOVERY_KIND, discoveryDeclaration } from '../../context/DiscoverySummary.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { tierAMotion } from '../../view/ChromeMath.js'
import { useHoverPress } from './ChromePrimitives.jsx'

/**
 * DiscoveryCounters — the discovery aggregate, **outside the floor** (ADR-105 D1).
 *
 * ## Why this component exists at all
 *
 * `agendaCounters()` has been correct since ADR-104 D4. Its only renderer used to
 * be `AgendaPanel`, which lives inside `ContextLayer`, which begins with
 * `if (!ctx.active) return null`. The counter that tells you whether you need to
 * enter the floor did not exist unless you had already entered it — the circular
 * dependency `02-grouping-criteria.md` named, in code.
 *
 * So the aggregate moved out here, and this renderer **must not read `ctx.active`**
 * (the census `DiscoveryOutsideTheFloor.test.js` fails if it ever does). The axis
 * it reads is whether a document was adopted, which arrives already decided in the
 * union's `kind` — this component does not re-derive it.
 *
 * ## The three zeroes (ADR-105 D2)
 *
 * `unexamined` is a first-class branch, not `0 0 0`. Showing three zeroes before a
 * document exists would promote a lie to a permanent screen position. Unexamined is
 * **not a failure** — it is the normal state at boot (ADR-089's home screen is
 * document-less by design) — so it is drawn in the quiet role, never in caution.
 *
 * Both branches name their exit (PHILOSOPHY #11): unexamined opens the template
 * gallery (adopt a document), counted opens the floor (settle what is open).
 */

/** The three counters' presentation. Moved here from `AgendaPanel` (D1). */
const COUNTER_META = [
  { key: 'conflicts', glyph: '≈', label: 'conflicts',    hint: 'Derived from the document every time it is validated — never stored. Ignoring one does not make it go away.' },
  { key: 'agenda',    glyph: '⚑', label: 'on the floor', hint: 'Tabled conflicts plus live proposals. Ignoring a proposal simply leaves the current value standing.' },
  { key: 'unowned',   glyph: '◇', label: 'unowned',      hint: 'Claims nobody has declared an owner for. Until someone does, changing them can only be proposed.' },
]

const TONE = {
  quiet: COLOR.textSecondary,
  live:  COLOR.textPrimary,
}

export function DiscoveryCounters({ compact = false }) {
  const discovery = useUIStore(s => s.context.discovery)
  const callbacks = useUIStore(s => s.callbacks)
  const reduced   = useReducedMotion()
  const { hovered, pressed, handlers } = useHoverPress()

  // Throws on an undeclared kind — a new branch cannot reach the screen without a
  // declaration next to the others (PHILOSOPHY #31 / the EXPLICIT_DEFAULTS rule).
  const decl = discoveryDeclaration(discovery)
  const unexamined = discovery.kind === DISCOVERY_KIND.UNEXAMINED

  const onClick = unexamined
    ? callbacks.onOpenTemplateGallery
    : callbacks.onContextNegotiate

  return (
    <button
      onClick={() => onClick?.()}
      title={`${decl.headline} — ${decl.detail}${decl.exit ? `\n→ ${decl.exit}` : ''}`}
      aria-label={unexamined ? 'Unexamined — adopt a context document' : 'Open the floor'}
      {...handlers}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           compact ? '6px' : '10px',
        padding:       '3px 8px',
        background:    hovered ? 'rgba(255,255,255,0.07)' : 'transparent',
        border:        `1px solid ${hovered ? COLOR.surfaceRaised : COLOR.border}`,
        borderRadius:  '5px',
        cursor:        'pointer',
        fontSize:      '11px',
        fontFamily:    'system-ui, -apple-system, sans-serif',
        lineHeight:    '1',
        flexShrink:    '0',
        pointerEvents: 'auto',
        ...tierAMotion({ hovered, pressed, reduced }),
      }}
    >
      {unexamined ? (
        // The honest word, not a number. "Not measured yet" and "measured, found
        // nothing" have different next moves, so they must not look alike.
        <span style={{ color: TONE.quiet, whiteSpace: 'nowrap' }}>
          <span style={{ marginRight: '5px' }}>◌</span>
          {compact ? 'Unexamined' : 'Unexamined — no context adopted'}
        </span>
      ) : (
        COUNTER_META.map(c => (
          <span key={c.key} title={c.hint} style={{ color: TONE.live, whiteSpace: 'nowrap' }}>
            <span style={{ color: TONE.quiet }}>{c.glyph}</span>{' '}
            {/* 0 is printed. A counter that disappears at zero cannot be told
                apart from a counter nobody wired up (PHILOSOPHY #31). */}
            <strong style={{ color: discovery[c.key] > 0 ? TONE.live : TONE.quiet }}>
              {discovery[c.key]}
            </strong>
            {!compact && <span style={{ color: TONE.quiet }}>{' '}{c.label}</span>}
          </span>
        ))
      )}
    </button>
  )
}
