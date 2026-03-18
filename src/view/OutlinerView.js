/**
 * OutlinerView - Blender-style left sidebar showing the scene object hierarchy
 *
 * Side effects: creates DOM elements, appends them to document.body.
 */
export class OutlinerView {
  constructor() {
    // ── Panel container ────────────────────────────────────────────────────
    this._el = document.createElement('div')
    Object.assign(this._el.style, {
      position: 'fixed',
      top: '36px',
      left: '0',
      width: '180px',
      bottom: '26px',
      background: '#1c1c1c',
      borderRight: '1px solid #111',
      color: '#e8e8e8',
      fontFamily: 'sans-serif',
      fontSize: '12px',
      zIndex: '90',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
    })

    // ── Title bar ──────────────────────────────────────────────────────────
    const titleEl = document.createElement('div')
    Object.assign(titleEl.style, {
      padding: '5px 10px',
      background: '#2b2b2b',
      borderBottom: '1px solid #111',
      fontSize: '11px',
      color: '#999',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      flexShrink: '0',
    })
    titleEl.textContent = 'Scene Collection'
    this._el.appendChild(titleEl)

    // ── Object list ────────────────────────────────────────────────────────
    this._listEl = document.createElement('div')
    Object.assign(this._listEl.style, {
      flex: '1',
      overflowY: 'auto',
    })
    this._el.appendChild(this._listEl)

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerEl = document.createElement('div')
    Object.assign(footerEl.style, {
      padding: '5px 6px',
      borderTop: '1px solid #111',
      display: 'flex',
      gap: '4px',
      flexShrink: '0',
    })

    this._addBtn = document.createElement('button')
    Object.assign(this._addBtn.style, {
      flex: '1',
      padding: '4px 6px',
      background: '#3c3c3c',
      border: '1px solid #555',
      borderRadius: '3px',
      color: '#e8e8e8',
      fontSize: '11px',
      cursor: 'pointer',
      fontFamily: 'sans-serif',
    })
    this._addBtn.textContent = '+ Add  [Shift+A]'
    this._addBtn.addEventListener('mouseenter', () => { this._addBtn.style.background = '#4a4a4a' })
    this._addBtn.addEventListener('mouseleave', () => { this._addBtn.style.background = '#3c3c3c' })
    footerEl.appendChild(this._addBtn)
    this._el.appendChild(footerEl)

    document.body.appendChild(this._el)

    // ── State ──────────────────────────────────────────────────────────────
    this._items       = new Map()  // id → { rowEl, eyeEl, visible }
    this._activeId    = null
    this._onSelectCb  = null
    this._onDeleteCb  = null
    this._onAddCb     = null
    this._onVisibleCb = null

    this._addBtn.addEventListener('click', () => {
      if (this._onAddCb) this._onAddCb()
    })
  }

  get width() { return 180 }

  // ─── Callbacks ────────────────────────────────────────────────────────────
  onSelect(cb)  { this._onSelectCb  = cb }
  onDelete(cb)  { this._onDeleteCb  = cb }
  onAdd(cb)     { this._onAddCb     = cb }
  onVisible(cb) { this._onVisibleCb = cb }

  // ─── Object management ────────────────────────────────────────────────────

  addObject(id, name) {
    const { rowEl, eyeEl } = this._createRow(id, name)
    this._listEl.appendChild(rowEl)
    this._items.set(id, { rowEl, eyeEl, visible: true })
  }

  removeObject(id) {
    const item = this._items.get(id)
    if (item) { item.rowEl.remove(); this._items.delete(id) }
  }

  setActive(id) {
    this._activeId = id
    this._items.forEach((item, rowId) => {
      const isActive = rowId === id
      item.rowEl.style.background = isActive ? 'rgba(255,112,67,0.18)' : 'transparent'
      item.rowEl.querySelector('.obj-name').style.color = isActive ? '#ff8c69' : '#e0e0e0'
    })
  }

  setObjectVisible(id, visible) {
    const item = this._items.get(id)
    if (!item) return
    item.visible = visible
    item.eyeEl.style.opacity = visible ? '1' : '0.3'
    item.eyeEl.title = visible ? 'Hide' : 'Show'
  }

  // ─── Row builder ──────────────────────────────────────────────────────────

  _createRow(id, name) {
    const rowEl = document.createElement('div')
    Object.assign(rowEl.style, {
      display: 'flex',
      alignItems: 'center',
      padding: '3px 4px 3px 16px',
      cursor: 'pointer',
      gap: '4px',
      background: 'transparent',
      borderBottom: '1px solid transparent',
    })

    // Expand triangle (visual only)
    const triEl = document.createElement('span')
    triEl.textContent = '▶'
    Object.assign(triEl.style, {
      color: '#444',
      fontSize: '8px',
      flexShrink: '0',
      lineHeight: '1',
    })

    // Mesh icon
    const iconEl = document.createElement('span')
    iconEl.textContent = '⬡'
    Object.assign(iconEl.style, {
      color: '#4fc3f7',
      fontSize: '12px',
      flexShrink: '0',
      lineHeight: '1',
    })

    // Name
    const nameEl = document.createElement('span')
    nameEl.textContent = name
    nameEl.className = 'obj-name'
    Object.assign(nameEl.style, {
      flex: '1',
      color: '#e0e0e0',
      fontSize: '12px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    })

    // Eye (visibility toggle)
    const eyeEl = document.createElement('span')
    eyeEl.textContent = '👁'
    eyeEl.title = 'Hide'
    Object.assign(eyeEl.style, {
      color: '#aaa',
      fontSize: '10px',
      flexShrink: '0',
      opacity: '0',
      lineHeight: '1',
      padding: '0 2px',
    })
    eyeEl.addEventListener('click', (e) => {
      e.stopPropagation()
      const item = this._items.get(id)
      if (!item) return
      const newVisible = !item.visible
      this.setObjectVisible(id, newVisible)
      if (this._onVisibleCb) this._onVisibleCb(id, newVisible)
    })

    // Delete button
    const delEl = document.createElement('span')
    delEl.textContent = '✕'
    delEl.title = 'Delete'
    Object.assign(delEl.style, {
      color: '#888',
      fontSize: '10px',
      flexShrink: '0',
      opacity: '0',
      lineHeight: '1',
      padding: '0 2px',
    })
    delEl.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this._onDeleteCb) this._onDeleteCb(id)
    })

    rowEl.appendChild(triEl)
    rowEl.appendChild(iconEl)
    rowEl.appendChild(nameEl)
    rowEl.appendChild(eyeEl)
    rowEl.appendChild(delEl)

    rowEl.addEventListener('mouseenter', () => {
      if (id !== this._activeId) rowEl.style.background = 'rgba(255,255,255,0.05)'
      eyeEl.style.opacity = '1'
      delEl.style.opacity = '1'
    })
    rowEl.addEventListener('mouseleave', () => {
      if (id !== this._activeId) rowEl.style.background = 'transparent'
      eyeEl.style.opacity = '0'
      delEl.style.opacity = '0'
    })
    rowEl.addEventListener('click', () => {
      if (this._onSelectCb) this._onSelectCb(id)
    })

    return { rowEl, eyeEl }
  }
}
