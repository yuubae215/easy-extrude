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
    this._headerEl.appendChild(this._modeSelectorEl)

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!this._modeSelectorEl.contains(e.target)) {
        this._modeDropdownEl.style.display = 'none'
      }
    })

    // ── Status bar (top-center, operation feedback) ───────────────────────
    this._statusEl = document.createElement('div')
    Object.assign(this._statusEl.style, {
      position: 'fixed', top: '46px', left: '50%', transform: 'translateX(-50%)',
      color: '#ffeb3b', fontSize: '15px', fontFamily: 'sans-serif',
      background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: '6px',
      pointerEvents: 'none', minWidth: '120px', textAlign: 'center',
    })
    document.body.appendChild(this._statusEl)

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
  }

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

  /** Updates mode button label, dropdown active state, and info bar */
  updateMode(mode) {
    const labels = { object: 'Object Mode', edit: 'Edit Mode' }
    this._modeLabelEl.textContent = labels[mode] || mode

    // Highlight active item in dropdown
    this._dropdownItems.forEach(item => {
      item.style.color = item.dataset.mode === mode ? '#4fc3f7' : '#e8e8e8'
    })

    this._setInfoText(mode)
  }

  _setInfoText(mode) {
    this._infoEl.innerHTML = ''

    const shortcuts = mode === 'object'
      ? [
          ['Tab', 'Edit Mode'],
          ['Click', 'Select'],
          ['Drag', 'Move'],
          ['Ctrl+Drag', 'Rotate'],
          ['G', 'Grab'],
          ['G > X/Y/Z', 'Axis constraint'],
          ['G > V', 'Set pivot'],
          ['N', 'Properties'],
        ]
      : [
          ['Tab', 'Object Mode'],
          ['Hover', 'Highlight face'],
          ['Drag', 'Extrude'],
          ['N', 'Properties'],
        ]

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

  /** Updates the status bar text */
  setStatus(text) {
    this._statusEl.textContent = text
  }

  /** Returns true if the N panel is currently visible */
  get nPanelVisible() {
    return this._nPanelVisible
  }

  /** Toggles N panel visibility */
  toggleNPanel() {
    this._nPanelVisible = !this._nPanelVisible
    this._nPanelEl.style.display = this._nPanelVisible ? 'block' : 'none'
  }

  /**
   * Updates N panel content.
   * @param {{ x: number, y: number, z: number }} centroid
   * @param {{ x: number, y: number, z: number }} dimensions
   */
  updateNPanel(centroid, dimensions) {
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

    this._nPanelContentEl.innerHTML = ''
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
