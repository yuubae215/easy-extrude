"""bin-picking シーン層の HTTP 境界 (ADR-078 / ADR-076 踏襲) のテスト。

grasp-search / recommendation と同じ約束を /pick-sequence でも押さえる:
- happy path: 最上面順の反復ピック列を camelCase wire で返す (各ピックに把持ランキング)。
- contractVersion 不一致 -> 400 / 形違い -> 422 / 認証 -> 401。
- DI (ADR-076 §5): 注入した collision_checker が naive 既定を上書きする (配線点が効く)。
- 壁の規律: 出力に障害物集合そのもの・判定の真偽値が出ない (個数のみ)。
"""

from fastapi.testclient import TestClient

from easy_extrude_core.api import ApiSettings, create_app
from easy_extrude_core.contract import CONTRACT_VERSION


def _workpiece_wire(entity_id: str, x: float, y: float, z: float) -> dict:
    up = [0.0, 0.0, 1.0]
    return {
        "entityId": entity_id,
        "kind": "workpiece",
        "collisionSpheres": [{"center": [x, y, z], "radius": 0.025}],
        "surfaceSamples": [
            {"point": [x, y, z], "normal": up},
            {"point": [x + 0.015, y, z], "normal": up},
            {"point": [x, y + 0.015, z], "normal": up},
        ],
    }


def _request_body(**overrides) -> dict:
    body = {
        "contractVersion": CONTRACT_VERSION,
        "layoutVersion": "layout/1.0",
        "scene": {
            "entities": [
                {
                    "entityId": "wall_n",
                    "kind": "wall",
                    "collisionSpheres": [{"center": [0.15, 0.0, -0.57], "radius": 0.02}],
                },
                {
                    "entityId": "wall_s",
                    "kind": "wall",
                    "collisionSpheres": [{"center": [-0.15, 0.0, -0.57], "radius": 0.02}],
                },
                _workpiece_wire("w_top", 0.0, 0.0, -0.58),
                _workpiece_wire("w_mid", 0.1, 0.0, -0.60),
                _workpiece_wire("w_low", -0.1, 0.0, -0.62),
            ]
        },
        "settings": {
            "robot": {
                "base": [0.0, 0.0, 0.0],
                "reachMin": 0.4,
                "reachMax": 0.95,
                "wristConeHalfAngle": 0.7,
            },
            "objectiveWeights": {
                "grasp_stability": 1.0,
                "approach_clearance": 0.7,
                "reach_margin": 0.3,
            },
            "approachTiltAngles": [0.0],
            "rollAngles": [0.0],
            "preGraspDistance": 0.1,
            "clearanceReference": 0.03,
            "topN": 5,
        },
    }
    body.update(overrides)
    return body


def _client(**kwargs) -> TestClient:
    return TestClient(create_app(**kwargs), raise_server_exceptions=False)


# --- happy path --------------------------------------------------------------


def test_pick_sequence_returns_topmost_first_with_rankings():
    resp = _client().post("/pick-sequence", json=_request_body())
    assert resp.status_code == 200
    body = resp.json()
    assert body["contractVersion"] == CONTRACT_VERSION
    # 最上面順 (z 降順) にピック。
    assert [p["targetId"] for p in body["picks"]] == ["w_top", "w_mid", "w_low"]
    assert all(p["picked"] for p in body["picks"])
    # 障害物集合は導出されて縮む (2 壁 + 残りワーク)。出力は個数のみ。
    assert [p["derivedObstacleCount"] for p in body["picks"]] == [4, 3, 2]
    # 各ピックに把持ランキング (rank 付き camelCase)。判定の真偽値は出力に無い。
    first = body["picks"][0]
    assert [c["rank"] for c in first["candidates"]][:1] == [1]
    assert "obstacles" not in first  # 障害物集合そのものは出さない (壁の規律)


def test_pick_sequence_respects_max_picks():
    resp = _client().post("/pick-sequence", json=_request_body(maxPicks=1))
    assert resp.status_code == 200
    assert [p["targetId"] for p in resp.json()["picks"]] == ["w_top"]


# --- エラーの約束 ------------------------------------------------------------


def test_version_mismatch_is_400():
    resp = _client().post(
        "/pick-sequence", json=_request_body(contractVersion=CONTRACT_VERSION + 99)
    )
    assert resp.status_code == 400
    err = resp.json()["error"]
    assert err["code"] == "contract_version_mismatch"
    assert err["expected"] == CONTRACT_VERSION
    assert err["received"] == CONTRACT_VERSION + 99


def test_malformed_request_is_422():
    # settings を欠く = 契約スキーマ違反。
    resp = _client().post(
        "/pick-sequence",
        json={"layoutVersion": "layout/1.0", "scene": {"entities": []}},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


# --- 認証 (ADR-076 §4) -------------------------------------------------------


def test_auth_rejects_without_token():
    settings = ApiSettings(internal_token="s3cret")
    resp = _client(settings=settings).post("/pick-sequence", json=_request_body())
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


def test_auth_accepts_with_token():
    settings = ApiSettings(internal_token="s3cret")
    resp = _client(settings=settings).post(
        "/pick-sequence",
        json=_request_body(),
        headers={"X-Internal-Token": "s3cret"},
    )
    assert resp.status_code == 200


# --- DI (ADR-076 §5): 注入が naive 既定を上書きする --------------------------


def test_injected_collision_checker_overrides_naive_at_boundary():
    # 全候補を衝突扱いにする checker を注入 -> どのワークも feasible でなくなり、ピック 0 件
    # (naive 既定なら 3 件取れる)。配線点が効くことの確認。
    class _AlwaysCollides:
        def in_collision(self, candidate, obstacles) -> bool:
            return True

    resp = _client(collision_checker=_AlwaysCollides()).post(
        "/pick-sequence", json=_request_body()
    )
    assert resp.status_code == 200
    assert resp.json()["picks"] == []
