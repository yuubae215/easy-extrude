/**
 * AnnotatedPointView — renderer for AnnotatedPoint domain entities.
 *
 * Renders:
 *  - A flat circle mesh (CylinderGeometry, low height) in place-type color; grey when unclassified
 *  - An HTML label showing the point name, positioned above the mesh
 *  - A BoxHelper for selection highlight
 *
 * Animations (called via tick(t) each frame):
 *  - Hub:    sonar-ping ring expands and fades every 2 s (beacon / junction feel)
 *  - Anchor: crosshair pulse — 4 line segments (±X, ±Y) scale 1.0×→1.3×, 4 s sine (ADR-031 §8)
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView
 * so AppController's setMode() and mode-agnostic calls are safe.
 *
 * Note: no `cuboid` property — AnnotatedPoint is excluded from raycasting.
 * Move support: updateGeometry([position]) refreshes point position.
 *
 * @see ADR-029, ADR-031
 */
import * as THREE from 'three'
import { getPlaceTypeEntry } from '../domain/PlaceTypeRegistry.js'

const DEFAULT_COLOR     = 0x888888
const MARKER_RADIUS     = 0.25
const MARKER_HEIGHT     = 0.04
const CROSSHAIR_LEN     = 0.45   // half-length; extends beyond MARKER_RADIUS so arms are visible outside the dot
const CROSSHAIR_OPACITY = 0.90   // high opacity for contrast against colored marker

export class AnnotatedPointView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Camera}  camera
   * @param {HTMLElement}   container   DOM element to append the label to
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Vector3} point       anchor position
   * @param {string}        name        entity name (shown in label)
   * @param {string|null}   placeType   'Hub' | 'Anchor' | null
   */
  constructor(scene, camera, container, renderer, point, name, placeType) {
    this._scene    = scene
    this._camera   = camera
    this._renderer = renderer
    this._placeType = placeType

    // ── Circle marker mesh ─────────────────────────────────────────────────
    this._geo = new THREE.CylinderGeometry(MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 16)
    this._mat = new THREE.MeshBasicMaterial({
      color:              this._colorForType(placeType),
      depthTest:          true,
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
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

    // ── Sonar-ping ring (Hub animation) ───────────────────────────────────
    // Expands from the marker outward and fades, giving a "broadcasting node" feel.
    // For non-Hub types the ring stays invisible (opacity: 0).
    this._sonarGeo = new THREE.RingGeometry(MARKER_RADIUS * 0.85, MARKER_RADIUS, 16)
    this._sonarMat = new THREE.MeshBasicMaterial({
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
    this._sonarRing = new THREE.Mesh(this._sonarGeo, this._sonarMat)
    this._sonarRing.position.copy(point)
    this._sonarRing.renderOrder = 4
    scene.add(this._sonarRing)

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

    // ── BoxHelper ──────────────────────────────────────────────────────────
    this.boxHelper = new THREE.BoxHelper(this._mesh, 0xffffff)
    this.boxHelper.visible = false
    scene.add(this.boxHelper)

    // ── HTML name label ────────────────────────────────────────────────────
    this._label = document.createElement('div')
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
      borderLeft:    `3px solid #${this._colorForType(placeType).toString(16).padStart(6, '0')}`,
    })
    this._label.textContent = name
    container.appendChild(this._label)

    this._point = point.clone()
    this._name  = name
    this._tactViolated      = false
    this._toleranceViolated = false
    this._bridgeLine = null
    this._bridgeCfId = null
    this._scene      = null   // set lazily in updateBridgeLine()
    // Screen-space scale factor applied on top of the world-unit base geometry.
    // tick() composes its per-frame animation scales with this value.
    this._viewScale  = 1

    // Apply initial place-type visuals
    this._applyPlaceTypeVisuals(placeType)
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
    this._sonarRing.position.copy(point)
    this._crosshairs.position.copy(point)
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  /** Returns hex color for the given place type. */
  _colorForType(placeType) {
    const entry = getPlaceTypeEntry(placeType)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  /**
   * Applies place-type-specific visibility / opacity rules.
   * Called from constructor and setPlaceType().
   * @param {string|null} placeType
   */
  _applyPlaceTypeVisuals(placeType) {
    if (placeType === 'Anchor') {
      this._crosshairs.visible = true
      this._sonarMat.opacity   = 0
      this._ringMat.opacity    = 0.40   // subtle constant outline for Anchor
    } else if (placeType === 'Hub') {
      this._crosshairs.visible = false
      this._ringMat.opacity    = 0.6
    } else {
      this._crosshairs.visible = false
      this._ringMat.opacity    = 0.6
    }
    // Reset crosshair scale so pulse starts from 1.0× (in view-scale units)
    this._crosshairs.scale.setScalar(this._viewScale ?? 1)
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
    this._mesh.scale.setScalar(s)
    this._ring.scale.setScalar(s)
    // Sonar / crosshair scales are recomposed by tick(); keep them in range for
    // non-animated place types so a static frame never shows a stale size.
    this._sonarRing.scale.setScalar(s)
    if (this._placeType !== 'Anchor') this._crosshairs.scale.setScalar(s)
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  // ── Per-frame animation ────────────────────────────────────────────────────

  /**
   * Drives place-type-specific animations.  Called every frame from AppController.
   * @param {number} t  elapsed seconds (performance.now() / 1000)
   */
  tick(t) {
    if (!this._mesh.visible) return
    if (this._placeType === 'Hub') {
      // Sonar ping: ring expands 1× → 4× and fades over a 2 s cycle normally.
      // When tact-time is violated: faster period (0.6 s) and higher peak opacity.
      const period = this._tactViolated ? 0.6 : 2.0
      const phase  = (t % period) / period
      this._sonarRing.scale.setScalar((1 + phase * 3) * this._viewScale)
      this._sonarMat.opacity = (1 - phase) * (this._tactViolated ? 0.9 : 0.65)
      // Outline ring: steady
      this._ringMat.opacity = 0.6
    } else if (this._placeType === 'Anchor') {
      // Crosshair pulse: scale 1.0×→1.3×. Normal = 4 s calm; violated = 1 s urgent.
      // Conveys "pinned in place" (ADR-031 §8); urgency when tolerance exceeded (ADR-043 §4).
      const freq  = this._toleranceViolated ? 2.0 : 0.5   // radians/s → 1 s or 4 s period
      const scale = 1.0 + 0.30 * (Math.sin(t * Math.PI * freq) * 0.5 + 0.5)
      this._crosshairs.scale.setScalar(scale * this._viewScale)
      this._sonarMat.opacity = 0
    } else {
      this._sonarMat.opacity = 0
    }
  }

  // ── Label update (call once per frame while visible) ───────────────────────

  /**
   * Projects anchor position to screen and updates label position.
   * Must be called from the animation loop (AppController._animate) while visible.
   * @param {import('three').Camera} [camera]  Active camera to use for projection.
   *   When Map mode uses an orthographic camera, pass that camera here so the
   *   label tracks the rendered position correctly.  Falls back to the stored
   *   perspective camera if omitted.
   */
  updateLabelPosition(camera) {
    const cam = camera ?? this._camera
    if (!this._mesh.visible) return
    const ndc    = this._point.clone().project(cam)
    const canvas = this._renderer.domElement
    const rect   = canvas.getBoundingClientRect()
    const sx = (ndc.x  + 1) / 2 * rect.width  + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top

    if (ndc.z > 1) { this._label.style.display = 'none'; return }

    this._label.style.display = 'block'
    this._label.style.left    = `${Math.round(sx + MARKER_RADIUS * 20 + 4)}px`
    this._label.style.top     = `${Math.round(sy - 10)}px`
  }

  /** True when the marker is shown in the scene (false when soft-deleted). */
  get visible() { return this._mesh.visible }

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

  /** Refreshes BoxHelper after confirm/cancel grab. */
  updateBoxHelper() {
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  // ── Place type (color) update ──────────────────────────────────────────────

  /**
   * Updates mesh and ring color when placeType changes.
   * @param {string|null} placeType
   * @param {string}      name  entity name (label text may reflect place type label)
   */
  setPlaceType(placeType, name) {
    this._placeType = placeType
    const hex = this._colorForType(placeType)
    this._mat.color.setHex(hex)
    this._ringMat.color.setHex(hex)
    this._sonarMat.color.setHex(hex)
    // Crosshair stays white for contrast — do not tint with place-type color
    this.boxHelper.material?.color.setHex(hex)
    const hexStr = hex.toString(16).padStart(6, '0')
    this._label.style.borderLeft = `3px solid #${hexStr}`
    // Reset sonar scale so the ping animation restarts cleanly from the new type
    this._sonarRing.scale.setScalar(this._viewScale)
    if (name) {
      this._name = name
      this._label.textContent = name
    }
    this._applyPlaceTypeVisuals(placeType)
  }

  /** Updates the label text (e.g. after rename). */
  setName(name) {
    this._name = name
    this._label.textContent = name
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._mesh.visible      = visible
    this._ring.visible      = visible
    this._sonarRing.visible = visible
    this._crosshairs.visible = visible && this._placeType === 'Anchor'
    this._label.style.display = visible ? 'block' : 'none'
    if (!visible) this.boxHelper.visible = false
  }

  setObjectSelected(sel) {
    this.boxHelper.visible = sel
    if (sel) this.boxHelper.update()
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
    const hex = violated ? 0xEF4444 : this._colorForType(this._placeType)
    this._mat.color.setHex(hex)
    this._sonarMat.color.setHex(hex)
    this._ringMat.color.setHex(hex)
    this.boxHelper.material?.color.setHex(hex)
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
    const hex = violated ? 0xEF4444 : this._colorForType(this._placeType)
    this._mat.color.setHex(hex)
    this._ringMat.color.setHex(hex)
    this._crosshairMat.color.setHex(violated ? 0xEF4444 : 0xffffff)
    this.boxHelper.material?.color.setHex(violated ? 0xEF4444 : 0xffffff)
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
    scene.remove(this._mesh)
    scene.remove(this._ring)
    scene.remove(this._sonarRing)
    scene.remove(this._crosshairs)
    scene.remove(this.boxHelper)
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
    this._sonarGeo.dispose()
    this._sonarMat.dispose()
    this._crosshairs.geometry.dispose()
    this._crosshairMat.dispose()
    this._label.remove()
  }
}
