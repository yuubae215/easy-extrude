"""コアAPI エンドポイント層 (ADR-076) のテスト。

HTTP 境界の約束を押さえる:
- POST /grasp-search が契約 (中立 JSON Schema) に準拠した wire 形を返す (HTTP 往復 conformance)。
- エラーの約束 (ADR-076 §3): 400 (version 不一致) / 422 (形違い) / 401 (認証) / 413 / 504。
- DI (ADR-076 §5): 注入したソルバが naive 既定を上書きする (配線点が効く)。
- 判定ロジックを境界が持たないこと (engine に委譲しているだけ) は schema 準拠で間接確認。
"""

import math
import time

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from easy_extrude_core.api import ApiSettings, create_app
from easy_extrude_core.contract import CONTRACT_VERSION

from contract_pkg import load_response_schema


def _declaration() -> dict:
    # 円弧状に並べた表面サンプル (到達域内)。test_engine と同じ素朴な題材。
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


def _request_body(**overrides) -> dict:
    body = {
        "contractVersion": CONTRACT_VERSION,
        "layoutVersion": "layout/1.0",
        "graspSearch": _declaration(),
    }
    body.update(overrides)
    return body


def _client(**kwargs) -> TestClient:
    # raise_server_exceptions=False: 500 ハンドラの応答 body を検証できるようにする。
    return TestClient(create_app(**kwargs), raise_server_exceptions=False)


# --- 可観測性 ----------------------------------------------------------------


def test_healthz_reports_contract_version():
    resp = _client().get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "contractVersion": CONTRACT_VERSION}


# --- API 表面の隠蔽 (ADR-076 §4): docs は dev のみ -----------------------------


def test_docs_open_in_dev_when_auth_disabled():
    # dev (token 未設定 = auth 無効) では確認用に /docs /openapi.json を開ける。
    client = _client(settings=ApiSettings(internal_token=None))
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 200


def test_docs_hidden_in_production_when_auth_enabled():
    # 本番 (token 設定済み = auth 有効) では API 表面を晒さない。
    client = _client(settings=ApiSettings(internal_token="s3cret"))
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404


# --- happy path + HTTP 往復 conformance --------------------------------------


def test_grasp_search_returns_schema_conforming_ranking():
    resp = _client().post("/grasp-search", json=_request_body())
    assert resp.status_code == 200

    body = resp.json()
    # 契約 (中立 JSON Schema) に wire 形が準拠すること (HTTP 往復でも担保)。
    Draft202012Validator(load_response_schema()).validate(body)

    # topN=2 を尊重し、rank 昇順・total_score 降順。
    assert [c["rank"] for c in body["candidates"]] == [1, 2]
    scores = [c["score"]["totalScore"] for c in body["candidates"]]
    assert scores[0] >= scores[1]
    # camelCase の wire 形 (by_alias) で返ること。
    assert body["candidates"][0]["score"]["ikSolvable"] is True


def test_grasp_search_defaults_contract_version_when_omitted():
    # contractVersion 省略時は現行に既定 -> 通る (任意フィールド扱い)。
    body = _request_body()
    del body["contractVersion"]
    resp = _client().post("/grasp-search", json=body)
    assert resp.status_code == 200


# --- エラーの約束 (ADR-076 §3) ------------------------------------------------


def test_version_mismatch_is_400_with_expected_received():
    resp = _client().post(
        "/grasp-search", json=_request_body(contractVersion=CONTRACT_VERSION + 99)
    )
    assert resp.status_code == 400
    err = resp.json()["error"]
    assert err["code"] == "contract_version_mismatch"
    # 片側だけ古いデプロイのズレを即特定できるよう expected/received を載せる (ADR-074)。
    assert err["expected"] == CONTRACT_VERSION
    assert err["received"] == CONTRACT_VERSION + 99


def test_malformed_request_is_422():
    # graspSearch を欠く = 契約スキーマ違反 (形が違う)。
    resp = _client().post(
        "/grasp-search", json={"layoutVersion": "layout/1.0"}
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


def test_internal_error_is_500_with_neutral_message():
    # 想定外例外を上げるソルバを注入 -> 500。内部詳細は漏らさない。
    class _BoomSolver:
        def solve(self, candidate, robot):
            raise RuntimeError("boom: internal detail that must not leak")

    resp = _client(ik_solver=_BoomSolver()).post("/grasp-search", json=_request_body())
    assert resp.status_code == 500
    err = resp.json()["error"]
    assert err["code"] == "internal_error"
    assert "boom" not in err["message"]  # 内部詳細を漏らさない。


# --- 認証 (ADR-076 §4): BFF だけが通れる内部トークン -------------------------


def test_auth_rejects_request_without_token():
    settings = ApiSettings(internal_token="s3cret")
    resp = _client(settings=settings).post("/grasp-search", json=_request_body())
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


def test_auth_accepts_request_with_correct_token():
    settings = ApiSettings(internal_token="s3cret")
    resp = _client(settings=settings).post(
        "/grasp-search",
        json=_request_body(),
        headers={"X-Internal-Token": "s3cret"},
    )
    assert resp.status_code == 200


def test_auth_disabled_by_default_allows_request():
    # dev 既定 (token 未設定) は認証無効 = 通る。
    resp = _client(settings=ApiSettings(internal_token=None)).post(
        "/grasp-search", json=_request_body()
    )
    assert resp.status_code == 200


# --- 入力上限 / 実行時間ガード (ADR-076 Open) --------------------------------


def test_oversized_body_is_413():
    settings = ApiSettings(max_body_bytes=10)  # 極小上限。
    resp = _client(settings=settings).post("/grasp-search", json=_request_body())
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "payload_too_large"


def test_slow_search_times_out_504():
    settings = ApiSettings(request_timeout_seconds=0.01)

    class _SlowSolver:
        def solve(self, candidate, robot):
            time.sleep(0.2)  # 予算超過を誘発。
            return None

    resp = _client(settings=settings, ik_solver=_SlowSolver()).post(
        "/grasp-search", json=_request_body()
    )
    assert resp.status_code == 504
    assert resp.json()["error"]["code"] == "request_timeout"


# --- DI (ADR-076 §5): 注入が naive 既定を上書きする --------------------------


def test_injected_solver_overrides_naive_at_boundary():
    # 常に解けないソルバ -> 通過 0 件 (配線点が効くことの確認)。
    class _NeverSolver:
        def solve(self, candidate, robot):
            return None

    resp = _client(ik_solver=_NeverSolver()).post("/grasp-search", json=_request_body())
    assert resp.status_code == 200
    assert resp.json()["candidates"] == []


# --- 設定 (env 注入) ---------------------------------------------------------


def test_settings_from_env_reads_overrides():
    settings = ApiSettings.from_env(
        {
            "GRASP_API_INTERNAL_TOKEN": "tok",
            "GRASP_API_MAX_BODY_BYTES": "2048",
            "GRASP_API_REQUEST_TIMEOUT_SECONDS": "3.5",
        }
    )
    assert settings.internal_token == "tok"
    assert settings.auth_enabled is True
    assert settings.max_body_bytes == 2048
    assert settings.request_timeout_seconds == 3.5


def test_settings_from_env_defaults_when_unset():
    settings = ApiSettings.from_env({})
    assert settings.internal_token is None
    assert settings.auth_enabled is False
