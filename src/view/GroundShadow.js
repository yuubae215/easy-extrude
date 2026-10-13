// @ts-nocheck
import * as THREE from 'three'
import { SHADOW, groundShadowFrame } from './GroundShadowMath.js'

/**
 * Below the Z=0 decal plane like the stage's light pool (`SceneStage`), so the
 * shadow never straddles the floor decals; above the pool so it darkens it.
 */
const FLOOR_Z = -0.01

/**
 * GroundShadow — one body's soft shadow on the floor (ADR-166 M4d3b). The view
 * half of `GroundShadowMath`: a flat quad under the footprint whose fragment
 * shader draws a rounded rectangle softened at its edge (`shadowFalloff` is the
 * testable twin of the GLSL below).
 *
 * OWNERSHIP (原則 #9): the body view that constructs one disposes it in its own
 * `dispose` — one shadow per body, born and released with it. `write` is the
 * only writer of its pixels (原則 #4); the owner calls it from its frame tick.
 */
export class GroundShadow {
  /** @param {THREE.Object3D} parent where the quad lives (the scene) */
  constructor(parent) {
    this._parent = parent
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        uColor:   { value: new THREE.Color(SHADOW.color) },
        uOpacity: { value: 0 },
        uSize:    { value: new THREE.Vector2(1, 1) },   // footprint w × d
        uSoft:    { value: 0 },
        uRound:   { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // Signed distance to a rounded rectangle, then shadowFalloff's smoothstep.
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform vec2 uSize;
        uniform float uSoft;
        uniform float uRound;
        varying vec2 vUv;
        void main() {
          vec2 span = uSize + vec2(2.0 * uSoft);
          vec2 p = (vUv - 0.5) * span;
          vec2 q = abs(p) - 0.5 * uSize + vec2(uRound);
          float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRound;
          float a = 1.0 - smoothstep(-uSoft, uSoft, dist);
          gl_FragColor = vec4(uColor, uOpacity * a);
        }`,
      transparent: true,
      depthWrite: false,
    })
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._material)
    this._mesh.position.z = FLOOR_Z
    this._mesh.renderOrder = -1
    this._mesh.visible = false
    this._mesh.name = 'groundShadow'
    parent.add(this._mesh)
  }

  /**
   * Draw the shadow of `fp` (`GroundShadowMath.footprintOf`), or nothing.
   * @param {{cx:number, cy:number, w:number, d:number, yaw:number, zMin:number, zMax:number}|null} fp
   * @param {{visible?: boolean, round?: number, strength?: number}} [opts]
   *   `visible` — whether the body itself is drawn (a hidden body casts nothing);
   *   `round` — corner radius (a pedestal is round: half its side);
   *   `strength` ∈ [0,1] — the body's own presence (an arm still arriving).
   */
  write(fp, { visible = true, round = 0, strength = 1 } = {}) {
    const { opacity, soft } = groundShadowFrame(fp)
    const o = visible ? opacity * strength : 0
    this._mesh.visible = o > 0
    if (!(o > 0)) return
    const u = this._material.uniforms
    u.uOpacity.value = o
    u.uSize.value.set(fp.w, fp.d)
    u.uSoft.value = soft
    u.uRound.value = Math.min(round, fp.w / 2, fp.d / 2)
    this._mesh.position.set(fp.cx, fp.cy, FLOOR_Z)
    this._mesh.rotation.set(0, 0, fp.yaw)
    this._mesh.scale.set(fp.w + 2 * soft, fp.d + 2 * soft, 1)
  }

  /** Whether a shadow is on screen (read-only — e2e). */
  get drawn() { return this._mesh.visible }

  /** The release paired with the constructor (原則 #9). */
  dispose() {
    this._parent.remove(this._mesh)
    this._mesh.geometry.dispose()
    this._material.dispose()
  }
}
