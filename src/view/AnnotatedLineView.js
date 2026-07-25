/**
 * AnnotatedLineView — renderer for AnnotatedLine domain entities.
 *
 * Renders:
 *  - A Line2 (fat line) connecting all vertices in place-type color; grey when unclassified
 *  - Vertex dot markers (small spheres) at each vertex
 *  - Route: one InstancedMesh carrying comet heads + their trail beads
 *  - Boundary: perpendicular hatch ticks along the wall (drafting convention)
 *  - A BoxHelper for selection highlight
 *
 * Animations — curves live in `MapVisualMath` (pure, tested); ADR-093 replaces
 * the ADR-031 §8 parameters:
 *  - Route:    comets with tapering trails, each head on its own speed and its
 *             own phase, breathing in size along the path (traffic, not a gear).
 *  - Boundary: was explicitly "no animation, static solid line". A crest now
 *             travels along the hatch ticks, lifting each as it passes — the
 *             barrier reads as present without shouting (P3 spatial stagger,
 *             P11 抑制). The slow marching dashes are unchanged.
 *
 * Reduced motion: beads park at their spawn offsets and ticks hold a mid
 * intensity — a populated, directional channel and a legible hatch remain
 * (PHILOSOPHY #30/#11). Preference comes from the ONE boundary
 * (`src/theme/motion.js`), re-read live.
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView
 * so AppController's setMode() and mode-agnostic calls are safe.
 *
 * Note: no `cuboid` property — AnnotatedLine is excluded from raycasting.
 * Move support: updateGeometry(corners) refreshes vertex positions.
 *
 * @see ADR-029, ADR-031, ADR-093
 */
import * as THREE from 'three'
import { Line2 }         from 'three/addons/lines/Line2.js'
import { LineGeometry }  from 'three/addons/lines/LineGeometry.js'
import { LineMaterial }  from 'three/addons/lines/LineMaterial.js'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import {
  phaseFor, entryFrame, routeFlowFrame, boundaryTickFrame,
  ROUTE_HEADS, ROUTE_TRAIL, ROUTE_INSTANCES, BOUNDARY_TICK_SPACING,
} from './MapVisualMath.js'

const DEFAULT_COLOR      = 0x888888   // unclassified grey
const SELECTED_WIDTH     = 4
const UNSELECTED_WIDTH   = 3
const PARTICLE_RADIUS    = 0.12       // world-unit radius; visible at default frustumSize=50
const TICK_LEN_FRAC      = 0.028      // Boundary hatch tick length as a fraction of the
                                      // polyline length — scale-invariant by construction (#27)
const PENDING_OPACITY    = 0.90       // while awaiting confirm (pending state)
const CONFIRMED_OPACITY  = 1.00       // after entity is committed
const BOUNDARY_DASH_SIZE = 0.60       // confirmed Boundary dash length (world units)
const BOUNDARY_GAP_SIZE  = 0.30       // confirmed Boundary gap length (world units)
const BOUNDARY_DASH_SPD  = 0.30       // march speed: world units per second

export class AnnotatedLineView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3[]} points  ordered vertex positions (N ≥ 2)
   * @param {string|null}   placeType  'Route' | 'Boundary' | null
   * @param {THREE.WebGLRenderer} renderer  needed for Line2 resolution
   * @param {THREE.Camera|null}   [camera]   for label projection
   * @param {HTMLElement|null}    [container] DOM element to append the label to
   * @param {string}              [name]     entity name shown in label
   * @param {string|null}         [entityId] owning entity id — the ONLY source of
   *   the per-entity animation phase (ADR-093); omitted → phase 0.
   */
  constructor(scene, points, placeType, renderer, camera = null, container = null, name = '', entityId = null) {
    this._scene    = scene
    this._renderer = renderer
    this._camera   = camera
    this._placeType = placeType
    this._labelPos  = null
    this._phase     = phaseFor(entityId)   // anti-lockstep seed (PHILOSOPHY #31)
    this._reduced   = prefersReducedMotion()
    this._unsubReduced = onReducedMotionChange(r => { this._reduced = r })
    this._bornAt    = null                 // loop-clock seconds at the first tick
    this._isPending = false                // draw state, read by `_baseLineOpacity()`

    // ── Line2 geometry ─────────────────────────────────────────────────────
    this._lineGeo = new LineGeometry()
    this._lineMat = new LineMaterial({
      color:       this._colorForType(placeType),
      linewidth:   UNSELECTED_WIDTH,
      worldUnits:  false,    // linewidth in pixels
      depthTest:   true,
      depthWrite:  false,
      transparent: true,
      opacity:     CONFIRMED_OPACITY,
    })
    this._lineMat.resolution.set(window.innerWidth, window.innerHeight)
    this._line = new Line2(this._lineGeo, this._lineMat)
    this._line.renderOrder = 2
    scene.add(this._line)

    // ── Vertex dots ────────────────────────────────────────────────────────
    // 6×6 segments read as visible hexagons under the Map Mode top-down camera,
    // where these sit dead centre of attention; 16×12 is still a shared geometry
    // (one upload) and the silhouette becomes a clean dot.
    this._dotGeo = new THREE.SphereGeometry(0.06, 16, 12)
    this._dotMat = new THREE.MeshBasicMaterial({
      color:    this._colorForType(placeType),
      depthTest: true,
    })
    /** @type {THREE.Mesh[]} */
    this._dots = []

    // ── Route flow beads (comet heads + trails) ────────────────────────────
    // ONE InstancedMesh for all heads and trail beads = one draw call however
    // many beads (the `_animate` performance guard, same discipline as
    // LandingEffects/CelebrationField). Additive so overlapping beads glow —
    // the beads that used to be flat dots now carry the channel's energy.
    this._partGeo = new THREE.SphereGeometry(PARTICLE_RADIUS, 12, 8)
    this._partMat = new THREE.MeshBasicMaterial({
      color:       this._colorForType(placeType),
      depthTest:   true,
      depthWrite:  false,
      transparent: true,
      opacity:     0.9,
      blending:    THREE.AdditiveBlending,
    })
    /** @type {THREE.InstancedMesh|null} one instance per bead; null until a Route */
    this._beads = null

    // ── Boundary hatch ticks ───────────────────────────────────────────────
    // Per-tick brightness rides a vertex-colour attribute updated IN PLACE each
    // frame (no per-frame allocation — a travelling wave for the cost of one
    // Float32Array write per tick).
    this._tickMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest:    true,
      depthWrite:   false,
      transparent:  true,
      opacity:      0.85,
      blending:     THREE.AdditiveBlending,
    })
    /** @type {THREE.LineSegments|null} */
    this._ticks = null
    /** @type {number[]} arc-length fraction of each tick (drives the wave) */
    this._tickArcs = []
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
    this._labelPos = this._computeLabelPos(points)
  }

  /**
   * Recomputes arc-length segment data and rebuilds the place-type layer:
   * the Route bead InstancedMesh or the Boundary hatch ticks. Called from
   * `_setPoints()` (construction, every move) and `setPlaceType()`.
   * @param {THREE.Vector3[]} points
   */
  _rebuildParticles(points) {
    this._disposeBeads()
    this._disposeTicks()
    this._segments = []
    this._totalLen = 0

    if (!points || points.length < 2) return

    // Pre-compute segments (both layers need arc length)
    for (let i = 0; i < points.length - 1; i++) {
      const len = points[i].distanceTo(points[i + 1])
      this._segments.push({ a: points[i].clone(), b: points[i + 1].clone(), len })
      this._totalLen += len
    }
    if (this._totalLen === 0) return

    if (this._placeType === 'Route') {
      this._beads = new THREE.InstancedMesh(this._partGeo, this._partMat, ROUTE_INSTANCES)
      this._beads.renderOrder = 4
      this._beads.frustumCulled = false   // beads roam the whole polyline
      this._scene.add(this._beads)
      this._writeBeads(0)                 // valid first frame before the loop ticks
    } else if (this._placeType === 'Boundary') {
      this._buildTicks()
    }
  }

  /**
   * Builds the Boundary hatch: one perpendicular tick every
   * `BOUNDARY_TICK_SPACING` of arc length, on the +90° side of the direction of
   * travel (a consistent side is what makes it read as a WALL rather than a
   * railway). Tick length is a fraction of the polyline length, so the hatch
   * looks the same in an mm-scale cell and a 100 m site plan (#27).
   */
  _buildTicks() {
    const count = Math.max(Math.floor(1 / BOUNDARY_TICK_SPACING), 2)
    const tickLen = this._totalLen * TICK_LEN_FRAC
    const positions = new Float32Array(count * 6)
    const colors    = new Float32Array(count * 6)
    const p = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    this._tickArcs = []
    for (let i = 0; i < count; i++) {
      const arc = (i + 0.5) * BOUNDARY_TICK_SPACING
      if (arc >= 1) break
      this._tickArcs.push(arc)
      this._samplePolyline(arc, p, tangent)
      // Perpendicular in the ground plane; ROS Z-up so the normal is (−ty, tx, 0).
      const nx = -tangent.y, ny = tangent.x
      const j = i * 6
      positions[j]     = p.x;                positions[j + 1] = p.y;                positions[j + 2] = p.z
      positions[j + 3] = p.x + nx * tickLen; positions[j + 4] = p.y + ny * tickLen; positions[j + 5] = p.z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3))
    this._ticks = new THREE.LineSegments(geo, this._tickMat)
    this._ticks.renderOrder = 3
    this._scene.add(this._ticks)
    this._writeTicks(0)                    // valid first frame
  }

  /**
   * Samples the polyline at an arc-length fraction.
   * @param {number} frac ∈ [0,1]
   * @param {THREE.Vector3} out position (written)
   * @param {THREE.Vector3} [tangentOut] unit direction of travel (written)
   */
  _samplePolyline(frac, out, tangentOut) {
    const target = frac * this._totalLen
    let cum = 0
    for (const seg of this._segments) {
      if (cum + seg.len >= target) {
        const f = seg.len > 0 ? (target - cum) / seg.len : 0
        out.lerpVectors(seg.a, seg.b, f)
        if (tangentOut) tangentOut.subVectors(seg.b, seg.a).normalize()
        return
      }
      cum += seg.len
    }
    const last = this._segments[this._segments.length - 1]
    out.copy(last.b)
    if (tangentOut) tangentOut.subVectors(last.b, last.a).normalize()
  }

  /** Writes one frame of bead transforms into the instance matrices. */
  _writeBeads(t, entryScale = 1) {
    if (!this._beads) return
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const opts = { direction: this._particleDirection ?? 1, reduced: this._reduced }
    let n = 0
    for (let head = 0; head < ROUTE_HEADS; head++) {
      for (let seg = 0; seg <= ROUTE_TRAIL; seg++) {
        const f = routeFlowFrame(t, head, seg, this._phase, opts)
        this._samplePolyline(f.frac, pos)
        // One shared material = one opacity, so each bead's own alpha rides its
        // scale (the LandingEffects constraint, same workaround).
        scl.setScalar(Math.max(f.scale * f.opacity * entryScale, 0.001))
        m.compose(pos, q, scl)
        this._beads.setMatrixAt(n++, m)
      }
    }
    this._beads.instanceMatrix.needsUpdate = true
  }

  /**
   * Writes one frame of tick brightness into the colour attribute (in place).
   * @param {number} t loop clock (seconds)
   * @param {number} [entryIntensity] entry-envelope multiplier (1 once settled)
   */
  _writeTicks(t, entryIntensity = 1) {
    if (!this._ticks) return
    const attr = this._ticks.geometry.getAttribute('color')
    // The material is white with `vertexColors: true`, so the place-type tint
    // AND the wave both live in this attribute — one owner for the channel (#4).
    const hex = this._colorForType(this._placeType)
    const r = ((hex >> 16) & 0xff) / 255
    const g = ((hex >> 8) & 0xff) / 255
    const b = (hex & 0xff) / 255
    for (let i = 0; i < this._tickArcs.length; i++) {
      const k = boundaryTickFrame(t, this._tickArcs[i], this._phase, this._reduced) * entryIntensity
      // Root end brighter than the tip: the tick reads as attached to the wall.
      attr.setXYZ(i * 2,     r * k,        g * k,        b * k)
      attr.setXYZ(i * 2 + 1, r * k * 0.35, g * k * 0.35, b * k * 0.35)
    }
    attr.needsUpdate = true
  }

  /** Removes and releases the Route bead mesh (#9 — paired with its creation). */
  _disposeBeads() {
    if (!this._beads) return
    this._scene.remove(this._beads)
    this._beads.dispose()          // instance buffers only; geo/mat are view-owned
    this._beads = null
  }

  /** Removes and releases the Boundary hatch ticks (#9). */
  _disposeTicks() {
    if (!this._ticks) return
    this._scene.remove(this._ticks)
    this._ticks.geometry.dispose() // per-polyline geometry; _tickMat is view-owned
    this._ticks = null
    this._tickArcs = []
  }

  /**
   * Returns the arc-length midpoint of the polyline for label placement.
   * @param {THREE.Vector3[]} points
   * @returns {THREE.Vector3|null}
   */
  _computeLabelPos(points) {
    if (!points || points.length < 2) return null
    let total = 0
    for (let i = 0; i < points.length - 1; i++) {
      total += points[i].distanceTo(points[i + 1])
    }
    const half = total * 0.5
    let cum = 0
    for (let i = 0; i < points.length - 1; i++) {
      const segLen = points[i].distanceTo(points[i + 1])
      if (cum + segLen >= half) {
        const t = segLen > 0 ? (half - cum) / segLen : 0
        return points[i].clone().lerp(points[i + 1], t)
      }
      cum += segLen
    }
    return points[points.length - 1].clone()
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
  /**
   * Called when a tact-time link violation is detected (bilateral alarm).
   * Reverses particle flow direction and tints particles red.
   * Sole writer of _particleDirection and particle color (PHILOSOPHY #4).
   * @param {boolean} violated
   */
  setTactViolated(violated) {
    this._particleDirection = violated ? -1 : 1
    const color = violated ? 0xEF4444 : this._colorForType(this._placeType)
    this._partMat.color.setHex(color)
  }

  tick(t) {
    if (!this._line.visible) return
    if (this._bornAt === null) this._bornAt = t
    if (this._segments.length === 0 || this._totalLen === 0) return

    // Entry: the line's own opacity rises on an eased curve and its beads/ticks
    // grow in with it, so a newly drawn annotation ARRIVES instead of blinking.
    const entry = entryFrame(t, this._bornAt, this._reduced)
    this._lineMat.opacity = this._baseLineOpacity() * entry.opacity
    for (const d of this._dots) d.scale.setScalar(entry.scale)

    if (this._placeType === 'Route') {
      this._writeBeads(t, entry.scale)
    } else if (this._placeType === 'Boundary') {
      // Marching-ants: animate dashOffset for a slow "boundary tape" effect.
      // Reduced motion parks the dashes; the dash PATTERN (the information) stays.
      if (!this._reduced) {
        const cycle = BOUNDARY_DASH_SIZE + BOUNDARY_GAP_SIZE
        this._lineMat.dashOffset = -((t * BOUNDARY_DASH_SPD) % cycle)
      }
      this._writeTicks(t, entry.opacity)
    }
  }

  /**
   * Line opacity for the current draw state — the single definition (#4). `tick()`
   * writes `_lineMat.opacity` every frame (base × entry envelope), so the draw
   * state must be readable as data, not inferred from the material it writes.
   */
  _baseLineOpacity() {
    return this._isPending ? PENDING_OPACITY : CONFIRMED_OPACITY
  }

  // ── Label update (call once per frame while visible) ──────────────────────

  /**
   * Projects the arc-length midpoint of the polyline to screen and updates label position.
   * Must be called from the animation loop while visible.
   * @param {import('three').Camera} [camera]  Active camera (orthographic in Map mode).
   */
  updateLabelPosition(camera) {
    if (!this._label || !this._labelPos) return
    const cam = camera ?? this._camera
    if (!cam || !this._renderer || !this._line.visible) return
    const ndc    = this._labelPos.clone().project(cam)
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
    if (this._label) {
      const hexStr = hex.toString(16).padStart(6, '0')
      this._label.style.borderLeft = `3px solid #${hexStr}`
    }
    // Boundary: confirmed style uses slow-marching dashes (marching-ants animation)
    if (placeType === 'Boundary') {
      this._lineMat.dashed   = true
      this._lineMat.dashSize = BOUNDARY_DASH_SIZE
      this._lineMat.gapSize  = BOUNDARY_GAP_SIZE
    } else {
      this._lineMat.dashed   = false
      this._lineMat.dashSize = 1000
      this._lineMat.gapSize  = 0
    }
    this._lineMat.needsUpdate = true
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
    this._isPending        = pending
    this._lineMat.dashed   = pending
    this._lineMat.dashSize = pending ? 0.40 : 1000
    this._lineMat.gapSize  = pending ? 0.20 : 0
    this._lineMat.opacity  = this._baseLineOpacity()
    this._lineMat.needsUpdate = true
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._line.visible = visible
    for (const d of this._dots) d.visible = visible
    if (this._beads) this._beads.visible = visible
    if (this._ticks) this._ticks.visible = visible
    if (!visible) {
      this.boxHelper.visible = false
      if (this._label) this._label.style.display = 'none'
    }
    // Re-arm the entry pop: a re-shown annotation (undo of a soft delete) is a
    // boundary moment too, owned here rather than at the undo call site (#4).
    if (visible) this._bornAt = null
  }

  setObjectSelected(sel) {
    this.boxHelper.visible = sel
    this._lineMat.linewidth = sel ? SELECTED_WIDTH : UNSELECTED_WIDTH
    if (sel) this.boxHelper.update()
  }

  /** True when the line is shown in the scene (false when soft-deleted). */
  get visible() { return this._line.visible }

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
    this._unsubReduced()
    scene.remove(this._line)
    scene.remove(this._helperObj)
    scene.remove(this.boxHelper)
    for (const d of this._dots) scene.remove(d)
    this._disposeBeads()
    this._disposeTicks()
    this._lineGeo.dispose()
    this._lineMat.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._partGeo.dispose()
    this._partMat.dispose()
    this._tickMat.dispose()
    this._dots      = []
    this._segments  = []
    if (this._label) this._label.remove()
  }
}
