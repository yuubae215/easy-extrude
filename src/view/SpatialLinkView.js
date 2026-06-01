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
 *   above     → indigo  #6366F1  (directed)
 *   adjacent  → slate   #64748B  (undirected)
 *   connects  → cyan    #06B6D4  (undirected)
 *  Category C — Semantic (directed, source depends on target):
 *   references → amber  #F59E0B
 *   represents → rose   #F43F5E
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

/** Color hex values by semanticType (ADR-038). */
export const LINK_TYPE_COLORS = {
  // Category A — Geometric
  mounts:     0x22C55E,  // green
  fastened:   0x10B981,  // emerald
  aligned:    0x14B8A6,  // teal
  // Category B — Topological
  contains:   0x8B5CF6,  // violet
  above:      0x6366F1,  // indigo
  adjacent:   0x64748B,  // slate
  connects:   0x06B6D4,  // cyan
  // Category C — Semantic
  references: 0xF59E0B,  // amber
  represents: 0xF43F5E,  // rose
  // Category D — Safety constraint
  bounded_by: 0xFB923C,  // orange
}

/**
 * Link types that carry a directional arrowhead (source → target).
 * Undirected types (connects, adjacent) have no arrow.
 */
const DIRECTED = new Set(['mounts', 'fastened', 'aligned', 'contains', 'above', 'references', 'represents', 'bounded_by'])

export class SpatialLinkView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3} srcPos       world centroid of the source entity
   * @param {THREE.Vector3} tgtPos       world centroid of the target entity
   * @param {string}        semanticType semanticType of the SpatialLink (ADR-038)
   */
  constructor(scene, srcPos, tgtPos, semanticType) {
    this._scene = scene
    this._baseColor = LINK_TYPE_COLORS[semanticType] ?? 0x888888

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

    // Clearance violation state (bounded_by links only).
    this._violated = false

    // Flash state: non-null while the acceptance flash is playing (seconds timestamp).
    this._flashStart = null

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
   * @param {number} [dashOffset=0]   Negative value scrolls dashes source→target (marching ants).
   * @param {number} [tension=0]      0..1 — color shift from semantic color toward orange-red.
   * @param {number} [severity=0]     0..1 — bounded_by proximity gradient; overrides tension and _violated.
   */
  update(srcPos, tgtPos, dashOffset = 0, tension = 0, severity = 0) {
    const pts = [srcPos.x, srcPos.y, srcPos.z, tgtPos.x, tgtPos.y, tgtPos.z]
    this._geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this._geo.attributes.position.needsUpdate = true
    this._line.computeLineDistances()

    // Rubber-band tension: shift color toward orange-red as stretch increases.
    if (tension > 0) {
      const t = Math.min(tension, 1) * Math.min(tension, 1)  // ease-in for drama
      const base    = new THREE.Color(this._baseColor)
      const hot     = new THREE.Color(0xF97316)               // orange
      this._mat.color.lerpColors(base, hot, t)
      if (this._arrow) this._arrow.cone.material.color.lerpColors(base, hot, t)
    } else {
      this._mat.color.set(this._baseColor)
      if (this._arrow) this._arrow.cone.material.color.set(this._baseColor)
    }

    // Severity gradient for bounded_by links: semantic → amber → red as limit approaches.
    // Overrides tension color when severity > 0. Preserves binary _violated for other link types.
    if (severity > 0) {
      const safe  = new THREE.Color(this._baseColor)
      const amber = new THREE.Color(0xFBBF24)
      const red   = new THREE.Color(0xEF4444)
      let gradColor
      if (severity < 0.5) {
        gradColor = safe.clone().lerp(amber, severity * 2)
      } else {
        gradColor = amber.clone().lerp(red, (severity - 0.5) * 2)
      }
      this._mat.color.copy(gradColor)
      if (this._arrow) this._arrow.cone.material.color.copy(gradColor)
      this._mat.dashSize = 0.35 - severity * 0.20
      this._mat.gapSize  = 0.18 - severity * 0.10
      this._mat.opacity  = 0.4 + severity * 0.4
      // Pulse only at full violation zone (severity ≈ 1)
      if (severity > 0.8) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.008)
        const bright = new THREE.Color(0xFF9999)
        this._mat.color.lerp(bright, pulse * 0.4)
        if (this._arrow) this._arrow.cone.material.color.lerp(bright, pulse * 0.4)
        this._mat.opacity = 0.8 + pulse * 0.2
      }
    } else if (this._violated) {
      // Fallback binary alert for non-bounded_by links (e.g., contains, tact-time)
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.008)
      const alertRed    = new THREE.Color(0xEF4444)
      const alertBright = new THREE.Color(0xFF9999)
      this._mat.color.lerpColors(alertRed, alertBright, pulse * 0.4)
      if (this._arrow) this._arrow.cone.material.color.lerpColors(alertRed, alertBright, pulse * 0.4)
      this._mat.dashSize = 0.15
      this._mat.gapSize  = 0.08
      this._mat.opacity  = 0.8 + pulse * 0.2
    }

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

    // Acceptance flash: boost opacity 1.0 → normal over 300ms after link creation.
    if (this._flashStart !== null) {
      const elapsed = performance.now() / 1000 - this._flashStart
      if (elapsed < 0.3) {
        this._mat.opacity = 1.0 - elapsed * 2   // 1.0 → 0.4
      } else {
        this._flashStart = null
      }
    }
  }

  // ── Acceptance flash ──────────────────────────────────────────────────────

  /**
   * Triggers a 300ms opacity flash on the link line to confirm link creation.
   * Sole writer of _flashStart (PHILOSOPHY #4).
   */
  triggerFlash() {
    this._flashStart = performance.now() / 1000
  }

  // ── Clearance violation state ──────────────────────────────────────────────

  /**
   * Sets the clearance violation state for bounded_by links.
   * When violated, the link pulses red to alert the user.
   * @param {boolean} violated
   */
  setViolated(violated) {
    this._violated = violated
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
   * Raises or lowers the line opacity to indicate that the linked entity is
   * selected (highlighted) or idle.  Also enlarges dashes slightly when active.
   */
  setHighlighted(highlighted) {
    this._mat.opacity  = highlighted ? 1.0 : 0.4
    this._mat.dashSize = highlighted ? 0.45 : 0.35
    this._mat.gapSize  = highlighted ? 0.15 : 0.18
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
