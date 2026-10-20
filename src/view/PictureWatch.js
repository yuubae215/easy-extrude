/**
 * PictureWatch — draw a frame only when what the renderer would draw has
 * changed (ADR-166 M7).
 *
 * The loop ran `renderer.render` 60× a second while the cell stood still, and
 * the frame is GPU-bound (rendering skipped = 60 fps under software GL, drawn =
 * 4–5 fps). A frame is a function of the camera, of which objects are drawn,
 * and of each one's transform, geometry and material values — so this writes
 * exactly those into a flat list of numbers and compares it with the last
 * drawn frame's list. Nothing has to declare that it animates: a hover cue, an
 * arriving arm or a camera flight changes a number here and is drawn at full
 * rate; an idle loop changes them only on its own steps (`IdleMotionMath.
 * idleClock`). The same move as `ShadowCasterWatch`, for the whole picture.
 *
 * What it cannot see (a material field outside the list below) is drawn late,
 * not never: SceneView still draws when `DURATION.staleCap` has passed.
 *
 * Reads only plain fields, so the unit lane drives it with plain objects.
 */
export class PictureWatch {
  constructor() {
    this._ids = new WeakMap()
    this._next = 1
    /** @type {number[]} */ this._prev = []
    /** @type {number[]} */ this._cur = []
  }

  /** A stable number for an object's identity (0 for none). */
  _id(o) {
    if (!o) return 0
    let id = this._ids.get(o)
    if (id === undefined) { id = this._next++; this._ids.set(o, id) }
    return id
  }

  /**
   * @param {{matrixWorld:{elements:ArrayLike<number>}, projectionMatrix:{elements:ArrayLike<number>}}} camera
   * @param {Iterable<object>} drawn the objects drawn this frame (world matrices up to date)
   * @param {ArrayLike<number>} [extra] other frame inputs (canvas size, background)
   * @returns {boolean} true when the picture may differ from the last call's
   */
  changed(camera, drawn, extra = []) {
    const v = this._cur
    v.length = 0
    for (let i = 0; i < extra.length; i++) v.push(extra[i])
    pushAll(v, camera.matrixWorld.elements)
    pushAll(v, camera.projectionMatrix.elements)
    for (const o of drawn) {
      v.push(this._id(o), o.renderOrder ?? 0)
      pushAll(v, o.matrixWorld.elements)
      if (o.isLight) { v.push(o.intensity); pushColor(v, o.color) }
      const g = o.geometry
      if (g) {
        v.push(this._id(g), g.drawRange?.start ?? 0, g.drawRange?.count ?? 0, g.index?.version ?? -1)
        for (const k in g.attributes) this._attribute(v, g.attributes[k])
      }
      if (o.instanceMatrix) v.push(o.count ?? 0, o.instanceMatrix.version ?? 0, o.instanceColor?.version ?? -1)
      const m = o.material
      if (Array.isArray(m)) for (const mm of m) this._material(v, mm)
      else if (m) this._material(v, m)
    }
    const stale = v.length !== this._prev.length || !sameNumbers(v, this._prev)
    this._cur = this._prev
    this._prev = v
    return stale
  }

  /**
   * A small attribute by its values, a large one by its version. Views that
   * follow the camera or a pose (frame axes, link arrows) rewrite their few
   * vertices every frame with `needsUpdate` even when nothing moved, so their
   * version climbs on a still picture; a large mesh is not rewritten that way,
   * and reading its values every frame would cost what skipping saves.
   */
  _attribute(v, a) {
    const arr = a.array
    if (arr && arr.length <= SMALL_ATTRIBUTE) { v.push(arr.length); pushAll(v, arr) }
    else v.push(-1, a.version ?? 0)
  }

  /**
   * A material by the values that change how it draws. Not by `version`:
   * three bumps it itself while drawing (a transparent double-sided material
   * is drawn back then front, with `needsUpdate` set for each pass), so it
   * climbs on every frame drawn and would say "changed" forever.
   */
  _material(v, m) {
    v.push(this._id(m), m.visible === false ? 0 : 1, m.opacity ?? 1,
      m.transparent ? 1 : 0, m.side ?? 0, m.depthTest ? 1 : 0, m.depthWrite ? 1 : 0,
      m.blending ?? 0, m.wireframe ? 1 : 0, m.alphaTest ?? 0)
    pushColor(v, m.color)
    pushColor(v, m.emissive)
    v.push(m.emissiveIntensity ?? 0, m.size ?? 0, m.rotation ?? 0)
    if (m.map) v.push(this._id(m.map), m.map.version ?? 0)
    const u = m.uniforms
    if (u) for (const k in u) this._value(v, u[k]?.value)
  }

  _value(v, x) {
    if (typeof x === 'number') v.push(x)
    else if (typeof x === 'boolean') v.push(x ? 1 : 0)
    else if (!x || typeof x !== 'object') v.push(0)
    else if (x.isColor) pushColor(v, x)
    else if (x.isTexture) v.push(this._id(x), x.version ?? 0)
    else if (x.elements) pushAll(v, x.elements)
    else if ('x' in x) v.push(x.x, x.y, x.z ?? 0, x.w ?? 0)
    else if (Array.isArray(x)) { v.push(x.length); for (const e of x) this._value(v, e) }
    else v.push(this._id(x))
  }
}

/** Numbers in an attribute small enough to compare by value (see `_attribute`). */
const SMALL_ATTRIBUTE = 1024

function pushAll(v, a) { for (let i = 0; i < a.length; i++) v.push(a[i]) }
function pushColor(v, c) { if (c) v.push(c.r, c.g, c.b); else v.push(-1, -1, -1) }
/**
 * Equal up to float round-off. OrbitControls re-derives the camera from its
 * spherical coordinates every frame, so a camera that has not moved differs
 * from the last frame by ~1e-16 (and every frame sized to it follows). A
 * relative 1e-9 is far below any change that reaches a pixel.
 */
const REL_EPS = 1e-9
function sameNumbers(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (x === y || (x !== x && y !== y)) continue
    if (Math.abs(x - y) <= REL_EPS * Math.max(1, Math.abs(x), Math.abs(y))) continue
    return false
  }
  return true
}
