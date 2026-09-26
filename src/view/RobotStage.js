// @ts-nocheck
import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import { jointValuesFor } from '../domain/robotConfig.js'
import { ROBOT_JOINT_NAMES, ROBOT_URDF_TEXT } from './robotSkeleton.js'
import { MM_PER_METER } from '../domain/worldUnits.js'
import {
  ROBOT_RENDER_STYLE, assertRenderStyle, isRedundantStyleRequest, settledStyle,
} from './robotVisualStyle.js'
import { instantiateRealisticRobot } from './realisticRobotAsset.js'
import { axialToolLengthM, tcpMarkerPose, toolParts } from '../domain/robotTool.js'
import { COLOR } from '../theme/tokens.js'

/**
 * How much of its own opacity the skeleton keeps while it draws a CLIENT
 * APPROXIMATION rather than a solver's solution (ADR-144 D4). Low enough that
 * "this is not a verified answer" reads at a glance, high enough that the
 * silhouette is still legible — the preview has to be useful to be worth drawing.
 */
const UNVERIFIED_OPACITY = 0.38

/**
 * Value equality of two tool mounts (mm / quaternion), so the per-frame sync
 * rebuilds nothing while the mount is unchanged.
 * @param {{translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null} a
 * @param {{translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null} b
 */
function sameToolMount(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const t = a.translation, u = b.translation, q = a.rotation, r = b.rotation
  return t.x === u.x && t.y === u.y && t.z === u.z &&
    q.x === r.x && q.y === r.y && q.z === r.z && q.w === r.w
}

/**
 * Value equality of two declared hands (ADR-152 D3) — plain JSON data, so a
 * structural compare is exact. Lets the per-frame sync skip the rebuild while the
 * hand is unchanged, like `sameToolMount`.
 * @param {object|null} a
 * @param {object|null} b
 */
function sameHand(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

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
 * lazily, so the constructor never awaits it — every stage boots holding the
 * bundled skeleton.
 *
 * FIRST LOOK (ADR-150 D2): a stage told at construction that its scene
 * declares another style keeps that skeleton BUILT (so every accessor —
 * `previewState`, `worldSpan`, joints — works from frame one) but HIDDEN until
 * the declared style has been drawn once. Showing the skeleton meanwhile is
 * what made every spawn flash one arm and then another. If the declared style
 * cannot be loaded, the skeleton is revealed instead and the rejection reaches
 * the owner (RobotStageSet → toast), so the arm never silently stays invisible
 * (原則 #11).
 */
export class RobotStage {
  /**
   * @param {THREE.Scene} scene
   * @param {{position?: [number, number, number], declaredStyle?: 'skeleton'|'realistic',
   *   toolMount?: {translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null}} [opts]
   *   `declaredStyle` — the style the owning scene declares; anything other
   *   than the skeleton keeps the arm hidden until that style lands (ADR-150).
   *   `toolMount` — the robot's tool mount (`tool0 → tcp`, mm) if already known;
   *   the owner keeps it current through `setToolMount` (ADR-151).
   */
  constructor(scene, opts = {}) {
    this._scene = scene
    this.robot = null
    /**
     * The tool mount this arm draws its tool and TCP marker from (ADR-151), or
     * null when the robot declares none. Only `setToolMount` writes it after
     * construction (原則 #4).
     */
    this._toolMount = opts.toolMount ?? null
    /**
     * The declared hand (ADR-152 D3, mm) the tool is drawn from, or null when
     * undeclared (then the tool is the flange→TCP rod core/ judges). Written only
     * by `setToolMount` after construction (原則 #4).
     */
    this._hand = opts.hand ?? null
    /** @type {THREE.Group|null} the tool + TCP marker currently on `wrist_3_link` */
    this._toolGroup = null

    this._group = new THREE.Group()
    const [x, y, z] = opts.position ?? [-2 * MM_PER_METER, 2 * MM_PER_METER, 0]
    this._group.position.set(x, y, z)
    scene.add(this._group)

    /** @type {'skeleton'|'realistic'} which geometry is currently drawn (原則 #4 — this field's only writer is `setRenderStyle`) */
    this._renderStyle = ROBOT_RENDER_STYLE.SKELETON
    /**
     * @type {'skeleton'|'realistic'|null} the style an in-flight load is
     * heading for, or `null` when nothing is in flight. SEPARATE FROM
     * `_renderStyle` on purpose: while a realistic load is in the air the
     * stage HAS the skeleton but IS HEADING FOR realistic, and only the
     * second fact can answer "is this new request redundant?" (ADR-148 D1).
     */
    this._pendingStyle = null
    // Monotonic token invalidating an in-flight `setRenderStyle('realistic')`
    // fetch that a LATER call (or `dispose()`) has superseded — the async
    // mesh load must not clobber a stage that has since moved on (原則 #24).
    this._styleLoadToken = 0
    /** @type {boolean} whether the skeleton currently draws an unverified pose */
    this._unverified = false
    /** @type {Array<[THREE.Material, number]>} materials this stage owns (cloned per attach) */
    this._materials = []
    /**
     * @type {boolean} true until this stage has drawn the style its scene
     * declared (ADR-150 D2). Only `_endFirstLook` clears it, once, for good.
     */
    this._awaitingFirstLook =
      assertRenderStyle(opts.declaredStyle ?? ROBOT_RENDER_STYLE.SKELETON) !== ROBOT_RENDER_STYLE.SKELETON

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
    // Hidden while the first look is pending (ADR-150 D2). The GROUP's
    // visibility belongs to the Outliner eye (`setVisible`, 原則 #4); the robot
    // node's belongs to this stage alone, so the two never write one flag.
    robot.visible = !this._awaitingFirstLook
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
    this._attachTool(robot)
  }

  /** The URDF link the tool is bolted to — the DH flange frame (asserted in `robotTool.test.js`). */
  static TOOL_LINK = 'wrist_3_link'

  /**
   * Bolt the tool — and the TCP marker — onto this robot's flange (ADR-150 D4,
   * ADR-151 D2). Both are children of `wrist_3_link`, so they move with the
   * wrist by construction: the only way a drawn tool can be "attached" rather
   * than placed next to the arm, and the only way the TCP marker can stand at
   * the tool tip in EVERY pose (rest, preview, either style) without code that
   * compares or synchronises anything. Both are built from the robot's own tool
   * mount — the same `tool0 → tcp` edge the grasp request declares as
   * `robot.toolLength` — so what the viewer sees is the tool that was solved.
   *
   *   - no mount (the robot has no tcp) → no tool and no marker: the interface is
   *     undeclared, and a drawn default would claim a tool nobody declared;
   *   - a mount straight along +Z → the tool body AND the marker at its tip;
   *   - any other mount → the marker only (stage 1 cannot say what such a tool
   *     looks like, and grasp search refuses it with a reason).
   *
   * Rebuilt on every attach (a style swap brings a new URDF tree) and on every
   * mount change, and owned by this stage: its meshes are flagged `stageOwned`
   * so `_disposeTree` frees them even under a realistic clone whose other
   * geometry is shared (原則 #9), and its materials join `_materials` so the
   * unverified look reaches the tool too (原則 #4 — one owner of this arm's look).
   * @param {import('three').Object3D} robot
   */
  _attachTool(robot) {
    const link = robot.links?.[RobotStage.TOOL_LINK]
    if (!link) {
      // Never a silent tool-less arm (原則 #31): both URDFs this app ships have
      // the link, so its absence is a broken asset, not a legitimate 0.
      throw new Error(`RobotStage: no "${RobotStage.TOOL_LINK}" to mount the tool on`)
    }
    const tool = new THREE.Group()
    tool.name = 'tool'
    /** @type {THREE.Material[]} */
    const owned = []
    const toolLength = axialToolLengthM(this._toolMount)
    if (toolLength !== null) {
      const color = { body: COLOR.surfaceRaised, finger: COLOR.entityDefault, cup: COLOR.entityDefault, rod: COLOR.surfaceRaised }
      for (const part of toolParts(this._hand, toolLength)) {
        const geometry = part.shape === 'cylinder'
          ? new THREE.CylinderGeometry(part.size[0], part.size[0], part.size[1], 24)
          : new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2])
        // THREE's cylinder runs along +Y; the tool runs along the flange +Z.
        if (part.shape === 'cylinder') geometry.rotateX(Math.PI / 2)
        const material = new THREE.MeshStandardMaterial({ color: color[part.part], roughness: 0.6, metalness: 0.2 })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(...part.center)
        mesh.userData.stageOwned = true
        tool.add(mesh)
        owned.push(material)
      }
    }
    const marker = RobotStage._buildTcpMarker(tcpMarkerPose(this._toolMount), owned)
    if (marker) tool.add(marker)
    for (const m of owned) this._materials.push([m, m.opacity ?? 1])
    link.add(tool)
    this._toolGroup = tool
  }

  /**
   * The TCP marker (ADR-151 D2): a REP-103 axis triad plus a `tcp` label, at the
   * mount's pose in the flange frame. World-sized (decision b) — it is part of
   * the arm, so it scales with the tool on screen. Pure construction: every
   * material it creates is appended to `owned` for the caller to govern.
   * @param {ReturnType<typeof tcpMarkerPose>} pose
   * @param {THREE.Material[]} owned
   * @returns {THREE.Group|null}
   */
  static _buildTcpMarker(pose, owned) {
    if (!pose) return null
    const marker = new THREE.Group()
    marker.name = 'tcpMarker'
    marker.position.set(...pose.position)
    marker.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w)
    const L = pose.axisLength
    const radius = L * 0.04
    const axes = [
      { color: COLOR.axisX, rotate: g => g.rotateZ(-Math.PI / 2) },   // +Y → +X
      { color: COLOR.axisY, rotate: () => {} },                        // +Y
      { color: COLOR.axisZ, rotate: g => g.rotateX(Math.PI / 2) },    // +Y → +Z
    ]
    for (const { color, rotate } of axes) {
      const geometry = new THREE.CylinderGeometry(radius, radius, L, 12)
      geometry.translate(0, L / 2, 0)
      rotate(geometry)
      const material = new THREE.MeshBasicMaterial({ color })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.userData.stageOwned = true
      marker.add(mesh)
      owned.push(material)
    }
    const label = RobotStage._buildLabel('tcp', L * 0.5)
    if (label) {
      label.position.set(0, 0, L * 1.35)
      marker.add(label)
      owned.push(label.material)
    }
    return marker
  }

  /**
   * A world-sized text sprite. Returns null where there is no canvas to draw on
   * (never in the browser this class runs in) rather than throwing mid-attach.
   * @param {string} text
   * @param {number} height  world height of the text, in the parent's units
   * @returns {THREE.Sprite|null}
   */
  static _buildLabel(text, height) {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.font = 'bold 44px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = COLOR.textPrimary
    ctx.fillText(text, 64, 34)
    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(height * 2, height, 1)
    sprite.userData.stageOwned = true
    sprite.userData.ownedTexture = texture
    return sprite
  }

  /**
   * Adopt the robot's tool mount (ADR-151) — the ONE writer of `_toolMount`
   * after construction, called by the owner every frame from the scene's tcp
   * frame. Idempotent by value: an unchanged mount rebuilds nothing. A changed
   * one replaces the tool + marker, carrying the current look onto them.
   * @param {{translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null} mount  mm
   */
  setToolMount(mount, hand = null) {
    // The drawn tool depends on TWO facts since ADR-152 D3: where it is mounted
    // (the TCP marker, the rod's length) and what the hand is (its shape).
    if (sameToolMount(this._toolMount, mount) && sameHand(this._hand, hand)) return
    this._toolMount = mount ? { translation: { ...mount.translation }, rotation: { ...mount.rotation } } : null
    this._hand = hand ? JSON.parse(JSON.stringify(hand)) : null
    if (!this.robot) return
    this._detachTool()
    const before = this._materials.length
    this._attachTool(this.robot)
    // Only the NEW materials need the current look; the arm's already carry it.
    if (this._unverified) {
      for (const [material, opacity] of this._materials.slice(before)) {
        material.transparent = true
        material.opacity = opacity * UNVERIFIED_OPACITY
        material.depthWrite = false
        material.needsUpdate = true
      }
    }
  }

  /** Removes and frees the current tool + marker (the release paired with `_attachTool`, 原則 #9). */
  _detachTool() {
    const tool = this._toolGroup
    if (!tool) return
    const released = new Set()
    tool.traverse(child => {
      child.geometry?.dispose()
      child.userData?.ownedTexture?.dispose()
      if (child.material) {
        for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
          m.dispose()
          released.add(m)
        }
      }
    })
    tool.parent?.remove(tool)
    this._materials = this._materials.filter(([m]) => !released.has(m))
    this._toolGroup = null
  }

  /**
   * World position of the TCP marker, or null when none is drawn — read-only,
   * for the e2e that asks whether the marker rides the tool tip in every pose
   * (ADR-151). Read from the composed matrix, not from the mount: the claim is
   * about what THREE actually drew, which no unit lane can see.
   * @returns {{x:number,y:number,z:number}|null}
   */
  tcpMarkerWorldPosition() {
    const marker = this._toolGroup?.getObjectByName('tcpMarker')
    if (!marker) return null
    this._group.updateWorldMatrix(true, true)
    const p = marker.getWorldPosition(new THREE.Vector3())
    return { x: p.x, y: p.y, z: p.z }
  }

  /** Whether this stage is still waiting to draw its scene's declared style for the first time (ADR-150). */
  get awaitingFirstLook() { return this._awaitingFirstLook }

  /**
   * The style the viewer can SEE on this arm right now — `null` while it is
   * hidden awaiting its first look. The third lane beside `renderStyle`
   * (committed) and `settledRenderStyle` (heading for): the spawn flash ADR-150
   * removes was visible in none of those two, because both were right.
   * @returns {'skeleton'|'realistic'|null}
   */
  get shownStyle() { return this.robot?.visible ? this._renderStyle : null }

  /** Reveal the arm, once — whatever it is now drawing is its first look. */
  _endFirstLook() {
    if (!this._awaitingFirstLook) return
    this._awaitingFirstLook = false
    if (this.robot) this.robot.visible = true
  }

  /** Which geometry this stage currently DRAWS — read-only (原則 #4: the only writer is `setRenderStyle`). */
  get renderStyle() { return this._renderStyle }

  /**
   * Which geometry this stage is HEADING FOR — the pending request while a
   * realistic load is in the air, else the drawn one. Distinct from
   * `renderStyle` because the swap is asynchronous; a caller asking "did my
   * request take?" must read this, not the drawn style (ADR-148 D1).
   * @returns {'skeleton'|'realistic'}
   */
  get settledRenderStyle() { return settledStyle(this._renderStyle, this._pendingStyle) }

  /**
   * Swaps the drawn geometry between the bundled primitive skeleton and
   * Universal Robots' own visual meshes for the SAME UR5e chain (view-layer
   * only — joints/kinematics are unaffected either way, and both URDFs are
   * asserted to share them in `RobotVisualStyleAgreement.test.js`).
   *
   * IDEMPOTENT AGAINST THE SETTLED STYLE, NOT THE DRAWN ONE (ADR-148 D1). A
   * request is a no-op only when the stage is already HEADING FOR that style.
   * Comparing against the drawn style instead turned the request that must
   * CANCEL an in-flight load into an early return that never bumped the
   * supersession token, so the losing request's geometry landed and stayed —
   * the rule is pure and lives in `domain/robotVisualStyle.js` (原則 #3), and
   * this method only performs the write.
   *
   * ASYNC LIFECYCLE: switching to `'realistic'` fetches ~9 MB of COLLADA
   * meshes lazily. If this stage is disposed, or `setRenderStyle` is called
   * again, before that fetch resolves, the stale result is DROPPED and its
   * geometry disposed on the spot — the request that fired later (or the
   * dispose) wins (原則 #24/#32), so a slow background load can never clobber
   * whatever the arm is showing by the time it lands.
   *
   * FAILURE IS REPORTED, NOT SWALLOWED (原則 #11). A failed fetch leaves the
   * arm showing whatever it drew before the call — a background asset failing
   * to load must not blank an already-visible arm — but the returned promise
   * REJECTS, so the caller can tell "switched" from "kept the old one". The
   * earlier shape resolved successfully either way, which left the only fact
   * distinguishing them in a `console.error` nothing can read back.
   *
   * @param {'skeleton'|'realistic'} style
   * @returns {Promise<void>} REJECTS when the geometry could not be loaded, and
   *   also for a style outside the declared vocabulary — this is an `async`
   *   method, so `assertRenderStyle`'s throw surfaces as a rejection, never as
   *   a synchronous one. Callers must handle the promise to see either.
   */
  async setRenderStyle(style) {
    assertRenderStyle(style)   // no fall-through to the default (原則 #31)
    if (isRedundantStyleRequest(style, this._renderStyle, this._pendingStyle)) return
    const token = ++this._styleLoadToken
    this._pendingStyle = style
    let robot
    try {
      robot = style === ROBOT_RENDER_STYLE.REALISTIC
        ? await instantiateRealisticRobot()
        : this._buildSkeletonRobot()
    } catch (err) {
      // Only the request still in flight may clear the pending marker; a later
      // one has already replaced it and is the stage's current intent.
      if (token === this._styleLoadToken) {
        this._pendingStyle = null
        // The declared style is not coming: show what we have rather than an
        // invisible arm. The rejection below is what tells the user (原則 #11).
        this._endFirstLook()
      }
      throw err
    }
    if (token !== this._styleLoadToken || !this.robot) {
      // Superseded or disposed while the meshes were in the air. Dispose what
      // was loaded here rather than leaving it to GC — every load in this
      // class has its release in this class (原則 #9).
      RobotStage._disposeTree(robot)
      return
    }
    this._pendingStyle = null

    const priorJoints = this.previewState()?.joints ?? null
    const wasUnverified = this._unverified

    RobotStage._disposeTree(this.robot)
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
    this._endFirstLook()
  }

  /**
   * Releases every geometry/material under an Object3D. The ONE place this
   * class frees loaded geometry, so the three paths that need it (style swap,
   * superseded load, `dispose()`) cannot drift apart (原則 #9).
   * @param {import('three').Object3D|null} root
   */
  static _disposeTree(root) {
    if (!root) return
    // A realistic clone draws the shared template's geometry (ADR-150 D1): its
    // materials are this stage's own (cloned in `_attachRobot`), its geometry is
    // not — releasing it would blank every other arm drawing the same mesh.
    const ownsGeometry = !root.userData?.sharedGeometry
    root.traverse(child => {
      // The tool (ADR-150 D4) is this stage's own even on a shared-geometry clone.
      if (child.geometry && (ownsGeometry || child.userData?.stageOwned)) child.geometry.dispose()
      child.userData?.ownedTexture?.dispose()
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const m of materials) m.dispose()
      }
    })
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
    if (!this._group.visible || !this.robot?.visible) return null
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
    // Invalidate any in-flight style load before dropping the robot: the load
    // checks BOTH the token and `this.robot`, and bumping the token here means
    // a landing load disposes its own geometry (the `_disposeTree` in
    // `setRenderStyle`'s superseded branch) instead of relying on GC.
    this._styleLoadToken++
    this._pendingStyle = null
    RobotStage._disposeTree(this.robot)
    this._materials = []
    this._scene.remove(this._group)
    this.robot = null
  }
}
