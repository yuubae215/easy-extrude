import { useUIStore } from '../store/uiStore.js'

/**
 * UIViewBridge — wraps UIView and mirrors key method calls into the Zustand
 * store so React components can read the same UI state.
 *
 * Forwards every call to the original UIView first, then updates the store.
 * This keeps UIView.js fully functional during the incremental React migration.
 *
 * React takeover flags: once a React component fully covers a UIView section,
 * call enableReact*() to stop forwarding to UIView for that section.
 *
 * Methods bridged (state → store):
 *   showToast, setStatus, setStatusRich, setCursor,
 *   setMobileToolbar, updateMode, setExtrusionLabel,
 *   enableSaveLoad
 *
 * Methods bridged (callbacks → store):
 *   onModeChange, onOutlinerToggle, onNPanelToggle,
 *   onUndoClick, onRedoClick, onMapModeClick,
 *   onNodeEditorToggle, onExportJson, onImportJson
 */
export class UIViewBridge {
  // Class fields ensure the Proxy set-handler stores these on this instance.
  _reactMobileToolbar     = false
  _reactHeader            = false
  _reactNPanel            = false
  _reactExtrusionLabel    = false
  _reactInfoBar           = false
  _reactModals            = false
  _reactMapToolbar        = false

  constructor(uiView) {
    this._view = uiView
    this._nativeToolbarEl     = uiView._mobileToolbarEl     ?? null
    this._nativeHeaderEl      = uiView._headerEl            ?? null
    this._nativePanelEl       = uiView._nPanelEl            ?? null
    this._nativeExtrusionEl   = uiView._extrusionLabelEl    ?? null
    this._nativeInfoEl        = uiView._infoEl              ?? null

    // Expose every property/method on the wrapped view transparently so
    // AppController can use this as a drop-in replacement for UIView.
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) return typeof target[prop] === 'function'
          ? target[prop].bind(target)
          : target[prop]
        const orig = target._view[prop]
        return typeof orig === 'function' ? orig.bind(target._view) : orig
      },
      set(target, prop, value) {
        if (prop in target) { target[prop] = value; return true }
        target._view[prop] = value
        return true
      },
    })
  }

  // ── React takeover enablers ───────────────────────────────────────────────

  enableReactMobileToolbar() {
    this._reactMobileToolbar = true
    if (this._nativeToolbarEl) {
      this._nativeToolbarEl.style.setProperty('display', 'none', 'important')
    }
    const view = this._view
    const origApply = view._applyMobileLayout.bind(view)
    view._applyMobileLayout = () => {
      origApply()
      if (this._nativeToolbarEl) {
        this._nativeToolbarEl.style.setProperty('display', 'none', 'important')
      }
    }
  }

  enableReactHeader() {
    this._reactHeader = true
    if (this._nativeHeaderEl) {
      this._nativeHeaderEl.style.setProperty('display', 'none', 'important')
    }
    // Patch _applyMobileLayout so resize never re-shows the native header.
    const view = this._view
    const prevApply = view._applyMobileLayout.bind(view)
    view._applyMobileLayout = () => {
      prevApply()
      if (this._nativeHeaderEl) {
        this._nativeHeaderEl.style.setProperty('display', 'none', 'important')
      }
    }
  }

  enableReactNPanel() {
    this._reactNPanel = true
    if (this._nativePanelEl) {
      this._nativePanelEl.style.setProperty('display', 'none', 'important')
    }
    const view = this._view
    const prevApply = view._applyMobileLayout.bind(view)
    view._applyMobileLayout = () => {
      prevApply()
      if (this._nativePanelEl) {
        this._nativePanelEl.style.setProperty('display', 'none', 'important')
      }
    }
  }

  enableReactExtrusionLabel() {
    this._reactExtrusionLabel = true
    if (this._nativeExtrusionEl) {
      this._nativeExtrusionEl.style.setProperty('display', 'none', 'important')
    }
  }

  enableReactInfoBar() {
    this._reactInfoBar = true
    if (this._nativeInfoEl) {
      this._nativeInfoEl.style.setProperty('display', 'none', 'important')
    }
  }

  enableReactModals() {
    this._reactModals = true
  }

  enableReactMapToolbar() {
    this._reactMapToolbar = true
    const statusEl = this._view._canvasStatusEl
    if (statusEl) {
      statusEl.style.setProperty('display', 'none', 'important')
    }
    const view = this._view
    const prevApply = view._applyMobileLayout.bind(view)
    view._applyMobileLayout = () => {
      prevApply()
      if (statusEl) statusEl.style.setProperty('display', 'none', 'important')
    }
  }

  showMapToolbar(activeTool, onToolSelect, onConfirm, onCancel, onExit, pendingName = null) {
    if (this._reactMapToolbar) {
      const { registerCallback, setMapToolbar, setMapPendingNameInput } =
        useUIStore.getState().actions
      registerCallback('onMapToolSelect', onToolSelect)
      registerCallback('onMapConfirm', onConfirm ?? null)
      registerCallback('onMapCancel',  onCancel  ?? null)
      registerCallback('onMapExit',    onExit)
      setMapToolbar({ visible: true, activeTool, pendingName,
                      showConfirm: !!onConfirm, showCancel: !!onCancel })
      setMapPendingNameInput(pendingName ?? '')
      return
    }
    this._view.showMapToolbar(activeTool, onToolSelect, onConfirm, onCancel, onExit, pendingName)
  }

  hideMapToolbar() {
    if (this._reactMapToolbar) {
      useUIStore.getState().actions.setMapToolbar({
        visible: false, activeTool: null, pendingName: null,
        showConfirm: false, showCancel: false,
      })
      return
    }
    this._view.hideMapToolbar()
  }

  getMapPendingName() {
    if (this._reactMapToolbar) {
      // 空文字を null に変換して AppController の ?? フォールバックを有効化
      return useUIStore.getState().mapPendingNameInput || null
    }
    return this._view.getMapPendingName()
  }

  // ── N-Panel visibility ────────────────────────────────────────────────────
  // Getter override so AppController's `if (!this._uiView.nPanelVisible) return`
  // reads from the store once React has taken over.

  get nPanelVisible() {
    return useUIStore.getState().nPanelVisible
  }

  toggleNPanel() {
    const next = !useUIStore.getState().nPanelVisible
    useUIStore.getState().actions.setNPanelVisible(next)
    if (!this._reactNPanel) {
      this._view.toggleNPanel()
    }
  }

  showBackdrop(onClose) {
    if (!this._reactNPanel) {
      this._view.showBackdrop(onClose)
    }
    useUIStore.getState().actions.setBackdrop(onClose ?? null)
  }

  hideBackdrop() {
    if (!this._reactNPanel) {
      this._view.hideBackdrop()
    }
    useUIStore.getState().actions.setBackdrop(null)
  }

  // ── State → store bridges ─────────────────────────────────────────────────

  showToast(msg, opts = {}) {
    this._view.showToast(msg, opts)
    useUIStore.getState().actions.pushToast(msg, opts.type ?? 'info')
  }

  setStatus(text) {
    this._view.setStatus(text)
    useUIStore.getState().actions.setStatus(text)
  }

  setStatusRich(parts) {
    this._view.setStatusRich(parts)
    useUIStore.getState().actions.setStatusRich(parts)
  }

  setCursor(style) {
    this._view.setCursor(style)
    useUIStore.getState().actions.setCursor(style)
  }

  setMobileToolbar(buttons) {
    if (!this._reactMobileToolbar) {
      this._view.setMobileToolbar(buttons)
    }
    useUIStore.getState().actions.setToolbar(buttons)
  }

  updateMode(mode, subtype = null) {
    if (!this._reactInfoBar) {
      this._view.updateMode(mode, subtype)
    }
    useUIStore.getState().actions.updateMode(mode, subtype)
  }

  setExtrusionLabel(text, x, y) {
    if (!this._reactExtrusionLabel) {
      this._view.setExtrusionLabel(text, x, y)
    }
    useUIStore.getState().actions.setExtrusionLabel(text, x, y)
  }

  clearExtrusionLabel() {
    if (!this._reactExtrusionLabel) {
      this._view.clearExtrusionLabel()
    }
    useUIStore.getState().actions.setExtrusionLabel(null, 0, 0)
  }

  appendInfoHint(key, desc) {
    if (!this._reactInfoBar) {
      this._view.appendInfoHint?.(key, desc)
    }
    useUIStore.getState().actions.setExtraHint(key ?? null, desc)
  }

  // clearExtraHint is the idiomatic clear for appendInfoHint(null).
  // Kept as a separate bridge method for symmetry with clearExtrusionLabel.
  clearExtraHint() {
    if (!this._reactInfoBar) {
      this._view.appendInfoHint?.(null)
    }
    useUIStore.getState().actions.setExtraHint(null)
  }

  showRenameDialog(currentName, callback, options = {}) {
    if (this._reactModals) {
      useUIStore.getState().actions.showModal({
        type: 'rename',
        currentName,
        callback,
        title: options.title ?? 'Rename',
      })
      return
    }
    this._view.showRenameDialog(currentName, callback, options)
  }

  showConfirmDialog(message, callback, options = {}) {
    if (this._reactModals) {
      useUIStore.getState().actions.showModal({
        type: 'confirm',
        message,
        callback,
        title:        options.title        ?? 'Confirm',
        confirmLabel: options.confirmLabel ?? 'OK',
        danger:       options.danger       ?? false,
      })
      return
    }
    this._view.showConfirmDialog(message, callback, options)
  }

  enableSaveLoad(onSave, onLoad) {
    // Forward to UIView (keeps native buttons alive while not React-headed).
    this._view.enableSaveLoad(onSave, onLoad)
    // Store callbacks and flip the bffConnected flag for the React header.
    const { registerCallback, setBffConnected } = useUIStore.getState().actions
    registerCallback('onSaveScene', onSave)
    registerCallback('onLoadScene', onLoad)
    setBffConnected(true)
  }

  // ── Callback → store bridges ──────────────────────────────────────────────
  // Each method registers the callback with UIView AND with the store so that
  // React components can invoke it when the React header has taken over.

  onModeChange(cb) {
    this._view.onModeChange(cb)
    useUIStore.getState().actions.registerCallback('onModeChange', cb)
  }

  onOutlinerToggle(cb) {
    this._view.onOutlinerToggle(cb)
    useUIStore.getState().actions.registerCallback('onOutlinerToggle', cb)
  }

  onNPanelToggle(cb) {
    this._view.onNPanelToggle(cb)
    useUIStore.getState().actions.registerCallback('onNPanelToggle', cb)
  }

  onUndoClick(cb) {
    this._view.onUndoClick(cb)
    useUIStore.getState().actions.registerCallback('onUndoClick', cb)
  }

  onRedoClick(cb) {
    this._view.onRedoClick(cb)
    useUIStore.getState().actions.registerCallback('onRedoClick', cb)
  }

  onMapModeClick(cb) {
    this._view.onMapModeClick(cb)
    useUIStore.getState().actions.registerCallback('onMapModeClick', cb)
  }

  onNodeEditorToggle(cb) {
    // Wrap so each invocation also toggles the store's nodeEditorOpen flag.
    const wrapped = () => {
      cb()
      useUIStore.setState(s => ({ nodeEditorOpen: !s.nodeEditorOpen }))
    }
    this._view.onNodeEditorToggle(wrapped)
    useUIStore.getState().actions.registerCallback('onNodeEditorToggle', wrapped)
  }

  onExportJson(cb) {
    this._view.onExportJson(cb)
    useUIStore.getState().actions.registerCallback('onExportJson', cb)
  }

  onImportJson(cb) {
    this._view.onImportJson(cb)
    useUIStore.getState().actions.registerCallback('onImportJson', cb)
  }

  // ── N-Panel state bridges ─────────────────────────────────────────────────

  updateNPanel(centroid, dimensions, name = '', description = '', options = {}) {
    if (!this._reactNPanel) {
      this._view.updateNPanel(centroid, dimensions, name, description, options)
    }
    useUIStore.getState().actions.setNPanelData({
      type: 'generic',
      centroid: { x: centroid.x, y: centroid.y, z: centroid.z },
      dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      name, description,
      locationEditable:     options.locationEditable    ?? false,
      showIfcClass:         options.showIfcClass        ?? false,
      ifcClass:             options.ifcClass            ?? null,
      showPlaceType:        options.showPlaceType       ?? false,
      placeType:            options.placeType           ?? null,
      placeTypeGeometry:    options.placeTypeGeometry   ?? null,
      spatialLinks:         options.spatialLinks        ?? null,
      currentEntityId:      options.currentEntityId     ?? null,
      onDeleteSpatialLink:  options.onDeleteSpatialLink ?? null,
      getEntityName:        options.getEntityName       ?? ((id) => id),
      frames:               options.frames              ?? null,
      onAddFrame:           options.onAddFrame          ?? null,
      onSelectFrame:        options.onSelectFrame       ?? null,
    })
  }

  updateNPanelForFrame(
    pos, eulerDeg, name,
    locked = false,
    parentOptions = null,
    currentParentId = null,
    unreferenced = false,
    childFrames = null,
    onAddChildFrame = null,
    onSelectChildFrame = null,
  ) {
    if (!this._reactNPanel) {
      this._view.updateNPanelForFrame(
        pos, eulerDeg, name, locked, parentOptions, currentParentId,
        unreferenced, childFrames, onAddChildFrame, onSelectChildFrame,
      )
    }
    useUIStore.getState().actions.setNPanelData({
      type: 'frame',
      pos: { x: pos.x, y: pos.y, z: pos.z },
      eulerDeg: { x: eulerDeg.x, y: eulerDeg.y, z: eulerDeg.z },
      name, locked, parentOptions, currentParentId,
      unreferenced, childFrames, onAddChildFrame, onSelectChildFrame,
    })
  }

  updateNPanelForSpatialLink(link, srcName, tgtName, onDelete) {
    if (!this._reactNPanel) {
      this._view.updateNPanelForSpatialLink(link, srcName, tgtName, onDelete)
    }
    useUIStore.getState().actions.setNPanelData({
      type: 'link',
      link, srcName, tgtName, onDelete,
    })
  }

  // ── N-Panel callback bridges ──────────────────────────────────────────────

  onNameChange(cb) {
    this._view.onNameChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelNameChange', cb)
  }

  onDescriptionChange(cb) {
    this._view.onDescriptionChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelDescriptionChange', cb)
  }

  onLocationChange(cb) {
    this._view.onLocationChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelLocationChange', cb)
  }

  onFramePositionChange(cb) {
    this._view.onFramePositionChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelFramePositionChange', cb)
  }

  onFrameRotationChange(cb) {
    this._view.onFrameRotationChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelFrameRotationChange', cb)
  }

  onFrameParentChange(cb) {
    this._view.onFrameParentChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelFrameParentChange', cb)
  }

  onIfcClassChange(cb) {
    this._view.onIfcClassChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelIfcClassChange', cb)
  }

  onPlaceTypeChange(cb) {
    this._view.onPlaceTypeChange(cb)
    useUIStore.getState().actions.registerCallback('onNPanelPlaceTypeChange', cb)
  }
}
