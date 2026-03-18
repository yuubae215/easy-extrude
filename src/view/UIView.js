/**
 * UIView - manages DOM UI elements
 *
 * Side effects: creates DOM elements, appends them, and modifies their styles.
 */
export class UIView {
  constructor() {
    // Mode bar (top-left)
    this._modeBarEl = document.createElement('div')
    Object.assign(this._modeBarEl.style, {
      position: 'fixed', top: '20px', left: '20px',
      display: 'flex', gap: '8px',
    })
    document.body.appendChild(this._modeBarEl)

    // Status bar (top-center)
    this._statusEl = document.createElement('div')
    Object.assign(this._statusEl.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      color: '#ffeb3b', fontSize: '15px', fontFamily: 'sans-serif',
      background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: '6px',
      pointerEvents: 'none', minWidth: '120px', textAlign: 'center',
    })
    document.body.appendChild(this._statusEl)

    // Info bar (bottom-center)
    this._infoEl = document.createElement('div')
    Object.assign(this._infoEl.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      color: '#ccc', fontSize: '13px', fontFamily: 'sans-serif',
      background: 'rgba(0,0,0,0.55)', padding: '8px 18px', borderRadius: '8px',
      pointerEvents: 'none', textAlign: 'center', lineHeight: '1.6',
    })
    document.body.appendChild(this._infoEl)

    this._btnObject = this._makeBtn('Object (O)')
    this._btnFace   = this._makeBtn('Face (F)')
    this._modeBarEl.appendChild(this._btnObject)
    this._modeBarEl.appendChild(this._btnFace)

    this._canvas = null

    // Extrusion label (floating, follows 3D midpoint projected to screen)
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
  }

  _makeBtn(label) {
    const btn = document.createElement('button')
    btn.textContent = label
    Object.assign(btn.style, {
      padding: '7px 15px', borderRadius: '6px', border: '2px solid #555',
      background: 'rgba(0,0,0,0.6)', color: '#aaa', cursor: 'pointer',
      fontSize: '13px', fontFamily: 'sans-serif',
    })
    return btn
  }

  /** Registers callbacks for mode-change button clicks */
  onModeChange(callback) {
    this._btnObject.addEventListener('click', () => callback('object'))
    this._btnFace.addEventListener('click',   () => callback('face'))
  }

  /** Updates button appearance and info text to match the active mode */
  updateMode(mode) {
    const active   = { background: 'rgba(79,195,247,0.25)', color: '#4fc3f7', borderColor: '#4fc3f7' }
    const inactive = { background: 'rgba(0,0,0,0.6)',       color: '#aaa',    borderColor: '#555' }
    Object.assign(this._btnObject.style, mode === 'object' ? active : inactive)
    Object.assign(this._btnFace.style,   mode === 'face'   ? active : inactive)
    this._infoEl.innerHTML = mode === 'object'
      ? 'Click→Select &nbsp;|&nbsp; Left-drag→Move &nbsp;|&nbsp; Ctrl+drag→Rotate Y &nbsp;|&nbsp; Right-drag→Orbit'
        + '<br>G→Grab &nbsp;|&nbsp; G→X/Y/Z→Axis constraint &nbsp;|&nbsp; Type value→set distance &nbsp;|&nbsp; Enter/LClick→confirm &nbsp;|&nbsp; Esc/RClick→cancel'
      : 'Hover face→highlight &nbsp;|&nbsp; Left-drag→Extrude &nbsp;|&nbsp; Right-drag→Orbit'
  }

  /** Updates the status bar text */
  setStatus(text) {
    this._statusEl.textContent = text
  }

  /**
   * Shows the extrusion amount label at a screen position.
   * @param {string} text - label text
   * @param {number} screenX - screen X coordinate (px)
   * @param {number} screenY - screen Y coordinate (px)
   */
  setExtrusionLabel(text, screenX, screenY) {
    this._extrusionLabelEl.textContent = text
    this._extrusionLabelEl.style.left = `${screenX}px`
    this._extrusionLabelEl.style.top  = `${screenY}px`
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
