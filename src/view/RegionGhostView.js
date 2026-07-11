// @ts-nocheck
/**
 * RegionGhostView — read-only actor-coloured admissible-region ghost overlay for
 * ONE shared design Variable (ADR-049 §5.3, the deferred "actor ごとに色分けした
 * 許容領域ゴーストを重畳 — 共通部分が空 = 衝突が目で見える").
 *
 * Where RegionAuthoringWidget (§5.2) is the *input* projection — editable, binary
 * green↔red conflict feedback — this is the *output* projection (ADR-047 ghost
 * lineage): each actor's admissible footprint is drawn in that actor's persona
 * colour, all overlaid, so the empty common intersection (the no-man's-land gap
 * the validator reports) is directly visible in 3-D. When the intersection is
 * non-empty it is filled as the "合意領域 (共通部分)"; when empty the gap band on
 * the binding axis is drawn in red and labelled "共通部分なし = 衝突".
 *
 * Pure presentation: all geometry comes from `PersonaProjection.projectRegionGhosts`
 * (PHILOSOPHY #3). Sole owner = ContextDemoController (PHILOSOPHY #4/#9): the
 * controller constructs it, calls tick()/setPersonaFilter() and dispose() on exit.
 *
 * Coordinates: boxes live in world XY on the ground plane; flat parts are lifted
 * off Z=0 so they don't straddle the plane / z-fight the grid (CODE_CONTRACTS §4
 * "Ground Markers Must Not Straddle Z=0"). Persona fills sit at staggered Z lifts
 * so overlapping footprints (the resolved case) still read as two translucent
 * layers rather than one merged colour.
 *
 * @module view/RegionGhostView
 */
import * as THREE from 'three'
import { gapBandRects, GAP_COLOR, RESOLVE_COLOR } from './RegionGhostMath.js'

/** Persona palette — distinct hues mapped by actor index (ctx.actors order). */
export const PERSONA_PALETTE = [0x3a7bd5, 0xe0b030, 0x10b981, 0xc05cd0, 0xe06650]
/** Bright agreement-zone colour (intersection non-empty). */
const AGREE_COLOR    = 0xffffff
const Z_FILL_BASE    = 2   // mm lift for the first persona fill
const Z_FILL_STEP    = 0.4 // mm stagger per persona so layers don't z-fight
const Z_OVERLAY      = 4   // mm lift for the agreement / gap overlay (above fills)
const DIM_OPACITY    = 0.04

/** Deterministic persona colour for an actor index. */
export function personaColor(index) {
  return PERSONA_PALETTE[((index % PERSONA_PALETTE.length) + PERSONA_PALETTE.length) % PERSONA_PALETTE.length]
}

export class RegionGhostView {
  /**
   * @param {THREE.Scene} scene
   * @param {HTMLElement} container
   * @param {object} ghost — one entry from projectRegionGhosts(), augmented by the
   *   controller with a `color` hex per region (and an `actorIndex`).
   * @param {{requirement:string, actor:string, color:number, region:{x:[number,number],y:[number,number]}}[]} ghost.regions
   * @param {{empty:boolean, box:object, gap:object, emptyAxes:string[]}} ghost.intersection
   * @param {string} ghost.state — 'conflict'|'proposed'|'resolved'|'satisfied'
   * @param {object|number|null} ghost.nominal
   */
  constructor(scene, container, ghost) {
    this._scene     = scene
    this._container = container
    this._ghost     = ghost
    this._visible   = true
    this._filter    = null
    this._disposables = [] // { geometry?, material? } pairs to dispose
    this._labels      = [] // { el, anchor } HTML labels

    this._group = new THREE.Group()
    scene.add(this._group)

    // ── Per-actor persona footprint ghosts ──────────────────────────────────
    this._regionMeshes = [] // { actor, fill, fillMat, edge, edgeMat, label }
    ghost.regions.forEach((r, i) => {
      const z = Z_FILL_BASE + i * Z_FILL_STEP
      const [x0, x1] = r.region.x
      const [y0, y1] = r.region.y
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2

      const fillMat = new THREE.MeshBasicMaterial({
        color: r.color, transparent: true, opacity: 0.16,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      })
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fillMat)
      fill.position.set(cx, cy, z)
      fill.scale.set(Math.max(x1 - x0, 1e-3), Math.max(y1 - y0, 1e-3), 1)
      fill.renderOrder = 1
      this._group.add(fill)

      const edgeMat = new THREE.LineBasicMaterial({ color: r.color, transparent: true, opacity: 0.95 })
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y0, z),
        new THREE.Vector3(x1, y1, z), new THREE.Vector3(x0, y1, z),
      ]), edgeMat)
      edge.renderOrder = 2
      this._group.add(edge)

      const label = this._makeLabel(
        `${r.actor ?? r.requirement}  [${Math.round(x0)},${Math.round(x1)}]×[${Math.round(y0)},${Math.round(y1)}]`,
        `#${r.color.toString(16).padStart(6, '0')}`,
      )
      const labelEntry = { el: label, anchor: new THREE.Vector3(cx, y1, z) }
      this._labels.push(labelEntry)

      this._disposables.push({ geometry: fill.geometry, material: fillMat })
      this._disposables.push({ geometry: edge.geometry, material: edgeMat })
      this._regionMeshes.push({ actor: r.actor, fillMat, edgeMat, baseOpacity: 0.16, label, labelEntry })
    })

    // ── Intersection overlay: agreement zone (filled) or gap band (red) ──────
    this._buildIntersection(ghost)

    this._rebuild()
  }

  _buildIntersection(ghost) {
    const { intersection: x } = ghost
    if (!x.empty) {
      // Agreement zone — the common footprint all actors accept. Brighter fill.
      const [x0, x1] = x.box.x
      const [y0, y1] = x.box.y
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      const mat = new THREE.MeshBasicMaterial({
        color: AGREE_COLOR, transparent: true, opacity: 0.32,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
      mesh.position.set(cx, cy, Z_OVERLAY)
      mesh.scale.set(Math.max(x1 - x0, 1e-3), Math.max(y1 - y0, 1e-3), 1)
      mesh.renderOrder = 5
      this._group.add(mesh)
      this._disposables.push({ geometry: mesh.geometry, material: mat })
      const nom = this._fmtNominal(ghost.nominal)
      const lbl = this._makeLabel(`Agreed region (intersection)${nom ? ` · nominal ${nom}` : ''}`, '#ffffff')
      this._labels.push({ el: lbl, anchor: new THREE.Vector3(cx, cy, Z_OVERLAY) })
      return
    }

    // Empty intersection — draw the gap band on each empty axis so "共通部分が
    // 空 = 衝突" is visible. Band geometry comes from the pure gapBandRects
    // (shared with RegionResolveEffect — one derivation, 核 §1.1). When a
    // Decision settled the conflict (state 'resolved') the emptiness fact
    // remains but the cell is no longer live — the band renders in the settled
    // green with an honest label instead of the red conflict claim (ADR-065
    // Phase 5; a "= conflict" label over a resolved cell would be a stale
    // judgment — PHILOSOPHY #11).
    const settled = ghost.state === 'resolved'
    const bandColor = settled ? RESOLVE_COLOR : GAP_COLOR
    const bandCss = `#${bandColor.toString(16).padStart(6, '0')}`
    for (const rect of gapBandRects(ghost)) {
      const { axis, x: bx, y: by, gap } = rect
      const [lo, hi] = gap
      const cx = (bx[0] + bx[1]) / 2, cy = (by[0] + by[1]) / 2
      const mat = new THREE.MeshBasicMaterial({
        color: bandColor, transparent: true, opacity: settled ? 0.18 : 0.3,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
      mesh.position.set(cx, cy, Z_OVERLAY)
      mesh.scale.set(Math.max(bx[1] - bx[0], 1e-3), Math.max(by[1] - by[0], 1e-3), 1)
      mesh.renderOrder = 5
      this._group.add(mesh)
      this._disposables.push({ geometry: mesh.geometry, material: mat })
      const lbl = settled
        ? this._makeLabel(
            `✓ Gap settled by ${ghost.resolvedBy ?? 'decision'} · ${axis} gap [${Math.round(lo)}, ${Math.round(hi)})`, bandCss)
        : this._makeLabel(
            `✕ No intersection = conflict · ${axis} gap [${Math.round(lo)}, ${Math.round(hi)})`, '#ff8080')
      this._labels.push({ el: lbl, anchor: new THREE.Vector3(cx, cy, Z_OVERLAY) })
    }
  }

  _fmtNominal(n) {
    if (n == null) return ''
    if (typeof n === 'object') return Object.entries(n).map(([k, v]) => `${k}=${v}`).join(',')
    return String(n)
  }

  _makeLabel(text, color) {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed', pointerEvents: 'none', userSelect: 'none',
      background: 'rgba(24,24,24,0.85)', color, fontSize: '11px',
      fontFamily: 'monospace', padding: '2px 7px', borderRadius: '3px',
      border: `1px solid ${color}`, whiteSpace: 'nowrap', display: 'none', zIndex: '50',
    })
    el.textContent = text
    this._container.appendChild(el)
    return el
  }

  // ── Persona filter (linked to the conflict-matrix actor-column click) ────────

  /** Dim every region whose actor is not the selected one (null = show all). */
  setPersonaFilter(actorRef) {
    if (actorRef === this._filter) return
    this._filter = actorRef
    this._rebuild()
  }

  setVisible(visible) {
    this._visible = visible
    this._group.visible = visible
    if (!visible) for (const l of this._labels) l.el.style.display = 'none'
  }

  tick(t, camera, renderer) {
    if (!this._visible) return
    this._updateLabels(camera, renderer)
  }

  _rebuild() {
    for (const m of this._regionMeshes) {
      const dim = this._filter && m.actor !== this._filter
      m.fillMat.opacity = dim ? DIM_OPACITY : m.baseOpacity
      m.edgeMat.opacity = dim ? 0.12 : 0.95
      m.label.style.opacity = dim ? '0.25' : '1'
    }
  }

  _updateLabels(camera, renderer) {
    if (!camera || !renderer) return
    const rect = renderer.domElement.getBoundingClientRect()
    for (const { el, anchor } of this._labels) {
      const ndc = anchor.clone().project(camera)
      if (ndc.z > 1) { el.style.display = 'none'; continue }
      const sx = (ndc.x + 1) / 2 * rect.width + rect.left
      const sy = (-ndc.y + 1) / 2 * rect.height + rect.top
      el.style.display = 'block'
      el.style.left = `${Math.round(sx)}px`
      el.style.top  = `${Math.round(sy - 14)}px`
    }
  }

  dispose() {
    this._scene.remove(this._group)
    for (const d of this._disposables) {
      d.geometry?.dispose()
      d.material?.dispose()
    }
    for (const l of this._labels) l.el.remove()
    this._regionMeshes = []
    this._labels = []
    this._disposables = []
  }
}
