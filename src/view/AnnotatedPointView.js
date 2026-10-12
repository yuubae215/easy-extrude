/**
 * AnnotatedPointView — renderer for AnnotatedPoint domain entities.
 *
 * Renders:
 *  - A flat circle mesh (CylinderGeometry, low height) in place-type color; grey when unclassified
 *  - An additive ground halo — a spot of light on the floor, warmed toward the
 *    one stage light (ADR-166 M3) and sharing the stage's sprite recipe
 *  - A name label (EntityLabel — the one label mechanism, ADR-155 D1)
 *
 * Selection is the floor light rising and growing on the `land` curve, plus
 * the label's highlight — ADR-166 M3b retired the white BoxHelper (a wireframe
 * box around light on the floor said "selected" in no language of its own).
 *
 * Lifecycle (ADR-166 M3b): `visible` is the LOGICAL fact (present — what
 * hit-testing reads); the meshes stay drawn through a short exit after a soft
 * delete, the light going out on the `exit` curve. The record and its reducers
 * live in `MapVisualMath` (STATE_TRANSITIONS §Map annotation motion).
 *
 * Animations — all curves live in `MapVisualMath` (pure, tested); this view only
 * applies them (ADR-093 replaces the ADR-031 §8 parameters):
 *  - Hub:    a TRAIN of two sonar rings, eased outward (easeOutCubic distance
 *            against a cubic alpha tail — brightest while small) on a per-entity
 *            phase, over a breathing core and halo: a broadcasting junction,
 *            not a metronome.
 *  - Anchor: a crosshair over a TIGHT spot of light that HOLDS still and is
 *            periodically re-seated with a short overshoot — "pinned in place"
 *            asserted by stillness. ADR-166 M3 retired ADR-093 D3's graduation
 *            ticks and 45° datum square (drafting-table detail, illegible in
 *            perspective); the hold-and-kick rhythm stays.
 *  - Both:   an easeOutBack entry pop on the first frames of existence, and
 *            the light going out (inCubic) on the way out.
 *
 * Reduced motion: every part stays visible at a held frame (a parked ring, a
 * still crosshair, a steady halo) — information preserved, movement dropped
 * (PHILOSOPHY #30/#11). The preference is read from the ONE boundary
 * (`src/theme/motion.js`) and re-read live via `onReducedMotionChange`.
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView
 * so AppController's setMode() and mode-agnostic calls are safe.
 *
 * Note: no `cuboid` property — AnnotatedPoint is excluded from raycasting.
 * Move support: updateGeometry([position]) refreshes point position.
 *
 * @see ADR-029, ADR-031, ADR-093, ADR-166
 */
import * as THREE from 'three'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { radialSprite } from './DecalTextures.js'
import { EntityLabel } from './EntityLabel.js'
import {
  phaseFor, hubPingFrame, hubCoreFrame, anchorFrame, HUB_PING_RINGS, lightTint,
  INITIAL_LIFECYCLE, lifecycleShow, lifecycleHide, lifecycleStamp, lifecyclePhase,
  lifecycleEnvelope, phaseTraits,
  UNSELECTED, retargetSelection, selectionLevel, selectedEmphasis, SELECT_GROW,
} from './MapVisualMath.js'

const DEFAULT_COLOR     = 0x888888
const MARKER_RADIUS     = 0.25
const MARKER_HEIGHT     = 0.04
const CROSSHAIR_LEN     = 0.45   // half-length; extends beyond MARKER_RADIUS so arms are visible outside the dot
const CROSSHAIR_OPACITY = 0.90   // high opacity for contrast against colored marker
const HALO_RADIUS       = MARKER_RADIUS * 2.0
const ANCHOR_SPOT       = 0.65   // the Anchor's spot is TIGHTER than a Hub's pool (× halo size)
const VIOLATION_COLOR   = 0xEF4444

export class AnnotatedPointView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Camera}  camera
   * @param {HTMLElement}   container   DOM element to append the label to
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Vector3} point       anchor position
   * @param {string}        name        entity name (shown in label)
   * @param {string|null}   placeType   'Hub' | 'Anchor' | null
   * @param {string|null}   [entityId]  owning entity id — the ONLY source of the
   *   per-entity animation phase (ADR-093). Omitted → phase 0, i.e. the
   *   single-entity look; `SceneService` passes the real id at every call site.
   */
  constructor(scene, camera, container, renderer, point, name, placeType, entityId = null) {
    this._scene    = scene
    this._camera   = camera
    this._renderer = renderer
    this._placeType = placeType
    // Per-entity phase: the fix for population lockstep (PHILOSOPHY #31).
    this._phase   = phaseFor(entityId)
    this._reduced = prefersReducedMotion()
    this._unsubReduced = onReducedMotionChange(r => { this._reduced = r })
    /** @type {import('./MapVisualMath.js').Lifecycle} logical presence + entry/exit clocks */
    this._life    = INITIAL_LIFECYCLE
    this._drawn   = true          // derived from the phase each tick — `_setDrawn` is its one writer
    /** @type {import('./MapVisualMath.js').SelectionSegment} */
    this._sel     = UNSELECTED

    // ── Circle marker mesh ─────────────────────────────────────────────────
    this._geo = new THREE.CylinderGeometry(MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 16)
    // Rest the disc ON the ground plane (bottom at z=0) instead of straddling
    // it — a z-centered cylinder is half-buried, and at glancing angles its
    // top face, side wall, and the z=0 ring visually separate into what reads
    // as multiple misregistered discs. (+Y here becomes +Z after the rotation
    // below.)
    this._geo.translate(0, MARKER_HEIGHT / 2, 0)
    this._mat = new THREE.MeshBasicMaterial({
      color:       this._colorForType(placeType),
      depthTest:   true,
      // transparent:true at full opacity is deliberate: it moves the disc into
      // the transparent render queue, where renderOrder (2 > zone fill's 1)
      // guarantees it draws AFTER ground-plane region fills. As an opaque mesh
      // it is drawn first, and the zone's slope-scaled polygonOffset can pull
      // the fill in front of the disc at glancing angles — the green fill then
      // tints the purple marker into a blue-grey ghost.
      transparent: true,
      opacity:     1,
    })
    /** Named differently from cuboid to indicate no raycasting. */
    this._mesh = new THREE.Mesh(this._geo, this._mat)
    // Rotate flat in XY plane (ROS Z-up: cylinder axis is Y by default → rotate 90° around X)
    this._mesh.rotation.x = Math.PI / 2
    this._mesh.renderOrder = 2
    this._mesh.position.copy(point)
    scene.add(this._mesh)

    // ── Outline ring (slightly larger, transparent) ────────────────────────
    this._ringGeo = new THREE.RingGeometry(MARKER_RADIUS, MARKER_RADIUS + 0.05, 16)
    this._ringMat = new THREE.MeshBasicMaterial({
      color:              this._colorForType(placeType),
      depthTest:          true,
      depthWrite:         false,
      transparent:        true,
      opacity:            0.6,
      side:               THREE.DoubleSide,
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    })
    this._ring = new THREE.Mesh(this._ringGeo, this._ringMat)
    this._ring.position.copy(point)
    this._ring.renderOrder = 3
    scene.add(this._ring)

    // ── Ground halo (additive glow pool) ───────────────────────────────────
    // Ties the marker to the stage's own accent glow so a map annotation reads
    // as LIT BY the scene rather than pasted onto it (PHILOSOPHY #7). Additive +
    // depthWrite:false + polygonOffset, same ground-decal rules as the rings.
    // The sprite is white and tinted here, so one cached texture serves every
    // place-type colour (DecalTextures ownership note).
    this._haloMat = new THREE.MeshBasicMaterial({
      map:                radialSprite('#ffffff'),
      color:              lightTint(this._colorForType(placeType)),
      transparent:        true,
      opacity:            0,
      depthTest:          true,
      depthWrite:         false,
      blending:           THREE.AdditiveBlending,
      side:               THREE.DoubleSide,
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      fog:                false,
    })
    this._haloGeo = new THREE.PlaneGeometry(HALO_RADIUS * 2, HALO_RADIUS * 2)
    this._halo = new THREE.Mesh(this._haloGeo, this._haloMat)
    this._halo.position.copy(point)
    this._halo.renderOrder = 1     // under the disc (2) and the rings (3/4)
    scene.add(this._halo)

    // ── Sonar-ping rings (Hub animation) ──────────────────────────────────
    // A TRAIN of `HUB_PING_RINGS` rings spaced evenly through the cycle: one
    // ring per period reads as a tick, several as an emission. They share one
    // geometry and each owns a material (independent per-ring opacity).
    // For non-Hub types they stay invisible (opacity 0 written every frame).
    this._sonarGeo = new THREE.RingGeometry(MARKER_RADIUS * 0.94, MARKER_RADIUS, 48)
    /** @type {Array<{mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial}>} */
    this._sonarRings = []
    for (let i = 0; i < HUB_PING_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color:              this._colorForType(placeType),
        depthTest:          true,
        depthWrite:         false,
        transparent:        true,
        opacity:            0,
        side:               THREE.DoubleSide,
        blending:           THREE.AdditiveBlending, // rings glow where they cross
        polygonOffset:      true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      })
      const mesh = new THREE.Mesh(this._sonarGeo, mat)
      mesh.position.copy(point)
      mesh.renderOrder = 4
      scene.add(mesh)
      this._sonarRings.push({ mesh, mat })
    }

    // ── Anchor crosshair (ADR-031 §8) ──────────────────────────────────────
    // 4 line segments radiating from the central dot (±X, ±Y, length CROSSHAIR_LEN).
    // Scale pulses 1.0×→1.3× on a 4 s sine cycle at constant 0.55 opacity.
    // Replaces the ring-breathing animation for Anchor place type.
    const L = CROSSHAIR_LEN
    const crosshairPositions = new Float32Array([
      0, 0, 0,  L, 0, 0,    // +X arm
      0, 0, 0, -L, 0, 0,    // −X arm
      0, 0, 0,  0, L, 0,    // +Y arm
      0, 0, 0,  0,-L, 0,    // −Y arm
    ])
    const crosshairGeo = new THREE.BufferGeometry()
    crosshairGeo.setAttribute('position', new THREE.Float32BufferAttribute(crosshairPositions, 3))
    // White crosshair so arms contrast against the colored marker disc beneath
    this._crosshairMat = new THREE.LineBasicMaterial({
      color:       0xffffff,
      depthTest:   true,
      depthWrite:  false,
      transparent: true,
      opacity:     CROSSHAIR_OPACITY,
    })
    this._crosshairs = new THREE.LineSegments(crosshairGeo, this._crosshairMat)
    this._crosshairs.position.copy(point)
    this._crosshairs.renderOrder = 4
    this._crosshairs.visible = false   // shown only for Anchor
    scene.add(this._crosshairs)

    // ── Name label (the one label mechanism — EntityLabel, ADR-155 D1) ─────
    this._label = new EntityLabel(renderer, container)
    this._label.setText(name)
    this._label.setAccent(this._cssColor(placeType))
    this._label.setWanted(true)

    this._point = point.clone()
    this._name  = name
    this._tactViolated      = false
    this._isSelected        = false
    this._toleranceViolated = false
    this._bridgeLine = null
    this._bridgeCfId = null
    this._scene      = null   // set lazily in updateBridgeLine()
    // Screen-space scale factor applied on top of the world-unit base geometry.
    // tick() composes its per-frame animation scales with this value.
    this._viewScale  = 1

    // Apply initial place-type visuals
    this._applyPlaceTypeVisuals(placeType)
    this._applyLift()
  }

  /**
   * Keeps the flat overlay parts (ring / sonar / crosshairs) at the disc's TOP
   * face instead of the z=0 base. Coplanar with the ground they interleave
   * with region fills and the grid, and at glancing angles they visually
   * detach from the disc (parallax). The lift scales with `_viewScale` because
   * the disc height does. Call after every `_viewScale` or position change.
   */
  _applyLift() {
    const lift = this._point ? MARKER_HEIGHT * this._viewScale * 1.05 : 0
    const z = (this._point?.z ?? 0) + lift
    this._ring.position.z       = z
    this._crosshairs.position.z = z
    for (const r of this._sonarRings) r.mesh.position.z = z
    // The halo sits just BELOW the overlay parts (it is a floor pool, not a
    // decal on the disc) but still above z=0 so it never fights the grid.
    this._halo.position.z = (this._point?.z ?? 0) + lift * 0.35
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  /**
   * Repositions the point marker.
   * @param {THREE.Vector3} point
   */
  _setPoint(point) {
    this._point.copy(point)
    this._mesh.position.copy(point)
    this._ring.position.copy(point)
    this._crosshairs.position.copy(point)
    this._halo.position.copy(point)
    for (const r of this._sonarRings) r.mesh.position.copy(point)
    this._applyLift()
  }

  /** Returns hex color for the given place type. */
  _colorForType(placeType) {
    const entry = getPlaceTypeEntry(placeType)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  /** CSS form of the place-type colour, for the label's accent bar. */
  _cssColor(placeType) {
    return `#${this._colorForType(placeType).toString(16).padStart(6, '0')}`
  }

  /**
   * Sole writer of every material colour (PHILOSOPHY #4): the disc and rings
   * carry the fact colour, the floor spot carries it warmed toward the stage
   * light, and either violation overrides both with danger. The crosshair is
   * white for contrast unless the Anchor is out of tolerance.
   */
  _applyColors() {
    const urgent = this._tactViolated || this._toleranceViolated
    const fact = urgent ? VIOLATION_COLOR : this._colorForType(this._placeType)
    this._mat.color.setHex(fact)
    this._ringMat.color.setHex(fact)
    this._haloMat.color.setHex(lightTint(fact))
    for (const r of this._sonarRings) r.mat.color.setHex(fact)
    this._crosshairMat.color.setHex(this._toleranceViolated ? VIOLATION_COLOR : 0xffffff)
  }

  /**
   * Applies place-type-specific visibility / opacity rules.
   * Called from constructor and setPlaceType().
   * @param {string|null} placeType
   */
  _applyPlaceTypeVisuals(placeType) {
    const isAnchor = placeType === 'Anchor'
    this._crosshairs.visible = isAnchor && this._drawn
    if (isAnchor) {
      this._ringMat.opacity = 0.40   // subtle constant outline for Anchor
      for (const r of this._sonarRings) r.mat.opacity = 0
    } else {
      this._ringMat.opacity = 0.6
    }
    // Reset crosshair scale so pulse starts from 1.0× (in view-scale units)
    const s = this._viewScale ?? 1
    this._crosshairs.scale.setScalar(s)
  }

  /**
   * Scales the marker so it appears at a roughly constant screen pixel size
   * regardless of camera distance, capped by maxWorldSize (world-unit radius).
   * Mirrors CoordinateFrameView.updateScale(); call every animation frame.
   * Without this the fixed MARKER_RADIUS (0.25 world units) is sub-pixel in
   * mm-scale scenes (e.g. the Context DSL demo) and the marker is invisible.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} [maxWorldSize=Infinity]  Upper bound for the marker world radius.
   */
  updateScale(camera, renderer, maxWorldSize = Infinity) {
    if (!camera.isPerspectiveCamera) return
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360)
    const screenH    = renderer.domElement.clientHeight || 1
    const targetPx   = 20   // marker radius in screen pixels (≈ legacy 0.25-unit look)
    const d          = camera.position.distanceTo(this._mesh.position)
    let worldRadius  = (targetPx / screenH) * 2 * d * tanHalfFov
    if (maxWorldSize < Infinity) worldRadius = Math.min(worldRadius, maxWorldSize)
    const s = worldRadius / MARKER_RADIUS
    if (Math.abs(s - this._viewScale) < 1e-6) return
    this._viewScale = s
    // Every animated scale is recomposed by `tick()` from `_viewScale` × the
    // entry pop × the per-type animation, so this method only records the base
    // and fixes the parts tick() does not own. Writing an animated scale here
    // too would give it two writers (PHILOSOPHY #4).
    this._ring.scale.setScalar(s)
    this._mesh.scale.setScalar(s)
    for (const r of this._sonarRings) r.mesh.scale.setScalar(s)
    if (this._placeType !== 'Anchor') this._crosshairs.scale.setScalar(s)
    this._applyLift()
  }

  // ── Per-frame animation ────────────────────────────────────────────────────

  /**
   * Drives place-type-specific animations.  Called every frame from AppController.
   * @param {number} t  elapsed seconds (performance.now() / 1000)
   */
  tick(t) {
    const reduced = this._reduced
    // Lifecycle first (ADR-166 M3b): stamp the entry/exit clock, derive the
    // phase, and let it decide whether anything is drawn at all.
    this._life = lifecycleStamp(this._life, t)
    this._setDrawn(phaseTraits(lifecyclePhase(t, this._life, reduced)).drawn)
    if (!this._drawn) return
    this._sel = retargetSelection(t, this._sel, this._isSelected, reduced)
    const phase   = this._phase
    const vs      = this._viewScale
    // The lifecycle envelope — the entry pop (the boundary moment "this now
    // exists", P4) or the light going out (P9). Rides every scale below, so the
    // whole marker arrives and leaves as one object.
    const entry = lifecycleEnvelope(t, this._life, reduced)
    const base  = vs * entry.scale
    // The role's loudness (ADR-166 M3): selection raises and grows the floor
    // light on the land curve; a violation is absolute (Tier F outranks every role).
    const sel  = selectionLevel(t, this._sel, reduced)
    const gain = selectedEmphasis(this._placeType, sel, {
      urgent: this._tactViolated || this._toleranceViolated,
    })
    const grow = 1 + (SELECT_GROW - 1) * sel

    this._mesh.scale.setScalar(base)
    this._ring.scale.setScalar(base)
    this._ringMat.opacity = (this._placeType === 'Anchor' ? 0.40 : 0.6) * entry.opacity
    this._mat.opacity = entry.opacity

    if (this._placeType === 'Hub') {
      const urgent = this._tactViolated
      // Core breathe + halo swell: the marker itself is never perfectly still.
      const core = hubCoreFrame(t, phase, { urgent, reduced })
      this._mesh.scale.setScalar(base * core.scale)
      this._halo.scale.setScalar(base * core.haloScale * grow)
      this._haloMat.opacity = core.haloOpacity * gain * entry.opacity
      // The ring train: eased distance, quadratic alpha tail, per-ring offset.
      for (let i = 0; i < this._sonarRings.length; i++) {
        const f = hubPingFrame(t, phase, i, { urgent, reduced })
        this._sonarRings[i].mesh.scale.setScalar(f.scale * base)
        this._sonarRings[i].mat.opacity = f.opacity * entry.opacity
      }
    } else if (this._placeType === 'Anchor') {
      const urgent = this._toleranceViolated
      const f = anchorFrame(t, phase, { urgent, reduced })
      this._crosshairs.scale.setScalar(f.scale * base)
      this._crosshairMat.opacity = CROSSHAIR_OPACITY * entry.opacity
      // A tight spot that flares with the kick — a datum re-seated under its light.
      this._halo.scale.setScalar(base * ANCHOR_SPOT * f.scale * grow)
      this._haloMat.opacity = f.haloOpacity * gain * entry.opacity
      for (const r of this._sonarRings) r.mat.opacity = 0
    } else {
      // Unclassified: no type claim to assert, so no Tier A motion — but not a
      // dead frame either (品質ゲート5). A faint steady halo keeps it present,
      // and the entry pop still plays.
      this._halo.scale.setScalar(base * grow)
      this._haloMat.opacity = 0.12 * gain * entry.opacity
      for (const r of this._sonarRings) r.mat.opacity = 0
    }
  }

  // ── Label update (call once per frame while visible) ───────────────────────

  /**
   * Anchors the name label at the marker.
   * Must be called from the animation loop (AppController._animate) while visible.
   * @param {import('three').Camera} [camera]  Active camera to use for projection
   *   (orthographic in the Map viewpoint). Falls back to the stored camera.
   */
  updateLabelPosition(camera) {
    const cam = camera ?? this._camera
    if (!cam || !this._life.present) return
    this._label.updatePosition(cam, this._point)
  }

  /**
   * The LOGICAL fact: the annotation exists for the user (pickable, counted).
   * False from the moment of a soft delete, while the light is still going out
   * — hit-testing reads this, so a leaving annotation is never picked (M3b).
   */
  get visible() { return this._life.present }

  /** True while any part is on screen (present, or still exiting). */
  get drawn() { return this._drawn }

  // ── Move support ───────────────────────────────────────────────────────────

  /**
   * Refreshes position after entity.move().
   * corners = [position] — single-element array.
   * @param {THREE.Vector3[]} corners
   */
  updateGeometry(corners) {
    if (!corners || corners.length === 0) return
    this._setPoint(corners[0])
  }

  /**
   * Kept for the polymorphic contract (PHILOSOPHY #17 — the commands call it
   * on every entity view). There is no box to refresh: selection is the light.
   */
  updateBoxHelper() {}

  // ── Place type (color) update ──────────────────────────────────────────────

  /**
   * Updates mesh and ring color when placeType changes.
   * @param {string|null} placeType
   * @param {string}      name  entity name (label text may reflect place type label)
   */
  setPlaceType(placeType, name) {
    this._placeType = placeType
    this._applyColors()
    this._label.setAccent(this._cssColor(placeType))
    // Reset sonar scale so the ping animation restarts cleanly from the new type
    for (const r of this._sonarRings) r.mesh.scale.setScalar(this._viewScale)
    if (name) {
      this._name = name
      this._label.setText(name)
    }
    this._applyPlaceTypeVisuals(placeType)
  }

  /** Updates the label text (e.g. after rename). */
  setName(name) {
    this._name = name
    this._label.setText(name)
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  /**
   * The logical show/hide (ADR-166 M3b). A hide arms the exit — the meshes
   * stay drawn until the light has gone out (the next ticks own that); a
   * re-show (undo of a soft delete) replays the entry pop. Both are owned by
   * the lifecycle reducers (#4), not by the undo call sites.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._life = visible ? lifecycleShow(this._life) : lifecycleHide(this._life)
    this._label.setWanted(visible)
    if (visible) this._setDrawn(true)
    else if (!this._life.exitPending) this._setDrawn(false)   // never seen — nothing to put out
  }

  /**
   * Sole writer of mesh visibility (PHILOSOPHY #4) — the DRAWN state, derived
   * from the lifecycle phase. Never call with the logical fact directly.
   * @param {boolean} drawn
   */
  _setDrawn(drawn) {
    if (this._drawn === drawn) return
    this._drawn = drawn
    this._mesh.visible = drawn
    this._ring.visible = drawn
    this._halo.visible = drawn
    for (const r of this._sonarRings) r.mesh.visible = drawn
    this._crosshairs.visible = drawn && this._placeType === 'Anchor'
    if (this._bridgeLine) this._bridgeLine.visible = drawn
  }

  /**
   * Selection = the floor light rising and growing on the `land` curve (the
   * next tick starts the segment) + the label's highlight. Sole writer of both.
   * @param {boolean} sel
   */
  setObjectSelected(sel) {
    this._isSelected = sel
    this._label.setHighlighted(sel)
  }

  /**
   * Updates Hub visual state when a tact-time constraint is violated.
   * When violated: marker/ring turns red; sonar ping period doubles in speed.
   * When cleared: reverts to place-type color.
   * @param {boolean} violated
   */
  setTactTimeViolated(violated) {
    if (this._tactViolated === violated) return
    this._tactViolated = violated
    this._applyColors()
  }

  /**
   * Updates Anchor visual state when a tolerance constraint is violated.
   * When violated: crosshairs + marker turn red; pulse period shortens to 1 s.
   * When cleared: reverts to place-type color.
   * @param {boolean} violated
   */
  /**
   * @param {boolean}     violated
   * @param {string|null} cfId  CF entity ID to draw error bridge toward, or null to clear.
   */
  setToleranceViolated(violated, cfId = null) {
    if (this._toleranceViolated === violated && this._bridgeCfId === cfId) return
    this._toleranceViolated = violated
    this._bridgeCfId = violated ? cfId : null
    this._applyColors()
    // Dispose bridge line when clearing violation.
    if (!violated && this._bridgeLine) {
      this._scene.remove(this._bridgeLine)
      this._bridgeLine.geometry.dispose()
      this._bridgeLine.material.dispose()
      this._bridgeLine = null
    }
  }

  /**
   * Updates the error bridge line endpoint to track the CF world position.
   * Creates the bridge line lazily on first call.
   * @param {import('three').Scene} scene
   * @param {import('three').Vector3} cfWorldPos
   */
  updateBridgeLine(scene, cfWorldPos) {
    if (!this._bridgeCfId || !this._toleranceViolated) return
    const anchorPos = this._mesh.position
    if (!this._bridgeLine) {
      const geo = new THREE.BufferGeometry()
      const mat = new THREE.LineDashedMaterial({
        color:       0xEF4444,
        dashSize:    0.08,
        gapSize:     0.06,
        transparent: true,
        opacity:     0.9,
        depthTest:   false,
      })
      this._bridgeLine = new THREE.Line(geo, mat)
      this._bridgeLine.renderOrder = 3
      this._scene = scene
      scene.add(this._bridgeLine)
    }
    const pts = [anchorPos.x, anchorPos.y, anchorPos.z, cfWorldPos.x, cfWorldPos.y, cfWorldPos.z]
    this._bridgeLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this._bridgeLine.geometry.attributes.position.needsUpdate = true
    this._bridgeLine.computeLineDistances()
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
   * Removes all Three.js objects from the scene and the label from the DOM.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    this._unsubReduced()
    // A disposed view is gone for good: no exit can play on released GPU
    // resources, so the record lands on hidden and the drawn flag drops.
    this._life  = { present: false, bornAt: null, exitAt: null, exitPending: false }
    this._drawn = false
    scene.remove(this._mesh)
    scene.remove(this._ring)
    scene.remove(this._halo)
    for (const r of this._sonarRings) scene.remove(r.mesh)
    scene.remove(this._crosshairs)
    if (this._bridgeLine) {
      scene.remove(this._bridgeLine)
      this._bridgeLine.geometry.dispose()
      this._bridgeLine.material.dispose()
      this._bridgeLine = null
    }
    this._geo.dispose()
    this._mat.dispose()
    this._ringGeo.dispose()
    this._ringMat.dispose()
    this._sonarGeo.dispose()                 // shared by every ring in the train
    for (const r of this._sonarRings) r.mat.dispose()
    this._sonarRings = []
    this._haloGeo.dispose()
    this._haloMat.dispose()                  // the sprite map is module-owned (DecalTextures)
    this._crosshairs.geometry.dispose()
    this._crosshairMat.dispose()
    this._label.dispose()
  }
}
