"""段階0 探索の orchestration (副作用境界)。ADR-075 のパイプラインを組む層。

    離散候補生成 -> 安い順フィルタ (リーチ -> IK -> 干渉) -> 加重和スコア -> 上位N件

この層だけが副作用 (注入された IK ソルバ / 干渉チェッカの呼び出し) を持つ。候補生成・
判定・objective 正規化・スコア計算は純粋関数 (engine の他モジュール) に委譲する。

契約との接続 (ADR-074):
- 入力 GraspSearchRequest を受け、出力 GraspSearchResponse (rank 昇順の上位N件) を返す。
- contractVersion 検証ガード (check_contract_version) は **エンドポイント層** の責務。
  ここは検証済み宣言を受け取る計算に徹する (ADR-075 §4)。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

from ..contract import (
    GraspSearchDeclaration,
    GraspSearchRequest,
    GraspSearchResponse,
    PoseCandidate,
    ScoreBreakdown,
)
from ..contract import SearchDiagnostics as SearchDiagnosticsWire
from .candidates import generate_candidates
from .feasibility import (
    CollisionChecker,
    IkSolver,
    NaiveIkSolver,
    NaiveSphereCollisionChecker,
    interference_free,
    ik_solvable,
    reach_miss,
    within_reach,
)
from .objectives import evaluate_objectives
from .pose_codec import pose_to_payload
from .scoring import weighted_sum
from .types import Obstacle, Pose, Problem, Robot, TargetObject, Vec3


# --- 契約宣言 -> ドメイン Problem の adapter -------------------------------------
#
# graspSearch 宣言は契約境界では素通し (open payload)。幾何の実体はここで取り出す。
# Layout DSL の厳密な形は public 正本に属するため、ここでは wire 形 (camelCase) の
# 既知キーを寛容に読む。欠損は素朴な既定値に落とす (素朴版を動かすのが先)。


def _vec3(raw: Any, default: Optional[Vec3] = None) -> Vec3:
    if raw is None:
        if default is None:
            return Vec3(0.0, 0.0, 0.0)
        return default
    return Vec3(float(raw[0]), float(raw[1]), float(raw[2]))


def _tuple_floats(raw: Any, default: tuple[float, ...]) -> tuple[float, ...]:
    if not raw:
        return default
    return tuple(float(x) for x in raw)


def problem_from_declaration(declaration: GraspSearchDeclaration) -> Problem:
    """graspSearch 宣言 (open payload) からドメイン Problem を構築する。

    既知の wire キー (camelCase) を読む。詳細スキーマは public DSL 正本に属するため、
    ここでは段階0 が必要とする幾何だけを寛容に抽出する。
    """
    data = declaration.model_dump(by_alias=True)

    robot_raw = data.get("robot") or {}
    robot = Robot(
        base=_vec3(robot_raw.get("base"), Vec3(0.0, 0.0, 0.0)),
        reach_min=float(robot_raw.get("reachMin", 0.0)),
        reach_max=float(robot_raw.get("reachMax", float("inf"))),
        wrist_cone_half_angle=float(robot_raw.get("wristConeHalfAngle", math.pi)),
    )

    target_raw = data.get("target") or {}
    samples: list[tuple[Vec3, Vec3]] = []
    for s in target_raw.get("surfaceSamples", []) or []:
        samples.append((_vec3(s.get("point")), _vec3(s.get("normal"))))
    target = TargetObject(surface_samples=tuple(samples))

    obstacles: list[Obstacle] = []
    for o in data.get("obstacles", []) or []:
        obstacles.append(
            Obstacle(center=_vec3(o.get("center")), radius=float(o.get("radius", 0.0)))
        )

    sampling = data.get("sampling") or {}
    return Problem(
        robot=robot,
        target=target,
        obstacles=tuple(obstacles),
        approach_tilt_angles=_tuple_floats(
            sampling.get("approachTiltAngles"), (0.0,)
        ),
        roll_angles=_tuple_floats(sampling.get("rollAngles"), (0.0,)),
        pre_grasp_distance=float(sampling.get("preGraspDistance", 0.1)),
        clearance_reference=float(sampling.get("clearanceReference", 0.1)),
    )


# --- 診断 (ADR-079: 判定の証明) -------------------------------------------------


@dataclass(frozen=True)
class SearchDiagnostics:
    """探索 1 回分の棄却ファネル + near-miss (ドメイン型, ADR-079)。

    短絡フィルタ (リーチ -> IK -> 干渉) なので棄却段は排他に定まり、
    candidates_generated = rejected_by_reach + rejected_by_ik
    + rejected_by_interference + feasible が常に成り立つ (テストで固定)。

    載せるのは「ソルバが決定した事実」の集計のみ。演出 (文言/色/メーター) は
    クライアント所有。契約 v3 で wire (契約応答) にも同じ形で露出する
    (ADR-079)。
    """

    candidates_generated: int
    rejected_by_reach: int
    rejected_by_ik: int
    rejected_by_interference: int
    # 3 判定すべて通過した候補数 (= 採点対象)。
    feasible: int
    # 実際に応答へ載せた件数 (= min(feasible, topN))。
    returned: int
    # リーチ棄却候補の到達殻までの最小不足距離。リーチ棄却ゼロなら None。
    reach_nearest_miss: Optional[float]


@dataclass(frozen=True)
class SearchReport:
    """契約応答 + 診断の束。診断は探索ループからの導出値 (第二の源にしない)。"""

    response: GraspSearchResponse
    diagnostics: SearchDiagnostics


# --- 探索本体 (副作用境界) -----------------------------------------------------


def search_report(
    request: GraspSearchRequest,
    *,
    ik_solver: Optional[IkSolver] = None,
    collision_checker: Optional[CollisionChecker] = None,
) -> SearchReport:
    """段階0 の把持姿勢探索 + 診断。契約 GraspSearchRequest -> SearchReport。

    ソルバ/チェッカは注入可能 (省略時は naive 既定)。安い順フィルタで短絡し、通過した
    候補だけを加重和スコアで採点して rank 昇順の上位N件を返す。棄却ファネルと
    reach near-miss は同一ループで incidental に収集する (二度走らせない, ADR-079)。

    注: contractVersion 検証はエンドポイント層の責務 (ADR-074/002)。ここでは行わない。
    """
    solver = ik_solver if ik_solver is not None else NaiveIkSolver()
    checker = (
        collision_checker
        if collision_checker is not None
        else NaiveSphereCollisionChecker()
    )

    declaration = request.grasp_search
    problem = problem_from_declaration(declaration)
    weights = declaration.objective_weights
    objective_names = list(weights.keys())

    generated = 0
    rejected_by_reach = 0
    rejected_by_ik = 0
    rejected_by_interference = 0
    reach_nearest_miss: Optional[float] = None

    # 通過候補を (total_score, pose, objective_scores) で集める。
    scored: list[tuple[float, Pose, dict[str, float]]] = []
    for candidate in generate_candidates(problem):
        generated += 1
        # 安い順フィルタ: リーチ (最安) -> IK -> 干渉 (最高コスト)。各段で短絡。
        if not within_reach(candidate, problem.robot):
            rejected_by_reach += 1
            miss = reach_miss(candidate, problem.robot)
            if reach_nearest_miss is None or miss < reach_nearest_miss:
                reach_nearest_miss = miss
            continue
        if not ik_solvable(candidate, problem.robot, solver):
            rejected_by_ik += 1
            continue
        if not interference_free(candidate, problem.obstacles, checker):
            rejected_by_interference += 1
            continue
        objective_scores = evaluate_objectives(candidate, problem, objective_names)
        total = weighted_sum(objective_scores, weights)
        scored.append((total, candidate.pose, objective_scores))

    # 総合スコア降順で並べ、rank 1.. を振り、上位N件を取る。
    # 同点は生成順 (決定的) を保つため安定ソート + key は score のみ。
    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[: declaration.top_n]

    candidates = [
        PoseCandidate(
            rank=i + 1,
            pose=pose_to_payload(pose),
            score=ScoreBreakdown(
                # 通過した候補なので 3 判定はすべて True (短絡で弾かれた候補は載らない)。
                within_reach=True,
                ik_solvable=True,
                interference_free=True,
                objective_scores=objective_scores,
                total_score=total,
            ),
        )
        for i, (total, pose, objective_scores) in enumerate(top)
    ]
    diagnostics = SearchDiagnostics(
        candidates_generated=generated,
        rejected_by_reach=rejected_by_reach,
        rejected_by_ik=rejected_by_ik,
        rejected_by_interference=rejected_by_interference,
        feasible=len(scored),
        returned=len(candidates),
        reach_nearest_miss=reach_nearest_miss,
    )
    diagnostics_wire = SearchDiagnosticsWire(
        candidates_generated=diagnostics.candidates_generated,
        rejected_by_reach=diagnostics.rejected_by_reach,
        rejected_by_ik=diagnostics.rejected_by_ik,
        rejected_by_interference=diagnostics.rejected_by_interference,
        feasible=diagnostics.feasible,
        returned=diagnostics.returned,
        reach_nearest_miss=diagnostics.reach_nearest_miss,
    )
    return SearchReport(
        response=GraspSearchResponse(candidates=candidates, diagnostics=diagnostics_wire),
        diagnostics=diagnostics,
    )


def search(
    request: GraspSearchRequest,
    *,
    ik_solver: Optional[IkSolver] = None,
    collision_checker: Optional[CollisionChecker] = None,
) -> GraspSearchResponse:
    """契約応答のみが要る呼び出し側の従来入口 (search_report の薄い皮)。"""
    return search_report(
        request, ik_solver=ik_solver, collision_checker=collision_checker
    ).response
