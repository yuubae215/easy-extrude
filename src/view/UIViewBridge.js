import { useUIStore } from '../store/uiStore.js'

/**
 * UIViewBridge — coordinates AppController ↔ Zustand store.
 *
 * All UI sections have been migrated to React (Phase 0–4). The bridge's
 * sole job now is to route AppController method calls to store actions so
 * React components can read current UI state.
 *
 * The Proxy wrapper has been removed (Phase 5). Every method called by
 * AppController is explicitly defined here.
 */
export class UIViewBridge {
  _reactMobileToolbar      = false
  _reactHeader             = false
  _reactNPanel             = false
  _reactExtrusionLabel     = false
  _reactInfoBar            = false
  _reactModals             = false
  _reactContextMenu        = false
  _reactAddMenu            = false
  _reactLinkTypePicker     = false
  _reactSemanticSuggestion = false
  _reactImportUI           = false
  _reactOnboarding         = false

  constructor(uiView) {
    this._view = uiView
  }

  // ── React takeover enablers (all UI sections migrated → flag-only) ────────

  enableReactMobileToolbar()      { this._reactMobileToolbar = true }
  enableReactHeader()             { this._reactHeader = true }
  enableReactNPanel()             { this._reactNPanel = true }
  enableReactExtrusionLabel()     { this._reactExtrusionLabel = true }
  enableReactInfoBar()            { this._reactInfoBar = true }
  enableReactModals()             { this._reactModals = true }
  enableReactContextMenu()        { this._reactContextMenu = true }
  enableReactAddMenu()            { this._reactAddMenu = true }
  enableReactLinkTypePicker()     { this._reactLinkTypePicker = true }
  enableReactSemanticSuggestion() { this._reactSemanticSuggestion = true }
  enableReactImportUI()           { this._reactImportUI = true }
  enableReactOnboarding()         { this._reactOnboarding = true }

  // ── Canvas / cursor ───────────────────────────────────────────────────────

  setCanvas(canvas) {
    this._view.setCanvas(canvas)
  }

  setCursor(style) {
    this._view.setCursor(style)
    useUIStore.getState().actions.setCursor(style)
  }

  // ── Header state ─────────────────────────────────────────────────────────

  setStatus(text) {
    useUIStore.getState().actions.setStatus(text)
  }

  setStatusRich(parts) {
    useUIStore.getState().actions.setStatusRich(parts)
  }

  setUndoRedoEnabled(canUndo, canRedo) {
    useUIStore.getState().actions.setUndoRedoEnabled(canUndo, canRedo)
  }

  // ── Mobile toolbar ────────────────────────────────────────────────────────

  setMobileToolbar(buttons) {
    useUIStore.getState().actions.setToolbar(buttons)
  }

  // ── Mode / info bar ───────────────────────────────────────────────────────

  updateMode(mode, subtype = null) {
    useUIStore.getState().actions.updateMode(mode, subtype)
  }

  appendInfoHint(key, desc) {
    useUIStore.getState().actions.setExtraHint(key ?? null, desc)
  }

  clearExtraHint() {
    useUIStore.getState().actions.setExtraHint(null)
  }

  // ── Extrusion label ───────────────────────────────────────────────────────

  setExtrusionLabel(text, x, y) {
    useUIStore.getState().actions.setExtrusionLabel(text, x, y)
  }

  clearExtrusionLabel() {
    useUIStore.getState().actions.setExtrusionLabel(null, 0, 0)
  }

  // ── Toasts ────────────────────────────────────────────────────────────────

  showToast(msg, opts = {}) {
    useUIStore.getState().actions.pushToast(msg, opts.type ?? 'info')
  }

  // ── N-Panel visibility ────────────────────────────────────────────────────

  get nPanelVisible() {
    return useUIStore.getState().nPanelVisible
  }

  toggleNPanel() {
    const next = !useUIStore.getState().nPanelVisible
    useUIStore.getState().actions.setNPanelVisible(next)
  }

  showBackdrop(onClose) {
    useUIStore.getState().actions.setBackdrop(onClose ?? null)
  }

  hideBackdrop() {
    useUIStore.getState().actions.setBackdrop(null)
  }

  // ── Modals / dialogs ─────────────────────────────────────────────────────

  showRenameDialog(currentName, callback, options = {}) {
    useUIStore.getState().actions.showModal({
      type: 'rename',
      currentName,
      callback,
      title: options.title ?? 'Rename',
    })
  }

  showConfirmDialog(message, callback, options = {}) {
    useUIStore.getState().actions.showModal({
      type: 'confirm',
      message,
      callback,
      title:        options.title        ?? 'Confirm',
      confirmLabel: options.confirmLabel ?? 'OK',
      danger:       options.danger       ?? false,
    })
  }

  // ── Overlay bridges ───────────────────────────────────────────────────────

  showContextMenu(x, y, items) {
    useUIStore.getState().actions.showContextMenu({ x, y, items })
  }

  hideContextMenu() {
    useUIStore.getState().actions.hideContextMenu()
  }

  /**
   * Opens the Add menu. Takes an options object rather than a positional tail:
   * ADR-103 moved the five place-type tools in here, and a 7th / 8th positional
   * callback is exactly how a caller silently passes the wrong verb.
   * @param {number} x
   * @param {number} y
   * @param {{onBox?:Function, onSketch?:Function, onMeasure?:Function,
   *          onImportStep?:Function, onFrame?:Function, onRobot?:Function,
   *          onPlace?:(type:string)=>void}} cbs
   */
  showAddMenu(x, y, cbs) {
    useUIStore.getState().actions.showAddMenu({ x, y, cbs })
  }

  hideAddMenu() {
    useUIStore.getState().actions.hideAddMenu()
  }

  showLinkTypePicker(x, y, onSelect, { linkOptions } = {}) {
    useUIStore.getState().actions.showLinkTypePicker({
      x, y,
      options: linkOptions ?? [],
      onSelect,
    })
  }

  hideLinkTypePicker() {
    useUIStore.getState().actions.hideLinkTypePicker()
  }

  showSemanticSuggestion(suggestion, onAccept) {
    useUIStore.getState().actions.showSemanticSuggestion({ suggestion, onAccept })
  }

  dismissSemanticSuggestion() {
    useUIStore.getState().actions.dismissSemanticSuggestion()
  }

  showDragSuggestionTooltip(suggestion) {
    useUIStore.getState().actions.showDragTooltip({ suggestion })
  }

  hideDragSuggestionTooltip() {
    useUIStore.getState().actions.hideDragTooltip()
  }

  showImportProgress(percent, status) {
    useUIStore.getState().actions.showImportProgress({ percent, status })
  }

  hideImportProgress() {
    useUIStore.getState().actions.hideImportProgress()
  }

  showImportModal(filename) {
    return new Promise(resolve => {
      useUIStore.getState().actions.showModal({ type: 'import', filename, resolve })
    })
  }

  // ── Projection axis (ADR-103) ─────────────────────────────────────────────

  // The former Map toolbar is gone: its camera lives on the gizmo, its
  // projection on the toggle below, and its five drawing tools in the Add menu.

  /**
   * Reflects the current projection into the chrome. The AUTHORITY is
   * `SceneView._projection`; this is the display copy, written on the one path
   * that also writes the authority (AppController.onProjectionChange).
   * @param {'perspective'|'orthographic'} kind
   */
  setProjection(kind) {
    useUIStore.getState().actions.setProjection(kind)
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  showOnboardingIfNeeded() {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    if (localStorage.getItem('ee_onboarded') === '1') return
    useUIStore.getState().actions.showOnboarding()
  }

  // ── Save / load ───────────────────────────────────────────────────────────

  enableSaveLoad(onSave, onLoad) {
    const { registerCallback, setBffConnected } = useUIStore.getState().actions
    registerCallback('onSaveScene', onSave)
    registerCallback('onLoadScene', onLoad)
    setBffConnected(true)
  }

  // ── Callback → store bridges ──────────────────────────────────────────────

  onModeChange(cb) {
    useUIStore.getState().actions.registerCallback('onModeChange', cb)
  }

  onOutlinerToggle(cb) {
    useUIStore.getState().actions.registerCallback('onOutlinerToggle', cb)
  }

  onNPanelToggle(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelToggle', cb)
  }

  onUndoClick(cb) {
    useUIStore.getState().actions.registerCallback('onUndoClick', cb)
  }

  onRedoClick(cb) {
    useUIStore.getState().actions.registerCallback('onRedoClick', cb)
  }

  onProjectionChange(cb) {
    useUIStore.getState().actions.registerCallback('onProjectionChange', cb)
  }

  onNodeEditorToggle(cb) {
    const wrapped = () => {
      cb()
      useUIStore.setState(s => ({ nodeEditorOpen: !s.nodeEditorOpen }))
    }
    useUIStore.getState().actions.registerCallback('onNodeEditorToggle', wrapped)
  }

  // onRobotToggle removed in ADR-087: the header show/hide toggle is gone; the
  // robot skeleton's visibility is now owned by the `robot_base` entity's
  // Outliner eye (routed through AppController._setObjectVisible).

  onExportJson(cb) {
    useUIStore.getState().actions.registerCallback('onExportJson', cb)
  }

  onImportJson(cb) {
    useUIStore.getState().actions.registerCallback('onImportJson', cb)
  }

  // ── N-Panel state bridges ─────────────────────────────────────────────────

  updateNPanel(centroid, dimensions, name = '', description = '', options = {}) {
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
    useUIStore.getState().actions.setNPanelData({
      type: 'frame',
      pos: { x: pos.x, y: pos.y, z: pos.z },
      eulerDeg: { x: eulerDeg.x, y: eulerDeg.y, z: eulerDeg.z },
      name, locked, parentOptions, currentParentId,
      unreferenced, childFrames, onAddChildFrame, onSelectChildFrame,
    })
  }

  updateNPanelForSpatialLink(link, srcName, tgtName, onDelete) {
    useUIStore.getState().actions.setNPanelData({
      type: 'link',
      link, srcName, tgtName, onDelete,
    })
  }

  // ── N-Panel callback bridges ──────────────────────────────────────────────

  onNameChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelNameChange', cb)
  }

  onDescriptionChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelDescriptionChange', cb)
  }

  onLocationChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelLocationChange', cb)
  }

  onFramePositionChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelFramePositionChange', cb)
  }

  onFrameRotationChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelFrameRotationChange', cb)
  }

  onFrameParentChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelFrameParentChange', cb)
  }

  onIfcClassChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelIfcClassChange', cb)
  }

  onPlaceTypeChange(cb) {
    useUIStore.getState().actions.registerCallback('onNPanelPlaceTypeChange', cb)
  }
}
