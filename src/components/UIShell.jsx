import { useEffect } from 'react'
import { useUIStore } from '../store/uiStore.js'
import { Header } from './Header/Header.jsx'
import { MobileToolbar } from './Toolbar/MobileToolbar.jsx'
import { NPanel } from './NPanel/NPanel.jsx'
import { ExtrusionLabel } from './ExtrusionLabel/ExtrusionLabel.jsx'
import { InfoBar } from './InfoBar/InfoBar.jsx'
import { ModalLayer } from './Modal/ModalLayer.jsx'
import { MapToolbar } from './MapToolbar/MapToolbar.jsx'
import { ContextMenu } from './ContextMenu/ContextMenu.jsx'
import { AddMenu } from './AddMenu/AddMenu.jsx'
import { LinkTypePicker } from './LinkTypePicker/LinkTypePicker.jsx'
import { SemanticSuggestion } from './SemanticSuggestion/SemanticSuggestion.jsx'
import { DragSuggestionTooltip } from './SemanticSuggestion/DragSuggestionTooltip.jsx'
import { ImportProgress } from './ImportUI/ImportProgress.jsx'
import { Outliner } from './Outliner/Outliner.jsx'
import { Onboarding } from './Onboarding/Onboarding.jsx'
import { TourCard } from './Onboarding/TourCard.jsx'
import { ContextDemoLayer } from './ContextDemo/ContextDemoLayer.jsx'
import { ContextLayer } from './Context/ContextLayer.jsx'
import { TemplateGallery } from './Context/TemplateGallery.jsx'
import { ChromeDefs } from './Chrome/ChromePrimitives.jsx'
import { useReducedMotion } from './Feedback/FeedbackPrimitives.jsx'
import { enterMotion } from '../view/ChromeMath.js'
import { COLOR, DURATION } from '../theme/tokens.js'

/**
 * React UI root — Phase 2d–2g + Phase 3 + Phase 4.
 *
 * Manages:
 * 1. Cursor sync: store → document.body
 * 2. Header: React replacement for UIView's 40px top bar
 * 3. MobileToolbar: React replacement for UIView's native mobile toolbar
 * 4. NPanel: React replacement for UIView's 200px right properties panel
 * 5. ToastStack: React-rendered toasts
 * 6. ExtrusionLabel: floating 3D extrusion amount label
 * 7. InfoBar: bottom keyboard-hints bar (desktop) / status bar (mobile)
 * 8. ModalLayer: RenameDialog, ConfirmDialog, ImportModal
 * 9. MapToolbar: Map Mode left vertical toolbar (tool buttons + name input)
 * 10. ContextMenu: long-press / right-click context menu
 * 12. AddMenu: Shift+A add object menu
 * 13. LinkTypePicker: L-key SpatialLink type picker
 * 14. SemanticSuggestion: post-drag ADR-041 suggestion banner
 * 15. DragSuggestionTooltip: during-drag non-interactive tooltip
 * 16. ImportProgress: file import progress bar
 * 17. Outliner: scene collection left sidebar
 * 18. Onboarding: mobile first-visit gesture hint overlay
 * 19. TourCard: desktop onboarding tour quest card (ADR-065 Phase 6)
 */
export function UIShell() {
  const cursor = useUIStore(s => s.cursor)
  const toasts = useUIStore(s => s.toasts)

  useEffect(() => {
    document.body.style.cursor = cursor
  }, [cursor])

  return (
    <>
      <ChromeDefs />
      <Header />
      <MobileToolbar />
      <NPanel />
      <ExtrusionLabel />
      <InfoBar />
      <ModalLayer />
      <MapToolbar />
      <ContextMenu />
      <AddMenu />
      <LinkTypePicker />
      <SemanticSuggestion />
      <DragSuggestionTooltip />
      <ImportProgress />
      <Outliner />
      <Onboarding />
      <TourCard />
      <ContextDemoLayer />
      <ContextLayer />
      <TemplateGallery />
      <ToastStack toasts={toasts} />
    </>
  )
}

function ToastStack({ toasts }) {
  const dismissToast = useUIStore(s => s.actions.dismissToast)
  const reduced = useReducedMotion()

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '96px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      pointerEvents: 'none',
      zIndex: 200,
    }}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          onClick={() => dismissToast(toast.id)}
          style={{
            background: toast.type === 'error' ? '#7a1f1f'
                      : toast.type === 'warn'  ? '#5a4a1a'
                      : '#1e1e1e',
            color: COLOR.textPrimary,
            padding: '6px 14px',
            borderRadius: '4px',
            fontSize: '13px',
            whiteSpace: 'nowrap',
            pointerEvents: 'auto',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            // Entry slide-fade says "a new notification arrived" (Tier A,
            // ADR-065 Phase 3); reduced motion shows it in place.
            ...enterMotion(reduced, DURATION.toastIn),
          }}
        >
          {toast.msg}
        </div>
      ))}
    </div>
  )
}
