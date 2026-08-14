"""UR 系の順運動学 + 解析解 IK のテスト (ADR-127)。

## なぜ round-trip が中心なのか

IK は多対一の写像なので `IK(FK(q)) == q` は**成り立たない** (同じ姿勢へ最大 8 通りの
関節配置で到達する)。求めてよい同一性は商の上の fixpoint — つまり
**`FK(IK(T)) == T` が全解について成り立つこと**であり、これは原則 #28
(Mutual = Round-Trip Up to Normal Form) がまさに名指ししている形である。

加えて「全解が目標に一致する」だけでは*不足*も見逃す (1 解しか返さなくても緑になる)。
そこで**元の q が解集合に含まれること**も別に問う — 健全性と完全性の両方を焼く。
"""

import math
import random

import pytest

from easy_extrude_core.engine.types import GraspCandidate, Pose, Robot, Vec3
from easy_extrude_core.engine.ur_kinematics import (
    UrDhParameters,
    forward_kinematics,
    inverse_kinematics,
    within_joint_limits,
)
from easy_extrude_core.engine.ur_solver import (
    KINEMATICS_KIND_UNIVERSAL_ROBOTS,
    UniversalRobotsIkSolver,
    flange_target,
    ik_solver_from_declaration,
)

# UR5e の公表寸法。`public/robot/skeleton_arm.urdf` のヘッダが同じ 6 数を宣言して
# おり、フロントの骨格はこの値でリンク原点を並べている (ADR-088)。同じ数が 2 箇所に
# 在ることは ADR-127 が「検査つきの冗長」として引き受けた点。
UR5E = UrDhParameters(
    d1=0.1625, a2=-0.425, a3=-0.3922, d4=0.1333, d5=0.0997, d6=0.0996
)


def _max_abs_diff(a, b) -> float:
    return max(abs(x - y) for x, y in zip(a, b))


def _angles_equal(a, b, tol=1e-6) -> bool:
    """2π 差を同一視した角の一致 (関節は回りきるので周期を無視できない)。"""
    return all(
        abs(((x - y + math.pi) % (2 * math.pi)) - math.pi) < tol for x, y in zip(a, b)
    )


# --- 順運動学 ----------------------------------------------------------------


def test_forward_kinematics_at_zero_is_the_documented_home_pose():
    """全関節 0 のフランジ位置が DH から手計算できる値に一致する。

    IK の物差しになる FK 自身が正しいことを、IK と独立に固定する
    (両方が同じ間違いをしていると round-trip は緑を出す)。
    """
    t = forward_kinematics(UR5E, (0.0,) * 6)
    # 全関節 0 では 2/3 リンクが x 方向へ伸び、d4/d6 が y、d1/d5 が z に効く。
    assert t[3] == pytest.approx(UR5E.a2 + UR5E.a3, abs=1e-12)
    assert t[7] == pytest.approx(-UR5E.d4 - UR5E.d6, abs=1e-12)
    assert t[11] == pytest.approx(UR5E.d1 - UR5E.d5, abs=1e-12)


def test_forward_kinematics_rejects_wrong_joint_count():
    with pytest.raises(ValueError):
        forward_kinematics(UR5E, (0.0, 0.0, 0.0))


# --- 解析解 IK ---------------------------------------------------------------


def test_every_solution_reaches_the_requested_pose():
    """健全性: 返ってきた解はすべて目標姿勢に一致する (FK(IK(T)) == T)。"""
    rng = random.Random(20260814)
    worst = 0.0
    checked = 0
    for _ in range(200):
        q = tuple(rng.uniform(-2.8, 2.8) for _ in range(6))
        target = forward_kinematics(UR5E, q)
        for solution in inverse_kinematics(UR5E, target):
            worst = max(worst, _max_abs_diff(forward_kinematics(UR5E, solution), target))
            checked += 1
    assert checked > 0, "1 解も検証していない — 空の照合は緑に見えるが検査ではない"
    # 解析解なので機械精度。反復解法の許容差ではない。
    assert worst < 1e-9, f"FK(IK(T)) が目標からずれた: {worst}"


def test_the_original_configuration_is_among_the_solutions():
    """完全性: 元の関節配置が解集合に含まれる。

    健全性だけでは「1 解しか返さない実装」も緑になる。解を*取りこぼしていない*ことは
    別の主張なので別に問う。
    """
    rng = random.Random(7)
    for _ in range(200):
        q = tuple(rng.uniform(-2.8, 2.8) for _ in range(6))
        solutions = inverse_kinematics(UR5E, forward_kinematics(UR5E, q))
        assert any(_angles_equal(s, q) for s in solutions), f"元の配置が消えた: {q}"


def test_a_generic_pose_has_eight_solutions():
    """一般姿勢では 8 解 (肩の左右 x 肘の上下 x 手首の反転 = 2^3)。"""
    q = (0.3, -0.9, 1.2, -0.5, 1.1, 0.4)
    assert len(inverse_kinematics(UR5E, forward_kinematics(UR5E, q))) == 8


def test_unreachable_pose_yields_no_solutions():
    """届かない姿勢では空。**空は「解が無い」であって「解けなかった」ではない** —
    解析解に収束失敗という状態は存在しない。"""
    far = (
        1.0, 0.0, 0.0, 5.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.3,
        0.0, 0.0, 0.0, 1.0,
    )
    assert inverse_kinematics(UR5E, far) == ()


def test_solution_order_is_deterministic():
    """同じ入力に同じ順序。上位が代表解を選ぶときの再現性の前提。"""
    target = forward_kinematics(UR5E, (0.2, -0.8, 1.0, -0.3, 0.7, 0.1))
    assert inverse_kinematics(UR5E, target) == inverse_kinematics(UR5E, target)


# --- 関節限界 ----------------------------------------------------------------


def test_undeclared_joint_limits_are_not_checked_rather_than_infinite():
    """限界の不在は「無い」ではなく「問うていない」(原則 #31)。"""
    assert within_joint_limits((0.0,) * 6, None) is True
    assert within_joint_limits((10.0,) * 6, None) is True  # 検査していないので通る
    limits = tuple((-1.0, 1.0) for _ in range(6))
    assert within_joint_limits((0.5,) * 6, limits) is True
    assert within_joint_limits((2.0,) * 6, limits) is False


def test_joint_limit_pairs_must_match_the_joint_count():
    with pytest.raises(ValueError):
        within_joint_limits((0.0,) * 6, tuple((-1.0, 1.0) for _ in range(3)))


# --- ソルバ層 (候補 -> フランジ姿勢 -> 代表解) --------------------------------


def _candidate(position: Vec3, approach: Vec3, roll: float = 0.0) -> GraspCandidate:
    a = approach.normalized()
    return GraspCandidate(
        pose=Pose(position=position, approach=a, roll=roll),
        pre_grasp=position - a.scaled(0.1),
        surface_normal=a.scaled(-1.0),
    )


def test_solver_returns_joints_that_place_the_flange_on_the_candidate():
    """代表解を FK に通すと、候補が要求したフランジ姿勢に戻る。

    ここが「gauge の宣言」を焼いている箇所でもある — `flange_target` の規約
    (フランジ +Z = approach) を変えれば、この検査が落ちる。
    """
    solver = UniversalRobotsIkSolver(dh=UR5E)
    robot = Robot(base=Vec3(0, 0, 0), reach_min=0.0, reach_max=10.0)
    candidate = _candidate(Vec3(0.4, 0.1, 0.3), Vec3(0, 0, -1))

    solution = solver.solve(candidate, robot)
    assert solution is not None
    assert _max_abs_diff(
        solver.flange_pose_of(solution.joints), flange_target(candidate)
    ) < 1e-9


def test_solver_accounts_for_the_robot_base_offset():
    """ベースを動かすと、同じワールド姿勢は別の関節値で解かれる。

    ベース並進を無視していると、原点に据えたときだけ正しく見える (ADR-090 の
    「原点に立つ幽霊ロボット」と同じ形の見落とし)。
    """
    solver = UniversalRobotsIkSolver(dh=UR5E)
    candidate = _candidate(Vec3(0.4, 0.1, 0.3), Vec3(0, 0, -1))
    at_origin = solver.solve(candidate, Robot(base=Vec3(0, 0, 0), reach_min=0, reach_max=10))
    moved = solver.solve(candidate, Robot(base=Vec3(0.2, 0, 0), reach_min=0, reach_max=10))
    assert at_origin is not None and moved is not None
    assert not _angles_equal(at_origin.joints, moved.joints)


def test_solver_returns_none_when_limits_exclude_every_solution():
    """解は在るが宣言された限界の外 — 「解けない」として返す。"""
    solver = UniversalRobotsIkSolver(
        dh=UR5E, joint_limits=tuple((-0.01, 0.01) for _ in range(6))
    )
    robot = Robot(base=Vec3(0, 0, 0), reach_min=0.0, reach_max=10.0)
    assert solver.solve(_candidate(Vec3(0.4, 0.1, 0.3), Vec3(0, 0, -1)), robot) is None


def test_solver_is_deterministic_for_the_same_request():
    solver = UniversalRobotsIkSolver(dh=UR5E)
    robot = Robot(base=Vec3(0, 0, 0), reach_min=0.0, reach_max=10.0)
    candidate = _candidate(Vec3(0.35, -0.2, 0.4), Vec3(0, 0, -1), roll=0.5)
    first = solver.solve(candidate, robot)
    second = solver.solve(candidate, robot)
    assert first is not None and first.joints == second.joints


# --- 宣言の読み取り ----------------------------------------------------------


def _declaration(**kinematics) -> dict:
    return {"robot": {"base": [0, 0, 0], "kinematics": kinematics}}


_DH_WIRE = {"d1": 0.1625, "a2": -0.425, "a3": -0.3922, "d4": 0.1333, "d5": 0.0997, "d6": 0.0996}


def test_no_kinematics_declared_means_the_naive_judgement_stays():
    """宣言が無ければ None = 素朴判定のまま。宣言した瞬間にだけ挙動が変わる。"""
    assert ik_solver_from_declaration({"robot": {"base": [0, 0, 0]}}) is None
    assert ik_solver_from_declaration({}) is None


def test_declared_universal_robots_builds_the_analytic_solver():
    solver = ik_solver_from_declaration(
        _declaration(kind=KINEMATICS_KIND_UNIVERSAL_ROBOTS, dh=_DH_WIRE)
    )
    assert isinstance(solver, UniversalRobotsIkSolver)
    assert solver.dh == UR5E
    assert solver.joint_limits is None  # 未宣言は None のまま (既定を発明しない)


def test_declared_joint_limits_are_carried_through():
    solver = ik_solver_from_declaration(
        _declaration(
            kind=KINEMATICS_KIND_UNIVERSAL_ROBOTS,
            dh=_DH_WIRE,
            jointLimits=[{"min": -3.14, "max": 3.14} for _ in range(6)],
        )
    )
    assert solver is not None and solver.joint_limits is not None
    assert len(solver.joint_limits) == 6


def test_an_unknown_kinematics_kind_throws_rather_than_falling_back():
    """未宣言の種別で throw する — fall-through は「宣言された既定」と
    「誰も考えなかった種」を区別不能にする (原則 #31)。"""
    with pytest.raises(ValueError, match="未宣言の運動学種別"):
        ik_solver_from_declaration(_declaration(kind="scara", dh=_DH_WIRE))


def test_a_missing_dh_length_throws_rather_than_defaulting():
    """欠けた寸法を既定で埋めると**別のアーム**を解くことになり、
    その答えは正しい答えと見分けがつかない。"""
    partial = dict(_DH_WIRE)
    del partial["a3"]
    with pytest.raises(ValueError, match="6 つの長さ"):
        ik_solver_from_declaration(
            _declaration(kind=KINEMATICS_KIND_UNIVERSAL_ROBOTS, dh=partial)
        )


def test_the_declaration_actually_reaches_the_search_pipeline():
    """宣言が探索の答えを変える — 配線が繋がっていることを端から端で焼く。

    ソルバ単体が正しくても `search()` が読んでいなければ何も起きない。ADR-116 の
    「主経路が死んでいても計数は緑」と同じ形を避けるため、経路そのものを走らせる。
    """
    from easy_extrude_core.contract import GraspSearchDeclaration, GraspSearchRequest
    from easy_extrude_core.engine import search

    samples = [
        {"point": [0.4, 0.0, 0.3], "normal": [0.0, 0.0, 1.0]},
        {"point": [0.45, 0.05, 0.3], "normal": [0.0, 0.0, 1.0]},
    ]
    base = {
        "robot": {"base": [0.0, 0.0, 0.0]},
        "target": {"surfaceSamples": samples},
        "objectiveWeights": {"grasp_stability": 1.0},
        "topN": 5,
    }

    def run(declaration: dict):
        return search(
            GraspSearchRequest(
                layout_version="layout/1.0",
                grasp_search=GraspSearchDeclaration.model_validate(declaration),
            )
        )

    naive = run(base)
    # 関節限界を「どこも動かせない」に宣言すれば、解析解ソルバは全候補を IK で落とす。
    # 素朴判定にはそもそも関節という概念が無いので、この差は解析解が効いた証拠になる。
    frozen = dict(base)
    frozen["robot"] = dict(base["robot"]) | {
        "kinematics": {
            "kind": KINEMATICS_KIND_UNIVERSAL_ROBOTS,
            "dh": _DH_WIRE,
            "jointLimits": [{"min": -0.001, "max": 0.001} for _ in range(6)],
        }
    }
    constrained = run(frozen)

    assert naive.candidates, "素朴判定では候補が出る前提の fixture"
    assert not constrained.candidates, "宣言した関節限界が探索に効いていない"
    assert constrained.diagnostics.rejected_by_ik > 0, "棄却が IK 段で数えられていない"


def test_wrong_number_of_joint_limit_pairs_throws():
    with pytest.raises(ValueError, match="6 対"):
        ik_solver_from_declaration(
            _declaration(
                kind=KINEMATICS_KIND_UNIVERSAL_ROBOTS,
                dh=_DH_WIRE,
                jointLimits=[{"min": -1.0, "max": 1.0}],
            )
        )
