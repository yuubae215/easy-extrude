"""段階0 判定エンジン (ADR-075) のテスト。

素朴版の規律「動く素朴版 -> テスト」に従い、まず正しい順位・安い順フィルタ・契約準拠を
押さえる。純粋関数 (判定/正規化/スコア) と探索パイプライン (副作用境界) を分けて検証する。
"""

import math

import pytest
from jsonschema import Draft202012Validator

from contract_pkg import load_response_schema

from easy_extrude_core.contract import (
    GraspSearchDeclaration,
    GraspSearchRequest,
)
from easy_extrude_core.engine import (
    GraspCandidate,
    NaiveIkSolver,
    NaiveSphereCollisionChecker,
    NormSpec,
    Obstacle,
    Pose,
    Problem,
    Robot,
    TargetObject,
    Vec3,
    evaluate_objectives,
    generate_candidates,
    ik_solvable,
    interference_free,
    pose_from_payload,
    pose_to_payload,
    problem_from_declaration,
    reach_miss,
    search,
    search_report,
    weighted_sum,
    within_reach,
)


def _candidate_at(position: Vec3, approach: Vec3, normal: Vec3) -> GraspCandidate:
    approach = approach.normalized()
    return GraspCandidate(
        pose=Pose(position=position, approach=approach, roll=0.0),
        pre_grasp=position - approach.scaled(0.1),
        surface_normal=normal.normalized(),
    )


# --- 純粋判定 ----------------------------------------------------------------


def test_within_reach_is_closed_shell():
    robot = Robot(base=Vec3(0, 0, 0), reach_min=0.5, reach_max=1.5)
    inside = _candidate_at(Vec3(1.0, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    too_near = _candidate_at(Vec3(0.4, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    too_far = _candidate_at(Vec3(2.0, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    assert within_reach(inside, robot) is True
    assert within_reach(too_near, robot) is False
    assert within_reach(too_far, robot) is False


def test_naive_ik_respects_wrist_cone():
    # base->把持点 は +x。approach も -x 方向に正対なら可解。直交向きはコーン外なら不可解。
    robot = Robot(
        base=Vec3(0, 0, 0), reach_min=0.5, reach_max=1.5,
        wrist_cone_half_angle=math.radians(30),
    )
    solver = NaiveIkSolver()
    aligned = _candidate_at(Vec3(1.0, 0, 0), Vec3(1, 0, 0), Vec3(-1, 0, 0))
    # to_target=+x, approach=+x -> なす角 0 -> 可解。
    assert ik_solvable(aligned, robot, solver) is True
    sideways = _candidate_at(Vec3(1.0, 0, 0), Vec3(0, 1, 0), Vec3(-1, 0, 0))
    # なす角 90deg > 30deg -> 不可解。
    assert ik_solvable(sideways, robot, solver) is False


def test_naive_collision_blocks_approach_path():
    checker = NaiveSphereCollisionChecker()
    # 把持点 (1,0,0)、プリグラスプ (0.5,0,0)。経路上 (0.7,0,0) に半径0.1の球 -> 衝突。
    blocked = GraspCandidate(
        pose=Pose(position=Vec3(1.0, 0, 0), approach=Vec3(1, 0, 0), roll=0.0),
        pre_grasp=Vec3(0.5, 0, 0),
        surface_normal=Vec3(-1, 0, 0),
    )
    near = (Obstacle(center=Vec3(0.7, 0.0, 0.0), radius=0.1),)
    far = (Obstacle(center=Vec3(0.7, 5.0, 0.0), radius=0.1),)
    assert interference_free(blocked, near, checker) is False
    assert interference_free(blocked, far, checker) is True


# --- objective 正規化 / スコア ------------------------------------------------


def test_normspec_clamps_to_unit_interval():
    spec = NormSpec(lo=0.0, hi=2.0)
    assert spec.normalize(-1.0) == 0.0
    assert spec.normalize(1.0) == 0.5
    assert spec.normalize(3.0) == 1.0
    # 退化 (lo>=hi) はゼロ割りせず 0。
    assert NormSpec(lo=1.0, hi=1.0).normalize(0.5) == 0.0


def test_grasp_stability_objective_is_one_when_head_on():
    problem = Problem(
        robot=Robot(base=Vec3(0, 0, 0), reach_min=0.0, reach_max=10.0),
        target=TargetObject(surface_samples=()),
    )
    # approach が法線の逆向きに正対 -> 安定度 1。
    head_on = _candidate_at(Vec3(1, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    scores = evaluate_objectives(head_on, problem, ["grasp_stability"])
    assert math.isclose(scores["grasp_stability"], 1.0, abs_tol=1e-9)
    # 背いた進入 -> 0 にクランプ。
    backwards = _candidate_at(Vec3(1, 0, 0), Vec3(1, 0, 0), Vec3(1, 0, 0))
    scores_b = evaluate_objectives(backwards, problem, ["grasp_stability"])
    assert scores_b["grasp_stability"] == 0.0


def test_evaluate_objectives_ignores_unknown_names():
    problem = Problem(
        robot=Robot(base=Vec3(0, 0, 0), reach_min=0.0, reach_max=10.0),
        target=TargetObject(surface_samples=()),
    )
    cand = _candidate_at(Vec3(1, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    scores = evaluate_objectives(problem=problem, candidate=cand, names=["nonexistent"])
    assert scores == {}


def test_weighted_sum_is_normalized_average():
    scores = {"a": 1.0, "b": 0.0}
    weights = {"a": 3.0, "b": 1.0}
    # (3*1 + 1*0) / (3+1) = 0.75
    assert math.isclose(weighted_sum(scores, weights), 0.75)
    # 重み総和 0 はゼロ割りせず 0。
    assert weighted_sum(scores, {}) == 0.0


# --- 候補生成 ----------------------------------------------------------------


def test_generate_candidates_is_deterministic_product():
    problem = Problem(
        robot=Robot(base=Vec3(0, 0, 0), reach_min=0.0, reach_max=10.0),
        target=TargetObject(
            surface_samples=(
                (Vec3(1, 0, 0), Vec3(1, 0, 0)),
                (Vec3(0, 1, 0), Vec3(0, 1, 0)),
            )
        ),
        approach_tilt_angles=(0.0, math.radians(10)),
        roll_angles=(0.0, math.pi),
    )
    cands = list(generate_candidates(problem))
    # 2 サンプル x 2 傾け x 2 ロール = 8 候補。
    assert len(cands) == 8
    # 決定的順序: 2 回呼んでも同じ位置列。
    again = [c.pose.position for c in generate_candidates(problem)]
    assert [c.pose.position for c in cands] == again


# --- パイプライン (副作用境界) + 契約準拠 ------------------------------------


def _declaration_dict() -> dict:
    # 円弧状に並べた表面サンプル。base からの距離はすべて 1.0 (到達域内)。
    samples = []
    for deg in (0, 30, 60, 90):
        a = math.radians(deg)
        x, y = math.cos(a), math.sin(a)
        samples.append({"point": [x, y, 0.0], "normal": [x, y, 0.0]})
    return {
        "robot": {
            "base": [0.0, 0.0, 0.0],
            "reachMin": 0.5,
            "reachMax": 1.5,
            "wristConeHalfAngle": math.pi,
        },
        "target": {"surfaceSamples": samples},
        "obstacles": [],
        "sampling": {
            "approachTiltAngles": [0.0],
            "rollAngles": [0.0],
            "preGraspDistance": 0.2,
            "clearanceReference": 0.2,
        },
        "objectiveWeights": {"grasp_stability": 1.0, "reach_margin": 0.5},
        "topN": 2,
    }


def _build_request(decl: dict) -> GraspSearchRequest:
    return GraspSearchRequest(
        layout_version="layout/1.0",
        grasp_search=GraspSearchDeclaration.model_validate(decl),
    )


def test_search_returns_ranked_top_n_conforming_to_contract():
    req = _build_request(_declaration_dict())
    resp = search(req)

    # topN=2 を尊重。
    assert len(resp.candidates) == 2
    # rank は 1 から昇順。
    assert [c.rank for c in resp.candidates] == [1, 2]
    # total_score は降順 (1 位が最良)。
    scores = [c.score.total_score for c in resp.candidates]
    assert scores[0] >= scores[1]
    # 通過候補なので 3 判定はすべて True。
    for c in resp.candidates:
        assert c.score.within_reach and c.score.ik_solvable and c.score.interference_free
        assert 0.0 <= c.score.total_score <= 1.0

    # 契約 (中立 JSON Schema) に wire 形が準拠すること。
    Draft202012Validator(load_response_schema()).validate(resp.model_dump(by_alias=True))


def test_search_excludes_out_of_reach_and_blocked_candidates():
    decl = _declaration_dict()
    # 全サンプルを到達域外 (遠すぎ) にする -> 通過 0 件。
    far = {**decl, "robot": {**decl["robot"], "reachMin": 5.0, "reachMax": 6.0}}
    assert search(_build_request(far)).candidates == []

    # 1 番目のサンプル (deg=0, 点(1,0,0)) の進入経路を塞ぐ球を置く。
    blocked = {
        **decl,
        "obstacles": [{"center": [0.9, 0.0, 0.0], "radius": 0.15}],
        "topN": 10,
    }
    resp = search(_build_request(blocked))
    # (1,0,0) は除外されるので、その点を 1 位に含まない。
    positions = [tuple(c.pose["frame"]["position"]) for c in resp.candidates]
    assert (1.0, 0.0, 0.0) not in positions
    # 他の到達可能な候補は残る。
    assert len(resp.candidates) >= 1


# --- 診断 (ADR-079: 判定の証明 = 棄却ファネル + near-miss) --------------------


def test_reach_miss_measures_shortfall_to_shell():
    robot = Robot(base=Vec3(0, 0, 0), reach_min=0.5, reach_max=1.5)
    inside = _candidate_at(Vec3(1.0, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    too_near = _candidate_at(Vec3(0.3, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    too_far = _candidate_at(Vec3(2.0, 0, 0), Vec3(-1, 0, 0), Vec3(1, 0, 0))
    assert reach_miss(inside, robot) == 0.0
    assert math.isclose(reach_miss(too_near, robot), 0.2)
    assert math.isclose(reach_miss(too_far, robot), 0.5)


def test_search_report_funnel_partitions_generated():
    # 障害物 1 個で deg=0 候補だけ干渉棄却されるシナリオ。棄却段は排他なので
    # 「各段の棄却数 + 生存数 = 生成数」が常に成り立つ (SearchDiagnostics の不変条件)。
    decl = _declaration_dict()
    blocked = {
        **decl,
        "obstacles": [{"center": [0.9, 0.0, 0.0], "radius": 0.15}],
        "topN": 10,
    }
    report = search_report(_build_request(blocked))
    d = report.diagnostics
    assert d.candidates_generated == 4
    total_rejected = d.rejected_by_reach + d.rejected_by_ik + d.rejected_by_interference
    assert total_rejected + d.feasible == d.candidates_generated
    assert d.rejected_by_interference == 1
    # topN=10 >= 生存数なので全生存候補が応答に載る。
    assert d.returned == len(report.response.candidates) == d.feasible == 3
    # リーチ棄却が無ければ near-miss は None。
    assert d.rejected_by_reach == 0
    assert d.reach_nearest_miss is None


def test_search_report_zero_candidates_explains_reach():
    # 全サンプル (base から距離 1.0) を到達域 [5,6] の外にする -> 候補ゼロだが
    # 診断が「全部リーチ棄却 / あと 4.0 で届く」を語れる。
    decl = _declaration_dict()
    far = {**decl, "robot": {**decl["robot"], "reachMin": 5.0, "reachMax": 6.0}}
    report = search_report(_build_request(far))
    d = report.diagnostics
    assert report.response.candidates == []
    assert d.candidates_generated == 4
    assert d.rejected_by_reach == 4
    assert d.feasible == 0 and d.returned == 0
    assert d.reach_nearest_miss is not None
    assert math.isclose(d.reach_nearest_miss, 4.0)


def test_search_report_counts_ik_rejections():
    # 円弧サンプルの正対進入は base->把持点 と approach が逆向き (なす角 pi) なので、
    # 手首コーンを pi/2 に絞ると全候補が IK 段で落ちる。
    decl = _declaration_dict()
    narrow = {**decl, "robot": {**decl["robot"], "wristConeHalfAngle": math.pi / 2}}
    d = search_report(_build_request(narrow)).diagnostics
    assert d.candidates_generated == 4
    assert d.rejected_by_ik == 4
    assert d.feasible == 0


def test_search_report_empty_target_yields_empty_funnel():
    # 表面サンプル無し -> 生成 0。UI は「対象が空」をファネルで区別できる。
    decl = _declaration_dict()
    empty = {**decl, "target": {"surfaceSamples": []}}
    d = search_report(_build_request(empty)).diagnostics
    assert d.candidates_generated == 0
    assert d.rejected_by_reach == d.rejected_by_ik == d.rejected_by_interference == 0
    assert d.feasible == 0 and d.returned == 0
    assert d.reach_nearest_miss is None


def test_search_is_search_report_response():
    # search は search_report の薄い皮 = 契約応答は完全一致 (wire 無変更の証拠)。
    req = _build_request(_declaration_dict())
    assert search(req) == search_report(req).response


def test_problem_from_declaration_reads_wire_keys():
    decl = GraspSearchDeclaration.model_validate(_declaration_dict())
    problem = problem_from_declaration(decl)
    assert problem.robot.reach_min == 0.5
    assert problem.robot.reach_max == 1.5
    assert len(problem.target.surface_samples) == 4
    assert problem.pre_grasp_distance == 0.2


def test_pose_payload_round_trips():
    # 契約 v2: pose は endEffector 枝の kind 判別 union。approach=-Z / roll を四元数へ
    # 写して戻す。四元数往復は fp 誤差を伴うので近似で照合する (position は素通しで厳密)。
    pose = Pose(position=Vec3(1, 2, 3), approach=Vec3(0, 0, 1), roll=0.5)
    payload = pose_to_payload(pose)
    assert payload["kind"] == "endEffector"
    assert len(payload["frame"]["orientation"]) == 4  # 四元数 x,y,z,w
    back = pose_from_payload(payload)
    assert back.position == pose.position
    assert back.approach.as_list() == pytest.approx(pose.approach.as_list(), abs=1e-9)
    assert back.roll == pytest.approx(pose.roll, abs=1e-9)


def test_pose_payload_rejects_non_end_effector_kind():
    # jointSpace は段階0 ドメイン Pose に対応物が無いので曖昧に処理せず拒否 (ADR-074)。
    with pytest.raises(ValueError):
        pose_from_payload({"kind": "jointSpace", "chainRef": "r", "joints": [0.0]})


def test_injected_solver_overrides_naive():
    # 常に解けないソルバを注入 -> 通過 0 件 (注入境界が効くことの確認)。
    class _NeverSolver:
        def solve(self, candidate, robot):
            return None

    req = _build_request(_declaration_dict())
    resp = search(req, ik_solver=_NeverSolver())
    assert resp.candidates == []
