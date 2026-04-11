/**
 * AnnotatedLineView — renderer for AnnotatedLine domain entities.
 *
 * Renders:
 *  - A Line2 (fat line) connecting all vertices in place-type color; grey when unclassified
 *  - Vertex dot markers (small spheres) at each vertex
 *  - A BoxHelper for selection highlight
 *
 * Animations (called via tick(t) each frame):
 *  - Route:    4 small particles flow along the polyline (traffic / data-flow feel)
 *  - Boundary: none — static solid line conveys "barrier / wall" semantics
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView
 * so AppController's setMode() and mode-agnostic calls are safe.
 *
 * Note: no `cuboid` property — AnnotatedLine is excluded from raycasting.
 * Move support: updateGeometry(corners) refreshes vertex positions.
 *
 * @see ADR-029
 */
import * as THREE from 'three'
import { Line2 }         from 'three/addons/lines/Line2.js'
import { LineGeometry }  from 'three/addons/lines/LineGeometry.js'
import { LineMaterial }  from 'three/addons/lines/LineMaterial.js'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'

const DEFAULT_COLOR    = 0x888888   // unclassified grey
const SELECTED_WIDTH   = 4
const UNSELECTED_WIDTH = 2
const PARTICLE_COUNT   = 4          // flowing dots per Route line
const PARTICLE_RADIUS  = 0.045
const PARTICLE_SPEED   = 0.22       // fraction of total line length per second
const DRAWING_OPACITY  = 0.70       // while rubber-band preview (drawing state)
const PENDING_OPACITY  = 0.90       // while awaiting confirm (pending state)
const CONFIRMED_OPACITY = 1.00      // after entity is committed

export class AnnotatedLineView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3[]} points  ordered vertex positions (N ≥ 2)
   * @param {string|null}   placeType  'Route' | 'Boundary' | null
   * @param {THREE.WebGLRenderer} renderer  needed for Line2 resolution
   */
  constructor(scene, points, placeType, renderer) {
    this._scene    = scene
    this._renderer = renderer
    this._placeType = placeType

    // ── Line2 geometry ─────────────────────────────────────────────────────
    this._lineGeo = new LineGeometry()
    this._lineMat = new LineMaterial({
      color:       this._colorForType(placeType),
      linewidth:   UNSELECTED_WIDTH,
      worldUnits:  false,    // linewidth in pixels
      depthTest:   false,
      transparent: true,
      opacity:     CONFIRMED_OPACITY,
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
      color:    this._colorForType(placeType),
      depthTest: false,
    })
    /** @type {THREE.Mesh[]} */
    this._dots = []

    // ── Route flowing particles ────────────────────────────────────────────
    // Shared geometry / material reused across all particles for this line.
    this._partGeo = new THREE.SphereGeometry(PARTICLE_RADIUS, 6, 6)
    this._partMat = new THREE.MeshBasicMaterial({
      color:       this._colorForType(placeType),
      depthTest:   false,
      transparent: true,
      opacity:     0.85,
    })
    /** @type {THREE.Mesh[]} */
    this._particles = []
    /**
     * Pre-computed segment data for the current polyline.
     * @type {Array<{ a: THREE.Vector3, b: THREE.Vector3, len: number }>}
     */
    this._segments  = []
    this._totalLen  = 0
    /** @type {THREE.Vector3[]} last known points (for setPlaceType particle rebuild) */
    this._points    = []

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
    this._points = points ?? []    // snapshot for later particle rebuilds

    // Remove old dots
    for (const d of this._dots) {
      this._scene.remove(d)
    }
    this._dots = []

    if (!points || points.length < 2) {
      this._rebuildParticles([])
      return
    }

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
    this._rebuildParticles(points)
  }

  /**
   * Recomputes segment data and rebuilds particle meshes for Route animation.
   * @param {THREE.Vector3[]} points
   */
  _rebuildParticles(points) {
    // Remove existing particles from scene
    for (const p of this._particles) this._scene.remove(p)
    this._particles = []
    this._segments  = []
    this._totalLen  = 0

    if (this._placeType !== 'Route' || !points || points.length < 2) return

    // Pre-compute segments
    for (let i = 0; i < points.length - 1; i++) {
      const len = points[i].distanceTo(points[i + 1])
      this._segments.push({ a: points[i].clone(), b: points[i + 1].clone(), len })
      this._totalLen += len
    }

    // Create particles with evenly staggered start offsets
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mesh = new THREE.Mesh(this._partGeo, this._partMat)
      mesh.renderOrder = 4
      mesh._tOffset = i / PARTICLE_COUNT  // stagger around the loop
      this._scene.add(mesh)
      this._particles.push(mesh)
    }
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

  /** Returns hex color for the given place type (grey if null). */
  _colorForType(placeType) {
    const entry = getPlaceTypeEntry(placeType)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  // ── Per-frame animation ────────────────────────────────────────────────────

  /**
   * Drives Route particle animation.  Called every frame from AppController.
   * @param {number} t  elapsed seconds (performance.now() / 1000)
   */
  tick(t) {
    if (!this._line.visible || this._placeType !== 'Route') return
    if (this._segments.length === 0 || this._totalLen === 0) return

    for (const mesh of this._particles) {
      // Each particle travels the full polyline length continuously.
      const frac = ((mesh._tOffset + t * PARTICLE_SPEED) % 1 + 1) % 1
      const targetDist = frac * this._totalLen

      let cumLen = 0
      let placed = false
      for (const seg of this._segments) {
        if (cumLen + seg.len >= targetDist) {
          const segFrac = seg.len > 0 ? (targetDist - cumLen) / seg.len : 0
          mesh.position.lerpVectors(seg.a, seg.b, segFrac)
          placed = true
          break
        }
        cumLen += seg.len
      }
      if (!placed) {
        // Floating-point edge: snap to last segment endpoint
        mesh.position.copy(this._segments[this._segments.length - 1].b)
      }
    }
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

  // ── Place type (color) update ──────────────────────────────────────────────

  /**
   * Updates line and dot color when placeType changes.
   * @param {string|null} placeType
   */
  setPlaceType(placeType) {
    this._placeType = placeType
    const hex = this._colorForType(placeType)
    this._lineMat.color.setHex(hex)
    this._dotMat.color.setHex(hex)
    this._partMat.color.setHex(hex)
    this.boxHelper.material?.color.setHex(hex)
    // Rebuild particles now that the place type is known (fixes Route particle bug:
    // particles were never created when setPlaceType was called after construction).
    this._rebuildParticles(this._points)
  }

  /**
   * Switches the line to dashed (pending) or solid (drawing/confirmed) style.
   * Called by AppController when the map draw-state changes.
   * @param {boolean} pending
   */
  setPending(pending) {
    this._lineMat.dashed   = pending
    this._lineMat.dashSize = pending ? 0.40 : 1000
    this._lineMat.gapSize  = pending ? 0.20 : 0
    this._lineMat.opacity  = pending ? PENDING_OPACITY : CONFIRMED_OPACITY
    this._lineMat.needsUpdate = true
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._line.visible = visible
    for (const d of this._dots)     d.visible = visible
    for (const p of this._particles) p.visible = visible
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
    for (const d of this._dots)     scene.remove(d)
    for (const p of this._particles) scene.remove(p)
    this._lineGeo.dispose()
    this._lineMat.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._partGeo.dispose()
    this._partMat.dispose()
    this._dots      = []
    this._particles = []
    this._segments  = []
  }
}
