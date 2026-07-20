"""pydantic binding が中立スキーマ (@easy-extrude/grasp-contract) に準拠するか検証。

中立な正本は JSON Schema (submodule vendor-contract = 外部の中立 repo)。Python 側の pydantic はその binding。
ここでは実インスタンスを wire 形 (camelCase, by_alias) にして JSON Schema で検証し、
さらに contractVersion の正準値が一致するかを突き合わせる (drift 検知)。

注意: 共有パッケージは現状ここに staging されている。relocate 後はこのパスを
更新する (README の不変条件参照)。
"""

import pytest
from jsonschema import Draft202012Validator

from contract_pkg import load_contract_json, load_request_schema, load_response_schema

from easy_extrude_core.contract import (
    CONTRACT_VERSION,
    GraspSearchDeclaration,
    GraspSearchRequest,
    GraspSearchResponse,
    PoseCandidate,
    ScoreBreakdown,
    SearchDiagnostics,
)


def test_contract_version_matches_canonical():
    canonical = load_contract_json("contract-version.json")["contractVersion"]
    assert CONTRACT_VERSION == canonical


def test_request_instance_conforms_to_schema():
    schema = load_request_schema()
    req = GraspSearchRequest(
        layout_version="layout/1.0",
        grasp_search=GraspSearchDeclaration(
            objective_weights={"reach_margin": 1.0}, top_n=5
        ),
    )
    wire = req.model_dump(by_alias=True)
    # camelCase の wire 形になっていること。
    assert "layoutVersion" in wire and "graspSearch" in wire
    assert "topN" in wire["graspSearch"]
    Draft202012Validator(schema).validate(wire)


def _score() -> ScoreBreakdown:
    return ScoreBreakdown(
        within_reach=True,
        visible=True,
        ik_solvable=True,
        interference_free=True,
        graspable=True,
        objective_scores={"reach_margin": 0.8},
        total_score=0.8,
    )


def _diagnostics(**overrides) -> SearchDiagnostics:
    base = dict(
        candidates_generated=1,
        rejected_by_reach=0,
        rejected_by_visibility=0,
        rejected_by_ik=0,
        rejected_by_interference=0,
        rejected_by_grasp=0,
        feasible=1,
        returned=1,
        reach_nearest_miss=None,
        occlusion_nearest_miss=None,
        opening_nearest_miss=None,
    )
    base.update(overrides)
    return SearchDiagnostics(**base)


def test_response_end_effector_pose_conforms_to_schema():
    # 契約 v2: pose は kind 判別 union。段階0 が emit する endEffector 枝が Schema に従うこと。
    schema = load_response_schema()
    resp = GraspSearchResponse(
        candidates=[
            PoseCandidate(
                rank=1,
                pose={
                    "kind": "endEffector",
                    "frame": {
                        "position": [1.0, 2.0, 3.0],
                        "orientation": [0.0, 0.0, 0.0, 1.0],
                    },
                },
                score=_score(),
            )
        ],
        diagnostics=_diagnostics(),
    )
    wire = resp.model_dump(by_alias=True)
    assert wire["candidates"][0]["score"]["ikSolvable"] is True
    assert wire["candidates"][0]["pose"]["kind"] == "endEffector"
    Draft202012Validator(schema).validate(wire)


def test_response_joint_space_pose_conforms_to_schema():
    # union のもう一方の枝 (jointSpace) も Schema に従うこと (kind ごとの drift 検出)。
    schema = load_response_schema()
    resp = GraspSearchResponse(
        candidates=[
            PoseCandidate(
                rank=1,
                pose={"kind": "jointSpace", "chainRef": "robot0", "joints": [0.0, 0.1, 0.2]},
                score=_score(),
            )
        ],
        diagnostics=_diagnostics(),
    )
    Draft202012Validator(schema).validate(resp.model_dump(by_alias=True))


def test_response_diagnostics_zero_candidates_conforms_to_schema():
    # 候補ゼロ + reachNearestMiss 数値のケース (契約 v3 の主目的: 空振りを説明する)。
    schema = load_response_schema()
    resp = GraspSearchResponse(
        candidates=[],
        diagnostics=_diagnostics(
            candidates_generated=4,
            rejected_by_reach=4,
            feasible=0,
            returned=0,
            reach_nearest_miss=4.0,
        ),
    )
    Draft202012Validator(schema).validate(resp.model_dump(by_alias=True))


def test_response_diagnostics_rejects_unknown_field():
    # additionalProperties:false の閉オブジェクト -> 未知フィールドは Schema で弾かれる。
    schema = load_response_schema()
    wire = {
        "candidates": [],
        "diagnostics": {
            "candidatesGenerated": 0,
            "rejectedByReach": 0,
            "rejectedByVisibility": 0,
            "rejectedByIk": 0,
            "rejectedByInterference": 0,
            "rejectedByGrasp": 0,
            "feasible": 0,
            "returned": 0,
            "reachNearestMiss": None,
            "occlusionNearestMiss": None,
            "openingNearestMiss": None,
            "extraField": "not allowed",
        },
    }
    with pytest.raises(Exception):
        Draft202012Validator(schema).validate(wire)


def test_schema_rejects_opaque_pose():
    # v1 の opaque pose (kind 判別子なし) は v2 Schema では読めない (union として拒否)。
    schema = load_response_schema()
    bad = {
        "candidates": [
            {
                "rank": 1,
                "pose": {"joints": [0.0, 0.1, 0.2]},
                "score": {
                    "withinReach": True,
                    "visible": True,
                    "ikSolvable": True,
                    "interferenceFree": True,
                    "graspable": True,
                    "objectiveScores": {"reach_margin": 0.8},
                    "totalScore": 0.8,
                },
            }
        ]
    }
    with pytest.raises(Exception):
        Draft202012Validator(schema).validate(bad)


def test_schema_rejects_unnormalized_objective_score():
    # objectiveScores は 0-1 正規化を契約として強制 (絶対基準で比較可能にするため)。
    schema = load_response_schema()
    bad = {
        "candidates": [
            {
                "rank": 1,
                "score": {
                    "withinReach": True,
                    "visible": True,
                    "ikSolvable": True,
                    "interferenceFree": True,
                    "graspable": True,
                    "objectiveScores": {"reach_margin": 1.5},
                    "totalScore": 1.5,
                },
            }
        ]
    }
    with pytest.raises(Exception):
        Draft202012Validator(schema).validate(bad)
