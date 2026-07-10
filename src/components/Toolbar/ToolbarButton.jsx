import { COLOR, rgba } from '../../theme/tokens.js'
import { tierAMotion, activeGlow, lockedStyle } from '../../view/ChromeMath.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { useHoverPress } from '../Chrome/ChromePrimitives.jsx'

/**
 * ToolbarButton — one slot in the mobile toolbar.
 *
 * Matches the visual spec from UIView.setMobileToolbar() exactly:
 * - indicator: read-only info chip (light blue tint)
 * - active:    currently active action (blue tint + border + breathing glow —
 *              Tier A "this mode is engaged", ADR-065 Phase 3)
 * - danger:    destructive action (red tint)
 * - disabled:  stylized LOCKED state (dashed border, legible label); a tap
 *              surfaces the gate predicate's reason via `onLockedTap(reason)`
 *              — disabled-as-quest, never a silent no-op (PHILOSOPHY #11)
 * - spacer:    invisible flex placeholder keeping slot count fixed (ADR-024)
 *
 * Press feedback is the Tier A spring (`tierAMotion`); under reduced motion
 * the movement drops and the colour states remain the static cue.
 */
export function ToolbarButton({
  icon, label, onClick,
  active = false, danger = false, disabled = false, indicator = false,
  reason = null, onLockedTap = null,
}) {
  const reduced = useReducedMotion()
  const { pressed, handlers } = useHoverPress()

  const bg     = indicator ? rgba(COLOR.accentActive, 0.06) : disabled ? 'transparent'              : active ? rgba(COLOR.accentActive, 0.15) : danger ? 'rgba(192,57,43,0.18)'  : 'rgba(255,255,255,0.06)'
  const border = indicator ? rgba(COLOR.accentActive, 0.18) : disabled ? 'rgba(255,255,255,0.14)'   : active ? rgba(COLOR.accentActive, 0.5)  : danger ? 'rgba(231,76,60,0.5)'   : 'rgba(255,255,255,0.12)'
  const color  = indicator ? COLOR.accentActive             : disabled ? '#6a6a6a'                  : active ? COLOR.accentActive             : danger ? '#e74c3c'                : '#d8d8d8'

  const Tag = indicator ? 'div' : 'button'
  const interactive = !indicator && !disabled

  // Merge the Tier A press-spring transition with the colour transitions —
  // a plain spread would let one overwrite the other.
  const motion = interactive ? tierAMotion({ pressed, reduced }) : {}
  const transition = [motion.transition, 'background 0.15s, border-color 0.15s']
    .filter(Boolean).join(', ')

  function handleClick(e) {
    if (indicator) return
    if (disabled) {
      // disabled-as-quest (ADR-065 named rule 5): a locked control explains
      // its gate instead of silently swallowing the tap.
      if (reason && onLockedTap) onLockedTap(reason)
      return
    }
    onClick?.(e)
  }

  return (
    <Tag
      onClick={handleClick}
      aria-disabled={disabled || undefined}
      title={disabled && reason ? reason : undefined}
      {...(interactive ? handlers : {})}
      style={{
        display:          'flex',
        flexDirection:    'column',
        alignItems:       'center',
        justifyContent:   'center',
        gap:              '3px',
        padding:          '6px 4px',
        flex:             '1 0 0',
        minHeight:        '48px',
        background:       bg,
        border:           `1px solid ${border}`,
        borderRadius:     '10px',
        color,
        cursor:           indicator ? 'default' : disabled ? 'help' : 'pointer',
        lineHeight:       '1',
        fontFamily:       'system-ui, -apple-system, sans-serif',
        userSelect:       'none',
        WebkitUserSelect: 'none',
        overflow:         'hidden',
        pointerEvents:    'auto',
        transition,
        ...(disabled && !indicator ? lockedStyle() : {}),
        ...(motion.transform ? { transform: motion.transform } : {}),
        ...activeGlow(interactive && active, reduced),
      }}
    >
      <IconSlot icon={icon} />
      <span style={{
        fontSize:      '9px',
        fontWeight:    '500',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        opacity:       (disabled && !indicator) ? '0.55' : '0.7',
        width:         '100%',
        textAlign:     'center',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        whiteSpace:    'nowrap',
      }}>
        {label}
      </span>
    </Tag>
  )
}

function IconSlot({ icon }) {
  const style = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '20px', height: '20px',
  }
  if (typeof icon === 'string' && icon.startsWith('<svg')) {
    return <span style={style} dangerouslySetInnerHTML={{ __html: icon }} />
  }
  return <span style={{ ...style, fontSize: '18px' }}>{icon}</span>
}
