import { useState, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'

export function CanvasStatusPill() {
  const statusParts = useUIStore(s => s.statusParts)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  if (!isMobile || !statusParts.length) return null

  return (
    <div
      style={{
        position: 'fixed', left: '50%', bottom: '96px',
        transform: 'translateX(-50%)',
        background: 'rgba(20,20,20,0.75)', borderRadius: '14px',
        padding: '4px 14px',
        display: 'flex', alignItems: 'center', gap: '2px',
        fontSize: '12px', fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden', maxWidth: '90vw', whiteSpace: 'nowrap',
        zIndex: 91, pointerEvents: 'none',
      }}
    >
      {statusParts.map((part, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <span style={{ color: '#4a4a4a', margin: '0 4px' }}>·</span>}
          <span style={{
            color:      part.color ?? '#c8c8c8',
            fontWeight: part.bold  ? 'bold' : 'normal',
          }}>
            {part.text}
          </span>
        </span>
      ))}
    </div>
  )
}
