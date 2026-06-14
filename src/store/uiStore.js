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
  undoEnabled: false,
  redoEnabled: false,

  // ── Modal / overlay state ──────────────────────────────────────────────────
  // Shapes:
  //   { type: 'rename',  currentName, callback, title }
  //   { type: 'confirm', message, callback, title, confirmLabel, danger }
  modal: null,

  // ── Callbacks registered by AppController ─────────────────────────────────
  callbacks: {},

  // ── Map Toolbar ─────────────────────────────────────────────────────────────
  mapToolbar: {
    visible:     false,
    activeTool:  null,    // 'route'|'boundary'|'zone'|'hub'|'anchor'|null
    pendingName: null,    // null = 入力非表示; string = 入力表示
    showConfirm: false,
    showCancel:  false,
  },
  mapPendingNameInput: '',  // React コンポーネントが onChange で更新

  // ── Context Menu ──────────────────────────────────────────────────────────
  // { x, y, items: [{label, onClick, danger?}] } | null
  contextMenu: null,

  // ── Add Menu (Shift+A) ────────────────────────────────────────────────────
  // { x, y, cbs: { onBox, onSketch, onMeasure, onImportStep, onFrame } } | null
  addMenu: null,

  // ── Link Type Picker (L-key) ───────────────────────────────────────────────
  // { x, y, options: [{jointType, semanticType, label}], onSelect } | null
  linkTypePicker: null,

  // ── Semantic Suggestion (post-drag ADR-041) ────────────────────────────────
  // { suggestion: {sourceId,targetId,semanticType,label,sourceName,targetName}, onAccept } | null
  semanticSuggestion: null,

  // ── Drag Suggestion Tooltip (during drag, non-interactive) ────────────────
  // { suggestion: {semanticType, label, sourceName, targetName} } | null
  dragTooltip: null,

  // ── Import Progress ────────────────────────────────────────────────────────
  // { percent: 0–100, status: string } | null
  importProgress: null,

  // ── Outliner ───────────────────────────────────────────────────────────────
  // Flat array in insertion order; React renders via DFS pre-order traversal.
  // Item shape: { id, name, type, parentId, visible, locked,
  //               ifcClass, placeType, linked:{asSource,asTarget}, unreferenced }
  outlinerItems: [],
  outlinerActiveId: null,
  outlinerDrawerOpen: false,

  // ── Onboarding (mobile first-visit gesture hint) ───────────────────────────
  onboardingVisible: false,

  // ── Context DSL demo (ADR-046/047) ─────────────────────────────────────────
  // Populated by ContextDemoController at demoStart; null-equivalent when inactive.
  demo: {
    active: false,
    step: 0,
    steps: [],              // [{ title, narration }]
    facts: [],              // Context DSL given[]
    intents: [],
    decisions: [],
    obligations: [],
    acceptance: [],
    openQuestions: [],      // [{ ref, raisedBy, about, summary }]
    blockedChecks: [],      // [{ check, blockedBy[] }]
    trace: [],              // [{ from, to, kind }]
    conflicts: [],          // [{ ref, variable, between[], gap, ... }] — live R6 output
    approvedDecisions: {},  // ref → true
    inspectorTab: null,     // 'facts'|'openQuestions'|'decisions'|'trace'|'acceptance'|'conflicts'|'matrix'|'cluster'|null
    selectedItemRef: null,
    // ── ADR-049 Phase 4: persona projections (read-only) ─────────────────────
    negotiationClusters: [], // [{ ref, requirements[], variables[], actors[], resolvedBy? }] — R7 output
    conflictMatrix: null,    // projectConflictMatrix() result | null
    resolutionOrder: [],     // projectResolutionOrder() result — DSM meeting order
    personaFilter: null,     // actorRef | null — persona projection highlight
  },

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
    setUndoRedoEnabled: (canUndo, canRedo) => set({ undoEnabled: canUndo, redoEnabled: canRedo }),

    showModal: (config) => set({ modal: config }),
    closeModal: () => set({ modal: null }),

    registerCallback: (name, fn) => set(state => ({
      callbacks: { ...state.callbacks, [name]: fn },
    })),
    unregisterCallback: (name) => set(state => {
      const { [name]: _, ...rest } = state.callbacks
      return { callbacks: rest }
    }),

    setMapToolbar: (config) => set(state => ({
      mapToolbar: { ...state.mapToolbar, ...config },
    })),
    setMapPendingNameInput: (value) => set({ mapPendingNameInput: value }),

    showContextMenu:   (cfg) => set({ contextMenu: cfg }),
    hideContextMenu:   ()    => set({ contextMenu: null }),

    showAddMenu:       (cfg) => set({ addMenu: cfg }),
    hideAddMenu:       ()    => set({ addMenu: null }),

    showLinkTypePicker:  (cfg) => set({ linkTypePicker: cfg }),
    hideLinkTypePicker:  ()    => set({ linkTypePicker: null }),

    showSemanticSuggestion:   (cfg) => set({ semanticSuggestion: cfg }),
    dismissSemanticSuggestion: ()   => set({ semanticSuggestion: null }),

    showDragTooltip:   (cfg) => set({ dragTooltip: cfg }),
    hideDragTooltip:   ()    => set({ dragTooltip: null }),

    showImportProgress: (cfg) => set({ importProgress: cfg }),
    hideImportProgress: ()    => set({ importProgress: null }),
    // ImportModal uses existing showModal({ type:'import', filename, resolve }) / closeModal()

    // ── Outliner ──────────────────────────────────────────────────────────────
    outlinerAddItem: (id, name, type, parentId) => set(state => ({
      outlinerItems: [...state.outlinerItems, {
        id, name, type, parentId: parentId ?? null,
        visible: true, locked: false,
        ifcClass: null, placeType: null,
        linked: { asSource: false, asTarget: false },
        unreferenced: false,
      }],
    })),

    outlinerRemoveItem: (id) => set(state => {
      const toRemove = new Set()
      const collect = (pid) => {
        toRemove.add(pid)
        state.outlinerItems.filter(i => i.parentId === pid).forEach(i => collect(i.id))
      }
      collect(id)
      return {
        outlinerItems: state.outlinerItems.filter(i => !toRemove.has(i.id)),
        outlinerActiveId: toRemove.has(state.outlinerActiveId) ? null : state.outlinerActiveId,
      }
    }),

    outlinerSetActive:    (id)         => set({ outlinerActiveId: id }),
    outlinerClearActive:  ()           => set({ outlinerActiveId: null }),
    outlinerUpdateItem:   (id, patch)  => set(state => ({
      outlinerItems: state.outlinerItems.map(i => i.id === id ? { ...i, ...patch } : i),
    })),
    outlinerReparentItem: (id, newParentId) => set(state => ({
      outlinerItems: state.outlinerItems.map(i => i.id === id ? { ...i, parentId: newParentId ?? null } : i),
    })),
    outlinerSetDrawerOpen: (open) => set({ outlinerDrawerOpen: open }),

    // ── Onboarding ───────────────────────────────────────────────────────────
    showOnboarding: () => set({ onboardingVisible: true }),
    hideOnboarding: () => set({ onboardingVisible: false }),

    // ── Context DSL demo ─────────────────────────────────────────────────────
    demoStart: (payload) => set(state => ({
      demo: {
        ...state.demo,
        // Reset Phase 4 projections unless the payload overrides them.
        negotiationClusters: [],
        conflictMatrix: null,
        resolutionOrder: [],
        personaFilter: null,
        ...payload,
        active: true,
        step: 0,
        approvedDecisions: {},
        inspectorTab: null,
        selectedItemRef: null,
      },
    })),
    demoSetStep: (step, inspectorTab) => set(state => ({
      demo: { ...state.demo, step, inspectorTab },
    })),
    demoSetTab: (inspectorTab) => set(state => ({
      demo: { ...state.demo, inspectorTab },
    })),
    demoApproveDecision: (ref) => set(state => ({
      demo: {
        ...state.demo,
        approvedDecisions: { ...state.demo.approvedDecisions, [ref]: true },
      },
    })),
    demoSelectItem: (ref) => set(state => ({
      demo: { ...state.demo, selectedItemRef: ref },
    })),
    demoSetConflicts: (conflicts) => set(state => ({
      demo: { ...state.demo, conflicts },
    })),
    // ADR-049 Phase 4 — push persona projections; clear by passing (null, [], []).
    demoSetMatrix: (conflictMatrix, negotiationClusters, resolutionOrder) => set(state => ({
      demo: { ...state.demo, conflictMatrix, negotiationClusters, resolutionOrder },
    })),
    demoSetPersonaFilter: (personaFilter) => set(state => ({
      demo: { ...state.demo, personaFilter },
    })),
    demoEnd: () => set(state => ({
      demo: { ...state.demo, active: false },
    })),
  },
}))
