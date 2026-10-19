// @ts-nocheck
import * as THREE from 'three'
import { buildGeometry } from '../model/CuboidModel.js'
import { easeOutCubic, easeOutExpo } from './MotionMath.js'
import {
  voxelDelay, localProgress, voxelFlash, voxelEnvelope, sparkScale,
} from './CommandFeedbackMath.js'
import {
  voxelCells, shatterDelay, cellProgress, scatterOffset, shatterFrame, cellHash, VOXEL_FILL,
} from './ShapeVoxelMath.js'

/**
 * Plan the landing effect for one lifecycle transition (ADR-166 M5). The form
 * follows the entity's declared SHAPE (`controller/lifecycleShape.js`), not a
 * corner count:
 *   - a materialize of a real cuboid (`shape.box`) is the OUTLINE CONSTRUCTION
 *     (`WireframeAssembly` — user feedback 2026-07-12),
 *   - everything else is the entity cut into its own voxel cells
 *     (`VoxelShatter`) — a dissolve breaks it apart from where each piece was,
 *     a materialize flies each piece back to its own place.
 * Pure (no THREE objects are made here) so the controller can ask "is there
 * anything to show?" before it spawns: `null` = nothing to cut (a declared
 * silent shape, or no extent) — honest silence (#11).
 *
 * @param {{center:{x,y,z}, radius:number, shape:object|null}} anchor
 * @param {{kind:'materialize'|'dissolve'}} desc
 * @returns {{form:'outline', anchor:object}|{form:'shatter', cells:object}|null}
 */
export function planLandingEffect(anchor, desc) {
  const shape = anchor?.shape
  if (!shape) return null
  if (desc.kind === 'materialize' && shape.box && shape.corners?.length === 8) {
    return { form: 'outline', anchor: { center: anchor.center, radius: anchor.radius, corners: shape.corners } }
  }
  const cells = voxelCells(shape)
  return cells && cells.cells.length > 0 ? { form: 'shatter', cells } : null
}

/**
 * @param {THREE.Scene} scene
 * @param {NonNullable<ReturnType<typeof planLandingEffect>>} plan
 * @param {{kind:'materialize'|'dissolve', color:number, flash:number, duration:number}} desc
 * @param {{reduced?: boolean}} [opts]
 */
export function createLandingEffect(scene, plan, desc, opts = {}) {
  if (plan.form === 'outline') return new WireframeAssembly(scene, plan.anchor, desc, opts)
  if (plan.form === 'shatter') return new VoxelShatter(scene, plan.cells, desc, opts)
  throw new Error(`createLandingEffect: undeclared form ${plan.form}`)
}

/**
 * VoxelShatter — the entity, cut into its own surface cells, breaking apart
 * (dissolve) or being laid down piece by piece (materialize). ADR-166 M5
 * replaces `VoxelBurst` (40 voxels on a sphere around the centre — coarse on a
 * large entity, and its materialize gathered into one point that popped as a
 * white cube; stakeholder, 2026-10-19).
 *
 * RippleEffect lineage: the constructor adds to the scene, `tick(t)` returns
 * true when finished, `dispose()` releases. Spawned only through
 * `MotionGovernor.spawn` (budget + reduced motion). One InstancedMesh = one
 * draw call at any cell count. Overlay only — the entity's own material is
 * never touched (`_syncEmissive` stays its sole owner, PHILOSOPHY #4).
 *
 * The voxels are lit, opaque cubes (they stand in the same light as the
 * entities) with a faint glow of the state tone; the boundary instant lights
 * each cell toward the one stage light on its own clock (per-instance colour),
 * so the flash travels with the wave instead of blinking the whole cloud.
 * Each cell's fade rides its scale (one material, one opacity).
 */
export class VoxelShatter {
  /**
   * @param {THREE.Scene} scene
   * @param {ReturnType<typeof voxelCells>} cut from `ShapeVoxelMath.voxelCells`
   * @param {{kind:'materialize'|'dissolve', color:number, flash:number, duration:number}} desc
   * @param {{reduced?: boolean}} [opts]
   */
  constructor(scene, cut, desc, { reduced = false } = {}) {
    this._scene    = scene
    this._kind     = desc.kind
    this._reduced  = reduced
    this._duration = desc.duration
    this._start    = performance.now() / 1000
    this._cells    = cut.cells
    this._edge     = cut.pitch * VOXEL_FILL
    this._tone     = new THREE.Color(desc.color)
    this._light    = new THREE.Color(desc.flash)

    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.45, metalness: 0.05,   // colour per instance (setColorAt) — the material stays the default white so it does not tint it
      emissive: this._tone.clone(), emissiveIntensity: 0.35,
    })
    this._mesh = new THREE.InstancedMesh(geo, mat, this._cells.length)
    this._mesh.renderOrder = 3
    this._mesh.frustumCulled = false   // instances fly outside the unit box's bounds

    const center = cut.center
    this._offsets = this._cells.map((c, i) => scatterOffset(c, center, cut.reach, cut.pitch, i))
    this._delays  = this._cells.map((c, i) => shatterDelay(c, center, cut.reach, i))
    this._axes    = this._cells.map((_, i) => new THREE.Vector3(cellHash(i, 6) - 0.5, cellHash(i, 7) - 0.5, cellHash(i, 8) - 0.5).normalize())

    this._applyFrame(0)
    scene.add(this._mesh)
  }

  /** Write one frame into the instance matrices and colours from the pure curves. */
  _applyFrame(progress) {
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const col = new THREE.Color()
    for (let i = 0; i < this._cells.length; i++) {
      const lp = this._reduced ? 0 : cellProgress(progress, this._delays[i])
      const f = shatterFrame(this._kind, lp, this._reduced)
      const c = this._cells[i].p, o = this._offsets[i]
      pos.set(c.x + o.x * f.travel, c.y + o.y * f.travel, c.z + o.z * f.travel)
      quat.setFromAxisAngle(this._axes[i], f.spin)
      scl.setScalar(Math.max(this._edge * f.size, 1e-6))
      m.compose(pos, quat, scl)
      this._mesh.setMatrixAt(i, m)
      col.copy(this._tone).lerp(this._light, f.flash)
      this._mesh.setColorAt(i, col)
    }
    this._mesh.instanceMatrix.needsUpdate = true
    if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true
  }

  /**
   * @param {number} t seconds (performance.now()/1000 — the loop clock)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const progress = (t - this._start) / this._duration
    if (progress >= 1) return true
    if (this._reduced) return false // static held cue — the constructed frame stands
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
 * A single assembly flash (`voxelFlash('materialize')`) lights both layers
 * toward the one stage light (`desc.flash` — ADR-166 M4d3; it whitened them) as
 * the form completes, then the envelope fades them out (#30 corollary: appear
 * is a brief cue). Reduced motion: the full outline held static at half
 * intensity — information preserved, movement dropped (#30/#11).
 */
export class WireframeAssembly {
  /**
   * @param {THREE.Scene} scene
   * @param {{center:{x,y,z}, radius:number, corners:Array<{x,y,z}>}} anchor
   * @param {{color:number, flash:number, duration:number}} desc (duration in seconds)
   * @param {{reduced?: boolean}} [opts]
   */
  constructor(scene, anchor, desc, { reduced = false } = {}) {
    this._scene    = scene
    this._reduced  = reduced
    this._duration = desc.duration
    this._start    = performance.now() / 1000
    this._center   = new THREE.Vector3(anchor.center.x, anchor.center.y, anchor.center.z)
    this._baseColor  = new THREE.Color(desc.color)
    this._flashColor = new THREE.Color(desc.flash)
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
      const vis = this._reduced ? 0.7 : sparkScale(lp)
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
