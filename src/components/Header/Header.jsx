import { useState, useRef, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { ModeDropdown } from './ModeDropdown.jsx'

// ── SVG icon constants (matching ICONS in UIView.js) ──────────────────────
const SVG_UNDO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>`
const SVG_REDO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-4"/></svg>`
const SVG_MAP  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`
const SVG_HAMBURGER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`
const SVG_NPANEL = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
const SVG_MORE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`
const SVG_NODES = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><line x1="9" y1="12" x2="15" y2="7"/><line x1="9" y1="12" x2="15" y2="17"/></svg>`
const SVG_EXPORT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
const SVG_IMPORT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 14 12 9 17 14"/><line x1="12" y1="9" x2="12" y2="21"/></svg>`
const SVG_DEMO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`

/**
 * Header — React replacement for UIView's 40px top bar.
 *
 * Reads state from the Zustand store (mode, statusParts, bffConnected,
 * nodeEditorOpen) and fires callbacks registered by AppController.
 *
 * Mobile layout  (<768px):  [☰] [↩] [↪] [Mode▾] [Map] [spacer] [⋯] [N]
 * Desktop layout (≥768px):  [Mode▾] [Map] [··status··] [Save?] [Load?] [Nodes?] [Export] [Import]
 * (Save / Load / Nodes appear only while the BFF is connected — the Node Editor's
 *  primary content is the BFF Geometry Service operation graph.)
 */
export function Header() {
  const isMobile = useIsMobile()

  return (
    <header style={{
      position:    'fixed',
      top:         '0',
      left:        '0',
      right:       '0',
      height:      '40px',
      background:  '#242424',
      borderBottom:'1px solid #141414',
      display:     'flex',
      alignItems:  'center',
      padding:     '0 8px',
      gap:         '6px',
      zIndex:      '100',
      overflow:    'hidden',
      userSelect:  'none',
      fontFamily:  'system-ui, -apple-system, sans-serif',
      pointerEvents: 'auto',
      boxSizing:   'border-box',
    }}>
      {isMobile ? <MobileHeaderContents /> : <DesktopHeaderContents />}
    </header>
  )
}

// ── Mobile header ─────────────────────────────────────────────────────────

function MobileHeaderContents() {
  const callbacks   = useUIStore(s => s.callbacks)
  const undoEnabled = useUIStore(s => s.undoEnabled)
  const redoEnabled = useUIStore(s => s.redoEnabled)
  return (
    <>
      <IconBtn svg={SVG_HAMBURGER} label="Toggle outliner"       onClick={() => callbacks.onOutlinerToggle?.()} />
      <IconBtn svg={SVG_UNDO}      label="Undo"                  onClick={() => callbacks.onUndoClick?.()}      border disabled={!undoEnabled} />
      <IconBtn svg={SVG_REDO}      label="Redo"                  onClick={() => callbacks.onRedoClick?.()}      border disabled={!redoEnabled} />
      <ModeDropdown />
      <MapButton />
      {/* Invisible flex:1 spacer — keeps ⋯ and N right-aligned (matching UIView's visibility:hidden pattern) */}
      <div style={{ flex: '1', visibility: 'hidden' }} />
      <MoreMenu />
      <IconBtn svg={SVG_NPANEL} label="Toggle properties panel" onClick={() => callbacks.onNPanelToggle?.()} />
    </>
  )
}

// ── Desktop header ────────────────────────────────────────────────────────

function DesktopHeaderContents() {
  const callbacks      = useUIStore(s => s.callbacks)
  const bffConnected   = useUIStore(s => s.bffConnected)
  const nodeEditorOpen = useUIStore(s => s.nodeEditorOpen)
  return (
    <>
      <ModeDropdown />
      <MapButton />
      <HeaderStatus />
      {bffConnected && (
        <>
          <SmallBtn onClick={() => callbacks.onSaveScene?.()} title="Save scene to server">Save</SmallBtn>
          <SmallBtn onClick={() => callbacks.onLoadScene?.()} title="Load scene from server">Load</SmallBtn>
          <SmallBtn
            onClick={() => callbacks.onNodeEditorToggle?.()}
            title="Toggle Node Editor (Geometry DAG)"
            active={nodeEditorOpen}
            icon={SVG_NODES}
          >
            Nodes
          </SmallBtn>
        </>
      )}
      <SmallBtn onClick={() => callbacks.onExportJson?.()} title="Export scene as JSON (Ctrl+E)" icon={SVG_EXPORT}>Export</SmallBtn>
      <SmallBtn onClick={() => callbacks.onImportJson?.()} title="Import scene from JSON (Ctrl+I)" icon={SVG_IMPORT}>Import</SmallBtn>
      <ContextDropdown />
    </>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────

function MapButton() {
  const isMobile  = useIsMobile()
  const callbacks = useUIStore(s => s.callbacks)
  return (
    <button
      title="Open 2D Map Mode for spatial annotation"
      onClick={() => callbacks.onMapModeClick?.()}
      style={{
        padding:      isMobile ? '4px' : '4px 8px',
        background:   'transparent',
        border:       '1px solid #3a3a3a',
        borderRadius: '5px',
        color:        '#aaa',
        cursor:       'pointer',
        fontSize:     '12px',
        fontFamily:   'system-ui, -apple-system, sans-serif',
        lineHeight:   '1',
        flexShrink:   '0',
        display:      'flex',
        alignItems:   'center',
        gap:          '5px',
        pointerEvents:'auto',
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: SVG_MAP }} style={{ display: 'flex' }} />
      {!isMobile && <span>Map</span>}
    </button>
  )
}

function HeaderStatus() {
  const parts = useUIStore(s => s.statusParts)
  return (
    <div style={{
      flex:           '1',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '2px',
      fontSize:       '12px',
      fontFamily:     'system-ui, -apple-system, sans-serif',
      pointerEvents:  'none',
      overflow:       'hidden',
      minWidth:       '0',
    }}>
      {parts.map((part, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <span style={{ color: '#4a4a4a', margin: '0 4px' }}>·</span>}
          <span style={{
            color:         part.color ?? '#c8c8c8',
            fontWeight:    part.bold ? 'bold' : 'normal',
            letterSpacing: part.bold ? '0.02em' : 'normal',
          }}>
            {part.text}
          </span>
        </span>
      ))}
    </div>
  )
}

function IconBtn({ svg, label, onClick, border = false, disabled = false }) {
  return (
    <button
      aria-label={label}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding:      '5px 7px',
        background:   'transparent',
        border:       border ? '1px solid #3a3a3a' : 'none',
        borderRadius: '6px',
        color:        '#c0c0c0',
        cursor:       disabled ? 'default' : 'pointer',
        lineHeight:   '1',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        flexShrink:   '0',
        pointerEvents:'auto',
        opacity:      disabled ? 0.35 : 1,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function SmallBtn({ onClick, title, children, active = false, icon }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding:      '4px 8px',
        background:   'transparent',
        border:       `1px solid ${active ? '#3a7bd5' : '#3a3a3a'}`,
        borderRadius: '5px',
        color:        active ? '#5a9bf5' : '#aaa',
        cursor:       'pointer',
        fontSize:     '11px',
        fontFamily:   'system-ui, -apple-system, sans-serif',
        lineHeight:   '1',
        flexShrink:   '0',
        display:      'flex',
        alignItems:   'center',
        gap:          '4px',
        pointerEvents:'auto',
      }}
    >
      {icon && <span dangerouslySetInnerHTML={{ __html: icon }} style={{ display: 'flex' }} />}
      {children}
    </button>
  )
}

// ── Context dropdown (desktop) ────────────────────────────────────────────

/**
 * Context ▾ — single entry point for the Context-first features (ADR-050 §4.4),
 * replacing the four flat demo buttons. `Negotiate` is the production
 * ContextController path (undoable doc approval); `Tutorial` / `Author` /
 * `Region Ghosts` remain the demo (`ContextDemoController`) until later phases
 * migrate them. `.ctx.json` Import / Save arrive in Phase 4.
 */
function ContextDropdown() {
  const callbacks = useUIStore(s => s.callbacks)
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const [pos, setPos] = useState({ top: 40, right: 8 })

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!btnRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  function handleToggle(e) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom, right: window.innerWidth - rect.right })
    }
    setOpen(o => !o)
  }

  function item(label, cb, sub = false) {
    return (
      <button
        key={label}
        onClick={() => { setOpen(false); cb?.() }}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          padding: '9px 14px', background: 'transparent', border: 'none',
          borderBottom: '1px solid #3a3a3a', color: sub ? '#aaa' : '#e0e0e0',
          cursor: 'pointer', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'left', pointerEvents: 'auto',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#3a3a3a' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <span dangerouslySetInnerHTML={{ __html: SVG_DEMO }} style={{ display: 'flex' }} />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        title="Context-first — requirements / conflicts / negotiation"
        style={{
          padding: '4px 8px', background: 'transparent',
          border: `1px solid ${open ? '#3a7bd5' : '#3a3a3a'}`, borderRadius: '5px',
          color: open ? '#5a9bf5' : '#aaa', cursor: 'pointer', fontSize: '11px',
          fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: '1',
          flexShrink: '0', display: 'flex', alignItems: 'center', gap: '4px',
          pointerEvents: 'auto',
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: SVG_DEMO }} style={{ display: 'flex' }} />
        <span>Context ▾</span>
      </button>
      {open && (
        <div style={{
          position: 'fixed', top: pos.top, right: pos.right,
          background: '#2b2b2b', border: '1px solid #555', borderRadius: '6px',
          overflow: 'hidden', zIndex: '200', minWidth: '200px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)', pointerEvents: 'auto',
        }}>
          {item('New Project',     callbacks.onOpenTemplateGallery)}
          {item('Import Context…', callbacks.onImportCtxJson)}
          {item('Save Context',    callbacks.onExportCtxJson)}
          <div style={{ padding: '4px 14px', fontSize: '10px', color: '#666', borderBottom: '1px solid #3a3a3a' }}>
            Production
          </div>
          {item('Negotiate', callbacks.onContextNegotiate)}
          {item('Author', callbacks.onContextAuthor)}
          {item('Region Ghosts', callbacks.onContextRegionGhost)}
          <div style={{ padding: '4px 14px', fontSize: '10px', color: '#666', borderBottom: '1px solid #3a3a3a' }}>
            Demo (Tutorial)
          </div>
          {item('Tutorial', callbacks.onContextDemoClick, true)}
        </div>
      )}
    </>
  )
}

// ── More (⋯) dropdown (mobile) ────────────────────────────────────────────

function MoreMenu() {
  const callbacks   = useUIStore(s => s.callbacks)
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const [pos, setPos] = useState({ top: 40, right: 8 })

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!btnRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  function handleToggle(e) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom, right: window.innerWidth - rect.right })
    }
    setOpen(o => !o)
  }

  function item(label, svgHtml, cb) {
    return (
      <button
        key={label}
        onClick={() => { setOpen(false); cb?.() }}
        style={{
          display:     'flex',
          alignItems:  'center',
          gap:         '8px',
          width:       '100%',
          padding:     '10px 14px',
          background:  'transparent',
          border:      'none',
          borderBottom:'1px solid #3a3a3a',
          color:       '#e0e0e0',
          cursor:      'pointer',
          fontSize:    '13px',
          fontFamily:  'system-ui, -apple-system, sans-serif',
          textAlign:   'left',
          pointerEvents: 'auto',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#3a3a3a' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <span dangerouslySetInnerHTML={{ __html: svgHtml }} style={{ display: 'flex' }} />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        aria-label="More file actions"
        onClick={handleToggle}
        style={{
          padding:      '6px',
          background:   'transparent',
          border:       'none',
          color:        '#c0c0c0',
          cursor:       'pointer',
          lineHeight:   '1',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          flexShrink:   '0',
          borderRadius: '6px',
          pointerEvents:'auto',
        }}
        dangerouslySetInnerHTML={{ __html: SVG_MORE }}
      />
      {open && (
        <div style={{
          position:   'fixed',
          top:        pos.top,
          right:      pos.right,
          background: '#2b2b2b',
          border:     '1px solid #555',
          borderRadius: '6px',
          overflow:   'hidden',
          zIndex:     '200',
          minWidth:   '160px',
          boxShadow:  '0 4px 16px rgba(0,0,0,0.6)',
          pointerEvents: 'auto',
        }}>
          {item('Export', SVG_EXPORT, callbacks.onExportJson)}
          {item('Import', SVG_IMPORT, callbacks.onImportJson)}
          {item('New Project',     SVG_DEMO, callbacks.onOpenTemplateGallery)}
          {item('Import Context…', SVG_DEMO, callbacks.onImportCtxJson)}
          {item('Save Context',    SVG_DEMO, callbacks.onExportCtxJson)}
          {item('Negotiate', SVG_DEMO, callbacks.onContextNegotiate)}
          {item('Author', SVG_DEMO, callbacks.onContextAuthor)}
          {item('Region Ghosts', SVG_DEMO, callbacks.onContextRegionGhost)}
          {item('Tutorial', SVG_DEMO, callbacks.onContextDemoClick)}
        </div>
      )}
    </>
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────

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
