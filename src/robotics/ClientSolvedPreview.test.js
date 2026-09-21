/**
 * ADR-144 D2 の**型分離**と、ADR-147 が置いた新しい純粋性の境界を焼く。
 *
 * ADR-147 は ADR-144 の D1 (サンプリング探索) を置き換えたが、**D2 は不変**である:
 * クライアントが出す結果は契約の `reachSolution` と**別の鍵・別の形**でなければ
 * ならない。ADR-144 の証拠はその探索モジュールと一緒に消えたので、ここで引き取る
 * — *決定が生きているのに証拠だけ消える*のが、退役の腐敗の最も静かな形である
 * (ADR-103: 腐った退役は違反を見逃すのではなく**緑を出す**)。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CLIENT_ANALYTIC, inverseKinematics, representativeSolution } from './urKinematics.js'
import { flangeTarget } from './graspPoseGauge.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const DH = JSON.parse(readFileSync(
  join(ROOT, 'fixtures', 'cross-language', 'ur5e-forward-kinematics.json'), 'utf8',
)).dh

/** クライアントが実際に返す形 (GraspController._clientSolvedArmPose と同じ組み立て)。 */
function clientResult() {
  const target = flangeTarget({ position: [0.4, 0, 0.2], approach: [0, 0, -1], roll: 0 })
  const branches = inverseKinematics(DH, target)
  const joints = representativeSolution(branches, null)
  assert.ok(joints, '前提: この姿勢は解ける')
  return { origin: CLIENT_ANALYTIC, joints, branches: branches.length }
}

test('クライアントの結果は reachSolution スキーマに対して invalid — 型で権威を分ける (ADR-144 D2)', async () => {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js')
  const schema = JSON.parse(readFileSync(
    join(ROOT, 'packages', 'grasp-contract', 'schema', 'grasp-search-response.schema.json'), 'utf8',
  ))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(schema, 'response')
  const validate = ajv.getSchema('response#/$defs/reachSolution')
  assert.ok(validate, 'reachSolution $def not found in the response schema')

  // 対照: **同じ** validator が core/ の送る形を通すこと。この半分が無いと、
  // 全部拒否する壊れた validator でも緑になる (負の対照だけでは何も示さない)。
  assert.equal(validate({ kind: 'solved', joints: [0, -1, 1, -1.5, -1.5708, 0] }), true,
    JSON.stringify(validate.errors, null, 2))
  assert.equal(validate({ kind: 'undeclared' }), true)

  const client = clientResult()
  assert.equal(validate(client), false, 'ワイヤがクライアントの解を受け入れてしまった')
  // 寛容な validator が取りこぼす「惜しい違い」ではない: `kind` が**そもそも無い**。
  // それが 2 つの形を取り違えられなくしている当のものである。
  assert.equal('kind' in client, false)
  assert.equal(client.origin, 'clientAnalytic')
})

test('閉形式の 2 module は**何も import しない** — 導出であって配線ではない (ADR-147)', () => {
  // ADR-144 は「解法を持ち込んだら落ちる」を import の許可表で焼いていた。その制約は
  // ADR-147 が解いた (閉形式は置いてよくなった) が、**別の境界がその場所に来た**:
  // これらは `core/` の写しであり、写しに配線が混ざると準拠フィクスチャが守っている
  // 「同じ計算である」が静かに崩れる。母集団は import 先ではなく**許されている先の
  // 列挙**で、表に無い import が 1 つでもあれば落ちる (原則 #31)。
  const ALLOWED_IMPORTS = { 'urKinematics.js': [], 'graspPoseGauge.js': [] }
  for (const [file, allowed] of Object.entries(ALLOWED_IMPORTS)) {
    const source = readFileSync(join(HERE, file), 'utf8')
    const imports = [...source.matchAll(/^import .*? from '([^']+)'/gm)].map(m => m[1])
    assert.deepEqual(imports, allowed, `${file} が許可表に無いものを import している`)
  }
})

test('8 解が実際に返る — 当事者が条件にした数を焼く (ADR-147)', () => {
  // 「8 解出るならいいよ」が承認の条件だった。代表解しか画面に出さないので、
  // 8 という数は**返り値の中にしか痕跡が無い** — だから数えて焼く。
  const result = clientResult()
  assert.equal(result.branches, 8)
  assert.equal(result.joints.length, 6)
})
