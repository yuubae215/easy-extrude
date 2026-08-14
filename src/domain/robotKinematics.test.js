/**
 * robotKinematics — the arm the app DRAWS is the arm the solver is TOLD about
 * (ADR-127 / DEF-030).
 *
 * ## What DEF-030 asked for, and what this suite actually asserts
 *
 * DEF-030 listed three things that had to travel together with the front wiring:
 *   (1) send the declaration at all — without it, ADR-127's analytic IK is
 *       correct, tested, and unreachable from the screen;
 *   (2) make the URDF's six numbers and the sent six numbers agree;
 *   (3) reconcile the flange-frame convention with what the front draws.
 *
 * (2) is closed one step harder than planned: there is no second copy to compare,
 * because the numbers are READ OUT OF the URDF. So the assertion here is not
 * "the two copies match" but **"the reading produces the published UR5e values"**
 * — which is the check that makes a URDF edit changing the arm loud.
 *
 * (3) is the one ADR-127 warned cannot be settled inside `core/`: a
 * self-consistent wrong convention passes every round-trip there. It can only be
 * settled against something outside that loop, and the only such thing is the
 * geometry the front draws — so the flange test below reads the URDF's own
 * flange visual and asserts it sits on the axis the convention names.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseUrdfChain } from '../robotics/UrdfChain.js'
import {
  readUrKinematics, kinematicsDeclarationFromUrdf,
  KINEMATICS_KIND_UR, FLANGE_APPROACH_AXIS, NOT_UR_REASONS,
} from './robotKinematics.js'

const here = dirname(fileURLToPath(import.meta.url))
const URDF = readFileSync(join(here, '..', '..', 'public', 'robot', 'skeleton_arm.urdf'), 'utf8')

/**
 * The published UR5e DH lengths (Universal Robots' own figures, also quoted in
 * the URDF header and in ADR-127's Context). Pinned here as the INDEPENDENT
 * fixture: the reading under test must reproduce them, so a URDF edited into a
 * different arm — or a reading that drifts — fails loudly instead of shipping six
 * plausible numbers for a robot nobody owns.
 */
const UR5E_PUBLISHED_DH = Object.freeze({
  d1: 0.1625, a2: -0.425, a3: -0.3922, d4: 0.1333, d5: 0.0997, d6: 0.0996,
})

test('URDF から読んだ 6 数が UR5e の公表値と一致する — 送る数と描く数が同一の源から出る', () => {
  const read = readUrKinematics(parseUrdfChain(URDF))
  assert.ok(!('reason' in read), JSON.stringify(read))
  assert.deepEqual(read.dh, UR5E_PUBLISHED_DH)
})

test('宣言は kind 判別の閉じた形で出る (ADR-127 D1) — 機種名は載せない (D2)', () => {
  const decl = kinematicsDeclarationFromUrdf(URDF)
  assert.equal(decl.kind, KINEMATICS_KIND_UR)
  assert.deepEqual(Object.keys(decl).sort(), ['dh', 'jointLimits', 'kind'])
  // D2: 名前は運ばない — 名前を運ぶと解く側に「名前 → 寸法」の第二の源が要る。
  assert.equal(JSON.stringify(decl).includes('ur5e'), false)
  assert.equal(JSON.stringify(decl).includes('model'), false)
})

test('URDF が関節限界を宣言しているので送る — 限界の不在は「無限」ではないので、在るなら運ぶ', () => {
  const decl = kinematicsDeclarationFromUrdf(URDF)
  assert.equal(decl.jointLimits.length, 6)
  for (const l of decl.jointLimits) {
    assert.ok(Number.isFinite(l.min) && Number.isFinite(l.max) && l.min < l.max)
  }
})

test('限界が 1 つでも欠けたら 1 つも送らない — 部分集合は「自由な関節」に化ける (ADR-127 D4)', () => {
  // Strip the limit from a single joint: the honest answer is to declare NO
  // limits, because a partial set makes the stripped joint look unconstrained
  // while the others look constrained — and "unlimited" and "unstated" must not
  // produce the same answer.
  const stripped = URDF.replace(/<limit lower="-3\.1416"[^>]*\/>/, '')
  const decl = kinematicsDeclarationFromUrdf(stripped)
  assert.equal(decl.kind, KINEMATICS_KIND_UR)
  assert.equal('jointLimits' in decl, false)
})

// ── The kind is a STRUCTURAL claim, so a non-UR chain gets no declaration ─────

test('関節が 6 本でない鎖には kind を出さない — 長い腕は「長い UR」ではなく別の腕', () => {
  const chain = parseUrdfChain(URDF)
  chain.joints.push({ name: 'extra', type: 'revolute', axis: [0, 0, 1], origin: { xyz: [0, 0, 0.1] } })
  const read = readUrKinematics(chain)
  assert.equal(read.reason, NOT_UR_REASONS.JOINT_COUNT)
})

test('軸 2/3/4 が平行でなければ kind を出さない — 閉形式はその構造にしか存在しない', () => {
  const chain = parseUrdfChain(URDF)
  // Tilt the elbow out of the shoulder's plane: the six lengths would still be
  // readable, and they would describe an arm that cannot be solved in closed
  // form. Six plausible numbers for the wrong structure is the failure mode this
  // check exists for (its answer looks exactly like a correct one).
  chain.joints.find(j => j.name === 'elbow_joint').origin.rpy = [0.4, 0, 0]
  const read = readUrKinematics(chain)
  assert.equal(read.reason, NOT_UR_REASONS.STRUCTURE)
})

test('手首が直交していなければ kind を出さない', () => {
  const chain = parseUrdfChain(URDF)
  chain.joints.find(j => j.name === 'wrist_2_joint').origin.rpy = [0.2, 0, 0]
  assert.equal(readUrKinematics(chain).reason, NOT_UR_REASONS.STRUCTURE)
})

test('構造が違う URDF は宣言 null — 素朴コーン判定のまま (ADR-127 D3 の安全側)', () => {
  const notUr = URDF.replace(/<joint name="wrist_3_joint"[\s\S]*?<\/joint>/, '')
  assert.equal(kinematicsDeclarationFromUrdf(notUr), null)
})

test('壊れた URDF でも throw せず null — 宣言の不在は既定へ落ちるだけで安全', () => {
  assert.equal(kinematicsDeclarationFromUrdf('<robot></robot>'), null)
  assert.equal(kinematicsDeclarationFromUrdf(''), null)
})

// ── (3) the flange convention, reconciled against the drawn geometry ─────────

test('フランジの規約 (+Z = approach) が、フロントが実際に描くフランジ面と一致する', () => {
  // ADR-127 D6 declares FLANGE_Z_IS_APPROACH. Inside core/ that cannot be
  // checked — a self-consistent wrong gauge passes every round-trip. The only
  // external witness is what the app DRAWS, so read it back out of the URDF:
  // the flange face marker on wrist_3_link must sit along the declared axis.
  const link = URDF.match(/<link name="wrist_3_link">[\s\S]*?<\/link>/)?.[0]
  assert.ok(link, 'wrist_3_link (tool0) が URDF に無い — 規約の照合先が消えている')

  const offsets = [...link.matchAll(/<origin xyz="([^"]+)"/g)]
    .map(m => m[1].trim().split(/\s+/).map(Number))
    .filter(v => v.some(c => c !== 0))
  assert.ok(offsets.length > 0, 'フランジ面を示す visual が無い')

  for (const [x, y, z] of offsets) {
    assert.equal(x, 0, 'フランジ面が宣言軸の外に在る — 規約か描画のどちらかが動いた')
    assert.equal(y, 0)
    assert.ok(z > 0, `フランジ面は +Z 側であるべき (宣言 FLANGE_Z_IS_APPROACH)、実際は z=${z}`)
  }
  assert.deepEqual(FLANGE_APPROACH_AXIS, { x: 0, y: 0, z: 1 })
})

// ── The derived declaration conforms to the contract it will ride on ─────────

test('URDF から導いた宣言が request 契約のスキーマに適合する — 導出とワイヤの間を閉じる', async () => {
  // The front DERIVES this shape; the contract OWNS it. Two sides of one fact,
  // and the seam between them is exactly where a hand-shaped object drifts from
  // the schema it is supposed to satisfy. Checked here rather than trusted,
  // because the failure mode is a 400 discovered by a user (原則 #29).
  const { default: Ajv2020 } = await import('ajv/dist/2020.js')
  const schema = JSON.parse(readFileSync(
    join(here, '..', '..', 'packages', 'grasp-contract', 'schema', 'grasp-search-request.schema.json'), 'utf8',
  ))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile({ ...schema.$defs.kinematicsUniversalRobots, $schema: schema.$schema })

  const decl = kinematicsDeclarationFromUrdf(URDF)
  assert.equal(validate(decl), true, JSON.stringify(validate.errors, null, 2))
})
