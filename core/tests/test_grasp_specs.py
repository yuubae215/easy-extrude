"""ADR-152 D5 — 把持仕様・把持戦略・手の形の判定 (core/) の証拠。

GSN: docs/gsn/adr-152-how-to-grasp-and-what-grasps-are-declarations-and-each-is-seen.gsn
の `HowToGraspIsJudgedRight` / `TheHandDrawnIsTheHandJudged` の葉。

固定する性質:
- 閉じ軸を宣言すると幅は対象 box の閉じ方向の厚み (進入面の広がりと違う数で焼く)。
- 深さがパームを越えれば把持性で棄却。
- priority と score で返る候補の集合が違い、診断は全仕様ぶん。
- 宣言した爪がトレーの壁を貫通する候補は棄却 (負の対照: 形なしでは通る)。
- 何も絞らない仕様は、同じサンプルの surfaceSamples と同じ答え (旧 faces 移行の根拠)。
- 取付けと形の矛盾は宣言の誤り (400)。
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from contract_pkg import load_response_schema

from easy_extrude_core.api import create_app
from easy_extrude_core.contract import CONTRACT_VERSION, GraspSearchRequest
from easy_extrude_core.engine import (
    DeclarationError,
    Vec3,
    frame_axes,
    generate_candidates,
    pose_from_payload,
    problem_from_declaration,
    search_report,
)
from easy_extrude_core.engine.candidates import generate_spec_candidates, tilts_within

# 対象: x 0.10 × y 0.04 × z 0.06 の箱、底面が床 (z=0)。
CENTER = (0.5, 0.0, 0.03)
HALF = (0.05, 0.02, 0.03)


def _top_samples() -> list[dict]:
    """上面 (+z) の 3×3 格子 — フロントの i/4 格子と同じ位置。"""
    out = []
    for i in (1, 2, 3):
        for j in (1, 2, 3):
            x = CENTER[0] - HALF[0] + 2 * HALF[0] * i / 4
            y = CENTER[1] - HALF[1] + 2 * HALF[1] * j / 4
            out.append({"point": [x, y, CENTER[2] + HALF[2]], "normal": [0, 0, 1]})
    return out


def _side_samples() -> list[dict]:
    """+x 側面の 3×3 格子。"""
    out = []
    for i in (1, 2, 3):
        for j in (1, 2, 3):
            y = CENTER[1] - HALF[1] + 2 * HALF[1] * i / 4
            z = CENTER[2] - HALF[2] + 2 * HALF[2] * j / 4
            out.append({"point": [CENTER[0] + HALF[0], y, z], "normal": [1, 0, 0]})
    return out


BOX = {"center": list(CENTER), "halfExtents": list(HALF)}
BODY = {"kind": "cylinder", "radius": 0.035, "length": 0.07}
FINGERS = {"length": 0.05, "thickness": 0.008, "width": 0.02}


def _declaration(*, target: dict, gripper: dict | None = None, obstacles=None,
                 tool_length: float = 0.10, top_n: int = 100, sampling=None) -> dict:
    d = {
        "objectiveWeights": {"grasp_stability": 1.0},
        "topN": top_n,
        "robot": {"base": [0, 0, 0], "toolLength": tool_length},
        "plan": {"reachMin": 0.0, "reachMax": 2.0, "wristConeHalfAngle": math.pi},
        "target": target,
        "sampling": sampling or {"approachTiltAngles": [0.0], "rollAngles": [0.0, math.pi / 2]},
    }
    if gripper is not None:
        d["gripper"] = gripper
    if obstacles is not None:
        d["obstacles"] = obstacles
    return d


def _run(**kw):
    req = GraspSearchRequest(layout_version="layout/1.0", grasp_search=_declaration(**kw))
    return search_report(req)


def _wire(report) -> dict:
    wire = report.response.model_dump(by_alias=True)
    Draft202012Validator(load_response_schema()).validate(wire)
    return wire


def _jaw(max_opening: float, shape: bool = False) -> dict:
    g = {"kind": "parallelJaw", "maxOpening": max_opening, "fingerClearance": 0.0}
    if shape:
        g["body"] = BODY
        g["fingers"] = FINGERS
    return g


def _funnel_holds(diag: dict) -> None:
    assert diag["candidatesGenerated"] == (
        diag["rejectedByReach"] + diag["rejectedByVisibility"] + diag["rejectedByIk"]
        + diag["rejectedByInterference"] + diag["rejectedByGrasp"] + diag["feasible"]
    )


# --- 候補生成 -------------------------------------------------------------------


def test_closing_axis_fixes_the_roll_to_two_that_put_flange_x_on_it():
    problem = problem_from_declaration(GraspSearchRequest(
        layout_version="layout/1.0",
        grasp_search=_declaration(target={"graspSpecs": [
            {"id": "pinch", "samples": _top_samples(), "closingAxis": [0, 1, 0]},
        ]}),
    ).grasp_search)
    cands = list(generate_spec_candidates(problem, problem.grasp_specs[0]))
    assert len(cands) == 9 * 2  # 9 サンプル × (r, r+π) — sampling のロールは使わない
    for c in cands:
        x, _y, _z = frame_axes(c.pose)
        assert abs(abs(x.y) - 1.0) < 1e-9
        assert c.spec_id == "pinch"


def test_depth_moves_the_tcp_into_the_part_but_the_pregrasp_stays_outside():
    problem = problem_from_declaration(GraspSearchRequest(
        layout_version="layout/1.0",
        grasp_search=_declaration(target={"graspSpecs": [
            {"id": "deep", "samples": _top_samples()[:1], "depth": 0.02},
        ]}),
    ).grasp_search)
    c = next(generate_spec_candidates(problem, problem.grasp_specs[0]))
    top = CENTER[2] + HALF[2]
    assert c.pose.position.z == pytest.approx(top - 0.02)
    assert c.pre_grasp.z == pytest.approx(top + problem.pre_grasp_distance)


def test_tilt_tolerance_keeps_only_the_tilts_inside_it_and_never_empties():
    assert tilts_within((0.0, 0.3, 0.6), 0.35) == (0.0, 0.3)
    assert tilts_within((0.3, 0.6), 0.1) == (0.0,)
    assert tilts_within((0.0, 0.3), None) == (0.0, 0.3)


# --- 把持幅 (§2 を宣言のある所から正す) ---------------------------------------


def test_declared_closing_axis_measures_the_box_thickness_not_the_face_spread():
    # 上から降りて x で閉じる。箱の x 厚み 0.10 > 開口 0.08 → 掴めない。
    # 同じ上面を閉じ軸なしで宣言すると、上面の格子の x 広がり (0.05) を幅と読んで
    # 通ってしまう — ADR-152 §2 の読み違いそのもの (負の対照)。
    across_x = _wire(_run(
        target={"graspSpecs": [{"id": "x", "samples": _top_samples(), "closingAxis": [1, 0, 0]}], "box": BOX},
        gripper=_jaw(0.08),
    ))
    assert across_x["diagnostics"]["feasible"] == 0
    assert across_x["diagnostics"]["graspNearestMiss"] == {"kind": "opening", "shortfall": pytest.approx(0.02)}

    across_y = _wire(_run(
        target={"graspSpecs": [{"id": "y", "samples": _top_samples(), "closingAxis": [0, 1, 0]}], "box": BOX},
        gripper=_jaw(0.08),
    ))
    assert across_y["diagnostics"]["feasible"] == 18

    undeclared = _wire(_run(
        target={"graspSpecs": [{"id": "top", "samples": _top_samples()}], "box": BOX},
        gripper=_jaw(0.08),
    ))
    assert undeclared["diagnostics"]["feasible"] > 0  # 進入面の広がりで測るので通る


# --- 深さのゲート ---------------------------------------------------------------


def test_depth_past_the_palm_is_rejected_by_grasp():
    # toolLength 0.10 − 筐体 0.07 = TCP からパームまで 0.03。
    ok = _wire(_run(
        target={"graspSpecs": [{"id": "d", "samples": _top_samples(), "closingAxis": [0, 1, 0], "depth": 0.02}], "box": BOX},
        gripper=_jaw(0.08, shape=True),
    ))
    assert ok["diagnostics"]["feasible"] == 18
    too_deep = _wire(_run(
        target={"graspSpecs": [{"id": "d", "samples": _top_samples(), "closingAxis": [0, 1, 0], "depth": 0.04}], "box": BOX},
        gripper=_jaw(0.08, shape=True),
    ))
    assert too_deep["diagnostics"]["feasible"] == 0
    assert too_deep["diagnostics"]["rejectedByGrasp"] == 18
    _funnel_holds(too_deep["diagnostics"])


# --- 戦略 -------------------------------------------------------------------


def _two_specs(first_closes: list[float]) -> list[dict]:
    return [
        {"id": "top", "samples": _top_samples(), "closingAxis": first_closes},
        {"id": "side", "samples": _side_samples(), "closingAxis": [0, 1, 0]},
    ]


def test_priority_returns_only_the_first_spec_with_a_feasible_candidate():
    wire = _wire(_run(
        target={"graspSpecs": _two_specs([0, 1, 0]), "strategy": {"order": "priority", "fallback": "none"}, "box": BOX},
        gripper=_jaw(0.08),
    ))
    ids = {c["graspSpecId"] for c in wire["candidates"]}
    assert ids == {"top"}
    rows = wire["diagnostics"]["graspSpecs"]
    assert [r["id"] for r in rows] == ["top", "side"]
    # 返さなかった仕様も数える (原則 #31): side にも通過候補が在る。
    assert rows[1]["feasible"] > 0
    assert wire["diagnostics"]["feasible"] == rows[0]["feasible"] + rows[1]["feasible"]
    _funnel_holds(wire["diagnostics"])


def test_priority_falls_through_to_the_next_spec_when_the_first_has_none():
    wire = _wire(_run(
        target={"graspSpecs": _two_specs([1, 0, 0]), "strategy": {"order": "priority", "fallback": "none"}, "box": BOX},
        gripper=_jaw(0.08),
    ))
    assert {c["graspSpecId"] for c in wire["candidates"]} == {"side"}
    assert wire["diagnostics"]["graspSpecs"][0] == {"id": "top", "candidatesGenerated": 18, "feasible": 0}


def test_score_mixes_every_spec():
    wire = _wire(_run(
        target={"graspSpecs": _two_specs([0, 1, 0]), "strategy": {"order": "score", "fallback": "none"}, "box": BOX},
        gripper=_jaw(0.08),
    ))
    assert {c["graspSpecId"] for c in wire["candidates"]} == {"top", "side"}
    scores = [c["score"]["totalScore"] for c in wire["candidates"]]
    assert scores == sorted(scores, reverse=True)


def test_fallback_derived_searches_the_surface_samples_only_when_no_spec_is_feasible():
    target = {
        "graspSpecs": [{"id": "x", "samples": _top_samples(), "closingAxis": [1, 0, 0]}],
        "box": BOX,
        "surfaceSamples": _side_samples(),
    }
    none = _wire(_run(target={**target, "strategy": {"order": "priority", "fallback": "none"}}, gripper=_jaw(0.08)))
    assert none["candidates"] == []
    derived = _wire(_run(target={**target, "strategy": {"order": "priority", "fallback": "derived"}}, gripper=_jaw(0.08)))
    assert derived["candidates"]
    assert {c["graspSpecId"] for c in derived["candidates"]} == {None}
    _funnel_holds(derived["diagnostics"])


def test_no_specs_means_an_empty_spec_table_and_null_spec_ids():
    wire = _wire(_run(target={"surfaceSamples": _top_samples()}, gripper=_jaw(0.08)))
    assert wire["diagnostics"]["graspSpecs"] == []
    assert {c["graspSpecId"] for c in wire["candidates"]} == {None}


# --- 旧 faces の移行は答えを動かさない ----------------------------------------


def test_an_unnarrowed_spec_answers_exactly_like_the_same_surface_samples():
    samples = _top_samples() + [
        {**s, "point": [s["point"][0], s["point"][1], CENTER[2] - HALF[2]], "normal": [0, 0, -1]}
        for s in _top_samples()
    ]
    legacy = _wire(_run(target={"surfaceSamples": samples}, gripper=_jaw(0.08), top_n=5))
    migrated = _wire(_run(
        target={
            "graspSpecs": [
                {"id": "+z", "samples": samples[:9]},
                {"id": "-z", "samples": samples[9:]},
            ],
            "strategy": {"order": "score", "fallback": "none"},
        },
        gripper=_jaw(0.08), top_n=5,
    ))
    strip = lambda w: [{k: v for k, v in c.items() if k != "graspSpecId"} for c in w["candidates"]]
    assert strip(migrated) == strip(legacy)
    for key in ("candidatesGenerated", "rejectedByGrasp", "feasible", "returned", "graspNearestMiss"):
        assert migrated["diagnostics"][key] == legacy["diagnostics"][key]


# --- 手の形の干渉 -----------------------------------------------------------


def _tray_wall() -> dict:
    """対象の +x 側 5mm に立つ壁 (厚み 1cm、対象と同じ高さ)。"""
    return {
        "kind": "box",
        "center": [CENTER[0] + HALF[0] + 0.01, 0.0, CENTER[2]],
        "halfExtents": [0.005, 0.1, HALF[2]],
    }


def test_a_finger_through_the_tray_wall_is_rejected_but_only_when_the_shape_is_declared():
    # 上面の中央の列 (x = 箱の中心) だけ — 爪は TCP の両脇に開くので、TCP を箱の
    # 中心線に置くと爪の位置が箱に対して決まる。
    middle = [s for s in _top_samples() if abs(s["point"][0] - CENTER[0]) < 1e-9]
    target = {
        "graspSpecs": [{"id": "x", "samples": middle, "closingAxis": [1, 0, 0], "depth": 0.02}],
        "box": BOX,
    }
    # 開口 0.12: 爪の内面は中心から ±0.06 → +x の爪は x ∈ [0.56, 0.568]、壁は [0.555, 0.565]。
    with_shape = _wire(_run(target=target, gripper=_jaw(0.12, shape=True), obstacles=[_tray_wall()]))
    assert with_shape["diagnostics"]["feasible"] == 0
    assert with_shape["diagnostics"]["rejectedByInterference"] == 6
    # 負の対照: 形なし = 進入線分だけ。線分は箱の中心線を降り、壁に届かない。
    without_shape = _wire(_run(target=target, gripper=_jaw(0.12), obstacles=[_tray_wall()]))
    assert without_shape["diagnostics"]["feasible"] == 6


def test_the_hand_clears_a_wall_it_does_not_reach():
    target = {"graspSpecs": [{"id": "y", "samples": _top_samples(), "closingAxis": [0, 1, 0]}], "box": BOX}
    far_wall = {**_tray_wall(), "center": [CENTER[0] + 0.3, 0.0, CENTER[2]]}
    wire = _wire(_run(target=target, gripper=_jaw(0.08, shape=True), obstacles=[far_wall]))
    assert wire["diagnostics"]["feasible"] == 18


def test_suction_cup_shape_is_placed_and_judged():
    target = {"graspSpecs": [{"id": "suck", "samples": _top_samples()}], "box": BOX}
    gripper = {"kind": "suction", "cupDiameter": 0.02, "body": BODY, "cupHeight": 0.03}
    # 筐体 (半径 0.035 の外接箱) は上面より上。上面の高さに壁が迫っても、壁の上端より
    # 上に在る筐体は当たらない。
    wire = _wire(_run(target=target, gripper=gripper, tool_length=0.10))
    assert wire["diagnostics"]["feasible"] > 0


# --- 取付けと形の矛盾は宣言の誤り --------------------------------------------


def test_a_mount_outside_the_fingers_is_a_declaration_error():
    target = {"surfaceSamples": _top_samples()}
    with pytest.raises(DeclarationError):
        _run(target=target, gripper=_jaw(0.08, shape=True), tool_length=0.15)  # 爪先 0.12 より遠い
    with pytest.raises(DeclarationError):
        _run(target=target, gripper=_jaw(0.08, shape=True), tool_length=0.05)  # 筐体の中
    with pytest.raises(DeclarationError):
        _run(target=target, gripper={"kind": "suction", "cupDiameter": 0.02, "body": BODY, "cupHeight": 0.03},
             tool_length=0.11)  # カップ面は 0.10


def test_the_api_answers_a_declaration_error_with_400_and_the_reason():
    client = TestClient(create_app(), raise_server_exceptions=False)
    body = {
        "contractVersion": CONTRACT_VERSION,
        "layoutVersion": "layout/1.0",
        "graspSearch": _declaration(target={"surfaceSamples": _top_samples()},
                                    gripper=_jaw(0.08, shape=True), tool_length=0.15),
    }
    resp = client.post("/grasp-search", json=body)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_declaration"
    assert "toolLength" in resp.json()["error"]["message"]


def test_duplicate_spec_ids_are_a_declaration_error():
    with pytest.raises(DeclarationError):
        _run(target={"graspSpecs": [
            {"id": "a", "samples": _top_samples()},
            {"id": "a", "samples": _side_samples()},
        ]})


def test_roll_round_trips_through_the_pose_codec():
    # 閉じ軸で決めたロールが pose_codec の gauge と同じもの (ワイヤを往復しても x は同じ軸)。
    wire = _wire(_run(
        target={"graspSpecs": [{"id": "y", "samples": _top_samples()[:1], "closingAxis": [0, 1, 0]}], "box": BOX},
    ))
    for c in wire["candidates"]:
        x, _y, _z = frame_axes(pose_from_payload(c["pose"]))
        assert abs(abs(x.y) - 1.0) < 1e-9


def test_generate_candidates_is_unchanged_for_the_derived_samples():
    problem = problem_from_declaration(GraspSearchRequest(
        layout_version="layout/1.0",
        grasp_search=_declaration(target={"surfaceSamples": _top_samples()}),
    ).grasp_search)
    assert all(c.spec_id is None and c.depth == 0.0 for c in generate_candidates(problem))
    assert Vec3(0, 0, 0).norm() == 0
