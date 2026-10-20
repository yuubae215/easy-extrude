/**
 * AnnotatedLineView — renderer for AnnotatedLine domain entities.
 *
 * Renders:
 *  - A Line2 (fat line) connecting all vertices in place-type color; grey when unclassified
 *  - Vertex dot markers (small spheres) at each vertex
 *  - Route: one InstancedMesh carrying comet heads + their trail beads — light
 *            flowing along the floor, warmed by the stage light
 *  - Boundary: a LIGHT CURTAIN standing on the wall (brightest at the floor,
 *            fading upward — ADR-166 M3). It replaced ADR-093 D3's
 *            perpendicular drafting ticks, which assumed a top-down camera.
 *            The curtain is edge-on from straight above (the dashed line
 *            carries that view) and stands up into view as the camera drops —
 *            `MapVisualMath.floorLightGains`.
 *
 * Selection (ADR-166 M3b) is the light rising on the `land` curve — the line
 * thickens, the beads / the wall brighten and grow — plus the label's
 * highlight; the white BoxHelper is retired. A soft delete keeps the meshes
 * drawn while the light goes out (`exit` curve); `visible` is the LOGICAL fact.
 *
 * Animations — curves live in `MapVisualMath` (pure, tested); ADR-093 replaces
 * the ADR-031 §8 parameters:
 *  - Route:    comets with tapering trails, each head on its own speed and its
 *             own phase, breathing in size along the path (traffic, not a gear).
 *  - Boundary: was explicitly "no animation, static solid line". A crest now
 *             travels along the light wall, lifting it as it passes — the
 *             barrier reads as present without shouting (P3 spatial stagger,
 *             P11 抑制). The slow marching dashes are unchanged.
 *
 * Reduced motion: beads park at their spawn offsets and the wall holds a mid
 * intensity — a populated, directional channel and a legible wall remain
 * (PHILOSOPHY #30/#11). Preference comes from the ONE boundary
 * (`src/theme/motion.js`), re-read live.
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView
 * so AppController's setMode() and mode-agnostic calls are safe.
 *
 * Note: no `cuboid` property — AnnotatedLine is excluded from raycasting.
 * Move support: updateGeometry(corners) refreshes vertex positions.
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
import { idleClock } from './MotionMath.js'
import { lightCurtain } from './FloorLightGeometry.js'
import {
  phaseFor, routeFlowFrame, boundaryLightFrame, floorLightGains, lightTint,
  INITIAL_LIFECYCLE, lifecycleShow, lifecycleHide, lifecycleStamp, lifecyclePhase,
  lifecycleEnvelope, phaseTraits,
  UNSELECTED, retargetSelection, selectionLevel, selectedEmphasis, SELECT_GROW,
  ROUTE_HEADS, ROUTE_TRAIL, ROUTE_INSTANCES,
} from './MapVisualMath.js'

const DEFAULT_COLOR      = 0x888888   // unclassified grey
const SELECTED_WIDTH     = 4
const UNSELECTED_WIDTH   = 3
const PARTICLE_RADIUS    = 0.12       // world-unit radius; visible at default frustumSize=50
const WALL_HEIGHT_FRAC   = 0.04       // Boundary light-wall height as a fraction of the
                                      // polyline length — scale-invariant by construction (#27)
const WALL_PEAK          = 0.8        // light-wall opacity at full gain
const VIOLATION_COLOR    = 0xEF4444
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
    /** @type {import('./MapVisualMath.js').Lifecycle} logical presence + entry/exit clocks */
    this._life      = INITIAL_LIFECYCLE
    this._drawn     = true                 // derived from the phase — `_setDrawn` is its one writer
    /** @type {import('./MapVisualMath.js').SelectionSegment} */
    this._sel       = UNSELECTED
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
      color:       lightTint(this._colorForType(placeType)),
      depthTest:   true,
      depthWrite:  false,
      transparent: true,
      opacity:     0.9,
      blending:    THREE.AdditiveBlending,
    })
    /** @type {THREE.InstancedMesh|null} one instance per bead; null until a Route */
    this._beads = null

    // ── Boundary light wall ────────────────────────────────────────────────
    // The crest's brightness rides the curtain's vertex-colour attribute,
    // rewritten IN PLACE each frame (no per-frame allocation — a travelling
    // wave for one Float32Array write per vertex). The material carries the
    // light's tint; the attribute carries only the grey fade × the crest (#4).
    this._wallMat = new THREE.MeshBasicMaterial({
      color:        lightTint(this._colorForType(placeType)),
      vertexColors: true,
      depthTest:    true,
      depthWrite:   false,
      transparent:  true,
      opacity:      0,
      blending:     THREE.AdditiveBlending,
      side:         THREE.DoubleSide,
    })
    /** @type {THREE.Mesh|null} */
    this._wall = null
    /** @type {Float32Array} arc-length fraction of each floor/top vertex pair */
    this._wallArcs = new Float32Array(0)
    /**
     * Pre-computed segment data for the current polyline.
     * @type {Array<{ a: THREE.Vector3, b: THREE.Vector3, len: number }>}
     */
    this._segments  = []
    this._totalLen  = 0
    /** @type {THREE.Vector3[]} last known points (for setPlaceType particle rebuild) */
    this._points    = []

    // ── Name label (the one label mechanism — EntityLabel, ADR-155 D1) ─────
    /** @type {EntityLabel|null} */
    this._label = (renderer && container) ? new EntityLabel(renderer, container) : null
    this._label?.setText(name)
    this._label?.setAccent(this._cssColor(placeType))
    this._label?.setWanted(true)
    this._isSelected   = false
    this._tactViolated = false

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
      dot.visible = this._drawn
      this._scene.add(dot)
      this._dots.push(dot)
    }

    this._rebuildParticles(points)
    this._labelPos = this._computeLabelPos(points)
  }

  /**
   * Recomputes arc-length segment data and rebuilds the place-type layer:
   * the Route bead InstancedMesh or the Boundary light wall. Called from
   * `_setPoints()` (construction, every move) and `setPlaceType()`.
   * @param {THREE.Vector3[]} points
   */
  _rebuildParticles(points) {
    this._disposeBeads()
    this._disposeWall()
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
      this._beads.visible = this._drawn
      this._scene.add(this._beads)
      this._writeBeads(0)                 // valid first frame before the loop ticks
    } else if (this._placeType === 'Boundary') {
      this._buildWall(points)
    }
  }

  /**
   * Builds the Boundary's light wall: a curtain standing on the polyline, its
   * height a fraction of the polyline's own length so it reads the same in an
   * mm-scale cell and a 100 m site plan (#27).
   * @param {THREE.Vector3[]} points
   */
  _buildWall(points) {
    const c = lightCurtain(points, false, this._totalLen * WALL_HEIGHT_FRAC)
    if (c.arcs.length === 0) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(c.positions, 3))
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(c.shade, 3))
    geo.setIndex(new THREE.BufferAttribute(c.index, 1))
    this._wallArcs = c.arcs
    this._wall = new THREE.Mesh(geo, this._wallMat)
    this._wall.renderOrder = 3
    this._wall.visible = this._drawn
    this._scene.add(this._wall)
    this._writeWall(0)                     // valid first frame
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
   * Writes one frame of the crest into the wall's colour attribute (in place):
   * the floor vertex carries the crest's brightness, the top vertex stays 0 so
   * the light always fades upward.
   * @param {number} t loop clock (seconds)
   */
  _writeWall(t) {
    if (!this._wall) return
    const attr = this._wall.geometry.getAttribute('color')
    for (let i = 0; i < this._wallArcs.length; i++) {
      const k = boundaryLightFrame(t, this._wallArcs[i], this._phase, this._reduced)
      attr.setXYZ(i * 2, k, k, k)
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

  /** Removes and releases the Boundary light wall (#9). */
  _disposeWall() {
    if (!this._wall) return
    this._scene.remove(this._wall)
    this._wall.geometry.dispose()  // per-polyline geometry; _wallMat is view-owned
    this._wall = null
    this._wallArcs = new Float32Array(0)
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

  /** Returns hex color for the given place type (grey if null). */
  _colorForType(placeType) {
    const entry = getPlaceTypeEntry(placeType)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  /** CSS form of the place-type colour, for the label's accent bar. */
  _cssColor(placeType) {
    return `#${this._colorForType(placeType).toString(16).padStart(6, '0')}`
  }

  /**
   * Sole writer of every material colour (PHILOSOPHY #4): the line and dots
   * carry the fact colour, the light (beads, wall) carries it warmed toward the
   * stage light, and a tact-time violation overrides the beads with danger.
   */
  _applyColors() {
    const fact = this._colorForType(this._placeType)
    this._lineMat.color.setHex(fact)
    this._dotMat.color.setHex(fact)
    this._wallMat.color.setHex(lightTint(fact))
    this._partMat.color.setHex(lightTint(this._tactViolated ? VIOLATION_COLOR : fact))
  }

  // ── Per-frame animation ────────────────────────────────────────────────────

  /**
   * Called when a tact-time link violation is detected (bilateral alarm).
   * Reverses particle flow direction and tints particles red.
   * Sole writer of _particleDirection and particle color (PHILOSOPHY #4).
   * @param {boolean} violated
   */
  setTactViolated(violated) {
    this._tactViolated = violated
    this._particleDirection = violated ? -1 : 1
    this._applyColors()
  }

  /**
   * Drives the Route flow and the Boundary light wall. Called every frame from
   * AppController.
   * @param {number} t  elapsed seconds (performance.now() / 1000)
   * @param {number} [elevation]  how far the camera looks down ∈ [0,1]
   *   (`MapVisualMath.viewElevation`); omitted → straight down.
   */
  tick(t, elevation = 1) {
    // Lifecycle first (ADR-166 M3b): stamp, derive the phase, decide drawn.
    this._life = lifecycleStamp(this._life, t)
    this._setDrawn(phaseTraits(lifecyclePhase(t, this._life, this._reduced)).drawn)
    if (!this._drawn) return
    if (this._segments.length === 0 || this._totalLen === 0) return
    this._sel = retargetSelection(t, this._sel, this._isSelected, this._reduced)
    const sel  = selectionLevel(t, this._sel, this._reduced)
    const gain = selectedEmphasis(this._placeType, sel, { urgent: this._tactViolated })
    const grow = 1 + (SELECT_GROW - 1) * sel

    // Entry/exit: the line's own opacity rises (or the light goes out) on an
    // eased curve and its beads/wall ride the same envelope, so an annotation
    // ARRIVES and LEAVES instead of blinking (P4/P9).
    const entry = lifecycleEnvelope(t, this._life, this._reduced)
    this._lineMat.opacity = this._baseLineOpacity() * entry.opacity
    // Selection thickens the line on the land curve (was an instant 3 → 4 px).
    this._lineMat.linewidth = UNSELECTED_WIDTH + (SELECTED_WIDTH - UNSELECTED_WIDTH) * sel
    for (const d of this._dots) d.scale.setScalar(entry.scale)

    if (this._placeType === 'Route') {
      // One shared material: the beads' brightness is the role's gain, capped
      // (additive opacity saturates at 1); the rest of the selection reads as growth.
      this._partMat.opacity = Math.min(0.9 * gain, 1) * entry.opacity
      this._writeBeads(t, entry.scale * grow)
    } else if (this._placeType === 'Boundary') {
      // Marching-ants: animate dashOffset for a slow "boundary tape" effect.
      // Reduced motion parks the dashes; the dash PATTERN (the information) stays.
      if (!this._reduced) {
        const cycle = BOUNDARY_DASH_SIZE + BOUNDARY_GAP_SIZE
        this._lineMat.dashOffset = -((idleClock(t) * BOUNDARY_DASH_SPD) % cycle)   // an idle loop (ADR-166 M7)
      }
      this._wallMat.opacity = WALL_PEAK * floorLightGains(elevation).curtain * gain * entry.opacity
      this._writeWall(t)
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
   * Anchors the name label at the arc-length midpoint of the polyline.
   * Must be called from the animation loop while visible.
   * @param {import('three').Camera} [camera]  Active camera (orthographic in Map mode).
   */
  updateLabelPosition(camera) {
    if (!this._label || !this._labelPos) return
    const cam = camera ?? this._camera
    if (!cam || !this._life.present) return
    this._label.updatePosition(cam, this._labelPos)
  }

  /** Updates the label text (e.g. after rename). */
  setName(name) {
    this._label?.setText(name)
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

  /**
   * Kept for the polymorphic contract (PHILOSOPHY #17 — the commands call it
   * on every entity view). There is no box to refresh: selection is the light.
   */
  updateBoxHelper() {}

  // ── Place type (color) update ──────────────────────────────────────────────

  /**
   * Updates line and dot color when placeType changes.
   * @param {string|null} placeType
   */
  setPlaceType(placeType) {
    this._placeType = placeType
    this._applyColors()
    this._label?.setAccent(this._cssColor(placeType))
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

  /**
   * Sole writer of mesh visibility — the DRAWN state (PHILOSOPHY #4). The
   * rebuild paths (`_setPoints` / `_rebuildParticles`) read `_drawn` for the
   * meshes they create, so a rebuild during an exit cannot resurrect them.
   * @param {boolean} drawn
   */
  _setDrawn(drawn) {
    if (this._drawn === drawn) return
    this._drawn = drawn
    this._line.visible = drawn
    for (const d of this._dots) d.visible = drawn
    if (this._beads) this._beads.visible = drawn
    if (this._wall) this._wall.visible = drawn
  }

  /**
   * Selection = the light rising on the land curve (the next tick starts the
   * segment; width, gain and growth are written there) + the label's highlight.
   * @param {boolean} sel
   */
  setObjectSelected(sel) {
    this._isSelected = sel
    this._label?.setHighlighted(sel)
  }

  /**
   * The LOGICAL fact: the line exists for the user (pickable, counted). False
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
    scene.remove(this._line)
    for (const d of this._dots) scene.remove(d)
    this._disposeBeads()
    this._disposeWall()
    this._lineGeo.dispose()
    this._lineMat.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._partGeo.dispose()
    this._partMat.dispose()
    this._wallMat.dispose()
    this._dots      = []
    this._segments  = []
    this._label?.dispose()
  }
}
