/**
 * Is the "realistic" render style the SAME arm as the bundled skeleton?
 * (`src/view/robotVisualStyle.js` / `RobotStage.setRenderStyle`)
 *
 * The skeleton (`public/robot/skeleton_arm.urdf`) stays the ONE source of
 * kinematics/TCP-seed/reach-envelope (ADR-088, ADR-141) — the realistic URDF
 * (`public/robot/ur5e_visual/urdf/ur5e.urdf`, Universal Robots' own file,
 * unmodified) never feeds any of that. So this is not a second source in the
 * §1.1 sense, PROVIDED its joint origins agree with the skeleton's — if they
 * ever drift, the two render styles would silently draw two different arms.
 * That is the one fact this file exists to keep loud.
 *
 * Cannot use `parseUrdfChain` (`robotics/UrdfChain.js`) on the realistic file
 * directly: it is scoped to a single serial chain (its own documented
 * non-goal), and the official file has three fixed-joint branches off
 * `base_link` / `wrist_3_link` (the ROS-Industrial `base`/`flange`/`tool0`
 * frames) that are not part of the movable chain. So the six movable joints
 * are compared by NAME with a small local extraction instead of widening that
 * parser's contract for a one-off check.
 *
 * PER-JOINT agreement is necessary but was NOT sufficient: the official file
 * also roots its movable chain through an extra FIXED joint,
 * `base_link-base_link_inertia` (rpy `0 0 π`), that `skeleton_arm.urdf` does
 * not have (`domain/robotVisualStyle.js: REALISTIC_BASE_YAW_CORRECTION`'s
 * docstring). Six matching RELATIVE joint origins say nothing about that
 * shared root, so the tests below also run actual forward kinematics on both
 * chains (with `RobotStage`'s correction applied to the realistic one) and
 * assert the resulting flange POSE agrees — the same class of check ADR-146's
 * cross-language fixtures run, aimed at the one fact this file exists to keep
 * loud: "the TCP marker lands where the drawn arm's flange actually is."
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseUrdfChain, restPoseToQ } from './robotics/UrdfChain.js'
import { movableJoints, forwardKinematics } from './robotics/Kinematics.js'
import { REALISTIC_BASE_YAW_CORRECTION } from './domain/robotVisualStyle.js'
import { ROBOT_REST_POSE } from './domain/robotConfig.js'

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url))

const SKELETON_URDF   = readFileSync(path('../public/robot/skeleton_arm.urdf'), 'utf8')
const REALISTIC_URDF  = readFileSync(path('../public/robot/ur5e_visual/urdf/ur5e.urdf'), 'utf8')
const REALISTIC_DIR   = path('../public/robot/ur5e_visual')

const SKELETON_JOINTS = movableJoints(parseUrdfChain(SKELETON_URDF))

function attrNums(tag, attr) {
  const m = tag.match(new RegExp(`${attr}="([^"]*)"`))
  return m ? m[1].trim().split(/\s+/).map(Number) : [0, 0, 0]
}

/**
 * The named `<joint name="…">…</joint>` block's origin xyz/rpy and axis, from
 * raw URDF text. Requires a `type="…"` attribute so this matches the actual
 * kinematic joint and not a bare `<joint name="…">` stub inside a
 * `<transmission>` block (the official file declares one of those per joint,
 * BEFORE the real joint definition — the first `.match()` would otherwise
 * silently grab the stub, which carries no origin/axis at all).
 */
function namedJoint(urdfText, name) {
  const block = urdfText.match(
    new RegExp(`<joint\\s+name="${name}"\\s+type="[^"]+"[^>]*>([\\s\\S]*?)</joint>`))
  assert.ok(block, `no kinematic <joint name="${name}" type="…"> in the realistic URDF`)
  const originTag = block[1].match(/<origin\b[^>]*>/)
  const axisTag = block[1].match(/<axis\b[^>]*>/)
  return {
    origin: originTag
      ? { xyz: attrNums(originTag[0], 'xyz'), rpy: attrNums(originTag[0], 'rpy') }
      : { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    axis: axisTag ? attrNums(axisTag[0], 'xyz') : null,
  }
}

function assertClose(actual, expected, msg, eps = 1e-6) {
  assert.equal(actual.length, expected.length, msg)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < eps,
      `${msg}: [${actual}] vs [${expected}] (index ${i})`)
  }
}

test('the skeleton has exactly the six UR movable joints this file assumes', () => {
  assert.deepEqual(SKELETON_JOINTS.map(j => j.name), [
    'shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint',
    'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint',
  ])
})

for (const joint of SKELETON_JOINTS) {
  test(`realistic URDF's "${joint.name}" origin agrees with the skeleton's`, () => {
    const real = namedJoint(REALISTIC_URDF, joint.name)
    assertClose(real.origin.xyz, joint.origin?.xyz ?? [0, 0, 0], `${joint.name} xyz`)
    assertClose(real.origin.rpy ?? [0, 0, 0], joint.origin?.rpy ?? [0, 0, 0], `${joint.name} rpy`)
    if (joint.axis) assertClose(real.axis ?? [0, 0, 0], joint.axis, `${joint.name} axis`)
  })
}

test('REALISTIC_BASE_YAW_CORRECTION still matches the fixed joint it exists to cancel', () => {
  const baseFixed = namedJoint(REALISTIC_URDF, 'base_link-base_link_inertia')
  assertClose(baseFixed.origin.xyz, [0, 0, 0], 'base_link-base_link_inertia xyz')
  assert.ok(Math.abs(baseFixed.origin.rpy[2] - REALISTIC_BASE_YAW_CORRECTION) < 1e-6,
    `base_link-base_link_inertia rpy.z (${baseFixed.origin.rpy[2]}) no longer matches ` +
    `REALISTIC_BASE_YAW_CORRECTION (${REALISTIC_BASE_YAW_CORRECTION}) — RobotStage's ` +
    'correction needs updating, not just this constant')
})

test("with the yaw correction applied, the realistic chain's flange pose agrees with the skeleton's (forward kinematics)", () => {
  const skeletonChain = { joints: SKELETON_JOINTS }
  const skeletonFk = forwardKinematics(skeletonChain, restPoseToQ(skeletonChain, ROBOT_REST_POSE))

  // Independently reconstructed from the REALISTIC file's own declared values
  // (not copied from SKELETON_JOINTS) — this is what actually loads at
  // runtime: RobotStage's yaw correction, then the file's own fixed root
  // joint, then its own six movable joints.
  const baseFixed = namedJoint(REALISTIC_URDF, 'base_link-base_link_inertia')
  const realisticChain = {
    joints: [
      { name: 'yaw_correction', type: 'fixed',
        origin: { xyz: [0, 0, 0], rpy: [0, 0, REALISTIC_BASE_YAW_CORRECTION] } },
      { name: 'base_link-base_link_inertia', type: 'fixed', origin: baseFixed.origin },
      ...SKELETON_JOINTS.map(j => {
        const real = namedJoint(REALISTIC_URDF, j.name)
        return { name: j.name, type: j.type, axis: real.axis ?? undefined, origin: real.origin }
      }),
    ],
  }
  const realisticFk = forwardKinematics(realisticChain, restPoseToQ(realisticChain, ROBOT_REST_POSE))

  assertClose(
    [realisticFk.position.x, realisticFk.position.y, realisticFk.position.z],
    [skeletonFk.position.x, skeletonFk.position.y, skeletonFk.position.z],
    'flange position (this is what the TCP marker sits at)')

  // Quaternions double-cover SO(3): q and -q are the SAME rotation, so compare
  // via |dot product| rather than raw components (both signs are correct).
  const dot = realisticFk.quaternion.x * skeletonFk.quaternion.x
    + realisticFk.quaternion.y * skeletonFk.quaternion.y
    + realisticFk.quaternion.z * skeletonFk.quaternion.z
    + realisticFk.quaternion.w * skeletonFk.quaternion.w
  assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-6,
    `flange orientation mismatch (|dot|=${Math.abs(dot)}, expected ≈1)`)
})

test('every VISUAL mesh the realistic URDF references actually ships in public/robot/ur5e_visual', () => {
  // Collision meshes are deliberately not shipped (NOTICE.md) — urdf-loader's
  // `parseCollision` defaults to `false`, so `RobotStage` never requests them.
  const refs = [...REALISTIC_URDF.matchAll(/filename="package:\/\/ur_description\/(meshes\/ur5e\/visual\/[^"]+)"/g)]
  assert.ok(refs.length > 0, 'no visual package:// mesh refs found — did the URDF change shape?')
  for (const [, relPath] of refs) {
    assert.ok(existsSync(path(`../public/robot/ur5e_visual/${relPath}`)),
      `referenced mesh "${relPath}" is missing from public/robot/ur5e_visual`)
  }
})

test('provenance is declared, not silent (Apache-2.0 source)', () => {
  assert.ok(existsSync(`${REALISTIC_DIR}/LICENSE.txt`))
  assert.ok(existsSync(`${REALISTIC_DIR}/NOTICE.md`))
})

/**
 * Agreeing joint ORIGINS is not agreeing SILHOUETTES. The UR shoulder offset
 * (d4 = 0.1333) is a sum the kinematics never splits, but the real arm splits
 * it: the upper arm runs 0.138 out along the lift axis and the forearm comes
 * back to 0.007, leaving only a short rise at the wrist. The skeleton used to
 * draw both bones on the joint plane (z=0) and the whole offset at wrist_1 —
 * same DH, visibly different arm, and every joint-origin test above stayed
 * green. So the PLANE each long bone is drawn on is asked here, against the
 * plane the official mesh is placed on.
 */
function linkVisualOrigins(urdfText, linkName) {
  const block = urdfText.match(new RegExp(`<link\\s+name="${linkName}"\\s*>([\\s\\S]*?)</link>`))
  assert.ok(block, `no <link name="${linkName}">`)
  return [...block[1].matchAll(/<visual>([\s\S]*?)<\/visual>/g)].map(([, v]) => {
    const tag = v.match(/<origin\b[^>]*>/)
    return tag ? { xyz: attrNums(tag[0], 'xyz'), rpy: attrNums(tag[0], 'rpy') } : null
  })
}

for (const link of ['upper_arm_link', 'forearm_link']) {
  test(`the skeleton draws ${link}'s long bone on the same plane as the UR mesh`, () => {
    const [meshOrigin] = linkVisualOrigins(REALISTIC_URDF, link)
    // The long bone is the one laid along -X (rpy pitch = π/2); knuckles run along +Z.
    const bone = linkVisualOrigins(SKELETON_URDF, link)
      .find(o => o && Math.abs(o.rpy[1] - Math.PI / 2) < 1e-6)
    assert.ok(bone, `${link} has no -X bone in the skeleton`)
    assert.ok(Math.abs(bone.xyz[2] - meshOrigin.xyz[2]) < 1e-6,
      `${link}: skeleton bone plane z=${bone.xyz[2]} vs UR mesh z=${meshOrigin.xyz[2]}`)
  })
}
