import { useEffect } from 'react'
import { useUIStore } from '../store/uiStore.js'
import { Header } from './Header/Header.jsx'
import { MobileToolbar } from './Toolbar/MobileToolbar.jsx'

/**
 * React UI root — Phase 2 (Header + MobileToolbar).
 *
 * Manages:
 * 1. Cursor sync: store → document.body
 * 2. Header: React replacement for UIView's 40px top bar
 * 3. MobileToolbar: React replacement for UIView's native mobile toolbar
 * 4. ToastStack: React-rendered toasts
 *
 * UIView.js still manages the N-panel, bottom info bar, modals, and other UI.
 */
export function UIShell() {
  const cursor = useUIStore(s => s.cursor)
  const toasts = useUIStore(s => s.toasts)

  useEffect(() => {
    document.body.style.cursor = cursor
  }, [cursor])

  return (
    <>
      <Header />
      <MobileToolbar />
      <ToastStack toasts={toasts} />
    </>
  )
}

function ToastStack({ toasts }) {
  const dismissToast = useUIStore(s => s.actions.dismissToast)

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
            color: '#e0e0e0',
            padding: '6px 14px',
            borderRadius: '4px',
            fontSize: '13px',
            whiteSpace: 'nowrap',
            pointerEvents: 'auto',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          {toast.msg}
        </div>
      ))}
    </div>
  )
}
