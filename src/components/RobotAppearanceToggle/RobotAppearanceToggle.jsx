import { useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { tierAMotion } from '../../view/ChromeMath.js'
import { COLOR, Z, rgba } from '../../theme/tokens.js'

/**
 * RobotAppearanceToggle — the realistic / lightweight switch for the UR5e's
 * drawn geometry, parked directly under `ProjectionToggle` (ADR-149).
 *
 * ## Why it lives here and not in the header
 *
 * Same reasoning as `ProjectionToggle` (ADR-103): this is a view-rendering
 * SETTING, not a mode, and the two toggles already parked at the gizmo's edge
 * are exactly the "how you are looking" cluster this belongs to.
 *
 * ## Why a two-state toggle, not a one-way "lighten" button
 *
 * The scene's default became `realistic` in ADR-149 specifically so the first
 * look shows the real UR5e mesh. A one-way "lighten" button would remove the
 * only UI path back to `realistic` once pressed — exactly the discoverability
 * defect (原則 #16) this ADR closes, just moved to the other direction.
 *
 * The right-edge offset is NOT computed here (原則 #26 — a screen edge is a
 * shared resource): `AppController._updateGizmoOffset()` drives every
 * right-edge panel, including this one, from one computation.
 *
 * ## Optimistic display, corrected on failure
 *
 * `RobotStageSet.setRenderStyle()` (ADR-148) writes its OWN declaration
 * optimistically before awaiting the mesh fetch, rolling back only if every
 * stage's load fails. `AppController` mirrors that same optimism into
 * `uiStore.robotAppearance` on click, and corrects it back (plus a toast —
 * 原則 #11) if the load is rejected — see `AppController`'s
 * `onRobotAppearanceChange` wiring.
 */

const LABEL = {
  realistic: { short: 'REAL', title: 'Realistic UR5e mesh — switch to lightweight skeleton' },
  skeleton:  { short: 'LITE', title: 'Lightweight skeleton — switch to realistic UR5e mesh' },
}

export function RobotAppearanceToggle() {
  const appearance = useUIStore(s => s.robotAppearance)
  const callbacks   = useUIStore(s => s.callbacks)
  const offset      = useUIStore(s => s.gizmoRightOffset)
  const reduced     = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  const isLite = appearance === 'skeleton'
  const label  = LABEL[appearance] ?? LABEL.realistic

  return (
    <button
      title={label.title}
      aria-label={label.title}
      aria-pressed={isLite}
      onClick={() => callbacks.onRobotAppearanceChange?.(isLite ? 'realistic' : 'skeleton')}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => { setHovered(false); setPressed(false) }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      style={{
        // 182px (ProjectionToggle top) + ~20px (this pill's own height) + 8px gap
        position:     'fixed',
        top:          '210px',
        right:        `${offset}px`,
        width:        '128px',
        padding:      '4px 0',
        background:   isLite ? rgba(COLOR.accent, 0.18) : 'rgba(24, 24, 40, 0.55)',
        border:       `1px solid ${isLite ? COLOR.accent : (hovered ? '#4a4a4a' : '#3a3a3a')}`,
        borderRadius: '6px',
        color:        isLite ? COLOR.accent : (hovered ? '#ccc' : '#aaa'),
        cursor:       'pointer',
        fontSize:     '10px',
        fontFamily:   'system-ui, -apple-system, sans-serif',
        letterSpacing: '0.08em',
        lineHeight:   '1',
        zIndex:       String(Z.gizmo),
        userSelect:   'none',
        pointerEvents: 'auto',
        ...tierAMotion({ hovered, pressed, reduced }),
      }}
    >
      {label.short}
    </button>
  )
}
