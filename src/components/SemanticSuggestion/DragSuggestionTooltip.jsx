import { useUIStore } from '../../store/uiStore.js'

const COLOR_MAP = {
  above:    '#6366F1',
  adjacent: '#64748B',
  contains: '#8B5CF6',
}
const SEMANTIC_COLOR = {
  mounts:     '#22C55E',
  fastened:   '#10B981',
  aligned:    '#14B8A6',
  connects:   '#06B6D4',
  references: '#F59E0B',
  represents: '#F43F5E',
  bounded_by: '#EF4444',
}

function getColor(type) {
  return COLOR_MAP[type] ?? SEMANTIC_COLOR[type] ?? '#94A3B8'
}

const isMobile = () => window.matchMedia('(pointer: coarse)').matches

export function DragSuggestionTooltip() {
  const dragTooltip = useUIStore(s => s.dragTooltip)

  if (!dragTooltip) return null

  const { suggestion } = dragTooltip
  const color  = getColor(suggestion.semanticType)
  const bottom = isMobile() ? '120px' : '88px'

  return (
    <div style={{
      position: 'fixed',
      bottom,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(15,23,42,0.88)',
      backdropFilter: 'blur(8px)',
      borderLeft: `3px solid ${color}`,
      borderRadius: '8px',
      padding: '6px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 9997,
      fontSize: '13px',
      color: '#e8e8e8',
    }}>
      <span style={{
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }} />
      <span>{suggestion.label}</span>
      <kbd style={{
        background: '#334155',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'monospace',
      }}>↵</kbd>
      <span style={{ color: '#94a3b8' }}>to link</span>
    </div>
  )
}
