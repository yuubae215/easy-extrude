// @ts-nocheck
/**
 * SpatialLinkView — renderer for SpatialLink domain entities (Phase 3).
 *
 * Renders:
 *  - A dashed Three.js Line between the world centroids of source and target entities
 *  - A directional arrowhead (cone) for all directed link types
 *
 * Color-coded by semanticType (ADR-038):
 *  Category A — Geometric (directed, source in target's frame):
 *   mounts    → green   #22C55E
 *   fastened  → emerald #10B981
 *   aligned   → teal    #14B8A6
 *  Category B — Topological:
 *   contains  → violet  #8B5CF6  (directed)
 *   connects  → cyan    #06B6D4  (undirected)
 *  Category C — Semantic (directed, source depends on target):
 *   references → amber  #F59E0B
 *   represents → rose   #F43F5E
 *
 * Motion (ADR-166 M4b): the highlight and the violation are TARGETS (setters
 * record booleans); `update(…, t)` is the sole writer of the line's colour,
 * opacity and dashes, composing the followed levels with the continuous
 * tension/severity through the pure `LinkMotionMath.linkLineFrame`. A violated
 * link breathes with a phase from its id (N links never blink together); the
 * binding light at creation is a separate transient (`LinkBindEffect`).
 *
 * No-op interface: every MeshView method called through polymorphic references
 * in AppController is implemented as a no-op (PHILOSOPHY #17).
 *
 * SpatialLinkView is stored in SceneService._linkViews (not on the SpatialLink
 * entity, which carries no meshView by ADR-030 §1).
 *
 * @see ADR-030
 */
import * as THREE from 'three'
import { LINK_TYPE_COLORS } from '../theme/semantic.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { CUE_REST, SELECTION_CUE, VIOLATION_CUE, cueLevel, retargetCue, settledCue } from './CueFollowMath.js'
import { LINK_TONES, breachPulse, linkLineFrame } from './LinkMotionMath.js'
import { dashMarch } from './IdleMotionMath.js'

/**
 * Link colour by `semanticType` (ADR-038). Re-exported from the declared
 * data-meaning vocabulary — ADR-100 Decision 5 moved the values to
 * `theme/semantic.js` so a view is no longer the source for a table two
 * other views import.
 */
export { LINK_TYPE_COLORS }

/**
 * Link types that carry a directional arrowhead (source → target).
 * Undirected types (connects) have no arrow.
 */
const DIRECTED = new Set(['mounts', 'fastened', 'aligned', 'contains', 'references', 'represents', 'bounded_by'])

export class SpatialLinkView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3} srcPos       world centroid of the source entity
   * @param {THREE.Vector3} tgtPos       world centroid of the target entity
   * @param {string}        semanticType semanticType of the SpatialLink (ADR-038)
   * @param {{id?: string|null}} [opts] the link's identity — seeds the breath's
   *   phase (ADR-093 D1). A ghost suggestion has none (phase 0; it never breaks).
   */
  constructor(scene, srcPos, tgtPos, semanticType, { id = null } = {}) {
    this._scene = scene
    this._id = id
    this._baseColor = LINK_TYPE_COLORS[semanticType] ?? LINK_TONES.unknown

    // ── Dashed line ────────────────────────────────────────────────────────
    this._geo = new THREE.BufferGeometry()
    this._mat = new THREE.LineDashedMaterial({
      color:       this._baseColor,
      dashSize:    0.35,
      gapSize:     0.18,
      linewidth:   1,
      depthTest:   false,
      transparent: true,
      opacity:     0.4,   // idle: subtle; becomes 1.0 on select/drag
    })
    this._line = new THREE.Line(this._geo, this._mat)
    this._line.renderOrder = 2
    scene.add(this._line)

    // ── Directional arrowhead (directed types only) ────────────────────────
    this._arrow = null
    if (DIRECTED.has(semanticType)) {
      // ArrowHelper: shaft is hidden; only the cone head is shown
      const tmpDir = new THREE.Vector3(1, 0, 0)
      this._arrow = new THREE.ArrowHelper(
        tmpDir,
        new THREE.Vector3(),
        0.4,    // total length (irrelevant — shaft hidden)
        this._baseColor,
        0.28,   // headLength
        0.13,   // headWidth
      )
      this._arrow.line.visible = false  // hide the shaft, show only the cone
      this._arrow.renderOrder = 2
      scene.add(this._arrow)
    }

    // Rest distance: baseline for tension computation during grab.
    this._restDistance = Math.max(srcPos.distanceTo(tgtPos), 0.001)

    // Targets (setters write these) and the levels on screen (update() follows them).
    this._violated    = false
    this._highlighted = false
    /** @type {{highlight: import('./CueFollowMath.js').CueSegment, violation: import('./CueFollowMath.js').CueSegment}} */
    this._cues     = { highlight: CUE_REST, violation: CUE_REST }
    this._clocked  = false   // a first clocked update lands on the targets (no entrance)
    this._reduced      = prefersReducedMotion()
    this._unsubReduced = onReducedMotionChange(r => { this._reduced = r })

    // Set initial geometry
    this.update(srcPos, tgtPos)
  }

  // ── Geometry update ────────────────────────────────────────────────────────

  /**
   * Repositions the line and arrowhead between the two world centroids.
   * Called every animation frame by SceneService._updateSpatialLinkViews().
   *
   * @param {THREE.Vector3} srcPos
   * @param {THREE.Vector3} tgtPos
   * @param {number} [grabElapsed=NaN] seconds since an endpoint was grabbed — drives the marching
   *                                  ants from the clock (`dashMarch`, ADR-166 M4d1); absent: dashes hold.
   * @param {number} [tension=0]      0..1 — colour shift from the type colour toward `strain` (cautionTone).
   * @param {number} [severity=0]     0..1 — bounded_by proximity gradient; overrides tension and the violation.
   * @param {number} [t=NaN]          loop clock (seconds) — absent: the look stands at its targets.
   */
  update(srcPos, tgtPos, grabElapsed = NaN, tension = 0, severity = 0, t = NaN) {
    const pts = [srcPos.x, srcPos.y, srcPos.z, tgtPos.x, tgtPos.y, tgtPos.z]
    this._geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this._geo.attributes.position.needsUpdate = true
    this._line.computeLineDistances()

    this._applyLook(tension, severity, t)

    // The march is a function of the grab's elapsed time, not of how many frames
    // ran (it used to advance a fixed step per call — its speed was the frame rate).
    // Reduced motion: the dashes hold; the tension colour still says "stretched".
    const dashOffset = dashMarch(grabElapsed, this._reduced)
    if (dashOffset !== 0) {
      this._mat.dashOffset = dashOffset
    }

    if (this._arrow) {
      const dir = new THREE.Vector3().subVectors(tgtPos, srcPos)
      const len = dir.length()
      if (len > 0.01) {
        dir.normalize()
        // Position the arrowhead at 75% along the line (closer to target)
        const arrowPos = srcPos.clone().lerp(tgtPos, 0.75)
        this._arrow.position.copy(arrowPos)
        this._arrow.setDirection(dir)
      }
    }
  }

  // ── The look (sole writer of colour / opacity / dashes) ───────────────────

  /**
   * Follow the targets and write one composed frame (ADR-166 M4b). Without a
   * clock (an un-ticked ghost suggestion) or before the first clocked update,
   * the levels stand at their targets — a line never animates into its first
   * state. Sole writer of `_mat.color/opacity/dash*` and the cone colour (#4).
   * @param {number} tension
   * @param {number} severity
   * @param {number} t loop clock (seconds)
   */
  _applyLook(tension, severity, t) {
    const c = this._cues
    const r = this._reduced
    if (!Number.isFinite(t) || !this._clocked) {
      c.highlight = settledCue(this._highlighted ? 1 : 0)
      c.violation = settledCue(this._violated ? 1 : 0)
      if (Number.isFinite(t)) this._clocked = true
    } else {
      c.highlight = retargetCue(t, c.highlight, this._highlighted ? 1 : 0, SELECTION_CUE, r)
      c.violation = retargetCue(t, c.violation, this._violated ? 1 : 0, VIOLATION_CUE, r)
    }
    const f = linkLineFrame({
      base:      this._baseColor,
      highlight: cueLevel(t, c.highlight, SELECTION_CUE, r),
      tension,
      severity,
      violation: cueLevel(t, c.violation, VIOLATION_CUE, r),
      pulse:     breachPulse(t, this._id, r),
    })
    this._mat.color.setRGB(f.rgb[0], f.rgb[1], f.rgb[2])
    this._mat.opacity  = f.opacity
    this._mat.dashSize = f.dashSize
    this._mat.gapSize  = f.gapSize
    if (this._arrow) this._arrow.cone.material.color.setRGB(f.rgb[0], f.rgb[1], f.rgb[2])
  }

  // ── Clearance violation state ──────────────────────────────────────────────

  /**
   * Records the violation TARGET. The next `update` arrives at it at once
   * (Tier F) and, once cleared, leaves an afterglow; a violated line breathes.
   * @param {boolean} violated
   */
  setViolated(violated) {
    this._violated = !!violated
    if (!this._clocked) this._applyLook(0, 0, NaN)   // not on screen in time yet: stand at the target
  }

  // ── Tension / highlight state ──────────────────────────────────────────────

  /**
   * Snapshot the current source-target distance as the baseline for tension.
   * Call at the start of a grab operation that involves this link's entities.
   */
  setRestDistance(srcPos, tgtPos) {
    this._restDistance = Math.max(srcPos.distanceTo(tgtPos), 0.001)
  }

  /** Baseline distance recorded when drag started. */
  get restDistance() { return this._restDistance }

  /**
   * Records the highlight TARGET (a linked entity is selected or dragged). The
   * line lands on it (`land`) and lets go on `fade` — it brightens and its
   * dashes lengthen; `update` writes the pixels.
   */
  setHighlighted(highlighted) {
    this._highlighted = !!highlighted
    if (!this._clocked) this._applyLook(0, 0, NaN)   // not on screen in time yet: stand at the target
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._line.visible = visible
    if (this._arrow) this._arrow.visible = visible
  }

  /** SpatialLink has no selection highlight — no-op. */
  setObjectSelected() {}

  // ── Move / geometry no-ops ─────────────────────────────────────────────────

  updateGeometry()  {}
  updateBoxHelper() {}

  // ── Edit-mode no-ops (keeps AppController.setMode() safe) ─────────────────

  setFaceHighlight()      {}
  clearExtrusionDisplay() {}
  clearSketchRect()       {}
  clearVertexHover()      {}
  clearEdgeHover()        {}
  clearEditSelection()    {}
  clearPivotDisplay()     {}
  clearSnapDisplay()      {}
  showSnapCandidates()    {}
  showSnapNearest()       {}
  clearSnapNearest()      {}
  showSnapLocked()        {}
  clearSnapLocked()       {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Removes all Three.js objects from the scene and disposes GPU resources.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    this._unsubReduced?.()
    this._unsubReduced = null
    scene.remove(this._line)
    this._geo.dispose()
    this._mat.dispose()

    if (this._arrow) {
      scene.remove(this._arrow)
      this._arrow.line.geometry.dispose()
      this._arrow.line.material.dispose()
      this._arrow.cone.geometry.dispose()
      this._arrow.cone.material.dispose()
      this._arrow = null
    }
  }
}
