// @ts-nocheck
import * as THREE from 'three'
import { COLOR, hexNumber } from '../theme/tokens.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { STAGE_LIGHT, BACKDROP, stageLightFrame, keyLightPlacement } from './StageMath.js'
import { radialSprite } from './DecalTextures.js'

/**
 * SceneStage — the viewport's ambient stage dressing: the Studio work cell of
 * the motion identity (ADR-166 M2; CLAUDE.md "モーション・アイデンティティ").
 * A radial backdrop lit where the work is, a soft pool of the ONE stage light
 * on the cell floor under the grid, and — since ADR-166 M6 — the same light
 * as the light that actually lights the scene: one warm key from high
 * behind-left that casts real shadows onto the floor, and a weak fill.
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

    // ③ The one light (ADR-166 M6): the key that lights every body and the
    //    robot and casts their shadows, plus a weak sky/ground fill so the
    //    faces turned away are dark but not black. These are the ONLY lights
    //    in the scene (SceneView no longer adds its white ambient and key).
    this._key = new THREE.DirectionalLight(hexNumber(STAGE_LIGHT.color), 0)
    this._key.castShadow = true
    this._key.shadow.mapSize.set(STAGE_LIGHT.shadow.mapSize, STAGE_LIGHT.shadow.mapSize)
    this._key.shadow.radius = STAGE_LIGHT.shadow.softness
    this._key.shadow.bias = -0.0002
    this._key.target.position.set(0, 0, 0)
    scene.add(this._key, this._key.target)
    this._fill = new THREE.HemisphereLight(
      hexNumber(STAGE_LIGHT.color), hexNumber(STAGE_LIGHT.fill.ground), STAGE_LIGHT.fill.intensity)
    this._fill.position.set(0, 0, 1)   // sky is +Z (ROS world frame)
    scene.add(this._fill)

    // ④ The floor that receives the shadows: invisible except where a shadow
    //    falls. Just under Z=0 (above the pool) so it never fights the grid or
    //    the floor-light annotations, and it darkens the pool where it lies.
    const reach = STAGE_LIGHT.pool.radius * STAGE_LIGHT.shadow.reach
    this._shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(reach * 2.4, reach * 2.4),
      new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }))
    this._shadowFloor.receiveShadow = true
    this._shadowFloor.position.z = -0.005
    this._shadowFloor.renderOrder = -1
    this._group.add(this._shadowFloor)
    this._placeKey()

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
    this._placeKey()
  }

  /** Aim the key and fit its shadow box to the current scale (StageMath — #27). */
  _placeKey() {
    const k = keyLightPlacement(this._scale)
    this._key.position.set(...k.position)
    const cam = this._key.shadow.camera
    cam.left = -k.half; cam.right = k.half; cam.top = k.half; cam.bottom = -k.half
    cam.near = k.near; cam.far = k.far
    cam.updateProjectionMatrix()
    this._key.shadow.normalBias = k.normalBias
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
  _apply({ poolOpacity, keyIntensity }) {
    this._pool.material.opacity = poolOpacity
    this._key.intensity = keyIntensity
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
    this._scene.remove(this._key, this._key.target, this._fill)
    this._key.dispose()
    this._fill.dispose()
    this._pool.geometry.dispose()
    this._pool.material.dispose()
    this._shadowFloor.geometry.dispose()
    this._shadowFloor.material.dispose()
    this._scene.background = new THREE.Color(hexNumber(COLOR.backdropCenter)) // the pre-stage flat backdrop
    this._bgTexture.dispose()
  }
}
