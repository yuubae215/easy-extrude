// @ts-nocheck
import * as THREE from 'three'
import { buildGeometry } from '../model/CuboidModel.js'
import { easeOutCubic, easeOutExpo } from './MotionMath.js'
import {
  voxelFrame, voxelJitter, glitchGate,
  voxelDelay, localProgress, voxelFlash, voxelEnvelope,
} from './CommandFeedbackMath.js'

/**
 * Pick the landing effect for a lifecycle descriptor. A materialize on a real
 * cuboid (8 OBB corners carried on the anchor) is rendered as an OUTLINE
 * CONSTRUCTION — the object's edges draw themselves on and voxel sparks fly in
 * to assemble the form (`WireframeAssembly`), which reads as "a new object was
 * built here" far more clearly than particles condensing to a point (user
 * feedback 2026-07-12). Everything else — every dissolve, and a materialize
 * without cuboid corners (a flat profile) — stays the radial `VoxelBurst`.
 *
 * @param {THREE.Scene} scene
 * @param {{center:{x,y,z}, radius:number, corners?:Array<{x,y,z}>}} anchor
 * @param {{kind:'materialize'|'dissolve', color:number, duration:number}} desc
 * @param {{reduced?: boolean}} [opts]
 */
export function createLandingEffect(scene, anchor, desc, opts = {}) {
  if (desc.kind === 'materialize' && Array.isArray(anchor.corners) && anchor.corners.length === 8) {
    return new WireframeAssembly(scene, anchor, desc, opts)
  }
  return new VoxelBurst(scene, anchor, desc, opts)
}

/**
 * LandingEffects — transient 3D rendering of an entity LIFECYCLE transition
 * (ADR-065 Phase 2, volume revision). RippleEffect lineage: constructor adds
 * to the scene, `tick(t)` returns true when finished, `dispose()` releases.
 * Spawned exclusively through `MotionGovernor.spawn` (budget + reduced-motion).
 *
 * VOLUME DESIGN: this view fires only for appear/vanish transitions
 * (`CommandFeedbackMath.lifecycleDescriptor`) — routine pose operations are
 * silent. The effect itself carries the semantic:
 *   - dissolve: the entity shatters into voxel fragments that fly outward,
 *     tumble and evaporate (the only remaining trace of a deleted entity),
 *   - materialize: the reverse — a glitch-flickering voxel shell converges
 *     onto the just-created entity and evaporates.
 *
 * One InstancedMesh (a single draw call regardless of voxel count — the
 * `_animate` performance guard, same as CelebrationField). Own overlay
 * geometry only — it NEVER touches the entity's material/emissive
 * (`_syncEmissive` stays the sole owner, PHILOSOPHY #4). Sized from the
 * entity's bounds so the cue stays proportionate in mm-scale and m-scale
 * scenes alike (#27). Directions and jitter are deterministic (no
 * Math.random) — a replayed transition looks identical.
 */
export class VoxelBurst {
  /**
   * @param {THREE.Scene} scene
   * @param {{center:{x:number,y:number,z:number}, radius:number}} bounds
   *   from `CommandFeedbackMath.boundsOf` (the appearing/vanishing entity's
   *   world corners, captured at the domain event)
   * @param {{kind:'materialize'|'dissolve', color:number, duration:number}} desc
   *   from `CommandFeedbackMath.lifecycleDescriptor` (duration in seconds)
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(scene, bounds, desc, { reduced = false } = {}) {
    this._scene    = scene
    this._kind     = desc.kind
    this._reduced  = reduced
    this._duration = desc.duration
    this._start    = performance.now() / 1000
    this._center   = new THREE.Vector3(bounds.center.x, bounds.center.y, bounds.center.z)
    this._maxDist  = Math.max(bounds.radius * 1.7, 0.32)

    const count = 40 // richer cloud; still ONE draw call (InstancedMesh)
    this._count = count
    const size  = Math.max(bounds.radius * 0.11, 0.018)
    const geo   = new THREE.BoxGeometry(size, size, size)
    this._baseColor = new THREE.Color(desc.color)
    this._flashColor = new THREE.Color(0xffffff)
    const mat   = new THREE.MeshBasicMaterial({
      color:       this._baseColor.clone(),
      transparent: true,
      opacity:     0.92,
      depthTest:   false,
      blending:    THREE.AdditiveBlending, // fragments glow where they overlap
    })
    this._mesh = new THREE.InstancedMesh(geo, mat, count)
    this._mesh.renderOrder = 3

    // Deterministic directions on a spiral-sphere fan with per-voxel radius
    // jitter and a per-voxel stagger delay — a voxel cloud that detaches in a
    // wave, not a perfect shell moving in lockstep (no Math.random).
    this._dirs = []
    this._jitters = []
    this._delays = []
    for (let i = 0; i < count; i++) {
      const phi   = Math.acos(1 - 2 * (i + 0.5) / count)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i
      this._dirs.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ))
      this._jitters.push(voxelJitter(i))
      this._delays.push(voxelDelay(i))
    }

    this._applyFrame(0)
    scene.add(this._mesh)
  }

  /** Write one frame into the instance matrices from the pure curves. */
  _applyFrame(progress) {
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const scl = new THREE.Vector3()
    for (let i = 0; i < this._count; i++) {
      const jitter = this._jitters[i]
      // Per-voxel LOCAL progress (the stagger): reduced motion holds the shell
      // at a single frame, so it ignores the offset (static held cue #30).
      const lp = this._reduced ? progress : localProgress(progress, this._delays[i])
      const f = voxelFrame(this._kind, lp, this._reduced)
      pos.copy(this._dirs[i])
        .multiplyScalar(f.dist * jitter * this._maxDist)
        .add(this._center)
      // Deterministic per-voxel tumble around alternating signed axes so
      // fragments rotate independently.
      euler.set(
        f.spin * (i % 2 === 0 ? 1 : -1),
        f.spin * jitter,
        f.spin * ((i % 3) - 1),
      )
      quat.setFromEuler(euler)
      // One shared material = one opacity, so BOTH the per-voxel fade and the
      // glitch flicker ride per-instance scale: size folds in the voxel's own
      // opacity (staggered evaporation) × the glitch gate (materialize only).
      const gate = (this._kind === 'materialize' && !this._reduced)
        ? glitchGate(i, lp)
        : 1
      const visible = this._reduced ? f.scale : f.scale * f.opacity
      scl.setScalar(Math.max(visible * gate, 0.001))
      m.compose(pos, quat, scl)
      this._mesh.setMatrixAt(i, m)
    }
    this._mesh.instanceMatrix.needsUpdate = true
    // Whole-cloud alpha envelope + boundary flash (colour → white at the
    // break / assembly instant). Reduced motion: fixed low-opacity, no flash.
    if (this._reduced) {
      this._mesh.material.color.copy(this._baseColor)
      this._mesh.material.opacity = 0.4
    } else {
      const flash = voxelFlash(this._kind, progress)
      this._mesh.material.color.copy(this._baseColor).lerp(this._flashColor, flash * 0.8)
      this._mesh.material.opacity = voxelEnvelope(progress)
    }
  }

  /**
   * @param {number} t seconds (performance.now()/1000 — the loop clock)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const progress = (t - this._start) / this._duration
    if (progress >= 1) return true
    if (this._reduced) return false // static held cue — constructed frame stands
    this._applyFrame(progress)
    return false
  }

  dispose() {
    this._scene.remove(this._mesh)
    this._mesh.geometry.dispose()
    this._mesh.material.dispose()
    this._mesh.dispose()
  }
}

/**
 * WireframeAssembly — the materialize (entity-APPEAR) effect for a real cuboid,
 * reworked from a radial condense to an OUTLINE CONSTRUCTION (user feedback
 * 2026-07-12: "particles condensing to a point doesn't read as generation —
 * build up the mesh / outline instead").
 *
 * Two staggered layers, both overlay-only (the entity's own material is never
 * touched — `_syncEmissive` stays sole owner, PHILOSOPHY #4), deterministic (no
 * Math.random), and sized from the entity's own bounds (#27):
 *   1. The 12 OBB edges (built from the actual corners via the same
 *      `buildGeometry` + `EdgesGeometry` path MeshView uses, so it matches the
 *      real orientation) DRAW THEMSELVES ON — each edge grows from one corner to
 *      the other on its own staggered clock (the outline is traced into being,
 *      never all at once — the anti-vanilla "no simultaneous motion" rule).
 *   2. Voxel sparks fly IN from outside and LAND on points along those edges
 *      (the "assembled from blocks" energy, fitting a voxel modeller), then
 *      evaporate as the real solid stands revealed.
 * A single assembly flash (`voxelFlash('materialize')`) whitens both layers as
 * the form completes, then the envelope fades them out (#30 corollary: appear
 * is a brief cue). Reduced motion: the full outline held static at half
 * intensity — information preserved, movement dropped (#30/#11).
 */
export class WireframeAssembly {
  /**
   * @param {THREE.Scene} scene
   * @param {{center:{x,y,z}, radius:number, corners:Array<{x,y,z}>}} anchor
   * @param {{color:number, duration:number}} desc (duration in seconds)
   * @param {{reduced?: boolean}} [opts]
   */
  constructor(scene, anchor, desc, { reduced = false } = {}) {
    this._scene    = scene
    this._reduced  = reduced
    this._duration = desc.duration
    this._start    = performance.now() / 1000
    this._center   = new THREE.Vector3(anchor.center.x, anchor.center.y, anchor.center.z)
    this._baseColor  = new THREE.Color(desc.color)
    this._flashColor = new THREE.Color(0xffffff)
    const radius = Math.max(anchor.radius, 0.05)

    // ── Layer 1: the exact 12 OBB edges (via MeshView's geometry path) ──────
    const cornerVecs = anchor.corners.map(c => new THREE.Vector3(c.x, c.y, c.z))
    const boxGeo   = buildGeometry(cornerVecs)
    const edgesGeo = new THREE.EdgesGeometry(boxGeo, 1)
    boxGeo.dispose()
    const ep = edgesGeo.getAttribute('position')
    this._edges = []
    for (let i = 0; i < ep.count; i += 2) {
      this._edges.push([
        new THREE.Vector3(ep.getX(i),     ep.getY(i),     ep.getZ(i)),
        new THREE.Vector3(ep.getX(i + 1), ep.getY(i + 1), ep.getZ(i + 1)),
      ])
    }
    edgesGeo.dispose()
    this._edgeCount = this._edges.length

    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this._edgeCount * 6), 3))
    this._lineMat = new THREE.LineBasicMaterial({
      color:       this._baseColor.clone(),
      transparent: true,
      opacity:     0.95,
      depthTest:   false,
      blending:    THREE.AdditiveBlending,
    })
    this._lines = new THREE.LineSegments(lineGeo, this._lineMat)
    this._lines.renderOrder = 3

    // ── Layer 2: voxel sparks that land on points along the edges ───────────
    const sparkCount = 28
    this._sparkCount = sparkCount
    const size = Math.max(radius * 0.09, 0.014)
    const sGeo = new THREE.BoxGeometry(size, size, size)
    this._sparkMat = new THREE.MeshBasicMaterial({
      color:       this._baseColor.clone(),
      transparent: true,
      opacity:     0.9,
      depthTest:   false,
      blending:    THREE.AdditiveBlending,
    })
    this._sparks = new THREE.InstancedMesh(sGeo, this._sparkMat, sparkCount)
    this._sparks.renderOrder = 3
    this._sparkTargets = []
    this._sparkStarts  = []
    this._sparkDelays  = []
    for (let i = 0; i < sparkCount; i++) {
      const [a, b] = this._edges[i % this._edgeCount]
      const t = (i * 0.6180339887) % 1                 // golden param along the edge
      const target  = a.clone().lerp(b, t)
      const outward = target.clone().sub(this._center)
      if (outward.lengthSq() < 1e-9) outward.set(1, 0, 0)
      outward.normalize()
      this._sparkTargets.push(target)
      this._sparkStarts.push(target.clone().add(
        outward.multiplyScalar(radius * (1.4 + 0.9 * ((i * 0.383) % 1)))))
      this._sparkDelays.push(voxelDelay(i))
    }

    this._applyFrame(0)
    scene.add(this._lines)
    scene.add(this._sparks)
  }

  _applyFrame(progress) {
    const flash = this._reduced ? 0 : voxelFlash('materialize', progress)

    // Layer 1: draw each edge on from corner A toward B on its staggered clock.
    const lpos = this._lines.geometry.getAttribute('position')
    const tip = new THREE.Vector3()
    for (let i = 0; i < this._edgeCount; i++) {
      const [a, b] = this._edges[i]
      const grown = this._reduced ? 1 : easeOutCubic(localProgress(progress, voxelDelay(i)))
      tip.copy(a).lerp(b, grown)
      lpos.setXYZ(i * 2,     a.x, a.y, a.z)
      lpos.setXYZ(i * 2 + 1, tip.x, tip.y, tip.z)
    }
    lpos.needsUpdate = true
    this._lineMat.color.copy(this._baseColor).lerp(this._flashColor, flash * 0.85)
    this._lineMat.opacity = this._reduced ? 0.5 : voxelEnvelope(progress)

    // Layer 2: sparks fly in to their edge point, land, then shrink away.
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const scl = new THREE.Vector3()
    for (let i = 0; i < this._sparkCount; i++) {
      const lp  = this._reduced ? 0.6 : localProgress(progress, this._sparkDelays[i])
      const eIn = easeOutExpo(lp)
      pos.copy(this._sparkStarts[i]).lerp(this._sparkTargets[i], eIn)
      // grow on approach, then evaporate after landing (fade rides scale — one
      // shared material has one opacity, same constraint as VoxelBurst).
      const vis = this._reduced ? 0.7 : (lp < 0.7 ? 0.35 + 0.65 * eIn : Math.max(1 - (lp - 0.7) / 0.3, 0))
      const spin = this._reduced ? 0 : (1 - eIn) * 1.3 * (i % 2 === 0 ? 1 : -1)
      euler.set(spin, spin * 0.5, spin * ((i % 3) - 1))
      quat.setFromEuler(euler)
      scl.setScalar(Math.max(vis, 0.001))
      m.compose(pos, quat, scl)
      this._sparks.setMatrixAt(i, m)
    }
    this._sparks.instanceMatrix.needsUpdate = true
    this._sparkMat.color.copy(this._baseColor).lerp(this._flashColor, flash * 0.7)
    this._sparkMat.opacity = this._reduced ? 0.4 : voxelEnvelope(progress)
  }

  /**
   * @param {number} t seconds (performance.now()/1000 — the loop clock)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const progress = (t - this._start) / this._duration
    if (progress >= 1) return true
    if (this._reduced) return false // static held cue — the full outline stands
    this._applyFrame(progress)
    return false
  }

  dispose() {
    this._scene.remove(this._lines)
    this._scene.remove(this._sparks)
    this._lines.geometry.dispose()
    this._lineMat.dispose()
    this._sparks.geometry.dispose()
    this._sparkMat.dispose()
    this._sparks.dispose()
  }
}
