// @ts-nocheck
import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import { ROBOT_REST_POSE } from '../domain/robotConfig.js'
import { ROBOT_URDF_TEXT } from './robotSkeleton.js'

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
    const [x, y, z] = opts.position ?? [-2, 2, 0]
    this._group.position.set(x, y, z)
    scene.add(this._group)

    // Parse the SAME bundled URDF string the tcp seed is derived from
    // (ROBOT_URDF_TEXT, ADR-088 §1.1) — one source drives both the drawn flange
    // and the seed, and no runtime fetch is needed. `parse` is synchronous.
    const loader = new URDFLoader()
    const robot = loader.parse(ROBOT_URDF_TEXT)
    // ROS (+Z up) and THREE.js world (+Z up here, per SceneView.camera.up)
    // already agree — URDFLoader instantiates links in URDF-native axes
    // with no reframing needed (see URDFLoader.js header comment).
    robot.rotation.x = 0
    this.robot = robot
    this._group.add(robot)
    this._applyRestPose()
  }

  /**
   * Applies the shared rest pose (ADR-088). The angles live in ONE place —
   * `ROBOT_REST_POSE` (domain/robotConfig) — and the tcp seed is DERIVED from
   * this same pose via forward kinematics, so the two can no longer drift: the
   * former "coupled pair, recompute the other" hand-discipline is now structural.
   */
  _applyRestPose() {
    if (!this.robot) return
    this.setJointValues(ROBOT_REST_POSE)
  }

  /**
   * Applies a set of joint angles (radians) to the loaded robot. Values come
   * from outside this class (e.g. a future grasp-contract response) — this
   * method only renders them.
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
    this._scene.remove(this._group)
    this.robot = null
  }
}
