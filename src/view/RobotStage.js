// @ts-nocheck
import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import { jointValuesFor } from '../domain/robotConfig.js'
import { ROBOT_JOINT_NAMES, ROBOT_URDF_TEXT } from './robotSkeleton.js'
import { MM_PER_METER } from '../domain/worldUnits.js'
import {
  ROBOT_RENDER_STYLE, realisticPackages, realisticUrdfUrl, REALISTIC_BASE_YAW_CORRECTION,
} from './robotVisualStyle.js'

/**
 * How much of its own opacity the skeleton keeps while it draws a CLIENT
 * APPROXIMATION rather than a solver's solution (ADR-144 D4). Low enough that
 * "this is not a verified answer" reads at a glance, high enough that the
 * silhouette is still legible — the preview has to be useful to be worth drawing.
 */
const UNVERIFIED_OPACITY = 0.38

/**
 * RobotStage — loads and displays a fixed-pose robot-arm skeleton in the main
 * viewport, for visually verifying grasp-search (`core/`) output against the
 * voxel scene. Purely decorative/read-only: this class only *renders* a pose,
 * it never computes one. Per CLAUDE.md's AI 向けガード, IK/reach/interference
 * solving belongs exclusively to the backend `core/` layer — if this ever
 * needs to react to solved poses, they arrive over the grasp-contract HTTP
 * boundary and get applied here via `setJointValues`, not solved locally.
 *
 * OWNERSHIP: a persistent view owned by `SceneView` (constructed and disposed
 * there), same pattern as `SceneStage` — no MotionGovernor involvement since
 * nothing here animates on its own.
 *
 * The robot model is a self-contained 6-DOF "skeleton" URDF
 * (`public/robot/skeleton_arm.urdf`) whose joint origins reproduce the
 * Universal Robots UR5e link transforms (recognizable UR silhouette), drawn
 * from primitive <geometry> (cylinder) bones — no external mesh assets, so
 * URDFLoader needs no `packages` mapping or mesh loader override.
 *
 * A stage can also draw Universal Robots' own visual meshes for this SAME
 * chain (`setRenderStyle('realistic')`, `robotVisualStyle.js`) — a second
 * GEOMETRY for the one UR5e this app has, not a second arm (ADR-141's "which
 * arm" axis, `ROBOT_MODELS`, is untouched). That asset is ~9 MB and fetched
 * lazily, so the constructor never awaits it — every stage boots into the
 * bundled skeleton exactly as before this capability existed.
 */
export class RobotStage {
  /**
   * @param {THREE.Scene} scene
   * @param {{position?: [number, number, number]}} [opts]
   */
  constructor(scene, opts = {}) {
    this._scene = scene
    this.robot = null

    this._group = new THREE.Group()
    const [x, y, z] = opts.position ?? [-2 * MM_PER_METER, 2 * MM_PER_METER, 0]
    this._group.position.set(x, y, z)
    scene.add(this._group)

    /** @type {'skeleton'|'realistic'} which geometry is currently drawn (原則 #4 — this field's only writer is `setRenderStyle`) */
    this._renderStyle = ROBOT_RENDER_STYLE.SKELETON
    // Monotonic token invalidating an in-flight `setRenderStyle('realistic')`
    // fetch that a LATER call (or `dispose()`) has superseded — the async
    // mesh load must not clobber a stage that has since moved on (原則 #24).
    this._styleLoadToken = 0
    /** @type {boolean} whether the skeleton currently draws an unverified pose */
    this._unverified = false
    /** @type {Array<[THREE.Material, number]>} materials this stage owns (cloned per attach) */
    this._materials = []

    this._attachRobot(this._buildSkeletonRobot())
    this.previewSolution(null)
  }

  /** Parses the bundled primitive-geometry skeleton. Synchronous, no network (ADR-088 §1.1). */
  _buildSkeletonRobot() {
    // Parse the SAME bundled URDF string the tcp seed is derived from
    // (ROBOT_URDF_TEXT, ADR-088 §1.1) — one source drives both the drawn flange
    // and the seed, and no runtime fetch is needed. `parse` is synchronous.
    return new URDFLoader().parse(ROBOT_URDF_TEXT)
  }

  /**
   * Fetches Universal Robots' own visual meshes for the SAME chain
   * (`robotVisualStyle.js`). The only async load path this class has —
   * isolated here so the sync skeleton path above is unaffected (原則 #8).
   * @returns {Promise<import('three').Object3D>}
   */
  async _loadRealisticRobot() {
    const manager = new THREE.LoadingManager()
    const loaded = new Promise((resolve, reject) => {
      manager.onLoad = resolve
      manager.onError = (url) => reject(new Error(`RobotStage: failed to load "${url}"`))
    })
    const loader = new URDFLoader(manager)
    loader.packages = realisticPackages()
    const text = await fetch(realisticUrdfUrl()).then(r => {
      if (!r.ok) throw new Error(`RobotStage: failed to fetch realistic URDF (${r.status})`)
      return r.text()
    })
    const robot = loader.parse(text)
    // Cancel the official URDF's own base_link → base_link_inertia yaw
    // (REALISTIC_BASE_YAW_CORRECTION) so this root ends up in the SAME frame
    // convention as skeleton_arm.urdf's — and therefore the TCP marker
    // (derived solely from the skeleton) still lands on the drawn flange.
    robot.rotation.z = REALISTIC_BASE_YAW_CORRECTION
    await loaded   // wait for every referenced mesh, not just the URDF text
    return robot
  }

  /**
   * Wires a freshly parsed `URDFRobot` into this stage: world-unit scale,
   * axis alignment, group attachment, and per-stage material ownership. The
   * ONE place both the constructor and `setRenderStyle` attach a robot, so
   * the two paths cannot drift (e.g. one forgetting to clone materials).
   * @param {import('three').Object3D} robot
   */
  _attachRobot(robot) {
    // ROS (+Z up) and THREE.js world (+Z up here, per SceneView.camera.up)
    // already agree — URDFLoader instantiates links in URDF-native axes
    // with no reframing needed (see URDFLoader.js header comment).
    robot.rotation.x = 0
    // The URDF is ROS/URDF-standard meters; `_group`'s world transform (driven by
    // the robot_base CoordinateFrame, ADR-084 §2) is mm (ADR-136). Scaling the
    // URDF root converts every joint origin/link length in the chain at once —
    // Three.js composes this scale into worldPoseOf() results automatically, so
    // base/tcp world positions come out mm-consistent with the rest of the scene.
    robot.scale.setScalar(MM_PER_METER)
    this.robot = robot
    this._group.add(robot)

    // Own every material outright (ADR-144 D4). URDF `<material name=…>` entries
    // are shared by name, and with a stage per robot (ADR-090) a shared instance
    // would make ONE arm's unverified look appear on ANOTHER arm that never got a
    // preview — the ADR-093 shape again, invisible at N=1. Cloning per mesh makes
    // "this stage's look" a fact this stage alone can write. The opacity each
    // material started with is remembered so restoring is exact, not assumed 1.
    this._materials = []
    robot.traverse(child => {
      if (!child.material) return
      const list = Array.isArray(child.material) ? child.material : [child.material]
      const owned = list.map(m => m.clone())
      child.material = Array.isArray(child.material) ? owned : owned[0]
      for (const m of owned) this._materials.push([m, m.opacity ?? 1])
    })
  }

  /** Which geometry this stage currently draws — read-only (原則 #4: the only writer is `setRenderStyle`). */
  get renderStyle() { return this._renderStyle }

  /**
   * Swaps the drawn geometry between the bundled primitive skeleton and
   * Universal Robots' own visual meshes for the SAME UR5e chain (view-layer
   * only — joints/kinematics are unaffected either way, and both URDFs are
   * asserted to share them in `RobotVisualStyleAgreement.test.js`).
   * Idempotent; a style already showing is a no-op.
   *
   * ASYNC LIFECYCLE: switching to `'realistic'` fetches ~9 MB of COLLADA
   * meshes lazily. If this stage is disposed, or `setRenderStyle` is called
   * again, before that fetch resolves, the stale result is DROPPED — the
   * request that fired later (or the dispose) wins (原則 #24/#32), so a slow
   * background load can never clobber whatever the arm is showing by the
   * time it lands. A failed fetch leaves the arm showing whatever it drew
   * before the call, rather than going blank (原則 #11 read the other way:
   * a background asset failing to load must not blank an already-visible arm).
   *
   * @param {'skeleton'|'realistic'} style
   * @returns {Promise<void>}
   */
  async setRenderStyle(style) {
    if (style === this._renderStyle) return
    const token = ++this._styleLoadToken
    let robot
    try {
      robot = style === ROBOT_RENDER_STYLE.REALISTIC
        ? await this._loadRealisticRobot()
        : this._buildSkeletonRobot()
    } catch (err) {
      console.error('RobotStage.setRenderStyle: load failed, keeping the previous style.', err)
      return
    }
    if (token !== this._styleLoadToken || !this.robot) return   // superseded or disposed meanwhile

    const priorJoints = this.previewState()?.joints ?? null
    const wasUnverified = this._unverified

    this.robot.traverse(child => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const m of materials) m.dispose()
      }
    })
    this._group.remove(this.robot)

    this._attachRobot(robot)
    this._renderStyle = style
    // Carry the pose/look this stage was already showing onto the new
    // geometry — a style swap must not reset a mid-preview arm to rest.
    // `_attachRobot` just cloned fresh materials at their native opacity, so
    // `_unverified` must be reset to match BEFORE calling `_setUnverifiedLook`
    // — otherwise its no-redundant-work guard (`_unverified === unverified`)
    // sees the old flag, believes the new materials already carry the old
    // look, and never actually writes them.
    if (priorJoints) this.setJointValues(priorJoints)
    this._unverified = false
    this._setUnverifiedLook(wasUnverified)
  }

  /**
   * **The one entry point deciding which joint configuration this arm draws**
   * (ADR-135 D3, 原則 #4).
   *
   * Before ADR-135 the only writer was `_applyRestPose()`, always passing the
   * same constant. Candidate previews would have made a second writer, and two
   * writers of one visual fact race to last-write-wins. So the choice — rest or
   * preview — is made HERE, in one place, and nothing else writes joints.
   *
   * @param {{authority: 'solved'|'unverified', joints: readonly number[]}|null}
   *   preview  what to draw and ON WHOSE AUTHORITY (`previewPayloadFor`):
   *   `solved` carries the six angles `reachSolution.kind === 'solved'` decided
   *   in `core/`; `unverified` carries the configuration the client solved for a
   *   candidate nobody solved (ADR-144), which is drawn as an unverified ghost;
   *   `null` returns to the rest pose. A candidate with no solution AND no usable
   *   approximation is `null` here too — the arm must never be posed into a
   *   configuration neither a solver nor the sampler actually produced.
   */
  previewSolution(preview) {
    if (!this.robot) return
    // The decision is pure and lives in domain/robotConfig (原則 #3); this method
    // only performs the write. Every non-drawable case (null, `undeclared`, a
    // vector of the wrong length) comes back as the COMPLETE rest map, so the
    // arm can never be left half-posed.
    this.setJointValues(jointValuesFor(preview?.joints ?? null, ROBOT_JOINT_NAMES))
    // ADR-144 D4: the SAME method that decided which configuration to draw also
    // decides how it looks. An approximation drawn solid is indistinguishable
    // from a solution, which is the one failure mode ADR-144 accepts a cost to
    // avoid; a second owner for the material would race this write (原則 #4).
    this._setUnverifiedLook(preview?.authority === 'unverified')
  }

  /**
   * Draw the skeleton as an unverified ghost (translucent) or as itself.
   * INTERNAL to `previewSolution` — the authority that picked the joints is the
   * only thing allowed to pick the look.
   *
   * Deliberately no new colour: a hue would need a token (ADR-100) and would say
   * something specific, while translucency says the one true thing — this arm is
   * less solid a claim than a solved one.
   * @param {boolean} unverified
   */
  _setUnverifiedLook(unverified) {
    if (this._unverified === unverified) return
    this._unverified = unverified
    for (const [material, opacity] of this._materials) {
      material.transparent = unverified || opacity < 1
      material.opacity = unverified ? opacity * UNVERIFIED_OPACITY : opacity
      material.depthWrite = !unverified
      material.needsUpdate = true
    }
  }

  /**
   * Applies a set of joint angles (radians) to the loaded robot. INTERNAL helper
   * of `previewSolution` — it writes exactly the joints it is handed, so calling
   * it directly re-opens the second-writer hole ADR-135 D3 closed. The rendering
   * seam itself is unchanged (this is still the only place joints reach THREE).
   * @param {Record<string, number>} values
   */
  setJointValues(values) {
    if (!this.robot) return
    for (const [name, value] of Object.entries(values)) {
      this.robot.setJointValue(name, value)
    }
  }

  setVisible(visible) {
    this._group.visible = visible
  }

  /** Whether the skeleton is currently drawn (read-only accessor for the owner). */
  get visible() { return this._group.visible }

  /**
   * Read-only snapshot of WHAT THIS ARM IS DRAWING (ADR-144) — the angles read
   * back out of the loaded robot, plus whether they are being shown as an
   * unverified approximation.
   *
   * Read back from `robot.joints[…].angle`, not from what `previewSolution` was
   * handed: the claim ADR-144 has to answer for is "the arm on GitHub Pages
   * actually moves", and a snapshot of the intended values would be green even
   * if nothing reached THREE. The unit lane cannot see this (no `three`, no
   * URDF), so this is the only surface where the claim is executable — the same
   * reason `worldSpan()` exists for ADR-137.
   *
   * @returns {{unverified: boolean, joints: Record<string, number>}|null}
   */
  previewState() {
    if (!this.robot) return null
    /** @type {Record<string, number>} */
    const joints = {}
    for (const name of ROBOT_JOINT_NAMES) {
      const joint = this.robot.joints?.[name]
      if (joint) joints[name] = joint.angle
    }
    return { unverified: this._unverified, joints }
  }

  /**
   * World-space size of the loaded skeleton's bounding box, in world units
   * (mm — ADR-136), or null before the URDF resolves.
   *
   * Read-only measurement, exposed for the E2E scale-parity guard (ADR-137).
   * The claim "the URDF's metres became world millimetres" is only observable
   * once THREE has composed `robot.scale` into a real matrix, which no
   * `node --test` lane does — so it was left as a prose "manual check" that
   * nobody ran, and the metre-era boot camera shipped on top of it. A number
   * the browser can read turns that claim into an executable one.
   * @returns {{x:number,y:number,z:number}|null}
   */
  worldSpan() {
    if (!this.robot) return null
    const box = new THREE.Box3().setFromObject(this._group)
    if (box.isEmpty()) return null
    const size = box.getSize(new THREE.Vector3())
    return { x: size.x, y: size.y, z: size.z }
  }

  /**
   * First raycast intersection against the visible skeleton, or null. The
   * skeleton is a view-only decoration (not a scene entity), so it is invisible
   * to the entity raycasts; this lets the controller treat a click on the arm as
   * a click on its `robot_base` proxy entity (ADR-084 §2) — the answer to "why
   * can I select the cube but not the robot". Returns null while hidden or
   * before the URDF has loaded.
   * @param {THREE.Raycaster} raycaster  already aimed from the pointer
   * @returns {THREE.Intersection|null}
   */
  raycast(raycaster) {
    if (!this._group.visible || !this.robot) return null
    const hits = raycaster.intersectObject(this._group, true)
    return hits.length ? hits[0] : null
  }

  /**
   * Places the robot base at a world pose. A pure view-layer transform: the
   * skeleton follows the `robot_base` CoordinateFrame entity's world pose
   * (ADR-084 §2), driven by AppController._syncRobotStage() each frame. Reach/IK
   * evaluation of this placement happens in core/, not here.
   * @param {{x:number,y:number,z:number}} position
   * @param {{x:number,y:number,z:number,w:number}} [quaternion]
   */
  setPose(position, quaternion) {
    this._group.position.set(position.x, position.y, position.z)
    if (quaternion) this._group.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
  }

  /** Symmetric teardown (#9): every scene.add above has its remove+dispose here. */
  dispose() {
    if (this.robot) {
      this.robot.traverse((child) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const m of materials) m.dispose()
        }
      })
    }
    this._materials = []
    this._scene.remove(this._group)
    this.robot = null
  }
}
