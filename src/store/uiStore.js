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
  robotVisible: true,
  // Robot base position (ADR-083). [x, y, z], world frame, Z up, ground = 0.
  // Sole writer: UIViewBridge.onRobotBaseChange's wrapped callback below.
  robotBase: [-2, 2, 0],
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
    showCancel:  false,   // ADR-073: 命名フォーム / Confirm は廃止（即時生成）
  },

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

  // ── Onboarding tour FSM (desktop, ADR-065 Phase 6) ─────────────────────────
  // Discriminated union, replaced wholesale; sole writer AppController via the
  // pure TourMath transitions (same discipline as context.grasp/wizard):
  //   null                            — not shown (mobile, or persisted done/dismissed)
  //   { status:'active', step }       — the open quest (step = TOUR_STEPS id)
  //   { status:'done' }               — trail finished (completion banner)
  // This is user-visible APP state (which quest is open), NOT presentation
  // history — the uiStore placement is the ADR-065 §2 carve-out from ADR-062.
  // The done/dismissed flag persists to localStorage as a display SETTING
  // (Widening 3); the progression itself persists nowhere.
  tour: null,

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

  // ── Context-first project (ADR-050) ────────────────────────────────────────
  // Persistent slice (parallel to `demo`, never auto-reset on a new payload).
  // Populated by ContextController; reads the canonical doc through ContextService.
  // The `demo` slice above stays untouched — tutorial story vs. production are
  // decoupled (ADR-050 §4.1/§4.3).
  context: {
    active: false,           // an overlay (negotiate / author / ghost) is shown
    mode: null,              // 'negotiate' | 'author' | 'ghost' | null (ADR-050 §4.3)
    loaded: false,           // a context document has been adopted
    docMeta: null,           // { name, version } of the loaded doc
    decisions: [],           // doc.decisions (for detail lookups)
    actors: [],              // doc.actors (for actorRef form widgets — Phase 4)
    conflicts: [],           // validatorResult.conflicts (R6 output)
    negotiationClusters: [], // validatorResult.negotiationClusters (R7 output)
    conflictMatrix: null,    // ContextService.projectMatrix() | null
    resolutionOrder: [],     // ContextService.projectOrder() — DSM meeting order
    personaFilter: null,     // actorRef | null
    inspectorTab: 'matrix',  // 'matrix' | 'cluster' | 'conflicts' | 'questions' | 'why' | 'tree' | 'intake' | 'grasp'
    form: [],                // projectForm() output — open intake questions (Phase 4)
    checks: [],              // ContextService.projectChecks() — acceptance verdicts + baked predicates (ADR-062 Phase 4)
    variables: [],           // doc.variables — for IntakePanel requirement constrains dropdown (Phase 1)
    requirements: [],        // doc.requirements — ref-uniqueness live check + Why-first trail (ADR-058 UX) + click-to-edit cards (ADR-058 Phase 2)
    provenance: null,        // ContextService.recoverProvenance(selectedSceneId) | null (ADR-052 Phase 2)
    whyTree: null,           // ContextService.whyTree() — full Why-rooted 5W1H tree overview (ADR-052 Phase 3)
    authorSeed: null,        // ADR-058 — read-only seed doc when a project was forked from an example (anchors for "fork & tweak"); null otherwise
    // ADR-057 grasp-search FSM — a discriminated union on `status` (replaced
    // wholesale by GraspController, never patched), so illegal states (candidates
    // while `error`, results while `solving`) are unrepresentable. null = the
    // grasp tab is not seeded (no renderable layout / never opened). Shapes:
    //   { status:'idle',      layout }
    //   { status:'no-layout' }
    //   { status:'compiling', layout }
    //   { status:'solving',   layout, request }
    //   { status:'results',   layout, request, candidates, compiledObjects, selectedRank }
    //   { status:'error',     stage:'compile'|'solve'|'bff', httpStatus, message, details }
    grasp: null,
    // ADR-063 Phase 3 wizard FSM — sole writer ContextController via the pure
    // WizardCatalog transition functions; the panel only reads + fires callbacks.
    // null = inactive (the wizard tab shows its start screen). Shapes:
    //   { defId, status:'step', index }
    //   { defId, status:'review' }
    // Step drafts stay component-local (transient, never a second source — §1.1).
    wizard: null,
    // ADR-063 Phase 4 parametric asset viewer — sole writer ContextController
    // (same discipline as grasp/wizard); the panel only reads + fires callbacks.
    // null = closed. Shape: { assetId, values: {key: number} } — values are the
    // CLAMPED live slider state (a display projection of the pure clampParams;
    // the doc is only touched by an explicit commit).
    assetViewer: null,
  },

  // ── Template gallery (ADR-051 Phase 2, Entry B) ────────────────────────────
  // Open/closed flag for the starter-template picker modal (TemplateGallery.jsx).
  // The catalog itself is static (TemplateCatalog.js); selecting an entry fires
  // `onSelectTemplate(id)` which ContextController loads through ContextService.
  templateGalleryOpen: false,
  // ADR-062 Phase 5 — per-example structure previews for the gallery cards,
  // keyed by `source.file`. Derived by ContextController from the bundled docs
  // via canonicalForm → structurePreview (a fact projection, computed once);
  // null until the gallery is first opened. Cards without an entry render no
  // preview (blank template, or a doc whose derivation failed — #11 degrade).
  templateGalleryPreviews: null,

  // ══ Actions ════════════════════════════════════════════════════════════════

  actions: {
    setToolbar: (buttons) => set({ toolbar: buttons }),

    setStatus: (text) => set({ statusParts: text ? [{ text }] : [] }),
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
    // ADR-065 Phase 6 — tour FSM state, replaced wholesale (sole writer
    // AppController; transitions computed by the pure TourMath functions).
    setTour: (tour) => set({ tour }),

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

    // ── Context-first project (ADR-050) ──────────────────────────────────────
    // Unlike demoStart, contextStart does NOT wipe the slice on every call —
    // the context overlay is persistent (a loaded project, not a transient
    // tutorial). It merges the payload and marks the overlay active.
    contextStart: (payload) => set(state => ({
      context: { ...state.context, provenance: null, grasp: null, authorSeed: null, wizard: null, assetViewer: null, ...payload, active: true },
    })),
    contextSetMatrix: (conflictMatrix, negotiationClusters, resolutionOrder) => set(state => ({
      context: { ...state.context, conflictMatrix, negotiationClusters, resolutionOrder },
    })),
    contextSetConflicts: (conflicts) => set(state => ({
      context: { ...state.context, conflicts },
    })),
    contextSetPersonaFilter: (personaFilter) => set(state => ({
      context: { ...state.context, personaFilter },
    })),
    contextSetTab: (inspectorTab) => set(state => ({
      context: { ...state.context, inspectorTab },
    })),
    contextSetForm: (form) => set(state => ({
      context: { ...state.context, form },
    })),
    // Acceptance-check verdicts + baked predicates (ADR-062 Phase 4). Pushed by
    // ContextController on negotiate enter + every re-projection; ChecksPanel
    // only reads (transition history stays component-local — ADR-062 §2).
    contextSetChecks: (checks) => set(state => ({
      context: { ...state.context, checks },
    })),
    contextSetActors: (actors) => set(state => ({
      context: { ...state.context, actors },
    })),
    contextSetVars: (variables) => set(state => ({
      context: { ...state.context, variables },
    })),
    // Full requirement objects — supplied by _startNegotiation / _reproject; used
    // for the ref-uniqueness check + Why-first trail and the click-to-edit cards.
    contextSetRequirements: (requirements) => set(state => ({
      context: { ...state.context, requirements },
    })),
    // φ⁻¹ provenance of the currently-selected scene entity (ADR-052 Phase 2).
    // Selection-transient: pushed by ContextController.showProvenance on select,
    // null on deselect.
    contextSetProvenance: (provenance) => set(state => ({
      context: { ...state.context, provenance },
    })),
    // Full Why-rooted 5W1H tree overview (ADR-052 Phase 3). Pushed by
    // ContextController on negotiate enter + re-projected on every doc mutation.
    contextSetWhyTree: (whyTree) => set(state => ({
      context: { ...state.context, whyTree },
    })),
    // ADR-057 — replace context.grasp wholesale with one discriminated-union
    // state. GraspController is the sole writer (PHILOSOPHY #5); the panel reads.
    // A full replace (not a merge) keeps the union clean — no leftover fields
    // from a prior status survive a transition.
    contextSetGrasp: (grasp) => set(state => ({
      context: { ...state.context, grasp },
    })),
    setTemplateGalleryOpen: (val) => set({ templateGalleryOpen: val }),
    setTemplateGalleryPreviews: (previews) => set({ templateGalleryPreviews: previews }),

    // ADR-058 — read-only seed doc retained when a project is forked from an
    // example, so the intake forms can show the example's filled values as
    // anchors ("fork & tweak"). Set by ContextController.forkExample after
    // _startNegotiation; reset by contextStart / contextEnd. It is NOT a second
    // source of truth — the working doc stays owned by ContextService (§1.1).
    contextSetSeed: (authorSeed) => set(state => ({
      context: { ...state.context, authorSeed },
    })),

    // ADR-063 Phase 3 — wizard FSM state, replaced wholesale (same discipline as
    // contextSetGrasp: sole writer ContextController, transitions computed by the
    // pure WizardCatalog functions, illegal states unrepresentable).
    contextSetWizard: (wizard) => set(state => ({
      context: { ...state.context, wizard },
    })),

    // ADR-063 Phase 4 — parametric asset viewer state, replaced wholesale (sole
    // writer ContextController; values are already clamped by the pure layer).
    contextSetAssetViewer: (assetViewer) => set(state => ({
      context: { ...state.context, assetViewer },
    })),

    contextEnd: () => set(state => ({
      context: { ...state.context, active: false, mode: null, personaFilter: null, form: [], checks: [], variables: [], requirements: [], provenance: null, whyTree: null, grasp: null, authorSeed: null, wizard: null, assetViewer: null },
    })),
  },
}))
