import { useState, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { ToolbarButton } from './ToolbarButton.jsx'

/**
 * MobileToolbar — React replacement for UIView's native mobile toolbar.
 *
 * Reads button descriptors from the Zustand store (set by AppController via
 * UIViewBridge.setMobileToolbar). Only visible on mobile (<768px), matching
 * UIView's _isMobile() breakpoint.
 *
 * Layout: position:fixed, bottom 26px (above 26px info bar), height 60px.
 * Spacer items keep the 5-slot count stable (ADR-024 / PHILOSOPHY #15).
 */
export function MobileToolbar() {
  const toolbar = useUIStore(s => s.toolbar)
  const isMobile = useIsMobile()

  if (!isMobile) return null

  return (
    <div style={{
      position:            'fixed',
      bottom:              '26px',
      left:                '0',
      right:               '0',
      height:              '60px',
      background:          'rgba(26, 26, 28, 0.95)',
      borderTop:           '1px solid rgba(255,255,255,0.08)',
      backdropFilter:      'blur(12px)',
      WebkitBackdropFilter:'blur(12px)',
      display:             'flex',
      alignItems:          'center',
      justifyContent:      'center',
      gap:                 '6px',
      padding:             '0 12px',
      zIndex:              '95',
      pointerEvents:       'auto',
      boxSizing:           'border-box',
    }}>
      {toolbar.map((btn, i) => {
        if (btn.spacer) {
          return (
            <div key={i} style={{
              flex: '1 0 0', minHeight: '48px', visibility: 'hidden',
            }} />
          )
        }
        return (
          <ToolbarButton
            key={i}
            icon={btn.icon}
            label={btn.label}
            onClick={btn.onClick}
            active={btn.active}
            danger={btn.danger}
            disabled={btn.disabled}
            indicator={btn.indicator}
          />
        )
      })}
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
