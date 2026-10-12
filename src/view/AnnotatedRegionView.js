/**
 * AnnotatedRegionView — renderer for AnnotatedRegion domain entities.
 *
 * Architecture: all visual components are children of a single THREE.Group
 * positioned at the polygon centroid. This prevents edge/fill separation during
 * entity movement — each move just updates group.position and rebuilds local
 * geometry; no per-component world-position bookkeeping is needed.
 *
 * Renders — LIGHT ON THE FLOOR (ADR-166 M3), lit by the one stage light:
 *  - A Line2 (fat line) as a closed ring in place-type color (the fact)
 *  - A faint interior wash (ShapeGeometry in centroid-local XY plane)
 *  - An EDGE BAND: light lying on the floor, brightest at the boundary and
 *    fading inward — a pool of light whose rim is the region's edge
 *  - A LIGHT CURTAIN standing on the ring, brightest at the floor and fading
 *    upward — what stays legible when the camera skims the floor and the band
 *    compresses (the two are complementary in the view angle —
 *    `MapVisualMath.floorLightGains`)
 *  - Vertex dot markers (small spheres) at each vertex
 *  - Two rim rings (Zone only) that pulse outward in 180°-offset phases
 *
 * ADR-093 D3's Blueprint dressing (drifting diagonal hatch + L-shaped corner
 * registration marks) was retired by ADR-166 M3: it assumed a camera looking
 * straight down, and in perspective it collapsed to stripes.
 *
 * Selection (ADR-166 M3b) is the light rising on the `land` curve — the ring
 * thickens and the floor light brightens — plus the label's highlight. The
 * white BoxHelper is retired. A soft delete keeps the meshes drawn while the
 * light goes out (`exit` curve); `visible` is the LOGICAL fact hit-testing reads.
 *
 * Loudness is the ROLE, not the area (`emphasisFor`): a Zone is ground — the
 * quietest light on screen even though it is usually the biggest thing.
 *
 * Animations — curves live in `MapVisualMath` (pure, tested):
 *  - Pending boundary: dashOffset scrolls — "marching ants" flow effect
 *  - Zone: the floor light breathes on `breathe()` (sin², seamless at the loop)
 *    on a PER-ENTITY phase (ADR-093 D1)
 *  - Zone: two rim rings, radius eased outward (easeOutCubic) against a quadratic
 *    alpha tail, half a cycle apart
 *
 * Reduced motion: the light parks mid-band, one rim ring holds mid-flight — the
 * area stays fully legible (PHILOSOPHY #30/#11). Preference from the ONE
 * boundary (`src/theme/motion.js`), re-read live.
 *
 * @see ADR-029, ADR-031, ADR-093, ADR-166
 */
import * as THREE from 'three'
import { Line2 }         from 'three/addons/lines/Line2.js'
import { LineGeometry }  from 'three/addons/lines/LineGeometry.js'
import { LineMaterial }  from 'three/addons/lines/LineMaterial.js'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { EntityLabel } from './EntityLabel.js'
import { edgeBand, lightCurtain } from './FloorLightGeometry.js'
import {
  phaseFor, zoneFillFrame, zoneRimFrame, floorLightGains, lightTint,
  INITIAL_LIFECYCLE, lifecycleShow, lifecycleHide, lifecycleStamp, lifecyclePhase,
  lifecycleEnvelope, phaseTraits,
  UNSELECTED, retargetSelection, selectionLevel, selectedEmphasis,
  ZONE_RIM_RINGS, ZONE_RIM_PERIOD, ZONE_FILL_MIN, ZONE_FILL_MAX,
} from './MapVisualMath.js'

const DEFAULT_COLOR      = 0x888888
const FILL_OPACITY       = (ZONE_FILL_MIN + ZONE_FILL_MAX) * 0.5   // static default = band midpoint
const SELECTED_WIDTH     = 4
const UNSELECTED_WIDTH   = 2
const CONFIRMED_OPACITY  = 1.00
const PENDING_OPACITY    = 0.90
const RIM_PULSE_DURATION = ZONE_RIM_PERIOD   // seconds per rim ring cycle
const VIOLATION_COLOR    = 0xEF4444
const WASH_GAIN          = 0.35   // interior wash = breath × this — the band carries the light
const BAND_GAIN          = 1.6    // edge band = breath × this (additive, capped at 1)
const BAND_INSET         = 0.78   // band runs from the edge 22% of the way to the centroid
const CURTAIN_PEAK       = 0.55   // light curtain opacity at full gain
const CURTAIN_FRAC       = 0.05   // curtain height as a fraction of the region's span (#27)

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
    /** @type {import('./MapVisualMath.js').Lifecycle} logical presence + entry/exit clocks */
    this._life       = INITIAL_LIFECYCLE
    this._drawn      = true                 // derived from the phase — `_setDrawn` is its one writer
    /** @type {import('./MapVisualMath.js').SelectionSegment} */
    this._sel        = UNSELECTED

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

    // ── Floor light: edge band + light curtain (ADR-166 M3) ───────────────
    // Additive, tinted by `material.color` with a per-vertex grey fade (0 =
    // contributes nothing), so the light needs no alpha channel and the tint
    // has one writer (#4). Geometry comes from the pure `FloorLightGeometry`.
    const lightMat = (polygonOffsetUnits) => new THREE.MeshBasicMaterial({
      color:              lightTint(this._colorForType(placeType)),
      vertexColors:       true,
      transparent:        true,
      opacity:            0,
      depthTest:          true,
      depthWrite:         false,
      blending:           THREE.AdditiveBlending,
      side:               THREE.DoubleSide,
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits,
    })
    this._bandGeo = new THREE.BufferGeometry()
    this._bandMat = lightMat(-5)   // one step ahead of the wash so it never z-fights it
    this._band = new THREE.Mesh(this._bandGeo, this._bandMat)
    this._band.renderOrder = 2
    this._group.add(this._band)

    this._curtainGeo = new THREE.BufferGeometry()
    this._curtainMat = lightMat(0)
    this._curtainMat.polygonOffset = false   // stands up off the floor — nothing to fight
    this._curtain = new THREE.Mesh(this._curtainGeo, this._curtainMat)
    this._curtain.renderOrder = 2
    this._group.add(this._curtain)

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

    // ── Rim rings (Zone only, dual-wave pulse) ─────────────────────────────
    // Two rings share one geometry but have independent materials so their
    // opacities can be animated at 180° phase offset for a continuous double-
    // wave effect.  Placeholder geometry — replaced in _setPoints.
    this._rimGeo = new THREE.BufferGeometry()
    /** @type {Array<{mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial}>} */
    this._rims = []
    for (let i = 0; i < ZONE_RIM_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color:              lightTint(this._colorForType(placeType)),
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

    // ── Name label (the one label mechanism — EntityLabel, ADR-155 D1) ─────
    /** @type {EntityLabel|null} */
    this._label = (renderer && container) ? new EntityLabel(renderer, container) : null
    this._label?.setText(name)
    this._label?.setAccent(this._cssColor(placeType))
    this._label?.setWanted(true)
    this._labelAnchor = new THREE.Vector3()
    this._containsViolated = false

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
    this._buildFloorLight(localPts)

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
  }

  /**
   * Rebuilds the edge band and the light curtain for the current ring. Both
   * sizes come from the region's OWN extent (#27): the band is a fraction of
   * the way to the centroid, the curtain a fraction of the span — so the light
   * looks the same in an mm-scale cell and a 100 m site plan.
   * @param {THREE.Vector3[]} localPts centroid-relative vertices
   */
  _buildFloorLight(localPts) {
    let ext = 0
    for (const lp of localPts) ext = Math.max(ext, Math.abs(lp.x), Math.abs(lp.y))
    const span = Math.max(ext * 2, 1e-6)

    const band = edgeBand(localPts, BAND_INSET)
    this._bandGeo.dispose()
    this._bandGeo = new THREE.BufferGeometry()
    this._bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(band.positions, 3))
    this._bandGeo.setAttribute('color',    new THREE.Float32BufferAttribute(band.shade, 3))
    this._bandGeo.setIndex(new THREE.BufferAttribute(band.index, 1))
    this._band.geometry = this._bandGeo

    const curtain = lightCurtain(localPts, true, span * CURTAIN_FRAC)
    this._curtainGeo.dispose()
    this._curtainGeo = new THREE.BufferGeometry()
    this._curtainGeo.setAttribute('position', new THREE.Float32BufferAttribute(curtain.positions, 3))
    this._curtainGeo.setAttribute('color',    new THREE.Float32BufferAttribute(curtain.shade, 3))
    this._curtainGeo.setIndex(new THREE.BufferAttribute(curtain.index, 1))
    this._curtain.geometry = this._curtainGeo
  }

  /** Returns hex color for the given place type (grey if null). */
  _colorForType(placeType) {
    const entry = getPlaceTypeEntry(placeType)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  /** CSS form of the place-type colour, for the label's accent bar. */
  _cssColor(placeType) {
    return `#${this._colorForType(placeType).toString(16).padStart(6, '0')}`
  }

  // ── Per-frame animation ────────────────────────────────────────────────────

  /**
   * Drives pending-line scroll, the floor light and the Zone rim pulse.
   * Called every frame from the AppController animation loop.
   * @param {number} t  elapsed seconds (performance.now() / 1000)
   * @param {number} [elevation]  how far the camera looks down ∈ [0,1]
   *   (`MapVisualMath.viewElevation`); omitted → straight down.
   */
  tick(t, elevation = 1) {
    const reduced = this._reduced
    // Lifecycle first (ADR-166 M3b): stamp, derive the phase, decide drawn.
    this._life = lifecycleStamp(this._life, t)
    this._setDrawn(phaseTraits(lifecyclePhase(t, this._life, reduced)).drawn)
    if (!this._drawn) return
    this._sel = retargetSelection(t, this._sel, this._isSelected, reduced)
    const sel   = selectionLevel(t, this._sel, reduced)
    const entry = lifecycleEnvelope(t, this._life, reduced)
    // Selection thickens the ring on the land curve (was an instant 2 → 4 px).
    this._lineMat.linewidth = UNSELECTED_WIDTH + (SELECTED_WIDTH - UNSELECTED_WIDTH) * sel

    // Pending boundary: scroll dashOffset for "marching ants" flow.
    // dashOffset is a shader uniform — no needsUpdate required.
    if (this._isPending && this._lineMat.dashed && !reduced) {
      this._lineMat.dashOffset = -(t * 2.0)
    }
    // Entry/exit: the ring fades up and swells past its target once; on the
    // way out it dims and contracts with the light (one envelope, P9).
    this._lineMat.opacity = (this._isPending ? PENDING_OPACITY : CONFIRMED_OPACITY) * entry.opacity
    if (entry.scale !== 1) this._group.scale.setScalar(entry.scale)
    else if (this._group.scale.x !== 1) this._group.scale.setScalar(1)

    // The light: role × view angle × (Zone) per-entity breath.
    const isZone = this._placeType === 'Zone'
    const gain = selectedEmphasis(this._placeType, sel, { urgent: this._containsViolated })
    const view = floorLightGains(elevation)
    const breath = isZone
      ? zoneFillFrame(t, this._phase, { selected: this._isSelected, reduced }).opacity
      : FILL_OPACITY
    const env = gain * entry.opacity
    this._fillMat.opacity    = breath * WASH_GAIN * view.floor * env
    this._bandMat.opacity    = Math.min(breath * BAND_GAIN, 1) * view.floor * env
    this._curtainMat.opacity = CURTAIN_PEAK * view.curtain * env

    if (!isZone) return

    // Rim pulse: radius eased outward against a quadratic alpha tail, rings half
    // a cycle apart. `_rimPeriod` is shortened while a contains-link is violated.
    const period = this._rimPeriod ?? RIM_PULSE_DURATION
    for (let i = 0; i < this._rims.length; i++) {
      const f = zoneRimFrame(t, this._phase, i, { period, reduced })
      this._rims[i].mesh.scale.setScalar(f.scale)
      this._rims[i].mat.opacity = f.opacity * Math.min(gain, 1) * entry.opacity
    }
  }

  /**
   * Called when a contains-link is violated (bilateral alarm).
   * Turns rim rings and border red and speeds up the pulse.
   * Sole writer of rim color during violation (PHILOSOPHY #4).
   * @param {boolean} violated
   */
  setContainsViolated(violated) {
    this._containsViolated = violated
    this._rimPeriod = violated ? 1.0 : RIM_PULSE_DURATION
    this._applyColors()
  }

  /**
   * Sole writer of every material colour (PHILOSOPHY #4): the ring and dots
   * carry the fact colour, the light carries it warmed toward the stage light,
   * and a violation overrides both with the danger colour.
   */
  _applyColors() {
    const fact  = this._containsViolated ? VIOLATION_COLOR : this._colorForType(this._placeType)
    const light = lightTint(fact)
    this._lineMat.color.setHex(fact)
    this._fillMat.color.setHex(fact)
    this._dotMat.color.setHex(fact)
    this._bandMat.color.setHex(light)
    this._curtainMat.color.setHex(light)
    for (const r of this._rims) r.mat.color.setHex(light)
  }

  // ── Label update (call once per frame while visible) ──────────────────────

  /**
   * Anchors the name label at the region centroid.
   * Must be called from the animation loop while visible.
   * @param {import('three').Camera} [camera]  Active camera (orthographic in Map mode).
   */
  updateLabelPosition(camera) {
    if (!this._label) return
    const cam = camera ?? this._camera
    if (!cam || !this._life.present) return
    this._group.getWorldPosition(this._labelAnchor)
    this._label.updatePosition(cam, this._labelAnchor)
  }

  /** Updates the label text (e.g. after rename). */
  setName(name) {
    this._label?.setText(name)
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

  /**
   * Kept for the polymorphic contract (PHILOSOPHY #17 — the commands call it
   * on every entity view). There is no box to refresh: selection is the light.
   */
  updateBoxHelper() {}

  // ── Place type (color) update ──────────────────────────────────────────────

  /**
   * Updates ring, fill, and dot color when placeType changes.
   * @param {string|null} placeType
   */
  setPlaceType(placeType) {
    this._placeType = placeType
    this._applyColors()
    this._fillMat.opacity = FILL_OPACITY
    const isZone = placeType === 'Zone'
    for (const r of this._rims) r.mesh.visible = isZone
    this._label?.setAccent(this._cssColor(placeType))
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

  /**
   * The logical show/hide (ADR-166 M3b): a hide arms the exit (the next ticks
   * put the light out), a re-show replays the entry. Owned by the lifecycle
   * reducers (#4), not by the undo call sites.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._life = visible ? lifecycleShow(this._life) : lifecycleHide(this._life)
    this._label?.setWanted(visible)
    if (visible) this._setDrawn(true)
    else if (!this._life.exitPending) this._setDrawn(false)   // never seen — nothing to put out
  }

  /** Sole writer of the group's visibility — the DRAWN state (PHILOSOPHY #4). */
  _setDrawn(drawn) {
    if (this._drawn === drawn) return
    this._drawn = drawn
    this._group.visible = drawn
  }

  /**
   * Selection = the light rising on the land curve (the next tick starts the
   * segment; ring width and gain are written there) + the label's highlight.
   * @param {boolean} sel
   */
  setObjectSelected(sel) {
    this._isSelected = sel
    this._label?.setHighlighted(sel)
  }

  /**
   * The LOGICAL fact: the region exists for the user (pickable, counted). False
   * from the moment of a soft delete, while the light is still going out.
   */
  get visible() { return this._life.present }

  /** True while any part is on screen (present, or still exiting). */
  get drawn() { return this._drawn }

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
    this._life  = { present: false, bornAt: null, exitAt: null, exitPending: false }
    this._drawn = false
    scene.remove(this._group)   // removes group + all its children
    this._lineGeo.dispose()
    this._lineMat.dispose()
    if (this._fillGeo) this._fillGeo.dispose()
    this._fillMat.dispose()
    this._bandGeo.dispose()
    this._bandMat.dispose()
    this._curtainGeo.dispose()
    this._curtainMat.dispose()
    if (this._rimGeo) this._rimGeo.dispose()    // shared by every rim ring
    for (const r of this._rims) r.mat.dispose()
    this._rims = []
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._dots = []
    this._label?.dispose()
  }
}
