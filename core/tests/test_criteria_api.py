"""判定基準レーンの HTTP 境界 (ADR-165 D6 / ADR-076 踏襲)。

他のエンドポイントと同じ約束: happy path は camelCase wire / contractVersion 不一致 400 /
形違い 422 / 線が評価できない 400 (理由つき) / 認証 401 / DI で案の出どころを差し替えられる。
"""

from fastapi.testclient import TestClient

from criteria_fixtures import A, B, C, SATO, TANAKA, Cells, end_user, request

from easy_extrude_core.api import ApiSettings, create_app
from easy_extrude_core.contract import CONTRACT_VERSION


def _client(**kwargs) -> TestClient:
    return TestClient(create_app(**kwargs), raise_server_exceptions=False)


def _body(*users, **kw):
    return {"contractVersion": CONTRACT_VERSION, **request(*users, **kw)}


def test_criteria_trial_returns_candidates_interest_and_a_declared_proposal():
    resp = _client().post("/criteria-trial", json=_body(TANAKA, SATO))
    assert resp.status_code == 200
    body = resp.json()
    assert body["contractVersion"] == CONTRACT_VERSION
    assert len(body["candidates"]) == 4
    assert len(body["interest"]) == 8
    assert body["proposal"] == {"kind": "notAsked"}
    assert "totalScore" not in body


def test_version_mismatch_is_400():
    resp = _client().post("/criteria-trial", json={**_body(TANAKA), "contractVersion": CONTRACT_VERSION - 1})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "contract_version_mismatch"


def test_malformed_is_422():
    resp = _client().post("/criteria-trial", json={"contractVersion": CONTRACT_VERSION, "line": {"endUsers": []}})
    assert resp.status_code == 422


def test_a_line_that_cannot_be_judged_is_400_with_its_reason():
    zero = end_user("x", {"D": 0, "Q": 0, "C": 0, "S": 0})
    resp = _client().post("/criteria-trial", json=_body(zero))
    assert resp.status_code == 400
    assert "all zeros" in resp.json()["error"]["message"]


def test_auth_rejects_without_token():
    client = _client(settings=ApiSettings(internal_token="secret"))
    assert client.post("/criteria-trial", json=_body(TANAKA)).status_code == 401


def test_injected_cell_source_replaces_the_naive_table():
    resp = _client(cell_source=Cells(A, B, C)).post("/criteria-trial", json=_body(TANAKA, SATO))
    assert [c["id"] for c in resp.json()["candidates"]] == ["A", "B", "C"]
