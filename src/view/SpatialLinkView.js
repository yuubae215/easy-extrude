// @ts-nocheck
/**
 * SpatialLinkView — renderer for SpatialLink domain entities (Phase 3).
 *
 * Renders:
 *  - A dashed Three.js Line between the world centroids of source and target entities
 *  - A directional arrowhead (cone) for directed link types (references, contains)
 *
 * Color-coded by linkType (ADR-030 §7):
 *  - references → amber  #F59E0B
 *  - connects   → cyan   #06B6D4
 *  - contains   → violet #8B5CF6
 *  - adjacent   → slate  #64748B
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

/** Color hex values by linkType. */
export const LINK_TYPE_COLORS = {
  references: 0xF59E0B,  // amber
  connects:   0x06B6D4,  // cyan
  contains:   0x8B5CF6,  // violet
  adjacent:   0x64748B,  // slate
}

/** Link types that have a directional arrowhead. */
const DIRECTED = new Set(['references', 'contains'])

export class SpatialLinkView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3} srcPos   world centroid of the source entity
   * @param {THREE.Vector3} tgtPos   world centroid of the target entity
   * @param {'references'|'connects'|'contains'|'adjacent'} linkType
   */
  constructor(scene, srcPos, tgtPos, linkType) {
    this._scene = scene

    const color = LINK_TYPE_COLORS[linkType] ?? 0x888888

    // ── Dashed line ────────────────────────────────────────────────────────
    this._geo = new THREE.BufferGeometry()
    this._mat = new THREE.LineDashedMaterial({
      color,
      dashSize:  0.35,
      gapSize:   0.18,
      linewidth: 1,
      depthTest: false,
    })
    this._line = new THREE.Line(this._geo, this._mat)
    this._line.renderOrder = 2
    scene.add(this._line)

    // ── Directional arrowhead (directed types only) ────────────────────────
    this._arrow = null
    if (DIRECTED.has(linkType)) {
      // ArrowHelper: shaft is hidden; only the cone head is shown
      const tmpDir = new THREE.Vector3(1, 0, 0)
      this._arrow = new THREE.ArrowHelper(
        tmpDir,
        new THREE.Vector3(),
        0.4,    // total length (irrelevant — shaft hidden)
        color,
        0.28,   // headLength
        0.13,   // headWidth
      )
      this._arrow.line.visible = false  // hide the shaft, show only the cone
      this._arrow.renderOrder = 2
      scene.add(this._arrow)
    }

    // Set initial geometry
    this.update(srcPos, tgtPos)
  }

  // ── Geometry update ────────────────────────────────────────────────────────

  /**
   * Repositions the line and arrowhead between the two world centroids.
   * Called every animation frame by SceneService._updateSpatialLinkViews().
   * @param {THREE.Vector3} srcPos
   * @param {THREE.Vector3} tgtPos
   */
  update(srcPos, tgtPos) {
    const pts = [srcPos.x, srcPos.y, srcPos.z, tgtPos.x, tgtPos.y, tgtPos.z]
    this._geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this._geo.attributes.position.needsUpdate = true
    this._line.computeLineDistances()

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
