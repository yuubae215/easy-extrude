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
  // Array of button descriptors matching the existing setMobileToolbar() shape:
  // { icon, label, onClick, disabled?, active?, indicator? } | { spacer: true }
  toolbar: [],

  // ── Status line ────────────────────────────────────────────────────────────
  // Array of { text, style? } parts matching setStatusRich() shape
  statusParts: [],

  // ── Cursor ─────────────────────────────────────────────────────────────────
  cursor: 'default',

  // ── Mode ───────────────────────────────────────────────────────────────────
  mode: 'object',      // 'object' | 'edit' | 'sketch' | 'map' | 'node'
  editSubtype: null,   // '3d' | '2d-sketch' | '2d-extrude' | '1d' | null

  // ── Toasts ─────────────────────────────────────────────────────────────────
  // [{ id, msg, type }]  type: 'info' | 'warn' | 'error'
  toasts: [],

  // ── N-Panel (properties sidebar) ───────────────────────────────────────────
  // Raw descriptor object passed from AppController — shape defined by updateNPanel()
  nPanel: null,

  // ── Extrusion label ────────────────────────────────────────────────────────
  extrusionLabel: null, // { text, x, y } | null

  // ── Modal / overlay state ──────────────────────────────────────────────────
  // Reserved for future React-driven modal system (Phase 2)
  modal: null,

  // ── Callbacks registered by AppController ─────────────────────────────────
  // Components call these to notify the controller of user interactions.
  // AppController registers them via actions.registerCallback().
  callbacks: {},

  // ══ Actions ════════════════════════════════════════════════════════════════

  actions: {
    // Toolbar
    setToolbar: (buttons) => set({ toolbar: buttons }),

    // Status
    setStatus: (text) => set({ statusParts: [{ text }] }),
    setStatusRich: (parts) => set({ statusParts: parts }),

    // Cursor — applied to document.body by the React root
    setCursor: (style) => set({ cursor: style }),

    // Mode
    updateMode: (mode, editSubtype = null) => set({ mode, editSubtype }),

    // Toasts
    pushToast: (msg, type = 'info') => {
      const id = ++_toastId
      set(state => ({ toasts: [...state.toasts, { id, msg, type }] }))
      // Auto-dismiss after 3 s
      setTimeout(() => {
        set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
      }, 3000)
    },
    dismissToast: (id) => set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),

    // N-Panel
    setNPanel: (descriptor) => set({ nPanel: descriptor }),

    // Extrusion label
    setExtrusionLabel: (text, x, y) => set({ extrusionLabel: text != null ? { text, x, y } : null }),

    // Callbacks
    registerCallback: (name, fn) => set(state => ({
      callbacks: { ...state.callbacks, [name]: fn },
    })),
    unregisterCallback: (name) => set(state => {
      const { [name]: _, ...rest } = state.callbacks
      return { callbacks: rest }
    }),
  },
}))
