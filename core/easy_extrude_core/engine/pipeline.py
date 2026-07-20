"""段階0 探索の orchestration (副作用境界)。ADR-075 のパイプラインを ADR-081 で
ドメイン段階 (見える/届く/掴める) に増段した層。

    離散候補生成 -> リーチ -> IK -> 把持性(Grasp) -> 可視性(Vision) -> 干渉(Path)
                 -> 加重和スコア -> 上位N件

段の並びの根拠 (ADR-081 Decision 1 「安い順フィルタの原則を保つ。挿入位置は naive
実装のコスト実測で確定」): naive 実測 (2026-07-20, 障害物 12 / サンプル 5 の
テンプレ規模, 短絡なしの最悪ケースを揃えた 1 call あたり) は

    リーチ ~1µs < IK ~5µs < 把持性 ~9µs < 可視性 ~49µs ≈ 干渉 ~50µs

で、ADR-081 の括弧書き (可視性 naive は線分-球で干渉と同コスト帯 / 把持性 naive は
幅比較 + サンプル対探索) を裏付けた。よって安い順 = 上記の並び。同コスト帯の
可視性と干渉は ADR-081 のドメイン順 (Vision が先) でタイブレークする。棄却段は
短絡により排他なので、並びはファネルの各段への**帰属**を決めるだけで恒等式は不変。
可視性/把持性ゲートは宣言 (camera/gripper) が無ければ判定ごとスキップされるため、
未宣言リクエストのコストと挙動は増段前と不変。実ソルバ差し替え時に再測する (ADR-081)。

この層だけが副作用 (注入されたソルバ/チェッカの呼び出し) を持つ。候補生成・
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
    GraspChecker,
    IkSolver,
    NaiveIkSolver,
    NaiveParallelJawGraspChecker,
    NaiveSightlineVisibilityChecker,
    NaiveSphereCollisionChecker,
    VisibilityChecker,
    interference_free,
    ik_solvable,
    reach_miss,
    within_reach,
)
from .objectives import evaluate_objectives
from .pose_codec import pose_to_payload
from .scoring import weighted_sum
from .types import Camera, Gripper, Obstacle, Pose, Problem, Robot, TargetObject, Vec3


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

    # camera / gripper 宣言 (ADR-081)。open payload の既知キーを寛容に読む。
    # 未宣言 (None) は該当ゲート無効 = 既存挙動 (robot/sampling と同じ規律)。
    camera: Optional[Camera] = None
    camera_raw = data.get("camera")
    if camera_raw:
        view_axis_raw = camera_raw.get("viewAxis")
        fov_raw = camera_raw.get("fovHalfAngle")
        camera = Camera(
            position=_vec3(camera_raw.get("position")),
            view_axis=_vec3(view_axis_raw) if view_axis_raw is not None else None,
            fov_half_angle=float(fov_raw) if fov_raw is not None else None,
        )

    gripper: Optional[Gripper] = None
    gripper_raw = data.get("gripper")
    if gripper_raw:
        gripper = Gripper(
            max_opening=float(gripper_raw.get("maxOpening", 0.0)),
            finger_clearance=float(gripper_raw.get("fingerClearance", 0.0)),
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
        camera=camera,
        gripper=gripper,
    )


# --- 診断 (ADR-079: 判定の証明) -------------------------------------------------


@dataclass(frozen=True)
class SearchDiagnostics:
    """探索 1 回分の棄却ファネル + near-miss (ドメイン型, ADR-079 / ADR-081 で 5 段化)。

    短絡フィルタ (リーチ -> IK -> 把持性 -> 可視性 -> 干渉, 並びの根拠はモジュール
    docstring) なので棄却段は排他に定まり、
    candidates_generated = rejected_by_reach + rejected_by_visibility + rejected_by_ik
    + rejected_by_interference + rejected_by_grasp + feasible が常に成り立つ
    (テストで固定)。camera/gripper 未宣言のリクエストでは該当段の棄却は常に 0。

    載せるのは「ソルバが決定した事実」の集計のみ。演出 (文言/色/メーター) は
    クライアント所有。契約 v4 で wire (契約応答) にも同じ形で露出する (ADR-081)。
    """

    candidates_generated: int
    rejected_by_reach: int
    rejected_by_visibility: int
    rejected_by_ik: int
    rejected_by_interference: int
    rejected_by_grasp: int
    # 5 判定すべて通過した候補数 (= 採点対象)。
    feasible: int
    # 実際に応答へ載せた件数 (= min(feasible, topN))。
    returned: int
    # リーチ棄却候補の到達殻までの最小不足距離。リーチ棄却ゼロなら None。
    reach_nearest_miss: Optional[float]
    # 可視棄却候補の最小遮蔽量 (最も浅く遮られた候補の食い込み深さ)。測定可能な
    # 可視棄却が無ければ None (視野外のみの棄却は遮蔽量では測れない — feasibility)。
    occlusion_nearest_miss: Optional[float]
    # 把持棄却候補の最小開口不足量。測定可能な把持棄却が無ければ None
    # (接触対なしの棄却は幅では測れない — feasibility)。
    opening_nearest_miss: Optional[float]


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
    visibility_checker: Optional[VisibilityChecker] = None,
    grasp_checker: Optional[GraspChecker] = None,
) -> SearchReport:
    """段階0 の把持姿勢探索 + 診断。契約 GraspSearchRequest -> SearchReport。

    ソルバ/チェッカは注入可能 (省略時は naive 既定)。ドメイン段階フィルタ
    (安い順: リーチ -> IK -> 把持性 -> 可視性 -> 干渉, ADR-081) で短絡し、通過した候補だけを
    加重和スコアで採点して rank 昇順の上位N件を返す。棄却ファネルとドメイン別
    near-miss は同一ループで incidental に収集する (二度走らせない, ADR-079)。

    注: contractVersion 検証はエンドポイント層の責務 (ADR-074/002)。ここでは行わない。
    """
    solver = ik_solver if ik_solver is not None else NaiveIkSolver()
    checker = (
        collision_checker
        if collision_checker is not None
        else NaiveSphereCollisionChecker()
    )
    vis_checker = (
        visibility_checker
        if visibility_checker is not None
        else NaiveSightlineVisibilityChecker()
    )
    grip_checker = (
        grasp_checker if grasp_checker is not None else NaiveParallelJawGraspChecker()
    )

    declaration = request.grasp_search
    problem = problem_from_declaration(declaration)
    weights = declaration.objective_weights
    objective_names = list(weights.keys())

    generated = 0
    rejected_by_reach = 0
    rejected_by_visibility = 0
    rejected_by_ik = 0
    rejected_by_interference = 0
    rejected_by_grasp = 0
    reach_nearest_miss: Optional[float] = None
    occlusion_nearest_miss: Optional[float] = None
    opening_nearest_miss: Optional[float] = None

    # 通過候補を (total_score, pose, objective_scores) で集める。
    scored: list[tuple[float, Pose, dict[str, float]]] = []
    for candidate in generate_candidates(problem):
        generated += 1
        # ドメイン段階フィルタ (並びの根拠はモジュール docstring)。各段で短絡するため
        # 棄却段は排他 = ファネル恒等式が成り立つ。
        if not within_reach(candidate, problem.robot):
            rejected_by_reach += 1
            miss = reach_miss(candidate, problem.robot)
            if reach_nearest_miss is None or miss < reach_nearest_miss:
                reach_nearest_miss = miss
            continue
        if not ik_solvable(candidate, problem.robot, solver):
            rejected_by_ik += 1
            continue
        if problem.gripper is not None:
            opening = grip_checker.opening_miss(
                candidate, problem.gripper, problem.target
            )
            if opening > 0.0:
                rejected_by_grasp += 1
                if math.isfinite(opening) and (
                    opening_nearest_miss is None or opening < opening_nearest_miss
                ):
                    opening_nearest_miss = opening
                continue
        if problem.camera is not None:
            occlusion = vis_checker.occlusion_miss(
                candidate, problem.camera, problem.obstacles
            )
            if occlusion > 0.0:
                rejected_by_visibility += 1
                if math.isfinite(occlusion) and (
                    occlusion_nearest_miss is None or occlusion < occlusion_nearest_miss
                ):
                    occlusion_nearest_miss = occlusion
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
                # 通過した候補なので 5 判定はすべて True (短絡で弾かれた候補は載らない)。
                # visible/graspable は該当ゲート未宣言 (camera/gripper なし) なら
                # 空虚に True — どちらだったかはリクエスト宣言の有無から読める
                # (契約 v4 Schema の記述と対応)。
                within_reach=True,
                visible=True,
                ik_solvable=True,
                interference_free=True,
                graspable=True,
                objective_scores=objective_scores,
                total_score=total,
            ),
        )
        for i, (total, pose, objective_scores) in enumerate(top)
    ]
    diagnostics = SearchDiagnostics(
        candidates_generated=generated,
        rejected_by_reach=rejected_by_reach,
        rejected_by_visibility=rejected_by_visibility,
        rejected_by_ik=rejected_by_ik,
        rejected_by_interference=rejected_by_interference,
        rejected_by_grasp=rejected_by_grasp,
        feasible=len(scored),
        returned=len(candidates),
        reach_nearest_miss=reach_nearest_miss,
        occlusion_nearest_miss=occlusion_nearest_miss,
        opening_nearest_miss=opening_nearest_miss,
    )
    diagnostics_wire = SearchDiagnosticsWire(
        candidates_generated=diagnostics.candidates_generated,
        rejected_by_reach=diagnostics.rejected_by_reach,
        rejected_by_visibility=diagnostics.rejected_by_visibility,
        rejected_by_ik=diagnostics.rejected_by_ik,
        rejected_by_interference=diagnostics.rejected_by_interference,
        rejected_by_grasp=diagnostics.rejected_by_grasp,
        feasible=diagnostics.feasible,
        returned=diagnostics.returned,
        reach_nearest_miss=diagnostics.reach_nearest_miss,
        occlusion_nearest_miss=diagnostics.occlusion_nearest_miss,
        opening_nearest_miss=diagnostics.opening_nearest_miss,
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
    visibility_checker: Optional[VisibilityChecker] = None,
    grasp_checker: Optional[GraspChecker] = None,
) -> GraspSearchResponse:
    """契約応答のみが要る呼び出し側の従来入口 (search_report の薄い皮)。"""
    return search_report(
        request,
        ik_solver=ik_solver,
        collision_checker=collision_checker,
        visibility_checker=visibility_checker,
        grasp_checker=grasp_checker,
    ).response
