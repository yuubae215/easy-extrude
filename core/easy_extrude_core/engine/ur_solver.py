"""UR 系アームの解析解を `IkSolver` として注入する層 (ADR-127)。

`ur_kinematics` は同次変換行列しか知らない純粋な数学で、こちらが**この探索エンジンの
語彙との対応づけ**を持つ:

1. 候補 `Pose(position, approach, roll)` -> フランジの目標姿勢 (同次変換)
2. 解の集合 (最大 8) -> 宣言された関節限界での絞り込み
3. 残った解の**代表 1 つ**を決定的に選ぶ

## フランジ frame の規約 (declared, not derived)

**フランジの +Z が approach と同じ向き**、+X は `pose_codec` と同じ決定的な基準軸を
roll だけ回したもの。UR の `tool0` が +Z をツール方向に取る慣例に合わせている。

これは*導出できない*規約である — `pose_codec` の候補 frame は「+Z = −approach」という
別の gauge を使っており (契約に出る四元数はそちら)、両者は 180° 違う。どちらが
「正しい」かはワイヤの外の取り決めなので、ここでは**宣言し、名前を付け、検査で焼く**。
`FLANGE_Z_IS_APPROACH` がその宣言で、規約を変えるならこの定数の意味ごと変える。

## 関節限界

宣言が無ければ**検査しない**。既定の限界 (±2π など) を発明すると、「限界を宣言して
いない」と「限界が広い」が同じ挙動に潰れる (原則 #31)。限界の不在は
`within_joint_limits` が True を返すことで表れるが、その意味は「無い」ではなく
「問うていない」である。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from .types import GraspCandidate, Robot, Vec3
from .feasibility import IkSolution
from .ur_kinematics import (
    UrDhParameters,
    forward_kinematics,
    inverse_kinematics,
    within_joint_limits,
)

# 規約の宣言 (上の docstring 参照)。True = フランジ +Z は approach と同じ向き。
# 候補 frame (pose_codec) の +Z は −approach なので、両者は 180° 異なる。
FLANGE_Z_IS_APPROACH = True

_EPS = 1e-12
# `pose_codec._basis_from_z` と同じ参照選択の閾値 — gauge を共有するため同値にする。
_PARALLEL = 0.9


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )


def _basis_from_z(z: Vec3) -> "tuple[Vec3, Vec3]":
    """z から決定論的に基準 x/y を張る (`pose_codec._basis_from_z` と同じ規則)。

    同じ規則を使うのは roll の起点を 2 つ持たないため。ここが食い違うと、契約に出る
    四元数と IK が解いた姿勢が roll だけずれるが、**どちらも「もっともらしい」ので
    画面では気づけない**。
    """
    ref = Vec3(0.0, 0.0, 1.0) if abs(z.z) < _PARALLEL else Vec3(1.0, 0.0, 0.0)
    bx = _cross(ref, z).normalized()
    by = _cross(z, bx)
    return bx, by


def flange_target(candidate: GraspCandidate) -> "tuple[float, ...] | None":
    """候補の (position, approach, roll) をフランジの目標同次変換へ写す (純粋)。

    退化 (approach がゼロ長) は None — 目標が定義できないことを解の不在と混ぜない。
    """
    approach = candidate.pose.approach
    if approach.norm() < _EPS:
        return None
    z = approach.normalized()
    bx, by = _basis_from_z(z)
    roll = candidate.pose.roll
    c, s = math.cos(roll), math.sin(roll)
    # roll は z 軸まわり。x = bx cos + by sin、y = z × x (右手系)。
    x = Vec3(bx.x * c + by.x * s, bx.y * c + by.y * s, bx.z * c + by.z * s)
    y = _cross(z, x)
    p = candidate.pose.position
    return (
        x.x, y.x, z.x, p.x,
        x.y, y.y, z.y, p.y,
        x.z, y.z, z.z, p.z,
        0.0, 0.0, 0.0, 1.0,
    )


@dataclass(frozen=True)
class UniversalRobotsIkSolver:
    """UR 系の解析解 IK を `IkSolver` Protocol として供給する。

    `NaiveIkSolver` を置き換えるのではなく、**宣言されたときだけ**使われる
    (ADR-084 §3 と同じ規律 — 宣言した瞬間にだけ挙動が変わる)。宣言が無ければ
    パイプラインは従来の素朴判定のままで、無言で答えが変わることはない。
    """

    dh: UrDhParameters
    joint_limits: "tuple[tuple[float, float], ...] | None" = None
    # 目標姿勢と解の一致を確かめる許容差。解析解なので機械精度で一致するが、
    # 退化姿勢での取りこぼしを検査するために閾値を持つ (信じずに確かめる)。
    tolerance: float = 1e-6

    def solve(
        self, candidate: GraspCandidate, robot: Robot
    ) -> Optional[IkSolution]:
        """解が在れば代表解を返す。無ければ None。

        `robot.base` はワールド上のベース位置なので、目標をベース座標へ移してから解く
        (この運動学はベース原点系で定義されている)。**向きは扱わない** — ベースの
        姿勢は契約に無く、無いものを既定で埋めない (原則 #31)。ベースが回転して据え
        付けられる要件が出たら契約に足す判断が要る。
        """
        target = flange_target(candidate)
        if target is None:
            return None
        base = robot.base
        # ベース並進ぶんだけ目標を戻す (回転は契約に無いので恒等)。
        local = list(target)
        local[3] -= base.x
        local[7] -= base.y
        local[11] -= base.z
        solutions = inverse_kinematics(self.dh, tuple(local))
        if not solutions:
            return None

        admissible = [q for q in solutions if within_joint_limits(q, self.joint_limits)]
        if not admissible:
            return None

        # 代表解: 解析解は最大 8 個あるが段階0 が問うのは「解けるか」だけなので、
        # **決定的に 1 つ**選ぶ。基準は「関節の総移動量が最小」= 原点姿勢に最も近い解。
        # 順序ではなく量で選ぶのは、探索の入力が少し変わったときに代表解が飛ばない
        # ようにするため (同点は `inverse_kinematics` の決定的な順序が破る)。
        best = min(admissible, key=lambda q: (sum(abs(v) for v in q), q))
        return IkSolution(joints=tuple(best))

    def flange_pose_of(self, joints: "tuple[float, ...]") -> "tuple[float, ...]":
        """解の検算用 FK (ベース座標系)。テストと診断のための逆向き。"""
        return forward_kinematics(self.dh, joints)


# 契約 `robot.kinematics.kind` の値域。未宣言の kind は既定へ倒さず throw する
# (ADR-118 の `_CHECKER_BY_KIND` と同じ規律 — 宣言された既定と誰も考えなかった種を
# 区別できなくする fall-through を作らない)。
KINEMATICS_KIND_UNIVERSAL_ROBOTS = "universalRobots"

_DH_KEYS = ("d1", "a2", "a3", "d4", "d5", "d6")


def ik_solver_from_declaration(declaration_data: dict) -> "UniversalRobotsIkSolver | None":
    """`graspSearch` の wire dict から解析解ソルバを組む。宣言が無ければ None。

    None は「素朴判定のまま」を意味する — 宣言した瞬間にだけ挙動が変わる
    (ADR-084 §3 と同じ規律)。**宣言が壊れているときは None ではなく throw** する:
    「運動学を宣言したのに素朴判定に落ちた」は、宣言した側から見て嘘だからである
    (無言の格下げをしない — 原則 #11)。
    """
    robot_raw = declaration_data.get("robot") or {}
    raw = robot_raw.get("kinematics")
    if raw is None:
        return None

    kind = raw.get("kind")
    if kind != KINEMATICS_KIND_UNIVERSAL_ROBOTS:
        raise ValueError(
            f"未宣言の運動学種別 {kind!r}: robot.kinematics.kind は "
            f"{KINEMATICS_KIND_UNIVERSAL_ROBOTS!r} であること (ADR-127)"
        )

    dh_raw = raw.get("dh") or {}
    missing = [k for k in _DH_KEYS if dh_raw.get(k) is None]
    if missing:
        raise ValueError(
            f"UR の運動学には 6 つの長さすべてが要る。欠けている: {missing} "
            "(既定値で埋めない — 別機種の寸法で解いた解は「解けた」と見分けがつかない)"
        )
    dh = UrDhParameters(**{k: float(dh_raw[k]) for k in _DH_KEYS})

    limits_raw = raw.get("jointLimits")
    limits = None
    if limits_raw is not None:
        if len(limits_raw) != 6:
            raise ValueError(
                f"関節限界は 6 対で宣言する ({len(limits_raw)} 対が宣言された)"
            )
        limits = tuple(
            (float(pair["min"]), float(pair["max"])) for pair in limits_raw
        )
    return UniversalRobotsIkSolver(dh=dh, joint_limits=limits)
