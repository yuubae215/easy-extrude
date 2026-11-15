"""ADR-172: 段・出どころの行・フォールバックのリスクを 1 つの語彙で数える。

2026-11-11 に実測した欠陥を焼く:
- 仕様が全滅して導出へ戻った探索で、仕様の行の和が 4 / 生成 40 だった (導出の 36 件に行が無い)。
- カメラが無いのに「見える 100%」— 問うていない段が 0 と区別できなかった。
- 可視性に届いた 6 件を全部落としても「83% 見える」— 分母が生成した全数だった。
"""

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from contract_pkg import load_response_schema, rejected_at, stage_of
from easy_extrude_core.contract import GraspSearchRequest
from easy_extrude_core.engine.pipeline import search_report
from easy_extrude_core.engine.stages import (
    DomainRisk,
    MissMeasured,
    MissQuantity,
    NotAskedReason,
    RiskDomain,
    RiskReason,
    SourceTally,
    Stage,
    StageJudged,
    StageNotAsked,
    TogetherRisk,
    UnmeasurableReason,
    fallback_risks,
    merged,
    stage_verdicts,
)

_PEDESTAL = Path(__file__).resolve().parents[2] / "templates" / "single-arm-pedestal-cell" / "grasp-search.request.json"


def _wire(raw: dict) -> dict:
    wire = search_report(GraspSearchRequest.model_validate(raw)).response.model_dump(by_alias=True)
    Draft202012Validator(load_response_schema()).validate(wire)
    return wire


def _pedestal() -> dict:
    return json.loads(_PEDESTAL.read_text(encoding="utf-8"))


def _partitions(d: dict) -> None:
    rows = d["bySource"]
    assert sum(r["candidatesGenerated"] for r in rows) == d["candidatesGenerated"]
    assert sum(r["feasible"] for r in rows) == d["feasible"]
    for i, v in enumerate(d["stages"]):
        assert all(r["stages"][i]["stage"] == v["stage"] for r in rows)
        if v["kind"] == "judged":
            assert sum(r["stages"][i]["rejected"] for r in rows) == v["rejected"], v["stage"]


def test_a_derived_fallback_gets_its_own_row_and_the_rows_add_up_to_the_whole():
    """生成 40 / 仕様の行の和 4 — 2026-11-11 に実測した欠陥 (DEF-048 を閉じる)。"""
    raw = _pedestal()
    raw["graspSearch"]["target"]["graspSpecs"] = [{"id": "impossible", "samples": [{"point": [9, 9, 9], "normal": [0, 0, 1]}]}]
    raw["graspSearch"]["target"]["strategy"] = {"order": "priority", "fallback": "derived"}
    d = _wire(raw)["diagnostics"]
    assert d["candidatesGenerated"] == 40
    assert [r["source"] for r in d["bySource"]] == [{"kind": "spec", "id": "impossible"}, {"kind": "derived"}]
    spec, derived = d["bySource"]
    assert (spec["candidatesGenerated"], spec["feasible"]) == (4, 0)
    assert (derived["candidatesGenerated"], derived["feasible"]) == (36, 36)
    assert rejected_at(spec, "reach") == 4  # 届かない点の仕様は、リーチで全部落ちる
    _partitions(d)


def test_every_declared_spec_has_a_row_even_one_that_generated_nothing_and_no_derived_row_without_derived_candidates():
    raw = _pedestal()
    samples = raw["graspSearch"]["target"]["surfaceSamples"]
    raw["graspSearch"]["target"]["graspSpecs"] = [{"id": "a", "samples": samples[:1]}, {"id": "b", "samples": samples[1:2]}]
    raw["graspSearch"]["target"]["strategy"] = {"order": "priority", "fallback": "none"}
    d = _wire(raw)["diagnostics"]
    assert [r["source"] for r in d["bySource"]] == [{"kind": "spec", "id": "a"}, {"kind": "spec", "id": "b"}]
    _partitions(d)


def test_a_stage_nobody_asked_is_not_asked_and_carries_no_counts():
    raw = _pedestal()
    raw["graspSearch"].pop("camera", None)
    raw["graspSearch"].pop("gripper", None)
    d = _wire(raw)["diagnostics"]
    assert stage_of(d, "visibility") == {"stage": "visibility", "kind": "notAsked", "reason": "cameraUndeclared"}
    assert stage_of(d, "grasp") == {"stage": "grasp", "kind": "notAsked", "reason": "gripperUndeclared"}
    with pytest.raises(AssertionError, match="問うていない"):
        rejected_at(d, "visibility")
    # 問うていない段からリスクは出ない
    assert all(r.get("domain") not in ("vision", "grasp") for r in d["fallbackRisks"])
    _partitions(d)


def test_stages_come_in_judging_order_and_entered_follows_the_short_circuit():
    d = _wire(_pedestal())["diagnostics"]
    assert [v["stage"] for v in d["stages"]] == ["reach", "ik", "grasp", "visibility", "interference"]
    entered = d["candidatesGenerated"]
    for v in d["stages"]:
        if v["kind"] == "judged":
            assert v["entered"] == entered, v["stage"]
            entered -= v["rejected"]
    assert entered == d["feasible"]


# --- 純粋関数 -------------------------------------------------------------------------


def _tally(generated: int, rejections: "dict[Stage, int]") -> SourceTally:
    t = SourceTally(generated=generated)
    for stage, n in rejections.items():
        for _ in range(n):
            t.reject(stage)
    t.feasible = generated - sum(rejections.values())
    return t


def test_a_stage_that_rejects_everything_it_is_asked_is_a_total_loss_even_after_earlier_stages_took_most():
    """可視性に届いた 6 件を全部落とした — 全数で割ると 83% に見えた。"""
    t = _tally(36, {Stage.REACH: 30, Stage.VISIBILITY: 6})
    v = stage_verdicts(t, {Stage.GRASP: NotAskedReason.GRIPPER_UNDECLARED})
    vis = next(x for x in v if x.stage is Stage.VISIBILITY)
    assert (vis.entered, vis.rejected) == (6, 6)
    risks = fallback_risks(v, feasible=0)
    assert DomainRisk(RiskDomain.VISION, 5, RiskReason.NONE_SEEN) in risks
    # 2 ドメインが落として通過 0 → 配置を作り直す (L6) が最も深い
    assert risks[0] == TogetherRisk(domains=(RiskDomain.VISION, RiskDomain.PATH))


def test_the_path_domain_is_the_product_of_its_three_stages_over_those_that_entered_each():
    t = _tally(20, {Stage.REACH: 2, Stage.IK: 1, Stage.GRASP: 2, Stage.VISIBILITY: 4, Stage.INTERFERENCE: 1})
    v = stage_verdicts(t, {})
    risks = fallback_risks(v, feasible=10)
    assert [(r.domain, r.level) for r in risks] == [
        (RiskDomain.PATH, 4), (RiskDomain.GRASP, 4), (RiskDomain.VISION, 3)]
    # 経路のどの段も全滅していないので L5 にはならない
    assert all(r.level < 5 for r in risks)


def test_a_clean_search_has_no_risk_and_an_unasked_domain_never_has_one():
    assert fallback_risks(stage_verdicts(_tally(5, {}), {}), feasible=5) == ()
    v = stage_verdicts(_tally(5, {Stage.REACH: 5}), {Stage.VISIBILITY: NotAskedReason.CAMERA_UNDECLARED,
                                                     Stage.GRASP: NotAskedReason.GRIPPER_UNDECLARED})
    assert [r.domain for r in fallback_risks(v, feasible=0)] == [RiskDomain.PATH]


def test_the_nearest_miss_says_which_of_four_facts_it_is():
    t = SourceTally(generated=4)
    t.reject(Stage.REACH, miss=(MissQuantity.REACH_DISTANCE, 0.3))
    t.reject(Stage.REACH, miss=(MissQuantity.REACH_DISTANCE, 0.1))
    t.reject(Stage.VISIBILITY, unmeasurable=UnmeasurableReason.OUTSIDE_FIELD_OF_VIEW)
    t.feasible = 1
    v = {x.stage: x for x in stage_verdicts(t, {Stage.GRASP: NotAskedReason.GRIPPER_UNDECLARED})}
    assert v[Stage.REACH].nearest_miss == MissMeasured(MissQuantity.REACH_DISTANCE, 0.1)
    assert v[Stage.VISIBILITY].nearest_miss.reasons == (UnmeasurableReason.OUTSIDE_FIELD_OF_VIEW,)
    assert type(v[Stage.IK].nearest_miss).__name__ == "MissNoQuantity"
    assert type(v[Stage.INTERFERENCE].nearest_miss).__name__ == "MissNoQuantity"
    assert isinstance(v[Stage.GRASP], StageNotAsked)


def test_a_rejection_at_an_unasked_stage_or_a_broken_funnel_is_refused_not_reported():
    t = _tally(3, {Stage.VISIBILITY: 1})
    with pytest.raises(ValueError, match="問うていない"):
        stage_verdicts(t, {Stage.VISIBILITY: NotAskedReason.CAMERA_UNDECLARED})
    t = _tally(3, {})
    t.feasible = 2
    with pytest.raises(ValueError, match="恒等式"):
        stage_verdicts(t, {})


def test_the_whole_is_the_sum_of_its_rows():
    a = _tally(4, {Stage.REACH: 1})
    a.counts[Stage.REACH].nearest = (MissQuantity.REACH_DISTANCE, 0.2)
    b = _tally(6, {Stage.REACH: 2, Stage.IK: 1})
    b.counts[Stage.REACH].nearest = (MissQuantity.REACH_DISTANCE, 0.05)
    w = merged([a, b])
    assert (w.generated, w.feasible) == (10, 6)
    assert w.counts[Stage.REACH].rejected == 3 and w.counts[Stage.IK].rejected == 1
    assert w.counts[Stage.REACH].nearest == (MissQuantity.REACH_DISTANCE, 0.05)
    assert isinstance(stage_verdicts(w, {})[0], StageJudged)
