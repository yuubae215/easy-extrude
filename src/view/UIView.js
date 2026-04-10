/**
 * UIView - manages DOM UI elements (Blender-style layout)
 *
 * Side effects: creates DOM elements, appends them, and modifies their styles.
 */
import { IFC_CLASSES, IFC_CLASS_MAP } from '../domain/IFCClassRegistry.js'
import { getPlaceTypesByGeometry, PLACE_TYPE_MAP } from '../domain/PlaceTypeRegistry.js'

/** SVG icon strings for the mobile toolbar. Pass as `icon` in setMobileToolbar buttons. */
export const ICONS = {
  add:      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  duplicate:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`,
  delete:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  back:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  confirm:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  cancel:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  extrude:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="7"/><polyline points="6 13 12 7 18 13"/><rect x="4" y="19" width="16" height="3" rx="1.5" fill="currentColor" stroke="none"/></svg>`,
  vertex:   `<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg>`,
  edge:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="3"/><circle cx="20" cy="12" r="3"/><rect x="7" y="11" width="10" height="2" rx="1"/></svg>`,
  face:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/></svg>`,
  stack:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="14" width="18" height="6" rx="1.5"/><rect x="5" y="8" width="14" height="5" rx="1"/><line x1="12" y1="3" x2="12" y2="8"/><polyline points="9 5 12 2 15 5"/></svg>`,
  undo:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>`,
  redo:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-4"/></svg>`,
  rotate:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>`,
  measure:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="21" x2="21" y2="3"/><line x1="3" y1="13" x2="7" y2="13"/><line x1="7" y1="9" x2="11" y2="9"/><line x1="11" y1="5" x2="15" y2="5"/></svg>`,
  frame:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><line x1="12" y1="12" x2="19" y2="12" stroke="#e05252"/><line x1="12" y1="12" x2="8.5" y2="8.5" stroke="#52e052"/><line x1="12" y1="12" x2="12" y2="5" stroke="#5252e0"/></svg>`,
  grab:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M6 14a4 4 0 0 0 2.83 3.83L10 18h4l1.17-.17A4 4 0 0 0 18 14v-2H6v2z"/></svg>`,
  map:      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
}

export class UIView {
  constructor() {
    // ── Header bar (top, full width) ─────────────────────────────────────
    this._headerEl = document.createElement('div')
    Object.assign(this._headerEl.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      height: '40px',
      background: '#242424',
      borderBottom: '1px solid #141414',
      display: 'flex', alignItems: 'center',
      padding: '0 8px', gap: '6px',
      zIndex: '100',
      userSelect: 'none',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    })
    document.body.appendChild(this._headerEl)

    // ── Mode selector (dropdown) ──────────────────────────────────────────
    this._modeSelectorEl = document.createElement('div')
    Object.assign(this._modeSelectorEl.style, {
      position: 'relative',
      display: 'inline-block',
    })

    this._modeBtnEl = document.createElement('button')
    Object.assign(this._modeBtnEl.style, {
      padding: '4px 10px',
      background: '#383838',
      border: '1px solid #4a4a4a',
      borderRadius: '6px',
      color: '#e0e0e0',
      cursor: 'pointer',
      fontSize: '13px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex', alignItems: 'center', gap: '6px',
      whiteSpace: 'nowrap',
    })
    this._modeLabelEl = document.createElement('span')
    this._modeLabelEl.textContent = 'Object Mode'
    const arrowEl = document.createElement('span')
    arrowEl.textContent = '▾'
    Object.assign(arrowEl.style, { fontSize: '12px', opacity: '0.6' })
    this._modeBtnEl.setAttribute('aria-haspopup', 'listbox')
    this._modeBtnEl.setAttribute('aria-expanded', 'false')
    this._modeBtnEl.appendChild(this._modeLabelEl)
    this._modeBtnEl.appendChild(arrowEl)

    // Dropdown menu
    this._modeDropdownEl = document.createElement('div')
    Object.assign(this._modeDropdownEl.style, {
      position: 'absolute',
      top: '100%', left: '0',
      background: '#2b2b2b',
      border: '1px solid #555',
      borderRadius: '4px',
      overflow: 'hidden',
      display: 'none',
      zIndex: '200',
      minWidth: '140px',
      marginTop: '2px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    })

    const modeItems = [
      { label: 'Object Mode', value: 'object', hint: 'Tab' },
      { label: 'Edit Mode',   value: 'edit',   hint: 'Tab' },
    ]
    this._dropdownItems = []
    modeItems.forEach(({ label, value, hint }) => {
      const item = document.createElement('div')
      Object.assign(item.style, {
        padding: '7px 12px',
        color: '#e8e8e8',
        cursor: 'pointer',
        fontSize: '13px',
        fontFamily: 'sans-serif',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      })
      const labelSpan = document.createElement('span')
      labelSpan.textContent = label
      const hintSpan = document.createElement('span')
      hintSpan.textContent = hint
      Object.assign(hintSpan.style, { color: '#888', fontSize: '11px' })
      item.appendChild(labelSpan)
      item.appendChild(hintSpan)
      item.dataset.mode = value
      item.addEventListener('mouseenter', () => { item.style.background = '#4a4a4a' })
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
      this._modeDropdownEl.appendChild(item)
      this._dropdownItems.push(item)
    })

    this._modeSelectorEl.appendChild(this._modeBtnEl)
    this._modeSelectorEl.appendChild(this._modeDropdownEl)

    // ── Hamburger button (mobile only — opens Outliner drawer) ────────────
    this._hamburgerBtn = document.createElement('button')
    Object.assign(this._hamburgerBtn.style, {
      padding: '6px',
      background: 'transparent',
      border: 'none',
      color: '#c0c0c0',
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: '1',
      display: 'none',
      marginRight: '2px',
      borderRadius: '6px',
    })
    this._hamburgerBtn.setAttribute('aria-label', 'Toggle outliner')
    this._hamburgerBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`
    this._headerEl.appendChild(this._hamburgerBtn)

    // ── Undo / Redo buttons (mobile only) ────────────────────────────────────
    const _mkHistBtn = (icon, label) => {
      const btn = document.createElement('button')
      Object.assign(btn.style, {
        padding: '5px 7px',
        background: 'transparent',
        border: '1px solid #3a3a3a',
        borderRadius: '6px',
        color: '#c0c0c0',
        cursor: 'pointer',
        lineHeight: '1',
        display: 'none',   // shown only on mobile via _applyMobileLayout
        flexShrink: '0',
        alignItems: 'center',
        justifyContent: 'center',
      })
      btn.setAttribute('aria-label', label)
      btn.innerHTML = icon
      return btn
    }
    this._undoBtn = _mkHistBtn(ICONS.undo, 'Undo')
    this._redoBtn = _mkHistBtn(ICONS.redo, 'Redo')
    this._headerEl.appendChild(this._undoBtn)
    this._headerEl.appendChild(this._redoBtn)

    this._headerEl.appendChild(this._modeSelectorEl)

    // ── Map Mode button ───────────────────────────────────────────────────
    this._mapModeBtn = document.createElement('button')
    Object.assign(this._mapModeBtn.style, {
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid #3a3a3a',
      borderRadius: '5px',
      color: '#aaa',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
    })
    this._mapModeBtn.title = 'Open 2D Map Mode for spatial annotation'
    this._mapModeBtn.innerHTML = `${ICONS.map}<span>Map</span>`
    this._headerEl.appendChild(this._mapModeBtn)
    /** @type {Function|null} */
    this._onMapModeClick = null
    this._mapModeBtn.addEventListener('click', () => {
      if (this._onMapModeClick) this._onMapModeClick()
    })

    // ── Header status (centered within header bar via flex) ───────────────
    this._headerStatusEl = document.createElement('div')
    Object.assign(this._headerStatusEl.style, {
      flex: '1',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '2px',
      fontSize: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      pointerEvents: 'none',
      overflow: 'hidden',
      minWidth: '0',
    })
    this._headerEl.appendChild(this._headerStatusEl)

    // ── N-panel toggle button (mobile only — opens N panel drawer) ────────
    this._nToggleBtn = document.createElement('button')
    Object.assign(this._nToggleBtn.style, {
      padding: '6px',
      background: 'transparent',
      border: 'none',
      color: '#c0c0c0',
      cursor: 'pointer',
      lineHeight: '1',
      display: 'none',
      borderRadius: '6px',
      flexShrink: '0',
    })
    this._nToggleBtn.setAttribute('aria-label', 'Toggle properties panel')
    this._nToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
    this._headerEl.appendChild(this._nToggleBtn)

    // ── More (⋯) button (mobile only — overflow menu for Export/Import) ──────
    this._moreMenuBtn = document.createElement('button')
    Object.assign(this._moreMenuBtn.style, {
      padding: '6px',
      background: 'transparent',
      border: 'none',
      color: '#c0c0c0',
      cursor: 'pointer',
      lineHeight: '1',
      display: 'none',   // shown only on mobile via _applyMobileLayout
      borderRadius: '6px',
      flexShrink: '0',
      alignItems: 'center',
      justifyContent: 'center',
    })
    this._moreMenuBtn.setAttribute('aria-label', 'More file actions')
    this._moreMenuBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`
    // Insert before the N-panel toggle so visual order is: ⋯ | N
    this._headerEl.insertBefore(this._moreMenuBtn, this._nToggleBtn)

    // Dropdown panel anchored to top-right, below the header
    this._moreMenuDropdown = document.createElement('div')
    Object.assign(this._moreMenuDropdown.style, {
      position: 'fixed',
      top: '40px',
      right: '8px',
      background: '#2b2b2b',
      border: '1px solid #555',
      borderRadius: '6px',
      overflow: 'hidden',
      display: 'none',
      zIndex: '200',
      minWidth: '160px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
    })
    document.body.appendChild(this._moreMenuDropdown)

    const _mkMoreItem = (label, svgHtml) => {
      const item = document.createElement('button')
      Object.assign(item.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '10px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid #3a3a3a',
        color: '#e0e0e0',
        cursor: 'pointer',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'left',
      })
      item.innerHTML = `${svgHtml}<span>${label}</span>`
      item.addEventListener('pointerenter', () => { item.style.background = '#3a3a3a' })
      item.addEventListener('pointerleave', () => { item.style.background = 'transparent' })
      return item
    }
    const _exportSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
    const _importSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 14 12 9 17 14"/><line x1="12" y1="9" x2="12" y2="21"/></svg>`

    const moreExportItem = _mkMoreItem('Export', _exportSvg)
    moreExportItem.addEventListener('click', () => {
      this._moreMenuDropdown.style.display = 'none'
      if (this._onExportJson) this._onExportJson()
    })
    this._moreMenuDropdown.appendChild(moreExportItem)

    const moreImportItem = _mkMoreItem('Import', _importSvg)
    moreImportItem.style.borderBottom = 'none'
    moreImportItem.addEventListener('click', () => {
      this._moreMenuDropdown.style.display = 'none'
      if (this._onImportJson) this._onImportJson()
    })
    this._moreMenuDropdown.appendChild(moreImportItem)

    this._moreMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = this._moreMenuDropdown.style.display !== 'none'
      this._moreMenuDropdown.style.display = isOpen ? 'none' : 'block'
    })
    document.addEventListener('click', (e) => {
      if (!this._moreMenuBtn.contains(e.target)) {
        this._moreMenuDropdown.style.display = 'none'
      }
    })

    // ── Save / Load buttons (BFF-gated — hidden until connectBff succeeds) ──
    this._saveBtnEl = document.createElement('button')
    Object.assign(this._saveBtnEl.style, {
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid #3a3a3a',
      borderRadius: '5px',
      color: '#aaa',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1',
      flexShrink: '0',
      display: 'none',
      marginLeft: '4px',
    })
    this._saveBtnEl.title = 'Save scene to server'
    this._saveBtnEl.textContent = 'Save'
    this._headerEl.appendChild(this._saveBtnEl)
    /** @type {Function|null} */
    this._onSaveScene = null
    this._saveBtnEl.addEventListener('click', () => {
      if (this._onSaveScene) this._onSaveScene()
    })

    this._loadBtnEl = document.createElement('button')
    Object.assign(this._loadBtnEl.style, {
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid #3a3a3a',
      borderRadius: '5px',
      color: '#aaa',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1',
      flexShrink: '0',
      display: 'none',
      marginLeft: '4px',
    })
    this._loadBtnEl.title = 'Load scene from server'
    this._loadBtnEl.textContent = 'Load'
    this._headerEl.appendChild(this._loadBtnEl)
    /** @type {Function|null} */
    this._onLoadScene = null
    this._loadBtnEl.addEventListener('click', () => {
      if (this._onLoadScene) this._onLoadScene()
    })

    // ── Node Editor toggle button (Phase B — ADR-017) ─────────────────────
    this._nodeEditorBtn = document.createElement('button')
    Object.assign(this._nodeEditorBtn.style, {
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid #3a3a3a',
      borderRadius: '5px',
      color: '#aaa',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    })
    this._nodeEditorBtn.title = 'Toggle Node Editor (Geometry DAG)'
    this._nodeEditorBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/>
        <line x1="9" y1="12" x2="15" y2="7"/><line x1="9" y1="12" x2="15" y2="17"/>
      </svg>
      Nodes
    `
    this._headerEl.appendChild(this._nodeEditorBtn)
    /** @type {Function|null} Node Editor toggle callback (set by AppController). */
    this._nodeEditorToggle = null
    this._nodeEditorBtn.addEventListener('click', () => {
      if (this._nodeEditorToggle) this._nodeEditorToggle()
    })

    // ── Export JSON button ────────────────────────────────────────────────────
    this._exportJsonBtn = document.createElement('button')
    Object.assign(this._exportJsonBtn.style, {
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid #3a3a3a',
      borderRadius: '5px',
      color: '#aaa',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    })
    this._exportJsonBtn.title = 'Export scene as JSON (Ctrl+E)'
    this._exportJsonBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export
    `
    this._headerEl.appendChild(this._exportJsonBtn)
    /** @type {Function|null} Export JSON callback (set by AppController). */
    this._onExportJson = null
    this._exportJsonBtn.addEventListener('click', () => {
      if (this._onExportJson) this._onExportJson()
    })

    // ── Import JSON button ────────────────────────────────────────────────────
    this._importJsonBtn = document.createElement('button')
    Object.assign(this._importJsonBtn.style, {
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid #3a3a3a',
      borderRadius: '5px',
      color: '#aaa',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    })
    this._importJsonBtn.title = 'Import scene from JSON (Ctrl+I)'
    this._importJsonBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 14 12 9 17 14"/>
        <line x1="12" y1="9" x2="12" y2="21"/>
      </svg>
      Import
    `
    this._headerEl.appendChild(this._importJsonBtn)
    /** @type {Function|null} Import JSON callback (set by AppController). */
    this._onImportJson = null
    this._importJsonBtn.addEventListener('click', () => {
      if (this._onImportJson) this._onImportJson()
    })

    // ── Canvas status overlay (mobile only — floats below header on canvas) ─
    this._canvasStatusEl = document.createElement('div')
    Object.assign(this._canvasStatusEl.style, {
      position: 'fixed',
      top: '48px',
      left: '0', right: '0',
      display: 'none',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: '90',
    })
    this._canvasStatusPillEl = document.createElement('div')
    Object.assign(this._canvasStatusPillEl.style, {
      background: 'rgba(20,20,20,0.75)',
      borderRadius: '14px',
      padding: '4px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      fontSize: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
      maxWidth: '90vw',
      whiteSpace: 'nowrap',
    })
    this._canvasStatusEl.appendChild(this._canvasStatusPillEl)
    document.body.appendChild(this._canvasStatusEl)

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!this._modeSelectorEl.contains(e.target)) {
        this._modeDropdownEl.style.display = 'none'
        this._modeBtnEl.setAttribute('aria-expanded', 'false')
      }
    })

    // ── Bottom info bar (full width) ──────────────────────────────────────
    this._infoEl = document.createElement('div')
    Object.assign(this._infoEl.style, {
      position: 'fixed', bottom: '0', left: '0', right: '0',
      height: '26px',
      background: '#1c1c1c',
      borderTop: '1px solid #111',
      display: 'flex', alignItems: 'center',
      padding: '0 12px',
      color: '#aaa', fontSize: '12px', fontFamily: 'sans-serif',
      pointerEvents: 'none',
      zIndex: '100',
      gap: '0',
    })
    document.body.appendChild(this._infoEl)

    // ── N panel (right side, N-key toggle) ────────────────────────────────
    this._nPanelVisible = false
    this._nPanelEl = document.createElement('div')
    Object.assign(this._nPanelEl.style, {
      position: 'fixed', top: '40px', right: '0',
      width: '200px',
      background: '#2b2b2b',
      borderLeft: '1px solid #1a1a1a',
      color: '#e8e8e8',
      fontFamily: 'sans-serif', fontSize: '12px',
      display: 'none',
      zIndex: '90',
      bottom: '26px',
      overflowY: 'auto',
    })

    // N panel tab header
    const nTabEl = document.createElement('div')
    Object.assign(nTabEl.style, {
      padding: '6px 10px',
      background: '#3a3a3a',
      borderBottom: '1px solid #1a1a1a',
      fontSize: '12px', fontWeight: 'bold',
      color: '#e8e8e8',
      letterSpacing: '0.05em',
    })
    nTabEl.textContent = 'Item'
    this._nPanelEl.appendChild(nTabEl)

    this._nPanelContentEl = document.createElement('div')
    this._nPanelEl.appendChild(this._nPanelContentEl)

    document.body.appendChild(this._nPanelEl)

    // ── Backdrop (mobile drawers) ─────────────────────────────────────────
    this._backdrop   = document.createElement('div')
    this._backdropCb = null
    Object.assign(this._backdrop.style, {
      position: 'fixed',
      top: '40px', bottom: '26px', left: '0', right: '0',
      background: 'rgba(0,0,0,0.5)',
      zIndex: '80',
      display: 'none',
    })
    document.body.appendChild(this._backdrop)

    // ── Mobile floating toolbar (visible only on mobile) ─────────────────
    this._mobileToolbarEl = document.createElement('div')
    Object.assign(this._mobileToolbarEl.style, {
      position: 'fixed',
      bottom: '26px',   // sits on top of info bar
      left: '0', right: '0',
      height: '60px',
      background: 'rgba(26, 26, 28, 0.95)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      display: 'none',   // shown only on mobile
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      padding: '0 12px',
      zIndex: '95',
    })
    document.body.appendChild(this._mobileToolbarEl)

    // ── Extrusion label (floating) ────────────────────────────────────────
    this._extrusionLabelEl = document.createElement('div')
    Object.assign(this._extrusionLabelEl.style, {
      position: 'fixed',
      color: '#ffffff',
      fontSize: '13px',
      fontFamily: 'monospace',
      background: 'rgba(0,0,0,0.72)',
      padding: '3px 10px',
      borderRadius: '4px',
      border: '1px solid rgba(255,255,255,0.45)',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-50%, -50%)',
      whiteSpace: 'nowrap',
    })
    document.body.appendChild(this._extrusionLabelEl)

    this._canvas = null
    this._modeChangeCallback = null
    this._onNameChangeCb = null
    this._onDescriptionChangeCb = null
    this._onFramePositionChangeCb = null
    this._onFrameRotationChangeCb = null
    this._onFrameParentChangeCb   = null
    this._onLocationChangeCb = null
    this._onIfcClassChangeCb = null

    // Apply initial mobile layout and listen for resize
    this._applyMobileLayout()
    window.addEventListener('resize', () => this._applyMobileLayout())
  }

  /** Registers callback for name changes from the N panel */
  onNameChange(callback) { this._onNameChangeCb = callback }

  /** Registers callback for description changes from the N panel */
  onDescriptionChange(callback) { this._onDescriptionChangeCb = callback }

  /** Registers callback for CoordinateFrame position changes from the N panel.
   *  cb(axis: 'x'|'y'|'z', value: number) */
  onFramePositionChange(callback) { this._onFramePositionChangeCb = callback }

  /** Registers callback for CoordinateFrame rotation changes from the N panel.
   *  cb(axis: 'x'|'y'|'z', valueDeg: number) */
  onFrameRotationChange(callback) { this._onFrameRotationChangeCb = callback }

  /** Registers callback for CoordinateFrame parent changes from the N panel.
   *  cb(newParentId: string) */
  onFrameParentChange(callback) { this._onFrameParentChangeCb = callback }

  /** Registers callback for geometry object location changes from the N panel.
   *  cb(axis: 'x'|'y'|'z', value: number) */
  onLocationChange(callback) { this._onLocationChangeCb = callback }

  /** Registers callback for IFC class changes from the N panel.
   *  cb(ifcClass: string|null)  — null means "clear classification" */
  onIfcClassChange(callback) { this._onIfcClassChangeCb = callback }

  /** Registers callback for place type changes from the N panel.
   *  cb(placeType: string|null)  — null means "clear classification" */
  onPlaceTypeChange(callback) { this._onPlaceTypeChangeCb = callback }

  /** Registers callback for the Map Mode button click */
  onMapModeClick(callback) { this._onMapModeClick = callback }

  /** Registers callback for mode changes */
  onModeChange(callback) {
    this._modeChangeCallback = callback

    this._modeBtnEl.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = this._modeDropdownEl.style.display !== 'none'
      this._modeDropdownEl.style.display = isOpen ? 'none' : 'block'
      this._modeBtnEl.setAttribute('aria-expanded', isOpen ? 'false' : 'true')
    })

    this._dropdownItems.forEach(item => {
      item.addEventListener('click', () => {
        callback(item.dataset.mode)
        this._modeDropdownEl.style.display = 'none'
        this._modeBtnEl.setAttribute('aria-expanded', 'false')
      })
    })
  }

  /**
   * Updates mode button label, dropdown active state, and info bar.
   * @param {'object'|'edit'} mode
   * @param {'2d'|'3d'|null} [subtype]
   */
  updateMode(mode, subtype = null) {
    let label = { object: 'Object Mode', edit: 'Edit Mode' }[mode] || mode
    if (mode === 'edit' && subtype) label += ` \u00b7 ${subtype.toUpperCase()}`
    this._modeLabelEl.textContent = label

    // Highlight active item in dropdown
    this._dropdownItems.forEach(item => {
      item.style.color = item.dataset.mode === mode ? '#4fc3f7' : '#e8e8e8'
    })

    this._setInfoText(mode, subtype)
  }

  _setInfoText(mode, subtype = null) {
    this._infoEl.innerHTML = ''
    // On mobile the footer shows live status text instead of keyboard hints.
    if (this._isMobile()) return

    let shortcuts
    if (mode === 'object') {
      shortcuts = [
        ['Tab', 'Edit Mode'],
        ['G', 'Grab'],
        ['G > X/Y/Z', 'Axis'],
        ['G > S', 'Stack'],
        ['G > V', 'Pivot'],
        ['Shift+A', 'Add'],
        ['Shift+D', 'Duplicate'],
        ['M', 'Measure'],
        ['X', 'Delete'],
        ['N', 'Properties'],
      ]
    } else if (subtype === '2d') {
      shortcuts = [
        ['Tab', 'Object Mode'],
        ['Drag', 'Draw rectangle'],
        ['Enter', 'Extrude'],
        ['Esc', 'Cancel'],
      ]
    } else if (subtype === '2d-extrude') {
      shortcuts = [
        ['Drag', 'Set height'],
        ['0-9', 'Type height'],
        ['Enter', 'Confirm'],
        ['Esc', 'Back to sketch'],
      ]
    } else {
      shortcuts = [
        ['Tab', 'Object Mode'],
        ['1', 'Vertex'],
        ['2', 'Edge'],
        ['3', 'Face'],
        ['E', 'Extrude face'],
        ['Shift+Click', 'Multi-select'],
        ['N', 'Properties'],
      ]
    }

    shortcuts.forEach(([key, desc], i) => {
      if (i > 0) {
        const sep = document.createElement('span')
        sep.textContent = '  |  '
        Object.assign(sep.style, { color: '#555' })
        this._infoEl.appendChild(sep)
      }
      const keyEl = document.createElement('span')
      keyEl.textContent = key
      Object.assign(keyEl.style, {
        background: '#444',
        border: '1px solid #666',
        borderRadius: '3px',
        padding: '0 4px',
        color: '#ddd',
        fontSize: '11px',
        marginRight: '3px',
        fontFamily: 'monospace',
      })
      const descEl = document.createElement('span')
      descEl.textContent = desc
      this._infoEl.appendChild(keyEl)
      this._infoEl.appendChild(descEl)
    })
  }

  /**
   * Appends (or replaces) an extra shortcut hint at the end of the info bar.
   * Idempotent — subsequent calls replace the previous extra hint.
   * No-op on mobile (info bar shows live status there).
   * Pass null/undefined to remove the extra hint.
   * @param {string|null} key
   * @param {string} [desc]
   */
  appendInfoHint(key, desc) {
    if (this._isMobile()) return
    // Remove any previously-appended extra hint group
    this._infoEl.querySelectorAll('[data-extra-hint]').forEach(el => el.remove())
    if (!key) return
    const sep = document.createElement('span')
    sep.textContent = '  |  '
    sep.dataset.extraHint = '1'
    Object.assign(sep.style, { color: '#555' })
    this._infoEl.appendChild(sep)
    const keyEl = document.createElement('span')
    keyEl.textContent = key
    keyEl.dataset.extraHint = '1'
    Object.assign(keyEl.style, {
      background: '#444',
      border: '1px solid #666',
      borderRadius: '3px',
      padding: '0 4px',
      color: '#ddd',
      fontSize: '11px',
      marginRight: '3px',
      fontFamily: 'monospace',
    })
    const descEl = document.createElement('span')
    descEl.textContent = desc
    descEl.dataset.extraHint = '1'
    this._infoEl.appendChild(keyEl)
    this._infoEl.appendChild(descEl)
  }

  /**
   * Shows an Add menu popup at screen position (x, y).
   * @param {number} x - screen X
   * @param {number} y - screen Y
   * @param {() => void} onBox
   * @param {() => void} onSketch
   * @param {() => void} [onMeasure]
   * @param {() => void} [onImportStep]
   * @param {() => void} [onFrame]  shown only when a geometry object is active
   */
  /**
   * @param {number} x
   * @param {number} y
   * @param {() => void} onBox
   * @param {() => void} onSketch
   * @param {() => void} [onMeasure]
   * @param {() => void} [onImportStep]
   * @param {() => void} [onFrame]
   */
  showAddMenu(x, y, onBox, onSketch, onMeasure, onImportStep, onFrame) {
    this.hideAddMenu()
    const menu = document.createElement('div')
    Object.assign(menu.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      background: '#2b2b2b',
      border: '1px solid #555',
      borderRadius: '4px',
      zIndex: '300',
      minWidth: '140px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      overflow: 'hidden',
    })
    const title = document.createElement('div')
    Object.assign(title.style, {
      padding: '5px 10px 4px',
      fontSize: '11px',
      color: '#888',
      borderBottom: '1px solid #444',
      fontFamily: 'sans-serif',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    })
    title.textContent = 'Add'
    menu.appendChild(title)

    const makeItem = (label, hint, cb, extra = '') => {
      const item = document.createElement('div')
      Object.assign(item.style, {
        padding: '7px 12px',
        color: '#e8e8e8',
        cursor: 'pointer',
        fontSize: '13px',
        fontFamily: 'sans-serif',
        display: 'flex',
        justifyContent: 'space-between',
        gap: '16px',
      })
      const labelEl = document.createElement('span')
      labelEl.textContent = label + extra
      item.appendChild(labelEl)
      if (hint) {
        const hintEl = document.createElement('span')
        hintEl.textContent = hint
        Object.assign(hintEl.style, { color: '#888', fontSize: '11px' })
        item.appendChild(hintEl)
      }
      item.addEventListener('mouseenter', () => { item.style.background = '#4a4a4a' })
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
      if (cb) item.addEventListener('click', () => { this.hideAddMenu(); cb() })
      return item
    }

    const items = [
      ...(onMeasure    ? [{ label: 'Measure',          hint: 'M', cb: onMeasure }]    : []),
      { label: 'Box',              hint: 'Shift+A', cb: onBox },
      { label: 'Sketch',           hint: '',        cb: onSketch },
      ...(onFrame      ? [{ label: 'Coordinate Frame', hint: '',  cb: onFrame }]      : []),
      ...(onImportStep ? [{ label: 'Import STEP',      hint: '',  cb: onImportStep }] : []),
    ]
    items.forEach(({ label, hint, cb }) => menu.appendChild(makeItem(label, hint, cb)))

    document.body.appendChild(menu)
    this._addMenuEl = menu

    // Close on outside click
    this._addMenuCloseHandler = (e) => {
      if (!menu.contains(e.target)) this.hideAddMenu()
    }
    setTimeout(() => document.addEventListener('click', this._addMenuCloseHandler), 0)
  }

  /** Removes the Add menu if visible */
  hideAddMenu() {
    if (this._addMenuEl) {
      this._addMenuEl.remove()
      this._addMenuEl = null
    }
    if (this._addMenuCloseHandler) {
      document.removeEventListener('click', this._addMenuCloseHandler)
      this._addMenuCloseHandler = null
    }
  }

  // ── 2D Map Mode toolbar ──────────────────────────────────────────────────

  /**
   * Shows the 2D Map Mode toolbar on the left side of the screen.
   * Place-type buttons let the user pick what to draw; Confirm/Cancel appear
   * only when a drawing is in progress.
   *
   * @param {string|null} activeTool  - currently selected tool ('path'|'edge'|'district'|'node'|'landmark'|null)
   * @param {(type: string) => void} onToolSelect  - called when user clicks a type button
   * @param {(() => void)|null} onConfirm  - called when Confirm clicked (null = hidden)
   * @param {() => void} onCancel   - called when Cancel clicked
   * @param {() => void} onExit     - called when Exit Map clicked
   */
  showMapToolbar(activeTool, onToolSelect, onConfirm, onCancel, onExit) {
    this.hideMapToolbar()

    const toolbar = document.createElement('div')
    toolbar.id = '_mapToolbar'
    Object.assign(toolbar.style, {
      position: 'fixed',
      top: '50%',
      left: '8px',
      transform: 'translateY(-50%)',
      background: '#1e1e2e',
      border: '1px solid #3a3a4a',
      borderRadius: '8px',
      padding: '6px',
      zIndex: '150',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      userSelect: 'none',
      minWidth: '44px',
    })

    const TOOL_ITEMS = [
      { type: 'route',    label: '⟿',  title: 'Route (経路)',       color: '#4A90D9' },
      { type: 'boundary', label: '⟿',  title: 'Boundary (境界)',    color: '#E74C3C' },
      { type: 'zone',     label: '⬡',  title: 'Zone (ゾーン)',      color: '#27AE60' },
      { type: 'hub',      label: '⬤',  title: 'Hub (ハブ)',         color: '#F39C12' },
      { type: 'anchor',   label: '⬤',  title: 'Anchor (アンカー)',  color: '#9B59B6' },
    ]

    const sep = () => {
      const d = document.createElement('div')
      Object.assign(d.style, { height: '1px', background: '#3a3a4a', margin: '2px 0' })
      return d
    }

    // Tool buttons
    TOOL_ITEMS.forEach(({ type, label, title, color }) => {
      const btn = document.createElement('button')
      const isActive = activeTool === type
      Object.assign(btn.style, {
        width: '36px', height: '36px',
        background: isActive ? color + '33' : 'transparent',
        border: isActive ? `1.5px solid ${color}` : '1.5px solid transparent',
        borderRadius: '6px',
        color,
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '1',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.1s',
      })
      btn.title = title
      btn.textContent = label
      btn.addEventListener('mouseenter', () => {
        if (activeTool !== type) btn.style.background = color + '22'
      })
      btn.addEventListener('mouseleave', () => {
        if (activeTool !== type) btn.style.background = 'transparent'
      })
      btn.addEventListener('click', () => onToolSelect(type))
      toolbar.appendChild(btn)
    })

    // Confirm / Cancel (drawing in progress)
    if (onConfirm !== null || onCancel) {
      toolbar.appendChild(sep())

      if (onConfirm) {
        const confirmBtn = document.createElement('button')
        Object.assign(confirmBtn.style, {
          width: '36px', height: '36px',
          background: '#1a3a1a',
          border: '1.5px solid #4caf50',
          borderRadius: '6px',
          color: '#4caf50',
          cursor: 'pointer',
          fontSize: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        })
        confirmBtn.title = 'Confirm (Enter)'
        confirmBtn.innerHTML = ICONS.confirm
        confirmBtn.addEventListener('click', () => onConfirm())
        toolbar.appendChild(confirmBtn)
      }

      if (onCancel) {
        const cancelBtn = document.createElement('button')
        Object.assign(cancelBtn.style, {
          width: '36px', height: '36px',
          background: '#3a1a1a',
          border: '1.5px solid #e74c3c',
          borderRadius: '6px',
          color: '#e74c3c',
          cursor: 'pointer',
          fontSize: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        })
        cancelBtn.title = 'Cancel drawing (Escape)'
        cancelBtn.innerHTML = ICONS.cancel
        cancelBtn.addEventListener('click', () => onCancel())
        toolbar.appendChild(cancelBtn)
      }
    }

    // Exit button
    toolbar.appendChild(sep())
    const exitBtn = document.createElement('button')
    Object.assign(exitBtn.style, {
      width: '36px', height: '36px',
      background: 'transparent',
      border: '1.5px solid #555',
      borderRadius: '6px',
      color: '#aaa',
      cursor: 'pointer',
      fontSize: '10px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: '1',
    })
    exitBtn.title = 'Exit Map Mode'
    exitBtn.innerHTML = ICONS.back
    exitBtn.addEventListener('click', () => onExit())
    toolbar.appendChild(exitBtn)

    document.body.appendChild(toolbar)
    this._mapToolbarEl = toolbar
  }

  /** Removes the Map Mode toolbar. */
  hideMapToolbar() {
    const existing = document.getElementById('_mapToolbar')
    if (existing) existing.remove()
    this._mapToolbarEl = null
  }

  /**
   * Shows a floating context menu near (x, y).
   * `items` is an array of `{ label, onClick, danger? }`.
   * Automatically dismissed on outside tap/click.
   * @param {number} x - client X
   * @param {number} y - client Y
   * @param {Array<{label: string, onClick: () => void, danger?: boolean}>} items
   */
  showContextMenu(x, y, items) {
    this.hideContextMenu()
    const menu = document.createElement('div')
    Object.assign(menu.style, {
      position: 'fixed',
      background: '#2b2b2b',
      border: '1px solid #555',
      borderRadius: '10px',
      zIndex: '400',
      minWidth: '160px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    })
    items.forEach(({ label, onClick, danger = false }) => {
      const item = document.createElement('button')
      Object.assign(item.style, {
        display: 'block',
        width: '100%',
        padding: '13px 18px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        color: danger ? '#e74c3c' : '#e8e8e8',
        cursor: 'pointer',
        fontSize: '15px',
        textAlign: 'left',
        fontFamily: 'inherit',
      })
      item.textContent = label
      item.addEventListener('pointerdown', (e) => { e.stopPropagation() })
      item.addEventListener('click', () => { this.hideContextMenu(); onClick() })
      menu.appendChild(item)
    })
    // Remove bottom border from last item
    if (menu.lastElementChild) menu.lastElementChild.style.borderBottom = 'none'

    // Position: prefer above finger, shift left so it doesn't clip right edge
    const W = window.innerWidth, H = window.innerHeight
    const estH = items.length * 50
    const left = Math.min(x - 80, W - 180)
    const top  = y - estH - 12 < 40 ? y + 12 : y - estH - 12
    menu.style.left = `${Math.max(8, left)}px`
    menu.style.top  = `${Math.max(48, top)}px`

    document.body.appendChild(menu)
    this._contextMenuEl = menu

    this._contextMenuCloseHandler = (e) => {
      if (!menu.contains(e.target)) this.hideContextMenu()
    }
    setTimeout(() => document.addEventListener('pointerdown', this._contextMenuCloseHandler), 0)
  }

  /** Removes the context menu if visible */
  hideContextMenu() {
    if (this._contextMenuEl) {
      this._contextMenuEl.remove()
      this._contextMenuEl = null
    }
    if (this._contextMenuCloseHandler) {
      document.removeEventListener('pointerdown', this._contextMenuCloseHandler)
      this._contextMenuCloseHandler = null
    }
  }

  /**
   * Shows a small inline rename dialog with the given current name pre-filled.
   * Calls `callback(newName)` when confirmed; calls `callback(null)` on cancel.
   * @param {string} currentName
   * @param {(name: string|null) => void} callback
   */
  showRenameDialog(currentName, callback) {
    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.55)',
      zIndex: '500',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    })

    const box = document.createElement('div')
    Object.assign(box.style, {
      background: '#2b2b2b',
      border: '1px solid #555',
      borderRadius: '12px',
      padding: '20px 20px 16px',
      minWidth: '260px',
      maxWidth: '90vw',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    })

    const title = document.createElement('div')
    title.textContent = 'Rename'
    Object.assign(title.style, { color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' })

    const input = document.createElement('input')
    input.type = 'text'
    input.value = currentName
    Object.assign(input.style, {
      display: 'block', width: '100%', boxSizing: 'border-box',
      background: '#1e1e1e', border: '1px solid #555', borderRadius: '6px',
      color: '#e8e8e8', fontSize: '15px', padding: '8px 10px',
      fontFamily: 'inherit', outline: 'none', marginBottom: '14px',
    })

    const row = document.createElement('div')
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' })

    const mkBtn = (text, primary) => {
      const b = document.createElement('button')
      b.textContent = text
      Object.assign(b.style, {
        padding: '8px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer',
        fontSize: '14px', fontFamily: 'inherit',
        background: primary ? '#4fc3f7' : 'rgba(255,255,255,0.08)',
        color: primary ? '#111' : '#d8d8d8',
        fontWeight: primary ? '600' : '400',
      })
      return b
    }
    const btnCancel = mkBtn('Cancel', false)
    const btnOk     = mkBtn('OK', true)
    row.appendChild(btnCancel)
    row.appendChild(btnOk)

    box.appendChild(title)
    box.appendChild(input)
    box.appendChild(row)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    const close = (val) => { overlay.remove(); callback(val) }
    btnCancel.addEventListener('click', () => close(null))
    btnOk.addEventListener('click',     () => close(input.value.trim() || currentName))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); close(input.value.trim() || currentName) }
      if (e.key === 'Escape') { close(null) }
    })

    requestAnimationFrame(() => { input.focus(); input.select() })
  }

  /**
   * Updates the header status with plain text.
   * @param {string} text
   */
  setStatus(text) {
    this._headerStatusEl.innerHTML = ''
    this._canvasStatusPillEl.innerHTML = ''
    if (this._isMobile()) this._infoEl.innerHTML = ''
    if (!text) return
    const mkSpan = (parent) => {
      const span = document.createElement('span')
      span.textContent = text
      Object.assign(span.style, { color: '#c8c8c8' })
      parent.appendChild(span)
    }
    mkSpan(this._headerStatusEl)
    mkSpan(this._canvasStatusPillEl)
    if (this._isMobile()) mkSpan(this._infoEl)
  }

  /**
   * Updates the header status with rich colored segments.
   * Each part: { text: string, color?: string, bold?: boolean, dim?: boolean }
   * Segments are separated by a dimmed `·` dot.
   * @param {{ text: string, color?: string, bold?: boolean }[]} parts
   */
  setStatusRich(parts) {
    const fill = (parent) => {
      parent.innerHTML = ''
      parts.forEach((part, i) => {
        if (i > 0) {
          const sep = document.createElement('span')
          sep.textContent = '·'
          Object.assign(sep.style, { color: '#4a4a4a', margin: '0 4px' })
          parent.appendChild(sep)
        }
        const span = document.createElement('span')
        span.textContent = part.text
        Object.assign(span.style, {
          color: part.color ?? '#c8c8c8',
          fontWeight: part.bold ? 'bold' : 'normal',
          letterSpacing: part.bold ? '0.02em' : 'normal',
        })
        parent.appendChild(span)
      })
    }
    fill(this._headerStatusEl)
    fill(this._canvasStatusPillEl)
    if (this._isMobile()) fill(this._infoEl)
  }

  /**
   * Shows the first-run gesture hint overlay on mobile.
   * Skipped if the user has already dismissed it (localStorage flag).
   * The overlay auto-dismisses after 4 s or on any tap.
   */
  showOnboardingIfNeeded() {
    if (!this._isMobile()) return
    if (localStorage.getItem('ee_onboarded') === '1') return

    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position:        'fixed',
      inset:           '0',
      background:      'rgba(0,0,0,0.72)',
      zIndex:          '500',
      display:         'flex',
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             '28px',
      padding:         '32px',
      fontFamily:      'system-ui, -apple-system, sans-serif',
      color:           '#e8e8e8',
      userSelect:      'none',
      WebkitUserSelect:'none',
    })

    const hints = [
      { svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round"><circle cx="22" cy="14" r="5"/><path d="M22 19 Q16 28 18 38"/><path d="M22 19 Q28 28 26 38"/></svg>`,  text: 'ドラッグ  →  視点回転' },
      { svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round"><circle cx="14" cy="14" r="4"/><circle cx="30" cy="14" r="4"/><path d="M14 18 Q14 32 14 36"/><path d="M30 18 Q30 32 30 36"/><path d="M10 24 L34 24" stroke-dasharray="3 3"/></svg>`, text: 'ピンチ  →  ズーム' },
      { svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#81c784" stroke-width="2" stroke-linecap="round"><circle cx="22" cy="22" r="7" stroke-dasharray="2 2"/><circle cx="22" cy="22" r="2" fill="#81c784" stroke="none"/><line x1="22" y1="6" x2="22" y2="14"/><line x1="22" y1="30" x2="22" y2="38"/><line x1="6" y1="22" x2="14" y2="22"/><line x1="30" y1="22" x2="38" y2="22"/></svg>`, text: 'タップ  →  オブジェクト選択' },
      { svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#ffb74d" stroke-width="2" stroke-linecap="round"><rect x="8" y="28" width="28" height="10" rx="2"/><circle cx="22" cy="14" r="5"/><line x1="22" y1="19" x2="22" y2="28"/></svg>`, text: '長押し  →  移動 (Grab)' },
    ]

    hints.forEach(({ svg, text }) => {
      const row = document.createElement('div')
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '18px',
        width: '100%', maxWidth: '280px',
      })
      const icon = document.createElement('div')
      icon.innerHTML = svg
      icon.style.flexShrink = '0'
      const label = document.createElement('span')
      label.textContent = text
      Object.assign(label.style, { fontSize: '15px', lineHeight: '1.4' })
      row.appendChild(icon)
      row.appendChild(label)
      overlay.appendChild(row)
    })

    const dismiss = document.createElement('div')
    dismiss.textContent = 'タップして閉じる'
    Object.assign(dismiss.style, {
      marginTop: '8px', fontSize: '13px', color: '#888',
    })
    overlay.appendChild(dismiss)

    const close = () => {
      localStorage.setItem('ee_onboarded', '1')
      overlay.remove()
    }
    overlay.addEventListener('pointerdown', close, { once: true })
    const timer = setTimeout(close, 4000)
    overlay.addEventListener('pointerdown', () => clearTimeout(timer), { once: true })

    document.body.appendChild(overlay)
  }

  /**
   * Shows a brief toast notification at the bottom of the screen.
   * @param {string} message
   * @param {{ type?: 'info'|'warn'|'error', duration?: number }} [options]
   */
  showToast(message, { type = 'info', duration = 2500 } = {}) {
    const colors = { info: '#4a90d9', warn: '#e6a020', error: '#e05252' }
    const color = colors[type]
    // On mobile the floating toolbar occupies bottom 26–86px, so lift the toast above it.
    const bottomPx = this._isMobile() ? '96px' : '64px'

    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed',
      bottom: bottomPx,
      left: '50%',
      transform: 'translateX(-50%) translateY(20px)',
      opacity: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      background: 'rgba(28, 28, 32, 0.85)',
      backdropFilter: 'blur(12px)',
      webkitBackdropFilter: 'blur(12px)',
      color: '#f0f0f0',
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.08)',
      borderLeft: `3px solid ${color}`,
      padding: '10px 18px',
      fontSize: '13px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: '450',
      letterSpacing: '0.01em',
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      zIndex: '9999',
      pointerEvents: 'none',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
      whiteSpace: 'nowrap',
    })

    // Colored dot indicator
    const dot = document.createElement('span')
    Object.assign(dot.style, {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: color,
      flexShrink: '0',
    })
    el.appendChild(dot)
    el.appendChild(document.createTextNode(message))

    document.body.appendChild(el)
    // Slide in on next frame so the initial state is painted first
    requestAnimationFrame(() => {
      el.style.opacity = '1'
      el.style.transform = 'translateX(-50%) translateY(0)'
    })
    setTimeout(() => {
      el.style.opacity = '0'
      el.style.transform = 'translateX(-50%) translateY(20px)'
      el.addEventListener('transitionend', () => el.remove(), { once: true })
    }, duration)
  }

  // ── STEP import progress overlay ───────────────────────────────────────────

  /**
   * Shows (or updates) a progress overlay at the bottom-center of the screen.
   * @param {number} percent  0–100
   * @param {string} status   short status label
   */
  showImportProgress(percent, status) {
    if (!this._importProgressEl) {
      const bottomPx = this._isMobile() ? '96px' : '64px'

      const el = document.createElement('div')
      Object.assign(el.style, {
        position:       'fixed',
        bottom:         bottomPx,
        left:           '50%',
        transform:      'translateX(-50%)',
        background:     'rgba(28, 28, 32, 0.92)',
        backdropFilter: 'blur(12px)',
        webkitBackdropFilter: 'blur(12px)',
        color:          '#f0f0f0',
        borderRadius:   '12px',
        border:         '1px solid rgba(255,255,255,0.08)',
        borderLeft:     '3px solid #4a90d9',
        padding:        '12px 20px',
        fontSize:       '12px',
        fontFamily:     'system-ui, -apple-system, sans-serif',
        boxShadow:      '0 8px 32px rgba(0,0,0,0.45)',
        zIndex:         '9998',
        pointerEvents:  'none',
        minWidth:       '240px',
        display:        'flex',
        flexDirection:  'column',
        gap:            '8px',
        opacity:        '0',
        transition:     'opacity 0.2s ease',
      })

      const labelRow = document.createElement('div')
      Object.assign(labelRow.style, {
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            '12px',
      })

      const icon = document.createElement('span')
      icon.textContent = '⏳'
      icon.style.fontSize = '13px'

      const statusEl = document.createElement('span')
      statusEl.style.flex = '1'
      statusEl._isStatus = true

      const pctEl = document.createElement('span')
      pctEl.style.color = '#aad4f5'
      pctEl.style.fontVariantNumeric = 'tabular-nums'
      pctEl._isPct = true

      labelRow.append(icon, statusEl, pctEl)

      const track = document.createElement('div')
      Object.assign(track.style, {
        height:       '3px',
        borderRadius: '2px',
        background:   'rgba(255,255,255,0.12)',
        overflow:     'hidden',
      })

      const fill = document.createElement('div')
      Object.assign(fill.style, {
        height:     '100%',
        width:      '0%',
        borderRadius: '2px',
        background: '#4a90d9',
        transition: 'width 0.3s ease',
      })
      fill._isFill = true
      track.appendChild(fill)

      el.append(labelRow, track)
      document.body.appendChild(el)
      this._importProgressEl = el

      requestAnimationFrame(() => { el.style.opacity = '1' })
    }

    const el     = this._importProgressEl
    const statusEl = el.querySelector('[data-role="status"]') ??
                     [...el.querySelectorAll('span')].find(s => s._isStatus)
    const pctEl    = [...el.querySelectorAll('span')].find(s => s._isPct)
    const fillEl   = [...el.querySelectorAll('div')].find(d => d._isFill)

    if (statusEl) statusEl.textContent = status ?? 'Importing…'
    if (pctEl)    pctEl.textContent    = `${Math.round(percent ?? 0)}%`
    if (fillEl)   fillEl.style.width   = `${Math.min(100, Math.max(0, percent ?? 0))}%`
  }

  /** Removes the import progress overlay. */
  hideImportProgress() {
    if (!this._importProgressEl) return
    const el = this._importProgressEl
    this._importProgressEl = null
    el.style.opacity = '0'
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }

  /** Returns true if the N panel is currently visible */
  get nPanelVisible() {
    return this._nPanelVisible
  }

  /** Toggles N panel visibility */
  toggleNPanel() {
    this._nPanelVisible = !this._nPanelVisible
    if (this._isMobile()) {
      this._nPanelEl.style.transform = this._nPanelVisible ? 'translateX(0)' : 'translateX(100%)'
    } else {
      this._nPanelEl.style.display = this._nPanelVisible ? 'block' : 'none'
    }
  }

  // ─── Mobile layout ─────────────────────────────────────────────────────────

  _isMobile() { return window.innerWidth < 768 }

  _applyMobileLayout() {
    const mobile = this._isMobile()
    this._hamburgerBtn.style.display = mobile ? 'block' : 'none'
    this._undoBtn.style.display = mobile ? 'flex' : 'none'
    this._redoBtn.style.display = mobile ? 'flex' : 'none'
    this._nToggleBtn.style.display = mobile ? 'block' : 'none'
    this._nToggleBtn.style.marginLeft = ''
    // ⋯ overflow menu is mobile-only; Export/Import buttons are desktop-only
    this._moreMenuBtn.style.display = mobile ? 'flex' : 'none'
    this._exportJsonBtn.style.display = mobile ? 'none' : 'flex'
    this._importJsonBtn.style.display = mobile ? 'none' : 'flex'
    this._mobileToolbarEl.style.display = mobile ? 'flex' : 'none'
    // Nodes button is desktop-only (NodeEditorView is not mobile-optimised)
    this._nodeEditorBtn.style.display = mobile ? 'none' : 'flex'
    // On mobile, status moves to the footer info bar.
    // Keep headerStatusEl as a flex:1 spacer (visibility:hidden) so ⋯ and N
    // buttons remain right-aligned without needing marginLeft:auto.
    this._headerStatusEl.style.display = 'flex'
    this._headerStatusEl.style.visibility = mobile ? 'hidden' : 'visible'
    this._canvasStatusEl.style.display = 'none'
    // Center the footer status text on mobile
    this._infoEl.style.justifyContent = mobile ? 'center' : 'flex-start'
    if (mobile) {
      Object.assign(this._nPanelEl.style, {
        display:    'block',
        transition: 'transform 0.25s ease',
        transform:  this._nPanelVisible ? 'translateX(0)' : 'translateX(100%)',
      })
    } else {
      Object.assign(this._nPanelEl.style, {
        display:    this._nPanelVisible ? 'block' : 'none',
        transition: '',
        transform:  'none',
      })
    }
  }

  /** Shows the backdrop; calls onClose when user taps it */
  showBackdrop(onClose) {
    this._backdrop.style.display = 'block'
    this._backdropCb = () => { this.hideBackdrop(); onClose?.() }
    this._backdrop.addEventListener('click', this._backdropCb, { once: true })
  }

  /** Hides the backdrop */
  hideBackdrop() {
    this._backdrop.style.display = 'none'
    if (this._backdropCb) {
      this._backdrop.removeEventListener('click', this._backdropCb)
      this._backdropCb = null
    }
  }

  /** Registers callback for Outliner hamburger button tap (mobile) */
  onOutlinerToggle(cb) { this._hamburgerBtn.addEventListener('click', cb) }

  /** Registers callback for N-panel toggle button tap (mobile) */
  onNPanelToggle(cb) { this._nToggleBtn.addEventListener('click', cb) }

  /** Registers undo callback for the mobile header undo button. */
  onUndoClick(cb) { this._undoBtn.addEventListener('click', cb) }

  /** Registers redo callback for the mobile header redo button. */
  onRedoClick(cb) { this._redoBtn.addEventListener('click', cb) }

  /**
   * Updates the enabled/disabled visual state of the mobile undo/redo buttons.
   * @param {boolean} canUndo
   * @param {boolean} canRedo
   */
  setUndoRedoEnabled(canUndo, canRedo) {
    const apply = (btn, enabled) => {
      btn.style.color  = enabled ? '#c0c0c0' : '#484848'
      btn.style.borderColor = enabled ? '#3a3a3a' : '#2a2a2a'
      btn.style.cursor = enabled ? 'pointer' : 'default'
    }
    apply(this._undoBtn, canUndo)
    apply(this._redoBtn, canRedo)
  }

  /** Registers callback for Node Editor toggle button (header bar, Phase B) */
  onNodeEditorToggle(cb) { this._nodeEditorToggle = cb }

  /** Registers callback for Export JSON button (header bar). */
  onExportJson(cb) { this._onExportJson = cb }

  /** Registers callback for Import JSON button (header bar). */
  onImportJson(cb) { this._onImportJson = cb }

  /**
   * Shows a modal asking the user whether to clear the scene before importing
   * or to merge the imported objects into the current scene.
   *
   * Returns a Promise that resolves to:
   *   'clear'  — user chose "Clear and import"
   *   'merge'  — user chose "Merge into current scene"
   *   null     — user cancelled
   *
   * @param {string} filename  Name of the file being imported (shown in title)
   * @returns {Promise<'clear'|'merge'|null>}
   */
  showImportModal(filename) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.6)',
        'display:flex;align-items:center;justify-content:center;z-index:10000',
      ].join(';')

      const dlg = document.createElement('div')
      dlg.style.cssText = [
        'background:#1a2030;border:1px solid #2a3a4a;border-radius:8px',
        'padding:20px 24px;min-width:320px;max-width:420px;color:#ecf0f1;font-family:monospace',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      ].join(';')

      const title = document.createElement('div')
      title.textContent = 'Import JSON'
      title.style.cssText = 'font-size:13px;font-weight:bold;margin-bottom:6px;color:#aad4f5'
      dlg.appendChild(title)

      const sub = document.createElement('div')
      sub.textContent = filename
      sub.style.cssText = 'font-size:11px;color:#7a9ab5;margin-bottom:16px;word-break:break-all'
      dlg.appendChild(sub)

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap'

      const btnCancel = document.createElement('button')
      btnCancel.textContent = 'Cancel'
      btnCancel.style.cssText = [
        'padding:6px 14px;background:#2c3e50;color:#ecf0f1;border:1px solid #3a4a5a',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px',
      ].join(';')

      const btnMerge = document.createElement('button')
      btnMerge.textContent = 'Merge into scene'
      btnMerge.style.cssText = [
        'padding:6px 14px;background:#2c3e50;color:#ecf0f1;border:1px solid #3a7a5a',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px',
      ].join(';')

      const btnClear = document.createElement('button')
      btnClear.textContent = 'Clear and import'
      btnClear.style.cssText = [
        'padding:6px 14px;background:#e67e22;color:#fff;border:none',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold',
      ].join(';')

      btnRow.appendChild(btnCancel)
      btnRow.appendChild(btnMerge)
      btnRow.appendChild(btnClear)
      dlg.appendChild(btnRow)
      overlay.appendChild(dlg)
      document.body.appendChild(overlay)

      const close = (result) => { document.body.removeChild(overlay); resolve(result) }
      btnCancel.addEventListener('click', () => close(null))
      btnMerge.addEventListener('click',  () => close('merge'))
      btnClear.addEventListener('click',  () => close('clear'))
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
    })
  }

  /**
   * Shows Save/Load buttons in the header and registers their callbacks.
   * Call this after BFF connection succeeds.
   * @param {Function} onSave  Called when Save button is clicked
   * @param {Function} onLoad  Called when Load button is clicked
   */
  enableSaveLoad(onSave, onLoad) {
    this._onSaveScene = onSave
    this._onLoadScene = onLoad
    this._saveBtnEl.style.display = ''
    this._loadBtnEl.style.display = ''
  }

  /**
   * Updates N panel content.
   * @param {{ x: number, y: number, z: number }} centroid
   * @param {{ x: number, y: number, z: number }} dimensions
   * @param {string} [name]
   * @param {string} [description]
   * @param {{ locationEditable?: boolean }} [options]
   */
  updateNPanel(centroid, dimensions, name = '', description = '', options = {}) {
    if (!this._nPanelVisible) return
    const {
      locationEditable = false,
      ifcClass = undefined, showIfcClass = false,
      placeType = undefined, showPlaceType = false, placeTypeGeometry = null,
      spatialLinks = null,          // SpatialLink[] | null
      onDeleteSpatialLink = null,   // (linkId: string) => void
      getEntityName = (id) => id,   // (id: string) => string
    } = options

    const editRow = (axis, color, val, onChange) => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        display: 'grid', gridTemplateColumns: '18px 1fr',
        gap: '2px 4px', padding: '1px 0', alignItems: 'center',
      })
      const axisEl = document.createElement('span')
      axisEl.textContent = axis
      Object.assign(axisEl.style, { color, fontWeight: 'bold', fontSize: '11px' })
      const inputEl = document.createElement('input')
      inputEl.type = 'number'
      inputEl.step = '0.001'
      inputEl.value = val.toFixed(3)
      Object.assign(inputEl.style, {
        width: '100%', boxSizing: 'border-box',
        background: '#383838', border: '1px solid #444', borderRadius: '3px',
        padding: '2px 6px', color: '#e8e8e8', fontSize: '12px',
        textAlign: 'right', fontFamily: 'monospace', outline: 'none',
      })
      inputEl.addEventListener('focus', () => { inputEl.style.borderColor = '#4fc3f7' })
      inputEl.addEventListener('blur', () => {
        inputEl.style.borderColor = '#444'
        const v = parseFloat(inputEl.value)
        if (!isNaN(v)) onChange(v)
      })
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { inputEl.blur(); e.stopPropagation() }
        if (e.key === 'Escape') { inputEl.value = val.toFixed(3); inputEl.blur(); e.stopPropagation() }
        e.stopPropagation()
      })
      r.appendChild(axisEl)
      r.appendChild(inputEl)
      return r
    }

    const row = (axis, color, val) => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        display: 'grid',
        gridTemplateColumns: '18px 1fr',
        gap: '2px 4px',
        padding: '1px 0',
        alignItems: 'center',
      })
      const axisEl = document.createElement('span')
      axisEl.textContent = axis
      Object.assign(axisEl.style, { color, fontWeight: 'bold', fontSize: '11px' })
      const valEl = document.createElement('span')
      valEl.textContent = val.toFixed(3)
      Object.assign(valEl.style, {
        background: '#383838',
        border: '1px solid #444',
        borderRadius: '3px',
        padding: '2px 6px',
        color: '#e8e8e8',
        fontSize: '12px',
        textAlign: 'right',
        fontFamily: 'monospace',
      })
      r.appendChild(axisEl)
      r.appendChild(valEl)
      return r
    }

    const section = (title, rows) => {
      const sec = document.createElement('div')
      Object.assign(sec.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })
      const titleEl = document.createElement('div')
      titleEl.textContent = title
      Object.assign(titleEl.style, {
        color: '#aaa', fontSize: '11px',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '6px',
      })
      sec.appendChild(titleEl)
      rows.forEach(r => sec.appendChild(r))
      return sec
    }

    // ── Name section ──────────────────────────────────────────────────────
    const nameSection = document.createElement('div')
    Object.assign(nameSection.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })
    const nameTitleEl = document.createElement('div')
    nameTitleEl.textContent = 'Name'
    Object.assign(nameTitleEl.style, {
      color: '#aaa', fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      marginBottom: '6px',
    })
    const nameInputEl = document.createElement('input')
    nameInputEl.type = 'text'
    nameInputEl.value = name
    Object.assign(nameInputEl.style, {
      width: '100%',
      boxSizing: 'border-box',
      background: '#383838',
      border: '1px solid #444',
      borderRadius: '3px',
      padding: '3px 6px',
      color: '#e8e8e8',
      fontSize: '12px',
      fontFamily: 'sans-serif',
      outline: 'none',
    })
    nameInputEl.addEventListener('focus', () => { nameInputEl.style.borderColor = '#4fc3f7' })
    nameInputEl.addEventListener('blur', () => {
      nameInputEl.style.borderColor = '#444'
      if (this._onNameChangeCb) this._onNameChangeCb(nameInputEl.value.trim() || name)
    })
    nameInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { nameInputEl.blur(); e.stopPropagation() }
      if (e.key === 'Escape') { nameInputEl.value = name; nameInputEl.blur(); e.stopPropagation() }
      e.stopPropagation()
    })
    nameSection.appendChild(nameTitleEl)
    nameSection.appendChild(nameInputEl)

    // ── Description section ───────────────────────────────────────────────
    const descSection = document.createElement('div')
    Object.assign(descSection.style, { padding: '8px 10px 6px' })
    const descTitleEl = document.createElement('div')
    descTitleEl.textContent = 'Description'
    Object.assign(descTitleEl.style, {
      color: '#aaa', fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      marginBottom: '6px',
    })
    const descTextareaEl = document.createElement('textarea')
    descTextareaEl.value = description
    descTextareaEl.rows = 4
    Object.assign(descTextareaEl.style, {
      width: '100%',
      boxSizing: 'border-box',
      background: '#383838',
      border: '1px solid #444',
      borderRadius: '3px',
      padding: '3px 6px',
      color: '#e8e8e8',
      fontSize: '12px',
      fontFamily: 'sans-serif',
      outline: 'none',
      resize: 'vertical',
      lineHeight: '1.5',
    })
    descTextareaEl.placeholder = 'Add a description...'
    descTextareaEl.addEventListener('focus', () => { descTextareaEl.style.borderColor = '#4fc3f7' })
    descTextareaEl.addEventListener('blur', () => {
      descTextareaEl.style.borderColor = '#444'
      if (this._onDescriptionChangeCb) this._onDescriptionChangeCb(descTextareaEl.value)
    })
    descTextareaEl.addEventListener('keydown', (e) => { e.stopPropagation() })
    descSection.appendChild(descTitleEl)
    descSection.appendChild(descTextareaEl)

    // ── IFC Class section (only for Solid / ImportedMesh) ────────────────────
    let ifcSection = null
    if (showIfcClass) {
      ifcSection = this._buildIfcClassSection(ifcClass ?? null)
    }

    // ── Place Type section (only for Annotated entities) ─────────────────
    let placeTypeSection = null
    if (showPlaceType) {
      placeTypeSection = this._buildPlaceTypeSection(placeType ?? null, placeTypeGeometry)
    }

    // ── Spatial Links section (for any entity that participates in links) ──
    let spatialLinksSection = null
    if (spatialLinks && spatialLinks.length > 0) {
      spatialLinksSection = this._buildSpatialLinksSection(spatialLinks, onDeleteSpatialLink, getEntityName)
    }

    const locRow = locationEditable
      ? (axis, color, val) => editRow(axis, color, val, v => { if (this._onLocationChangeCb) this._onLocationChangeCb(axis.toLowerCase(), v) })
      : row

    this._nPanelContentEl.innerHTML = ''
    this._nPanelContentEl.appendChild(nameSection)
    this._nPanelContentEl.appendChild(section('Location (World)', [
      locRow('X', '#e05252', centroid.x),
      locRow('Y', '#6ab04c', centroid.y),
      locRow('Z', '#4a9eed', centroid.z),
    ]))
    this._nPanelContentEl.appendChild(section('Dimensions', [
      row('X', '#e05252', dimensions.x),
      row('Y', '#6ab04c', dimensions.y),
      row('Z', '#4a9eed', dimensions.z),
    ]))
    if (ifcSection)           this._nPanelContentEl.appendChild(ifcSection)
    if (placeTypeSection)     this._nPanelContentEl.appendChild(placeTypeSection)
    if (spatialLinksSection)  this._nPanelContentEl.appendChild(spatialLinksSection)
    this._nPanelContentEl.appendChild(descSection)
  }

  /**
   * Builds the IFC Class section for the N-panel.
   * Shows a coloured badge for the current class and a button to open the picker.
   * @param {string|null} currentClass
   * @returns {HTMLElement}
   * @private
   */
  _buildIfcClassSection(currentClass) {
    const sec = document.createElement('div')
    Object.assign(sec.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })

    const titleEl = document.createElement('div')
    titleEl.textContent = 'IFC Class'
    Object.assign(titleEl.style, {
      color: '#aaa', fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      marginBottom: '6px',
    })
    sec.appendChild(titleEl)

    // ── Current class badge + change button ───────────────────────────────
    const rowEl = document.createElement('div')
    Object.assign(rowEl.style, { display: 'flex', gap: '6px', alignItems: 'center' })

    const badgeEl = document.createElement('span')
    this._refreshIfcBadge(badgeEl, currentClass)
    Object.assign(badgeEl.style, {
      flex: '1', minWidth: '0',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    })

    const changeBtn = document.createElement('button')
    changeBtn.textContent = currentClass ? 'Change' : 'Set'
    Object.assign(changeBtn.style, {
      padding: '2px 7px',
      background: '#3c3c3c', border: '1px solid #555', borderRadius: '3px',
      color: '#e8e8e8', fontSize: '11px', cursor: 'pointer',
      flexShrink: '0', fontFamily: 'sans-serif',
    })
    changeBtn.addEventListener('mouseenter', () => { changeBtn.style.background = '#4a4a4a' })
    changeBtn.addEventListener('mouseleave', () => { changeBtn.style.background = '#3c3c3c' })
    changeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this._openIfcPicker(badgeEl, changeBtn)
    })

    rowEl.appendChild(badgeEl)
    rowEl.appendChild(changeBtn)

    if (currentClass) {
      const clearBtn = document.createElement('button')
      clearBtn.textContent = '✕'
      clearBtn.title = 'Clear IFC class'
      Object.assign(clearBtn.style, {
        padding: '2px 5px',
        background: '#3c3c3c', border: '1px solid #555', borderRadius: '3px',
        color: '#aaa', fontSize: '11px', cursor: 'pointer',
        flexShrink: '0',
      })
      clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = '#4a4a4a' })
      clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = '#3c3c3c' })
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._refreshIfcBadge(badgeEl, null)
        changeBtn.textContent = 'Set'
        clearBtn.remove()
        if (this._onIfcClassChangeCb) this._onIfcClassChangeCb(null)
      })
      rowEl.appendChild(clearBtn)
    }

    sec.appendChild(rowEl)
    return sec
  }

  /**
   * Builds the Place Type section for the N-panel (Annotated entities only).
   * Shows a coloured badge for the current type and a button to open the picker.
   * @param {string|null} currentType
   * @param {'line'|'region'|'point'|null} geometry  filter for the picker
   * @returns {HTMLElement}
   * @private
   */
  _buildPlaceTypeSection(currentType, geometry) {
    const sec = document.createElement('div')
    Object.assign(sec.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })

    const titleEl = document.createElement('div')
    titleEl.textContent = 'Place Type'
    Object.assign(titleEl.style, {
      color: '#aaa', fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      marginBottom: '6px',
    })
    sec.appendChild(titleEl)

    const rowEl = document.createElement('div')
    Object.assign(rowEl.style, { display: 'flex', gap: '6px', alignItems: 'center' })

    const badgeEl = document.createElement('span')
    this._refreshPlaceTypeBadge(badgeEl, currentType)
    Object.assign(badgeEl.style, {
      flex: '1', minWidth: '0',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    })

    const changeBtn = document.createElement('button')
    changeBtn.textContent = currentType ? 'Change' : 'Set'
    Object.assign(changeBtn.style, {
      padding: '2px 7px',
      background: '#3c3c3c', border: '1px solid #555', borderRadius: '3px',
      color: '#e8e8e8', fontSize: '11px', cursor: 'pointer',
      flexShrink: '0', fontFamily: 'sans-serif',
    })
    changeBtn.addEventListener('mouseenter', () => { changeBtn.style.background = '#4a4a4a' })
    changeBtn.addEventListener('mouseleave', () => { changeBtn.style.background = '#3c3c3c' })
    changeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this._openPlaceTypePicker(badgeEl, changeBtn, geometry)
    })

    rowEl.appendChild(badgeEl)
    rowEl.appendChild(changeBtn)

    if (currentType) {
      const clearBtn = document.createElement('button')
      clearBtn.textContent = '✕'
      clearBtn.title = 'Clear place type'
      Object.assign(clearBtn.style, {
        padding: '2px 5px',
        background: '#3c3c3c', border: '1px solid #555', borderRadius: '3px',
        color: '#aaa', fontSize: '11px', cursor: 'pointer',
        flexShrink: '0',
      })
      clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = '#4a4a4a' })
      clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = '#3c3c3c' })
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._refreshPlaceTypeBadge(badgeEl, null)
        changeBtn.textContent = 'Set'
        clearBtn.remove()
        if (this._onPlaceTypeChangeCb) this._onPlaceTypeChangeCb(null)
      })
      rowEl.appendChild(clearBtn)
    }

    sec.appendChild(rowEl)
    return sec
  }

  /**
   * Updates the visual state of a place type badge element.
   * @param {HTMLElement} badgeEl
   * @param {string|null} placeType
   * @private
   */
  _refreshPlaceTypeBadge(badgeEl, placeType) {
    const entry = placeType ? PLACE_TYPE_MAP.get(placeType) : null
    if (entry) {
      badgeEl.textContent = entry.label
      Object.assign(badgeEl.style, {
        display: 'inline-block',
        background: entry.color + '33',
        border: `1px solid ${entry.color}`,
        borderRadius: '3px',
        padding: '2px 6px',
        color: entry.color,
        fontSize: '11px',
        fontWeight: 'bold',
        fontFamily: 'sans-serif',
      })
    } else {
      badgeEl.textContent = 'Not set'
      Object.assign(badgeEl.style, {
        display: 'inline-block',
        background: 'transparent',
        border: '1px solid #444',
        borderRadius: '3px',
        padding: '2px 6px',
        color: '#666',
        fontSize: '11px',
        fontWeight: 'normal',
        fontFamily: 'sans-serif',
      })
    }
  }

  /**
   * Opens the place type picker overlay anchored near the N-panel.
   * @param {HTMLElement} badgeEl   badge to update on selection
   * @param {HTMLElement} changeBtn button to update label
   * @param {'line'|'region'|'point'|null} geometry  filter valid types
   * @private
   */
  _openPlaceTypePicker(badgeEl, changeBtn, geometry) {
    const existing = document.getElementById('_placeTypePickerOverlay')
    if (existing) { existing.remove(); return }

    const overlay = document.createElement('div')
    overlay.id = '_placeTypePickerOverlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '40px',
      right: '200px',
      width: '230px',
      maxHeight: '320px',
      background: '#252525',
      border: '1px solid #555',
      borderRadius: '5px',
      zIndex: '200',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      overflow: 'hidden',
    })

    // Title
    const headerEl = document.createElement('div')
    headerEl.textContent = 'Place Type'
    Object.assign(headerEl.style, {
      padding: '8px 10px 6px',
      color: '#ccc', fontSize: '12px', fontFamily: 'sans-serif',
      borderBottom: '1px solid #3a3a3a', flexShrink: '0',
    })
    overlay.appendChild(headerEl)

    // List
    const listEl = document.createElement('div')
    Object.assign(listEl.style, { overflowY: 'auto', flex: '1', padding: '4px 6px 8px' })
    overlay.appendChild(listEl)

    const entries = geometry ? getPlaceTypesByGeometry(geometry) : []
    if (entries.length === 0) {
      const emptyEl = document.createElement('div')
      emptyEl.textContent = 'No types available for this geometry type.'
      Object.assign(emptyEl.style, { color: '#666', fontSize: '11px', padding: '8px 4px' })
      listEl.appendChild(emptyEl)
    }

    for (const entry of entries) {
      const itemEl = document.createElement('div')
      Object.assign(itemEl.style, {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '5px 6px', borderRadius: '3px', cursor: 'pointer',
      })
      itemEl.addEventListener('mouseenter', () => { itemEl.style.background = 'rgba(255,255,255,0.07)' })
      itemEl.addEventListener('mouseleave', () => { itemEl.style.background = 'transparent' })

      const colorDot = document.createElement('span')
      Object.assign(colorDot.style, {
        width: '10px', height: '10px', borderRadius: '2px',
        background: entry.color, flexShrink: '0',
        display: 'inline-block',
      })

      const labelEl = document.createElement('div')
      Object.assign(labelEl.style, { flex: '1', minWidth: '0' })

      const nameEl = document.createElement('div')
      nameEl.textContent = entry.label
      Object.assign(nameEl.style, {
        color: entry.color, fontSize: '12px', fontWeight: 'bold', fontFamily: 'sans-serif',
      })

      const descEl = document.createElement('div')
      descEl.textContent = entry.description
      Object.assign(descEl.style, {
        color: '#777', fontSize: '10px', fontFamily: 'sans-serif',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      })

      labelEl.appendChild(nameEl)
      labelEl.appendChild(descEl)
      itemEl.appendChild(colorDot)
      itemEl.appendChild(labelEl)

      itemEl.addEventListener('click', () => {
        this._refreshPlaceTypeBadge(badgeEl, entry.name)
        changeBtn.textContent = 'Change'
        overlay.remove()
        if (this._onPlaceTypeChangeCb) this._onPlaceTypeChangeCb(entry.name)
      })

      listEl.appendChild(itemEl)
    }

    document.body.appendChild(overlay)

    // Close on outside click
    const close = (e) => {
      if (!overlay.contains(e.target)) { overlay.remove(); document.removeEventListener('pointerdown', close) }
    }
    setTimeout(() => document.addEventListener('pointerdown', close), 0)
  }

  /**
   * Updates the visual state of an IFC badge element.
   * @param {HTMLElement} badgeEl
   * @param {string|null} ifcClass
   * @private
   */
  _refreshIfcBadge(badgeEl, ifcClass) {
    // Import lazily to avoid circular deps — registry is pure data.
    const entry = this._ifcClassEntry(ifcClass)
    if (entry) {
      badgeEl.textContent = entry.label
      Object.assign(badgeEl.style, {
        display: 'inline-block',
        background: entry.color + '33',  // 20% opacity fill
        border: `1px solid ${entry.color}`,
        borderRadius: '3px',
        padding: '2px 6px',
        color: entry.color,
        fontSize: '11px',
        fontWeight: 'bold',
        fontFamily: 'sans-serif',
      })
    } else {
      badgeEl.textContent = 'Not set'
      Object.assign(badgeEl.style, {
        display: 'inline-block',
        background: 'transparent',
        border: '1px solid #444',
        borderRadius: '3px',
        padding: '2px 6px',
        color: '#666',
        fontSize: '11px',
        fontWeight: 'normal',
        fontFamily: 'sans-serif',
      })
    }
  }

  /**
   * Returns the IFC class entry for a given class name, or null.
   * @param {string|null} name
   * @returns {import('../domain/IFCClassRegistry.js').IFCClassEntry|null}
   * @private
   */
  _ifcClassEntry(name) {
    if (!name) return null
    return IFC_CLASS_MAP.get(name) ?? null
  }

  /**
   * Opens the IFC class picker overlay anchored near the N-panel.
   * @param {HTMLElement} badgeEl   badge to update on selection
   * @param {HTMLElement} changeBtn button to update label
   * @private
   */
  _openIfcPicker(badgeEl, changeBtn) {
    // Remove any existing picker
    const existing = document.getElementById('_ifcPickerOverlay')
    if (existing) { existing.remove(); return }

    const overlay = document.createElement('div')
    overlay.id = '_ifcPickerOverlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '40px',
      right: '200px',
      width: '220px',
      maxHeight: '420px',
      background: '#252525',
      border: '1px solid #555',
      borderRadius: '5px',
      zIndex: '200',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      overflow: 'hidden',
    })

    // Search input
    const searchInput = document.createElement('input')
    searchInput.type = 'text'
    searchInput.placeholder = 'Search IFC class…'
    Object.assign(searchInput.style, {
      margin: '8px', padding: '4px 8px',
      background: '#383838', border: '1px solid #555', borderRadius: '3px',
      color: '#e8e8e8', fontSize: '12px', fontFamily: 'sans-serif',
      outline: 'none', flexShrink: '0',
    })
    searchInput.addEventListener('focus', () => { searchInput.style.borderColor = '#4fc3f7' })
    searchInput.addEventListener('blur', () => { searchInput.style.borderColor = '#555' })
    searchInput.addEventListener('keydown', e => { e.stopPropagation() })
    overlay.appendChild(searchInput)

    // List container
    const listEl = document.createElement('div')
    Object.assign(listEl.style, { overflowY: 'auto', flex: '1', padding: '0 4px 6px' })
    overlay.appendChild(listEl)

    const renderList = (filter) => {
      listEl.innerHTML = ''
      // Import the IFC class registry
      const buildItems = (IFC_CLASSES, IFC_CLASS_MAP) => {
        const groups = new Map()
        for (const entry of IFC_CLASSES) {
          const label = entry.label.toLowerCase()
          const name  = entry.name.toLowerCase()
          if (filter && !label.includes(filter) && !name.includes(filter)) continue
          if (!groups.has(entry.group)) groups.set(entry.group, [])
          groups.get(entry.group).push(entry)
        }

        for (const [groupName, entries] of groups) {
          if (!filter) {
            const groupHeader = document.createElement('div')
            groupHeader.textContent = groupName
            Object.assign(groupHeader.style, {
              padding: '4px 6px 2px',
              color: '#777', fontSize: '10px',
              textTransform: 'uppercase', letterSpacing: '0.07em',
              marginTop: '4px',
            })
            listEl.appendChild(groupHeader)
          }
          for (const entry of entries) {
            const itemEl = document.createElement('div')
            Object.assign(itemEl.style, {
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '4px 8px', borderRadius: '3px',
              cursor: 'pointer', userSelect: 'none',
            })
            const colorDot = document.createElement('span')
            Object.assign(colorDot.style, {
              width: '10px', height: '10px', borderRadius: '2px',
              background: entry.color, flexShrink: '0',
              border: '1px solid rgba(255,255,255,0.15)',
            })
            const labelEl = document.createElement('span')
            labelEl.textContent = entry.label
            Object.assign(labelEl.style, { color: '#e0e0e0', fontSize: '12px', fontFamily: 'sans-serif' })
            const nameEl = document.createElement('span')
            nameEl.textContent = entry.name
            Object.assign(nameEl.style, {
              color: '#666', fontSize: '10px', fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1',
              textAlign: 'right',
            })
            itemEl.appendChild(colorDot)
            itemEl.appendChild(labelEl)
            itemEl.appendChild(nameEl)
            itemEl.addEventListener('mouseenter', () => { itemEl.style.background = 'rgba(255,255,255,0.07)' })
            itemEl.addEventListener('mouseleave', () => { itemEl.style.background = 'transparent' })
            itemEl.addEventListener('click', () => {
              overlay.remove()
              this._refreshIfcBadge(badgeEl, entry.name)
              changeBtn.textContent = 'Change'
              if (this._onIfcClassChangeCb) this._onIfcClassChangeCb(entry.name)
            })
            listEl.appendChild(itemEl)
          }
        }
        if (listEl.children.length === 0) {
          const empty = document.createElement('div')
          empty.textContent = 'No results'
          Object.assign(empty.style, { padding: '8px', color: '#666', fontSize: '12px', textAlign: 'center' })
          listEl.appendChild(empty)
        }
      }

      buildItems(IFC_CLASSES, IFC_CLASS_MAP)
    }

    renderList('')
    searchInput.addEventListener('input', () => renderList(searchInput.value.trim().toLowerCase()))

    document.body.appendChild(overlay)
    searchInput.focus()

    // Close on outside click
    const onOutside = (e) => {
      if (!overlay.contains(e.target)) {
        overlay.remove()
        document.removeEventListener('pointerdown', onOutside, true)
      }
    }
    document.addEventListener('pointerdown', onOutside, true)
  }

  /**
   * Updates the N panel for a CoordinateFrame.
   * @param {{x:number,y:number,z:number}} pos       world position for Origin frames;
   *                                                  local position (parent-relative) for others
   * @param {{x:number,y:number,z:number}} eulerDeg  rotation in degrees, intrinsic ZYX = extrinsic XYZ = ROS RPY order
   * @param {string} name
   * @param {boolean} [locked]  when true, values are read-only (Origin frame)
   * @param {{ id: string, name: string }[]|null} [parentOptions]
   *   All valid parent candidates (ADR-028). null or empty = no dropdown shown.
   * @param {string|null} [currentParentId]  currently selected parent id
   */
  updateNPanelForFrame(pos, eulerDeg, name, locked = false, parentOptions = null, currentParentId = null) {
    if (!this._nPanelVisible) return

    const row = (axis, color, val) => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        display: 'grid', gridTemplateColumns: '18px 1fr',
        gap: '2px 4px', padding: '1px 0', alignItems: 'center',
      })
      const axisEl = document.createElement('span')
      axisEl.textContent = axis
      Object.assign(axisEl.style, { color, fontWeight: 'bold', fontSize: '11px' })
      const valEl = document.createElement('span')
      valEl.textContent = typeof val === 'number' ? val.toFixed(3) : val
      Object.assign(valEl.style, {
        background: '#2a2a2a', border: '1px solid #333', borderRadius: '3px',
        padding: '2px 6px', color: '#888', fontSize: '12px',
        textAlign: 'right', fontFamily: 'monospace',
      })
      r.appendChild(axisEl)
      r.appendChild(valEl)
      return r
    }

    const editRow = (axis, color, val, onChange) => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        display: 'grid', gridTemplateColumns: '18px 1fr',
        gap: '2px 4px', padding: '1px 0', alignItems: 'center',
      })
      const axisEl = document.createElement('span')
      axisEl.textContent = axis
      Object.assign(axisEl.style, { color, fontWeight: 'bold', fontSize: '11px' })
      const inputEl = document.createElement('input')
      inputEl.type = 'number'
      inputEl.step = '0.001'
      inputEl.value = val.toFixed(3)
      Object.assign(inputEl.style, {
        width: '100%', boxSizing: 'border-box',
        background: '#383838', border: '1px solid #444', borderRadius: '3px',
        padding: '2px 6px', color: '#e8e8e8', fontSize: '12px',
        textAlign: 'right', fontFamily: 'monospace', outline: 'none',
      })
      inputEl.addEventListener('focus', () => { inputEl.style.borderColor = '#4fc3f7' })
      inputEl.addEventListener('blur', () => {
        inputEl.style.borderColor = '#444'
        const v = parseFloat(inputEl.value)
        if (!isNaN(v)) onChange(v)
      })
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { inputEl.blur(); e.stopPropagation() }
        if (e.key === 'Escape') { inputEl.value = val.toFixed(3); inputEl.blur(); e.stopPropagation() }
        e.stopPropagation()
      })
      r.appendChild(axisEl)
      r.appendChild(inputEl)
      return r
    }

    const section = (title, rows) => {
      const sec = document.createElement('div')
      Object.assign(sec.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })
      const titleEl = document.createElement('div')
      titleEl.textContent = title
      Object.assign(titleEl.style, {
        color: '#aaa', fontSize: '11px',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '6px',
      })
      sec.appendChild(titleEl)
      rows.forEach(r => sec.appendChild(r))
      return sec
    }

    // Name section
    const nameSection = document.createElement('div')
    Object.assign(nameSection.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })
    const nameTitleEl = document.createElement('div')
    nameTitleEl.textContent = 'Name'
    Object.assign(nameTitleEl.style, {
      color: '#aaa', fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      marginBottom: '6px',
    })
    const nameInputEl = document.createElement('input')
    nameInputEl.type = 'text'
    nameInputEl.value = name
    Object.assign(nameInputEl.style, {
      width: '100%', boxSizing: 'border-box',
      background: '#383838', border: '1px solid #444', borderRadius: '3px',
      padding: '3px 6px', color: '#e8e8e8', fontSize: '12px',
      fontFamily: 'sans-serif', outline: 'none',
    })
    nameInputEl.addEventListener('focus', () => { nameInputEl.style.borderColor = '#4fc3f7' })
    nameInputEl.addEventListener('blur', () => {
      nameInputEl.style.borderColor = '#444'
      if (this._onNameChangeCb) this._onNameChangeCb(nameInputEl.value.trim() || name)
    })
    nameInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { nameInputEl.blur(); e.stopPropagation() }
      if (e.key === 'Escape') { nameInputEl.value = name; nameInputEl.blur(); e.stopPropagation() }
      e.stopPropagation()
    })
    nameSection.appendChild(nameTitleEl)
    nameSection.appendChild(nameInputEl)

    const locRow = locked
      ? (ax, col, val) => row(ax, col, val)
      : (ax, col, val) => editRow(ax, col, val, v => { if (this._onFramePositionChangeCb) this._onFramePositionChangeCb(ax.toLowerCase(), v) })
    const rotRow = locked
      ? (ax, col, val) => row(ax, col, val)
      : (ax, col, val) => editRow(ax, col, val, v => { if (this._onFrameRotationChangeCb) this._onFrameRotationChangeCb(ax.toLowerCase(), v) })

    // Parent section — only for non-locked frames with candidate options (ADR-028)
    let parentSection = null
    if (!locked && parentOptions?.length > 0) {
      parentSection = document.createElement('div')
      Object.assign(parentSection.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })
      const parentTitleEl = document.createElement('div')
      parentTitleEl.textContent = 'Parent'
      Object.assign(parentTitleEl.style, {
        color: '#aaa', fontSize: '11px',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '6px',
      })
      const selectEl = document.createElement('select')
      Object.assign(selectEl.style, {
        width: '100%', boxSizing: 'border-box',
        background: '#383838', border: '1px solid #444', borderRadius: '3px',
        padding: '3px 6px', color: '#e8e8e8', fontSize: '12px',
        fontFamily: 'sans-serif', outline: 'none', cursor: 'pointer',
      })
      for (const opt of parentOptions) {
        const optEl = document.createElement('option')
        optEl.value = opt.id
        optEl.textContent = opt.name
        if (opt.id === currentParentId) optEl.selected = true
        selectEl.appendChild(optEl)
      }
      selectEl.addEventListener('change', () => {
        if (this._onFrameParentChangeCb) this._onFrameParentChangeCb(selectEl.value)
      })
      selectEl.addEventListener('focus', () => { selectEl.style.borderColor = '#4fc3f7' })
      selectEl.addEventListener('blur',  () => { selectEl.style.borderColor = '#444' })
      selectEl.addEventListener('keydown', e => e.stopPropagation())
      parentSection.appendChild(parentTitleEl)
      parentSection.appendChild(selectEl)
    }

    this._nPanelContentEl.innerHTML = ''
    this._nPanelContentEl.appendChild(nameSection)
    if (parentSection) this._nPanelContentEl.appendChild(parentSection)
    this._nPanelContentEl.appendChild(section(locked ? 'Location (World)' : 'Location (Local)', [
      locRow('X', '#e05252', pos.x),
      locRow('Y', '#6ab04c', pos.y),
      locRow('Z', '#4a9eed', pos.z),
    ]))
    this._nPanelContentEl.appendChild(section('Rotation (Local · RPY)', [
      rotRow('X', '#e05252', eulerDeg.x),
      rotRow('Y', '#6ab04c', eulerDeg.y),
      rotRow('Z', '#4a9eed', eulerDeg.z),
    ]))
  }

  // ── SpatialLink N-panel (ADR-030 Phase 4) ────────────────────────────────

  /**
   * Renders a minimal N-panel entry for a SpatialLink entity itself.
   * Shows source name, target name, linkType, and a Delete button.
   * @param {import('../domain/SpatialLink.js').SpatialLink} link
   * @param {string} srcName
   * @param {string} tgtName
   * @param {() => void} onDelete
   */
  updateNPanelForSpatialLink(link, srcName, tgtName, onDelete) {
    if (!this._nPanelVisible) return

    const LINK_COLORS = {
      references: '#F59E0B',
      connects:   '#06B6D4',
      contains:   '#8B5CF6',
      adjacent:   '#64748B',
    }
    const color = LINK_COLORS[link.linkType] ?? '#888'

    this._nPanelContentEl.innerHTML = ''

    // Title section
    const titleSec = document.createElement('div')
    Object.assign(titleSec.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })

    const typeBadge = document.createElement('span')
    typeBadge.textContent = link.linkType
    Object.assign(typeBadge.style, {
      display: 'inline-block',
      background: color + '33',
      border: `1px solid ${color}`,
      borderRadius: '3px',
      padding: '2px 8px',
      color,
      fontSize: '12px',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
      marginBottom: '8px',
    })
    titleSec.appendChild(typeBadge)

    const makeRow = (label, value) => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        display: 'flex', gap: '6px', alignItems: 'baseline',
        padding: '2px 0', fontFamily: 'sans-serif',
      })
      const lEl = document.createElement('span')
      lEl.textContent = label
      Object.assign(lEl.style, { color: '#888', fontSize: '11px', minWidth: '40px' })
      const vEl = document.createElement('span')
      vEl.textContent = value
      Object.assign(vEl.style, { color: '#e0e0e0', fontSize: '12px' })
      r.appendChild(lEl)
      r.appendChild(vEl)
      return r
    }
    titleSec.appendChild(makeRow('From:', srcName))
    titleSec.appendChild(makeRow('To:', tgtName))
    this._nPanelContentEl.appendChild(titleSec)

    // Delete button
    const delSec = document.createElement('div')
    Object.assign(delSec.style, { padding: '8px 10px' })
    const delBtn = document.createElement('button')
    delBtn.textContent = 'Delete Link'
    Object.assign(delBtn.style, {
      width: '100%', padding: '5px',
      background: 'rgba(192,57,43,0.15)',
      border: '1px solid rgba(231,76,60,0.4)',
      borderRadius: '4px',
      color: '#e74c3c', fontSize: '12px', fontFamily: 'sans-serif',
      cursor: 'pointer',
    })
    delBtn.addEventListener('click', onDelete)
    delSec.appendChild(delBtn)
    this._nPanelContentEl.appendChild(delSec)
  }

  /**
   * Builds the Spatial Links section for the N-panel.
   * Lists all links this entity participates in, with a delete button per link.
   * @param {import('../domain/SpatialLink.js').SpatialLink[]} links
   * @param {((linkId: string) => void)|null} onDelete
   * @param {(id: string) => string} getEntityName
   * @returns {HTMLElement}
   * @private
   */
  _buildSpatialLinksSection(links, onDelete, getEntityName) {
    const LINK_COLORS = {
      references: '#F59E0B',
      connects:   '#06B6D4',
      contains:   '#8B5CF6',
      adjacent:   '#64748B',
    }

    const sec = document.createElement('div')
    Object.assign(sec.style, { padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' })

    const titleEl = document.createElement('div')
    titleEl.textContent = 'Spatial Links'
    Object.assign(titleEl.style, {
      color: '#aaa', fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      marginBottom: '6px',
    })
    sec.appendChild(titleEl)

    for (const link of links) {
      const color = LINK_COLORS[link.linkType] ?? '#888'
      const rowEl = document.createElement('div')
      Object.assign(rowEl.style, {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '3px 0', fontFamily: 'sans-serif',
      })

      const badge = document.createElement('span')
      badge.textContent = link.linkType
      Object.assign(badge.style, {
        flexShrink: '0',
        background: color + '22',
        border: `1px solid ${color}`,
        borderRadius: '3px',
        padding: '1px 5px',
        color, fontSize: '10px', fontWeight: 'bold',
      })
      rowEl.appendChild(badge)

      const namesEl = document.createElement('span')
      namesEl.textContent = `${getEntityName(link.sourceId)} → ${getEntityName(link.targetId)}`
      Object.assign(namesEl.style, {
        flex: '1', fontSize: '11px', color: '#ccc',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      })
      rowEl.appendChild(namesEl)

      if (onDelete) {
        const delBtn = document.createElement('button')
        delBtn.textContent = '×'
        delBtn.title = 'Delete this link'
        Object.assign(delBtn.style, {
          flexShrink: '0',
          background: 'transparent',
          border: '1px solid #555',
          borderRadius: '3px',
          color: '#e74c3c', fontSize: '13px',
          cursor: 'pointer', padding: '0 5px',
          lineHeight: '16px',
        })
        delBtn.addEventListener('click', () => onDelete(link.id))
        rowEl.appendChild(delBtn)
      }

      sec.appendChild(rowEl)
    }

    return sec
  }

  /**
   * Shows a floating overlay for selecting the SpatialLink type.
   * Calls onSelect(linkType) when the user picks one.
   * @param {number} x  client X
   * @param {number} y  client Y
   * @param {(linkType: 'references'|'connects'|'contains'|'adjacent') => void} onSelect
   */
  showLinkTypePicker(x, y, onSelect) {
    const existing = document.getElementById('_linkTypePickerOverlay')
    if (existing) { existing.remove() }

    const LINK_TYPES = [
      { type: 'references', color: '#F59E0B', label: 'References', desc: 'Source derives positional datum from target' },
      { type: 'connects',   color: '#06B6D4', label: 'Connects',   desc: 'A route logically connects source to target' },
      { type: 'contains',   color: '#8B5CF6', label: 'Contains',   desc: 'Region source spatially contains target' },
      { type: 'adjacent',   color: '#64748B', label: 'Adjacent',   desc: 'Source and target share a boundary' },
    ]

    const overlay = document.createElement('div')
    overlay.id = '_linkTypePickerOverlay'

    // Clamp position to viewport
    const W = 220, H = 200
    const px = Math.min(x, window.innerWidth  - W - 8)
    const py = Math.min(y, window.innerHeight - H - 8)

    Object.assign(overlay.style, {
      position:     'fixed',
      left:         `${Math.max(8, px)}px`,
      top:          `${Math.max(48, py)}px`,
      width:        `${W}px`,
      background:   '#2a2a2a',
      border:       '1px solid #3a3a3a',
      borderRadius: '6px',
      boxShadow:    '0 4px 16px rgba(0,0,0,0.6)',
      zIndex:       '200',
      overflow:     'hidden',
    })

    const headerEl = document.createElement('div')
    headerEl.textContent = 'Link Type'
    Object.assign(headerEl.style, {
      padding: '7px 10px 5px',
      color: '#ccc', fontSize: '12px', fontFamily: 'sans-serif',
      borderBottom: '1px solid #3a3a3a',
    })
    overlay.appendChild(headerEl)

    for (const { type, color, label, desc } of LINK_TYPES) {
      const item = document.createElement('div')
      Object.assign(item.style, {
        display:    'flex', gap: '8px', alignItems: 'flex-start',
        padding:    '7px 10px',
        cursor:     'pointer',
        fontFamily: 'sans-serif',
        transition: 'background 0.1s',
      })
      item.addEventListener('mouseenter', () => { item.style.background = '#333' })
      item.addEventListener('mouseleave', () => { item.style.background = '' })
      item.addEventListener('click', () => {
        overlay.remove()
        document.removeEventListener('pointerdown', closeOnOutside)
        onSelect(type)
      })

      const dot = document.createElement('span')
      Object.assign(dot.style, {
        marginTop:    '3px',
        width:        '8px', height: '8px', borderRadius: '50%',
        background:   color, flexShrink: '0', display: 'inline-block',
      })

      const textWrap = document.createElement('div')
      const nameEl = document.createElement('div')
      nameEl.textContent = label
      Object.assign(nameEl.style, { color, fontSize: '12px', fontWeight: 'bold' })
      const descEl = document.createElement('div')
      descEl.textContent = desc
      Object.assign(descEl.style, { color: '#666', fontSize: '10px', marginTop: '1px' })
      textWrap.appendChild(nameEl)
      textWrap.appendChild(descEl)

      item.appendChild(dot)
      item.appendChild(textWrap)
      overlay.appendChild(item)
    }

    document.body.appendChild(overlay)

    const closeOnOutside = (e) => {
      if (!overlay.contains(e.target)) {
        overlay.remove()
        document.removeEventListener('pointerdown', closeOnOutside)
      }
    }
    setTimeout(() => document.addEventListener('pointerdown', closeOnOutside), 0)
  }

  /**
   * Shows the extrusion amount label at a screen position.
   * @param {string} text
   * @param {number} screenX
   * @param {number} screenY
   */
  setExtrusionLabel(text, screenX, screenY) {
    this._extrusionLabelEl.textContent = text
    this._extrusionLabelEl.style.left    = `${screenX}px`
    this._extrusionLabelEl.style.top     = `${screenY}px`
    this._extrusionLabelEl.style.display = 'block'
  }

  /** Hides the extrusion amount label */
  clearExtrusionLabel() {
    this._extrusionLabelEl.style.display = 'none'
  }

  /** Sets the cursor style on the canvas element */
  setCursor(style) {
    if (this._canvas) this._canvas.style.cursor = style
  }

  /** Sets the canvas element used for cursor changes */
  setCanvas(canvas) {
    this._canvas = canvas
  }

  /**
   * Renders the mobile floating toolbar with the given buttons.
   * Only visible on mobile (<768px). Ignored on desktop.
   *
   * `icon` can be a plain string (emoji/text) or an SVG string starting with `<svg`.
   *
   * @param {Array<{icon: string, label: string, onClick: () => void, active?: boolean, danger?: boolean, disabled?: boolean}>} buttons
   */
  setMobileToolbar(buttons) {
    this._mobileToolbarEl.innerHTML = ''
    buttons.forEach(({ icon, label, onClick, active = false, danger = false, disabled = false, indicator = false, spacer = false }) => {
      if (spacer) {
        const placeholder = document.createElement('div')
        Object.assign(placeholder.style, {
          minWidth:   '52px',
          minHeight:  '48px',
          visibility: 'hidden',
          flexShrink: '1',
        })
        this._mobileToolbarEl.appendChild(placeholder)
        return
      }
      const btn = document.createElement(indicator ? 'div' : 'button')
      const bg     = indicator ? 'rgba(79,195,247,0.06)' : disabled ? 'transparent'             : active ? 'rgba(79,195,247,0.15)' : danger ? 'rgba(192,57,43,0.18)' : 'rgba(255,255,255,0.06)'
      const border  = indicator ? 'rgba(79,195,247,0.18)' : disabled ? 'rgba(255,255,255,0.06)' : active ? 'rgba(79,195,247,0.5)'  : danger ? 'rgba(231,76,60,0.5)'  : 'rgba(255,255,255,0.12)'
      const color   = indicator ? '#4fc3f7'               : disabled ? '#484848'                : active ? '#4fc3f7'                : danger ? '#e74c3c'               : '#d8d8d8'
      Object.assign(btn.style, {
        display:          'flex',
        flexDirection:    'column',
        alignItems:       'center',
        justifyContent:   'center',
        gap:              '3px',
        padding:          '6px 12px',
        minWidth:         '52px',
        minHeight:        '48px',
        background:       bg,
        border:           `1px solid ${border}`,
        borderRadius:     '10px',
        color,
        cursor:           'default',
        lineHeight:       '1',
        fontFamily:       'system-ui, -apple-system, sans-serif',
        userSelect:       'none',
        WebkitUserSelect: 'none',
        transition:       'background 0.15s, border-color 0.15s',
        flexShrink:       '1',
      })
      if (!indicator) btn.style.cursor = disabled ? 'default' : 'pointer'

      const iconEl = document.createElement('span')
      Object.assign(iconEl.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '20px', height: '20px',
      })
      if (typeof icon === 'string' && icon.startsWith('<svg')) {
        iconEl.innerHTML = icon
      } else {
        iconEl.textContent = icon
        iconEl.style.fontSize = '18px'
      }

      const labelEl = document.createElement('span')
      labelEl.textContent = label
      Object.assign(labelEl.style, {
        fontSize:      '9px',
        fontWeight:    '500',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        opacity:       (disabled && !indicator) ? '0.35' : '0.7',
      })

      btn.appendChild(iconEl)
      btn.appendChild(labelEl)
      if (!disabled && !indicator) btn.addEventListener('click', onClick)
      this._mobileToolbarEl.appendChild(btn)
    })
  }
}
