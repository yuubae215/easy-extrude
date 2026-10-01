"""ADR-157 — 干渉を動作の相で問う (core/) の証拠。

GSN: docs/gsn/adr-157-interference-is-asked-per-motion-phase.gsn の葉。

固定する性質:
- 応答は 6 相すべてに行を持ち、評価しなかった相は理由を持って `rejected` を持たない。
- 棄却は最初に当たった相へ帰属し、評価した相の rejected の和 = rejectedByInterference。
- 引き上げで当たる候補は、引き上げを宣言したときだけ棄却される (負の対照: 未宣言では通る)。
  同じ場面でも向きが違えば通る (宣言が判定に効いている)。
- 爪を閉じる掃引が仕切りを通る候補は close 相で棄却される (負の対照: 仕切りが遠ければ通る)。
- 全相分析は答え (候補・ファネル・相の内訳) を 1 ビットも変えない。
- 進入相の判定は、既存の合成チェッカ (線分 + 腕 + 手の形) と同じ答えを返す。
- 被覆表の `unevaluated` セルは宣言された個数ちょうど (ratchet)。
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from contract_pkg import load_response_schema

from easy_extrude_core.api import create_app
from easy_extrude_core.contract import CONTRACT_VERSION, GraspSearchRequest
from easy_extrude_core.engine import DeclarationError, problem_from_declaration, search_report
from easy_extrude_core.engine.candidates import generate_spec_candidates
from easy_extrude_core.engine.feasibility import (
    NaiveHandCollisionChecker,
    NaivePathCollisionChecker,
)
from easy_extrude_core.engine.phases import (
    PHASE_COVERAGE,
    PHASE_ORDER,
    Coverage,
    MotionPhase,
    Part,
    coverage_of,
    phase_hits,
)

# 対象: x 0.10 × y 0.04 × z 0.06 の箱、底面が床 (z=0)。test_grasp_specs.py と同じ。
CENTER = (0.5, 0.0, 0.03)
HALF = (0.05, 0.02, 0.03)
BOX = {"center": list(CENTER), "halfExtents": list(HALF)}
BODY = {"kind": "cylinder", "radius": 0.035, "length": 0.07}
FINGERS = {"length": 0.05, "thickness": 0.008, "width": 0.02}


def _side_samples() -> list[dict]:
    """+x 側面の 3×3 格子 (進入は -x 向き)。"""
    out = []
    for i in (1, 2, 3):
        for j in (1, 2, 3):
            y = CENTER[1] - HALF[1] + 2 * HALF[1] * i / 4
            z = CENTER[2] - HALF[2] + 2 * HALF[2] * j / 4
            out.append({"point": [CENTER[0] + HALF[0], y, z], "normal": [1, 0, 0]})
    return out


def _top_middle_samples() -> list[dict]:
    """上面の中央の列 (x = 箱の中心) — 爪の位置が箱に対して決まる。"""
    return [
        {"point": [CENTER[0], CENTER[1] - HALF[1] + 2 * HALF[1] * j / 4, CENTER[2] + HALF[2]],
         "normal": [0, 0, 1]}
        for j in (1, 2, 3)
    ]


def _declaration(*, target: dict, gripper: dict | None = None, obstacles=None,
                 tool_length: float = 0.10, analysis: str | None = None) -> dict:
    d = {
        "objectiveWeights": {"grasp_stability": 1.0},
        "topN": 100,
        "robot": {"base": [0, 0, 0], "toolLength": tool_length},
        "plan": {"reachMin": 0.0, "reachMax": 2.0, "wristConeHalfAngle": math.pi},
        "target": target,
        "sampling": {"approachTiltAngles": [0.0], "rollAngles": [0.0, math.pi / 2]},
    }
    if gripper is not None:
        d["gripper"] = gripper
    if obstacles is not None:
        d["obstacles"] = obstacles
    if analysis is not None:
        d["interferenceAnalysis"] = analysis
    return d


def _request(**kw) -> GraspSearchRequest:
    return GraspSearchRequest(layout_version="layout/1.0", grasp_search=_declaration(**kw))


def _wire(**kw) -> dict:
    wire = search_report(_request(**kw)).response.model_dump(by_alias=True)
    Draft202012Validator(load_response_schema()).validate(wire)
    return wire


def _phases(wire: dict) -> dict:
    return {row["phase"]: row for row in wire["diagnostics"]["interferencePhases"]}


def _attribution_holds(diag: dict) -> None:
    evaluated = [r for r in diag["interferencePhases"] if r["kind"] == "evaluated"]
    assert sum(r["rejected"] for r in evaluated) == diag["rejectedByInterference"]
    assert [r["phase"] for r in diag["interferencePhases"]] == [p.value for p in PHASE_ORDER]
    for r in diag["interferencePhases"]:
        if r["kind"] == "unevaluated":
            assert "rejected" not in r  # 0 と評価不能は同じ数に見える (ADR-120)


def _overhang() -> dict:
    """対象の真上 2cm に張り出した棚 (厚み 1cm)。横からの進入線分には届かない。"""
    return {"kind": "box", "center": [CENTER[0], 0.0, 0.085], "halfExtents": [0.06, 0.1, 0.005]}


def _divider() -> dict:
    """対象の +x 面から 5mm 離れた薄い仕切り。開いた爪の外、閉じる爪の通り道。"""
    return {"kind": "box", "center": [CENTER[0] + HALF[0] + 0.01, 0.0, 0.025],
            "halfExtents": [0.005, 0.1, 0.025]}


def _jaw(max_opening: float) -> dict:
    return {"kind": "parallelJaw", "maxOpening": max_opening, "fingerClearance": 0.0,
            "body": BODY, "fingers": FINGERS}


# --- 行の形 ---------------------------------------------------------------------


def test_every_phase_has_a_row_and_undeclared_ones_say_why():
    wire = _wire(target={"surfaceSamples": _side_samples()})
    rows = _phases(wire)
    assert rows["approach"] == {"phase": "approach", "kind": "evaluated", "rejected": 0}
    assert rows["close"]["reason"] == "gripperUndeclared"
    assert rows["lift"]["reason"] == "liftUndeclared"
    for p in ("transit", "transport", "place"):
        assert rows[p]["reason"] == "notYetDecided"
    _attribution_holds(wire["diagnostics"])
    assert wire["diagnostics"]["interferenceAnalysis"] == {"kind": "firstCollision"}


def test_close_needs_the_hand_shape_and_the_box_to_be_judged():
    no_shape = _wire(target={"surfaceSamples": _side_samples(), "box": BOX},
                     gripper={"kind": "parallelJaw", "maxOpening": 0.2})
    assert _phases(no_shape)["close"]["reason"] == "handShapeUndeclared"
    no_box = _wire(target={"surfaceSamples": _side_samples()}, gripper=_jaw(0.2))
    assert _phases(no_box)["close"]["reason"] == "targetBoxUndeclared"
    suction = _wire(target={"surfaceSamples": _side_samples()},
                    gripper={"kind": "suction", "cupDiameter": 0.02})
    # 吸引は閉じる相に動く部品を持たない: 評価して常に 0 (理由ではない)。
    assert _phases(suction)["close"] == {"phase": "close", "kind": "evaluated", "rejected": 0}


# --- 引き上げ (D5) --------------------------------------------------------------


def test_a_lift_into_an_overhang_is_rejected_only_when_the_lift_is_declared():
    target = {"surfaceSamples": _side_samples(), "box": BOX}
    undeclared = _wire(target=target, obstacles=[_overhang()])
    assert undeclared["diagnostics"]["feasible"] == 18  # 判定していないので「取れる」
    assert _phases(undeclared)["lift"]["reason"] == "liftUndeclared"

    up = _wire(target={**target, "lift": {"along": "worldUp", "distance": 0.05}}, obstacles=[_overhang()])
    assert up["diagnostics"]["feasible"] == 0
    assert _phases(up)["lift"] == {"phase": "lift", "kind": "evaluated", "rejected": 18}
    assert _phases(up)["approach"]["rejected"] == 0
    _attribution_holds(up["diagnostics"])

    # 同じ場面でも、来た道を戻れば棚の下から抜けられる — 宣言が判定に効いている。
    back = _wire(target={**target, "lift": {"along": "reverseApproach", "distance": 0.05}},
                 obstacles=[_overhang()])
    assert back["diagnostics"]["feasible"] == 18


def test_resting_contact_with_the_floor_is_not_a_lift_collision():
    # 床 (上面 z=0) に面一で置かれた対象を真上に持ち上げる — 静止接触は当たりではない。
    floor = {"kind": "box", "center": [CENTER[0], 0.0, -0.01], "halfExtents": [0.3, 0.3, 0.01]}
    wire = _wire(target={"surfaceSamples": _side_samples(), "box": BOX,
                         "lift": {"along": "worldUp", "distance": 0.05}},
                 obstacles=[floor])
    assert wire["diagnostics"]["feasible"] == 18


def test_a_malformed_lift_is_a_declaration_error_not_a_default():
    for bad in ({"along": "sideways", "distance": 0.05}, {"along": "worldUp", "distance": 0.0},
                {"along": "worldUp"}):
        with pytest.raises(DeclarationError):
            _wire(target={"surfaceSamples": _side_samples(), "box": BOX, "lift": bad})


# --- 爪を閉じる (D4) ------------------------------------------------------------


def test_closing_fingers_that_sweep_through_a_divider_are_rejected_at_close():
    target = {"graspSpecs": [{"id": "x", "samples": _top_middle_samples(), "closingAxis": [1, 0, 0]}],
              "box": BOX}
    # 開口 0.14: 開いた爪の内面は中心から ±0.07 → +x の爪は x ∈ [0.57, 0.578]。仕切りは
    # [0.555, 0.565] なので進入では触れず、対象の面 (0.55) まで閉じる途中で通る。
    wire = _wire(target=target, gripper=_jaw(0.14), obstacles=[_divider()])
    rows = _phases(wire)
    assert rows["approach"]["rejected"] == 0
    assert rows["close"]["rejected"] == wire["diagnostics"]["rejectedByInterference"] > 0
    assert wire["diagnostics"]["feasible"] == 0
    _attribution_holds(wire["diagnostics"])
    # 負の対照: 仕切りが遠ければ閉じても当たらない。
    far = {**_divider(), "center": [CENTER[0] + 0.3, 0.0, 0.025]}
    assert _wire(target=target, gripper=_jaw(0.14), obstacles=[far])["diagnostics"]["feasible"] > 0


# --- 全相分析 (D6) --------------------------------------------------------------


_SCENES = {
    "lift": dict(target={"surfaceSamples": _side_samples(), "box": BOX,
                         "lift": {"along": "worldUp", "distance": 0.05}},
                 obstacles=[_overhang()]),
    "close": dict(target={"graspSpecs": [{"id": "x", "samples": _top_middle_samples(),
                                          "closingAxis": [1, 0, 0]}],
                          "box": BOX, "lift": {"along": "worldUp", "distance": 0.05}},
                  gripper=_jaw(0.14), obstacles=[_divider(), _overhang()]),
}


@pytest.mark.parametrize("name", sorted(_SCENES))
def test_the_analysis_never_changes_the_answer(name):
    first = _wire(**_SCENES[name])
    full = _wire(**_SCENES[name], analysis="allPhases")
    assert full["candidates"] == first["candidates"]
    strip = lambda d: {k: v for k, v in d.items() if k != "interferenceAnalysis"}  # noqa: E731
    assert strip(full["diagnostics"]) == strip(first["diagnostics"])
    assert full["diagnostics"]["interferenceAnalysis"]["kind"] == "allPhases"


def test_the_analysis_names_the_phase_the_part_and_the_obstacle():
    wire = _wire(**_SCENES["close"], analysis="allPhases")
    analysis = wire["diagnostics"]["interferenceAnalysis"]
    by_phase = {p["phase"]: p for p in analysis["phases"]}
    assert [p["phase"] for p in analysis["phases"]] == ["approach", "close", "lift"]
    # 閉じる相で仕切り (添字 0) に手が当たり、しかも同じ候補が引き上げでも棚 (添字 1) に
    # 当たる — 最初の当たりで止める通常の探索からは見えない 2 つ目の事実。
    assert {"part": "hand", "obstacleIndex": 0} in [
        {k: h[k] for k in ("part", "obstacleIndex")} for h in by_phase["close"]["hits"]
    ]
    lift_parts = {(h["part"], h["obstacleIndex"]) for h in by_phase["lift"]["hits"]}
    assert ("held", 1) in lift_parts
    assert by_phase["close"]["collided"] == wire["diagnostics"]["rejectedByInterference"]
    assert by_phase["lift"]["collided"] > 0  # 非排他: close で落ちた候補も lift で数える
    assert analysis["candidatesAnalysed"] >= by_phase["close"]["collided"]


def test_an_unknown_analysis_mode_is_a_declaration_error():
    with pytest.raises(DeclarationError):
        _wire(target={"surfaceSamples": _side_samples()}, analysis="everything")


def test_the_api_round_trips_an_all_phase_analysis_through_the_schema():
    client = TestClient(create_app(), raise_server_exceptions=False)
    body = {"contractVersion": CONTRACT_VERSION, "layoutVersion": "layout/1.0",
            "graspSearch": _declaration(**_SCENES["lift"], analysis="allPhases")}
    resp = client.post("/grasp-search", json=body)
    assert resp.status_code == 200, resp.text
    Draft202012Validator(load_response_schema()).validate(resp.json())
    assert resp.json()["diagnostics"]["interferenceAnalysis"]["kind"] == "allPhases"


# --- 進入相は既存の合成チェッカと同じ答え (§1.1 — 源は 1 つ) ----------------------


def test_the_approach_phase_answers_like_the_composed_checkers():
    wall = {"kind": "box", "center": [CENTER[0] + HALF[0] + 0.01, 0.0, CENTER[2]],
            "halfExtents": [0.005, 0.1, HALF[2]]}
    for opening in (0.08, 0.12):
        req = _request(
            target={"graspSpecs": [{"id": "x", "samples": _top_middle_samples() + _side_samples(),
                                    "closingAxis": [1, 0, 0]}], "box": BOX},
            gripper=_jaw(opening), obstacles=[wall, _overhang()],
        )
        problem = problem_from_declaration(req.grasp_search)
        composed = NaiveHandCollisionChecker(
            inner=NaivePathCollisionChecker(), shape=problem.gripper.shape,
            tool_length=problem.tool_length,
        )
        seen = 0
        for spec in problem.grasp_specs:
            for c in generate_spec_candidates(problem, spec):
                seen += 1
                old = composed.in_collision(c, problem.obstacles)
                new = bool(phase_hits(problem, MotionPhase.APPROACH, c))
                assert old == new
        assert seen > 0


# --- 被覆表 (D1) — 原則 #31 の ratchet ------------------------------------------

#: 動くのに判定していないセルの個数 (DEF-057 / DEF-058)。減らしたら下げ、増やすなら
#: 理由を ADR に書いてから上げる — 超えても下回っても fail させる (ADR-100 と同形)。
UNEVALUATED_CELLS = 12


def test_the_coverage_table_declares_every_phase_and_part():
    for phase in MotionPhase:
        for part in Part:
            assert isinstance(coverage_of(phase, part), Coverage)
    assert set(PHASE_COVERAGE) == set(MotionPhase)


def test_unevaluated_cells_are_counted_exactly():
    n = sum(1 for row in PHASE_COVERAGE.values() for c in row.values() if c is Coverage.UNEVALUATED)
    assert n == UNEVALUATED_CELLS


def test_the_held_body_moves_only_from_lift_on():
    # 携行物の基数は close → lift で 0 → 1 に遷移する (ADR-157 D1)。
    held = [coverage_of(p, Part.HELD) for p in PHASE_ORDER]
    order = [p.value for p in PHASE_ORDER]
    lift = order.index("lift")
    assert all(c is Coverage.NOT_MOVING for c in held[:lift])
    assert all(c is not Coverage.NOT_MOVING for c in held[lift:])


def test_the_approach_phase_answers_like_the_composed_checkers_with_the_arm():
    # 腕を見る合成 (ADR-145) — 宣言された運動学を持つテンプレで、候補ごとに同じ答え。
    import json
    from pathlib import Path

    from easy_extrude_core.engine import generate_candidates
    from easy_extrude_core.engine.feasibility import NaiveArmSweepCollisionChecker
    from easy_extrude_core.engine.phases import ArmModel
    from easy_extrude_core.engine.ur_solver import ik_solver_from_declaration

    raw = json.loads((Path(__file__).resolve().parents[2] / "templates" / "single-arm-pedestal-cell"
                      / "grasp-search.request.json").read_text(encoding="utf-8"))
    req = GraspSearchRequest.model_validate(raw)
    problem = problem_from_declaration(req.grasp_search)
    solver = ik_solver_from_declaration(req.grasp_search.model_dump(by_alias=True))
    composed = NaiveArmSweepCollisionChecker(
        dh=solver.dh, inner=NaivePathCollisionChecker(), tool_length=solver.tool_length,
    )
    arm = ArmModel(dh=solver.dh, tool_length=solver.tool_length)
    seen = hits = 0
    for c in generate_candidates(problem):
        sol = solver.solve(c, problem.robot)
        if sol is None:
            continue
        seen += 1
        old = composed.in_collision(c, problem.obstacles, solution=sol, robot=problem.robot)
        new = bool(phase_hits(problem, MotionPhase.APPROACH, c, solution=sol, arm=arm))
        assert old == new
        hits += old
    assert seen > 0 and hits > 0  # 当たる候補と当たらない候補の両方を比べている
