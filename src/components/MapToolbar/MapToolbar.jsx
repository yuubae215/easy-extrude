import { useState, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { ICONS } from '../../view/UIView.js'

const TOOL_ITEMS = [
  { type: 'route',    label: '⟿', title: 'Route',    color: '#4A90D9' },
  { type: 'boundary', label: '⟿', title: 'Boundary', color: '#E74C3C' },
  { type: 'zone',     label: '⬡', title: 'Zone',     color: '#27AE60' },
  { type: 'hub',      label: '⬤', title: 'Hub',      color: '#F39C12' },
  { type: 'anchor',   label: '⬤', title: 'Anchor',   color: '#9B59B6' },
]

const SEP = (
  <div style={{ height: '1px', background: '#3a3a4a', margin: '2px 0' }} />
)

const BTN_BASE = {
  width: '36px', height: '36px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '16px', lineHeight: '1',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.1s',
  padding: 0,
}

export function MapToolbar() {
  const mapToolbar  = useUIStore(s => s.mapToolbar)
  const callbacks   = useUIStore(s => s.callbacks)
  const [hoveredTool, setHoveredTool] = useState(null)
  const isMobile    = useIsMobile()

  if (!mapToolbar.visible) return null

  // ADR-073: no name input / Confirm — map objects create immediately.
  const { activeTool, showCancel } = mapToolbar

  return (
    <div
      style={{
        // Desktop: the Outliner (180px, opaque) owns the left edge — sit beside
        // it (PHILOSOPHY #26). Mobile: the Outliner is a drawer, the edge is free.
        position: 'fixed', top: '50%', left: isMobile ? '8px' : '188px',
        transform: 'translateY(-50%)',
        background: '#1e1e2e', border: '1px solid #3a3a4a',
        borderRadius: '8px', padding: '6px',
        zIndex: 150, display: 'flex', flexDirection: 'column', gap: '4px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        userSelect: 'none', minWidth: '44px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        pointerEvents: 'auto',
      }}
    >
      {/* Tool buttons — always rendered, never removed to prevent layout shift */}
      {TOOL_ITEMS.map(({ type, label, title, color }) => {
        const isActive  = activeTool === type
        const isHovered = hoveredTool === type && !isActive
        return (
          <button
            key={type}
            title={title}
            onClick={() => callbacks.onMapToolSelect?.(type)}
            onMouseEnter={() => setHoveredTool(type)}
            onMouseLeave={() => setHoveredTool(null)}
            style={{
              ...BTN_BASE,
              background: isActive  ? color + '33'
                        : isHovered ? color + '22'
                        : 'transparent',
              border:  isActive ? `1.5px solid ${color}` : '1.5px solid transparent',
              color,
            }}
          >
            {label}
          </button>
        )
      })}

      {/* Separator before Cancel (only while a tool is active) */}
      {showCancel && SEP}

      {/* Cancel button */}
      {showCancel && (
        <button
          title="Cancel (Escape)"
          onClick={() => callbacks.onMapCancel?.()}
          style={{
            ...BTN_BASE,
            background: '#3a1a1a', border: '1.5px solid #e74c3c', color: '#e74c3c',
          }}
          dangerouslySetInnerHTML={{ __html: ICONS.cancel }}
        />
      )}

      {/* Separator before Exit (always present) */}
      {SEP}

      {/* Exit button */}
      <button
        title="Exit Map Mode"
        onClick={() => callbacks.onMapExit?.()}
        style={{
          ...BTN_BASE,
          background: 'transparent', border: '1.5px solid #555',
          color: '#aaa', fontSize: '10px',
        }}
        dangerouslySetInnerHTML={{ __html: ICONS.back }}
      />
    </div>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}
