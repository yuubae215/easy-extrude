/**
 * UrbanMarkerView — renderer for UrbanMarker domain entities.
 *
 * Renders:
 *  - A flat circle mesh (CylinderGeometry, low height) in Lynch color; grey when unclassified
 *  - An HTML label showing the marker name, positioned above the mesh
 *  - A BoxHelper for selection highlight
 *
 * Exposes the same minimal no-op interface as MeasureLineView / ImportedMeshView
 * so AppController's setMode() and mode-agnostic calls are safe.
 *
 * Note: no `cuboid` property — UrbanMarker is excluded from raycasting.
 * Move support: updateGeometry([position]) refreshes marker position.
 *
 * @see ADR-026
 */
import * as THREE from 'three'
import { getLynchClassEntry } from '../domain/LynchClassRegistry.js'

const DEFAULT_COLOR = 0x888888
const MARKER_RADIUS = 0.25
const MARKER_HEIGHT = 0.04

export class UrbanMarkerView {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Camera}  camera
   * @param {HTMLElement}   container   DOM element to append the label to
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Vector3} point       anchor position
   * @param {string}        name        entity name (shown in label)
   * @param {string|null}   lynchClass  'Node' | 'Landmark' | null
   */
  constructor(scene, camera, container, renderer, point, name, lynchClass) {
    this._scene    = scene
    this._camera   = camera
    this._renderer = renderer

    // ── Circle marker mesh ─────────────────────────────────────────────────
    this._geo = new THREE.CylinderGeometry(MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 16)
    this._mat = new THREE.MeshBasicMaterial({
      color:    this._colorForClass(lynchClass),
      depthTest: false,
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
      color:       this._colorForClass(lynchClass),
      depthTest:   false,
      transparent: true,
      opacity:     0.6,
      side:        THREE.DoubleSide,
    })
    this._ring = new THREE.Mesh(this._ringGeo, this._ringMat)
    this._ring.position.copy(point)
    this._ring.renderOrder = 3
    scene.add(this._ring)

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
      borderLeft:    `3px solid #${this._colorForClass(lynchClass).toString(16).padStart(6, '0')}`,
    })
    this._label.textContent = name
    container.appendChild(this._label)

    this._point = point.clone()
    this._name  = name
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  /**
   * Repositions the marker.
   * @param {THREE.Vector3} point
   */
  _setPoint(point) {
    this._point.copy(point)
    this._mesh.position.copy(point)
    this._ring.position.copy(point)
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  /** Returns hex color for the given Lynch class. */
  _colorForClass(lynchClass) {
    const entry = getLynchClassEntry(lynchClass)
    return entry ? parseInt(entry.color.slice(1), 16) : DEFAULT_COLOR
  }

  // ── Label update (call once per frame while visible) ───────────────────────

  /**
   * Projects anchor position to screen and updates label position.
   * Must be called from the animation loop (AppController._animate) while visible.
   */
  updateLabelPosition() {
    if (!this._mesh.visible) return
    const ndc    = this._point.clone().project(this._camera)
    const canvas = this._renderer.domElement
    const rect   = canvas.getBoundingClientRect()
    const sx = (ndc.x  + 1) / 2 * rect.width  + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top

    if (ndc.z > 1) { this._label.style.display = 'none'; return }

    this._label.style.display = 'block'
    this._label.style.left    = `${Math.round(sx + MARKER_RADIUS * 20 + 4)}px`
    this._label.style.top     = `${Math.round(sy - 10)}px`
  }

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

  // ── Lynch class (color) update ─────────────────────────────────────────────

  /**
   * Updates mesh and ring color when lynchClass changes.
   * @param {string|null} lynchClass
   * @param {string}      name  entity name (label text may reflect class label)
   */
  setLynchClass(lynchClass, name) {
    const hex = this._colorForClass(lynchClass)
    this._mat.color.setHex(hex)
    this._ringMat.color.setHex(hex)
    this.boxHelper.material?.color.setHex(hex)
    const hexStr = hex.toString(16).padStart(6, '0')
    this._label.style.borderLeft = `3px solid #${hexStr}`
    if (name) {
      this._name = name
      this._label.textContent = name
    }
  }

  /** Updates the label text (e.g. after rename). */
  setName(name) {
    this._name = name
    this._label.textContent = name
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._mesh.visible  = visible
    this._ring.visible  = visible
    this._label.style.display = visible ? 'block' : 'none'
    if (!visible) this.boxHelper.visible = false
  }

  setObjectSelected(sel) {
    this.boxHelper.visible = sel
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
    scene.remove(this.boxHelper)
    this._geo.dispose()
    this._mat.dispose()
    this._ringGeo.dispose()
    this._ringMat.dispose()
    this._label.remove()
  }
}
