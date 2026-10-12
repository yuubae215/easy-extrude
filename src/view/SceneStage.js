// @ts-nocheck
import * as THREE from 'three'
import { COLOR, hexNumber } from '../theme/tokens.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { STAGE_LIGHT, BACKDROP, stageLightFrame } from './StageMath.js'
import { radialSprite } from './DecalTextures.js'

/**
 * SceneStage — the viewport's ambient stage dressing: the Studio work cell of
 * the motion identity (ADR-166 M2; CLAUDE.md "モーション・アイデンティティ").
 * A radial backdrop lit where the work is, a soft pool of the ONE stage light
 * on the cell floor under the grid, and the same light as a rim from behind.
 * Tier D "delight" under PHILOSOPHY #30: non-propositional by design — it
 * gives the surface a room to sit in; it never sits where fact/affordance
 * feedback is read and never implies a judgment.
 *
 * WHAT LEFT (ADR-166 M2): ADR-067's Void Grid — vertical navy sky, FogExp2,
 * two drifting dust layers. Fog left with it, so `scene.fog` is null and
 * distant geometry no longer sinks into the backdrop at any grid scale.
 *
 * OWNERSHIP: a PERSISTENT animated view owned by `SceneView` (constructed and
 * disposed there), NOT a MotionGovernor transient — same rule as
 * GraspGhostView/UncertaintyGhostView (the governor owns only effects whose
 * lifetime nobody else tracks). `scene.background` is owned here exclusively
 * (PHILOSOPHY #4) — SceneView's constructor delegates it.
 *
 * MOTION: the light comes on as the boot flight lands, then the pool breathes
 * slowly (StageMath `stageLightFrame`). REDUCED MOTION: the light is simply on
 * — via `onReducedMotionChange` from the single boundary (`src/theme/motion.js`),
 * so a mid-session OS toggle settles it without a reload.
 *
 * SCALE: `setScale(scale)` rides `SceneView._updateGridScale`'s power-of-10
 * grid scale so the pool stays proportionate in mm-scale scenes
 * (PHILOSOPHY #27 — a world-unit-constant pool would vanish there).
 */
export class SceneStage {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene
    this._scale = 1
    this._start = null          // loop-clock seconds at first tick
    this._reduced = prefersReducedMotion()
    this._unsubReduced = onReducedMotionChange(r => { this._reduced = r })

    // ① Backdrop: radial, brightest at the cell (generated once).
    this._bgTexture = this._makeRadialTexture(BACKDROP)
    scene.background = this._bgTexture
    scene.fog = null

    // Scaled stage furniture (the pool) lives under one group.
    this._group = new THREE.Group()
    this._group.renderOrder = -1

    // ② The light pool on the cell floor: an additive radial disc under the
    //    grid, in the one stage light's colour. The radial sprite recipe is
    //    shared with the Map annotation halos (`DecalTextures` owns and
    //    caches it; never disposed from here).
    this._poolTexture = radialSprite(STAGE_LIGHT.color)
    const poolMat = new THREE.MeshBasicMaterial({
      map: this._poolTexture,
      transparent: true,
      opacity: 0,                 // the light comes on in tick()
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this._pool = new THREE.Mesh(new THREE.CircleGeometry(STAGE_LIGHT.pool.radius, 48), poolMat)
    this._pool.position.z = -0.02 // flat, below the Z=0 decal plane — never straddles it
    this._pool.renderOrder = -2
    this._group.add(this._pool)

    // ③ Rim light: the same light from behind-left, so MeshStandardMaterial
    //    bodies separate from the dark ground.
    this._rimLight = new THREE.DirectionalLight(hexNumber(STAGE_LIGHT.color), 0)
    this._rimLight.position.set(...STAGE_LIGHT.rimFrom)
    scene.add(this._rimLight)

    scene.add(this._group)
    this._apply(stageLightFrame(0, this._reduced)) // valid first frame before the loop starts
  }

  /**
   * Rescale the stage for the current ground-grid scale (power-of-10 from
   * `SceneView._updateGridScale` — PHILOSOPHY #27).
   * @param {number} scale ≥ 1
   */
  setScale(scale) {
    const s = Number.isFinite(scale) && scale >= 1 ? scale : 1
    if (s === this._scale) return
    this._scale = s
    this._group.scale.setScalar(s)
  }

  /**
   * Advance the light (coming on, then the idle breath). Called once per frame
   * from `AppController._animate`.
   * @param {number} t loop-clock seconds (performance.now()/1000)
   */
  tick(t) {
    if (this._start === null) this._start = t
    this._apply(stageLightFrame(t - this._start, this._reduced))
  }

  /** Write one light frame. */
  _apply({ poolOpacity, rimIntensity }) {
    this._pool.material.opacity = poolOpacity
    this._rimLight.intensity = rimIntensity
  }

  /** Radial backdrop texture (generated once, 256×256; stretched to the viewport). */
  _makeRadialTexture({ center, stops }) {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const cx = center[0] * size
    const cy = center[1] * size
    const r = Math.hypot(Math.max(cx, size - cx), Math.max(cy, size - cy))
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    for (const [at, color] of stops) grad.addColorStop(at, color)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  /**
   * Symmetric teardown (#9): every scene.add above has its remove+dispose here.
   * EXCEPT the radial sprite — a module-owned cached constant from
   * `DecalTextures.radialSprite()`, shared with the Map annotation halos, so
   * disposing it here would blank another view's glow (see that module's
   * ownership note).
   */
  dispose() {
    this._unsubReduced()
    this._scene.remove(this._group)
    this._scene.remove(this._rimLight)
    this._pool.geometry.dispose()
    this._pool.material.dispose()
    this._scene.background = new THREE.Color(hexNumber(COLOR.backdropCenter)) // the pre-stage flat backdrop
    this._bgTexture.dispose()
  }
}
