// @ts-nocheck
import * as THREE from 'three'
import { COLOR, hexNumber } from '../theme/tokens.js'
import { prefersReducedMotion, onReducedMotionChange } from '../theme/motion.js'
import { STAGE, dustField, dustDrift, entryEnvelope, fogDensityFor } from './StageMath.js'

/**
 * SceneStage — the viewport's ambient stage dressing (ADR-067; Tier D
 * "delight" under PHILOSOPHY #30 as revised by ADR-066): a vertical-gradient
 * backdrop, exponential depth fog, an additive floor glow under the grid, two
 * drifting dust layers, and a cool rim light. Non-propositional by design —
 * it gives the surface life; it never sits where fact/affordance feedback is
 * read and never implies a judgment.
 *
 * OWNERSHIP: a PERSISTENT animated view owned by `SceneView` (constructed and
 * disposed there), NOT a MotionGovernor transient — same rule as
 * GraspGhostView/UncertaintyGhostView (the governor owns only effects whose
 * lifetime nobody else tracks). `scene.background` and `scene.fog` are owned
 * here exclusively (PHILOSOPHY #4) — SceneView's constructor delegates them.
 *
 * REDUCED MOTION: degrades to the STATIC stage — gradient, fog, glow, and a
 * frozen dust field stay visible (a static styled cue, never nothing — #30) —
 * via `onReducedMotionChange` from the single boundary (`src/theme/motion.js`),
 * so a mid-session OS toggle freezes/resumes the drift without a reload.
 *
 * SCALE: `setScale(scale)` rides `SceneView._updateGridScale`'s power-of-10
 * grid scale so dust/glow/fog stay proportionate in mm-scale scenes
 * (PHILOSOPHY #27 — a world-unit-constant stage would vanish there).
 *
 * All motion arithmetic is the pure `StageMath` (deterministic — a reloaded
 * stage looks identical). Per frame the CPU cost is ~130 sin() calls and two
 * Points draw calls; the gradient/glow textures are generated once.
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

    // ① Backdrop: vertical gradient (deep navy → the classic 0x1a1a2e → near
    //    black) replaces the flat colour — depth without touching entities.
    this._bgTexture = this._makeGradientTexture(
      [[0, '#262a4a'], [0.45, '#1a1a2e'], [1, '#0e0e18']],
    )
    scene.background = this._bgTexture

    // ② Depth fog: matches the backdrop's midtone so distant geometry and
    //    grid edges sink into the backdrop instead of clipping.
    this._fog = new THREE.FogExp2(0x15152a, fogDensityFor(1))
    scene.fog = this._fog

    // Scaled stage furniture (glow + dust) lives under one group.
    this._group = new THREE.Group()
    this._group.renderOrder = -1

    // ③ Floor glow: an additive radial pool under the grid, tinted with the
    //    chrome's active accent so the stage and the UI share one glow hue.
    this._glowTexture = this._makeRadialTexture(COLOR.accentActive)
    const glowMat = new THREE.MeshBasicMaterial({
      map: this._glowTexture,
      transparent: true,
      opacity: 0.20,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    this._glow = new THREE.Mesh(new THREE.CircleGeometry(10.5, 48), glowMat)
    this._glow.position.z = -0.02 // flat, below the Z=0 decal plane — never straddles it
    this._glow.renderOrder = -2
    this._group.add(this._glow)

    // ④ Dust: two deterministic drifting layers (near/far parallax).
    this._spriteTexture = this._makeRadialTexture('#ffffff')
    this._layers = STAGE.dust.map((layer) => {
      const field = dustField(layer)
      const positions = new Float32Array(field.length * 3)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.PointsMaterial({
        map: this._spriteTexture,
        color: hexNumber(COLOR.accentActive),
        size: layer.size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,               // entry envelope fades it in
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const points = new THREE.Points(geo, mat)
      points.frustumCulled = false // the drift stays inside the layer bounds; skip per-frame sphere upkeep
      this._group.add(points)
      return { def: layer, field, positions, geo, mat, points }
    })

    // ⑤ Rim light: a cool fill opposite the key light so MeshStandardMaterial
    //    entities get a game-like edge separation from the dark backdrop.
    this._rimLight = new THREE.DirectionalLight(hexNumber(COLOR.accentActive), 0.45)
    this._rimLight.position.set(-6, 5, 3)
    scene.add(this._rimLight)

    scene.add(this._group)
    this._writeDust(0) // valid first frame even before the loop starts
  }

  /**
   * Rescale the stage for the current ground-grid scale (power-of-10 from
   * `SceneView._updateGridScale` — PHILOSOPHY #27). Fog thins inversely so
   * the relative depth fade is scene-scale-invariant.
   * @param {number} scale ≥ 1
   */
  setScale(scale) {
    const s = Number.isFinite(scale) && scale >= 1 ? scale : 1
    if (s === this._scale) return
    this._scale = s
    this._group.scale.setScalar(s)
    this._fog.density = fogDensityFor(s)
  }

  /**
   * Suspends / restores the depth fog. The fog density is tuned for the
   * perspective camera's short standoff; the 2D Map Mode ortho camera sits a
   * fixed ~100 units above the z≈0 map plane, where FogExp2 attenuates ~99.7%
   * and renders every fogged material (lit cubes AND MeshBasicMaterial
   * annotations) near-black — "can't see where anything is placed". While the
   * ortho map camera is active the fog is swapped out; `this._fog` stays the
   * owned object (its density is still maintained by `setScale`), only what
   * `scene.fog` points at toggles, so SceneStage remains the sole owner
   * (PHILOSOPHY #4). Same class of camera-assumption bug as PHILOSOPHY #27.
   * @param {boolean} suspended
   */
  setFogSuspended(suspended) {
    this._scene.fog = suspended ? null : this._fog
  }

  /**
   * Advance the ambient drift + entry fade. Called once per frame from
   * `AppController._animate`. Under reduced motion the drift clock holds at 0
   * (frozen field) and the entry fade lands instantly — the stage stays a
   * static styled cue (#30), never disappears.
   * @param {number} t loop-clock seconds (performance.now()/1000)
   */
  tick(t) {
    if (this._start === null) this._start = t
    const since = t - this._start
    for (const layer of this._layers) {
      layer.mat.opacity = this._reduced
        ? layer.def.opacity
        : layer.def.opacity * entryEnvelope(since, layer.def.entryDelay)
    }
    if (!this._reduced) this._writeDust(since)
  }

  /** Write one drift frame into both layers' position buffers. */
  _writeDust(t) {
    for (const layer of this._layers) {
      const arr = layer.positions
      for (let i = 0; i < layer.field.length; i++) {
        const p = layer.field[i]
        const d = dustDrift(t, p)
        arr[i * 3]     = p.x + d.dx
        arr[i * 3 + 1] = p.y + d.dy
        arr[i * 3 + 2] = p.z + d.dz
      }
      layer.geo.attributes.position.needsUpdate = true
    }
  }

  /** Vertical-gradient backdrop texture (generated once, 2×256). */
  _makeGradientTexture(stops) {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height)
    for (const [at, color] of stops) grad.addColorStop(at, color)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  /** Soft radial sprite/glow texture (generated once, 64×64). */
  _makeRadialTexture(hex) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, `${hex}ff`)
    grad.addColorStop(0.4, `${hex}66`)
    grad.addColorStop(1, `${hex}00`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  /** Symmetric teardown (#9): every scene.add above has its remove+dispose here. */
  dispose() {
    this._unsubReduced()
    this._scene.remove(this._group)
    this._scene.remove(this._rimLight)
    for (const layer of this._layers) {
      layer.geo.dispose()
      layer.mat.dispose()
    }
    this._glow.geometry.dispose()
    this._glow.material.dispose()
    this._glowTexture.dispose()
    this._spriteTexture.dispose()
    this._scene.fog = null
    this._scene.background = new THREE.Color(0x1a1a2e) // the pre-stage flat backdrop
    this._bgTexture.dispose()
    this._layers = []
  }
}
