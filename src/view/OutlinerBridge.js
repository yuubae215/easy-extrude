import { useUIStore } from '../store/uiStore.js'

/**
 * OutlinerBridge — mirrors OutlinerView's public API to uiStore so the
 * React Outliner component can read current state.
 *
 * Phase 5: nativeView is optional (pass null or omit when React is always on).
 * Native calls are skipped when no native view is provided.
 */
export class OutlinerBridge {
  constructor(nativeView = null) {
    this._native = nativeView
    this._reactEnabled = false
  }

  enableReact() {
    this._reactEnabled = true
    this._native?._el?.style.setProperty('display', 'none', 'important')
  }

  // ── Object mutations ──────────────────────────────────────────────────────

  addObject(id, name, type, parentId) {
    if (this._native) this._native.addObject(id, name, type, parentId)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerAddItem(id, name, type, parentId)
  }

  removeObject(id) {
    if (this._native) this._native.removeObject(id)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerRemoveItem(id)
  }

  setActive(id) {
    if (this._native) this._native.setActive(id)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetActive(id)
  }

  setObjectVisible(id, visible) {
    if (this._native) this._native.setObjectVisible(id, visible)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { visible })
  }

  setObjectName(id, name) {
    if (this._native) this._native.setObjectName(id, name)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { name })
  }

  setObjectPlaceType(id, placeType) {
    if (this._native) this._native.setObjectPlaceType(id, placeType)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { placeType })
  }

  setObjectIfcClass(id, ifcClass) {
    if (this._native) this._native.setObjectIfcClass(id, ifcClass)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { ifcClass })
  }

  setObjectLinked(id, asSource, asTarget) {
    if (this._native) this._native.setObjectLinked(id, asSource, asTarget)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { linked: { asSource, asTarget } })
  }

  setFrameUnreferenced(id, unreferenced) {
    if (this._native) this._native.setFrameUnreferenced(id, unreferenced)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { unreferenced })
  }

  reparentObject(id, newParentId) {
    if (this._native) this._native.reparentObject(id, newParentId)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerReparentItem(id, newParentId)
  }

  setObjectLocked(id, locked) {
    if (this._native) this._native.setObjectLocked(id, locked)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { locked })
  }

  // ── Mobile drawer ─────────────────────────────────────────────────────────

  openDrawer() {
    if (this._native) this._native.openDrawer()
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetDrawerOpen(true)
  }

  closeDrawer() {
    if (this._native) this._native.closeDrawer()
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetDrawerOpen(false)
  }

  toggleDrawer() {
    const next = this._native ? !this._native.isDrawerOpen : !useUIStore.getState().outlinerDrawerOpen
    if (this._native) this._native.toggleDrawer()
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetDrawerOpen(next)
    return next
  }

  get isDrawerOpen() {
    return this._native ? this._native.isDrawerOpen : useUIStore.getState().outlinerDrawerOpen
  }

  get width() {
    return this._native ? this._native.width : 0
  }

  // ── Callback registration ─────────────────────────────────────────────────

  onSelect(cb)   { if (this._native) this._native.onSelect(cb);   useUIStore.getState().actions.registerCallback('outlinerOnSelect',   cb) }
  onDelete(cb)   { if (this._native) this._native.onDelete(cb);   useUIStore.getState().actions.registerCallback('outlinerOnDelete',   cb) }
  onAdd(cb)      { if (this._native) this._native.onAdd(cb);      useUIStore.getState().actions.registerCallback('outlinerOnAdd',      cb) }
  onVisible(cb)  { if (this._native) this._native.onVisible(cb);  useUIStore.getState().actions.registerCallback('outlinerOnVisible',  cb) }
  onRename(cb)   { if (this._native) this._native.onRename(cb);   useUIStore.getState().actions.registerCallback('outlinerOnRename',   cb) }
  onReparent(cb) { if (this._native) this._native.onReparent(cb); useUIStore.getState().actions.registerCallback('outlinerOnReparent', cb) }
}
