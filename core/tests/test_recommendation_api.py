"""推薦/類似レーンの HTTP 境界 (ADR-077 §4 / ADR-076 踏襲) のテスト。

grasp-search と同じ約束を /recommendation でも押さえる:
- happy path: 等価性候補のランキングを camelCase wire で返す (真偽値なし)。
- contractVersion 不一致 -> 400 / 形違い -> 422 / 認証 -> 401。
- DI (ADR-076 §5): 注入した similarity model が naive 既定を上書きする。
"""

from fastapi.testclient import TestClient

from easy_extrude_core.api import ApiSettings, create_app
from easy_extrude_core.contract import CONTRACT_VERSION
from easy_extrude_core.recommendation import RawSimilarity


def _request_body(**overrides) -> dict:
    body = {
        "contractVersion": CONTRACT_VERSION,
        "layoutVersion": "layout/1.0",
        "requirement": {"text": "pick small metal bracket from bin"},
        "references": [
            {
                "refId": "near",
                "text": "pick small metal bracket from the bin",
                "signature": "sig-near",
                "diff": {"distance": 0.1},
            },
            {
                "refId": "far",
                "text": "weld large plastic panel",
                "signature": "sig-far",
                "diff": {"distance": 0.9},
            },
        ],
    }
    body.update(overrides)
    return body


def _client(**kwargs) -> TestClient:
    return TestClient(create_app(**kwargs), raise_server_exceptions=False)


# --- happy path --------------------------------------------------------------


def test_recommendation_returns_ranked_proposals():
    resp = _client().post("/recommendation", json=_request_body())
    assert resp.status_code == 200
    body = resp.json()
    assert body["contractVersion"] == CONTRACT_VERSION
    # rank 昇順、camelCase wire。near が 1 位。
    assert [p["rank"] for p in body["proposals"]] == [1, 2]
    assert body["proposals"][0]["refId"] == "near"
    # public 構造距離をそのまま消費。
    assert body["proposals"][0]["structuralDistance"] == 0.1
    # 連続値のみ。真偽値の決定フィールドは無い (壁の番人)。
    for p in body["proposals"]:
        assert "equivalent" not in p
        assert 0.0 <= p["similarity"] <= 1.0
        assert 0.0 <= p["confidence"] <= 1.0


def test_recommendation_respects_top_n():
    resp = _client().post("/recommendation", json=_request_body(topN=1))
    assert resp.status_code == 200
    assert len(resp.json()["proposals"]) == 1


# --- エラーの約束 ------------------------------------------------------------


def test_version_mismatch_is_400():
    resp = _client().post(
        "/recommendation", json=_request_body(contractVersion=CONTRACT_VERSION + 99)
    )
    assert resp.status_code == 400
    err = resp.json()["error"]
    assert err["code"] == "contract_version_mismatch"
    assert err["expected"] == CONTRACT_VERSION
    assert err["received"] == CONTRACT_VERSION + 99


def test_malformed_request_is_422():
    # requirement を欠く = 契約スキーマ違反。
    resp = _client().post("/recommendation", json={"layoutVersion": "layout/1.0"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


# --- 認証 (ADR-076 §4) -------------------------------------------------------


def test_auth_rejects_without_token():
    settings = ApiSettings(internal_token="s3cret")
    resp = _client(settings=settings).post("/recommendation", json=_request_body())
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


def test_auth_accepts_with_token():
    settings = ApiSettings(internal_token="s3cret")
    resp = _client(settings=settings).post(
        "/recommendation",
        json=_request_body(),
        headers={"X-Internal-Token": "s3cret"},
    )
    assert resp.status_code == 200


# --- DI (ADR-076 §5): 注入が naive 既定を上書きする --------------------------


def test_injected_similarity_model_overrides_naive_at_boundary():
    # far の方を強く返す model を注入 -> 順位が naive と逆転 (配線点が効く)。
    class _FavorFar:
        def score(self, query, candidate):
            return RawSimilarity(semantic=1.0 if candidate.ref_id == "far" else 0.0,
                                 lexical=1.0 if candidate.ref_id == "far" else 0.0)

    resp = _client(similarity_model=_FavorFar()).post(
        "/recommendation", json=_request_body()
    )
    assert resp.status_code == 200
    assert resp.json()["proposals"][0]["refId"] == "far"
