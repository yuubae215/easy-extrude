import { useState, useRef, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { popoverEnterMotion, itemEnterMotion } from '../../view/ChromeMath.js'
import { COLOR, DURATION, EASING } from '../../theme/tokens.js'
import { isInsideDropdown } from '../../view/DropdownContainment.js'

const MODES = [
  { label: 'Object Mode', value: 'object', hint: 'Tab', short: 'Obj' },
  { label: 'Edit Mode',   value: 'edit',   hint: 'Tab', short: 'Edit' },
]

/**
 * ModeDropdown — mode selector button + fixed-position dropdown.
 *
 * The dropdown is rendered at document-level coordinates (position:fixed) to
 * escape the header's overflow:hidden — matching UIView's _modeDropdownEl pattern
 * (CODE_CONTRACTS "Mobile Header Overflow").
 *
 * `compact` (狭レイアウト, ADR-114): ラベルを短縮形にして 116px → 48px に落とす。
 * **入口を消すのではなく語を短くする** (原則 #15) — 現在のモードは読めたままで、
 * 完全な語は開いた listbox と `title` に在る。上端の幅は共有資源なので、削るのは
 * 「一番幅を食っている住人の語」であって「一番奥の入口」ではない (右端を切るのが
 * `overflow:hidden` の既定挙動で、それが ADR-114 の欠陥だった)。
 *
 * @param {{compact?: boolean}} props
 */
export function ModeDropdown({ compact = false }) {
  const mode      = useUIStore(s => s.mode)
  const callbacks = useUIStore(s => s.callbacks)
  const [open, setOpen]   = useState(false)
  const [dropPos, setDropPos] = useState({ top: 42, left: 0 })
  const reduced = useReducedMotion()
  const btnRef = useRef(null)
  const surfaceRef = useRef(null)

  // Close on outside click. "Is this click mine?" is ONE predicate for every
  // dropdown in the header (§1.1) — this component used to answer it via the
  // `[data-mode-selector]` wrapper while `HeaderMenus` answered it from the
  // trigger alone, and only one of the two knew about the fixed-position panel.
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!isInsideDropdown(e.target, { trigger: btnRef.current, surface: surfaceRef.current })) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
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

  const decl      = MODES.find(m => m.value === mode) ?? MODES[0]
  const modeLabel = compact ? decl.short : decl.label

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={decl.label}
        title={compact ? decl.label : undefined}
        style={{
          padding:     compact ? '4px 6px' : '4px 10px',
          background:  '#383838',
          border:      '1px solid #4a4a4a',
          borderRadius:'6px',
          color:       '#e0e0e0',
          cursor:      'pointer',
          fontSize:    compact ? '12px' : '13px',
          fontFamily:  'system-ui, -apple-system, sans-serif',
          display:     'flex',
          alignItems:  'center',
          gap:         compact ? '3px' : '6px',
          whiteSpace:  'nowrap',
          flexShrink:  '0',
          pointerEvents: 'auto',
        }}
      >
        <span>{modeLabel}</span>
        <span style={{ fontSize: '12px', opacity: '0.6' }}>▾</span>
      </button>

      {open && (
        <div
          ref={surfaceRef}
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
                color:          mode === value ? COLOR.accent : '#e8e8e8',
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
