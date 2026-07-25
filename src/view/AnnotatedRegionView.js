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
 *  - A drifting drafting-hatch layer over the fill (Zone only)
 *  - Vertex dot markers (small spheres) at each vertex
 *  - L-shaped corner ticks at each vertex (drafting registration marks)
 *  - A BoxHelper for selection highlight
 *  - Two rim rings (Zone only) that pulse outward in 180°-offset phases
 *
 * Animations — curves live in `MapVisualMath` (pure, tested); ADR-093 revises the
 * ADR-031 §8 parameters:
 *  - Pending boundary: dashOffset scrolls — "marching ants" flow effect
 *  - Zone: fill opacity breathes on `breathe()` (sin², seamless at the loop) on a
 *    PER-ENTITY phase, in a narrower band than ADR-031 §8's 0.15–0.65 — the hatch
 *    and the eased rim now carry the "area" reading, so a heavy wash only hid the
 *    geometry underneath (P11 抑制)
 *  - Zone: two rim rings, radius eased outward (easeOutCubic) against a quadratic
 *    alpha tail, half a cycle apart
 *  - Zone: the hatch drifts slowly — an authored area, not a poured one
 *
 * Reduced motion: the hatch freezes, the fill parks mid-band, one rim ring holds
 * mid-flight — the area stays fully legible (PHILOSOPHY #30/#11). Preference from
 * the ONE boundary (`src/theme/motion.js`), re-read live.
 *
 * @see ADR-029, ADR-031, ADR-093
 */
import * as THREE from 'three'
import { Line2 }         from 'three/addons/lines/Line2.js'
import { LineGeometry }  from 'three/addons/lines/LineGeometry.js'
import { LineMaterial }  from 'three/addons/lines/LineMaterial.js'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { hatchTexture } from './DecalTextures.js'
import {
  phaseFor, entryFrame, zoneFillFrame, zoneRimFrame, hatchOffset,
  ZONE_RIM_RINGS, ZONE_RIM_PERIOD, ZONE_FILL_MIN, ZONE_FILL_MAX,
} from './MapVisualMath.js'

const DEFAULT_COLOR      = 0x888888
const FILL_OPACITY       = (ZONE_FILL_MIN + ZONE_FILL_MAX) * 0.5   // static default = band midpoint
const SELECTED_WIDTH     = 4
const UNSELECTED_WIDTH   = 2
const CONFIRMED_OPACITY  = 1.00
const PENDING_OPACITY    = 0.90
const RIM_PULSE_DURATION = ZONE_RIM_PERIOD   // seconds per rim ring cycle
const HATCH_LINES        = 14            // hatch repetitions across the region's larger side
const CORNER_TICK_FRAC   = 0.06          // corner mark arm length as a fraction of the bbox diagonal

export class AnnotatedRegionView {
  /**
   * @param {THREE.Scene}         scene
   * @param {THREE.Vector3[]}     points     ordered ring positions (N ≥ 3, implicitly closed)
   * @param {string|null}         placeType  'Zone' | null
   * @param {THREE.WebGLRenderer} renderer   needed for Line2 resolution
   * @param {THREE.Camera|null}   [camera]   for label projection
   * @param {HTMLElement|null}    [container] DOM element to append the label to
   * @param {string}              [name]     entity name shown in label
   * @param {string|null}         [entityId] owning entity id — the ONLY source of
   *   the per-entity animation phase (ADR-093); omitted → phase 0.
   */
  constructor(scene, points, placeType, renderer, camera = null, container = null, name = '', entityId = null) {
    this._scene      = scene
    this._renderer   = renderer
    this._camera     = camera
    this._placeType  = placeType
    this._isSelected = false
    this._isPending  = false
    this._phase      = phaseFor(entityId)   // anti-lockstep seed (PHILOSOPHY #31)
    this._reduced    = prefersReducedMotion()
    this._unsubReduced = onReducedMotionChange(r => { this._reduced = r })
    this._bornAt     = null                 // loop-clock seconds at the first tick

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

    // ── Hatch layer (Zone only) ────────────────────────────────────────────
    // The Blueprint device: a flat wash says "coloured in", diagonal hatch says
    // "authored area" — and a slow drift keeps it alive without touching the
    // fill's opacity channel (#4: one owner per channel). Shares the fill's
    // ShapeGeometry, whose UVs are the shape's own local XY, so `repeat` set
    // from the region's bbox gives a constant hatch pitch per region at ANY
    // scene scale (#27). The texture is a caller-owned clone — disposed below.
    this._hatchTex = hatchTexture()
    this._hatchMat = new THREE.MeshBasicMaterial({
      map:                this._hatchTex,
      color:              this._colorForType(placeType),
      transparent:        true,
      opacity:            0,
      depthTest:          true,
      depthWrite:         false,
      blending:           THREE.AdditiveBlending,
      side:               THREE.DoubleSide,
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -5,   // one step ahead of the fill so it never z-fights it
      fog:                false,
    })
    this._hatchMesh = new THREE.Mesh(this._fillGeo, this._hatchMat)
    this._hatchMesh.renderOrder = 2
    this._hatchMesh.visible = (placeType === 'Zone')
    this._group.add(this._hatchMesh)

    // ── Vertex dots ────────────────────────────────────────────────────────
    // 6×6 segments read as hexagons in the top-down Map camera (see the same
    // note in AnnotatedLineView); one shared geometry, so 16×12 is free.
    this._dotGeo = new THREE.SphereGeometry(0.07, 16, 12)
    this._dotMat = new THREE.MeshBasicMaterial({
      color:     this._colorForType(placeType),
      depthTest: true,
    })
    /** @type {THREE.Mesh[]} */
    this._dots = []

    // ── Corner registration ticks ──────────────────────────────────────────
    // Two short arms at each vertex, along the incoming and outgoing edges — the
    // drafting mark that makes a polygon read as a DEFINED boundary rather than a
    // shape someone dragged. Static information (never animated), one geometry
    // rebuilt with the ring.
    this._cornerMat = new THREE.LineBasicMaterial({
      color:       this._colorForType(placeType),
      depthTest:   true,
      depthWrite:  false,
      transparent: true,
      opacity:     0.85,
    })
    /** @type {THREE.LineSegments|null} */
    this._corners = null

    // ── Rim rings (Zone only, dual-wave pulse) ─────────────────────────────
    // Two rings share one geometry but have independent materials so their
    // opacities can be animated at 180° phase offset for a continuous double-
    // wave effect.  Placeholder geometry — replaced in _setPoints.
    this._rimGeo = new THREE.BufferGeometry()
    /** @type {Array<{mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial}>} */
    this._rims = []
    for (let i = 0; i < ZONE_RIM_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color:              this._colorForType(placeType),
        depthTest:          true,
        depthWrite:         false,
        transparent:        true,
        opacity:            0,
        side:               THREE.DoubleSide,
        blending:           THREE.AdditiveBlending, // the aura glows where rings cross
        polygonOffset:      true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      })
      const mesh = new THREE.Mesh(this._rimGeo, mat)
      mesh.renderOrder = 1
      mesh.visible = (placeType === 'Zone')
      this._group.add(mesh)
      this._rims.push({ mesh, mat })
    }

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
    // The hatch shares the fill geometry (and therefore its UVs = local XY).
    this._hatchMesh.geometry = this._fillGeo
    this._applyHatchScale(localPts)

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
    for (const r of this._rims) {
      r.mesh.geometry = this._rimGeo
      r.mesh.position.set(0, 0, 0)
      r.mesh.scale.setScalar(1)
    }

    this._buildCornerTicks(localPts)
    this._updateBoxHelper(localPts)
  }

  /**
   * Sets the hatch texture `repeat` so the pattern crosses the region about
   * `HATCH_LINES` times regardless of the region's world size — the hatch pitch
   * is then a property of the ENTITY, not of the scene's unit scale (#27; a
   * world-unit pitch is invisible in an mm-scale cell and a solid block in a
   * site plan). ShapeGeometry's UVs are the local XY coordinates, so `repeat` is
   * `HATCH_LINES / extent`.
   * @param {THREE.Vector3[]} localPts centroid-relative vertices
   */
  _applyHatchScale(localPts) {
    let ext = 0
    for (const lp of localPts) ext = Math.max(ext, Math.abs(lp.x), Math.abs(lp.y))
    const span = Math.max(ext * 2, 1e-6)
    const rep = HATCH_LINES / span
    this._hatchTex.repeat.set(rep, rep)
  }

  /**
   * Rebuilds the corner registration ticks: at each vertex, one short arm toward
   * the previous vertex and one toward the next. Arm length scales with the
   * polygon's own extent (#27 again) and is capped at a third of the shorter
   * adjacent edge so small polygons do not turn into solid outlines.
   * @param {THREE.Vector3[]} localPts centroid-relative vertices
   */
  _buildCornerTicks(localPts) {
    if (this._corners) {
      this._group.remove(this._corners)
      this._corners.geometry.dispose()
      this._corners = null
    }
    const n = localPts.length
    if (n < 3) return
    let ext = 0
    for (const lp of localPts) ext = Math.max(ext, Math.abs(lp.x), Math.abs(lp.y))
    const nominal = Math.max(ext * 2, 1e-6) * CORNER_TICK_FRAC * Math.SQRT2
    const pos = new Float32Array(n * 2 * 6)   // 2 arms × 2 vertices × xyz
    let k = 0
    const dir = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const here = localPts[i]
      for (const other of [localPts[(i - 1 + n) % n], localPts[(i + 1) % n]]) {
        dir.subVectors(other, here)
        const edge = dir.length()
        if (edge < 1e-9) { k += 6; continue }
        const len = Math.min(nominal, edge / 3)
        dir.multiplyScalar(len / edge)
        pos[k++] = here.x;           pos[k++] = here.y;           pos[k++] = here.z
        pos[k++] = here.x + dir.x;   pos[k++] = here.y + dir.y;   pos[k++] = here.z + dir.z
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this._corners = new THREE.LineSegments(geo, this._cornerMat)
    this._corners.renderOrder = 3
    this._group.add(this._corners)
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
    if (this._bornAt === null) this._bornAt = t
    const reduced = this._reduced
    const entry = entryFrame(t, this._bornAt, reduced)

    // Pending boundary: scroll dashOffset for "marching ants" flow.
    // dashOffset is a shader uniform — no needsUpdate required.
    if (this._isPending && this._lineMat.dashed && !reduced) {
      this._lineMat.dashOffset = -(t * 2.0)
    }
    // Entry: the ring fades up and the whole group swells past its target once.
    this._lineMat.opacity = (this._isPending ? PENDING_OPACITY : CONFIRMED_OPACITY) * entry.opacity
    if (entry.scale !== 1) this._group.scale.setScalar(entry.scale)
    else if (this._group.scale.x !== 1) this._group.scale.setScalar(1)

    if (this._placeType !== 'Zone') {
      this._fillMat.opacity = FILL_OPACITY * entry.opacity
      return
    }

    // Fill breathing: seamless sin², per-entity phase, faster when selected.
    this._fillMat.opacity =
      zoneFillFrame(t, this._phase, { selected: this._isSelected, reduced }).opacity * entry.opacity

    // Hatch: a slow drift (never an opacity flicker — the fill owns that channel).
    const off = hatchOffset(t, this._phase, reduced)
    this._hatchTex.offset.set(off.u, off.v)
    this._hatchMat.opacity = (this._isSelected ? 0.30 : 0.20) * entry.opacity

    // Rim pulse: radius eased outward against a quadratic alpha tail, rings half
    // a cycle apart. `_rimPeriod` is shortened while a contains-link is violated.
    const period = this._rimPeriod ?? RIM_PULSE_DURATION
    for (let i = 0; i < this._rims.length; i++) {
      const f = zoneRimFrame(t, this._phase, i, { period, reduced })
      this._rims[i].mesh.scale.setScalar(f.scale)
      this._rims[i].mat.opacity = f.opacity * entry.opacity
    }
  }

  /**
   * Called when a contains-link is violated (bilateral alarm).
   * Turns rim rings and border red and speeds up the pulse.
   * Sole writer of rim color during violation (PHILOSOPHY #4).
   * @param {boolean} violated
   */
  setContainsViolated(violated) {
    this._rimPeriod = violated ? 1.0 : RIM_PULSE_DURATION
    const color = violated ? 0xEF4444 : this._colorForType(this._placeType)
    for (const r of this._rims) r.mat.color.setHex(color)
    this._hatchMat.color.setHex(color)
    this._lineMat.color = color
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
    this._cornerMat.color.setHex(hex)
    this._hatchMat.color.setHex(hex)
    for (const r of this._rims) r.mat.color.setHex(hex)
    this.boxHelper.material?.color.setHex(hex)
    this._fillMat.opacity = FILL_OPACITY
    const isZone = placeType === 'Zone'
    for (const r of this._rims) r.mesh.visible = isZone
    this._hatchMesh.visible = isZone
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
    // Re-arm the entry pop (undo of a soft delete is a boundary moment too, #4).
    if (visible) this._bornAt = null
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
    this._unsubReduced()
    scene.remove(this._group)   // removes group + all its children
    scene.remove(this.boxHelper)
    this._lineGeo.dispose()
    this._lineMat.dispose()
    if (this._fillGeo) this._fillGeo.dispose()  // shared by fill + hatch meshes
    this._fillMat.dispose()
    this._hatchMat.dispose()
    this._hatchTex.dispose()    // caller-owned clone (DecalTextures ownership note)
    if (this._rimGeo) this._rimGeo.dispose()    // shared by every rim ring
    for (const r of this._rims) r.mat.dispose()
    this._rims = []
    if (this._corners) this._corners.geometry.dispose()
    this._cornerMat.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._dots = []
    if (this._label) this._label.remove()
  }
}
