/**
 * UIView - manages DOM UI elements (Blender-style layout)
 *
 * Side effects: creates DOM elements, appends them, and modifies their styles.
 */

/** SVG icon strings for the mobile toolbar. Pass as `icon` in setMobileToolbar buttons. */
export const ICONS = {
  add:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  delete:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  back:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  confirm: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  cancel:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  extrude: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="7"/><polyline points="6 13 12 7 18 13"/><rect x="4" y="19" width="16" height="3" rx="1.5" fill="currentColor" stroke="none"/></svg>`,
  vertex:  `<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg>`,
  edge:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="3"/><circle cx="20" cy="12" r="3"/><rect x="7" y="11" width="10" height="2" rx="1"/></svg>`,
  face:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/></svg>`,
  grab:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V7a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4"/><path d="M14 10V5a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5"/><path d="M10 9.5V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8H12a8 8 0 0 1-8-8v-5a2 2 0 1 1 4 0"/></svg>`,
  stack:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="14" width="18" height="6" rx="1.5"/><rect x="5" y="8" width="14" height="5" rx="1"/><line x1="12" y1="3" x2="12" y2="8"/><polyline points="9 5 12 2 15 5"/></svg>`,
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

    this._headerEl.appendChild(this._modeSelectorEl)

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

    // Apply initial mobile layout and listen for resize
    this._applyMobileLayout()
    window.addEventListener('resize', () => this._applyMobileLayout())
  }

  /** Registers callback for name changes from the N panel */
  onNameChange(callback) { this._onNameChangeCb = callback }

  /** Registers callback for description changes from the N panel */
  onDescriptionChange(callback) { this._onDescriptionChangeCb = callback }

  /** Registers callback for mode changes */
  onModeChange(callback) {
    this._modeChangeCallback = callback

    this._modeBtnEl.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = this._modeDropdownEl.style.display !== 'none'
      this._modeDropdownEl.style.display = isOpen ? 'none' : 'block'
    })

    this._dropdownItems.forEach(item => {
      item.addEventListener('click', () => {
        callback(item.dataset.mode)
        this._modeDropdownEl.style.display = 'none'
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
        ['Click', 'Select'],
        ['Drag', 'Move'],
        ['Ctrl+Drag', 'Rotate'],
        ['G', 'Grab'],
        ['G > X/Y/Z', 'Axis constraint'],
        ['G > V', 'Set pivot'],
        ['Shift+A', 'Add'],
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
        ['Hover', 'Highlight face'],
        ['Drag', 'Extrude'],
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
   * Shows an Add menu popup at screen position (x, y).
   * @param {number} x - screen X
   * @param {number} y - screen Y
   * @param {() => void} onBox
   * @param {() => void} onSketch
   * @param {() => void} [onMeasure]
   */
  showAddMenu(x, y, onBox, onSketch, onMeasure) {
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
      minWidth: '120px',
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

    const items = [
      { label: 'Box',     hint: 'Shift+A', cb: onBox },
      { label: 'Sketch',  hint: '',        cb: onSketch },
      ...(onMeasure ? [{ label: 'Measure', hint: 'M', cb: onMeasure }] : []),
    ]
    items.forEach(({ label, hint, cb }) => {
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
      labelEl.textContent = label
      item.appendChild(labelEl)
      if (hint) {
        const hintEl = document.createElement('span')
        hintEl.textContent = hint
        Object.assign(hintEl.style, { color: '#888', fontSize: '11px' })
        item.appendChild(hintEl)
      }
      item.addEventListener('mouseenter', () => { item.style.background = '#4a4a4a' })
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
      item.addEventListener('click', () => { this.hideAddMenu(); cb() })
      menu.appendChild(item)
    })

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
    this._nToggleBtn.style.display   = mobile ? 'block' : 'none'
    this._nToggleBtn.style.marginLeft = mobile ? 'auto' : ''
    this._mobileToolbarEl.style.display = mobile ? 'flex' : 'none'
    // Nodes button is desktop-only (NodeEditorView is not mobile-optimised)
    this._nodeEditorBtn.style.display = mobile ? 'none' : 'flex'
    // On mobile, status moves to the footer info bar; hide the header status and canvas pill
    this._headerStatusEl.style.display = mobile ? 'none' : 'flex'
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

  /** Registers callback for Node Editor toggle button (header bar, Phase B) */
  onNodeEditorToggle(cb) { this._nodeEditorToggle = cb }

  /**
   * Updates N panel content.
   * @param {{ x: number, y: number, z: number }} centroid
   * @param {{ x: number, y: number, z: number }} dimensions
   * @param {string} [name]
   * @param {string} [description]
   */
  updateNPanel(centroid, dimensions, name = '', description = '') {
    if (!this._nPanelVisible) return

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

    this._nPanelContentEl.innerHTML = ''
    this._nPanelContentEl.appendChild(nameSection)
    this._nPanelContentEl.appendChild(section('Location', [
      row('X', '#e05252', centroid.x),
      row('Y', '#6ab04c', centroid.y),
      row('Z', '#4a9eed', centroid.z),
    ]))
    this._nPanelContentEl.appendChild(section('Dimensions', [
      row('X', '#e05252', dimensions.x),
      row('Y', '#6ab04c', dimensions.y),
      row('Z', '#4a9eed', dimensions.z),
    ]))
    this._nPanelContentEl.appendChild(descSection)
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
