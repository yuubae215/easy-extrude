"""契約 (ADR-074) の型と contractVersion ガードのテスト。判定エンジンのテストではない。"""

import pytest

from easy_extrude_core.contract import (
    CONTRACT_VERSION,
    ContractVersionMismatch,
    GraspSearchDeclaration,
    GraspSearchRequest,
    GraspSearchResponse,
    PoseCandidate,
    ScoreBreakdown,
    SearchDiagnostics,
    check_contract_version,
)


def _diagnostics(**overrides) -> SearchDiagnostics:
    base = dict(
        candidates_generated=1,
        rejected_by_reach=0,
        rejected_by_ik=0,
        rejected_by_interference=0,
        feasible=1,
        returned=1,
        reach_nearest_miss=None,
    )
    base.update(overrides)
    return SearchDiagnostics(**base)


def test_check_contract_version_passes_on_match():
    # 一致なら何も起きない (None を返す)。
    assert check_contract_version(CONTRACT_VERSION) is None


def test_check_contract_version_raises_on_mismatch():
    with pytest.raises(ContractVersionMismatch) as exc:
        check_contract_version(CONTRACT_VERSION + 1)
    # エンドポイント層が 400 に写すための情報を持つ。
    assert exc.value.received == CONTRACT_VERSION + 1
    assert exc.value.expected == CONTRACT_VERSION


def test_request_defaults_contract_version():
    req = GraspSearchRequest(
        layout_version="layout/1.0",
        grasp_search=GraspSearchDeclaration(objective_weights={"reach_margin": 1.0}),
    )
    assert req.contract_version == CONTRACT_VERSION
    assert req.grasp_search.top_n == 5  # 上位N件のデフォルト


def test_response_roundtrip_top_n_with_breakdown():
    resp = GraspSearchResponse(
        candidates=[
            PoseCandidate(
                rank=1,
                pose={"joints": [0.0, 0.1, 0.2]},
                score=ScoreBreakdown(
                    within_reach=True,
                    ik_solvable=True,
                    interference_free=True,
                    objective_scores={"reach_margin": 0.8},
                    total_score=0.8,
                ),
            )
        ],
        diagnostics=_diagnostics(),
    )
    dumped = resp.model_dump()
    reloaded = GraspSearchResponse.model_validate(dumped)
    assert reloaded.contract_version == CONTRACT_VERSION
    assert reloaded.candidates[0].rank == 1
    assert reloaded.candidates[0].score.ik_solvable is True
