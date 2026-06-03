import { useUIStore } from '../../store/uiStore.js'

export function ExtrusionLabel() {
  const label = useUIStore(s => s.extrusionLabel)
  if (!label) return null

  return (
    <div style={{
      position: 'fixed',
      left: `${label.x}px`,
      top: `${label.y}px`,
      transform: 'translate(-50%, -50%)',
      color: '#ffffff',
      fontSize: '13px',
      fontFamily: 'monospace',
      background: 'rgba(0,0,0,0.72)',
      padding: '3px 10px',
      borderRadius: '4px',
      border: '1px solid rgba(255,255,255,0.45)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      zIndex: 150,
    }}>
      {label.text}
    </div>
  )
}
