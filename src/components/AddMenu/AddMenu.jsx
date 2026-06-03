import { useEffect, useRef } from 'react'
import { useUIStore } from '../../store/uiStore.js'

export function AddMenu() {
  const addMenu    = useUIStore(s => s.addMenu)
  const hideAddMenu = useUIStore(s => s.actions.hideAddMenu)
  const ref = useRef(null)

  useEffect(() => {
    if (!addMenu) return
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        hideAddMenu()
      }
    }
    setTimeout(() => document.addEventListener('click', onClick), 0)
    return () => document.removeEventListener('click', onClick)
  }, [addMenu])

  if (!addMenu) return null

  const { x, y, cbs } = addMenu

  const items = [
    cbs.onMeasure    && { label: 'Measure Line', hint: 'M',         cb: cbs.onMeasure },
    cbs.onBox        && { label: 'Box',          hint: 'Shift+A',   cb: cbs.onBox },
    cbs.onSketch     && { label: 'Sketch',       hint: null,        cb: cbs.onSketch },
    cbs.onFrame      && { label: 'Coordinate Frame', hint: null,    cb: cbs.onFrame },
    cbs.onImportStep && { label: 'Import STEP',  hint: null,        cb: cbs.onImportStep },
  ].filter(Boolean)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        background: '#2b2b2b',
        border: '1px solid #555',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        minWidth: '140px',
        overflow: 'hidden',
        zIndex: 300,
      }}
    >
      <div style={{
        padding: '5px 10px 4px',
        color: '#888',
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        Add
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => { hideAddMenu(); item.cb() }}
          style={{
            padding: '7px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            color: '#e8e8e8',
            fontSize: '13px',
          }}
          onPointerEnter={e => { e.currentTarget.style.background = '#3a3a3a' }}
          onPointerLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <span>{item.label}</span>
          {item.hint && (
            <span style={{ color: '#888', fontSize: '11px', marginLeft: '12px' }}>
              {item.hint}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
