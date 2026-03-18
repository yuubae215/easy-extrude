/**
 * GizmoView - Blender-style world orientation gizmo (top-right corner)
 *
 * Renders X/Y/Z axis indicators on a 2D canvas overlay.
 * Clicking an axis dot snaps the camera to that axis view.
 *
 * Side effects: DOM canvas creation, event listeners.
 */
import * as THREE from 'three'

const AXES = [
  { label: 'X', dir: new THREE.Vector3(1, 0, 0), color: '#e05555', negColor: 'rgba(110,30,30,0.75)' },
  { label: 'Y', dir: new THREE.Vector3(0, 1, 0), color: '#50c060', negColor: 'rgba(25,75,35,0.75)' },
  { label: 'Z', dir: new THREE.Vector3(0, 0, 1), color: '#4d80e6', negColor: 'rgba(25,45,100,0.75)' },
]

const SIZE    = 128
const HALF    = SIZE / 2
const ARM_LEN = 44
const DOT_R   = 9
const NEG_R   = 7

export class GizmoView {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
   */
  constructor(camera, controls) {
    this._camera   = camera
    this._controls = controls
    this._hovered  = null  // e.g. 'X+', 'Y-'

    this._canvas = document.createElement('canvas')
    this._canvas.width  = SIZE
    this._canvas.height = SIZE
    Object.assign(this._canvas.style, {
      position:     'fixed',
      top:          '46px',
      right:        '16px',
      borderRadius: '50%',
      background:   'rgba(24, 24, 40, 0.55)',
      cursor:       'default',
      zIndex:       '10',
      userSelect:   'none',
    })
    document.body.appendChild(this._canvas)

    this._ctx = this._canvas.getContext('2d')

    this._canvas.addEventListener('click',      e => this._onClick(e))
    this._canvas.addEventListener('mousemove',  e => this._onHover(e))
    this._canvas.addEventListener('mouseleave', () => { this._hovered = null; this.update() })
  }

  /** Adjusts the right offset to avoid overlapping the N panel */
  setRightOffset(px) {
    this._canvas.style.right = `${px}px`
  }

  // ── Projection ─────────────────────────────────────────────────────────────

  /** Projects world axes into canvas space using the camera's current rotation */
  _projectAxes() {
    const rot = new THREE.Matrix3().setFromMatrix4(this._camera.matrixWorldInverse)
    return AXES.map(a => {
      const v = a.dir.clone().applyMatrix3(rot)
      return {
        label:    a.label,
        color:    a.color,
        negColor: a.negColor,
        // positive tip
        px: HALF + v.x * ARM_LEN,
        py: HALF - v.y * ARM_LEN,
        // negative tip
        nx: HALF - v.x * ARM_LEN,
        ny: HALF + v.y * ARM_LEN,
        z: v.z,  // depth: positive = facing camera
      }
    })
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  update() {
    const ctx  = this._ctx
    const axes = this._projectAxes()

    ctx.clearRect(0, 0, SIZE, SIZE)

    // Build a flat render list (positive + negative for each axis)
    const items = []
    axes.forEach(a => {
      items.push({ key: a.label + '+', x: a.px, y: a.py, z:  a.z, label: a.label, color: a.color,    pos: true  })
      items.push({ key: a.label + '-', x: a.nx, y: a.ny, z: -a.z, label: '',       color: a.negColor, pos: false })
    })

    // Back-to-front sort so foreground axes overdraw background ones
    items.sort((a, b) => a.z - b.z)

    // 1. Draw all axis lines (center -> tip)
    items.forEach(it => {
      ctx.beginPath()
      ctx.moveTo(HALF, HALF)
      ctx.lineTo(it.x, it.y)
      ctx.strokeStyle = it.color
      ctx.lineWidth   = it.pos ? 2.5 : 1.8
      ctx.stroke()
    })

    // 2. Draw dot + label for each item (back-to-front)
    items.forEach(it => {
      const r         = it.pos ? DOT_R : NEG_R
      const isHovered = this._hovered === it.key

      ctx.beginPath()
      ctx.arc(it.x, it.y, r, 0, Math.PI * 2)
      ctx.fillStyle = isHovered ? '#ffffff' : it.color
      ctx.fill()

      if (it.pos) {
        ctx.fillStyle    = isHovered ? '#222' : '#fff'
        ctx.font         = `bold ${r + 1}px sans-serif`
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(it.label, it.x, it.y)
      }
    })
  }

  // ── Hit testing ────────────────────────────────────────────────────────────

  _getHitKey(canvasX, canvasY) {
    const axes = this._projectAxes()
    let best     = null
    let bestDist = 12  // px hit radius

    axes.forEach(a => {
      const pd = Math.hypot(canvasX - a.px, canvasY - a.py)
      if (pd < bestDist) { bestDist = pd; best = a.label + '+' }
      const nd = Math.hypot(canvasX - a.nx, canvasY - a.ny)
      if (nd < bestDist) { bestDist = nd; best = a.label + '-' }
    })
    return best
  }

  _localCoords(e) {
    const rect = this._canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  _onHover(e) {
    const { x, y } = this._localCoords(e)
    const key = this._getHitKey(x, y)
    this._canvas.style.cursor = key ? 'pointer' : 'default'
    if (key !== this._hovered) {
      this._hovered = key
      this.update()
    }
  }

  _onClick(e) {
    const { x, y } = this._localCoords(e)
    const key = this._getHitKey(x, y)
    if (!key) return

    const target = this._controls.target.clone()
    const dist   = this._camera.position.distanceTo(target)

    // Direction from origin for each axis view
    const viewDirs = {
      'X+': new THREE.Vector3( 1,  0,  0),
      'X-': new THREE.Vector3(-1,  0,  0),
      'Y+': new THREE.Vector3( 0,  1,  0),
      'Y-': new THREE.Vector3( 0, -1,  0),
      'Z+': new THREE.Vector3( 0,  0,  1),
      'Z-': new THREE.Vector3( 0,  0, -1),
    }
    const dir = viewDirs[key]
    if (!dir) return

    // Snap camera position along that axis direction from the orbit target
    this._camera.position.copy(target).addScaledVector(dir, dist)

    // Fix up-vector: top/bottom views (Z+/Z-) use +X as screen-up; others keep +Z up
    if (key === 'Z+' || key === 'Z-') {
      this._camera.up.set(1, 0, 0)  // X (forward) points up on screen in top/bottom view
    } else {
      this._camera.up.set(0, 0, 1)  // ROS convention: +Z is up for all horizontal views
    }

    this._camera.lookAt(target)
    this._controls.update()
    this.update()
  }
}
