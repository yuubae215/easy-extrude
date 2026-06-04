import { useUIStore } from '../store/uiStore.js'

/**
 * OutlinerBridge — wraps OutlinerView with the same public interface and
 * dual-writes to uiStore when React mode is enabled (Strangler Fig pattern).
 *
 * AppController receives an OutlinerBridge instead of a raw OutlinerView.
 * Callbacks registered via onSelect/onDelete/etc. are stored in uiStore.callbacks
 * so the React Outliner component can invoke them.
 */
export class OutlinerBridge {
  constructor(native) {
    this._native = native
    this._reactEnabled = false
  }

  enableReact() {
    this._reactEnabled = true
    this._native._el.style.setProperty('display', 'none', 'important')
  }

  // ── Object mutations ──────────────────────────────────────────────────────

  addObject(id, name, type, parentId) {
    this._native.addObject(id, name, type, parentId)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerAddItem(id, name, type, parentId)
  }

  removeObject(id) {
    this._native.removeObject(id)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerRemoveItem(id)
  }

  setActive(id) {
    this._native.setActive(id)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetActive(id)
  }

  setObjectVisible(id, visible) {
    this._native.setObjectVisible(id, visible)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { visible })
  }

  setObjectName(id, name) {
    this._native.setObjectName(id, name)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { name })
  }

  setObjectPlaceType(id, placeType) {
    this._native.setObjectPlaceType(id, placeType)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { placeType })
  }

  setObjectIfcClass(id, ifcClass) {
    this._native.setObjectIfcClass(id, ifcClass)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { ifcClass })
  }

  setObjectLinked(id, asSource, asTarget) {
    this._native.setObjectLinked(id, asSource, asTarget)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { linked: { asSource, asTarget } })
  }

  setFrameUnreferenced(id, unreferenced) {
    this._native.setFrameUnreferenced(id, unreferenced)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { unreferenced })
  }

  reparentObject(id, newParentId) {
    this._native.reparentObject(id, newParentId)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerReparentItem(id, newParentId)
  }

  setObjectLocked(id, locked) {
    this._native.setObjectLocked(id, locked)
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerUpdateItem(id, { locked })
  }

  // ── Mobile drawer ─────────────────────────────────────────────────────────

  openDrawer() {
    this._native.openDrawer()
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetDrawerOpen(true)
  }

  closeDrawer() {
    this._native.closeDrawer()
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetDrawerOpen(false)
  }

  toggleDrawer() {
    const next = !this._native.isDrawerOpen
    this._native.toggleDrawer()
    if (this._reactEnabled)
      useUIStore.getState().actions.outlinerSetDrawerOpen(next)
    return next
  }

  get isDrawerOpen() { return this._native.isDrawerOpen }
  get width()        { return this._native.width }

  // ── Callback registration ─────────────────────────────────────────────────
  // Stores callbacks in uiStore.callbacks so the React component can call them.

  onSelect(cb)   { this._native.onSelect(cb);   useUIStore.getState().actions.registerCallback('outlinerOnSelect',   cb) }
  onDelete(cb)   { this._native.onDelete(cb);   useUIStore.getState().actions.registerCallback('outlinerOnDelete',   cb) }
  onAdd(cb)      { this._native.onAdd(cb);      useUIStore.getState().actions.registerCallback('outlinerOnAdd',      cb) }
  onVisible(cb)  { this._native.onVisible(cb);  useUIStore.getState().actions.registerCallback('outlinerOnVisible',  cb) }
  onRename(cb)   { this._native.onRename(cb);   useUIStore.getState().actions.registerCallback('outlinerOnRename',   cb) }
  onReparent(cb) { this._native.onReparent(cb); useUIStore.getState().actions.registerCallback('outlinerOnReparent', cb) }
}
