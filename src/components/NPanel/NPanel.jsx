import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { NPanelGeneric } from './NPanelGeneric.jsx'
import { NPanelFrame }   from './NPanelFrame.jsx'
import { NPanelLink }    from './NPanelLink.jsx'
import { NPanelVariable } from './NPanelVariable.jsx'
import { EntityChecks }  from './EntityChecks.jsx'
import { GraspSearchPanel } from '../Grasp/GraspSearchPanel.jsx'
import { ParametricAssetPanel } from '../Context/ParametricAssetPanel.jsx'
import { BOTTOM_TIER, bottomEdgeOffset } from '../../view/EdgeOccupancy.js'
import { floorIsOpen } from '../../view/FloorTabs.js'

/**
 * NPanel — the right dock: what you selected, and what you can do to it.
 *
 * Positioning: `fixed, top:40px, right:0, width:200px`; the bottom is owned by
 * `EdgeOccupancy` (原則 #26) because the floor shares that edge (ADR-106 D6).
 *
 * ## The only permanent resident of the right edge (ADR-106 D2)
 *
 * There used to be three claimants on `right: 0` — this panel (200px), the
 * production floor (280px) and the tutorial Inspector (280px) — and one collision
 * being worked around three separate ways. This file held the first workaround:
 * `right: inspectorOpen ? '280px' : '0'`, a shift that only ever fired during the
 * tutorial. Both 280px residents moved to the bottom, so the shift has nothing
 * left to dodge and the panel no longer disappears when the floor opens.
 *
 * ## What it hosts (ADR-105 D5 / ADR-106 D3)
 *
 * Entity-scope discovery (`EntityChecks`) and, when they are live, the two panels
 * that used to be floor tabs but are about the selected thing rather than about
 * an agreement: grasp-search results and the parametric-asset viewer.
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
  const grasp          = useUIStore(s => s.context.grasp)
  const assetViewer    = useUIStore(s => s.context.assetViewer)
  const floorOpen      = useUIStore(floorIsOpen)
  const isMobile       = useIsMobile()

  const bottom = bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.DOCK, floorOpen })

  const panelStyle = {
    position:    'fixed',
    top:         '40px',
    right:       '0',
    width:       '200px',
    background:  '#2b2b2b',
    borderLeft:  '1px solid #1a1a1a',
    color:       '#e8e8e8',
    fontFamily:  'sans-serif',
    fontSize:    '12px',
    zIndex:      '90',
    bottom:      `${bottom}px`,
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
            top: '40px', bottom: `${bottom}px`, left: '0', right: '0',
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
        {nPanelData?.type === 'generic'  && <NPanelGeneric  data={nPanelData} />}
        {nPanelData?.type === 'frame'    && <NPanelFrame    data={nPanelData} />}
        {nPanelData?.type === 'link'     && <NPanelLink     data={nPanelData} />}
        {/* A shared design variable is the second selectable kind (ADR-107):
            the panel talks about whatever is selected, and the kind decides the
            body. Which body belongs to which kind is declared in
            `view/SelectionKinds.js`, not inferred here. */}
        {nPanelData?.type === 'variable' && <NPanelVariable data={nPanelData} />}

        {/* Entity-scope validation, beside the thing it is about (ADR-105 D5).
            Availability follows the SELECTION — not `ctx.active`, not whether a
            document exists — so `place → see if it reaches → place again` closes
            without a detour through the floor.

            PERMANENT slot, selection or not (ADR-110 D2 / 原則 #15). This is
            where the header's retired `Context ▾ → Grasp search…` argument
            landed: the path from "nothing selected" into grasp search was the
            only one that did not require a subject, and removing it would have
            been a silent deletion rather than a move (原則 #16). Disabled with
            its reason instead — and because the entrance now sits behind a
            selection, a grasp search WITHOUT a subject stopped being
            constructible, which is what closes the door on a second selection
            surface growing inside the panel (ADR-110 §力学 3). */}
        <EntityChecks />

        {/* Grasp-search results, beside the robot they are about (ADR-105 D5 /
            ADR-106 D3). This was the `grasp` tab of the floor, which meant
            "can this robot pick this up" required opening a negotiation first —
            a question with a single owner routed through a room built for
            questions with several. `context.grasp` is non-null only once the
            FSM has been seeded, so the section is its own availability. */}
        {grasp && <GraspSearchPanel />}

        {/* Parametric asset viewer (ADR-063 Phase 4). The catalog moved to the
            AddMenu — shaping a jig / conveyor / cell floor is *placing a thing* —
            and the sliders land here, beside what they are shaping. */}
        {assetViewer && <ParametricAssetPanel />}
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
