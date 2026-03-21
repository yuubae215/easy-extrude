/**
 * UIView - manages DOM UI elements (Blender-style layout)
 *
 * Side effects: creates DOM elements, appends them, and modifies their styles.
 */
export class UIView {
  constructor() {
    // ── Header bar (top, full width) ─────────────────────────────────────
    this._headerEl = document.createElement('div')
    Object.assign(this._headerEl.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      height: '36px',
      background: '#2b2b2b',
      borderBottom: '1px solid #1a1a1a',
      display: 'flex', alignItems: 'center',
      padding: '0 8px', gap: '4px',
      zIndex: '100',
      userSelect: 'none',
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
      background: '#3c3c3c',
      border: '1px solid #555',
      borderRadius: '4px',
      color: '#e8e8e8',
      cursor: 'pointer',
      fontSize: '13px',
      fontFamily: 'sans-serif',
      display: 'flex', alignItems: 'center', gap: '6px',
    })
    this._modeLabelEl = document.createElement('span')
    this._modeLabelEl.textContent = 'Object Mode'
    const arrowEl = document.createElement('span')
    arrowEl.textContent = 'v'
    Object.assign(arrowEl.style, { fontSize: '10px', opacity: '0.7' })
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
      padding: '4px 10px',
      background: 'transparent',
      border: 'none',
      color: '#e8e8e8',
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: '1',
      display: 'none',
      marginRight: '4px',
    })
    this._hamburgerBtn.textContent = '☰'
    this._headerEl.appendChild(this._hamburgerBtn)

    this._headerEl.appendChild(this._modeSelectorEl)

    // ── Header status (centered within header bar) ────────────────────────
    this._headerStatusEl = document.createElement('div')
    Object.assign(this._headerStatusEl.style, {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      fontSize: '13px',
      fontFamily: 'monospace',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    })
    this._headerEl.appendChild(this._headerStatusEl)

    // ── N-panel toggle button (mobile only — opens N panel drawer) ────────
    this._nToggleBtn = document.createElement('button')
    Object.assign(this._nToggleBtn.style, {
      padding: '4px 10px',
      background: 'transparent',
      border: 'none',
      color: '#e8e8e8',
      cursor: 'pointer',
      fontSize: '16px',
      lineHeight: '1',
      marginLeft: 'auto',
      display: 'none',
    })
    this._nToggleBtn.textContent = '⊞'
    this._headerEl.appendChild(this._nToggleBtn)

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
      position: 'fixed', top: '36px', right: '0',
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
      top: '36px', bottom: '26px', left: '0', right: '0',
      background: 'rgba(0,0,0,0.5)',
      zIndex: '80',
      display: 'none',
    })
    document.body.appendChild(this._backdrop)

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
   */
  showAddMenu(x, y, onBox, onSketch) {
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
      { label: 'Box', hint: 'Shift+A', cb: onBox },
      { label: 'Sketch', hint: '', cb: onSketch },
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
    if (!text) return
    const span = document.createElement('span')
    span.textContent = text
    Object.assign(span.style, { color: '#c8c8c8' })
    this._headerStatusEl.appendChild(span)
  }

  /**
   * Updates the header status with rich colored segments.
   * Each part: { text: string, color?: string, bold?: boolean, dim?: boolean }
   * Segments are separated by a dimmed `·` dot.
   * @param {{ text: string, color?: string, bold?: boolean }[]} parts
   */
  setStatusRich(parts) {
    this._headerStatusEl.innerHTML = ''
    parts.forEach((part, i) => {
      if (i > 0) {
        const sep = document.createElement('span')
        sep.textContent = '·'
        Object.assign(sep.style, { color: '#4a4a4a', margin: '0 4px' })
        this._headerStatusEl.appendChild(sep)
      }
      const span = document.createElement('span')
      span.textContent = part.text
      Object.assign(span.style, {
        color: part.color ?? '#c8c8c8',
        fontWeight: part.bold ? 'bold' : 'normal',
        letterSpacing: part.bold ? '0.02em' : 'normal',
      })
      this._headerStatusEl.appendChild(span)
    })
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
}
