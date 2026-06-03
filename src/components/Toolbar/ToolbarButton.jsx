/**
 * ToolbarButton — one slot in the mobile toolbar.
 *
 * Matches the visual spec from UIView.setMobileToolbar() exactly:
 * - indicator: read-only info chip (light blue tint)
 * - active:    currently active action (blue tint + border)
 * - danger:    destructive action (red tint)
 * - disabled:  greyed-out, no pointer events
 * - spacer:    invisible flex placeholder keeping slot count fixed (ADR-024)
 */
export function ToolbarButton({ icon, label, onClick, active = false, danger = false, disabled = false, indicator = false }) {
  const bg     = indicator ? 'rgba(79,195,247,0.06)'  : disabled ? 'transparent'              : active ? 'rgba(79,195,247,0.15)' : danger ? 'rgba(192,57,43,0.18)'  : 'rgba(255,255,255,0.06)'
  const border = indicator ? 'rgba(79,195,247,0.18)'  : disabled ? 'rgba(255,255,255,0.06)'   : active ? 'rgba(79,195,247,0.5)'  : danger ? 'rgba(231,76,60,0.5)'   : 'rgba(255,255,255,0.12)'
  const color  = indicator ? '#4fc3f7'                : disabled ? '#484848'                  : active ? '#4fc3f7'               : danger ? '#e74c3c'                : '#d8d8d8'

  const Tag = indicator ? 'div' : 'button'

  function handleClick(e) {
    if (!disabled && !indicator && onClick) onClick(e)
  }

  return (
    <Tag
      onClick={handleClick}
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
        cursor:           indicator || disabled ? 'default' : 'pointer',
        lineHeight:       '1',
        fontFamily:       'system-ui, -apple-system, sans-serif',
        userSelect:       'none',
        WebkitUserSelect: 'none',
        transition:       'background 0.15s, border-color 0.15s',
        overflow:         'hidden',
        pointerEvents:    'auto',
      }}
    >
      <IconSlot icon={icon} />
      <span style={{
        fontSize:      '9px',
        fontWeight:    '500',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        opacity:       (disabled && !indicator) ? '0.35' : '0.7',
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
