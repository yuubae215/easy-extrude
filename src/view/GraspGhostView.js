// @ts-nocheck
/**
 * GraspGhostView — stage-1 grasp candidate spatial ghost (ADR-059).
 *
 * Translates the *typed* wire facts of a grasp candidate (`pose.kind:'endEffector'`
 * cartesian frame + `score` breakdown) into a felt spatial answer: a stylised
 * two-finger gripper glyph at the TCP frame, a tapered approach arrow derived from
 * the −Z frame convention, and an edges outline on the nearest grasped target.
 * Everything visual (colour, line style, fade, approach animation) is a client
 * derivation from those wire facts — nothing here is ever demanded back as a new
 * contract field (PHILOSOPHY #29 "Rigor on the Wire, Play in the Client").
 *
 * Read-only output projection (ADR-047 ghost lineage — sibling of RegionGhostView /
 * UncertaintyGhostView). Sole owner = GraspController (PHILOSOPHY #4/#9): it
 * constructs this view on candidate hover/select, calls tick() from the animation
 * loop, and dispose()s it on deselect / new run / overlay exit. The target
 * highlight is this view's own EdgesGeometry overlay — it never touches
 * `cuboidMat.emissive` (owned by MeshView._syncEmissive, CODE_CONTRACTS
 * "Visual State Ownership").
 *
 * Sizing follows the PHILOSOPHY #27 pair rule: target size in screen pixels
 * (~40 px glyph), clamped to a world-space cap derived from the scene radius.
 *
 * A committed select plays the three-beat reveal (ADR-065 Phase 5): approach
 * slide → finger close → score flood + caption. The timeline is the pure
 * `revealFrame` (GraspGhostMath); reduced motion jumps to the final stage
 * (static fully-formed ghost — information preserved, movement dropped, #30).
 *
 * The replay (ADR-158 R2, a Fact — D5) drives the SAME glyph through
 * `showReplayFrame`: the glyph stands at the frame's TCP with the hand as open as
 * the phase says, drawn full on a judged sample and faint between samples (a
 * derived pose nobody judged — G1). The obstacles a judged sample struck are
 * outlined in the caution tone (the panel's hit colour) from the request's own obstacle boxes —
 * the very shapes the solver tested — solid for a judged hit, dashed for an arm
 * that was only measured. While a replay is shown it owns the glyph; the reveal
 * slide (a Delight) does not play over it.
 *
 * @module view/GraspGhostView
 */
import * as THREE from 'three'
import {
  approachVector, scoreColor, ghostLineStyle,
  revealFrame, mixHex, NEUTRAL_GLYPH_COLOR,
} from './GraspGhostMath.js'
import { prefersReducedMotion } from '../theme/motion.js'
import { MM_PER_METER } from '../domain/worldUnits.js'
import { easeOutQuad } from './MotionMath.js'
import { COLOR } from '../theme/tokens.js'

/**
 * Base frame the contract's `cartesianFrame` is *assumed* to be expressed in.
 * The upstream schema says only "a base/world frame" — the world/base-link choice
 * is still unspecified upstream (ADR-060), so the assumption is sealed in this ONE
 * constant (§1.1) and surfaced honestly in the ghost caption until upstream
 * settles it. When it does, this line is the single change point.
 */
export const FRAME_CONVENTION = 'world' /* assumed — upstream leaves the base frame unspecified */

const GLYPH_TARGET_PX   = 40    // on-screen glyph size the scale loop aims for
/**
 * Lower bound of the glyph's WORLD size (PHILOSOPHY #27's pair rule needs the
 * world term to be a world quantity). It means 50mm — the same physical size it
 * meant when it was written `0.05` against a metre-era scene. ADR-136 made the
 * world-unit mm and did not reach this line, leaving a floor of 0.05mm: a bound
 * that can never bind is indistinguishable from one that was removed, so it
 * reported green while guarding nothing (ADR-137; cf. ADR-103 on retired shapes
 * that keep passing). Spelled against the unit authority so the next unit
 * decision cannot silently skip it.
 */
const GLYPH_MIN_WORLD   = MM_PER_METER * 0.05
const HOVER_OPACITY     = 0.4   // candidate row hover = preview (ADR-059 §B-3)
const SELECT_OPACITY    = 0.9   // click select = committed ghost
const FADE_MS           = 150
const APPROACH_START    = 1.5   // glyph-lengths back along the approach vector
const BETWEEN_OPACITY   = 0.4   // a replay frame between judged samples — drawn, not judged (ADR-158 D2)
// A hit is said in the caution tone — the same colour the panel's hit lines use
// (not the accent: that means the entity being operated on — ADR-100).
const HIT_HEX           = parseInt(COLOR.cautionTone.slice(1), 16)

/** Build one finger box (unit glyph space; approach along local −Z, TCP at origin). */
function fingerGeometry() {
  return new THREE.BoxGeometry(0.1, 0.12, 0.52)
}

export class GraspGhostView {
  /**
   * @param {THREE.Scene} scene
   * @param {HTMLElement} container — HTML label parent (document.body)
   */
  constructor(scene, container) {
    this._scene       = scene
    this._container   = container
    this._disposables = []

    // Outer group: pose (frame position + orientation). Inner group: the glyph,
    // animated along local +Z during the approach slide.
    this._group = new THREE.Group()
    this._group.visible = false
    this._glyph = new THREE.Group()
    this._group.add(this._glyph)
    scene.add(this._group)

    // ── Stylised two-finger gripper (primitives only — no mesh assets) ────────
    this._fillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthTest: true, depthWrite: false,
    })
    this._lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
    this._dashMat = new THREE.LineDashedMaterial({
      color: 0xffffff, transparent: true, opacity: 0, dashSize: 0.08, gapSize: 0.05,
    })

    // The hand (palm + fingers + their outlines) is its own group so that ONE
    // flag decides whether it is drawn (原則 #4): hidden when the arm's own
    // tool is showing the hand at this TCP (ADR-150 D4 — `setHandOnArm`).
    this._hand = new THREE.Group()
    this._glyph.add(this._hand)

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 0.16), this._fillMat)
    palm.position.set(0, 0, 0.45)
    this._hand.add(palm)

    this._fingers = []
    for (const side of [-1, 1]) {
      const finger = new THREE.Mesh(fingerGeometry(), this._fillMat)
      finger.position.set(side * 0.34, 0, 0.13)
      this._hand.add(finger)
      this._fingers.push({ mesh: finger, side })
    }

    // Glyph outlines (line style carries the verdict triple — ADR-059 §B-2).
    this._glyphEdges = []
    for (const mesh of [palm, ...this._fingers.map(f => f.mesh)]) {
      const eg = new THREE.EdgesGeometry(mesh.geometry)
      const solidLine  = new THREE.LineSegments(eg, this._lineMat)
      const dashedLine = new THREE.LineSegments(eg, this._dashMat)
      dashedLine.computeLineDistances()
      for (const line of [solidLine, dashedLine]) {
        line.position.copy(mesh.position)
        this._hand.add(line)
      }
      this._glyphEdges.push({ solidLine, dashedLine })
      this._disposables.push({ geometry: eg })
      this._disposables.push({ geometry: mesh.geometry })
    }

    // ── Tapered approach arrow: thins toward the target along local −Z ────────
    // Cylinder axis is +Y by default → rotate so it runs along Z.
    const shaft = new THREE.CylinderGeometry(0.015, 0.06, 0.9, 8)
    const shaftMesh = new THREE.Mesh(shaft, this._fillMat)
    shaftMesh.rotation.x = Math.PI / 2          // +Y → −Z direction of travel
    shaftMesh.position.set(0, 0, 1.15)          // spans z ≈ 0.7 … 1.6 (before the glyph)
    this._glyph.add(shaftMesh)
    const tip = new THREE.ConeGeometry(0.07, 0.18, 8)
    const tipMesh = new THREE.Mesh(tip, this._fillMat)
    tipMesh.rotation.x = Math.PI / 2            // point along −Z (toward the TCP)
    tipMesh.position.set(0, 0, 0.62)
    this._glyph.add(tipMesh)
    this._disposables.push({ geometry: shaft }, { geometry: tip })

    // ── Target outline (own overlay — never MeshView emissive) ────────────────
    this._targetLine = null
    this._targetMat  = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })

    // ── Caption: convention honesty + score (ADR-059 §A-2) ────────────────────
    this._label = document.createElement('div')
    Object.assign(this._label.style, {
      position: 'fixed', pointerEvents: 'none', userSelect: 'none',
      background: 'rgba(24,24,24,0.85)', color: '#9ad', fontSize: '10px',
      fontFamily: 'monospace', padding: '2px 7px', borderRadius: '3px',
      border: '1px solid #3a5a7a', whiteSpace: 'nowrap', display: 'none', zIndex: '50',
    })
    container.appendChild(this._label)

    // Animation state — view-local phase only, never a new FSM (ADR-059 §C).
    this._mode        = null      // 'hover' | 'select' | null
    this._shownRank   = null      // last rank shown (approach replays on change)
    this._opacity     = 0
    this._animStart   = 0
    this._lastTick    = 0
    this._worldCap    = Infinity
    this._approach    = [0, 0, -1]
    this._scoreHex    = NEUTRAL_GLYPH_COLOR
    this._reduced     = false     // sampled per reveal (ADR-065 Phase 5)
    this._scoreRevealed = false   // beat-3 gate for the caption
    // Opacity fade as a function of the clock (from → to over FADE_MS on `fade`).
    this._fadeFrom    = 0
    this._fadeTo      = 0
    this._fadeStart   = 0

    // ── Replay (ADR-158 R2) ───────────────────────────────────────────────────
    this._replay      = null      // the frame on screen, or null = candidate mode
    this._struck      = new THREE.Group()
    this._struck.renderOrder = 3
    scene.add(this._struck)
    this._struckSig   = ''
    this._struckMat   = new THREE.LineBasicMaterial({ color: HIT_HEX, transparent: true, opacity: 0.95, depthTest: false })
    this._struckDash  = new THREE.LineDashedMaterial({
      color: HIT_HEX, transparent: true, opacity: 0.95, depthTest: false, dashSize: 12, gapSize: 8,
    })
  }

  /**
   * Show one replay frame (ADR-158 R2), or leave the replay (`null`). The
   * frame is already derived (`replayFrame` → mm by the controller); this view
   * only draws it.
   *
   * @param {{position:number[], orientation:number[], kind:'sample'|'between'|'sweep'|'unjudged',
   *          closure:number, caption:string,
   *          struck:{judged:boolean, shape:{kind:'box', center:number[], halfExtents:number[], orientation:number[]}
   *                 |{kind:'sphere', center:number[], radius:number}}[]}|null} frame
   */
  showReplayFrame(frame) {
    this._replay = frame
    if (!frame) { this._setStruck([]); return }
    const [px, py, pz] = frame.position
    const [qx, qy, qz, qw] = frame.orientation
    this._group.position.set(px, py, pz)
    this._group.quaternion.set(qx, qy, qz, qw)
    this._group.visible = true
    this._mode = 'select'
    this._label.textContent = frame.caption
    this._setStruck(frame.struck)
  }

  /** Rebuild the struck-obstacle outlines only when the set changes (PictureWatch sees the rest). */
  _setStruck(struck) {
    const sig = struck.map(s => `${s.judged ? 'j' : 'm'}:${JSON.stringify(s.shape)}`).join('|')
    if (sig === this._struckSig) return
    this._struckSig = sig
    for (const line of [...this._struck.children]) {
      this._struck.remove(line)
      line.geometry.dispose()
    }
    for (const { judged, shape } of struck) {
      const geo = shape.kind === 'sphere'
        ? new THREE.SphereGeometry(shape.radius, 12, 8)
        : new THREE.BoxGeometry(shape.halfExtents[0] * 2, shape.halfExtents[1] * 2, shape.halfExtents[2] * 2)
      const eg = new THREE.EdgesGeometry(geo)
      geo.dispose()
      const line = new THREE.LineSegments(eg, judged ? this._struckMat : this._struckDash)
      if (!judged) line.computeLineDistances()
      line.position.set(...shape.center)
      if (shape.kind === 'box') line.quaternion.set(...shape.orientation)
      line.renderOrder = 3
      this._struck.add(line)
    }
  }

  /**
   * Show (or retarget) the ghost for one candidate. `frame` must already have
   * passed the capability gate (`renderableEndEffectorFrame`) — this view never
   * interprets raw poses.
   *
   * @param {{ frame: {position:number[], orientation:number[]}, score: object,
   *           mode: 'hover'|'select', rank?: number }} spec
   */
  showCandidate({ frame, score, mode, rank }) {
    if (this._replay) return     // the replay owns the glyph while it is shown (ADR-158 R2)
    const [px, py, pz] = frame.position
    const [qx, qy, qz, qw] = frame.orientation
    this._group.position.set(px, py, pz)
    this._group.quaternion.set(qx, qy, qz, qw)
    this._group.visible = true
    this._approach = approachVector(frame.orientation)

    // The score colour is the third reveal beat's destination — tick() floods the
    // glyph from NEUTRAL_GLYPH_COLOR to it as revealFrame().score ramps up.
    this._scoreHex = scoreColor(score?.totalScore ?? 0)

    const style = ghostLineStyle(score)
    for (const { solidLine, dashedLine } of this._glyphEdges) {
      solidLine.visible  = style === 'solid'
      dashedLine.visible = style === 'dashed'
    }

    // Selecting (or switching the selection to a different candidate) replays the
    // approach slide (ADR-059 §B-3); hover only fades.
    const wasSelectSame = this._mode === 'select' && this._shownRank === (rank ?? null)
    this._mode = mode
    this._shownRank = rank ?? null
    if (mode === 'select' && !wasSelectSame) {
      this._animStart = this._lastTick || 0
      // The switch has a seam (inventory G3 — ADR-158 R2 / DEF-069): the glyph
      // drops to the preview level and fades back up with the slide, so a new
      // candidate never just swaps in at full strength.
      this._fadeFrom  = Math.min(this._opacity, HOVER_OPACITY)
      this._fadeTo    = SELECT_OPACITY
      this._fadeStart = this._animStart
      // Read the preference once per reveal (same per-spawn discipline as the
      // MotionGovernor) — the single boundary is src/theme/motion.js.
      this._reduced = prefersReducedMotion()
    }

    const total = score?.totalScore
    this._label.textContent =
      `#${rank ?? '—'} · frame: ${FRAME_CONVENTION} (assumed) · score ${typeof total === 'number' ? total.toFixed(3) : '—'}`
  }

  /**
   * Outline the grasped target with this view's own edges overlay. Pass the
   * target's baked world-space geometry (MeshView cuboid geometry) or null to
   * clear. EdgesGeometry over the baked geometry matches the solid's actual
   * orientation (CODE_CONTRACTS "BoxHelper Forbidden for World-Space Baked
   * Geometry").
   *
   * @param {THREE.BufferGeometry|null} geometry
   */
  setTargetGeometry(geometry) {
    if (this._targetLine) {
      this._scene.remove(this._targetLine)
      this._targetLine.geometry.dispose()
      this._targetLine = null
    }
    if (!geometry) return
    const eg = new THREE.EdgesGeometry(geometry)
    this._targetLine = new THREE.LineSegments(eg, this._targetMat)
    this._targetLine.renderOrder = 3
    this._scene.add(this._targetLine)
  }

  /**
   * Whether the arm's own flange-mounted tool is showing the hand for this
   * candidate (ADR-150 D4). When it is, the glyph draws only the approach arrow
   * — a second, screen-sized gripper at the same TCP would be the floating,
   * unattached hand the dogfooder reported. The one writer of `_hand.visible`.
   * @param {boolean} onArm
   */
  setHandOnArm(onArm) {
    this._hand.visible = !onArm
  }

  /** Hide the ghost (kept alive for the next hover — cheap show/hide cycle). */
  clear() {
    this.showReplayFrame(null)
    this._mode = null
    this._shownRank = null
    this._group.visible = false
    this._label.style.display = 'none'
    this.setTargetGeometry(null)
  }

  /** World-size clamp for the glyph (scene-radius derived — PHILOSOPHY #27). */
  setWorldCap(cap) {
    this._worldCap = Number.isFinite(cap) && cap > 0 ? cap : Infinity
  }

  /**
   * Per-frame update: opacity fade, approach slide + finger close, screen-space
   * scale (clamped in world space), caption placement.
   *
   * @param {number} t — animation-loop timestamp (ms)
   * @param {THREE.Camera} camera — SceneView.activeCamera
   * @param {THREE.WebGLRenderer} renderer
   */
  tick(t, camera, renderer) {
    this._lastTick = t
    const replay = this._replay
    const targetOpacity = replay
      ? (replay.kind === 'sample' || replay.kind === 'sweep' ? SELECT_OPACITY : BETWEEN_OPACITY)
      : this._mode === 'select' ? SELECT_OPACITY
      : this._mode === 'hover' ? HOVER_OPACITY : 0
    if (targetOpacity !== this._fadeTo) {
      this._fadeFrom  = this._opacity
      this._fadeTo    = targetOpacity
      this._fadeStart = t
    }
    if (this._reduced && this._mode === 'select') {
      // Reduced motion: the fade is dropped along with the slide — the ghost is
      // a static, fully-formed cue (information preserved, movement dropped).
      this._opacity = targetOpacity
    } else {
      // Opacity fades on the `fade` curve as a function of the clock (M2).
      const p = easeOutQuad((t - this._fadeStart) / FADE_MS)
      this._opacity = this._fadeFrom + (this._fadeTo - this._fadeFrom) * p
    }
    this._fillMat.opacity   = this._opacity * 0.35
    this._lineMat.opacity   = this._opacity
    this._dashMat.opacity   = this._opacity
    this._targetMat.opacity = this._opacity * 0.9

    if (!this._group.visible || !camera || !renderer) return

    // Three-beat reveal (ADR-065 Phase 5): approach slide → finger close →
    // score flood. Hover previews pass Infinity = final stage immediately;
    // reduced motion jumps there too (revealFrame owns both rules).
    // A replay frame is the final stage at its own TCP: no slide (the replay's
    // motion is the samples), the hand as closed as the phase says.
    const elapsed = replay ? Infinity : this._mode === 'select' ? t - this._animStart : Infinity
    const beat = revealFrame(elapsed, this._reduced)
    if (replay) beat.close = replay.closure

    // Beat 1 — approach slide: glyph starts APPROACH_START glyph-lengths back
    // along +Z (local; the approach direction is −Z) and eases out to the TCP.
    this._glyph.position.set(0, 0, APPROACH_START * (1 - beat.approach))
    // Beat 2 — fingers close onto the target.
    for (const { mesh, side } of this._fingers) {
      mesh.position.x = side * (0.34 - 0.08 * beat.close)
    }
    // Beat 3 — the judgement lands: neutral glyph floods to the score colour
    // and the caption (score number) appears. The panel's score bars show the
    // committed numbers instantly regardless — this never delays the fact
    // beyond the timeline's <1s cap.
    const hex = mixHex(NEUTRAL_GLYPH_COLOR, this._scoreHex, beat.score)
    this._fillMat.color.setHex(hex)
    this._lineMat.color.setHex(hex)
    this._dashMat.color.setHex(hex)
    this._targetMat.color.setHex(hex)
    this._scoreRevealed = beat.score > 0

    // Screen-pixel target size clamped in world space (PHILOSOPHY #27 pair rule).
    if (camera.isPerspectiveCamera) {
      const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360)
      const screenH    = renderer.domElement.clientHeight || 1
      const d          = camera.position.distanceTo(this._group.position)
      let worldSize    = (GLYPH_TARGET_PX / screenH) * 2 * d * tanHalfFov
      worldSize = Math.max(GLYPH_MIN_WORLD, Math.min(worldSize, this._worldCap))
      this._group.scale.setScalar(worldSize)
    }

    // Caption above the TCP — gated on the score beat (the caption IS the score).
    const ndc = this._group.position.clone().project(camera)
    if (ndc.z > 1 || this._opacity < 0.05 || !this._scoreRevealed) { this._label.style.display = 'none'; return }
    const rect = renderer.domElement.getBoundingClientRect()
    const sx = (ndc.x + 1) / 2 * rect.width + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top
    this._label.style.display = 'block'
    this._label.style.left = `${Math.round(sx + 12)}px`
    this._label.style.top  = `${Math.round(sy - 26)}px`
  }

  /** Symmetric teardown of everything the constructor / setTargetGeometry added. */
  dispose() {
    this.setTargetGeometry(null)
    this._setStruck([])
    this._scene.remove(this._struck)
    this._struckMat.dispose()
    this._struckDash.dispose()
    this._scene.remove(this._group)
    for (const d of this._disposables) d.geometry?.dispose()
    this._fillMat.dispose()
    this._lineMat.dispose()
    this._dashMat.dispose()
    this._targetMat.dispose()
    this._label.remove()
    this._disposables = []
    this._glyphEdges = []
    this._fingers = []
  }
}
