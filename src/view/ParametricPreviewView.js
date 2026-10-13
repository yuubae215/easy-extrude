// @ts-nocheck
/**
 * ParametricPreviewView — live ghost preview of an instantiated parametric
 * asset (ADR-063 Phase 4).
 *
 * Renders the Solid entities of an instantiated Layout DSL fragment
 * (`instantiateAsset` output) as translucent ghost boxes + edges — the
 * ADR-047/051 ghost lineage. The view is an *output projection of the input
 * device*: it shows what the slider values mean spatially, and is never the
 * committed artifact (the commit records numbers/text into the doc — ADR-063
 * Goal 2). Deliberately NOT routed through `importFromJson`: the canonical
 * scene and the undo stack stay untouched by a live slider drag (optimistic
 * preview / pessimistic commit — ADR-050 Phase 3 discipline).
 *
 * Sole owner = ContextController (PHILOSOPHY #4/#9): created on viewer open,
 * `update()`d per parameter change (geometry rebuilt — entity count can change
 * with parameters), `tick()`ed per frame (the idle breath, seconds clock),
 * disposed on viewer close / overlay exit.
 *
 * The breath is the governed idle loop (`IdleMotionMath`, ADR-166 M4d1): the
 * `draft` period, each fill's phase from its entity `ref` — the N boxes of one
 * asset no longer pulse in lockstep — and the middle opacity under reduced
 * motion (the boundary is read once here and followed for changes; #9: the
 * subscription is released in `dispose()`).
 *
 * @module view/ParametricPreviewView
 */
import * as THREE from 'three'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { COLOR, hexNumber } from '../theme/tokens.js'
import { IDLE_PERIOD, idleLevel } from './IdleMotionMath.js'

const GHOST_COLOR   = hexNumber(COLOR.infoTone) // was the same blue by hand (ADR-166 M4d3)
const FILL_OPACITY  = 0.18
const EDGE_OPACITY  = 0.9
const BREATH_AMPL   = 0.05   // the fill breathes FILL_OPACITY ± BREATH_AMPL

export class ParametricPreviewView {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene
    this._group = new THREE.Group()
    scene.add(this._group)
    /** @type {{fillMat: THREE.Material, key: string}[]} breath targets (key = entity ref → phase) */
    this._fills = []
    this._disposables = []
    this._reduced = prefersReducedMotion()
    this._unsubReduced = onReducedMotionChange(r => { this._reduced = r })
  }

  /**
   * Rebuild the ghost boxes from the fragment's Solid entities. Entities
   * without dimensions+position (none in the current catalog) are skipped.
   * @param {object[]} entities — instantiateAsset(...).entities
   */
  update(entities) {
    this._clear()
    for (const e of entities ?? []) {
      if (e.type !== 'Solid' || !e.dimensions || !e.position) continue
      const geo = new THREE.BoxGeometry(e.dimensions.x, e.dimensions.y, e.dimensions.z)

      const fillMat = new THREE.MeshBasicMaterial({
        color: GHOST_COLOR, transparent: true, opacity: FILL_OPACITY,
        depthTest: true, depthWrite: false,
      })
      const fill = new THREE.Mesh(geo, fillMat)
      fill.position.set(e.position.x, e.position.y, e.position.z)
      this._group.add(fill)

      const edgeGeo = new THREE.EdgesGeometry(geo)
      const edgeMat = new THREE.LineBasicMaterial({
        color: GHOST_COLOR, transparent: true, opacity: EDGE_OPACITY,
      })
      const edge = new THREE.LineSegments(edgeGeo, edgeMat)
      edge.position.copy(fill.position)
      this._group.add(edge)

      this._fills.push({ fillMat, key: e.ref })
      this._disposables.push({ geometry: geo, material: fillMat })
      this._disposables.push({ geometry: edgeGeo, material: edgeMat })
    }
  }

  /**
   * World-space bounding sphere of the current ghost (for a one-time camera
   * fit). Null when empty.
   * @returns {{center: THREE.Vector3, radius: number}|null}
   */
  boundingSphere() {
    const box = new THREE.Box3().setFromObject(this._group)
    if (box.isEmpty()) return null
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1)
    return { center, radius }
  }

  /**
   * Per-frame idle breath — signals "this is a live, uncommitted preview".
   * @param {number} t — seconds (AppController loop clock)
   */
  tick(t) {
    for (const f of this._fills) {
      f.fillMat.opacity = idleLevel(t, f.key, IDLE_PERIOD.draft,
        FILL_OPACITY - BREATH_AMPL, FILL_OPACITY + BREATH_AMPL, this._reduced)
    }
  }

  /** Remove children + dispose GPU resources (symmetric with update — #9). */
  _clear() {
    for (const child of [...this._group.children]) this._group.remove(child)
    for (const d of this._disposables) {
      d.geometry?.dispose()
      d.material?.dispose()
    }
    this._disposables = []
    this._fills = []
  }

  dispose() {
    this._unsubReduced?.()
    this._unsubReduced = null
    this._clear()
    this._scene.remove(this._group)
  }
}
