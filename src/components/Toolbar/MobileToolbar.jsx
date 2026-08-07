import { useUIStore } from '../../store/uiStore.js'
import { ToolbarButton } from './ToolbarButton.jsx'
import { BOTTOM_TIER, bottomEdgeOffset } from '../../view/EdgeOccupancy.js'
import { useIsNarrowViewport } from '../Chrome/ChromePrimitives.jsx'

/**
 * MobileToolbar — React replacement for UIView's native mobile toolbar.
 *
 * Reads button descriptors from the Zustand store (set by AppController via
 * UIViewBridge.setMobileToolbar). Only visible on mobile (<768px), matching
 * UIView's _isMobile() breakpoint.
 *
 * Layout: position:fixed, sits directly on the InfoBar (EdgeOccupancy owns the
 * offset — 原則 #26), height 60px.
 * Spacer items keep the 5-slot count stable (ADR-024 / PHILOSOPHY #15).
 */
export function MobileToolbar() {
  const toolbar = useUIStore(s => s.toolbar)
  const pushToast = useUIStore(s => s.actions.pushToast)
  const isMobile = useIsNarrowViewport()

  if (!isMobile) return null

  return (
    <div style={{
      position:            'fixed',
      // InfoBar の直上 — 場はこのツールバーの**上に**開く (ADR-106 D6)。
      bottom:              `${bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.ABOVE_INFOBAR })}px`,
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
            reason={btn.reason ?? null}
            onLockedTap={(reason) => pushToast(reason, 'info')}
          />
        )
      })}
    </div>
  )
}

// `useIsMobile()` はここに在った (Header / NPanel にも同じ実装のコピーが在った)。
// 判定は `view/Viewport.js`、購読は `useIsNarrowViewport()` ただ 1 つ (ADR-114 / §1.1)。
