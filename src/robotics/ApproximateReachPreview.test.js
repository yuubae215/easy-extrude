/**
 * ApproximateReachPreview.test.js — ADR-144 の機械的証拠。
 *
 * 問うているのは「近似が当たるか」だけではない。ADR-144 が受け入れたコストは
 * **近似が権威を騙りうること**なので、検査の半分は精度ではなく *区別* を焼く:
 *
 *   1. 許容誤差を超えたら `null` — 「一番近いもの」を返さない (原則 #11)。
 *      一番近いだけの配置は、粗いプレビューではなく **間違った腕**である。
 *   2. 返る形は契約の `reachSolution` スキーマに対して **構造的に invalid** —
 *      「別の名前を使った」という主張ではなく、ajv が実際に拒否することを焼く。
 *      同じ ajv が `solved` を通すことも同時に主張する (検査が壊れていて全部
 *      拒否しているだけ、という緑を防ぐ)。
 *   3. 解法を書いていないこと = この module の import が FK 測定器と単位変換の
 *      2 つだけであること。`src/` は解法を持たない (CLAUDE.md 層境界) は散文の
 *      規律だったので、ここで**個数**にして機械へ降ろす (憲法 Q3)。
 *   4. 決定的であること — 同じ入力に 2 回聞いて違う腕が出るなら、それは
 *      「おおよそこの辺」ですらない。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseUrdfChain } from './UrdfChain.js'
import { forwardKinematics, movableJoints } from './Kinematics.js'
import {
  APPROXIMATE_PREVIEW, CLIENT_APPROXIMATE,
  approximateJointsFor, positionInfluentialJoints, toBaseFrame,
} from './ApproximateReachPreview.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CHAIN = parseUrdfChain(readFileSync(join(ROOT, 'public', 'robot', 'skeleton_arm.urdf'), 'utf8'))

/** A target we KNOW is reachable: the hand's own position at some configuration. */
function handAt(q) {
  return forwardKinematics(CHAIN, q).position
}

const mmBetween = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 1000

// ── 1. it reaches what is reachable, and says how far it missed ──────────────

test('到達可能な点には許容誤差内の配置を返し、その誤差を宣言する', () => {
  // Four configurations spread over the workspace — not one lucky pose.
  const posed = [
    [0.4, -1.1, 1.3, -1.2, -1.5, 0.2],
    [-1.9, -0.6, 0.9, -1.9, 1.4, 0.0],
    [2.4, -1.4, 1.8, -0.7, -1.1, 1.0],
    [0.0, -0.9, 1.0, -1.7, -1.5708, 0.0],
  ]
  for (const q of posed) {
    const target = handAt(q)
    const found = approximateJointsFor(CHAIN, target)
    assert.ok(found, `no approximation for ${JSON.stringify(q)}`)
    assert.equal(found.origin, CLIENT_APPROXIMATE)
    assert.equal(found.joints.length, movableJoints(CHAIN).length)
    // The declared error is the REAL error: re-run FK on what came back.
    const actual = mmBetween(handAt(found.joints), target)
    assert.ok(Math.abs(actual - found.errorMm) < 1e-6, `errorMm ${found.errorMm} vs measured ${actual}`)
    assert.ok(found.errorMm <= found.toleranceMm, `missed by ${found.errorMm}mm`)
  }
})

// ── 2. beyond tolerance is null, never "the closest one" ─────────────────────

test('許容誤差を超えたら null — 一番近い配置を代わりに返さない (原則 #11)', () => {
  // 10 m up: no configuration of a 0.9 m arm comes near it. The nearest sample
  // still EXISTS — returning it is exactly the silent fallback this forbids.
  const unreachable = { x: 0, y: 0, z: 10 }
  assert.equal(approximateJointsFor(CHAIN, unreachable), null)

  // The boundary itself: a reachable point with an impossibly tight tolerance
  // also declines. "Close enough" is the CALLER's declaration, not a constant
  // the sampler may quietly relax.
  const target = handAt([0.4, -1.1, 1.3, -1.2, -1.5, 0.2])
  assert.equal(approximateJointsFor(CHAIN, target, { toleranceMm: 1e-9 }), null)
})

test('近似を探せない鎖には null — 例外でユーザーの操作を落とさず、推測もしない', () => {
  // A chain whose grid cannot be built (12 movable joints blows the sample cap).
  const huge = { joints: Array.from({ length: 12 }, () => ({ type: 'revolute', axis: [0, 0, 1], origin: { xyz: [0, 0, 0.1] } })) }
  assert.equal(approximateJointsFor(huge, { x: 0.3, y: 0, z: 0.5 }), null)
})

// ── 3. the wire's schema rejects the client's shape, structurally ────────────

test('近似結果は reachSolution スキーマに対して invalid — 型で権威を分ける (ADR-144 D2)', async () => {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js')
  const schema = JSON.parse(readFileSync(
    join(ROOT, 'packages', 'grasp-contract', 'schema', 'grasp-search-response.schema.json'), 'utf8',
  ))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(schema, 'response')
  const validate = ajv.getSchema('response#/$defs/reachSolution')
  assert.ok(validate, 'reachSolution $def not found in the response schema')

  // The control: the SAME validator accepts what core/ actually sends. Without
  // this half, a validator that rejects everything would also look green.
  const solved = { kind: 'solved', joints: [0, -1, 1, -1.5, -1.5708, 0] }
  assert.equal(validate(solved), true, JSON.stringify(validate.errors, null, 2))
  assert.equal(validate({ kind: 'undeclared' }), true)

  const approximation = approximateJointsFor(CHAIN, handAt([0.4, -1.1, 1.3, -1.2, -1.5, 0.2]))
  assert.ok(approximation)
  assert.equal(validate(approximation), false, 'the wire accepted a client approximation')
  // And it is not a near-miss that a tolerant validator might let through: there
  // is no `kind` at all, which is what makes the two shapes unconfusable.
  assert.equal('kind' in approximation, false)
})

// ── 4. no solver lives here: the module's whole vocabulary is FK + units ─────

test('この module が引く計算は FK 測定器と単位変換だけ — 解法を持ち込んだら落ちる', () => {
  const source = readFileSync(join(HERE, 'ApproximateReachPreview.js'), 'utf8')
  const imports = [...source.matchAll(/^import .*? from '([^']+)'/gm)].map(m => m[1])
  // 母集団は「この module が import している先」ではなく **許されている先** の
  // 列挙 (原則 #31): 許可表に無い import が 1 つでもあれば個数が合わずに落ちる。
  const ALLOWED = ['./Kinematics.js', '../domain/worldUnits.js']
  assert.deepEqual(imports.filter(i => !ALLOWED.includes(i)), [],
    'src/ は解法を持たない — 新しい依存は core/ 側の責務かどうかを先に問うこと')
})

// ── 5. determinism, and the joint that cannot move the hand ─────────────────

test('同じ入力には同じ腕 — 乱数を含まない', () => {
  const target = handAt([-1.9, -0.6, 0.9, -1.9, 1.4, 0.0])
  const a = approximateJointsFor(CHAIN, target)
  const b = approximateJointsFor(CHAIN, target)
  assert.deepEqual(a, b)
})

test('手を動かせない関節は探索空間から外れ、0 のまま残る (UR の wrist_3)', () => {
  const influential = positionInfluentialJoints(CHAIN)
  const names = movableJoints(CHAIN).map(j => j.name)
  assert.deepEqual(
    names.filter((_, i) => !influential[i]),
    ['wrist_3_joint'],
    'フランジ軸まわりの回転は手の位置を変えない — 測って決める (書き写さない)',
  )
  const found = approximateJointsFor(CHAIN, handAt([0.4, -1.1, 1.3, -1.2, -1.5, 0.9]))
  assert.equal(found.joints[names.indexOf('wrist_3_joint')], 0)
})

test('巻き上がった等価解は巻き戻して返す — 同じ手の位置、読める腕 (ADR-144 D4)', () => {
  // 関節限界が ±2π なので、格子は手首が 6.1 rad 回った配置を拾いうる。それは
  // −0.2 rad と**同じ物理回転**で手の位置も同じだが、画面では「誰も言っていない
  // 主張」に見える。返す前に書き直すのは探索ではなく **表記の正規化** なので、
  // ここで問うのは 2 つ: 巻きが消えていること、そして手が 1 ミクロンも動いて
  // いないこと (動くなら正規化ではなく別解にすり替わっている)。
  for (const q of [[0.4, -1.1, 1.3, -1.2, -1.5, 0.2], [-1.9, -0.6, 0.9, -1.9, 1.4, 0], [0.8, -1.5, 1.4, -0.4, -1.0, 0.5]]) {
    const target = handAt(q)
    const found = approximateJointsFor(CHAIN, target)
    assert.ok(found)
    const wound = found.joints.filter(v => Math.abs(v) > Math.PI + 1e-9)
    assert.deepEqual(wound, [], `巻き上がった関節が残っている: ${JSON.stringify(found.joints)}`)
    // errorMm は巻き戻し前に測った値。実測と一致することが、書き直しが FK を
    // 変えていない証拠になる (一致しなければ「同じ腕」ではなかった)。
    assert.ok(Math.abs(mmBetween(handAt(found.joints), target) - found.errorMm) < 1e-6)
  }
})

test('探索予算は宣言された定数であって、その場の数字ではない', () => {
  assert.equal(APPROXIMATE_PREVIEW.TOLERANCE_MM, 10)
  assert.equal(APPROXIMATE_PREVIEW.COARSE_SAMPLES, 4)   // even, on purpose (±2π)
})

// ── 6. the frame conversion the controller depends on ───────────────────────

test('toBaseFrame は世界座標を台座の frame へ移す — 単位は変えない', () => {
  // Base 1 m forward, yawed 90° (+Z quarter turn). A world point 1 m further
  // forward is, in the base's frame, 1 m to the base's own −Y (its +X now points
  // along world +Y).
  const h = Math.SQRT1_2
  const local = toBaseFrame([2, 0, 0], [1, 0, 0], [0, 0, h, h])
  assert.ok(Math.abs(local.x - 0) < 1e-9)
  assert.ok(Math.abs(local.y + 1) < 1e-9)
  assert.ok(Math.abs(local.z - 0) < 1e-9)

  // No orientation declared ⇒ translation only (never an invented rotation).
  assert.deepEqual(toBaseFrame([2, 3, 4], [1, 1, 1], null), { x: 1, y: 2, z: 3 })
})
