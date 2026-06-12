import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { NPanelGeneric } from './NPanelGeneric.jsx'
import { NPanelFrame }   from './NPanelFrame.jsx'
import { NPanelLink }    from './NPanelLink.jsx'

/**
 * NPanel — React replacement for UIView's 200px right-side properties panel.
 *
 * Positioning mirrors UIView._nPanelEl:
 *   position:fixed, top:40px, right:0, width:200px, bottom:26px
 *
 * Desktop: display block/none driven by nPanelVisible
 * Mobile:  always in DOM, translateX(100%) when hidden (0.25s ease transition)
 *
 * Backdrop: rendered when backdropCallback !== null (mobile drawer mode)
 */
export function NPanel() {
  const nPanelVisible  = useUIStore(s => s.nPanelVisible)
  const nPanelData     = useUIStore(s => s.nPanelData)
  const backdropCb     = useUIStore(s => s.backdropCallback)
  const demoActive     = useUIStore(s => s.demo.active)
  const demoTab        = useUIStore(s => s.demo.inspectorTab)
  const isMobile       = useIsMobile()

  // The Context Inspector (ADR-047) occupies the right edge (280px) while the
  // demo is active — shift left so the panel is not hidden behind it.
  const inspectorOpen = !isMobile && demoActive && !!demoTab

  const panelStyle = {
    position:    'fixed',
    top:         '40px',
    right:       inspectorOpen ? '280px' : '0',
    width:       '200px',
    background:  '#2b2b2b',
    borderLeft:  '1px solid #1a1a1a',
    color:       '#e8e8e8',
    fontFamily:  'sans-serif',
    fontSize:    '12px',
    zIndex:      '90',
    bottom:      '26px',
    overflowY:   'auto',
    pointerEvents: 'auto',
    ...(isMobile ? {
      display:    'block',
      transition: 'transform 0.25s ease',
      transform:  nPanelVisible ? 'translateX(0)' : 'translateX(100%)',
    } : {
      display:    nPanelVisible ? 'block' : 'none',
      transition: '',
      transform:  'none',
    }),
  }

  return (
    <>
      {/* Backdrop (mobile drawer) */}
      {backdropCb && (
        <div
          onClick={backdropCb}
          style={{
            position: 'fixed',
            top: '40px', bottom: '26px', left: '0', right: '0',
            background: 'rgba(0,0,0,0.5)',
            zIndex: '80',
            pointerEvents: 'auto',
          }}
        />
      )}

      <div style={panelStyle}>
        {/* Tab header — static "Item" label matching UIView */}
        <div style={{
          padding: '6px 10px',
          background: '#3a3a3a',
          borderBottom: '1px solid #1a1a1a',
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#e8e8e8',
          letterSpacing: '0.05em',
        }}>
          Item
        </div>

        {/* Content — swapped based on entity type */}
        {nPanelData?.type === 'generic' && <NPanelGeneric data={nPanelData} />}
        {nPanelData?.type === 'frame'   && <NPanelFrame   data={nPanelData} />}
        {nPanelData?.type === 'link'    && <NPanelLink    data={nPanelData} />}
      </div>
    </>
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
