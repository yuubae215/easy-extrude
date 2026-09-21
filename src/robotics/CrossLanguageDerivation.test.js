/**
 * ADR-146 D3/D5: 「複製してよいが**導出として**」が主張のままにならないための問い所。
 *
 * ADR-144 が UR 解析解の JS 移植を却下した理由は §1.1 (同じ計算の源が 2 つに割れる)
 * だった。ADR-146 はその禁止を「公知の閉形式は置いてよい、ただし導出として」へ
 * 置き換えたが、**置き換えた瞬間に §1.1 を守る仕事が人の注意へ移る**。移したままに
 * しないための機械がこれである (原則 #19 Q3 — 答えが『誰も開かない散文』なら、
 * 成果物は文書の行ではなくチェック)。
 *
 * ここが問うのは 2 つ:
 *   1. 宣言された各複製に**共有フィクスチャが実在する**こと。
 *   2. **両言語の消費者がそれを実際に読んでいる**こと (ファイルパスを本文に持つ)。
 *      片側だけが読む数は対照にならない — それは回帰テストであって、
 *      「2 つの実装が一致している」を一度も言わない。
 *
 * そして数自身の一致は、JS 側については下の `ur5e-forward-kinematics` の節が、
 * Python 側については `core/tests/test_ur_kinematics.py` が、**同じファイルの同じ数**
 * に対して主張する。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { parseUrdfChain } from './UrdfChain.js'
import { forwardKinematics, movableJoints } from './Kinematics.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

/**
 * 宣言された言語をまたぐ複製の登録簿 (ADR-146 D3)。
 *
 * **母集団は人が維持する。** 「同じ計算が 2 言語に在る」はコードの構文から導出でき
 * ない (grep できる形を持たない) ので、この表が捕まえるのは*宣言された行の腐り*で
 * あって**宣言されなかった複製**ではない。
 *
 * 母集団を構文から導出する方法は **未実装** = DEF-039 (ADR-092 §4 / ADR-115 の
 * 「塞げない穴は数える」)。**登録簿を分母にしない** — それをすると ADR-102 が語彙から
 * 消した `place-list` そのものになる。行を足すとき、その穴も一緒に思い出すこと。
 */
const CROSS_LANGUAGE_DERIVATIONS = [
  {
    subject: 'ur5e-forward-kinematics',
    fixture: 'fixtures/cross-language/ur5e-forward-kinematics.json',
    source: 'public/robot/skeleton_arm.urdf',
    consumers: [
      'src/robotics/CrossLanguageDerivation.test.js',
      'core/tests/test_ur_kinematics.py',
    ],
  },
]

/** 宣言された複製の個数。増減は意図的な行為であること (ratchet — ADR-100 の形)。 */
const DECLARED_DERIVATION_COUNT = 1

describe('cross-language derivations (ADR-146 D3)', () => {
  test('宣言された複製の個数が予算どおり', () => {
    // 超えても下回っても落とす。下回りを許すと「消したのか、書き忘れたのか」が
    // 区別できなくなり、個数は再び記憶の中の数になる (ADR-103)。
    assert.equal(CROSS_LANGUAGE_DERIVATIONS.length, DECLARED_DERIVATION_COUNT)
  })

  for (const d of CROSS_LANGUAGE_DERIVATIONS) {
    test(`${d.subject}: フィクスチャと源が実在する`, () => {
      assert.ok(fs.existsSync(path.join(ROOT, d.fixture)), `${d.fixture} が無い`)
      assert.ok(fs.existsSync(path.join(ROOT, d.source)), `${d.source} が無い`)
    })

    test(`${d.subject}: 両言語の消費者が**同じファイルを読んでいる**`, () => {
      // 「読む機械が在る」と「読むと宣言した」は別の事実 (ADR-115)。後者だけを
      // 数えると、消費者を消した日にこの表は緑のまま嘘になる。
      assert.equal(d.consumers.length, 2, '片側だけでは一致を主張できない')
      for (const consumer of d.consumers) {
        assert.ok(fs.existsSync(path.join(ROOT, consumer)), `${consumer} が無い`)
        assert.match(
          read(consumer),
          new RegExp(d.fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${consumer} が ${d.fixture} を参照していない`,
        )
      }
    })
  }
})

describe('ur5e-forward-kinematics: JS 側がフィクスチャの数を再現する', () => {
  const fixture = JSON.parse(
    read('fixtures/cross-language/ur5e-forward-kinematics.json'),
  )
  const chain = parseUrdfChain(read(fixture.source))

  test('関節の順序がフィクスチャの宣言と一致する', () => {
    // 順序がずれた腕も *腕* として描けるので、画面を見ても気づけない (ADR-135 D3
    // が `ROBOT_JOINT_ORDER` を導出にした理由と同じ)。数より先にここを問う。
    assert.deepEqual(
      movableJoints(chain).map(j => j.name),
      fixture.jointOrder,
    )
  })

  test(`${fixture.cases.length} 配置すべてで TCP 位置が一致する`, () => {
    for (const { joints, tcp } of fixture.cases) {
      const { position } = forwardKinematics(chain, joints)
      for (const [i, axis] of ['x', 'y', 'z'].entries()) {
        assert.ok(
          Math.abs(position[axis] - tcp[i]) <= fixture.tolerance,
          `q=${JSON.stringify(joints)} の ${axis}: ` +
            `${position[axis]} vs ${tcp[i]}`,
        )
      }
    }
  })

  test('フィクスチャは退化していない (全配置が同じ点ではない)', () => {
    // 全部 0 を並べただけのフィクスチャでも上の 2 つは緑になる。**数が実際に
    // 散らばっていること**を問わないと、生成器が壊れた日に検査ごと無力化する。
    const xs = new Set(fixture.cases.map(c => c.tcp[0].toFixed(6)))
    assert.ok(xs.size >= fixture.cases.length - 1, '配置が実質的に重複している')
    assert.ok(fixture.cases.length >= 12, '配置が少なすぎる')
  })
})
