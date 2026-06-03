import { create } from 'zustand'

let _toastId = 0

/**
 * Central UI state store — bridges AppController (vanilla JS) and React components.
 *
 * AppController updates state via uiStore.getState().actions.*()
 * React components read state via useUIStore() hook.
 *
 * Why Zustand: works outside the React tree, so AppController needs no React dependency.
 */
export const useUIStore = create((set, get) => ({
  // ── Toolbar ────────────────────────────────────────────────────────────────
  toolbar: [],

  // ── Status line ────────────────────────────────────────────────────────────
  statusParts: [],

  // ── Cursor ─────────────────────────────────────────────────────────────────
  cursor: 'default',

  // ── Mode ───────────────────────────────────────────────────────────────────
  mode: 'object',
  editSubtype: null,

  // ── Toasts ─────────────────────────────────────────────────────────────────
  toasts: [],

  // ── N-Panel (properties sidebar) ───────────────────────────────────────────
  nPanelVisible: false,
  // Descriptor shapes:
  //   { type: 'generic', centroid, dimensions, name, description, locationEditable,
  //     showIfcClass, ifcClass, showPlaceType, placeType, placeTypeGeometry,
  //     spatialLinks, currentEntityId, onDeleteSpatialLink, getEntityName,
  //     frames, onAddFrame, onSelectFrame }
  //   { type: 'frame', pos, eulerDeg, name, locked, parentOptions, currentParentId,
  //     unreferenced, childFrames, onAddChildFrame, onSelectChildFrame }
  //   { type: 'link', link, srcName, tgtName, onDelete }
  nPanelData: null,
  // Backdrop overlay callback — set by showBackdrop(), cleared by hideBackdrop()
  backdropCallback: null,

  // ── Extrusion label ────────────────────────────────────────────────────────
  extrusionLabel: null,

  // ── Info bar extra hint (desktop only) ────────────────────────────────────
  extraHint: null,

  // ── Header ────────────────────────────────────────────────────────────────
  bffConnected: false,
  nodeEditorOpen: false,

  // ── Modal / overlay state ──────────────────────────────────────────────────
  // Shapes:
  //   { type: 'rename',  currentName, callback, title }
  //   { type: 'confirm', message, callback, title, confirmLabel, danger }
  modal: null,

  // ── Callbacks registered by AppController ─────────────────────────────────
  callbacks: {},

  // ══ Actions ════════════════════════════════════════════════════════════════

  actions: {
    setToolbar: (buttons) => set({ toolbar: buttons }),

    setStatus: (text) => set({ statusParts: [{ text }] }),
    setStatusRich: (parts) => set({ statusParts: parts }),

    setCursor: (style) => set({ cursor: style }),

    updateMode: (mode, editSubtype = null) => set({ mode, editSubtype }),

    pushToast: (msg, type = 'info') => {
      const id = ++_toastId
      set(state => ({ toasts: [...state.toasts, { id, msg, type }] }))
      setTimeout(() => {
        set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
      }, 3000)
    },
    dismissToast: (id) => set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),

    setNPanelVisible: (val) => set({ nPanelVisible: val }),
    toggleNPanel: () => set(state => ({ nPanelVisible: !state.nPanelVisible })),
    setNPanelData: (descriptor) => set({ nPanelData: descriptor }),
    setBackdrop: (cb) => set({ backdropCallback: cb }),

    setExtrusionLabel: (text, x, y) => set({ extrusionLabel: text != null ? { text, x, y } : null }),

    setExtraHint: (key, desc) => set({ extraHint: key ? { key, desc } : null }),

    setBffConnected: (val) => set({ bffConnected: val }),
    setNodeEditorOpen: (val) => set({ nodeEditorOpen: val }),

    showModal: (config) => set({ modal: config }),
    closeModal: () => set({ modal: null }),

    registerCallback: (name, fn) => set(state => ({
      callbacks: { ...state.callbacks, [name]: fn },
    })),
    unregisterCallback: (name) => set(state => {
      const { [name]: _, ...rest } = state.callbacks
      return { callbacks: rest }
    }),
  },
}))
