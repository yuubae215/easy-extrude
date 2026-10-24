// @ts-nocheck
/**
 * ArrangementStatusView — the declared relations drawn where their words point
 * (ADR-168 S1b): the surfaces in contact, the separation and its gap, the
 * declared face of the partner, the vertical guide, the viewer with its facing
 * arrow and the lines its left / right and front / back are read against, and
 * one caption per side naming who said it and how it stands.
 *
 * Every primitive comes from `ArrangementStatusMath.arrangementPicture` — this
 * class only turns them into meshes, in the colour ROLE each one names
 * (ADR-100). It never decides a status: the tone it is handed is the status the
 * domain decided.
 *
 * Read-only output projection, sibling of `GraspDeclarationView`. Sole owner =
 * ArrangementController (原則 #4/#9): constructed through an injected factory,
 * redrawn when the document or the focus changes, disposed with its owner.
 *
 * @module view/ArrangementStatusView
 */
import * as THREE from 'three'
import { COLOR } from '../theme/tokens.js'

/**
 * Label heights as a fraction of the viewport (sprites with `sizeAttenuation:
 * false`): a constant screen size, so a caption neither balloons when the camera
 * closes in on a 60 mm workpiece nor vanishes over a whole cell (原則 #27 — the
 * world-unit label of the first cut covered the screen once framed on a bin).
 */
const LABEL = Object.freeze({ caption: 0.026, small: 0.02 })

export class ArrangementStatusView {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this._scene = scene
    this._group = new THREE.Group()
    this._group.visible = false
    scene.add(this._group)
    /** tone role → { fill, edge, line, dashed } — built on first use, freed in dispose */
    this._byTone = new Map()
    /** per-render disposables */
    this._owned = []
  }

  /**
   * Draw one picture (replacing the last). `null` hides the overlay.
   * @param {ReturnType<typeof import('./ArrangementStatusMath.js').arrangementPicture>} pic
   */
  show(pic) {
    this._clear()
    if (!pic) { this._group.visible = false; return }
    for (const item of pic.items) {
      // A caption has no single tone — its segments carry theirs (C4).
      const m = item.kind === 'caption' ? null : this._mat(item.tone)
      switch (item.kind) {
        case 'contactPatch':
          this._quad(item.corners, m.fill)
          this._loop(item.corners, m.edge)
          break
        case 'separation':
          this._dashed([item.from, item.to], m.dashed)
          this._label([{ text: item.caption, tone: item.tone }], item.from.map((v, k) => (v + item.to[k]) / 2), LABEL.small)
          break
        case 'facePaint':
          this._quad(item.corners, m.faint)
          this._loop(item.corners, m.edge)
          this._label([{ text: item.caption, tone: item.tone }], item.at, LABEL.small)
          break
        case 'verticalGuide':
          this._lines([item.from, item.to], m.line)
          this._label([{ text: item.caption, tone: item.tone }], item.from.map((v, k) => (v + item.to[k]) / 2), LABEL.small)
          break
        case 'viewerAxes':
          this._marker(item.viewer, pic.extent * 0.08, m.fill)
          this._arrow(item.viewer, item.facing, COLOR[item.tone], pic.extent * 0.12)
          for (const line of item.lines) this._dashed(line, m.dashed)
          for (const q of item.quadrantLabels) this._label([{ text: q.text, tone: item.tone }], q.at, LABEL.small)
          break
        case 'caption':
          this._label(item.segments, item.at, LABEL.caption, item.row)
          break
        default:
          // A primitive this view does not know is not drawn as nothing (原則 #31).
          throw new Error(`ArrangementStatusView: unknown primitive "${item.kind}"`)
      }
    }
    this._group.visible = true
  }

  clear() { this._clear(); this._group.visible = false }

  // ── materials (roles, not new colours — ADR-100) ─────────────────────────────

  _mat(tone) {
    let m = this._byTone.get(tone)
    if (m) return m
    const color = new THREE.Color(COLOR[tone] ?? COLOR.entityDefault)
    m = {
      fill:   new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
      faint:  new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
      edge:   new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      line:   new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      dashed: new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.85, dashSize: 20, gapSize: 12 }),
    }
    this._byTone.set(tone, m)
    return m
  }

  // ── primitives ──────────────────────────────────────────────────────────────

  _add(obj, geometry) {
    this._group.add(obj)
    this._owned.push({ obj, geometry })
  }

  _lines(points, material) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
    this._add(new THREE.LineSegments(g, material), g)
  }

  _dashed(points, material) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
    const line = new THREE.Line(g, material)
    line.computeLineDistances()
    this._add(line, g)
  }

  _loop(points, material) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
    this._add(new THREE.LineLoop(g, material), g)
  }

  _quad(c, material) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([...c[0], ...c[1], ...c[2], ...c[3]], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const mesh = new THREE.Mesh(g, material)
    mesh.renderOrder = 5   // over the surface it lies on
    this._add(mesh, g)
  }

  _marker(at, radius, material) {
    const g = new THREE.SphereGeometry(radius, 16, 12)
    const mesh = new THREE.Mesh(g, material)
    mesh.position.set(...at)
    this._add(mesh, g)
  }

  _arrow(from, to, color, head) {
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const len = dir.length()
    if (!(len > 0)) return
    const arrow = new THREE.ArrowHelper(dir.normalize(), new THREE.Vector3(...from), len, new THREE.Color(color), head, head * 0.5)
    this._group.add(arrow)
    this._owned.push({ obj: arrow, dispose: () => arrow.dispose() })
  }

  /**
   * A screen-sized text sprite at a world point, written as a run of segments
   * each in its own colour role — so a caption can colour only its mark (C4).
   * `row` lifts it by that many label heights above the point (stacked
   * captions — the sprite's own anchor, so the stack is in screen units).
   * @param {Array<{text: string, tone: string}>} segments
   */
  _label(segments, position, height, row = 0) {
    if (typeof document === 'undefined') return
    const canvas = document.createElement('canvas')
    const font = 'bold 40px sans-serif'
    const probe = canvas.getContext('2d')
    if (!probe) return
    probe.font = font
    const widths = segments.map(g => probe.measureText(g.text).width)
    const total = widths.reduce((a, b) => a + b, 0)
    canvas.width = Math.min(2048, Math.ceil(total) + 32)
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.font = font
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    let x = (canvas.width - total) / 2
    segments.forEach((g, k) => {
      ctx.fillStyle = COLOR[g.tone] ?? COLOR.textPrimary
      ctx.fillText(g.text, x, 34)
      x += widths[k]
    })
    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(height * canvas.width / canvas.height, height, 1)
    sprite.center.set(0.5, -0.4 - row * 1.15)
    sprite.position.set(...position)
    sprite.renderOrder = 20
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
    for (const m of this._byTone.values()) for (const mat of Object.values(m)) mat.dispose()
    this._byTone.clear()
  }
}
