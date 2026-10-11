import { useUIStore } from '../../store/uiStore.js'
import { Z } from '../../theme/tokens.js'

/**
 * RobotMeshLoadingNotice — says why a newly placed arm is not on screen yet.
 *
 * A new arm stays HIDDEN while the realistic mesh loads rather than flashing the
 * skeleton first (ADR-150 D2), so something has to say why the base is empty
 * (原則 #11). That used to be the loading state of the realistic / lightweight
 * toggle under `ProjectionToggle`. ADR-164 D5 removed the toggle (the skeleton is
 * now only the automatic fallback), and this notice keeps the one job of it that
 * was not a choice: it is a STATEMENT, not a control, so it exists only while the
 * load is in flight — there is no slot to keep for an operation that does not
 * exist (原則 #15 is about controls).
 *
 * The right-edge offset is shared with the gizmo cluster (原則 #26) —
 * `AppController._updateGizmoOffset()` computes it once.
 */
export function RobotMeshLoadingNotice() {
  const loading = useUIStore(s => s.robotAppearanceLoading)
  const offset  = useUIStore(s => s.gizmoRightOffset)
  if (!loading) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="robot-mesh-loading"
      title="Loading the realistic UR5e mesh…"
      style={{
        // 182px (ProjectionToggle top) + ~20px (its height) + 8px gap
        position:      'fixed',
        top:           '210px',
        right:         `${offset}px`,
        width:         '128px',
        padding:       '4px 0',
        background:    'rgba(24, 24, 40, 0.55)',
        border:        '1px solid #3a3a3a',
        borderRadius:  '6px',
        color:         '#aaa',
        fontSize:      '10px',
        fontFamily:    'system-ui, -apple-system, sans-serif',
        letterSpacing: '0.08em',
        lineHeight:    '1',
        textAlign:     'center',
        zIndex:        String(Z.gizmo),
        userSelect:    'none',
        pointerEvents: 'none',
      }}
    >
      LOADING…
    </div>
  )
}
