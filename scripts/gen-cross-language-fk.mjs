/**
 * ADR-146 D3: URDF から導出した FK 準拠フィクスチャの再生成。
 *
 * フィクスチャは**生成物**であって手書きしない (§1.1)。源は 1 つ =
 * `public/robot/skeleton_arm.urdf`。ここが生む数を両言語のテストが読み、
 * 「同じ腕について同じ答えを出す」ことを問う。
 *
 * 数を生むのは JS 側 (URDF をそのまま解く側) で、Python 側は URDF から**導出された**
 * DH でそれを再現できるかを問われる立場に置く。逆向きにしないのは、画面に出る腕が
 * URDF そのものだから — ずれたときに直すべきは導出のほうである。
 *
 *     node scripts/gen-cross-language-fk.mjs
 */
import fs from 'node:fs'
import { parseUrdfChain } from '../src/robotics/UrdfChain.js'
import { forwardKinematics, movableJoints } from '../src/robotics/Kinematics.js'
import { kinematicsDeclarationFromUrdf } from '../src/domain/robotKinematics.js'

const URDF_PATH = 'public/robot/skeleton_arm.urdf'
const OUT_PATH = 'fixtures/cross-language/ur5e-forward-kinematics.json'

const urdf = fs.readFileSync(URDF_PATH, 'utf8')
const chain = parseUrdfChain(urdf)
const declaration = kinematicsDeclarationFromUrdf(urdf)
if (!declaration) throw new Error(`${URDF_PATH} が UR 形状でない — DH を導出できない`)

// 決定的な配置。乱数器をフィクスチャの中に持ち込まないため、生成時に畳んで数で残す。
let seed = 146
const nextAngle = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return (seed / 2147483648) * 2 * Math.PI - Math.PI
}
const configurations = [
  [0, 0, 0, 0, 0, 0],
  [Math.PI / 2, 0, 0, 0, 0, 0],
  [0, -Math.PI / 2, 0, 0, 0, 0],
]
for (let i = 0; i < 21; i++) {
  configurations.push(Array.from({ length: 6 }, nextAngle))
}

const round = v => Number(v.toFixed(12))
fs.writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      $comment:
        'ADR-146 D3 の導出準拠フィクスチャ。両言語がこの同じ数を読む。生成物であって手書きしない — 再生成は scripts/gen-cross-language-fk.mjs。',
      subject: 'ur5e-forward-kinematics',
      source: URDF_PATH,
      dh: declaration.dh,
      jointOrder: movableJoints(chain).map(j => j.name),
      tolerance: 1e-9,
      cases: configurations.map(q => ({
        joints: q.map(round),
        tcp: (({ x, y, z }) => [round(x), round(y), round(z)])(
          forwardKinematics(chain, q).position,
        ),
      })),
    },
    null,
    2,
  ) + '\n',
)
console.log(`${OUT_PATH}: ${configurations.length} 配置`)
