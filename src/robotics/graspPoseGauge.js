/**
 * graspPoseGauge — ワイヤの候補 frame と**フランジ目標姿勢**をつなぐ 2 つの gauge
 * (ADR-147 / ADR-146 D3 の導出)。
 *
 * ## なぜこれが要るのか
 *
 * 契約に載る `pose.frame.orientation` と、IK が解く**フランジの目標姿勢**は
 * **同じ向きではない**。どちらも (approach, roll) から決定的に作られるが、基準の
 * 取り方 (gauge) が違う:
 *
 * | | +Z 軸 | 出どころ |
 * |---|---|---|
 * | 候補 frame (ワイヤ) | **−approach** | `core/engine/pose_codec.py` の FRAME_CONVENTION |
 * | フランジ目標 (IK の入力) | **+approach** | `core/engine/ur_solver.py` の `FLANGE_Z_IS_APPROACH` |
 *
 * **フランジ = 候補 frame を自身の x 軸まわりに 180° 回したもの** (x はそのまま、
 * y と z が反転) — ツールがフランジに剛体で付いている、という事実の式である
 * (ADR-150 D5)。候補 frame の x は平行ジョーの閉じ軸 (`core/` の把持ゲートが幅を
 * 測る軸) なので、それがフランジに対して動かないことが「固定されている」の意味。
 *
 * ADR-147 はここを「180° 回すだけでは一致しない」と書いていた。当時はフランジの x を
 * `basisFromZ(+approach)` から**張り直して**いたので、それは正しい観察だった — ただし
 * 観察されていたのは**張り直しの欠陥**で、閉じ軸はフランジ座標で roll の 2 倍で回って
 * いた (手首 θ6 と判定したジョーの向きが一致しない)。
 *
 * ## これは導出であって第二の源ではない
 *
 * 規約そのものは `core/` が宣言しており、ここはその写しである。写しが写しであり
 * 続けることを問うのが `fixtures/cross-language/ur5e-candidate-to-flange.json` と
 * `src/robotics/CrossLanguageDerivation.test.js` (ADR-146 D3)。**数を生むのは
 * `core/` 側** — 規約を宣言しているのはあちらだから。
 *
 * @module robotics/graspPoseGauge
 */

/** `core/` の `_PARALLEL` と同値。gauge を共有するため別の値にしない。 */
const PARALLEL = 0.9
const EPS = 1e-12

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]

function normalized(v) {
  const n = Math.hypot(v[0], v[1], v[2])
  return n < EPS ? [0, 0, 0] : scale(v, 1 / n)
}

/**
 * z から**決定論的に**基準 x/y を張る (`pose_codec._basis_from_z` と同じ規則)。
 *
 * 同じ規則を使うのは roll の起点を 2 つ持たないため。ここが食い違うと、契約に出る
 * 四元数と IK が解いた姿勢が roll だけずれるが、**どちらも「もっともらしい」ので
 * 画面では気づけない**。
 */
export function basisFromZ(z) {
  const ref = Math.abs(z[2]) < PARALLEL ? [0, 0, 1] : [1, 0, 0]
  const bx = normalized(cross(ref, z))
  const by = cross(z, bx)
  return [bx, by]
}

/** 四元数 [x,y,z,w] → 回転行列の 3 列 (world 軸)。 */
export function quaternionColumns(q) {
  const [x, y, z, w] = q
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ]
}

/**
 * ワイヤの `pose.frame` → ドメインの (position, approach, roll)。
 *
 * `core/` の `pose_from_payload` と同じ復元 — approach は frame の **−Z**、roll は
 * 同じ gauge で張り直した基準 x 軸との角度。
 *
 * @param {{position:number[], orientation:number[]}} frame
 * @returns {{position:number[], approach:number[], roll:number}}
 */
export function poseFromFrame(frame) {
  const [xAxis, , zAxis] = quaternionColumns(frame.orientation)
  const approach = scale(zAxis, -1)
  const [bx, by] = basisFromZ(zAxis)
  return {
    position: [...frame.position],
    approach,
    roll: Math.atan2(dot(xAxis, by), dot(xAxis, bx)),
  }
}

/**
 * (position, approach, roll) → **フランジの目標同次変換** (row-major 4x4)。
 *
 * `core/` の `ur_solver.flange_target` と同じ: フランジの +Z が approach と同じ向き
 * (UR の `tool0` が +Z をツール方向に取る慣例)、+X は**候補 frame の +X そのもの**
 * (= 閉じ軸)。フランジ = 候補 frame を自身の x 軸まわりに 180° 回した固定の取付け。
 *
 * 退化 (approach がゼロ長) は **null** — 目標が定義できないことを「解が無い」と
 * 混ぜない。
 *
 * **pose.position は TCP (ツール先端)** で、フランジはそこから approach の逆向きに
 * `toolLength` だけ戻る (ADR-150 D4 — `core/` の `flange_target` と同じ)。0 は
 * 「フランジ = TCP」で、ADR-150 以前の答えそのもの。
 *
 * @param {{position:number[], approach:number[], roll:number}} pose
 * @param {number} [toolLength=0]  フランジ (tool0) → TCP の長さ (フランジ +Z 方向)
 * @returns {number[]|null}
 */
export function flangeTarget(pose, toolLength = 0) {
  if (!(toolLength >= 0) || !Number.isFinite(toolLength)) {
    throw new Error(`toolLength は 0 以上の有限数 (受け取った: ${toolLength})`)
  }
  const z = normalized(pose.approach)
  if (Math.hypot(z[0], z[1], z[2]) < EPS) return null
  // x = 候補 frame の x (平行ジョーの閉じ軸)。候補 frame は +Z = −approach から張る
  // ので basisFromZ(−z) を roll だけ回したもの — `core/` の `frame_axes` と同じ。
  // ツールは剛体なので閉じ軸はフランジに固定される (ADR-150 D5)。
  const [bx, by] = basisFromZ(scale(z, -1))
  const c = Math.cos(pose.roll), s = Math.sin(pose.roll)
  const x = [bx[0] * c + by[0] * s, bx[1] * c + by[1] * s, bx[2] * c + by[2] * s]
  const y = cross(z, x)
  const tcp = pose.position
  const p = [tcp[0] - z[0] * toolLength, tcp[1] - z[1] * toolLength, tcp[2] - z[2] * toolLength]
  return [
    x[0], y[0], z[0], p[0],
    x[1], y[1], z[1], p[1],
    x[2], y[2], z[2], p[2],
    0, 0, 0, 1,
  ]
}

/**
 * ワイヤの frame を**ロボットのベース座標系**へ戻したフランジ目標 (row-major 4x4)。
 *
 * `core/` の `UniversalRobotsIkSolver.solve` と同じ手順: ワールドのフランジ目標を
 * 作ってから、据付並進を引き、据付姿勢 (ADR-129 D2) の**逆回転**で戻す。
 * 宣言が無ければ恒等 — **「直立」ではなく「述べていない」**だが、向き無しでは
 * 解けない以上そう解くしかなく、その仮定を画面に出すのは表示側の責務。
 *
 * **座標はワイヤと同じ配列形で受ける** (`[x,y,z]` / `[x,y,z,w]`)。`{x,y,z}` の
 * オブジェクト形と取り違えると各成分が `undefined` になり、行列は NaN で埋まる —
 * NaN は比較でどの枝にも入らないので、**解が 0 本という正しい形の答え**になって
 * 現れる (実際、実装中にこれを踏んだ)。形が違う入力は計算せず throw する。
 *
 * @param {{position:number[], orientation:number[]}} frame  ワイヤの候補 frame
 * @param {number[]} base                        ベース位置 [x,y,z] (world)
 * @param {number[]|null} baseOrientation        据付姿勢 [x,y,z,w]、未宣言なら null
 * @param {number} [toolLength=0]                フランジ → TCP の長さ (ADR-150 D4)
 * @returns {number[]|null}
 */
export function flangeTargetInBaseFrame(frame, base, baseOrientation = null, toolLength = 0) {
  if (!Array.isArray(base) || base.length !== 3 || !base.every(Number.isFinite)) {
    throw new Error(
      `base は有限数 3 つの配列で渡す (受け取った: ${JSON.stringify(base)}) — ` +
      'オブジェクト形と取り違えると行列が NaN で埋まり、解が 0 本という正しい形の嘘になる',
    )
  }
  const world = flangeTarget(poseFromFrame(frame), toolLength)
  if (!world) return null
  const m = world.slice()
  m[3] -= base[0]
  m[7] -= base[1]
  m[11] -= base[2]
  if (baseOrientation == null) return m
  if (!Array.isArray(baseOrientation) || baseOrientation.length !== 4
      || !baseOrientation.every(Number.isFinite)) {
    throw new Error(
      `baseOrientation は有限数 4 つの配列で渡す (受け取った: ${JSON.stringify(baseOrientation)})`,
    )
  }
  const n = Math.hypot(...baseOrientation)
  if (n < 1e-9) {
    // 壊れた四元数は恒等へ落とさない: 無言の格下げは「宣言したのに無視された」で、
    // 答えは正しい形をしたまま間違う (core/ の `_unrotate_into_base` と同じ規律)。
    throw new Error('baseOrientation が退化している (ノルム 0) — 恒等へ落とさず拒否する')
  }
  const inv = [-baseOrientation[0] / n, -baseOrientation[1] / n, -baseOrientation[2] / n, baseOrientation[3] / n]
  const rot = v => {
    const [qx, qy, qz, qw] = inv
    const t = [2 * (qy * v[2] - qz * v[1]), 2 * (qz * v[0] - qx * v[2]), 2 * (qx * v[1] - qy * v[0])]
    return [
      v[0] + qw * t[0] + (qy * t[2] - qz * t[1]),
      v[1] + qw * t[1] + (qz * t[0] - qx * t[2]),
      v[2] + qw * t[2] + (qx * t[1] - qy * t[0]),
    ]
  }
  const c0 = rot([m[0], m[4], m[8]])
  const c1 = rot([m[1], m[5], m[9]])
  const c2 = rot([m[2], m[6], m[10]])
  const t = rot([m[3], m[7], m[11]])
  return [
    c0[0], c1[0], c2[0], t[0],
    c0[1], c1[1], c2[1], t[1],
    c0[2], c1[2], c2[2], t[2],
    0, 0, 0, 1,
  ]
}
