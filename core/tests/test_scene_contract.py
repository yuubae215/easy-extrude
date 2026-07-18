"""bin-picking シーン層の契約型 (ADR-078) のテスト。

押さえる点:
- wire <-> ドメインの adapter が round-trip する (pick_sequence が契約型を入出力する)。
- wire 入力 = エンティティ属性の宣言 (器) のみ。kind / 永続性 / 球 / 把持点を写し取る。
- 出力 wire は per-pick の把持ランキング (grasp の PoseCandidate を再利用)。
- 壁の規律: 出力 wire に「障害物集合そのもの」や判定の真偽値を置かない
  (derivedObstacleCount は個数だけ)。
"""

import math

from easy_extrude_core.contract import (
    CONTRACT_VERSION,
    PickSequenceRequest,
    PickSequenceResponse,
    PickStepWire,
)
from easy_extrude_core.engine import pose_from_payload
from easy_extrude_core.scene import pick_sequence


def _request_dict(**overrides) -> dict:
    """壁 (static) 2 + 平置きワーク (dynamic, 高さ違い) 3 の bin シーン。

    test_scene の _bin_scene / _settings を wire 形 (camelCase) に写したもの。
    """
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


# --- 壁の規律 (wire 境界まで貫く) --------------------------------------------


def test_pick_step_wire_has_no_obstacle_set_or_decision_field():
    # 出力 wire は導出した障害物の *個数* (derivedObstacleCount) だけを持ち、障害物集合
    # そのものや「これは障害物だ」の真偽値を持たない (導出=判定はコアに閉じる)。
    fields = PickStepWire.model_fields
    assert "obstacles" not in fields
    assert "collisionSpheres" not in fields
    assert "derived_obstacle_count" in fields


# --- adapter round-trip ------------------------------------------------------


def test_pick_sequence_consumes_wire_and_returns_topmost_first():
    request = PickSequenceRequest.model_validate(_request_dict())
    response = pick_sequence(request)
    assert isinstance(response, PickSequenceResponse)
    assert response.contract_version == CONTRACT_VERSION
    # 3 ワークすべて feasible -> 最上面順 (z 降順) にピック。
    assert [p.target_id for p in response.picks] == ["w_top", "w_mid", "w_low"]
    assert all(p.picked for p in response.picks)


def test_derived_obstacle_count_shrinks_each_pick():
    request = PickSequenceRequest.model_validate(_request_dict())
    response = pick_sequence(request)
    # 2 壁 (常時) + 残りワーク。w_top 回=2壁+2ワーク=4, 次=3, 次=2 (test_scene と同値)。
    assert [p.derived_obstacle_count for p in response.picks] == [4, 3, 2]


def test_persistence_default_resolved_from_kind_across_wire():
    # wire で persistence 省略 -> ワークは dynamic (対象になる) / 壁は static (対象でない)。
    request = PickSequenceRequest.model_validate(_request_dict())
    response = pick_sequence(request)
    picked = {p.target_id for p in response.picks}
    assert "wall_n" not in picked and "wall_s" not in picked  # static は対象にならない
    assert picked == {"w_top", "w_mid", "w_low"}


def test_persistence_explicit_override_through_wire():
    # ワークを明示 static にすると対象にならない (属性編集の上書きが wire を貫く)。
    body = _request_dict()
    for e in body["scene"]["entities"]:
        if e["entityId"] == "w_mid":
            e["persistence"] = "static"
    response = pick_sequence(PickSequenceRequest.model_validate(body))
    assert "w_mid" not in {p.target_id for p in response.picks}


def test_max_picks_flows_through_contract():
    response = pick_sequence(PickSequenceRequest.model_validate(_request_dict(maxPicks=1)))
    assert [p.target_id for p in response.picks] == ["w_top"]


def test_response_serializes_to_camelcase_wire():
    request = PickSequenceRequest.model_validate(_request_dict())
    wire = pick_sequence(request).model_dump(by_alias=True)
    assert "contractVersion" in wire
    first = wire["picks"][0]
    assert "targetId" in first
    assert "derivedObstacleCount" in first
    # candidates は grasp の PoseCandidate wire 形 (rank + score 内訳) を再利用。
    cand = first["candidates"][0]
    assert "rank" in cand and "score" in cand
    assert "withinReach" in cand["score"]
    # rank 1 は top-down 把持 (approach ~ [0,0,-1])。契約 v2 では pose は kind 判別 union で
    # approach はワイヤに載らず frame(-Z) から導出 -> codec で復元して意味を照合。
    assert cand["pose"]["kind"] == "endEffector"
    assert math.isclose(pose_from_payload(cand["pose"]).approach.z, -1.0, abs_tol=1e-6)
