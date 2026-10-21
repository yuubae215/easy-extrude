// @ts-nocheck
import * as THREE from 'three'
import {
  voxelCells, shatterDelay, cellProgress, scatterOffset, shatterFrame, cellHash, VOXEL_FILL,
} from './ShapeVoxelMath.js'

/**
 * Plan the landing effect for one lifecycle transition (ADR-166 M5). Every
 * entity is cut into its own voxel cells from its declared SHAPE
 * (`controller/lifecycleShape.js`) and drawn by `VoxelShatter` — a dissolve
 * breaks it apart from where each piece was, a materialize flies each piece
 * back to its own place. The two directions are one picture run both ways for
 * EVERY type (ADR-166 M5b retired the cuboid's outline construction
 * `WireframeAssembly`, whose 28 sparks landed on the edges and evaporated — a
 * create that never gathered into the box its delete broke apart; stakeholder,
 * 2026-10-20). Pure (no THREE objects are made here) so the controller can ask "is there
 * anything to show?" before it spawns: `null` = nothing to cut (a declared
 * silent shape, or no extent) — honest silence (#11).
 *
 * @param {{center:{x,y,z}, radius:number, shape:object|null}} anchor
 * @param {{kind:'materialize'|'dissolve'}} desc
 * @returns {{form:'shatter', cells:object}|null}
 */
export function planLandingEffect(anchor, desc) {
  const shape = anchor?.shape
  if (!shape) return null
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
