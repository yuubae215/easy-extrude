// @ts-nocheck
import * as THREE from 'three'
import URDFLoader from 'urdf-loader'

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
 * The robot model is a self-contained synthetic 6-DOF "skeleton" URDF
 * (`public/robot/skeleton_arm.urdf`) built entirely from primitive
 * <geometry> (box/cylinder) — no external mesh assets, so URDFLoader needs no
 * `packages` mapping or mesh loader override.
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

    const loader = new URDFLoader()
    const urdfUrl = `${import.meta.env.BASE_URL}robot/skeleton_arm.urdf`
    loader.load(urdfUrl, (robot) => {
      // ROS (+Z up) and THREE.js world (+Z up here, per SceneView.camera.up)
      // already agree — URDFLoader instantiates links in URDF-native axes
      // with no reframing needed (see URDFLoader.js header comment).
      robot.rotation.x = 0
      this.robot = robot
      this._group.add(robot)
      this._applyRestPose()
    })
  }

  /** A visually legible bent-elbow rest pose instead of a straight totem pole. */
  _applyRestPose() {
    if (!this.robot) return
    this.setJointValues({
      shoulder_lift_joint: -0.6,
      elbow_joint: 1.0,
      wrist_1_joint: -0.4,
    })
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
