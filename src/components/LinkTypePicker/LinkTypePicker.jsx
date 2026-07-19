import { useEffect, useRef } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { popoverEnterMotion, itemEnterMotion } from '../../view/ChromeMath.js'
import { DURATION, EASING } from '../../theme/tokens.js'

const SEMANTIC_META = {
  mounts:     { color: '#22C55E', desc: "Source vertices live in host frame's local space" },
  fastened:   { color: '#10B981', desc: 'Rigid attachment — no relative motion' },
  aligned:    { color: '#14B8A6', desc: 'Shared plane or axis' },
  contains:   { color: '#8B5CF6', desc: 'Spatial containment' },
  adjacent:   { color: '#64748B', desc: 'Side-by-side, no overlap' },
  above:      { color: '#94A3B8', desc: 'Elevated above target' },
  connects:   { color: '#06B6D4', desc: 'Path between two hubs' },
  references: { color: '#F59E0B', desc: 'Logical reference' },
  represents: { color: '#F43F5E', desc: 'Abstraction of physical object' },
  bounded_by: { color: '#EF4444', desc: 'Enclosed within boundary' },
}

export function LinkTypePicker() {
  const linkTypePicker    = useUIStore(s => s.linkTypePicker)
  const hideLinkTypePicker = useUIStore(s => s.actions.hideLinkTypePicker)
  const reduced = useReducedMotion()
  const ref = useRef(null)

  useEffect(() => {
    if (!linkTypePicker) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        hideLinkTypePicker()
      }
    }
    setTimeout(() => document.addEventListener('pointerdown', onDown), 0)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [linkTypePicker])

  if (!linkTypePicker) return null

  const { x, y, options, onSelect } = linkTypePicker
  const W = window.innerWidth
  const H = window.innerHeight
  const estimatedH = options.length * 50 + 40
  const left = Math.max(8, Math.min(x, W - 236))
  const top  = Math.max(48, Math.min(y, H - estimatedH - 8))

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: '220px',
        background: '#2a2a2a',
        border: '1px solid #3a3a3a',
        borderRadius: '6px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        zIndex: 200,
        pointerEvents: 'auto',
        // Grows from the link endpoint the user just dropped (Tier A, ADR-080)
        ...popoverEnterMotion(reduced, 'top left'),
      }}
    >
      <div style={{
        padding: '7px 10px 5px',
        color: '#ccc',
        fontSize: '12px',
        borderBottom: '1px solid #3a3a3a',
      }}>
        Link Type
      </div>
      {options.map((opt, i) => {
        const meta = SEMANTIC_META[opt.semanticType] ?? { color: '#94A3B8', desc: '' }
        return (
          <div
            key={i}
            onClick={() => {
              hideLinkTypePicker()
              onSelect(opt)
            }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '7px 10px',
              cursor: 'pointer',
              transition: `background ${DURATION.hover}ms ${EASING.out}`,
              ...itemEnterMotion(i, reduced),
            }}
            onPointerEnter={e => { e.currentTarget.style.background = '#333' }}
            onPointerLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: meta.color,
              flexShrink: 0,
              marginTop: '3px',
            }} />
            <div>
              <div style={{ color: meta.color, fontWeight: 'bold', fontSize: '12px' }}>
                {opt.label ?? opt.semanticType}
              </div>
              <div style={{ color: '#666', fontSize: '10px', marginTop: '1px' }}>
                {meta.desc}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
