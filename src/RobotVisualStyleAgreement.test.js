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
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseUrdfChain } from './robotics/UrdfChain.js'
import { movableJoints } from './robotics/Kinematics.js'

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
