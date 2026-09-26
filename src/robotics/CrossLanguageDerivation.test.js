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
import {
  forwardKinematics as urForwardKinematics,
  inverseKinematics,
  representativeSolution,
} from './urKinematics.js'
import { flangeTarget, poseFromFrame } from './graspPoseGauge.js'
import { toolParts } from '../domain/robotTool.js'
import { mToMM } from '../domain/worldUnits.js'

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
    // 源は**画面に出る腕**。ずれたときに直すべきは DH の導出のほうである。
    source: 'public/robot/skeleton_arm.urdf',
    consumers: [
      'src/robotics/CrossLanguageDerivation.test.js',
      'core/tests/test_ur_kinematics.py',
    ],
  },
  {
    subject: 'ur5e-inverse-kinematics',
    fixture: 'fixtures/cross-language/ur5e-inverse-kinematics.json',
    // 源は**探索が解く側**。逆運動学の権威は core/ で、JS はそれを再現する立場。
    // FK と源の向きが逆なのは、それぞれの*源*が違う側に住んでいるからである。
    source: 'core/easy_extrude_core/engine/ur_kinematics.py',
    consumers: [
      'src/robotics/CrossLanguageDerivation.test.js',
      'core/tests/test_ur_kinematics.py',
    ],
  },
  {
    subject: 'ur5e-candidate-to-flange',
    fixture: 'fixtures/cross-language/ur5e-candidate-to-flange.json',
    // 源は**規約を宣言している側**。FRAME_CONVENTION も FLANGE_Z_IS_APPROACH も
    // 導出できない取り決めなので、写しが写しであり続けるかだけを問う。
    source: 'core/easy_extrude_core/engine/pose_codec.py',
    consumers: [
      'src/robotics/CrossLanguageDerivation.test.js',
      'core/tests/test_ur_kinematics.py',
    ],
  },
  {
    subject: 'hand-parts-in-flange',
    fixture: 'fixtures/cross-language/hand-parts-in-flange.json',
    // 源は**判定する側** (ADR-152 D3/D5)。描く手 (`toolParts`) が判定する手の写しで
    // あり続けるかを問う — ずれると「見えている爪が判定されている爪」が黙って崩れる。
    source: 'core/easy_extrude_core/engine/pipeline.py',
    consumers: [
      'src/robotics/CrossLanguageDerivation.test.js',
      'core/tests/test_grasp_specs.py',
    ],
  },
]

/** 宣言された複製の個数。増減は意図的な行為であること (ratchet — ADR-100 の形)。 */
const DECLARED_DERIVATION_COUNT = 4

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


describe('ur5e-inverse-kinematics: JS 側が core/ の 8 解をそのまま再現する', () => {
  const fixture = JSON.parse(
    read('fixtures/cross-language/ur5e-inverse-kinematics.json'),
  )
  const dh = fixture.dh
  const tol = fixture.tolerance

  /**
   * 手首特異点 (sin θ5 ≈ 0) の判定閾値と、そこに落ちる姿勢の**個数の予算**。
   *
   * 特異点では θ6 が定まらない — 実装は 0 を宣言的に選ぶが、その選択は θ1..θ4 の
   * 端数を通じて別の関節へ吸収される。つまり**関節ベクトルは一意でない**ので、
   * 2 つの実装がビット単位で一致する道理がない。実測 (24 姿勢): 特異でない 23 件は
   * 関節値が 1.4e-10 以内、特異な 1 件だけが 3.0e-8 ずれ、しかし**姿勢は 2.2e-15**。
   *
   * ここで許容差を一律に緩めると、特異でないところで起きた本物のずれまで通って
   * しまう。だから緩めるのではなく**特異な姿勢を名指しして数える** — 予算を超えても
   * 下回っても落ちるので、フィクスチャが静かに特異点だらけになることもない。
   */
  const WRIST_SINGULAR = 1e-7
  const SINGULAR_CASE_BUDGET = 1

  const isSingular = solutions =>
    solutions.some(q => Math.abs(Math.sin(q[4])) < WRIST_SINGULAR)

  test('特異な姿勢の個数が予算どおり (緩めるのではなく数える)', () => {
    const singular = fixture.cases.filter(c => isSingular(c.solutions)).length
    assert.equal(singular, SINGULAR_CASE_BUDGET)
  })

  test(`${fixture.cases.length} 姿勢すべてで**解の個数と順序**が一致する`, () => {
    // 個数だけでなく**順序**を問う。順序は契約の一部で、代表解の再現性がそこに
    // 乗っている — 並べ替えて比べると、順序が違う実装でも緑になってしまう。
    for (const { target, solutions } of fixture.cases) {
      const got = inverseKinematics(dh, target)
      assert.equal(got.length, solutions.length, '解の個数')
      if (isSingular(solutions)) continue   // 関節値は一意でない (上の注釈)
      for (const [i, want] of solutions.entries()) {
        for (const [j, w] of want.entries()) {
          assert.ok(Math.abs(got[i][j] - w) <= tol,
            `解 ${i} の関節 ${j}: ${got[i][j]} vs ${w}`)
        }
      }
    }
  })

  test('**姿勢**は特異点でも一致する — 一致を主張すべき量はこちら', () => {
    // 関節値を飛ばした特異な姿勢について、何も主張しないまま終わらせない。
    // 関節ベクトルが一意でなくても、**その解が実現するフランジ姿勢**は一意であり、
    // 2 つの実装はそこで一致していなければならない。実測の最大差は 1.1e-12。
    let worst = 0
    let checkedSingular = 0
    for (const { target, solutions } of fixture.cases) {
      const got = inverseKinematics(dh, target)
      if (isSingular(solutions)) checkedSingular += 1
      for (const [i, want] of solutions.entries()) {
        const fromJs = urForwardKinematics(dh, got[i])
        const fromPy = urForwardKinematics(dh, want)
        for (let k = 0; k < 16; k++) {
          worst = Math.max(worst, Math.abs(fromJs[k] - fromPy[k]))
        }
      }
    }
    assert.equal(checkedSingular, SINGULAR_CASE_BUDGET,
      '特異な姿勢がこの検査を素通りしていないこと')
    assert.ok(worst <= 1e-9, `姿勢の最大差 ${worst}`)
  })

  test('8 解が出る姿勢が実際に含まれている (フィクスチャが退化していない)', () => {
    // 「最大 8 解」を主張するのに 1 解しか出ない姿勢ばかりのフィクスチャでは、
    // 分岐を 1 本しか通らない実装でも緑になる。分岐の網羅を数で宣言しておく。
    const counts = fixture.cases.map(c => c.solutions.length)
    assert.ok(counts.includes(8), '8 解の姿勢が 1 つも無い')
    assert.ok(Math.min(...counts) >= 2, '解が 1 本以下の姿勢は分岐を問えない')
  })

  test('全解を FK に通すと元の目標姿勢に戻る (FK∘IK = 恒等)', () => {
    // 原則 #28: 多対一なので `IK(FK(q)) == q` は求めない。求めてよい同一性は
    // **商の上の fixpoint** で、それが `FK(IK(T)) == T`。フィクスチャとの一致は
    // 「Python と同じ間違いをしている」でも緑になるので、こちらを別に問う。
    for (const { target } of fixture.cases) {
      for (const q of inverseKinematics(dh, target)) {
        const back = urForwardKinematics(dh, q)
        for (let i = 0; i < 16; i++) {
          assert.ok(Math.abs(back[i] - target[i]) <= 1e-9,
            `FK(IK(T)) が T に戻らない: 要素 ${i}`)
        }
      }
    }
  })

  test('代表解の選び方が core/ と一致する (関節総移動量最小)', () => {
    // 違う代表を選ぶと、画面の腕と探索が解いた腕が**どちらも正しい解**でありながら
    // 別物になる (ADR-141 の再演)。値ではなく「フィクスチャの解集合から同じ 1 本を
    // 選ぶか」を問うので、解集合が変わっても規則の一致だけが残る。
    for (const { solutions } of fixture.cases) {
      if (solutions.length === 0) continue
      const chosen = representativeSolution(solutions)
      const travels = solutions.map(q => q.reduce((s, v) => s + Math.abs(v), 0))
      const best = Math.min(...travels)
      const chosenTravel = chosen.reduce((s, v) => s + Math.abs(v), 0)
      assert.ok(Math.abs(chosenTravel - best) <= 1e-12,
        `総移動量 ${chosenTravel} が最小 ${best} でない`)
    }
  })

  test('届かない姿勢は空配列 — 「解けなかった」ではなく「解が無い」', () => {
    // 閉形式に収束失敗という状態は存在しない。空を null や例外と混ぜない。
    const far = [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    assert.deepEqual(inverseKinematics(dh, far), [])
    assert.equal(representativeSolution([]), null)
  })

  test('宣言された関節限界の外の解は代表になれない (限界の不在は検査の不在)', () => {
    const { solutions } = fixture.cases.find(c => c.solutions.length >= 4)
    // 限界なし = 検査していない → 何かが選ばれる。
    assert.ok(representativeSolution(solutions, null) !== null)
    // すべてを弾く限界 → null (「一番近いもの」へ倒さない)。
    const impossible = Array.from({ length: 6 }, () => ({ min: 10, max: 11 }))
    assert.equal(representativeSolution(solutions, impossible), null)
  })
})


describe('ur5e-candidate-to-flange: 2 つの gauge が core/ の写しであり続ける', () => {
  const fixture = JSON.parse(
    read('fixtures/cross-language/ur5e-candidate-to-flange.json'),
  )
  const tol = fixture.tolerance

  test(`${fixture.cases.length} 姿勢すべてでフランジ目標が一致する`, () => {
    let worst = 0
    for (const { posePayload, toolLength, flangeTarget: want } of fixture.cases) {
      const got = flangeTarget(poseFromFrame(posePayload.frame), toolLength)
      assert.ok(got, 'フランジ目標が作れない')
      for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]))
    }
    assert.ok(worst <= tol, `最大差 ${worst}`)
  })

  test('toolLength が全ケースで明示され、0 と非 0 の両方を通る (ADR-150 D4)', () => {
    // 欠けたキーを 0 と読むと「0 を宣言した」と「書き忘れた」が区別できない。
    // 0 だけでは toolLength を無視する写しでも緑になる (原則 #31)。
    assert.ok(fixture.cases.every(c => typeof c.toolLength === 'number'), 'toolLength の無いケースがある')
    assert.ok(fixture.cases.some(c => c.toolLength === 0))
    assert.ok(fixture.cases.some(c => c.toolLength > 0))
  })

  test('toolLength を無視した写しは**一致しない** (負の対照)', () => {
    const withTool = fixture.cases.filter(c => c.toolLength > 0)
    const ignored = withTool.filter(({ posePayload, flangeTarget: want }) => {
      const got = flangeTarget(poseFromFrame(posePayload.frame))
      return [3, 7, 11].every(i => Math.abs(got[i] - want[i]) <= tol)
    })
    assert.equal(ignored.length, 0)
  })

  test('gauge の**両方の分岐**がフィクスチャに含まれている', () => {
    // 基準軸の選び方は候補 frame の z 成分の大きさで切り替わる (|z| < 0.9 か否か)。
    // 片側だけのフィクスチャでは分岐が 1 本しか通らず、もう一方を取り違えた実装でも
    // 緑になる — だから「通っていること」を数で宣言する。
    const zs = fixture.cases.map(c => Math.abs(c.posePayload.frame.orientation[2] * 0 + zAxisOf(c)))
    assert.ok(zs.some(z => z >= 0.9), '|z| >= 0.9 の姿勢が無い')
    assert.ok(zs.some(z => z < 0.9), '|z| < 0.9 の姿勢が無い')
  })

  test('フランジ = 候補 frame を x 軸まわりに 180° 回した**固定の取付け** (ADR-150 D5)', () => {
    // ツールは剛体なので、閉じ軸 (候補 frame の x) はフランジに対して動かない。
    // すなわち x はそのまま、y と z が反転し、原点は TCP から approach の逆向きに
    // toolLength だけ戻る。ADR-147 はこの近道が「一致しない」ことを焼いていたが、
    // それは張り直しの欠陥 (閉じ軸が roll の 2 倍で回る) を観察していた。
    let worst = 0
    for (const { posePayload, toolLength, flangeTarget: want } of fixture.cases) {
      const [cx, cy, cz] = quaternionColumnsOf(posePayload.frame.orientation)
      const t = posePayload.frame.position
      const mounted = [
        cx[0], -cy[0], -cz[0], t[0] + cz[0] * toolLength,
        cx[1], -cy[1], -cz[1], t[1] + cz[1] * toolLength,
        cx[2], -cy[2], -cz[2], t[2] + cz[2] * toolLength,
        0, 0, 0, 1,
      ]
      for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(mounted[i] - want[i]))
    }
    assert.ok(worst < 1e-9, `固定の取付けから最大 ${worst} ずれている`)
  })

  function zAxisOf(c) {
    const cols = quaternionColumnsOf(c.posePayload.frame.orientation)
    return cols[2][2]
  }
  function quaternionColumnsOf(q) {
    const [x, y, z, w] = q
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
      [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
      [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
    ]
  }
})

describe('hand-parts-in-flange: 描く手 (toolParts) が判定する手 (core/) を再現する (ADR-152)', () => {
  const fixture = JSON.parse(read('fixtures/cross-language/hand-parts-in-flange.json'))
  /** ワイヤの gripper (m) → フロントの hand (mm)。角度は変換しない。 */
  const handOfWire = (g) => {
    const mm = (v) => mToMM(v)
    const body = g.body.kind === 'cylinder'
      ? { kind: 'cylinder', radius: mm(g.body.radius), length: mm(g.body.length) }
      : { kind: 'box', size: g.body.size.map(mm) }
    return g.kind === 'parallelJaw'
      ? { kind: g.kind, maxOpening: mm(g.maxOpening), body,
          fingers: { length: mm(g.fingers.length), thickness: mm(g.fingers.thickness), width: mm(g.fingers.width) } }
      : { kind: g.kind, cupDiameter: mm(g.cupDiameter), body, cupHeight: mm(g.cupHeight) }
  }
  for (const [i, c] of fixture.cases.entries()) {
    test(`case ${i} (${c.gripper.kind}, ${c.gripper.body.kind}): 部品の名前・中心・半寸法が一致する`, () => {
      // toolLength は棒 (形なし) にしか効かないので、爪先の値を渡しておく。
      const parts = toolParts(handOfWire(c.gripper), 0.15)
      assert.deepEqual(parts.map(p => p.part), c.parts.map(p => p.name))
      // 1 mm = 1e-3 m の往復で生じる丸め (mm → m) を許す。数の形は同じ閉形式。
      const tol = 1e-12 + 1e-15 * 1000
      for (const [j, p] of parts.entries()) {
        const half = p.shape === 'cylinder' ? [p.size[0], p.size[0], p.size[1] / 2] : p.size.map(v => v / 2)
        for (let k = 0; k < 3; k++) {
          assert.ok(Math.abs(p.center[k] - c.parts[j].center[k]) <= tol, `${p.part} center[${k}]: ${p.center[k]} vs ${c.parts[j].center[k]}`)
          assert.ok(Math.abs(half[k] - c.parts[j].half[k]) <= tol, `${p.part} half[${k}]: ${half[k]} vs ${c.parts[j].half[k]}`)
        }
      }
    })
  }
})
