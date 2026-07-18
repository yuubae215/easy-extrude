"""推薦/類似レーンの契約型 (ADR-077) のテスト。

押さえる点:
- wire <-> ドメインの adapter が round-trip する (recommend が契約型を入出力する)。
- public 由来の出力を不透明に消費する (canonical signature は素通し / structural distance
  は再計算せず消費)。
- 壁の番人を wire 境界まで貫く: 出力 wire に真偽値フィールドが無い。
"""

from easy_extrude_core.contract import (
    CONTRACT_VERSION,
    EquivalenceProposalWire,
    RecommendationRequest,
    RecommendationResponse,
)
from easy_extrude_core.recommendation import recommend


def _request_dict(**overrides) -> dict:
    body = {
        "contractVersion": CONTRACT_VERSION,
        "layoutVersion": "layout/1.0",
        "requirement": {"text": "pick small metal bracket from bin"},
        "references": [
            {
                "refId": "near",
                "text": "pick small metal bracket from the bin",
                "signature": "sig-near-opaque",
                "diff": {"distance": 0.1, "detail": "1 node relabeled"},
            },
            {
                "refId": "far",
                "text": "weld large plastic panel onto frame",
                "signature": "sig-far-opaque",
                "diff": {"distance": 0.8},
            },
        ],
    }
    body.update(overrides)
    return body


# --- 壁の番人 (wire 境界まで貫く) --------------------------------------------


def test_proposal_wire_has_no_boolean_decision_field():
    # 出力 wire に「等価か否か」の真偽値を置かない (ADR-077 §5 を wire 境界まで貫く)。
    fields = EquivalenceProposalWire.model_fields
    assert "equivalent" not in fields
    assert "isEquivalent" not in fields
    assert not any(f.annotation is bool for f in fields.values())


# --- adapter round-trip ------------------------------------------------------


def test_recommend_consumes_wire_and_returns_ranked_proposals():
    request = RecommendationRequest.model_validate(_request_dict())
    response = recommend(request)
    assert isinstance(response, RecommendationResponse)
    assert response.contract_version == CONTRACT_VERSION
    # 字面が近い near が 1 位、far が 2 位。
    assert [p.ref_id for p in response.proposals] == ["near", "far"]
    assert [p.rank for p in response.proposals] == [1, 2]
    assert response.proposals[0].similarity > response.proposals[1].similarity


def test_public_structural_distance_is_consumed_not_recomputed():
    request = RecommendationRequest.model_validate(_request_dict())
    response = recommend(request)
    by_id = {p.ref_id: p for p in response.proposals}
    # public が出した distance (0.1 / 0.8) をそのまま消費 (再計算しない)。
    assert by_id["near"].structural_distance == 0.1
    assert by_id["far"].structural_distance == 0.8
    # diff があるので構造裏付けあり。
    assert by_id["near"].evidence.structural_support == 1.0


def test_missing_diff_is_consumed_conservatively():
    body = _request_dict(
        references=[{"refId": "x", "text": "anything here", "signature": "sig-x"}]
    )
    response = recommend(RecommendationRequest.model_validate(body))
    p = response.proposals[0]
    # public 構造距離が無い -> 最遠 (1.0) + 裏付けなし。
    assert p.structural_distance == 1.0
    assert p.evidence.structural_support == 0.0


def test_top_n_and_weights_flow_through_contract():
    body = _request_dict(topN=1, similarityWeights={"semantic": 1.0, "lexical": 0.0})
    response = recommend(RecommendationRequest.model_validate(body))
    assert len(response.proposals) == 1


def test_response_serializes_to_camelcase_wire():
    request = RecommendationRequest.model_validate(_request_dict())
    wire = recommend(request).model_dump(by_alias=True)
    assert "contractVersion" in wire
    first = wire["proposals"][0]
    assert "refId" in first
    assert "structuralDistance" in first
    assert "structuralSupport" in first["evidence"]
    # 真偽値の決定フィールドは wire に存在しない。
    assert "equivalent" not in first
