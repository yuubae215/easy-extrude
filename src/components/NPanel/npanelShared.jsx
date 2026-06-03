import { useRef } from 'react'

// ── Shared building blocks for NPanel components ──────────────────────────

export function Section({ title, children, noBorder = false }) {
  return (
    <div style={{
      padding: '8px 10px 6px',
      borderBottom: noBorder ? 'none' : '1px solid #3a3a3a',
    }}>
      <div style={{
        color: '#aaa',
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '6px',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// Read-only XYZ row
export function NumRow({ axis, color, value }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '18px 1fr',
      gap: '2px 4px',
      padding: '1px 0',
      alignItems: 'center',
    }}>
      <span style={{ color, fontWeight: 'bold', fontSize: '11px' }}>{axis}</span>
      <span style={{
        background: '#2a2a2a',
        border: '1px solid #333',
        borderRadius: '3px',
        padding: '2px 6px',
        color: '#888',
        fontSize: '12px',
        textAlign: 'right',
        fontFamily: 'monospace',
      }}>
        {value.toFixed(3)}
      </span>
    </div>
  )
}

// Editable XYZ row — calls onChange(value: number) on blur/Enter
export function EditRow({ axis, color, value, onChange }) {
  const inputRef = useRef(null)

  function handleBlur() {
    const v = parseFloat(inputRef.current.value)
    if (!isNaN(v)) onChange(v)
    inputRef.current.style.borderColor = '#444'
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { inputRef.current.blur(); e.stopPropagation() }
    if (e.key === 'Escape') { inputRef.current.value = value.toFixed(3); inputRef.current.blur(); e.stopPropagation() }
    e.stopPropagation()
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '18px 1fr',
      gap: '2px 4px',
      padding: '1px 0',
      alignItems: 'center',
    }}>
      <span style={{ color, fontWeight: 'bold', fontSize: '11px' }}>{axis}</span>
      <input
        ref={inputRef}
        type="number"
        step="0.001"
        defaultValue={value.toFixed(3)}
        key={value}
        onFocus={e => { e.target.style.borderColor = '#4fc3f7' }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#383838',
          border: '1px solid #444',
          borderRadius: '3px',
          padding: '2px 6px',
          color: '#e8e8e8',
          fontSize: '12px',
          textAlign: 'right',
          fontFamily: 'monospace',
          outline: 'none',
        }}
      />
    </div>
  )
}

// Controlled name input that fires callback on blur/Enter
export function NameInput({ name, onCommit }) {
  const inputRef = useRef(null)

  function handleBlur() {
    const val = inputRef.current.value.trim() || name
    onCommit?.(val)
    inputRef.current.style.borderColor = '#444'
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { inputRef.current.blur(); e.stopPropagation() }
    if (e.key === 'Escape') { inputRef.current.value = name; inputRef.current.blur(); e.stopPropagation() }
    e.stopPropagation()
  }

  return (
    <input
      ref={inputRef}
      type="text"
      key={name}
      defaultValue={name}
      onFocus={e => { e.target.style.borderColor = '#4fc3f7' }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: '#383838',
        border: '1px solid #444',
        borderRadius: '3px',
        padding: '3px 6px',
        color: '#e8e8e8',
        fontSize: '12px',
        fontFamily: 'sans-serif',
        outline: 'none',
      }}
    />
  )
}

export const AXIS_COLORS = { X: '#e05252', Y: '#6ab04c', Z: '#4a9eed' }

export const LINK_COLORS = {
  mounts:     '#22C55E',
  fastened:   '#10B981',
  aligned:    '#14B8A6',
  contains:   '#8B5CF6',
  above:      '#6366F1',
  adjacent:   '#64748B',
  connects:   '#06B6D4',
  references: '#F59E0B',
  represents: '#F43F5E',
  bounded_by: '#EF4444',
}
