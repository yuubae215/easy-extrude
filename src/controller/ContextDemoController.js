// @ts-nocheck
/**
 * ContextDemoController — Context DSL (ADR-046) visual tutorial demo (ADR-047).
 *
 * Orchestrates the story-mode walkthrough of the factory-cell example:
 *   ① 顧客発話 → ② Fact化 → ③ OpenQuestions 自動検出 → ④ Decision 承認
 *   → ⑤ コンパイル/シーン出現 → ⑥ Acceptance チェック結果
 *
 * The demo is an *overlay* over a normally loaded scene — not a new FSM mode.
 * `enter()` compiles examples/factory_context.json through the real two-stage
 * chain (compileContext → compileLayout → importFromJson) and stages entity
 * visibility per story step; `exit()` restores all visibility, leaving a fully
 * editable scene behind. All side-effect orchestration lives here (PHILOSOPHY #3);
 * the compile layer stays pure.
 *
 * Owns: UncertaintyGhostView (sole owner — PHILOSOPHY #4/#9), step staging,
 * staggered reveal animation. UI state flows through uiStore's demo slice.
 *
 * NOTE (ADR-050 Phase 5): Production Negotiation, Authoring, and RegionGhost
 * have been fully migrated to ContextController. This controller is tutorial-only.
 */
import * as THREE from 'three'
import { useUIStore } from '../store/uiStore.js'
import { compileContext } from '../context/ContextCompiler.js'
import { compileLayout, buildRefMap, linkIdForConstraint } from '../layout/LayoutCompiler.js'
import { UncertaintyGhostView } from '../view/UncertaintyGhostView.js'
import { RippleEffect } from '../view/RippleEffect.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import factoryContext from '../../examples/factory_context.json'

/** Inspector tab shown for each story step (null = inspector closed). */
const TAB_BY_STEP = [null, 'facts', 'openQuestions', 'decisions', 'trace', 'acceptance']

/** Seconds between staggered entity reveals in step ⑤. */
const REVEAL_INTERVAL = 0.15

export const DEMO_STEPS = [
  {
    title: '① Customer utterance',
    narration: '"I want to automate one step of the cell. There\'s a workbench a little under 3m from the floor outlet, and I want to put a robot on it." — requirements always start out vague.',
  },
  {
    title: '② Capture as Facts',
    narration: 'The utterance is recorded as Facts. "A little under 3m" is kept as the interval [2700, 3000] mm — never rounded to a single value. Unconfirmed attributes stay as unknown.',
  },
  {
    title: '③ Detect OpenQuestions',
    narration: 'The validator mechanically lists the unknowns and unassigned responsibilities, so spotting omissions no longer relies on human attention.',
  },
  {
    title: '④ Approve a Decision',
    narration: 'Only a Decision can settle an interval to a single value. Approve the nominal value 2800mm to fix the workbench position.',
  },
  {
    title: '⑤ Compile → scene appears',
    narration: 'The scene is generated from the settled specification (layout/1.0). Every placement and constraint traces back to a requirement. The robot\'s fastened constraint is real — try dragging it.',
  },
  {
    title: '⑥ Acceptance checks',
    narration: 'Acceptance checks that depend on unknown / assumed facts are automatically "blocked", so the structure tells you what to confirm to move forward.',
  },
]

export class ContextDemoController {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    this._active     = false
    this._step       = 0
    this._approved   = false
    this._revealDone = false

    /** @type {import('../view/UncertaintyGhostView.js').UncertaintyGhostView|null} */
    this._ghost         = null
    this._ghostTargetId = null
    this._decisionProv  = null

    /** @type {Map<string,string>|null} layout DSL ref → scene entity id */
    this._refToId = null
    /** @type {Map<string,string[]>} trace.from → trace.to[] */
    this._traceByFrom = new Map()
    /** @type {Map<string,string>} "constraint:a→b" → SpatialLink id */
    this._constraintToLinkId = new Map()
    /** @type {string[]} all demo SpatialLink ids */
    this._linkIds = []
    /** @type {{queue: {id:string, pos:THREE.Vector3, radius:number}[], nextAt:number}|null} */
    this._reveal = null
    /** @type {object|null} compiled layout DSL (resolved values) */
    this._layoutDsl = null

    // React components fire these via uiStore.callbacks (same unidirectional
    // pattern as the rest of the UI).
    const { registerCallback } = useUIStore.getState().actions
    registerCallback('onContextDemoClick',   ()    => this.enter())
    registerCallback('onDemoStepChange',     (n)   => this.setStep(n))
    registerCallback('onDemoApproveDecision', ()   => this.approveDecision())
    registerCallback('onDemoItemSelect',     (ref) => this.selectItem(ref))
    registerCallback('onDemoExit',           ()    => this.exit())
  }

  /** True while the demo overlay is active. */
  get isActive() { return this._active }

  // ── Entry / exit ───────────────────────────────────────────────────────────

  /** Compiles the example context and starts the demo (replaces the scene). */
  enter() {
    if (this._active) return

    let compiled, scene
    try {
      compiled = compileContext(factoryContext)
      scene    = compileLayout(compiled.layoutDsl)
    } catch (err) {
      // Never a silent no-op (PHILOSOPHY #11)
      this._ctrl._uiView.showToast(`Context compile failed: ${err.message}`, { type: 'error' })
      console.error('[ContextDemoController]', err)
      return
    }

    this._ctrl._uiView.showConfirmDialog(
      'Replace the current scene and start the Context DSL demo?',
      (ok) => { if (ok) this._start(compiled, scene) },
      { title: 'Context DSL Demo', confirmLabel: 'Start' },
    )
  }

  async _start(compiled, scene) {
    const ctrl = this._ctrl
    const viewContext = {
      camera:    ctrl._camera,
      renderer:  ctrl._sceneView.renderer,
      container: document.body,
    }

    try {
      await ctrl._service.importFromJson(scene, viewContext, { clear: true })
    } catch (err) {
      ctrl._uiView.showToast(`Demo scene load failed: ${err.message}`, { type: 'error' })
      console.error('[ContextDemoController]', err)
      return
    }
    // The demo load is not a user edit — it must not appear in undo history
    // (same contract as the constructor's initial solid).
    ctrl._commandStack.clear()
    ctrl._refreshUndoRedoState()

    // Clear stale selection state from the replaced scene (header would keep
    // showing "<old object> selected" otherwise) — same pattern as empty-tap deselect.
    ctrl._selMgr.clearObjectSelection()
    ctrl._selMgr.setObjectSelected(false)

    const layoutDsl = compiled.layoutDsl
    this._layoutDsl = layoutDsl
    this._refToId   = buildRefMap(layoutDsl.entities)

    this._constraintToLinkId = new Map()
    ;(layoutDsl.constraints ?? []).forEach((c, i) => {
      this._constraintToLinkId.set(`constraint:${c.source}→${c.target}`, linkIdForConstraint(i, c))
    })
    this._linkIds = [...this._constraintToLinkId.values()]

    this._traceByFrom = new Map()
    for (const link of compiled.trace) {
      if (!this._traceByFrom.has(link.from)) this._traceByFrom.set(link.from, [])
      this._traceByFrom.get(link.from).push(link.to)
    }

    // Hide everything; story steps reveal progressively. CoordinateFrames are
    // skipped — they are hidden by default and owned by setParentSelected().
    for (const obj of ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) obj.meshView.setVisible(false)
    }
    for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, false)
    // The Link Network panel would spoil the staged step-⑤ reveal (it lists
    // every link from the start) and sits under the StoryBar — hide it for
    // the duration of the demo overlay.
    ctrl._linkNetworkView?.setForceHidden(true)

    // Uncertainty ghost from the decision-marker provenance entry (the demo
    // precondition test guarantees exactly one on a Solid position axis).
    const prov = compiled.provenance.find(p =>
      p.marker === 'decision' && p.path.startsWith('position.') && Array.isArray(p.interval)
    )
    if (prov) {
      const entity = layoutDsl.entities.find(e => e.ref === prov.entityRef)
      const axis   = prov.path.split('.')[1]
      this._decisionProv  = prov
      this._ghostTargetId = this._refToId.get(prov.entityRef)
      this._ghost = new UncertaintyGhostView(ctrl._sceneView.scene, document.body, {
        axis,
        interval:  prov.interval,
        nominal:   prov.nominal,
        dims:      entity.dimensions,
        position:  entity.position,
        labelText: `${prov.interval[0]}–${prov.interval[1]} ${prov.unit ?? ''} · unconfirmed`,
      })
    }

    // Frame the whole cell (mm-scale scene — never rely on the default camera).
    const { center, radius } = this._computeBounds(layoutDsl)
    ctrl._sceneView.fitCameraToSphere(center, radius)

    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.demoStart({
      steps:         DEMO_STEPS,
      facts:         factoryContext.given,
      intents:       factoryContext.intents,
      decisions:     factoryContext.decisions,
      obligations:   factoryContext.obligations,
      acceptance:    factoryContext.acceptance,
      openQuestions: compiled.openQuestions,
      blockedChecks: compiled.blockedChecks,
      trace:         compiled.trace,
    })

    this._active     = true
    this._approved   = false
    this._revealDone = false
    this._reveal     = null
    this.setStep(0)
  }

  /** Ends the demo. The compiled scene stays behind as a normal editable scene. */
  exit() {
    if (!this._active) return
    this._active = false
    this._reveal = null

    if (this._ghost) {
      this._ghost.dispose()
      this._ghost = null
    }

    const ctrl = this._ctrl
    for (const obj of ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) obj.meshView.setVisible(true)
    }
    for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, true)
    ctrl._linkNetworkView?.setForceHidden(false)

    useUIStore.getState().actions.demoEnd()
  }

  // ── Story steps ────────────────────────────────────────────────────────────

  /** Applies the declarative visibility state for step n (0–5). */
  setStep(n) {
    if (!this._active) return
    const step = Math.max(0, Math.min(DEMO_STEPS.length - 1, n))
    // Step ③→④ is gated on approval — "intervals never collapse silently",
    // expressed structurally. (The StoryBar also disables Next; double guard.)
    if (step >= 4 && !this._approved) {
      this._ctrl._uiView.showToast('Cannot proceed until the Decision is approved', { type: 'warn' })
      return
    }

    const stagger = step === 4 && this._step < 4 && !this._revealDone
    this._step = step
    useUIStore.getState().actions.demoSetStep(step, TAB_BY_STEP[step])
    this._applyVisibility(stagger)
  }

  _applyVisibility(stagger) {
    const ctrl = this._ctrl
    const show = (ref, visible) => {
      const obj = ctrl._scene.getObject(this._refToId.get(ref))
      obj?.meshView.setVisible(visible)
    }

    const s = this._step

    // Step ② — the site facts: outlet anchor, cell zone, and the interval ghost.
    show('floor_outlet', s >= 1)
    show('cell_area',    s >= 1)
    if (this._ghost) {
      this._ghost.setVisible(!this._approved && s >= 1)
      this._ghost.showNominal(s >= 3)
    }
    // The decided entity (workbench) exists only after approval.
    show('workbench', this._approved && s >= 1)

    // Step ⑤ — the compiled equipment + constraints.
    const equipment = ['base_plate', 'robot', 'container_a', 'container_b']
    if (s >= 4) {
      if (stagger) {
        // Staggered reveal driven by tick(); links appear after the last entity.
        this._reveal = {
          queue: equipment.map(ref => this._revealItemFor(ref)).filter(Boolean),
          nextAt: 0,
        }
      } else if (!this._reveal) {
        for (const ref of equipment) show(ref, true)
        for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, true)
      }
    } else {
      this._reveal = null
      for (const ref of equipment) show(ref, false)
      for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, false)
    }
  }

  _revealItemFor(ref) {
    const id     = this._refToId.get(ref)
    const entity = this._layoutDsl.entities.find(e => e.ref === ref)
    if (!id || !entity) return null
    const d = entity.dimensions ?? { x: 100, y: 100, z: 100 }
    return {
      id,
      pos:    new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z),
      radius: Math.max(d.x, d.y, d.z) * 0.5,
    }
  }

  // ── Decision approval (the centerpiece) ────────────────────────────────────

  approveDecision() {
    if (!this._active || this._approved || !this._ghost || this._ghost.collapsing) return

    const ctrl = this._ctrl
    this._ghost.startCollapse({
      onSnapped: () => {
        // Band has condensed onto the nominal box — reveal the real solid.
        this._approved = true
        const obj = ctrl._scene.getObject(this._ghostTargetId)
        obj?.meshView.setVisible(true)
        const prov = this._decisionProv
        const entity = this._layoutDsl.entities.find(e => e.ref === prov.entityRef)
        const pos = new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z)
        const d   = entity.dimensions
        ctrl._activeRipples.push(new RippleEffect(
          ctrl._sceneView.scene, pos, 0x3a7bd5, Math.max(d.x, d.y, d.z) * 0.5,
        ))
        useUIStore.getState().actions.demoApproveDecision(prov.ref)
      },
      // Residual fade finishes in tick(); disposal happens there (single place).
    })
  }

  // ── Requirement → 3D traceability ──────────────────────────────────────────

  /**
   * Highlights the spec element(s) derived from a requirement ref.
   * Accepts requirement refs (f_*, d_*, o_*, g_*) and OpenQuestion refs
   * (resolved through their `about` field).
   */
  selectItem(ref) {
    if (!this._active) return
    const ctrl = this._ctrl
    const ui   = useUIStore.getState()
    ui.actions.demoSelectItem(ref)

    // OpenQuestion → the requirement it is about ("f_outlet.attrs.ratedCurrent" → "f_outlet")
    let reqRef = ref
    if (ref.startsWith('oq_')) {
      const oq = ui.demo.openQuestions.find(q => q.ref === ref)
      reqRef = oq?.about?.split('.')[0] ?? ref
    }

    const targets = this._traceByFrom.get(reqRef) ?? []
    if (targets.length === 0) {
      ctrl._uiView.showToast(`No specification elements are derived from ${reqRef}`)
      return
    }

    // Prefer an entity target; fall back to constraint targets.
    const entityTarget = targets.find(t => !t.startsWith('constraint:'))
    if (entityTarget) {
      const id  = this._refToId.get(entityTarget)
      const obj = ctrl._scene.getObject(id)
      if (!obj) return
      const meshVisible = obj.meshView.cuboid?.visible ?? true
      if (!meshVisible) {
        ctrl._uiView.showToast(`→ ${obj.name} (appears in a later step)`)
        return
      }
      ctrl._switchActiveObject(id, true)
      return
    }

    // Constraint-only targets (e.g. o_power → 給電の connects リンク).
    const linkId = this._constraintToLinkId.get(targets[0])
    const link   = linkId ? ctrl._scene.getLink(linkId) : null
    if (!link) {
      ctrl._uiView.showToast(`${reqRef} → ${targets[0]}`)
      return
    }
    if (this._step >= 4) {
      this._flashLink(linkId)
    }
    const srcName = ctrl._scene.getObject(link.sourceId)?.name ?? link.sourceId
    const tgtName = ctrl._scene.getObject(link.targetId)?.name ?? link.targetId
    ctrl._uiView.showToast(`→ Link: ${srcName} → ${tgtName} (${link.semanticType})`)
  }

  _flashLink(linkId) {
    const svc = this._ctrl._service
    let count = 0
    const iv = setInterval(() => {
      svc.setLinkViewVisible(linkId, count % 2 === 1)
      count++
      if (count >= 6) {
        clearInterval(iv)
        svc.setLinkViewVisible(linkId, this._active && this._step >= 4)
      }
    }, 150)
  }

  // ── Per-frame animation (driven by AppController's loop) ──────────────────

  tick(t) {
    if (!this._active) return

    if (this._ghost) {
      const done = this._ghost.tick(t, this._ctrl._sceneView.activeCamera, this._ctrl._sceneView.renderer)
      if (done) {
        this._ghost.dispose()
        this._ghost = null
      }
    }

    if (this._reveal) {
      if (t >= this._reveal.nextAt) {
        const item = this._reveal.queue.shift()
        if (item) {
          const obj = this._ctrl._scene.getObject(item.id)
          obj?.meshView.setVisible(true)
          this._ctrl._activeRipples.push(new RippleEffect(
            this._ctrl._sceneView.scene, item.pos, 0x10b981, item.radius,
          ))
          this._reveal.nextAt = t + REVEAL_INTERVAL
        }
        if (this._reveal.queue.length === 0) {
          for (const id of this._linkIds) this._ctrl._service.setLinkViewVisible(id, true)
          this._reveal     = null
          this._revealDone = true
        }
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Bounding sphere of the compiled layout (pure data — no scene reads). */
  _computeBounds(layoutDsl) {
    const box = new THREE.Box3()
    for (const e of layoutDsl.entities) {
      if (e.position && e.dimensions) {
        const { x, y, z } = e.position
        const d = e.dimensions
        box.expandByPoint(new THREE.Vector3(x - d.x / 2, y - d.y / 2, z - d.z / 2))
        box.expandByPoint(new THREE.Vector3(x + d.x / 2, y + d.y / 2, z + d.z / 2))
      } else if (e.position) {
        box.expandByPoint(new THREE.Vector3(e.position.x, e.position.y, e.position.z))
      }
      if (Array.isArray(e.vertices)) {
        for (const v of e.vertices) box.expandByPoint(new THREE.Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0))
      }
    }
    if (box.isEmpty()) return { center: new THREE.Vector3(), radius: 10 }
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1)
    return { center, radius }
  }
}
