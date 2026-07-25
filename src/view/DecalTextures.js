// @ts-nocheck
import * as THREE from 'three'

/**
 * DecalTextures — the single place that knows how to draw the canvas-generated
 * sprite textures the 3D layer uses as decals (ADR-093).
 *
 * WHY IT EXISTS (核 §1.1): "how a soft radial sprite is drawn" was a private
 * method on `SceneStage` (`_makeRadialTexture`). The moment the Map annotation
 * views needed the same glow (so a Hub's floor pool matches the stage's own
 * accent pool — PHILOSOPHY #7 文脈), that method would have been copied into a
 * second place, and the two would have drifted (one softer, one hotter, no way
 * to tell which was intended). The generator moves here; `SceneStage` consumes
 * it. It is NOT duplicated.
 *
 * OWNERSHIP / LIFETIME (PHILOSOPHY #9, deliberately asymmetric — read this
 * before "fixing" a missing dispose):
 *   - `radialSprite(hex)` returns a MODULE-OWNED, CACHED texture. Callers must
 *     NOT dispose it: several views share one instance, and the cache is bounded
 *     by the number of distinct colours the app draws with (a handful). It is a
 *     program constant, like a font — allocated once, freed at page teardown.
 *   - `hatchTexture()` returns a CALLER-OWNED clone (its own `repeat`/`offset`,
 *     sharing the base's GPU upload via `Texture.source`). Every clone MUST be
 *     disposed by its owner — that is the symmetric pair.
 * A texture with per-entity `repeat`/`offset` can never be shared; one without
 * per-entity state should never be cloned. The two functions encode exactly that
 * distinction, so the call site cannot get the lifetime wrong by accident.
 */

/** @type {Map<string, THREE.CanvasTexture>} */
const radialCache = new Map()

/**
 * Soft radial gradient sprite (opaque centre → transparent rim) in `hex`.
 * Used for floor glow pools, dust points, and annotation halos.
 *
 * @param {string} [hex] CSS hex colour baked into the gradient (`#rrggbb`).
 *   Bake the colour when the consumer needs the sprite's own tint (dust,
 *   stage glow); pass white and tint via `material.color` when one sprite must
 *   serve many place-type colours.
 * @returns {THREE.CanvasTexture} module-owned — do not dispose.
 */
export function radialSprite(hex = '#ffffff') {
  const cached = radialCache.get(hex)
  if (cached) return cached
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
  radialCache.set(hex, tex)
  return tex
}

/** Lazily-built base for the drafting hatch (module-owned; clones are handed out). */
let hatchBase = null

/**
 * Diagonal drafting hatch — white lines on transparent, tiling seamlessly.
 * The Blueprint device that makes a filled region read as an AUTHORED area
 * rather than a poured wash; tint it via `material.color`, scale it via
 * `repeat` (the caller derives that from the region's own size so the hatch
 * pitch is scene-scale invariant — PHILOSOPHY #27).
 *
 * @returns {THREE.Texture} a CALLER-OWNED clone — dispose it with the view.
 */
export function hatchTexture() {
  if (!hatchBase) {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, size, size)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.lineCap = 'butt'
    // 45° lines every 16 px, extended past both edges so the tile wraps cleanly
    // (period 16 divides the 64 px tile exactly — no seam at any repeat count).
    for (let x = 0; x <= size * 2; x += 16) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x - size, size)
      ctx.stroke()
    }
    hatchBase = new THREE.CanvasTexture(canvas)
    hatchBase.colorSpace = THREE.SRGBColorSpace
    hatchBase.wrapS = hatchBase.wrapT = THREE.RepeatWrapping
  }
  const clone = hatchBase.clone()   // shares `.source` → one GPU upload for all
  clone.needsUpdate = true
  return clone
}
