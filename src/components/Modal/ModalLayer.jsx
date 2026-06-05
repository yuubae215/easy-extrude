import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'

export function ModalLayer() {
  const modal      = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.actions.closeModal)

  if (!modal) return null
  if (modal.type === 'rename')  return <RenameDialog  modal={modal} onClose={closeModal} />
  if (modal.type === 'confirm') return <ConfirmDialog modal={modal} onClose={closeModal} />
  if (modal.type === 'import')  return <ImportModal   modal={modal} onClose={closeModal} />
  return null
}

// ── Shared overlay ──────────────────────────────────────────────────────────

function Overlay({ onCancel, children }) {
  return (
    <div
      onPointerDown={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
        pointerEvents: 'auto',
      }}
    >
      <div
        onPointerDown={e => e.stopPropagation()}
        style={{
          background: '#2b2b2b',
          border: '1px solid #444',
          borderRadius: '6px',
          padding: '18px 20px',
          minWidth: '280px',
          maxWidth: '420px',
          color: '#e8e8e8',
          fontFamily: 'sans-serif',
          fontSize: '13px',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function ModalTitle({ text }) {
  return (
    <div style={{
      fontSize: '11px',
      color: '#aaa',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginBottom: '10px',
    }}>
      {text}
    </div>
  )
}

function ButtonRow({ children }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
      marginTop: '14px',
    }}>
      {children}
    </div>
  )
}

const btnBase = {
  padding: '5px 14px',
  borderRadius: '4px',
  fontSize: '13px',
  cursor: 'pointer',
  border: '1px solid #555',
}
const cancelStyle = { ...btnBase, background: '#3a3a3a', color: '#e8e8e8' }
const confirmStyle = { ...btnBase, background: '#3a3a3a', color: '#e8e8e8' }
const dangerStyle  = { ...btnBase, background: '#c0392b', color: '#fff', border: '1px solid #c0392b' }

// ── RenameDialog ────────────────────────────────────────────────────────────

function RenameDialog({ modal, onClose }) {
  const [value, setValue] = useState(modal.currentName ?? '')
  const inputRef = useRef(null)

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  const confirm = () => { onClose(); modal.callback(value) }
  const cancel  = () => { onClose(); modal.callback(null) }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Enter')  confirm()
      if (e.key === 'Escape') cancel()
    }
  }

  return (
    <Overlay onCancel={cancel}>
      <ModalTitle text={modal.title ?? 'Rename'} />
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#1e1e1e',
          border: '1px solid #4a90d9',
          borderRadius: '3px',
          color: '#e8e8e8',
          padding: '5px 8px',
          fontSize: '13px',
          fontFamily: 'sans-serif',
          outline: 'none',
        }}
      />
      <ButtonRow>
        <button style={cancelStyle}  onClick={cancel}>Cancel</button>
        <button style={confirmStyle} onClick={confirm}>OK</button>
      </ButtonRow>
    </Overlay>
  )
}

// ── ImportModal ─────────────────────────────────────────────────────────────

function ImportModal({ modal, onClose }) {
  const choose = (choice) => {
    onClose()
    modal.resolve(choice)
  }

  return (
    <div
      onPointerDown={e => { if (e.target === e.currentTarget) choose(null) }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        pointerEvents: 'auto',
      }}
    >
      <div
        onPointerDown={e => e.stopPropagation()}
        style={{
          background: '#1a2030',
          border: '1px solid #2a3a4a',
          borderRadius: '6px',
          padding: '18px 20px',
          minWidth: '280px',
          maxWidth: '400px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ecf0f1',
        }}
      >
        <div style={{ color: '#aad4f5', fontWeight: 'bold', marginBottom: '6px', fontSize: '13px' }}>
          Import JSON
        </div>
        <div style={{ color: '#7a9ab5', marginBottom: '16px', wordBreak: 'break-all' }}>
          {modal.filename}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => choose(null)}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
              cursor: 'pointer',
              background: '#2c3e50',
              color: '#ecf0f1',
              border: '1px solid #3a3a3a',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => choose('merge')}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
              cursor: 'pointer',
              background: '#2c3e50',
              color: '#ecf0f1',
              border: '1px solid #3a7a5a',
            }}
          >
            Merge into scene
          </button>
          <button
            onClick={() => choose('clear')}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
              cursor: 'pointer',
              background: '#e67e22',
              color: '#fff',
              border: '1px solid #e67e22',
              fontWeight: 'bold',
            }}
          >
            Clear and import
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ConfirmDialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ modal, onClose }) {
  const btnRef = useRef(null)

  useEffect(() => {
    const raf = requestAnimationFrame(() => btnRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  const confirm = () => { onClose(); modal.callback(true) }
  const cancel  = () => { onClose(); modal.callback(false) }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === 'Enter')  confirm()
        if (e.key === 'Escape') cancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <Overlay onCancel={cancel}>
      <ModalTitle text={modal.title ?? 'Confirm'} />
      <div style={{ color: '#c8c8c8', lineHeight: 1.5 }}>{modal.message}</div>
      <ButtonRow>
        <button style={cancelStyle} onClick={cancel}>Cancel</button>
        <button
          ref={btnRef}
          style={modal.danger ? dangerStyle : confirmStyle}
          onClick={confirm}
        >
          {modal.confirmLabel ?? 'OK'}
        </button>
      </ButtonRow>
    </Overlay>
  )
}
