import { useState, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { ICONS } from '../../view/UIView.js'

const TOOL_ITEMS = [
  { type: 'route',    label: '⟿', title: 'Route (経路)',      color: '#4A90D9' },
  { type: 'boundary', label: '⟿', title: 'Boundary (境界)',   color: '#E74C3C' },
  { type: 'zone',     label: '⬡', title: 'Zone (ゾーン)',     color: '#27AE60' },
  { type: 'hub',      label: '⬤', title: 'Hub (ハブ)',        color: '#F39C12' },
  { type: 'anchor',   label: '⬤', title: 'Anchor (アンカー)', color: '#9B59B6' },
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
  const actions     = useUIStore(s => s.actions)
  const [hoveredTool, setHoveredTool] = useState(null)
  const [inputValue,  setInputValue]  = useState('')

  // Reset input when pending state changes (new geometry placed)
  useEffect(() => {
    setInputValue(mapToolbar.pendingName ?? '')
  }, [mapToolbar.pendingName])

  if (!mapToolbar.visible) return null

  const { activeTool, pendingName, showConfirm, showCancel } = mapToolbar

  const hasPending = pendingName !== null
  const hasActionButtons = showConfirm || showCancel

  function handleInputChange(e) {
    const v = e.target.value
    setInputValue(v)
    actions.setMapPendingNameInput(v)
  }

  function handleInputKeyDown(e) {
    // Swallow all keys to prevent map mode shortcuts from firing while typing
    e.stopImmediatePropagation()
    if (e.key === 'Enter')  callbacks.onMapConfirm?.()
    if (e.key === 'Escape') callbacks.onMapCancel?.()
  }

  return (
    <div
      style={{
        position: 'fixed', top: '50%', left: '8px',
        transform: 'translateY(-50%)',
        background: '#1e1e2e', border: '1px solid #3a3a4a',
        borderRadius: '8px', padding: '6px',
        zIndex: 150, display: 'flex', flexDirection: 'column', gap: '4px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        userSelect: 'none', minWidth: '44px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
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

      {/* Separator before action buttons (pending state shows input first) */}
      {(hasPending || hasActionButtons) && SEP}

      {/* Name input — shown during pending state */}
      {hasPending && (
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={handleInputKeyDown}
          style={{
            width: '120px', height: '28px',
            background: '#12121c', border: '1px solid #4a90d9',
            borderRadius: '4px', color: '#e0e0e0',
            fontSize: '12px', padding: '0 6px', outline: 'none',
            boxSizing: 'border-box', alignSelf: 'stretch',
          }}
          // No autoFocus: prevents software keyboard on mobile (UIView ADR-031 comment)
        />
      )}

      {/* Confirm button */}
      {showConfirm && (
        <button
          title="Confirm (Enter)"
          onClick={() => callbacks.onMapConfirm?.()}
          style={{
            ...BTN_BASE,
            background: '#1a3a1a', border: '1.5px solid #4caf50', color: '#4caf50',
          }}
          dangerouslySetInnerHTML={{ __html: ICONS.confirm }}
        />
      )}

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
