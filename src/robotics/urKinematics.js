/**
 * urKinematics — UR 系 6 軸アームの**閉形式**順/逆運動学 (純粋・THREE 非依存)。
 *
 * ## これは第二の源ではなく「導出」である (ADR-146 D3 / ADR-147)
 *
 * ADR-144 はこの移植を **§1.1 (同じ計算の源が 2 つに割れる)** で却下した。
 * ADR-146 はその判定を 3 軸へ置き換え、**公知の閉形式は `src/` に置いてよい —
 * ただし共有フィクスチャの準拠テストを同じ PR で置くこと**とした。§1.1 が禁じて
 * いるのは*複製*ではなく**源が 2 つになること**で、源が 1 つであり続けることを
 * 機械が問うなら二つ目は源ではなく導出である (BFF が JSON Schema から型を導出し
 * `pnpm test:contract` が焼くのと同じ形)。
 *
 * その機械が `fixtures/cross-language/ur5e-inverse-kinematics.json` と
 * `src/robotics/CrossLanguageDerivation.test.js` である。**数を生むのは Python 側**
 * (`core/` が権威) で、この実装はそれを再現できるかを問われる立場に置く。
 *
 * ## これが何であって、何でないか
 *
 * - **これは解である。** `core/` の `UniversalRobotsIkSolver` と同じ Hawkins (2013) /
 *   ros-industrial `ur_kinematics` の閉形式で、軸 2/3/4 が平行という構造から位置 3
 *   自由度と姿勢 3 自由度を代数的に分離し、**最大 8 解** (肩の左右 × 肘の上下 ×
 *   手首の反転 = 2³) を得る。数値反復が無いので**収束失敗という状態が存在しない**。
 * - **これは権威ではない。** 候補がその姿勢で実際に掴めるか (干渉・可視性・把持性・
 *   スコア) は `core/` だけが決める。ここが答えるのは運動学だけであり、画面に出す
 *   ときは検証されていない姿勢として描く。
 * - **アイデアは入っていない** (ADR-146 D1)。コスト関数も重みもランキングも無い。
 *   唯一の選択規則 (代表解 = 関節総移動量最小) は ADR-127 D5 が公開している
 *   決定的な同点処理で、競争上の知ではなく**再現性のための規約**である。
 *
 * ## DH 規約 (standard / distal)
 *
 *     T_i = Rz(θ_i) · Tz(d_i) · Tx(a_i) · Rx(α_i)
 *
 * α は [π/2, 0, 0, π/2, −π/2, 0] で固定 — これが「UR である」ことの定義であり、
 * 機種差は 6 つの長さ (d1, a2, a3, d4, d5, d6) だけに閉じる。
 *
 * @module robotics/urKinematics
 */

/** UR の α 列。可変ではなく**構造**なので定数 (機種差はここに出ない)。 */
const ALPHA = [Math.PI / 2, 0, 0, Math.PI / 2, -Math.PI / 2, 0]

const EPS = 1e-12
/** 手首特異点 (sin θ5 ≈ 0) の判定閾値。ここでは θ6 が定まらないので 0 を宣言的に選ぶ。 */
const WRIST_SINGULAR = 1e-7
/** `_basis_from_z` と同じ参照選択の閾値 — gauge を共有するため同値にする。 */
const PARALLEL = 0.9

/**
 * クライアントが解いた結果の判別子 — **意図的に `kind` ではない** (ADR-144 D2 の
 * 型分離をそのまま引き継ぐ)。契約の `reachSolution` は `kind` を判別子に使うので、
 * 別の鍵・別の形にしておけば、近似結果を誤ってワイヤの検証器へ渡しても構造的に
 * 通らない。名前が `clientApproximate` から変わったのは、値が粗いのではなく
 * **誰も検証していない**というのが本当の限界だから (ADR-147)。
 */
export const CLIENT_ANALYTIC = 'clientAnalytic'

/** UR 系アームを決める 6 つの長さ。符号込み (UR の a2/a3 は負)。 */
export const DH_KEYS = Object.freeze(['d1', 'a2', 'a3', 'd4', 'd5', 'd6'])

/** 6 軸。7 軸は「長い腕」ではなく別の腕であり、閉形式が存在しない。 */
export const UR_JOINT_COUNT = 6

export class MalformedKinematics extends Error {}

function dList(dh) { return [dh.d1, 0, 0, dh.d4, dh.d5, dh.d6] }
function aList(dh) { return [0, dh.a2, dh.a3, 0, 0, 0] }

/** standard DH の 1 リンク分の同次変換 (row-major 16 要素, 純粋)。 */
export function dhTransform(theta, d, a, alpha) {
  const ct = Math.cos(theta), st = Math.sin(theta)
  const ca = Math.cos(alpha), sa = Math.sin(alpha)
  return [
    ct, -st * ca, st * sa, a * ct,
    st, ct * ca, -ct * sa, a * st,
    0, sa, ca, d,
    0, 0, 0, 1,
  ]
}

/** 4x4 の積 (row-major)。 */
export function matMultiply(m, n) {
  const out = new Array(16).fill(0)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += m[r * 4 + k] * n[k * 4 + c]
      out[r * 4 + c] = s
    }
  }
  return out
}

/** 剛体変換の逆 (回転は転置、並進は −Rᵀp)。一般の逆行列は使わない (数値的に安定)。 */
export function matInverseRigid(m) {
  const [r00, r01, r02, px, r10, r11, r12, py, r20, r21, r22, pz] = m
  return [
    r00, r10, r20, -(r00 * px + r10 * py + r20 * pz),
    r01, r11, r21, -(r01 * px + r11 * py + r21 * pz),
    r02, r12, r22, -(r02 * px + r12 * py + r22 * pz),
    0, 0, 0, 1,
  ]
}

const IDENTITY4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/**
 * 関節角 6 つ → **累積積の各段** = ベース原点と各関節原点の同次変換 7 個 (純粋)。
 *
 * 隣り合う 2 段の並進を結べばリンク 1 本の線分近似になる。`core/` の
 * `forward_kinematics_chain` と同じ量で、干渉判定が腕の実ジオメトリを見る入口
 * (ADR-145) がこれ。
 */
export function forwardKinematicsChain(dh, joints) {
  if (!Array.isArray(joints) || joints.length !== UR_JOINT_COUNT) {
    throw new MalformedKinematics(
      `UR は 6 軸: 関節値が ${joints?.length} 個ある`,
    )
  }
  const d = dList(dh), a = aList(dh)
  let t = IDENTITY4.slice()
  const chain = [t]
  for (let i = 0; i < UR_JOINT_COUNT; i++) {
    t = matMultiply(t, dhTransform(joints[i], d[i], a[i], ALPHA[i]))
    chain.push(t)
  }
  return chain
}

/**
 * 関節角 6 つ → ベースからフランジまでの同次変換 (純粋)。
 *
 * 逆解の**正しさの物差し**。多対一なので `IK(FK(q)) == q` は成り立たないが
 * `FK(IK(T)) == T` は全解について成り立つ — 原則 #28 の商・正規形の形。
 * `forwardKinematicsChain` の最終要素を返す薄いラッパ (計算の源は 1 つ)。
 */
export function forwardKinematics(dh, joints) {
  return forwardKinematicsChain(dh, joints)[UR_JOINT_COUNT]
}

const clampUnit = x => Math.max(-1, Math.min(1, x))

/**
 * 角を (−π, π] へ畳む。
 *
 * 2π 回っただけの解を別解として数えないため。UR は手首が回りきるので、畳まないと
 * 「同じ姿勢」が無限に並ぶ。
 */
export function wrapAngle(angle) {
  let a = (angle + Math.PI) % (2 * Math.PI)
  if (a <= 0) a += 2 * Math.PI
  return a - Math.PI
}

/**
 * 目標フランジ姿勢 → 到達する関節角の**全解** (最大 8 個、純粋)。
 *
 * 届かない姿勢では**空配列**。**空は「解が無い」であって「解けなかった」ではない** —
 * 反復解法と違い、この層に収束失敗という状態は存在しない。
 *
 * 解の順序は決定的 (肩 → 手首 → 肘 の入れ子順)。同じ入力に同じ順序で返すことが、
 * 上位が代表解を選ぶときの再現性の前提になる。
 *
 * @param {{d1:number,a2:number,a3:number,d4:number,d5:number,d6:number}} dh
 * @param {number[]} target  ベース座標系のフランジ目標 (row-major 4x4)
 * @returns {number[][]} 最大 8 本の関節ベクトル
 */
export function inverseKinematics(dh, target) {
  const { d1, a2, a3, d4, d5, d6 } = dh
  const [nx, ox, ax, px, ny, oy, ay, py, nz, oz, az, pz] = target
  const solutions = []

  // ── θ1: 関節 5 の原点を base の XY へ落として肩の左右を出す ──────────────
  const p05x = px - d6 * ax
  const p05y = py - d6 * ay
  const rXy = Math.hypot(p05x, p05y)
  if (rXy < Math.abs(d4) - 1e-9) return []   // 肩のオフセットより内側 — 届かない
  const psi = Math.atan2(p05y, p05x)
  const phi = rXy > EPS ? Math.acos(clampUnit(d4 / rXy)) : 0

  for (const theta1 of [psi + phi + Math.PI / 2, psi - phi + Math.PI / 2]) {
    const s1 = Math.sin(theta1), c1 = Math.cos(theta1)

    // ── θ5: 手首の反転 (2 通り) ────────────────────────────────────────────
    if (Math.abs(d6) < EPS) continue
    const c5 = (px * s1 - py * c1 - d4) / d6
    if (Math.abs(c5) > 1 + 1e-9) continue
    const a5 = Math.acos(clampUnit(c5))

    for (const theta5 of [a5, -a5]) {
      const s5 = Math.sin(theta5)

      // ── θ6: 手首特異点では定まらないので 0 を宣言的に選ぶ ───────────────
      const theta6 = Math.abs(s5) < WRIST_SINGULAR
        ? 0
        : Math.atan2((oy * c1 - ox * s1) / s5, (nx * s1 - ny * c1) / s5)

      // ── 平面 2 リンク問題へ落とす (T14 を作る) ──────────────────────────
      const t01 = dhTransform(theta1, d1, 0, ALPHA[0])
      const t45 = dhTransform(theta5, d5, 0, ALPHA[4])
      const t56 = dhTransform(theta6, d6, 0, ALPHA[5])
      const t14 = matMultiply(
        matInverseRigid(t01),
        matMultiply(target, matInverseRigid(matMultiply(t45, t56))),
      )
      // 関節 3 の原点を frame1 で見る (frame4 の y 軸へ d4 ぶん戻す)。
      // **平面は frame1 の x-y** — α1 = π/2 が z1 を関節 2 の軸に向けるので、
      // リンク 2/3 は x-y 内で動く (p13z は恒等的に 0)。x-z で解くと肘の角が
      // わずかにずれ、しかも「それらしい」値が出るので気づきにくい。
      const p13x = t14[3] - d4 * t14[1]
      const p13y = t14[7] - d4 * t14[5]
      const len13sq = p13x * p13x + p13y * p13y
      const len13 = Math.sqrt(len13sq)

      // ── θ3: 余弦定理 (肘の上下 2 通り) ──────────────────────────────────
      const denom = 2 * a2 * a3
      if (Math.abs(denom) < EPS) continue
      const c3 = (len13sq - a2 * a2 - a3 * a3) / denom
      if (Math.abs(c3) > 1 + 1e-9) continue   // 伸びきり/畳みきりの外
      const a3ang = Math.acos(clampUnit(c3))

      for (const theta3 of [a3ang, -a3ang]) {
        if (len13 < EPS) continue
        // θ2: 肩から手首までの向き − 肘が作るオフセット角 (平面 2 リンクの標準形)。
        const theta2 = Math.atan2(p13y, p13x)
          - Math.atan2(a3 * Math.sin(theta3), a2 + a3 * Math.cos(theta3))
        // θ4: 残りの回転 = T34 の向きから読む。
        const t12 = dhTransform(theta2, 0, a2, ALPHA[1])
        const t23 = dhTransform(theta3, 0, a3, ALPHA[2])
        const t34 = matMultiply(matInverseRigid(matMultiply(t12, t23)), t14)
        const theta4 = Math.atan2(t34[4], t34[0])
        solutions.push(
          [theta1, theta2, theta3, theta4, theta5, theta6].map(wrapAngle),
        )
      }
    }
  }
  return solutions
}

/**
 * 関節値が宣言された限界の内側か。
 *
 * **`limits` が null なら true を返すが、それは「限界が無い」ではなく「限界が
 * 宣言されていないので検査していない」である** (原則 #31)。ここで既定の限界
 * (±2π など) を発明しない。
 */
export function withinJointLimits(joints, limits) {
  if (limits == null) return true
  if (limits.length !== joints.length) {
    throw new MalformedKinematics(
      `関節限界は ${joints.length} 対で宣言する: ${limits.length} 対が渡された`,
    )
  }
  return joints.every((q, i) => q >= limits[i].min && q <= limits[i].max)
}

/**
 * 全解の中から**代表 1 つ**を決定的に選ぶ (ADR-127 D5 と同じ規則)。
 *
 * 基準は「関節の総移動量が最小」= 原点姿勢に最も近い解。順序ではなく**量**で選ぶのは、
 * 入力が少し変わったときに代表解が飛ばないようにするため (同点は
 * `inverseKinematics` の決定的な順序が破る)。
 *
 * **`core/` と同じ規則でなければならない** — 違う代表を選ぶと、画面の腕と探索が
 * 解いた腕が「どちらも正しい解」でありながら別物になる (ADR-141 の再演)。
 * 一致は共有フィクスチャが焼く。
 *
 * @returns {number[]|null} 許容される解が無ければ null (捏造しない)
 */
export function representativeSolution(solutions, limits = null) {
  const admissible = (solutions ?? []).filter(q => withinJointLimits(q, limits))
  if (admissible.length === 0) return null
  let best = null, bestKey = null
  for (const q of admissible) {
    const travel = q.reduce((s, v) => s + Math.abs(v), 0)
    // Python の `min(..., key=lambda q: (sum(abs(v)), q))` と同じ同点処理:
    // 総移動量 → 関節ベクトルの辞書順。
    if (bestKey === null || travel < bestKey.travel - 1e-15
        || (Math.abs(travel - bestKey.travel) <= 1e-15 && lexLess(q, best))) {
      best = q
      bestKey = { travel }
    }
  }
  return best
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true
    if (a[i] > b[i]) return false
  }
  return false
}

/**
 * ワイヤの `robot.kinematics` 宣言 → DH。宣言が無ければ null。
 *
 * **宣言が壊れているときは null ではなく throw** する: 「運動学を宣言したのに
 * 素朴判定へ落ちた」は、宣言した側から見て嘘だからである (原則 #11 — 無言の格下げ
 * をしない)。`core/` の `ik_solver_from_declaration` と同じ規律。
 */
export const KINEMATICS_KIND_UNIVERSAL_ROBOTS = 'universalRobots'

export function dhFromDeclaration(kinematics) {
  if (kinematics == null) return null
  if (kinematics.kind !== KINEMATICS_KIND_UNIVERSAL_ROBOTS) {
    throw new MalformedKinematics(
      `未宣言の運動学種別 ${JSON.stringify(kinematics.kind)}: ` +
      `${KINEMATICS_KIND_UNIVERSAL_ROBOTS} であること (ADR-127)`,
    )
  }
  const raw = kinematics.dh ?? {}
  const missing = DH_KEYS.filter(k => !Number.isFinite(raw[k]))
  if (missing.length > 0) {
    throw new MalformedKinematics(
      `UR の運動学には 6 つの長さすべてが要る。欠けている: ${missing.join(', ')} ` +
      '(既定値で埋めない — 別機種の寸法で解いた解は「解けた」と見分けがつかない)',
    )
  }
  return Object.fromEntries(DH_KEYS.map(k => [k, Number(raw[k])]))
}
