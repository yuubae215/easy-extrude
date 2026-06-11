// @ts-nocheck
/**
 * UncertaintyGhostView — 3D visualization of an unresolved interval fact (ADR-047).
 *
 * Renders the swept volume of an entity whose position along one axis is an
 * interval (e.g. 「3m弱」= [2700, 3000] mm) rather than a single value:
 *  - A translucent amber band covering every position the entity could occupy
 *  - Wireframe boxes at the two interval extremes
 *  - An optional blue wireframe at the Decision's nominal position
 *  - An HTML label (「2700–3000 mm · 未確定」) above the band
 *
 * The band pulses while idle; startCollapse() animates it snapping to the
 * nominal position — the visual for "an interval is only collapsed by an
 * explicit Decision" (ADR-046 invariant 2).
 *
 * Lifecycle mirrors RippleEffect: constructor adds to scene; tick(t) returns
 * true when the collapse animation has fully finished; the owning controller
 * calls dispose(). (PHILOSOPHY #9 — allocations and deallocations symmetric;
 * sole owner is ContextDemoController — PHILOSOPHY #4)
 */
import * as THREE from 'three'

const COLLAPSE_DURATION = 0.8   // seconds: band shrinks onto the nominal box
const FADE_DURATION     = 0.25  // seconds: residual fade-out after the snap

const BAND_COLOR    = 0xd5a23a  // amber — uncertainty
const NOMINAL_COLOR = 0x3a7bd5  // blue — proposed decision

export class UncertaintyGhostView {
  /**
   * @param {THREE.Scene}  scene
   * @param {HTMLElement}  container  DOM element for the HTML label
   * @param {object}       cfg
   * @param {'x'|'y'|'z'}  cfg.axis      interval axis
   * @param {[number, number]} cfg.interval  [lo, hi] of the entity center position
   * @param {number}       cfg.nominal   Decision nominal value on the axis
   * @param {{x,y,z}}      cfg.dims      entity dimensions
   * @param {{x,y,z}}      cfg.position  resolved entity center (non-axis components used)
   * @param {string}       cfg.labelText e.g. "2700–3000 mm · 未確定"
   */
  constructor(scene, container, { axis, interval, nominal, dims, position, labelText }) {
    this._scene   = scene
    this._axis    = axis
    this._lo      = interval[0]
    this._hi      = interval[1]
    this._nominal = nominal
    this._dims    = dims

    // Collapse animation state — written only by startCollapse() / tick().
    this._phase         = 'idle'   // 'idle' | 'collapsing' | 'fading' | 'done'
    this._collapseStart = 0
    this._onSnapped     = null
    this._onDone        = null

    // ── Band mesh: swept volume of the entity over the interval ─────────────
    // Extent along the interval axis = (hi - lo) + entity size on that axis.
    this._bandCenter = new THREE.Vector3(position.x, position.y, position.z)
    this._bandCenter[axis] = (this._lo + this._hi) / 2
    this._bandSize = new THREE.Vector3(dims.x, dims.y, dims.z)
    this._bandSize[axis] = (this._hi - this._lo) + dims[axis]

    const bandMat = new THREE.MeshBasicMaterial({
      color:       BAND_COLOR,
      transparent: true,
      opacity:     0.12,
      depthTest:   true,    // scene object, not an overlay (Annotation depthTest contract)
      depthWrite:  false,
    })
    this._band = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), bandMat)
    this._band.position.copy(this._bandCenter)
    this._band.scale.copy(this._bandSize)
    this._band.renderOrder = 1
    scene.add(this._band)

    // ── Wireframes at the interval extremes (entity-sized) ──────────────────
    // EdgesGeometry, not BoxHelper (BoxHelper is forbidden for baked geometry).
    const extremeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(dims.x, dims.y, dims.z))
    this._extremeMats = [
      new THREE.LineBasicMaterial({ color: BAND_COLOR, transparent: true, opacity: 0.55 }),
      new THREE.LineBasicMaterial({ color: BAND_COLOR, transparent: true, opacity: 0.55 }),
    ]
    this._extremes = [this._lo, this._hi].map((v, i) => {
      const wire = new THREE.LineSegments(extremeGeo, this._extremeMats[i])
      wire.position.copy(this._bandCenter)
      wire.position[axis] = v
      scene.add(wire)
      return wire
    })
    this._extremeGeo = extremeGeo

    // ── Nominal wireframe (blue, hidden until the DecisionCard is shown) ────
    this._nominalMat = new THREE.LineBasicMaterial({ color: NOMINAL_COLOR, transparent: true, opacity: 0.9 })
    this._nominalWire = new THREE.LineSegments(extremeGeo, this._nominalMat)
    this._nominalWire.position.copy(this._bandCenter)
    this._nominalWire.position[axis] = nominal
    this._nominalWire.visible = false
    scene.add(this._nominalWire)

    // ── HTML label (MeasureLineView pattern) ─────────────────────────────────
    this._container = container
    this._label = document.createElement('div')
    Object.assign(this._label.style, {
      position:      'fixed',
      pointerEvents: 'none',
      userSelect:    'none',
      background:    'rgba(30, 30, 30, 0.85)',
      color:         '#d5a23a',
      fontSize:      '12px',
      fontFamily:    'monospace',
      padding:       '3px 8px',
      borderRadius:  '3px',
      border:        '1px solid #d5a23a',
      whiteSpace:    'nowrap',
      display:       'none',
      zIndex:        '50',
    })
    this._label.textContent = labelText
    container.appendChild(this._label)

    this._visible = true
  }

  // ── Visibility (step staging) ────────────────────────────────────────────

  setVisible(visible) {
    this._visible = visible
    this._band.visible = visible
    for (const w of this._extremes) w.visible = visible
    if (!visible) {
      this._nominalWire.visible = false
      this._label.style.display = 'none'
    }
  }

  /** Shows/hides the blue nominal-position wireframe (DecisionCard step). */
  showNominal(show) {
    this._nominalWire.visible = show && this._visible && this._phase === 'idle'
  }

  // ── Collapse animation ───────────────────────────────────────────────────

  /**
   * Starts the snap-to-nominal animation.
   * @param {{ onSnapped?: () => void, onDone?: () => void }} callbacks
   *   onSnapped — band has reached the nominal box (reveal the real solid here)
   *   onDone    — fade-out finished; tick() will also return true from now on
   */
  startCollapse({ onSnapped, onDone } = {}) {
    if (this._phase !== 'idle') return
    this._phase         = 'collapsing'
    this._collapseStart = performance.now() / 1000
    this._onSnapped     = onSnapped ?? null
    this._onDone        = onDone ?? null
  }

  /** True once startCollapse() has been called. */
  get collapsing() { return this._phase !== 'idle' }

  /**
   * Advances pulse/collapse animation and repositions the HTML label.
   * Call once per animation frame.
   * @param {number} t  seconds (performance.now() / 1000)
   * @param {THREE.Camera} camera     SceneView.activeCamera (HTML Overlay contract)
   * @param {THREE.WebGLRenderer} renderer
   * @returns {boolean} true when the collapse has fully finished (caller disposes)
   */
  tick(t, camera, renderer) {
    if (this._phase === 'done') return true
    if (!this._visible) return false

    if (this._phase === 'idle') {
      // Gentle opacity pulse: 0.08 .. 0.16
      this._band.material.opacity = 0.12 + 0.04 * Math.sin(t * 2)
      this._updateLabel(camera, renderer)
      return false
    }

    const elapsed = t - this._collapseStart

    if (this._phase === 'collapsing') {
      const p    = Math.min(elapsed / COLLAPSE_DURATION, 1)
      const ease = 1 - Math.pow(1 - p, 3)   // cubic ease-out

      // Band shrinks along the axis onto the nominal box.
      const size   = this._bandSize[this._axis] + (this._dims[this._axis] - this._bandSize[this._axis]) * ease
      const center = this._bandCenter[this._axis] + (this._nominal - this._bandCenter[this._axis]) * ease
      this._band.scale[this._axis]    = size
      this._band.position[this._axis] = center
      this._band.material.opacity = 0.16 + 0.24 * ease   // brighten as it condenses

      // Extremes and nominal wire fade out during the snap.
      for (const m of this._extremeMats) m.opacity = 0.55 * (1 - ease)
      this._nominalMat.opacity = 0.9 * (1 - ease)
      this._label.style.display = 'none'

      if (p >= 1) {
        this._phase = 'fading'
        this._collapseStart = t
        this._onSnapped?.()
        this._onSnapped = null
      }
      return false
    }

    // 'fading': residual amber shell fades over the revealed solid.
    const p = Math.min(elapsed / FADE_DURATION, 1)
    this._band.material.opacity = 0.4 * (1 - p)
    if (p >= 1) {
      this._phase = 'done'
      this._onDone?.()
      this._onDone = null
      return true
    }
    return false
  }

  _updateLabel(camera, renderer) {
    if (!camera || !renderer) return
    // Anchor: top-center of the band.
    const anchor = this._band.position.clone()
    anchor.z += this._bandSize.z / 2
    const ndc = anchor.project(camera)
    if (ndc.z > 1) { this._label.style.display = 'none'; return }
    const rect = renderer.domElement.getBoundingClientRect()
    const sx = (ndc.x + 1) / 2 * rect.width  + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top
    this._label.style.display = 'block'
    this._label.style.left = `${Math.round(sx)}px`
    this._label.style.top  = `${Math.round(sy - 28)}px`
  }

  dispose() {
    this._scene.remove(this._band)
    this._band.geometry.dispose()
    this._band.material.dispose()
    for (const w of this._extremes) this._scene.remove(w)
    this._scene.remove(this._nominalWire)
    this._extremeGeo.dispose()              // shared by extremes + nominal wire
    for (const m of this._extremeMats) m.dispose()
    this._nominalMat.dispose()
    this._label.remove()
    this._phase = 'done'
  }
}
