"""Universal Robots 系 6 軸アームの順運動学と**解析解**逆運動学 (純粋・副作用なし)。

`NaiveIkSolver` は「リーチ球殻に入り、手首コーンの角度以内なら可解」という代理判定で、
**関節限界も特異点も肘の姿勢も見ていない**。それでも `ikSolvable: true` は契約上
「ソルバが決定した事実」として載っている (原則 #29) — 契約中で最も弱い主張だった。

UR 系は閉形式の逆解が知られている (Hawkins 2013 / ros-industrial `ur_kinematics`)。
軸 2/3/4 が平行という構造から、位置 3 自由度と姿勢 3 自由度が代数的に分離でき、
**最大 8 解**が得られる (肩の左右 x 肘の上下 x 手首の反転 = 2^3)。数値反復が要らないので
決定的で、収束失敗という状態が存在しない。

## この層が持たないもの

- **候補 frame との対応づけは持たない。** `Pose(position, approach, roll)` を
  フランジの目標姿勢へ写すのは `UniversalRobotsIkSolver` の仕事で、ここは
  同次変換行列だけを受け取る。gauge の話を運動学に混ぜない。
- **関節限界を既定で持たない。** 未宣言なら「限界を検査していない」であって
  「限界が無い」ではない (原則 #31)。判定は呼び出し側が宣言された限界で行う。

## DH 規約 (standard / distal)

    T_i = Rz(θ_i) · Tz(d_i) · Tx(a_i) · Rx(α_i)

UR の α は [π/2, 0, 0, π/2, −π/2, 0] で固定 (これが「UR である」ことの定義)。
可変なのは 6 つの長さ (d1, a2, a3, d4, d5, d6) だけなので、機種差はその 6 数に閉じる。
UR5e の公表値は d1=0.1625 / a2=−0.425 / a3=−0.3922 / d4=0.1333 / d5=0.0997 / d6=0.0996。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# 4x4 同次変換行列 (row-major, 16 要素)。専用クラスを起こさないのは、この層の外へ
# 出ないため (外へ出るのは関節値だけ)。
Mat4 = tuple[float, ...]

_EPS = 1e-12
# 手首特異点 (sin θ5 ≈ 0) の判定閾値。ここでは θ6 が定まらないので 0 を宣言的に選ぶ。
_WRIST_SINGULAR = 1e-7

# UR の α 列。これが構造 (軸 2/3/4 が平行、手首が直交) を定義する。
_ALPHA = (math.pi / 2, 0.0, 0.0, math.pi / 2, -math.pi / 2, 0.0)


@dataclass(frozen=True)
class UrDhParameters:
    """UR 系アームを決める 6 つの長さ。α は構造なので持たない (上の `_ALPHA`)。

    符号込みで公表値をそのまま入れる (UR の a2/a3 は負)。単位はリクエストの長さ単位に
    従う — 契約は単位を名指ししないので、ここでも名指ししない。
    """

    d1: float
    a2: float
    a3: float
    d4: float
    d5: float
    d6: float

    @property
    def d(self) -> tuple[float, ...]:
        return (self.d1, 0.0, 0.0, self.d4, self.d5, self.d6)

    @property
    def a(self) -> tuple[float, ...]:
        return (0.0, self.a2, self.a3, 0.0, 0.0, 0.0)


def dh_transform(theta: float, d: float, a: float, alpha: float) -> Mat4:
    """standard DH の 1 リンク分の同次変換 (純粋)。"""
    ct, st = math.cos(theta), math.sin(theta)
    ca, sa = math.cos(alpha), math.sin(alpha)
    return (
        ct, -st * ca, st * sa, a * ct,
        st, ct * ca, -ct * sa, a * st,
        0.0, sa, ca, d,
        0.0, 0.0, 0.0, 1.0,
    )


def mat_multiply(m: Mat4, n: Mat4) -> Mat4:
    """4x4 の積 (row-major)。"""
    out = [0.0] * 16
    for r in range(4):
        for c in range(4):
            out[r * 4 + c] = sum(m[r * 4 + k] * n[k * 4 + c] for k in range(4))
    return tuple(out)


def mat_inverse_rigid(m: Mat4) -> Mat4:
    """剛体変換の逆 (回転は転置、並進は −Rᵀp)。一般の逆行列は使わない (数値的に安定)。"""
    r00, r01, r02, px = m[0], m[1], m[2], m[3]
    r10, r11, r12, py = m[4], m[5], m[6], m[7]
    r20, r21, r22, pz = m[8], m[9], m[10], m[11]
    return (
        r00, r10, r20, -(r00 * px + r10 * py + r20 * pz),
        r01, r11, r21, -(r01 * px + r11 * py + r21 * pz),
        r02, r12, r22, -(r02 * px + r12 * py + r22 * pz),
        0.0, 0.0, 0.0, 1.0,
    )


def forward_kinematics(dh: UrDhParameters, joints: "tuple[float, ...]") -> Mat4:
    """関節角 6 つ -> ベースからフランジまでの同次変換 (純粋)。

    逆解の**正しさの物差し**でもある: IK が返した解を FK に通せば元の目標姿勢に戻る。
    多対一の写像なので `IK(FK(q)) == q` は成り立たない (解は最大 8 個) が、
    `FK(IK(T)) == T` は全解について成り立つ — 原則 #28 の商・正規形の形。
    """
    if len(joints) != 6:
        raise ValueError(f"UR は 6 軸: 関節値が {len(joints)} 個ある")
    t = (
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    )
    d, a = dh.d, dh.a
    for i in range(6):
        t = mat_multiply(t, dh_transform(joints[i], d[i], a[i], _ALPHA[i]))
    return t


def _clamp_unit(x: float) -> float:
    return max(-1.0, min(1.0, x))


def inverse_kinematics(
    dh: UrDhParameters, target: Mat4
) -> "tuple[tuple[float, ...], ...]":
    """目標フランジ姿勢 -> 到達する関節角の**全解** (最大 8 個、純粋)。

    届かない姿勢では空タプルを返す。**空は「解が無い」であって「解けなかった」では
    ない** — 反復解法と違い、この層に収束失敗という状態は存在しない。

    解の順序は決定的 (肩 -> 手首 -> 肘 の入れ子順)。同じ入力に同じ順序で返すことは、
    上位が「代表解」を選ぶときの再現性の前提になる。
    """
    d1, a2, a3, d4, d5, d6 = dh.d1, dh.a2, dh.a3, dh.d4, dh.d5, dh.d6
    nx, ox, ax, px = target[0], target[1], target[2], target[3]
    ny, oy, ay, py = target[4], target[5], target[6], target[7]
    nz, oz, az, pz = target[8], target[9], target[10], target[11]

    solutions: list[tuple[float, ...]] = []

    # ── θ1: 関節 5 の原点を base の XY へ落として肩の左右を出す ──────────────
    p05x = px - d6 * ax
    p05y = py - d6 * ay
    r_xy = math.hypot(p05x, p05y)
    if r_xy < abs(d4) - 1e-9:
        return ()  # 肩のオフセット d4 より内側 — どう回しても届かない
    psi = math.atan2(p05y, p05x)
    phi = math.acos(_clamp_unit(d4 / r_xy)) if r_xy > _EPS else 0.0

    for theta1 in (psi + phi + math.pi / 2, psi - phi + math.pi / 2):
        s1, c1 = math.sin(theta1), math.cos(theta1)

        # ── θ5: 手首の反転 (2 通り) ──────────────────────────────────────
        if abs(d6) < _EPS:
            continue
        c5 = (px * s1 - py * c1 - d4) / d6
        if abs(c5) > 1.0 + 1e-9:
            continue
        a5 = math.acos(_clamp_unit(c5))

        for theta5 in (a5, -a5):
            s5 = math.sin(theta5)

            # ── θ6: 手首特異点では定まらないので 0 を宣言的に選ぶ ─────────
            if abs(s5) < _WRIST_SINGULAR:
                theta6 = 0.0
            else:
                theta6 = math.atan2(
                    (oy * c1 - ox * s1) / s5,
                    (nx * s1 - ny * c1) / s5,
                )

            # ── 平面 2 リンク問題へ落とす (T14 を作る) ────────────────────
            t01 = dh_transform(theta1, d1, 0.0, _ALPHA[0])
            t45 = dh_transform(theta5, d5, 0.0, _ALPHA[4])
            t56 = dh_transform(theta6, d6, 0.0, _ALPHA[5])
            t14 = mat_multiply(
                mat_inverse_rigid(t01),
                mat_multiply(target, mat_inverse_rigid(mat_multiply(t45, t56))),
            )
            # 関節 3 の原点を frame1 で見る (frame4 の y 軸へ d4 ぶん戻す)。
            # **平面は frame1 の x-y** — α1 = π/2 が z1 を関節 2 の軸に向けるので、
            # リンク 2/3 は x-y 内で動く (p13z は恒等的に 0)。x-z で解くと肘の角が
            # わずかにずれ、しかも「それらしい」値が出るので気づきにくい。
            p13x = t14[3] - d4 * t14[1]
            p13y = t14[7] - d4 * t14[5]
            len13sq = p13x * p13x + p13y * p13y
            len13 = math.sqrt(len13sq)

            # ── θ3: 余弦定理 (肘の上下 2 通り) ────────────────────────────
            denom = 2.0 * a2 * a3
            if abs(denom) < _EPS:
                continue
            c3 = (len13sq - a2 * a2 - a3 * a3) / denom
            if abs(c3) > 1.0 + 1e-9:
                continue  # 伸びきり/畳みきりの外 — この分岐に解は無い
            a3ang = math.acos(_clamp_unit(c3))

            for theta3 in (a3ang, -a3ang):
                if len13 < _EPS:
                    continue
                # θ2: 肩から手首までの向き − 肘が作るオフセット角 (平面 2 リンクの標準形)。
                theta2 = math.atan2(p13y, p13x) - math.atan2(
                    a3 * math.sin(theta3), a2 + a3 * math.cos(theta3)
                )
                # θ4: 残りの回転 = T34 の向きから読む。
                t12 = dh_transform(theta2, 0.0, a2, _ALPHA[1])
                t23 = dh_transform(theta3, 0.0, a3, _ALPHA[2])
                t34 = mat_multiply(
                    mat_inverse_rigid(mat_multiply(t12, t23)), t14
                )
                theta4 = math.atan2(t34[4], t34[0])
                solutions.append(
                    tuple(_wrap(v) for v in (theta1, theta2, theta3, theta4, theta5, theta6))
                )

    return tuple(solutions)


def _wrap(angle: float) -> float:
    """角を (−π, π] へ畳む。

    2π 回っただけの解を別解として数えないため。UR は手首が回りきるので、畳まないと
    「同じ姿勢」が無限に並ぶ (`ur_kinematics` が解を [−π, π] に制限するのと同じ理由)。
    """
    a = math.fmod(angle + math.pi, 2.0 * math.pi)
    if a <= 0.0:
        a += 2.0 * math.pi
    return a - math.pi


def within_joint_limits(
    joints: "tuple[float, ...]", limits: "tuple[tuple[float, float], ...] | None"
) -> bool:
    """関節値が宣言された限界の内側か。

    **`limits` が None なら True を返すが、それは「限界が無い」ではなく「限界が
    宣言されていないので検査していない」である** (原則 #31)。呼び出し側はその区別を
    自分の言葉で表す責任を持つ — ここで既定の限界 (±2π など) を発明しない。
    """
    if limits is None:
        return True
    if len(limits) != len(joints):
        raise ValueError(
            f"関節限界は 6 対で宣言する: {len(limits)} 対に対し関節が {len(joints)} 個"
        )
    return all(lo <= q <= hi for q, (lo, hi) in zip(joints, limits))
