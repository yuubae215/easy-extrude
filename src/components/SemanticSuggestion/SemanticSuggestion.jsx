import { useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'

const SEMANTIC_VERB = {
  above:    { color: '#94A3B8', verb: 'is above' },
  adjacent: { color: '#64748B', verb: 'is adjacent to' },
  contains: { color: '#8B5CF6', verb: 'contains' },
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

function getSemanticColor(type) {
  return SEMANTIC_VERB[type]?.color ?? SEMANTIC_COLOR[type] ?? '#94A3B8'
}

const isMobile = () => window.matchMedia('(pointer: coarse)').matches

export function SemanticSuggestion() {
  const semanticSuggestion      = useUIStore(s => s.semanticSuggestion)
  const dismissSemanticSuggestion = useUIStore(s => s.actions.dismissSemanticSuggestion)

  useEffect(() => {
    if (!semanticSuggestion) return
    const timer = setTimeout(() => dismissSemanticSuggestion(), 6000)
    return () => clearTimeout(timer)
  }, [semanticSuggestion])

  if (!semanticSuggestion) return null

  const { suggestion, onAccept } = semanticSuggestion
  const color  = getSemanticColor(suggestion.semanticType)
  const verb   = SEMANTIC_VERB[suggestion.semanticType]?.verb ?? suggestion.label?.toLowerCase() ?? suggestion.semanticType
  const bottom = isMobile() ? '104px' : '72px'

  const handleAccept = () => {
    dismissSemanticSuggestion()
    onAccept()
  }

  return (
    <div style={{
      position: 'fixed',
      bottom,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(24,24,28,0.93)',
      backdropFilter: 'blur(12px)',
      borderLeft: `3px solid ${color}`,
      borderRadius: '10px',
      padding: '9px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      whiteSpace: 'nowrap',
      boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
      zIndex: 9998,
      fontSize: '12px',
      pointerEvents: 'auto',
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }} />
      <span style={{ color: '#aaa' }}>
        <span style={{ fontWeight: 600, color: '#e8e8e8' }}>{suggestion.sourceName}</span>
        {' '}{verb}{' '}
        <span style={{ fontWeight: 600, color: '#e8e8e8' }}>{suggestion.targetName}</span>
      </span>
      <button
        onClick={handleAccept}
        style={{
          background: color,
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          padding: '4px 10px',
          fontWeight: 600,
          fontSize: '11px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Link ({suggestion.label})
      </button>
      <button
        onClick={dismissSemanticSuggestion}
        style={{
          background: 'none',
          border: 'none',
          color: '#555',
          fontSize: '16px',
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
