/**
 * OutlinerView - Blender-style left sidebar showing the scene object hierarchy
 *
 * Side effects: creates DOM elements, appends them to document.body.
 *
 * Hierarchy support (ADR-018):
 *   addObject(id, name, type, parentId) — when parentId is provided the row
 *   is inserted as an indented child directly below its parent (and after any
 *   existing siblings).  The parent row's triangle indicator turns orange to
 *   show it has children.  Removing a parent also removes all child rows.
 *
 * IFC classification (ADR-025):
 *   setObjectIfcClass(id, ifcClass) — updates the coloured IFC badge shown
 *   to the right of the object name. Pass null to hide the badge.
 */
import { IFC_CLASS_MAP } from '../domain/IFCClassRegistry.js'

export class OutlinerView {
  constructor() {
    // ── Panel container ────────────────────────────────────────────────────
    this._el = document.createElement('div')
    Object.assign(this._el.style, {
      position: 'fixed',
      top: '40px',
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
    /**
     * @type {Map<string, {
     *   rowEl: HTMLElement,
     *   eyeEl: HTMLElement,
     *   nameEl: HTMLElement,
     *   triEl: HTMLElement,
     *   ifcBadgeEl: HTMLElement,
     *   visible: boolean,
     *   parentId: string|null
     * }>}
     */
    this._items       = new Map()
    this._activeId    = null
    this._onSelectCb  = null
    this._onDeleteCb  = null
    this._onAddCb     = null
    this._onVisibleCb = null
    this._onRenameCb  = null
    /**
     * Maps childId → parentId for depth computation without querying SceneModel.
     * Used by _getDepth() to support multi-level indentation (ADR-019).
     * @type {Map<string, string>}
     */
    this._parentMap   = new Map()

    this._addBtn.addEventListener('click', () => {
      if (this._onAddCb) this._onAddCb()
    })

    // ── Mobile drawer ──────────────────────────────────────────────────────
    this._drawerOpen = false
    this._applyLayout()
    window.addEventListener('resize', () => this._applyLayout())
  }

  get width() { return 180 }

  // ─── Mobile drawer ─────────────────────────────────────────────────────────

  _isMobile() { return window.innerWidth < 768 }

  _applyLayout() {
    if (this._isMobile()) {
      Object.assign(this._el.style, {
        transition: 'transform 0.25s ease',
        transform: this._drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
      })
    } else {
      Object.assign(this._el.style, {
        transition: '',
        transform: 'translateX(0)',
      })
      this._drawerOpen = false
    }
  }

  openDrawer()  { this._drawerOpen = true;  this._el.style.transform = 'translateX(0)' }
  closeDrawer() { this._drawerOpen = false; this._el.style.transform = 'translateX(-100%)' }
  toggleDrawer() {
    if (this._drawerOpen) this.closeDrawer(); else this.openDrawer()
    return this._drawerOpen
  }

  get isDrawerOpen() { return this._drawerOpen }

  // ─── Callbacks ────────────────────────────────────────────────────────────
  onSelect(cb)  { this._onSelectCb  = cb }
  onDelete(cb)  { this._onDeleteCb  = cb }
  onAdd(cb)     { this._onAddCb     = cb }
  onVisible(cb) { this._onVisibleCb = cb }
  onRename(cb)  { this._onRenameCb  = cb }

  // ─── Object management ────────────────────────────────────────────────────

  /**
   * Adds an object row to the outliner list.
   * When parentId is provided, the row is inserted as a child of that parent,
   * indented visually and positioned after all existing descendants of that parent.
   * Supports arbitrary nesting depth (ADR-019 Phase B).
   *
   * @param {string} id
   * @param {string} name
   * @param {'cuboid'|'sketch'|'imported'|'measure'|'frame'} [type='cuboid']
   * @param {string|null} [parentId=null]
   */
  addObject(id, name, type = 'cuboid', parentId = null) {
    const depth = parentId ? this._getDepth(parentId) + 1 : 0
    const { rowEl, eyeEl, nameEl, triEl, ifcBadgeEl } = this._createRow(id, name, type, depth)

    if (parentId) {
      // Find insertion point: after the entire subtree rooted at parentId so
      // the new child appears below all existing descendants (not just siblings).
      const parentItem = this._items.get(parentId)
      if (parentItem) {
        const insertAfter = this._getLastDescendantEl(parentId)
        insertAfter.insertAdjacentElement('afterend', rowEl)
        // Show parent's expand triangle in orange to signal it has children.
        this._setParentIndicator(parentId, true)
      } else {
        this._listEl.appendChild(rowEl)
      }
      this._parentMap.set(id, parentId)
    } else {
      this._listEl.appendChild(rowEl)
    }

    this._items.set(id, { rowEl, eyeEl, nameEl, triEl, ifcBadgeEl, visible: true, parentId })
  }

  /**
   * Updates the IFC class badge for an object row.
   * @param {string} id
   * @param {string|null} ifcClass  — null hides the badge
   */
  setObjectIfcClass(id, ifcClass) {
    const item = this._items.get(id)
    if (!item) return
    const entry = ifcClass ? IFC_CLASS_MAP.get(ifcClass) : null
    if (entry) {
      item.ifcBadgeEl.textContent = entry.label
      item.ifcBadgeEl.title = entry.name
      Object.assign(item.ifcBadgeEl.style, {
        display: 'inline-block',
        background: entry.color + '22',
        border: `1px solid ${entry.color}`,
        color: entry.color,
      })
    } else {
      item.ifcBadgeEl.textContent = ''
      item.ifcBadgeEl.title = ''
      item.ifcBadgeEl.style.display = 'none'
    }
  }

  /** Updates the displayed name of an object row */
  setObjectName(id, name) {
    const item = this._items.get(id)
    if (item) item.nameEl.textContent = name
  }

  /**
   * Removes an object row and all of its descendants recursively.
   * If the removed object was a child, updates the parent's triangle indicator.
   * Supports nested frame hierarchies (ADR-019).
   * @param {string} id
   */
  removeObject(id) {
    const item = this._items.get(id)
    if (!item) return

    // Cascade: recursively remove all descendants before removing this item.
    for (const [childId, child] of this._items) {
      if (child.parentId === id) this.removeObject(childId)
    }

    // Update parent indicator if this child was the last one.
    if (item.parentId) {
      const remainingSiblings = [...this._items.values()].filter(
        i => i.parentId === item.parentId && i !== item,
      )
      if (remainingSiblings.length === 0) this._setParentIndicator(item.parentId, false)
    }

    this._parentMap.delete(id)
    item.rowEl.remove()
    this._items.delete(id)
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

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Updates the expand-triangle colour of a parent row.
   * Orange = has children; dark grey = no children.
   * @param {string} parentId
   * @param {boolean} hasChildren
   */
  _setParentIndicator(parentId, hasChildren) {
    const parentItem = this._items.get(parentId)
    if (!parentItem) return
    parentItem.triEl.style.color    = hasChildren ? '#cc7a00' : '#444'
    parentItem.triEl.style.fontSize = hasChildren ? '9px'     : '8px'
  }

  // ─── Row builder ──────────────────────────────────────────────────────────

  /**
   * Returns the depth of a given parent in the hierarchy.
   * Depth 0 means the parent is a root-level object (no parent itself).
   * @param {string} parentId
   * @returns {number}
   */
  _getDepth(parentId) {
    let depth = 0
    let id = parentId
    while (id) {
      depth++
      id = this._parentMap.get(id) ?? null
    }
    // depth counts the number of ancestors of parentId, so a direct child of
    // parentId would be at depth+1, but we return parentId's own depth here.
    // Callers add 1 to get the child's depth.
    return depth
  }

  /**
   * Returns the DOM element of the last descendant in the subtree rooted at parentId,
   * or the parent's own rowEl if it has no children.  Used to find the correct
   * insertion point when adding a new child so it appears below all existing descendants.
   * @param {string} parentId
   * @returns {HTMLElement}
   */
  _getLastDescendantEl(parentId) {
    let lastEl = this._items.get(parentId)?.rowEl
    for (const [childId, child] of this._items) {
      if (child.parentId === parentId) {
        const childLastEl = this._getLastDescendantEl(childId)
        if (childLastEl) lastEl = childLastEl
      }
    }
    return lastEl
  }

  /**
   * @param {string}  id
   * @param {string}  name
   * @param {string}  type
   * @param {number}  depth  0 = root, 1 = first child level, 2 = second, etc.
   */
  _createRow(id, name, type = 'cuboid', depth = 0) {
    const rowEl = document.createElement('div')
    // Each depth level adds 12 px of left padding.
    const leftPad = `${16 + depth * 12}px`
    Object.assign(rowEl.style, {
      display: 'flex',
      alignItems: 'center',
      padding: `3px 4px 3px ${leftPad}`,
      cursor: 'pointer',
      gap: '4px',
      background: 'transparent',
      borderBottom: '1px solid transparent',
    })

    // Expand triangle (visual only; turns orange when parent has children)
    const triEl = document.createElement('span')
    if (depth > 0) {
      // Child rows show a connector glyph instead of a triangle.
      triEl.textContent = '└'
      Object.assign(triEl.style, {
        color: '#555',
        fontSize: '10px',
        flexShrink: '0',
        lineHeight: '1',
        marginLeft: '-14px',
        marginRight: '2px',
      })
    } else {
      triEl.textContent = '▶'
      Object.assign(triEl.style, {
        color: '#444',
        fontSize: '8px',
        flexShrink: '0',
        lineHeight: '1',
      })
    }

    // Icon
    const iconEl = document.createElement('span')
    let iconText  = '⬡'
    let iconTitle = ''
    let iconColor = '#4fc3f7'

    if (type === 'measure') {
      iconText  = '↔'
      iconTitle = 'Measure line'
      iconColor = '#f9a825'
    } else if (type === 'imported') {
      iconTitle = 'Imported mesh (read-only)'
      iconColor = '#888888'
    } else if (type === 'frame') {
      iconText  = '⊕'
      iconTitle = 'Coordinate frame'
      iconColor = '#a0c8ff'
    } else if (type === 'sketch') {
      iconColor = '#80cbc4'
    }

    iconEl.textContent = iconText
    if (iconTitle) iconEl.title = iconTitle
    Object.assign(iconEl.style, {
      color: iconColor,
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

    // IFC class badge (hidden by default; shown via setObjectIfcClass)
    const ifcBadgeEl = document.createElement('span')
    Object.assign(ifcBadgeEl.style, {
      display: 'none',
      fontSize: '9px',
      fontWeight: 'bold',
      padding: '1px 4px',
      borderRadius: '2px',
      flexShrink: '0',
      maxWidth: '52px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      lineHeight: '1.4',
      fontFamily: 'sans-serif',
      cursor: 'default',
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
    const delEl = document.createElement('button')
    delEl.textContent = '✕'
    delEl.title = 'Delete'
    delEl.setAttribute('aria-label', 'Delete')
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
    rowEl.appendChild(ifcBadgeEl)
    rowEl.appendChild(eyeEl)
    rowEl.appendChild(delEl)

    // Double-click on name → inline rename
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      const input = document.createElement('input')
      Object.assign(input.style, {
        flex: '1',
        background: '#1a1a2e',
        border: '1px solid #4fc3f7',
        borderRadius: '2px',
        color: '#e8e8e8',
        fontSize: '12px',
        fontFamily: 'sans-serif',
        padding: '0 3px',
        outline: 'none',
        minWidth: '0',
      })
      input.value = nameEl.textContent
      nameEl.replaceWith(input)
      input.focus()
      input.select()

      const commit = () => {
        const newName = input.value.trim() || nameEl.textContent
        nameEl.textContent = newName
        input.replaceWith(nameEl)
        if (this._onRenameCb) this._onRenameCb(id, newName)
      }
      const cancel = () => { input.replaceWith(nameEl) }

      input.addEventListener('blur', commit)
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur() }
        if (ev.key === 'Escape') { input.removeEventListener('blur', commit); cancel() }
        ev.stopPropagation()
      })
    })

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

    return { rowEl, eyeEl, nameEl, triEl, ifcBadgeEl }
  }
}
