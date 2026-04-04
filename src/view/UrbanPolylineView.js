/**
 * UrbanPolylineView — renderer for UrbanPolyline domain entities.
 *
 * Renders:
 *  - A Line2 (fat line) connecting all vertices in Lynch color; grey when unclassified
 *  - Vertex dot markers (small spheres) at each vertex
 *  - A BoxHelper for selection highlight
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView
 * so AppController's setMode() and mode-agnostic calls are safe.
 *
 * Note: no `cuboid` property — UrbanPolyline is excluded from raycasting.
 * Move support: updateGeometry(corners) refreshes vertex positions.
 *
 * @see ADR-026
 */
import * as THREE from 'three'
import { Line2 }         from 'three/addons/lines/Line2.js'
import { LineGeometry }  from 'three/addons/lines/LineGeometry.js'
import { LineMaterial }  from 'three/addons/lines/LineMaterial.js'
import { getLynchClassEntry } from '../domain/LynchClassRegistry.js'

const DEFAULT_COLOR   = 0x888888   // unclassified grey
const SELECTED_WIDTH  = 4
const UNSELECTED_WIDTH = 2

export class UrbanPolylineView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3[]} points  ordered vertex positions (N ≥ 2)
   * @param {string|null}   lynchClass  'Path' | 'Edge' | null
   * @param {THREE.WebGLRenderer} renderer  needed for Line2 resolution
   */
  constructor(scene, points, lynchClass, renderer) {
    this._scene    = scene
    this._renderer = renderer

    // ── Line2 geometry ─────────────────────────────────────────────────────
    this._lineGeo = new LineGeometry()
    this._lineMat = new LineMaterial({
      color:       this._colorForClass(lynchClass),
      linewidth:   UNSELECTED_WIDTH,
      worldUnits:  false,    // linewidth in pixels
      depthTest:   false,
      transparent: true,
      opacity:     0.9,
    })
    this._lineMat.resolution.set(
      renderer?.domElement?.width  ?? window.innerWidth,
      renderer?.domElement?.height ?? window.innerHeight,
    )
    this._line = new Line2(this._lineGeo, this._lineMat)
    this._line.renderOrder = 2
    scene.add(this._line)

    // ── Vertex dots ────────────────────────────────────────────────────────
    this._dotGeo = new THREE.SphereGeometry(0.06, 6, 6)
    this._dotMat = new THREE.MeshBasicMaterial({
      color:    this._colorForClass(lynchClass),
      depthTest: false,
    })
    /** @type {THREE.Mesh[]} */
    this._dots = []

    // ── BoxHelper ──────────────────────────────────────────────────────────
    this._helperObj = new THREE.Object3D()
    scene.add(this._helperObj)
    this.boxHelper = new THREE.BoxHelper(this._helperObj, 0xffffff)
    this.boxHelper.visible = false
    scene.add(this.boxHelper)

    // ── Set initial geometry ───────────────────────────────────────────────
    this._setPoints(points)
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  /**
   * Sets (or replaces) the vertex positions for the line.
   * @param {THREE.Vector3[]} points
   */
  _setPoints(points) {
    // Remove old dots
    for (const d of this._dots) {
      this._scene.remove(d)
    }
    this._dots = []

    if (!points || points.length < 2) return

    // Flat position array for LineGeometry
    const flat = []
    for (const p of points) { flat.push(p.x, p.y, p.z) }
    this._lineGeo.setPositions(flat)
    this._line.computeLineDistances()

    // Vertex dots
    for (const p of points) {
      const dot = new THREE.Mesh(this._dotGeo, this._dotMat)
      dot.position.copy(p)
      dot.renderOrder = 2
      this._scene.add(dot)
      this._dots.push(dot)
    }

    this._updateBoxHelper(points)
  }

  /**
   * Refreshes the BoxHelper bounding volume from current vertex positions.
   * @param {THREE.Vector3[]} points
   */
  _updateBoxHelper(points) {
    if (!points || points.length === 0) return
    const bMin = new THREE.Vector3( Infinity,  Infinity,  Infinity)
    const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    for (const p of points) { bMin.min(p); bMax.max(p) }
    const center = bMin.clone().add(bMax).multiplyScalar(0.5)
    // Small Z padding so the BoxHelper is visible on the ground plane
    bMin.z -= 0.05; bMax.z += 0.05
    const size = bMax.clone().sub(bMin)
    this._helperObj.position.copy(center)
    this._helperObj.scale.set(size.x || 0.1, size.y || 0.1, size.z || 0.1)
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  /** Returns hex color for the given Lynch class (grey if null). */
  _colorForClass(lynchClass) {
    const entry = getLynchClassEntry(lynchClass)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  // ── Move support ───────────────────────────────────────────────────────────

  /**
   * Refreshes geometry after entity.move().
   * corners = all vertex positions (same order as entity.vertices).
   * @param {THREE.Vector3[]} corners
   */
  updateGeometry(corners) {
    if (!corners || corners.length < 2) return
    this._setPoints(corners)
  }

  /** Refreshes BoxHelper after confirm/cancel grab. */
  updateBoxHelper() {
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  // ── Lynch class (color) update ─────────────────────────────────────────────

  /**
   * Updates line and dot color when lynchClass changes.
   * @param {string|null} lynchClass
   */
  setLynchClass(lynchClass) {
    const hex = this._colorForClass(lynchClass)
    this._lineMat.color.setHex(hex)
    this._dotMat.color.setHex(hex)
    this.boxHelper.material?.color.setHex(hex)
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._line.visible = visible
    for (const d of this._dots) d.visible = visible
    if (!visible) this.boxHelper.visible = false
  }

  setObjectSelected(sel) {
    this.boxHelper.visible = sel
    this._lineMat.linewidth = sel ? SELECTED_WIDTH : UNSELECTED_WIDTH
    if (sel) this.boxHelper.update()
  }

  // ── Edit-mode no-ops ───────────────────────────────────────────────────────

  setFaceHighlight()      {}
  clearExtrusionDisplay() {}
  clearSketchRect()       {}
  clearVertexHover()      {}
  clearEdgeHover()        {}
  clearEditSelection()    {}
  clearPivotDisplay()     {}
  showSnapCandidates()    {}
  showSnapNearest()       {}
  clearSnapNearest()      {}
  showSnapLocked()        {}
  clearSnapLocked()       {}
  clearSnapDisplay()      {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Removes all Three.js objects from the scene and disposes GPU resources.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    scene.remove(this._line)
    scene.remove(this._helperObj)
    scene.remove(this.boxHelper)
    for (const d of this._dots) scene.remove(d)
    this._lineGeo.dispose()
    this._lineMat.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._dots = []
  }
}
