/**
 * AnnotatedRegionView — renderer for AnnotatedRegion domain entities.
 *
 * Renders:
 *  - A Line2 (fat line) as a closed ring connecting all vertices in place-type color
 *  - A translucent fill mesh (ShapeGeometry on Z=0 XY plane)
 *  - Vertex dot markers (small spheres) at each vertex
 *  - A BoxHelper for selection highlight
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView.
 *
 * Note: no `cuboid` property — AnnotatedRegion is excluded from raycasting.
 *
 * @see ADR-029
 */
import * as THREE from 'three'
import { Line2 }         from 'three/addons/lines/Line2.js'
import { LineGeometry }  from 'three/addons/lines/LineGeometry.js'
import { LineMaterial }  from 'three/addons/lines/LineMaterial.js'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'

const DEFAULT_COLOR    = 0x888888
const FILL_OPACITY     = 0.18
const SELECTED_WIDTH   = 4
const UNSELECTED_WIDTH = 2

export class AnnotatedRegionView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3[]} points  ordered ring positions (N ≥ 3, implicitly closed)
   * @param {string|null}   placeType  'Zone' | null
   * @param {THREE.WebGLRenderer} renderer  needed for Line2 resolution
   */
  constructor(scene, points, placeType, renderer) {
    this._scene    = scene
    this._renderer = renderer

    // ── Line2 (closed ring) ────────────────────────────────────────────────
    this._lineGeo = new LineGeometry()
    this._lineMat = new LineMaterial({
      color:       this._colorForType(placeType),
      linewidth:   UNSELECTED_WIDTH,
      worldUnits:  false,
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

    // ── Fill mesh ──────────────────────────────────────────────────────────
    this._fillGeo = null
    this._fillMat = new THREE.MeshBasicMaterial({
      color:       this._colorForType(placeType),
      transparent: true,
      opacity:     FILL_OPACITY,
      depthTest:   false,
      side:        THREE.DoubleSide,
    })
    this._fillMesh = new THREE.Mesh(this._fillGeo, this._fillMat)
    this._fillMesh.renderOrder = 1
    scene.add(this._fillMesh)

    // ── Vertex dots ────────────────────────────────────────────────────────
    this._dotGeo = new THREE.SphereGeometry(0.07, 6, 6)
    this._dotMat = new THREE.MeshBasicMaterial({
      color:    this._colorForType(placeType),
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
   * Sets (or replaces) all vertex positions.
   * @param {THREE.Vector3[]} points
   */
  _setPoints(points) {
    // Remove old dots
    for (const d of this._dots) this._scene.remove(d)
    this._dots = []

    if (!points || points.length < 3) return

    // Closed ring: repeat first point at end for Line2
    const flat = []
    for (const p of points) { flat.push(p.x, p.y, p.z) }
    // Close the ring
    flat.push(points[0].x, points[0].y, points[0].z)
    this._lineGeo.setPositions(flat)
    this._line.computeLineDistances()

    // Fill: ShapeGeometry using XY coordinates (polygon is in Z=0 plane)
    if (this._fillGeo) {
      this._fillGeo.dispose()
      this._fillGeo = null
    }
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.y)))
    this._fillGeo = new THREE.ShapeGeometry(shape)
    // ShapeGeometry is in XY plane (Z=0), which matches the ground plane (ROS Z-up)
    this._fillMesh.geometry = this._fillGeo

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
   * Refreshes BoxHelper bounding volume from current vertex positions.
   * @param {THREE.Vector3[]} points
   */
  _updateBoxHelper(points) {
    if (!points || points.length === 0) return
    const bMin = new THREE.Vector3( Infinity,  Infinity,  Infinity)
    const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    for (const p of points) { bMin.min(p); bMax.max(p) }
    const center = bMin.clone().add(bMax).multiplyScalar(0.5)
    bMin.z -= 0.05; bMax.z += 0.05
    const size = bMax.clone().sub(bMin)
    this._helperObj.position.copy(center)
    this._helperObj.scale.set(size.x || 0.1, size.y || 0.1, size.z || 0.1)
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  /** Returns hex color for the given place type (grey if null). */
  _colorForType(placeType) {
    const entry = getPlaceTypeEntry(placeType)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  // ── Move support ───────────────────────────────────────────────────────────

  /**
   * Refreshes geometry after entity.move().
   * @param {THREE.Vector3[]} corners
   */
  updateGeometry(corners) {
    if (!corners || corners.length < 3) return
    this._setPoints(corners)
  }

  /** Refreshes BoxHelper after confirm/cancel grab. */
  updateBoxHelper() {
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  // ── Place type (color) update ──────────────────────────────────────────────

  /**
   * Updates ring, fill, and dot color when placeType changes.
   * @param {string|null} placeType
   */
  setPlaceType(placeType) {
    const hex = this._colorForType(placeType)
    this._lineMat.color.setHex(hex)
    this._fillMat.color.setHex(hex)
    this._dotMat.color.setHex(hex)
    this.boxHelper.material?.color.setHex(hex)
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._line.visible     = visible
    this._fillMesh.visible = visible
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
    scene.remove(this._fillMesh)
    scene.remove(this._helperObj)
    scene.remove(this.boxHelper)
    for (const d of this._dots) scene.remove(d)
    this._lineGeo.dispose()
    this._lineMat.dispose()
    if (this._fillGeo) this._fillGeo.dispose()
    this._fillMat.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._dots = []
  }
}
