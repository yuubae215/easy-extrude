import { useEffect, useRef } from 'react'
import { useUIStore } from '../../store/uiStore.js'

export function ContextMenu() {
  const contextMenu    = useUIStore(s => s.contextMenu)
  const hideContextMenu = useUIStore(s => s.actions.hideContextMenu)
  const ref = useRef(null)

  useEffect(() => {
    if (!contextMenu) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        hideContextMenu()
      }
    }
    setTimeout(() => document.addEventListener('pointerdown', onDown), 0)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [contextMenu])

  if (!contextMenu) return null

  const W = window.innerWidth
  const H = window.innerHeight
  const estimatedH = contextMenu.items.length * 44 + 8
  const left = Math.max(8, Math.min(contextMenu.x - 80, W - 180))
  const top  = Math.max(48,
    contextMenu.y - estimatedH - 12 < 40
      ? contextMenu.y + 12
      : contextMenu.y - estimatedH - 12,
  )

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        background: '#2b2b2b',
        border: '1px solid #555',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        minWidth: '160px',
        overflow: 'hidden',
        zIndex: 400,
        paddingTop: '4px',
        paddingBottom: '4px',
        pointerEvents: 'auto',
      }}
    >
      {contextMenu.items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            hideContextMenu()
            item.onClick()
          }}
          style={{
            display: 'block',
            width: '100%',
            padding: '13px 18px',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            color: item.danger ? '#e74c3c' : '#e8e8e8',
            fontSize: '14px',
            cursor: 'pointer',
            borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}
          onPointerEnter={e => { e.currentTarget.style.background = '#3a3a3a' }}
          onPointerLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
