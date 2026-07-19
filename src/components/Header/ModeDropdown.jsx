import { useState, useRef, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { popoverEnterMotion, itemEnterMotion } from '../../view/ChromeMath.js'
import { DURATION, EASING } from '../../theme/tokens.js'

const MODES = [
  { label: 'Object Mode', value: 'object', hint: 'Tab' },
  { label: 'Edit Mode',   value: 'edit',   hint: 'Tab' },
]

/**
 * ModeDropdown — mode selector button + fixed-position dropdown.
 *
 * The dropdown is rendered at document-level coordinates (position:fixed) to
 * escape the header's overflow:hidden — matching UIView's _modeDropdownEl pattern
 * (CODE_CONTRACTS "Mobile Header Overflow").
 */
export function ModeDropdown() {
  const mode      = useUIStore(s => s.mode)
  const callbacks = useUIStore(s => s.callbacks)
  const [open, setOpen]   = useState(false)
  const [dropPos, setDropPos] = useState({ top: 42, left: 0 })
  const reduced = useReducedMotion()
  const btnRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (btnRef.current && !btnRef.current.closest('[data-mode-selector]')?.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  function handleToggle(e) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setDropPos({ top: rect.bottom + 2, left: rect.left })
    }
    setOpen(o => !o)
  }

  function handleSelect(value) {
    setOpen(false)
    callbacks.onModeChange?.(value)
  }

  const modeLabel = MODES.find(m => m.value === mode)?.label ?? 'Object Mode'

  return (
    <div data-mode-selector="" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          padding:     '4px 10px',
          background:  '#383838',
          border:      '1px solid #4a4a4a',
          borderRadius:'6px',
          color:       '#e0e0e0',
          cursor:      'pointer',
          fontSize:    '13px',
          fontFamily:  'system-ui, -apple-system, sans-serif',
          display:     'flex',
          alignItems:  'center',
          gap:         '6px',
          whiteSpace:  'nowrap',
          pointerEvents: 'auto',
        }}
      >
        <span>{modeLabel}</span>
        <span style={{ fontSize: '12px', opacity: '0.6' }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position:   'fixed',
            top:        dropPos.top,
            left:       dropPos.left,
            background: '#2b2b2b',
            border:     '1px solid #555',
            borderRadius: '4px',
            overflow:   'hidden',
            zIndex:     '200',
            minWidth:   '140px',
            boxShadow:  '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'auto',
            // Drops from the trigger button (Tier A, ADR-080 Phase 1)
            ...popoverEnterMotion(reduced, 'top left'),
          }}
          role="listbox"
        >
          {MODES.map(({ label, value, hint }, i) => (
            <div
              key={value}
              role="option"
              aria-selected={mode === value}
              onClick={() => handleSelect(value)}
              style={{
                padding:        '7px 12px',
                color:          mode === value ? '#4fc3f7' : '#e8e8e8',
                cursor:         'pointer',
                fontSize:       '13px',
                fontFamily:     'sans-serif',
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'center',
                transition:     `background ${DURATION.hover}ms ${EASING.out}`,
                ...itemEnterMotion(i, reduced),
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#4a4a4a' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span>{label}</span>
              <span style={{ color: '#888', fontSize: '11px' }}>{hint}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
