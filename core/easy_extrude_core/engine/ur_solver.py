"""UR 系アームの解析解を `IkSolver` として注入する層 (ADR-127)。

`ur_kinematics` は同次変換行列しか知らない純粋な数学で、こちらが**この探索エンジンの
語彙との対応づけ**を持つ:

1. 候補 `Pose(position, approach, roll)` -> フランジの目標姿勢 (同次変換)
2. 解の集合 (最大 8) -> 宣言された関節限界での絞り込み
3. 残った解の**代表 1 つ**を決定的に選ぶ

## フランジ frame の規約 (declared, not derived)

**フランジの +Z が approach と同じ向き** (UR の `tool0` が +Z をツール方向に取る慣例)、
**+X は候補 frame の +X そのもの** (= 平行ジョーの閉じ軸 — `pose_codec.frame_axes`)。
すなわちフランジは候補 frame を**自身の x 軸まわりに 180° 回した固定の取付け**
(x はそのまま、y と z が反転) である (ADR-150 D5)。

ADR-150 以前は +X を「`basis_from_z(+approach)` を roll だけ回したもの」として
**張り直して**いた。候補 frame は `basis_from_z(−approach)` から張るので、閉じ軸は
フランジ座標で `(−cos 2r, sin 2r)` — **roll の 2 倍で回っていた**。フランジに剛体で
付いたツールの閉じ軸は動かないので、これでは解いた手首 (θ6) と判定したジョーの
向きが一致しない。フランジ +Z・並進・腕リンクは変わらず、動くのは θ6 だけ。

これは*導出できない*規約である — どちらが「正しい」かはワイヤの外の取り決めなので、
ここでは**宣言し、名前を付け、検査で焼く**。`FLANGE_Z_IS_APPROACH` がその宣言で、
規約を変えるならこの定数の意味ごと変える。

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

from .types import GraspCandidate, Quaternion, Robot, Vec3
from .feasibility import IkSolution, JointSolution
from .pose_codec import frame_axes
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


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )


def flange_target(
    candidate: GraspCandidate, tool_length: float = 0.0
) -> "tuple[float, ...] | None":
    """候補の (position, approach, roll) をフランジの目標同次変換へ写す (純粋)。

    退化 (approach がゼロ長) は None — 目標が定義できないことを解の不在と混ぜない。

    **候補の position は TCP (ツール先端) であってフランジではない** (ADR-150 D4)。
    ツールはフランジの +Z (= approach) 方向へ `tool_length` だけ伸びて剛体で付いて
    いるので、フランジは TCP から approach の逆向きに `tool_length` だけ戻った点に
    置く。`tool_length = 0` は ADR-150 以前の「フランジ = TCP」と 1 ビットも変わらない
    (宣言した瞬間にだけ挙動が変わる — ADR-084 §3)。
    """
    if tool_length < 0.0:
        raise ValueError(f"tool_length は 0 以上 (受け取った: {tool_length})")
    approach = candidate.pose.approach
    if approach.norm() < _EPS:
        return None
    z = approach.normalized()
    # x = 候補 frame の x (閉じ軸) — ツールは剛体なので閉じ軸はフランジに固定される
    # (ADR-150 D5)。y = z × x で右手系 (= 候補 frame の −y)。
    x = frame_axes(candidate.pose)[0]
    y = _cross(z, x)
    tcp = candidate.pose.position
    p = Vec3(
        tcp.x - z.x * tool_length,
        tcp.y - z.y * tool_length,
        tcp.z - z.z * tool_length,
    )
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
    # フランジ (tool0) から TCP までの長さ、フランジ +Z 方向 (ADR-150 D4)。
    # 宣言元は `robot.toolLength`。0 = 「フランジ = TCP」(従来と同一)。
    tool_length: float = 0.0

    def solve(
        self, candidate: GraspCandidate, robot: Robot
    ) -> Optional[IkSolution]:
        """解が在れば代表解を返す。無ければ None。

        `robot.base` はワールド上のベース位置なので、目標をベース座標へ移してから解く
        (この運動学はベース原点系で定義されている)。

        据付**姿勢** (`robot.base_orientation`, ADR-129 D2) が宣言されていれば、並進を
        戻したあとその逆回転で目標を戻す — 傾けて据え付けたアームで答えが変わる。
        宣言が無いときは恒等のまま = 従来と 1 ビットも変わらない (ADR-084 §3 /
        ADR-127 D3 の規律: **宣言した瞬間にだけ挙動が変わる**)。None は「直立」では
        なく「述べていない」で、その区別を画面に出すのはフロントの責務である —
        向き無しでは解けない以上、core/ は恒等で解くしかない (原則 #31)。
        """
        target = flange_target(candidate, self.tool_length)
        if target is None:
            return None
        base = robot.base
        # ベース並進ぶんだけ目標を戻す。
        local = list(target)
        local[3] -= base.x
        local[7] -= base.y
        local[11] -= base.z
        if robot.base_orientation is not None:
            local = _unrotate_into_base(local, robot.base_orientation)
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
        # JointSolution = 「描ける 6 関節の配置」という型の主張 (ADR-135)。素朴ソルバの
        # 占位 IkSolution と取り違えられない形にしてある。
        return JointSolution(joints=tuple(best))

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
    return UniversalRobotsIkSolver(
        dh=dh, joint_limits=limits,
        tool_length=tool_length_from_declaration(declaration_data),
    )


def tool_length_from_declaration(declaration_data: dict) -> float:
    """`robot.toolLength` (ADR-150 D4) を読む。未宣言は 0 = フランジ = TCP。

    ハンド (`gripper`) ではなくロボット側に置くのは、ツール長が**取付け**の事実で
    あって把持性ゲートの入力ではないから — `gripper` を宣言しない (ゲートを切った)
    探索でもツールはフランジに付いている。

    未宣言を 0 とするのは推論ではなく**後方互換の宣言**である: ADR-150 以前の
    送信者はツール長を述べておらず、その答えは「フランジ = TCP」で解かれていた。
    ここで別の既定 (「典型的なグリッパ長」) を入れると、述べていない送信者の答えが
    無言で変わる。フロントは常に明示的に宣言する (`GraspDeclarationCatalog`)。
    負の長さは throw — 反対向きに生えたツールは宣言の誤りであって解ける形ではない。
    """
    robot = declaration_data.get("robot") or {}
    raw = robot.get("toolLength")
    if raw is None:
        return 0.0
    length = float(raw)
    if length < 0.0 or not math.isfinite(length):
        raise ValueError(f"robot.toolLength は 0 以上の有限数 (受け取った: {raw!r})")
    return length


def _unrotate_into_base(m: list[float], base_orientation: Quaternion) -> list[float]:
    """ワールド並びの 4x4 (row-major) を、ベース据付姿勢の**逆回転**で戻す。

    回転部の 3 本の列ベクトルと並進を同じ逆回転にかける。行列積を書かずに列ごとに
    回すのは、`Quaternion.rotate` が既に安定形を持っており、ここで 2 つ目の回転
    実装を作らないため (§1.1 — 同じ事実の第二の源を作らない)。

    **壊れた四元数は恒等へ落とさず throw する** (ADR-127 D3 と同型)。無言の格下げは
    「宣言したのに無視された」であり、応答は候補 0 件という*正しい形*で返るので
    最も気づきにくい嘘になる。
    """
    if base_orientation.norm() < 1e-9:
        raise ValueError(
            "robot.baseOrientation が退化している (ノルム 0)。恒等へ落とさず拒否する — "
            "宣言を無言で無視すると、答えは正しい形をしたまま間違う (ADR-129 D2 / ADR-127 D3)。"
        )
    inv = base_orientation.conjugate()
    cols = [
        inv.rotate(Vec3(m[0], m[4], m[8])),
        inv.rotate(Vec3(m[1], m[5], m[9])),
        inv.rotate(Vec3(m[2], m[6], m[10])),
    ]
    t = inv.rotate(Vec3(m[3], m[7], m[11]))
    return [
        cols[0].x, cols[1].x, cols[2].x, t.x,
        cols[0].y, cols[1].y, cols[2].y, t.y,
        cols[0].z, cols[1].z, cols[2].z, t.z,
        0.0, 0.0, 0.0, 1.0,
    ]
