import { useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { tierAMotion } from '../../view/ChromeMath.js'
import { COLOR, Z, rgba } from '../../theme/tokens.js'

/**
 * ProjectionToggle — the orthographic / perspective switch, parked directly
 * under the world orientation gizmo (ADR-103).
 *
 * ## Why it lives here and not in the header
 *
 * Projection is a property of HOW you are looking, and the gizmo is where
 * "how you are looking" already lives. The two are orthogonal — the gizmo owns
 * ORIENTATION, this owns PROJECTION — which is exactly why they belong side by
 * side rather than fused into one "Map" button. That fusion is the defect
 * ADR-103 removes: pressing one button used to change the orientation, the
 * projection, the toolbar and the top-level mode at once, so none of the four
 * could be chosen independently.
 *
 * The right-edge offset is NOT computed here. A screen edge is a shared
 * resource (原則 #26): `AppController._updateGizmoOffset()` is the one place
 * that knows which right-edge panels are open, and it drives both the gizmo and
 * this toggle from that single computation.
 */

const LABEL = {
  perspective:  { short: 'PERSP', title: 'Perspective projection — switch to orthographic' },
  orthographic: { short: 'ORTHO', title: 'Orthographic projection — switch to perspective' },
}

export function ProjectionToggle() {
  const projection = useUIStore(s => s.projection)
  const callbacks  = useUIStore(s => s.callbacks)
  const offset     = useUIStore(s => s.gizmoRightOffset)
  const reduced    = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  const isOrtho = projection === 'orthographic'
  const label   = LABEL[projection] ?? LABEL.perspective

  return (
    <button
      title={label.title}
      aria-label={label.title}
      aria-pressed={isOrtho}
      onClick={() => callbacks.onProjectionChange?.(isOrtho ? 'perspective' : 'orthographic')}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => { setHovered(false); setPressed(false) }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      style={{
        // 46px (gizmo top) + 128px (gizmo size) + 8px gap
        position:     'fixed',
        top:          '182px',
        right:        `${offset}px`,
        width:        '128px',
        padding:      '4px 0',
        background:   isOrtho ? rgba(COLOR.accent, 0.18) : 'rgba(24, 24, 40, 0.55)',
        border:       `1px solid ${isOrtho ? COLOR.accent : (hovered ? '#4a4a4a' : '#3a3a3a')}`,
        borderRadius: '6px',
        color:        isOrtho ? COLOR.accent : (hovered ? '#ccc' : '#aaa'),
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
