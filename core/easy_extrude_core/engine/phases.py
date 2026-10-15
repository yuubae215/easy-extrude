"""干渉を動作の相ごとに問う (ADR-157)。

ピック動作は分岐の無い 6 相の列 (transit → approach → close → lift → transport → place)
で、相ごとに**動く物体の集合**が違う。とくに携行物 (`held`) の基数が close → lift で
0 → 1 に遷移する。この module はその列の定義・相ごとの被覆の宣言・相ごとの当たりの
計算を持つ唯一の場所である。

- 相がどの部位を判定するかの正本は `PHASE_COVERAGE` (相 × 部位)。未宣言の相・部位は
  `coverage_of` が throw する (原則 #31 — 既定表の fall-through は「宣言された既定」と
  「誰も考えなかった種」を区別不能にする)。
- 相が判定されるかどうかは**リクエストの宣言だけ**で決まる (`phase_unevaluated_reason`)。
  候補に依らないので、応答は相ごとに 1 行 (評価した / 理由つきで評価していない) を持てる。
- 当たりの計算は `feasibility` の部位ごとの唯一の実装 (`segment_obstacle_hits` /
  `segments_obstacle_hits` / `boxes_obstacle_hits`) を通る。ここで幾何を書き直さない。

すべて純粋関数 (原則 #3)。
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from typing import Iterator, Optional, Protocol

from .feasibility import (
    HAND_PATH_STEPS,
    IkSolution,
    JointSolution,
    arm_link_segments,
    boxes_obstacle_hits,
    flange_frame,
    hand_boxes_along,
    hand_obbs,
    path_points,
    segment_obstacle_hits,
    segments_obstacle_hits,
)
from .types import (
    FINGER_PART_NAME,
    GraspCandidate,
    HandPart,
    HandShape,
    Obb,
    ParallelJawGripper,
    Problem,
    Robot,
    Vec3,
)
from .ur_kinematics import UrDhParameters


class MotionPhase(str, Enum):
    """動作相 (ADR-157 D1)。**定義順が動作の順** — 棄却はこの順で最初に当たった相へ帰属する。"""

    TRANSIT = "transit"
    APPROACH = "approach"
    CLOSE = "close"
    LIFT = "lift"
    TRANSPORT = "transport"
    PLACE = "place"


#: 動作の順 (列挙の定義順)。帰属 (ADR-157 D3) と応答の行の順はこれに従う。
PHASE_ORDER: "tuple[MotionPhase, ...]" = tuple(MotionPhase)


class Part(str, Enum):
    """当たりうる部位 (ADR-157)。ワイヤの `hits[].part` と 1 対 1。"""

    TCP_PATH = "tcpPath"  # 手の形が未宣言のときの代理 (フランジ→TCP の線分ではなく TCP の軌跡)
    ARM = "arm"
    HAND = "hand"
    HELD = "held"  # 携行物 = 掴んだ対象 (lift 以降)


class Coverage(str, Enum):
    """相 × 部位のセルの宣言 (ADR-157 D1)。"""

    EVALUATED = "evaluated"
    AT_END_ONLY = "atEndOnly"  # 相の終点の 1 姿勢だけを判定する (途中は全相分析で測るだけ)
    UNEVALUATED = "unevaluated"  # 動くのに判定していない = 残し (DEF-057)
    # 動くが判定には使わない — 全相分析で経路に沿って**測るだけ** (`arm_segments_along`)。
    # 残しではなく決定 (当事者合意 2026-10-15「測るだけで良い。回避しようとしなくてもいい」,
    # ADR-158 PR1)。UNEVALUATED と分けるのは「まだ決めていない」と「決めて測るだけ」を
    # 1 語に兼ねさせないため (原則 #33)。
    MEASURED_ONLY = "measuredOnly"
    NOT_MOVING = "notMoving"  # その相では動かない (または存在しない)


class UnevaluatedReason(str, Enum):
    """相を評価しなかった理由 (ADR-157 D2)。ワイヤの `reason` と 1 対 1。"""

    NOT_YET_DECIDED = "notYetDecided"  # 解法をまだ決めていない相 (DEF-057)
    GRIPPER_UNDECLARED = "gripperUndeclared"
    HAND_SHAPE_UNDECLARED = "handShapeUndeclared"
    TARGET_BOX_UNDECLARED = "targetBoxUndeclared"
    LIFT_UNDECLARED = "liftUndeclared"


_E, _A, _U, _N = Coverage.EVALUATED, Coverage.AT_END_ONLY, Coverage.UNEVALUATED, Coverage.NOT_MOVING
_M = Coverage.MEASURED_ONLY

#: 相 × 部位の被覆の宣言 (ADR-157 D1)。**正本はここ**。`unevaluated` のセルの個数は
#: `core/tests/test_motion_phases.py` が ratchet で数える (超えても下回っても fail)。
PHASE_COVERAGE: "dict[MotionPhase, dict[Part, Coverage]]" = {
    MotionPhase.TRANSIT:   {Part.TCP_PATH: _U, Part.ARM: _U, Part.HAND: _U, Part.HELD: _N},
    MotionPhase.APPROACH:  {Part.TCP_PATH: _E, Part.ARM: _A, Part.HAND: _E, Part.HELD: _N},
    MotionPhase.CLOSE:     {Part.TCP_PATH: _N, Part.ARM: _N, Part.HAND: _E, Part.HELD: _N},
    MotionPhase.LIFT:      {Part.TCP_PATH: _E, Part.ARM: _M, Part.HAND: _E, Part.HELD: _E},
    MotionPhase.TRANSPORT: {Part.TCP_PATH: _U, Part.ARM: _U, Part.HAND: _U, Part.HELD: _U},
    MotionPhase.PLACE:     {Part.TCP_PATH: _U, Part.ARM: _U, Part.HAND: _U, Part.HELD: _U},
}

#: 解法をまだ決めていない相 (DEF-057)。**宣言の有無に依らず** unevaluated。
_PHASES_NOT_YET_DECIDED = frozenset(
    {MotionPhase.TRANSIT, MotionPhase.TRANSPORT, MotionPhase.PLACE}
)


def coverage_of(phase: MotionPhase, part: Part) -> Coverage:
    """セルの宣言。未宣言の相・部位は throw する (原則 #31)。"""
    row = PHASE_COVERAGE.get(phase)
    if row is None or part not in row:
        raise ValueError(
            f"PHASE_COVERAGE に {phase!r} × {part!r} の行が無い — 動く部位を足したら被覆も宣言すること (ADR-157 D1)"
        )
    return row[part]


# 携行物を置く大きさの相対的な縮み (ADR-157 D5)。対象が元々触れている床・隣のワークとの
# **面一の静止接触**を「動作が起こした当たり」と数えないため。分離軸判定は接触を当たりに
# 倒す (保守側) ので、縮めなければ床に置かれた物は 1 つも持ち上がらない。
HELD_REST_CONTACT_REL = 1e-6


@dataclass(frozen=True)
class Hit:
    """当たり 1 件 = 部位 × 障害物 (リクエストの `obstacles[]` の添字)。"""

    part: Part
    obstacle_index: int


@dataclass(frozen=True)
class ArmModel:
    """腕を判定するための材料 (ADR-145)。宣言された運動学があるときだけ在る。"""

    dh: UrDhParameters
    tool_length: float


def phase_unevaluated_reason(problem: Problem, phase: MotionPhase) -> Optional[UnevaluatedReason]:
    """この相をこのリクエストで評価しない理由。評価するなら None (純粋, ADR-157 D2)。

    **候補に依らない** — 宣言だけで決まるので、応答は相ごとに 1 行を持てる。
    """
    if phase in _PHASES_NOT_YET_DECIDED:
        return UnevaluatedReason.NOT_YET_DECIDED
    if phase is MotionPhase.APPROACH:
        return None
    if phase is MotionPhase.CLOSE:
        gripper = problem.gripper
        if gripper is None:
            return UnevaluatedReason.GRIPPER_UNDECLARED
        if not isinstance(gripper, ParallelJawGripper):
            return None  # 吸引: 動く部品が無い = 評価して常に clear (ADR-157 D4)
        if gripper.shape is None:
            return UnevaluatedReason.HAND_SHAPE_UNDECLARED
        if problem.target.box is None:
            return UnevaluatedReason.TARGET_BOX_UNDECLARED
        return None
    if phase is MotionPhase.LIFT:
        if problem.lift is None:
            return UnevaluatedReason.LIFT_UNDECLARED
        if problem.target.box is None:
            return UnevaluatedReason.TARGET_BOX_UNDECLARED
        return None
    raise ValueError(f"未宣言の動作相 {phase!r} (ADR-157 D1)")


def _hand_shape(problem: Problem) -> Optional[HandShape]:
    return getattr(problem.gripper, "shape", None) if problem.gripper is not None else None


def closing_width(candidate: GraspCandidate, box: Obb, max_opening: float) -> float:
    """爪を閉じきったときの内面間 = 対象 box の閉じ軸方向の厚み (開口でクランプ)。

    閉じ軸はフランジ x (= 候補 frame の x, ADR-150 D5)。把持性の段が同じ式で幅を
    測っている (ADR-152 §2) — 開口を超える幅はそこで既に棄却されている。
    """
    _, (x, _, _) = flange_frame(candidate, candidate.pose.position, 0.0)
    return min(max_opening, 2.0 * box.extent_along(x))


def _fingers_at(shape: HandShape, inner_gap: float) -> "tuple[HandPart, ...]":
    """爪 (x 対称の 2 本) を内面間 `inner_gap` の位置へ動かした部品列。筐体はそのまま。"""
    out = []
    for p in shape.parts:
        if not p.is_finger:
            out.append(p)
            continue
        sign = 1.0 if p.center.x >= 0.0 else -1.0
        cx = sign * (inner_gap / 2.0 + p.half.x)
        out.append(replace(p, center=Vec3(cx, p.center.y, p.center.z)))
    return tuple(out)


def _finger_sweep(shape: HandShape, open_gap: float, closed_gap: float) -> "tuple[HandPart, ...]":
    """開いた位置から閉じた位置までの爪の**掃引体積**を、爪ごとに 1 つの箱で (ADR-157 D4)。

    爪は閉じ軸に沿って並進するだけなので、掃引はそれ自体が箱になる — 離散化しない。
    """
    out = []
    for p in shape.parts:
        if not p.is_finger:
            continue
        sign = 1.0 if p.center.x >= 0.0 else -1.0
        x_open = open_gap / 2.0 + p.half.x
        x_closed = closed_gap / 2.0 + p.half.x
        out.append(HandPart(
            name=FINGER_PART_NAME,
            center=Vec3(sign * (x_open + x_closed) / 2.0, p.center.y, p.center.z),
            half=Vec3(p.half.x + abs(x_open - x_closed) / 2.0, p.half.y, p.half.z),
        ))
    return tuple(out)


def _closed_shape(problem: Problem, candidate: GraspCandidate) -> Optional[HandShape]:
    """閉じた手の形。ジョーは爪を対象の厚みまで寄せ、吸引は形のまま。未宣言は None。"""
    shape = _hand_shape(problem)
    if shape is None:
        return None
    gripper = problem.gripper
    if isinstance(gripper, ParallelJawGripper) and problem.target.box is not None:
        w = closing_width(candidate, problem.target.box, gripper.max_opening)
        return replace(shape, parts=_fingers_at(shape, w))
    return shape


def _held_box(box: Obb, offset: Vec3) -> Obb:
    """携行物 = 対象 box を offset だけ動かし、静止接触ぶんだけ縮めたもの (ADR-157 D5)。"""
    shrink = 1.0 - HELD_REST_CONTACT_REL
    return Obb(center=box.center + offset, axes=box.axes, half=box.half.scaled(shrink))


def _tag(part: Part, indices: Iterator[int], first_only: bool) -> "list[Hit]":
    out: list[Hit] = []
    for i in indices:
        out.append(Hit(part, i))
        if first_only:
            break
    return out


def phase_hits(
    problem: Problem,
    phase: MotionPhase,
    candidate: GraspCandidate,
    *,
    solution: object = None,
    arm: Optional[ArmModel] = None,
    probe_radius: float = 0.0,
    first_only: bool = True,
    path_steps: int = HAND_PATH_STEPS,
) -> "tuple[Hit, ...]":
    """評価する相 1 つで、この候補が当たる (部位, 障害物) の列 (純粋, ADR-157)。

    `first_only=True` は最初の 1 件で止める (通常の探索 — 帰属には有無だけが要る)。
    `False` は全部を返す (全相分析 D6)。評価しない相で呼ぶのは呼び手の誤りなので throw。
    """
    reason = phase_unevaluated_reason(problem, phase)
    if reason is not None:
        raise ValueError(f"{phase.value} は評価しない相 ({reason.value}) — 呼び手は先に理由を問うこと")
    obstacles = problem.obstacles
    shape = _hand_shape(problem)
    hits: list[Hit] = []

    def collect(part: Part, indices: Iterator[int]) -> bool:
        hits.extend(_tag(part, indices, first_only))
        return first_only and bool(hits)

    if phase is MotionPhase.APPROACH:
        a, b = candidate.pre_grasp, candidate.pose.position
        if collect(Part.TCP_PATH, segment_obstacle_hits(a, b, obstacles, probe_radius)):
            return tuple(hits)
        if arm is not None and isinstance(solution, JointSolution):
            segments = arm_link_segments(arm.dh, solution, problem.robot, arm.tool_length)
            if collect(Part.ARM, segments_obstacle_hits(segments, obstacles, probe_radius)):
                return tuple(hits)
        if shape is not None:
            boxes = hand_boxes_along(candidate, shape, problem.tool_length, a, b, path_steps)
            collect(Part.HAND, boxes_obstacle_hits(boxes, obstacles))
        return tuple(hits)

    if phase is MotionPhase.CLOSE:
        gripper = problem.gripper
        if not isinstance(gripper, ParallelJawGripper):
            return ()  # 吸引: 動く部品が無い
        assert shape is not None and problem.target.box is not None  # 理由で弾き済み
        w = closing_width(candidate, problem.target.box, gripper.max_opening)
        sweep = replace(shape, parts=_finger_sweep(shape, gripper.max_opening, w))
        boxes = hand_obbs(candidate, sweep, problem.tool_length, candidate.pose.position)
        collect(Part.HAND, boxes_obstacle_hits(boxes, obstacles))
        return tuple(hits)

    if phase is MotionPhase.LIFT:
        lift = problem.lift
        box = problem.target.box
        assert lift is not None and box is not None  # 理由で弾き済み
        d = lift.direction(candidate).scaled(lift.distance)
        start = candidate.pose.position
        end = start + d
        closed = _closed_shape(problem, candidate)
        if closed is not None:
            boxes = hand_boxes_along(
                candidate, closed, problem.tool_length, start, end, path_steps,
                include_start=False,
            )
            if collect(Part.HAND, boxes_obstacle_hits(boxes, obstacles)):
                return tuple(hits)
        else:
            if collect(Part.TCP_PATH, segment_obstacle_hits(start, end, obstacles, probe_radius)):
                return tuple(hits)
        # 携行物: t ∈ (0, 1] — t = 0 は閉じた直後そのもので、静止接触は当たりではない。
        held = tuple(
            _held_box(box, p - start)
            for p in path_points(start, end, path_steps, include_start=False)
        )
        collect(Part.HELD, boxes_obstacle_hits(held, obstacles))
        return tuple(hits)

    raise ValueError(f"未宣言の動作相 {phase!r} (ADR-157 D1)")


# --- 腕を経路に沿って測る (ADR-158 PR1 — 判定ではなく測定) -------------------------
#
# 探索の判定 (上の `phase_hits`) は腕を**把持姿勢の代表解 1 つ**でしか見ない
# (`PHASE_COVERAGE` の approach × arm = atEndOnly、lift × arm = measuredOnly)。
# ここはそれを変えない。全相分析 (ADR-157 D6) のときだけ、相の経路の各点で IK を
# 解き直して腕を置き、**ピック姿勢で当たるのか、途中の経路で当たるのか**を測る。
# 測った当たりは棄却に数えない (答えは 1 ビットも変わらない) — 当事者合意
# 2026-10-15「測るだけで良い。回避しようとしなくてもいい」。
#
# 枝の選び方: ピック姿勢で判定した代表解から出発し、隣の点へは直前の姿勢に最も
# 近い解を渡す (`solve_near`)。当たらない枝を探しには行かない (代替解の探索は DEF-037)。

#: 腕を経路に沿って測る相。経路が決まっている相だけ (transit / transport / place は
#: 経路そのものが未定 — DEF-057)。close は腕が動かない (`PHASE_COVERAGE` の notMoving)。
ARM_PATH_PHASES: "tuple[MotionPhase, ...]" = (MotionPhase.APPROACH, MotionPhase.LIFT)


class NearSolver(Protocol):
    """直前の姿勢に近い関節解を返す注入境界 (`UniversalRobotsIkSolver.solve_near`)。"""

    def solve_near(self, candidate: GraspCandidate, robot: Robot, seed: "tuple[float, ...]") -> Optional[IkSolution]: ...


@dataclass(frozen=True)
class ArmSample:
    """経路上の 1 点で腕を置いた結果。

    `s` は相の中の進み具合 (0 = 相の始点、1 = 終点 — 秒ではない、ADR-158 D3)。
    `joints` が None = その点の TCP 姿勢を取る関節解が関節限界の内側に無い
    (腕はこの直線をたどれない)。そのとき `obstacles` は空だが、それは「当たらなかった」
    ではなく「腕を置けなかった」である (原則 #31 — 区別は joints の None が運ぶ)。
    """

    s: float
    joints: "Optional[tuple[float, ...]]"
    obstacles: "tuple[int, ...]"
    at_pick_pose: bool


def _phase_tcp_path(problem: Problem, phase: MotionPhase, candidate: GraspCandidate) -> "tuple[Vec3, Vec3]":
    """相の TCP の直線 (始点, 終点) — 動作の向き。判定 (`phase_hits`) と同じ端点。"""
    if phase is MotionPhase.APPROACH:
        return candidate.pre_grasp, candidate.pose.position
    if phase is MotionPhase.LIFT:
        assert problem.lift is not None  # 評価しない相は呼び手が理由で弾く
        start = candidate.pose.position
        return start, start + problem.lift.direction(candidate).scaled(problem.lift.distance)
    raise ValueError(f"{phase.value} は腕を経路に沿って測る相ではない (ARM_PATH_PHASES)")


def arm_segments_along(
    problem: Problem,
    phase: MotionPhase,
    candidate: GraspCandidate,
    *,
    pick_solution: IkSolution,
    solver: NearSolver,
    arm: ArmModel,
    path_steps: int = HAND_PATH_STEPS,
) -> "tuple[ArmSample, ...]":
    """相の経路の各点に腕を置き、触れる障害物を測る (純粋, ADR-158 PR1 / DEF-058)。

    返り値は動作の順 (s 昇順)。ピック姿勢の点 (approach の s=1、lift の s=0) は
    判定に使った `pick_solution` そのもので、解き直さない。そこから外へ 1 点ずつ、
    直前の姿勢に近い解を渡していく。解の無い点は飛ばし、次の点は最後に置けた姿勢に
    近い解を選ぶ (無い点の向こうで腕が別の枝に飛んでも、それは測った事実)。
    """
    if not isinstance(pick_solution, JointSolution):
        raise ValueError("腕を置けるのは関節配置を持つ解だけ (ADR-135) — 呼び手が型で弾くこと")
    reason = phase_unevaluated_reason(problem, phase)
    if reason is not None:
        raise ValueError(f"{phase.value} は評価しない相 ({reason.value}) — 呼び手は先に理由を問うこと")
    a, b = _phase_tcp_path(problem, phase, candidate)
    points = path_points(a, b, path_steps)
    n = len(points)
    # ピック姿勢から外へ歩く順の添字。
    pick_index = n - 1 if phase is MotionPhase.APPROACH else 0
    walk = range(n - 1, -1, -1) if phase is MotionPhase.APPROACH else range(n)

    out: "dict[int, ArmSample]" = {}
    seed = pick_solution.joints
    for i in walk:
        if i == pick_index:
            solution: Optional[IkSolution] = pick_solution
        else:
            moved = replace(candidate, pose=replace(candidate.pose, position=points[i]))
            solution = solver.solve_near(moved, problem.robot, seed)
        s = i / (n - 1)
        if not isinstance(solution, JointSolution):
            out[i] = ArmSample(s=s, joints=None, obstacles=(), at_pick_pose=i == pick_index)
            continue
        seed = solution.joints
        segments = arm_link_segments(arm.dh, solution, problem.robot, arm.tool_length)
        out[i] = ArmSample(
            s=s,
            joints=solution.joints,
            obstacles=tuple(segments_obstacle_hits(segments, problem.obstacles)),
            at_pick_pose=i == pick_index,
        )
    return tuple(out[i] for i in range(n))
