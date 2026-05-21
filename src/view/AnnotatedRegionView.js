/**
 * AnnotatedRegionView — renderer for AnnotatedRegion domain entities.
 *
 * Architecture: all visual components are children of a single THREE.Group
 * positioned at the polygon centroid. This prevents edge/fill separation during
 * entity movement — each move just updates group.position and rebuilds local
 * geometry; no per-component world-position bookkeeping is needed.
 *
 * Renders:
 *  - A Line2 (fat line) as a closed ring in place-type color
 *  - A translucent fill mesh (ShapeGeometry in centroid-local XY plane)
 *  - Vertex dot markers (small spheres) at each vertex
 *  - A BoxHelper for selection highlight
 *  - Two rim rings (Zone only) that pulse outward in 180°-offset phases
 *
 * Animations (called via tick(t) each frame):
 *  - Pending boundary: dashOffset scrolls — "marching ants" flow effect
 *  - Zone: fill opacity breathes on a ~4 s cycle (faster when selected)
 *  - Zone: two rim rings pulse with half-cycle phase offset (continuous wave)
 *
 * @see ADR-029, ADR-031
 */
import * as THREE from 'three'
import { Line2 }         from 'three/addons/lines/Line2.js'
import { LineGeometry }  from 'three/addons/lines/LineGeometry.js'
import { LineMaterial }  from 'three/addons/lines/LineMaterial.js'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'

const DEFAULT_COLOR      = 0x888888
const FILL_OPACITY       = 0.40          // confirmed default (mid-range)
const FILL_OPACITY_MIN   = 0.15          // breathing animation lower bound (ADR-031 §8)
const FILL_OPACITY_MAX   = 0.65          // breathing animation upper bound (ADR-031 §8)
const RIM_OPACITY_MAX    = 0.40          // rim ring start opacity (ADR-031 §8)
const SELECTED_WIDTH     = 4
const UNSELECTED_WIDTH   = 2
const CONFIRMED_OPACITY  = 1.00
const PENDING_OPACITY    = 0.90
const RIM_PULSE_DURATION = 3.0           // seconds per rim ring cycle

export class AnnotatedRegionView {
  /**
   * @param {THREE.Scene}         scene
   * @param {THREE.Vector3[]}     points     ordered ring positions (N ≥ 3, implicitly closed)
   * @param {string|null}         placeType  'Zone' | null
   * @param {THREE.WebGLRenderer} renderer   needed for Line2 resolution
   * @param {THREE.Camera|null}   [camera]   for label projection
   * @param {HTMLElement|null}    [container] DOM element to append the label to
   * @param {string}              [name]     entity name shown in label
   */
  constructor(scene, points, placeType, renderer, camera = null, container = null, name = '') {
    this._scene      = scene
    this._renderer   = renderer
    this._camera     = camera
    this._placeType  = placeType
    this._isSelected = false
    this._isPending  = false

    // Parent group — its world position = polygon centroid.  Every child uses
    // centroid-relative local coordinates so group.position is the single
    // authority for world placement; no component can drift independently.
    this._group = new THREE.Group()
    scene.add(this._group)

    // ── Line2 (closed ring) ────────────────────────────────────────────────
    this._lineGeo = new LineGeometry()
    this._lineMat = new LineMaterial({
      color:       this._colorForType(placeType),
      linewidth:   UNSELECTED_WIDTH,
      worldUnits:  false,
      depthTest:   true,
      depthWrite:  false,
      transparent: true,
      opacity:     CONFIRMED_OPACITY,
    })
    this._lineMat.resolution.set(window.innerWidth, window.innerHeight)
    this._line = new Line2(this._lineGeo, this._lineMat)
    this._line.renderOrder = 2
    this._group.add(this._line)

    // ── Fill mesh (placeholder — replaced in _setPoints) ───────────────────
    // THREE.Mesh(null, mat) throws in r172 because updateMorphTargets() reads
    // geometry.morphAttributes; use empty BufferGeometry as safe placeholder.
    this._fillGeo = new THREE.BufferGeometry()
    this._fillMat = new THREE.MeshBasicMaterial({
      color:              this._colorForType(placeType),
      transparent:        true,
      opacity:            FILL_OPACITY,
      depthTest:          true,
      depthWrite:         false,
      side:               THREE.DoubleSide,
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    })
    this._fillMesh = new THREE.Mesh(this._fillGeo, this._fillMat)
    this._fillMesh.renderOrder = 1
    this._group.add(this._fillMesh)

    // ── Vertex dots ────────────────────────────────────────────────────────
    this._dotGeo = new THREE.SphereGeometry(0.07, 6, 6)
    this._dotMat = new THREE.MeshBasicMaterial({
      color:     this._colorForType(placeType),
      depthTest: true,
    })
    /** @type {THREE.Mesh[]} */
    this._dots = []

    // ── Rim rings (Zone only, dual-wave pulse) ─────────────────────────────
    // Two rings share one geometry but have independent materials so their
    // opacities can be animated at 180° phase offset for a continuous double-
    // wave effect.  Placeholder geometry — replaced in _setPoints.
    this._rimGeo  = new THREE.BufferGeometry()
    this._rimMat1 = new THREE.MeshBasicMaterial({
      color:              this._colorForType(placeType),
      depthTest:          true,
      depthWrite:         false,
      transparent:        true,
      opacity:            0,
      side:               THREE.DoubleSide,
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    })
    this._rimRing1 = new THREE.Mesh(this._rimGeo, this._rimMat1)
    this._rimRing1.renderOrder = 1
    this._rimRing1.visible = (placeType === 'Zone')
    this._group.add(this._rimRing1)

    this._rimMat2 = this._rimMat1.clone()
    this._rimRing2 = new THREE.Mesh(this._rimGeo, this._rimMat2)
    this._rimRing2.renderOrder = 1
    this._rimRing2.visible = (placeType === 'Zone')
    this._group.add(this._rimRing2)

    // ── BoxHelper ──────────────────────────────────────────────────────────
    // _helperObj is a child of the group (inherits centroid transform).
    // BoxHelper itself is added to the root scene so it always renders.
    this._helperObj = new THREE.Object3D()
    this._group.add(this._helperObj)
    this.boxHelper = new THREE.BoxHelper(this._helperObj, 0xffffff)
    this.boxHelper.visible = false
    scene.add(this.boxHelper)

    // ── HTML name label ────────────────────────────────────────────────────
    this._label = null
    if (container) {
      this._label = document.createElement('div')
      const hexStr = this._colorForType(placeType).toString(16).padStart(6, '0')
      Object.assign(this._label.style, {
        position:      'fixed',
        pointerEvents: 'none',
        userSelect:    'none',
        background:    'rgba(20, 20, 20, 0.80)',
        color:         '#e0e0e0',
        fontSize:      '11px',
        fontFamily:    'sans-serif',
        padding:       '1px 5px',
        borderRadius:  '3px',
        whiteSpace:    'nowrap',
        display:       'none',
        zIndex:        '50',
        borderLeft:    `3px solid #${hexStr}`,
      })
      this._label.textContent = name
      container.appendChild(this._label)
    }

    // ── Set initial geometry ───────────────────────────────────────────────
    this._setPoints(points)
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  /**
   * Rebuilds all geometry in centroid-local space and repositions the group.
   * Called on construction and on every entity.move() during drag.
   * @param {THREE.Vector3[]} points  world-space vertex positions
   */
  _setPoints(points) {
    for (const d of this._dots) this._group.remove(d)
    this._dots = []

    if (!points || points.length < 3) return

    // Compute centroid → group world position (single authority for placement).
    // Using the average of polygon vertices is acceptable here because this is
    // a display offset, not a solver/physics computation (PHILOSOPHY #24 note:
    // this value does NOT feed back into any per-frame calculation).
    const centroid = new THREE.Vector3()
    for (const p of points) centroid.add(p)
    centroid.divideScalar(points.length)
    this._group.position.copy(centroid)

    // All geometry in centroid-relative local space.
    const localPts = points.map(p => new THREE.Vector3().subVectors(p, centroid))

    // Closed ring for Line2 (repeat first point)
    const flat = []
    for (const lp of localPts) { flat.push(lp.x, lp.y, lp.z) }
    flat.push(localPts[0].x, localPts[0].y, localPts[0].z)
    this._lineGeo.setPositions(flat)
    this._line.computeLineDistances()

    // Fill: ShapeGeometry in local XY plane
    if (this._fillGeo) { this._fillGeo.dispose(); this._fillGeo = null }
    const fillShape = new THREE.Shape(localPts.map(lp => new THREE.Vector2(lp.x, lp.y)))
    this._fillGeo = new THREE.ShapeGeometry(fillShape)
    this._fillMesh.geometry = this._fillGeo

    // Vertex dots at local positions
    for (const lp of localPts) {
      const dot = new THREE.Mesh(this._dotGeo, this._dotMat)
      dot.position.copy(lp)
      dot.renderOrder = 2
      this._group.add(dot)
      this._dots.push(dot)
    }

    // Rim rings: polygon-shaped ShapeGeometry with inner hole at 92% toward
    // centroid to form a thin ring matching the Zone boundary shape.
    // Both rings share the same geometry; scale animation in tick() expands
    // each ring outward from local origin (= centroid in world space).
    if (this._rimGeo) { this._rimGeo.dispose(); this._rimGeo = null }
    const relPts = localPts.map(lp => new THREE.Vector2(lp.x, lp.y))
    const outerShape = new THREE.Shape()
    outerShape.moveTo(relPts[0].x, relPts[0].y)
    for (let i = 1; i < relPts.length; i++) outerShape.lineTo(relPts[i].x, relPts[i].y)
    outerShape.closePath()
    const innerHole = new THREE.Path()
    innerHole.moveTo(relPts[0].x * 0.92, relPts[0].y * 0.92)
    for (let i = 1; i < relPts.length; i++) innerHole.lineTo(relPts[i].x * 0.92, relPts[i].y * 0.92)
    innerHole.closePath()
    outerShape.holes.push(innerHole)
    this._rimGeo = new THREE.ShapeGeometry(outerShape)
    this._rimRing1.geometry = this._rimGeo
    this._rimRing1.position.set(0, 0, 0)
    this._rimRing1.scale.setScalar(1)
    this._rimRing2.geometry = this._rimGeo
    this._rimRing2.position.set(0, 0, 0)
    this._rimRing2.scale.setScalar(1)

    this._updateBoxHelper(localPts)
  }

  /**
   * Refreshes BoxHelper bounding volume from centroid-local vertex positions.
   * @param {THREE.Vector3[]} localPts  centroid-relative positions
   */
  _updateBoxHelper(localPts) {
    if (!localPts || localPts.length === 0) return
    const bMin = new THREE.Vector3( Infinity,  Infinity,  Infinity)
    const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    for (const lp of localPts) { bMin.min(lp); bMax.max(lp) }
    const center = bMin.clone().add(bMax).multiplyScalar(0.5)
    bMin.z -= 0.05; bMax.z += 0.05
    const size = bMax.clone().sub(bMin)
    // _helperObj is in group-local space; center is already local.
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
   * Drives pending-line scroll, Zone fill breathing, and dual rim ring pulse.
   * Called every frame from the AppController animation loop.
   * @param {number} t  elapsed seconds (performance.now() / 1000)
   */
  tick(t) {
    if (!this._group.visible) return

    // Pending boundary: scroll dashOffset for "marching ants" flow.
    // dashOffset is a shader uniform — no needsUpdate required.
    if (this._isPending && this._lineMat.dashed) {
      this._lineMat.dashOffset = -(t * 2.0)
    }

    if (this._placeType !== 'Zone') return

    // Fill breathing: slightly faster and brighter when selected
    const freq   = this._isSelected ? Math.PI * 1.2 : Math.PI * 0.5
    const breath = (Math.sin(t * freq) + 1) * 0.5
    const lo     = this._isSelected ? FILL_OPACITY_MIN + 0.08 : FILL_OPACITY_MIN
    const hi     = this._isSelected ? FILL_OPACITY_MAX         : FILL_OPACITY_MAX
    this._fillMat.opacity = lo + breath * (hi - lo)

    // Dual rim ring pulse: two waves at 180° phase offset.
    // Each ring's outer edge expands from 1.0× to 1.10× while fading.
    // Math.pow(1 - phase, 2) gives ease-out fade (slow at start, fast at end).
    const phase1 = (t % RIM_PULSE_DURATION) / RIM_PULSE_DURATION
    this._rimRing1.scale.setScalar(1.0 + phase1 * 0.10)
    this._rimMat1.opacity = RIM_OPACITY_MAX * Math.pow(1 - phase1, 2)

    const phase2 = ((t + RIM_PULSE_DURATION * 0.5) % RIM_PULSE_DURATION) / RIM_PULSE_DURATION
    this._rimRing2.scale.setScalar(1.0 + phase2 * 0.10)
    this._rimMat2.opacity = RIM_OPACITY_MAX * Math.pow(1 - phase2, 2)
  }

  // ── Label update (call once per frame while visible) ──────────────────────

  /**
   * Projects the region centroid to screen and updates label position.
   * Must be called from the animation loop while visible.
   * @param {import('three').Camera} [camera]  Active camera (orthographic in Map mode).
   */
  updateLabelPosition(camera) {
    if (!this._label) return
    const cam = camera ?? this._camera
    if (!cam || !this._renderer || !this._group.visible) return
    const worldPos = new THREE.Vector3()
    this._group.getWorldPosition(worldPos)
    const ndc    = worldPos.project(cam)
    const canvas = this._renderer.domElement
    const rect   = canvas.getBoundingClientRect()
    const sx = (ndc.x  + 1) / 2 * rect.width  + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top

    if (ndc.z > 1) { this._label.style.display = 'none'; return }

    this._label.style.display = 'block'
    this._label.style.left    = `${Math.round(sx + 4)}px`
    this._label.style.top     = `${Math.round(sy - 10)}px`
  }

  /** Updates the label text (e.g. after rename). */
  setName(name) {
    if (this._label) this._label.textContent = name
  }

  // ── Move support ───────────────────────────────────────────────────────────

  /**
   * Refreshes geometry after entity.move() during drag or after undo/redo.
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
    this._placeType = placeType
    const hex = this._colorForType(placeType)
    this._lineMat.color.setHex(hex)
    this._fillMat.color.setHex(hex)
    this._dotMat.color.setHex(hex)
    this._rimMat1.color.setHex(hex)
    this._rimMat2.color.setHex(hex)
    this.boxHelper.material?.color.setHex(hex)
    this._fillMat.opacity = FILL_OPACITY
    const isZone = placeType === 'Zone'
    this._rimRing1.visible = isZone
    this._rimRing2.visible = isZone
    if (this._label) {
      const hexStr = hex.toString(16).padStart(6, '0')
      this._label.style.borderLeft = `3px solid #${hexStr}`
    }
  }

  /**
   * Switches the boundary ring to dashed-scrolling (pending) or solid (confirmed).
   * @param {boolean} pending
   */
  setPending(pending) {
    this._isPending        = pending
    this._lineMat.dashed   = pending
    this._lineMat.dashSize = pending ? 0.40 : 1000
    this._lineMat.gapSize  = pending ? 0.20 : 0
    this._lineMat.opacity  = pending ? PENDING_OPACITY : CONFIRMED_OPACITY
    if (!pending) this._lineMat.dashOffset = 0
    this._lineMat.needsUpdate = true
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._group.visible = visible
    if (!visible) {
      this.boxHelper.visible = false
      if (this._label) this._label.style.display = 'none'
    }
  }

  setObjectSelected(sel) {
    this._isSelected        = sel
    this.boxHelper.visible  = sel
    this._lineMat.linewidth = sel ? SELECTED_WIDTH : UNSELECTED_WIDTH
    if (sel)  this.boxHelper.update()
    if (!sel) this._fillMat.opacity = FILL_OPACITY
  }

  /** True when the region is shown in the scene (false when soft-deleted). */
  get visible() { return this._group.visible }

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
    scene.remove(this._group)   // removes group + all its children
    scene.remove(this.boxHelper)
    this._lineGeo.dispose()
    this._lineMat.dispose()
    if (this._fillGeo) this._fillGeo.dispose()
    this._fillMat.dispose()
    if (this._rimGeo) this._rimGeo.dispose()  // shared by rimRing1 + rimRing2
    this._rimMat1.dispose()
    this._rimMat2.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._dots = []
    if (this._label) this._label.remove()
  }
}
