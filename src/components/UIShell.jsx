import { useEffect } from 'react'
import { useUIStore } from '../store/uiStore.js'

/**
 * React UI root — Phase 0 shell.
 *
 * Currently only:
 * 1. Syncs the cursor state from the store to document.body
 * 2. Renders toasts as a proof-of-concept that the React overlay works
 *
 * UIView.js continues to run as before.  Phase 2 will migrate UIView sections
 * into child components of this shell.
 */
export function UIShell() {
  const cursor = useUIStore(s => s.cursor)
  const toasts = useUIStore(s => s.toasts)

  // Apply cursor from store to body so Three.js canvas cursor stays in sync
  useEffect(() => {
    document.body.style.cursor = cursor
  }, [cursor])

  return (
    <>
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
