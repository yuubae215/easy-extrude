// @ts-nocheck
/**
 * GraspDeclarationView — the grasp declaration drawn on the object it is about
 * (ADR-152 D2/D6): face labels with their world words and the object's local
 * triad; the focused spec's approach region, approach arrow, tilt cone, striped
 * contact faces, closing arrow and depth plane; the open finger sections or the
 * cup; and a translucent preview of the declared hand where the spec puts it.
 *
 * Every primitive comes from `GraspDeclarationMath.declarationPicture` — this
 * class only turns them into meshes. **It never judges**: a finger section that
 * overlaps a tray wall is drawn in the same colour as one that does not
 * (ADR-152: 3D の確認は当たりを色で言わない — whether it hits is core/'s answer).
 *
 * Read-only output projection, sibling of `GraspSampleView`. Sole owner =
 * GraspController (原則 #4/#9): constructed through an injected factory, refreshed
 * when the declaration / focus / hover / hand changes, disposed with the panel.
 *
 * @module view/GraspDeclarationView
 */
import * as THREE from 'three'
import { COLOR } from '../theme/tokens.js'
import { hatchTexture } from './DecalTextures.js'

export class GraspDeclarationView {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this._scene = scene
    this._group = new THREE.Group()
    this._group.visible = false
    scene.add(this._group)

    // Roles, not new colours (ADR-100): a DECLARED fact is `infoTone` (as the
    // declared samples are); the contact faces are a constraint (`snapTone`);
    // the hand is the neutral body colour; the local triad uses the axis roles.
    const basic = (color, opacity, extra = {}) => new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, ...extra,
    })
    const line = (color, opacity) => new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity })
    this._hatch = hatchTexture()
    this._mat = {
      hover:    basic(COLOR.infoTone, 0.35),
      region:   line(COLOR.infoTone, 0.95),
      faint:    line(COLOR.infoTone, 0.3),
      contact:  basic(COLOR.snapTone, 0.55, { map: this._hatch }),
      depth:    basic(COLOR.measure, 0.28),
      finger:   basic(COLOR.entityDefault, 0.75),
      clear:    line(COLOR.entityDefault, 0.6),
      hand:     basic(COLOR.entityDefault, 0.28),
      cone:     basic(COLOR.infoTone, 0.12),
      cup:      line(COLOR.infoTone, 0.95),
      axisX:    line(COLOR.axisX, 0.9),
      axisY:    line(COLOR.axisY, 0.9),
      axisZ:    line(COLOR.axisZ, 0.9),
    }
    /** per-render disposables */
    this._owned = []
  }

  /**
   * Draw one picture (replacing the last). `null` hides the overlay.
   * @param {import('./GraspDeclarationMath.js').DeclarationPicture|null} pic
   */
  show(pic) {
    this._clear()
    if (!pic) { this._group.visible = false; return }
    const labelHeight = pic.extent * 0.09

    for (const l of pic.faceLabels) this._label(l.text, l.position, labelHeight)
    const t = pic.triad
    ;[this._mat.axisX, this._mat.axisY, this._mat.axisZ].forEach((m, i) =>
      this._lines([t.origin, t.origin.map((v, k) => v + t.axes[i][k] * t.length)], m))

    if (pic.hover) this._quad(pic.hover, this._mat.hover)
    for (const outline of pic.otherApproaches) this._loop(outline, this._mat.faint)

    const f = pic.focused
    if (f) {
      this._loop(f.region, this._mat.region)
      this._arrow(f.arrow.from, f.arrow.to, COLOR.infoTone, pic.extent * 0.12)
      if (f.cone) this._cone(f.cone)
      for (const c of f.contact ?? []) this._quad(c, this._mat.contact)
      if (f.closingArrow) {
        const mid = f.closingArrow.a.map((v, i) => (v + f.closingArrow.b[i]) / 2)
        this._arrow(mid, f.closingArrow.a, COLOR.snapTone, pic.extent * 0.08)
        this._arrow(mid, f.closingArrow.b, COLOR.snapTone, pic.extent * 0.08)
      }
      if (f.depthPlane) this._quad(f.depthPlane, this._mat.depth)
      for (const fs of f.fingers ?? []) {
        this._quad(fs.section, this._mat.finger)
        if (fs.clearance) this._loop(fs.clearance, this._mat.clear)
      }
      if (f.cup) this._cup(f.cup)
      for (const part of f.preview ?? []) this._part(part)
    }
    this._group.visible = true
  }

  clear() { this._clear(); this._group.visible = false }

  // ── primitives ──────────────────────────────────────────────────────────────

  _add(obj, geometry) {
    this._group.add(obj)
    this._owned.push({ obj, geometry })
  }

  _lines(points, material) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
    this._add(new THREE.LineSegments(g, material), g)
  }

  _loop(points, material) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
    this._add(new THREE.LineLoop(g, material), g)
  }

  _quad(c, material) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([...c[0], ...c[1], ...c[2], ...c[3]], 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 4, 0, 4, 4, 0, 4], 2))
    g.setIndex([0, 1, 2, 0, 2, 3])
    this._add(new THREE.Mesh(g, material), g)
  }

  _arrow(from, to, color, head) {
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const len = dir.length()
    if (!(len > 0)) return
    const arrow = new THREE.ArrowHelper(dir.normalize(), new THREE.Vector3(...from), len, new THREE.Color(color), head, head * 0.5)
    this._group.add(arrow)
    this._owned.push({ obj: arrow, dispose: () => arrow.dispose() })
  }

  _cone({ apex, axis, halfAngle, length }) {
    const r = Math.tan(halfAngle) * length
    const g = new THREE.ConeGeometry(r, length, 24, 1, true)
    // THREE's cone points +Y with its tip at +length/2; we want the tip at the
    // apex and the opening along +axis (outside the face).
    g.rotateX(Math.PI)
    g.translate(0, length / 2, 0)
    const mesh = new THREE.Mesh(g, this._mat.cone)
    mesh.position.set(...apex)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axis).normalize())
    this._add(mesh, g)
  }

  _cup({ center, normal, radius, sealHalfAngle }) {
    const n = new THREE.Vector3(...normal).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
    const pts = []
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0).applyQuaternion(q).add(new THREE.Vector3(...center)))
    }
    this._loop(pts.map(p => [p.x, p.y, p.z]), this._mat.cup)
    if (sealHalfAngle != null) this._cone({ apex: center, axis: normal, halfAngle: sealHalfAngle, length: radius * 1.5 })
  }

  _part({ shape, center, axes, size }) {
    const g = shape === 'cylinder'
      ? new THREE.CylinderGeometry(size[0], size[0], size[1], 24).rotateX(Math.PI / 2)
      : new THREE.BoxGeometry(size[0], size[1], size[2])
    const mesh = new THREE.Mesh(g, this._mat.hand)
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...axes[0]), new THREE.Vector3(...axes[1]), new THREE.Vector3(...axes[2]))
    mesh.quaternion.setFromRotationMatrix(m)
    mesh.position.set(...center)
    this._add(mesh, g)
  }

  _label(text, position, height) {
    if (typeof document === 'undefined') return
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = 'bold 40px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = COLOR.textPrimary
    ctx.fillText(text, 128, 34)
    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(height * 4, height, 1)
    sprite.position.set(...position)
    this._group.add(sprite)
    this._owned.push({ obj: sprite, dispose: () => { texture.dispose(); material.dispose() } })
  }

  /** Remove and free everything the last `show` added (symmetric — 原則 #9). */
  _clear() {
    for (const o of this._owned) {
      this._group.remove(o.obj)
      o.geometry?.dispose()
      o.dispose?.()
    }
    this._owned = []
  }

  dispose() {
    this._clear()
    this._scene.remove(this._group)
    for (const m of Object.values(this._mat)) m.dispose()
    this._hatch.dispose()
  }
}
