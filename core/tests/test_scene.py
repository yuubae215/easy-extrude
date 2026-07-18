"""bin-picking シーン層 (ADR-078) のテスト。

ADR-078 の確定方針を押さえる:
- Decision 1: 障害物はエンティティ属性 (static/dynamic) から導出。最上面順ポリシ。
- Decision 2: エンジン契約は不変、scene 層は上に乗る。導出=純粋 / 進行=副作用境界。
  対象自身を障害物に入れて自己干渉する罠 (Context) を構造的に回避する。
- Decision 3: cone (許容角=届く向き, robot) と approach (進入角=試す向き, sampling) は別軸。

純粋関数 (導出) と反復ピック (副作用境界) を分けて検証する (素朴版の規律, engine と同形)。
"""

import math

import pytest

from easy_extrude_core.engine import pose_from_payload
from easy_extrude_core.engine.types import Obstacle, Robot, Vec3
from easy_extrude_core.scene import (
    EntityKind,
    GraspSettings,
    Persistence,
    PickResult,
    Scene,
    SceneEntity,
    build_request,
    derive_obstacles,
    order_by_topmost,
    run_pick_sequence,
    targetable_entities,
)


# --- テスト用シーンの組み立て --------------------------------------------------


def _workpiece(entity_id: str, x: float, y: float, z: float) -> SceneEntity:
    """床に平置きしたワーク (dynamic)。上面法線 +Z、把持点は中心 + 微小オフセット。"""
    center = Vec3(x, y, z)
    up = Vec3(0.0, 0.0, 1.0)
    samples = (
        (center, up),
        (Vec3(x + 0.015, y, z), up),
        (Vec3(x, y + 0.015, z), up),
    )
    return SceneEntity(
        entity_id=entity_id,
        kind=EntityKind.WORKPIECE,
        collision_spheres=(Obstacle(center=center, radius=0.025),),
        surface_samples=samples,
    )


def _wall(entity_id: str, x: float, y: float) -> SceneEntity:
    """薄型コンテナのリムを球で近似した壁 (static)。把持点は持たない。"""
    return SceneEntity(
        entity_id=entity_id,
        kind=EntityKind.WALL,
        collision_spheres=(Obstacle(center=Vec3(x, y, -0.57), radius=0.02),),
    )


def _settings() -> GraspSettings:
    return GraspSettings(
        robot=Robot(
            base=Vec3(0.0, 0.0, 0.0),
            reach_min=0.4,
            reach_max=0.95,
            wrist_cone_half_angle=0.7,
        ),
        objective_weights={
            "grasp_stability": 1.0,
            "approach_clearance": 0.7,
            "reach_margin": 0.3,
        },
        approach_tilt_angles=(0.0,),
        roll_angles=(0.0,),
        pre_grasp_distance=0.1,
        clearance_reference=0.03,
        top_n=5,
    )


def _bin_scene() -> Scene:
    """壁 (static) + 平置きワーク数個 (dynamic, 高さ違い) のシーン。"""
    return Scene(
        entities=(
            _wall("wall_n", 0.15, 0.0),
            _wall("wall_s", -0.15, 0.0),
            _workpiece("w_top", 0.0, 0.0, -0.58),
            _workpiece("w_mid", 0.1, 0.0, -0.60),
            _workpiece("w_low", -0.1, 0.0, -0.62),
        )
    )


# --- Decision 1: 永続性は属性 (kind 既定 + 上書き) -----------------------------


def test_persistence_defaults_from_kind():
    assert _wall("w", 0.15, 0.0).resolved_persistence is Persistence.STATIC
    assert _workpiece("p", 0, 0, -0.6).resolved_persistence is Persistence.DYNAMIC
    fixture = SceneEntity(entity_id="f", kind=EntityKind.FIXTURE)
    assert fixture.resolved_persistence is Persistence.STATIC


def test_persistence_explicit_override():
    # UI で属性を上書き: 壁を dynamic 扱いにする等。
    e = SceneEntity(
        entity_id="w", kind=EntityKind.WALL, persistence=Persistence.DYNAMIC
    )
    assert e.is_dynamic is True
    assert e.is_static is False


def test_is_targetable_requires_dynamic_with_samples():
    assert _workpiece("p", 0, 0, -0.6).is_targetable is True
    # 壁 (static, 把持点なし) は対象にならない。
    assert _wall("w", 0.15, 0.0).is_targetable is False
    # dynamic でも把持点が無ければ対象にしない。
    no_samples = SceneEntity(
        entity_id="d", kind=EntityKind.WORKPIECE, collision_spheres=()
    )
    assert no_samples.is_targetable is False


# --- Decision 2: 障害物導出 (formula + 自己干渉の罠回避) -----------------------


def test_derive_obstacles_excludes_target_and_picked():
    scene = _bin_scene()
    # 対象 = w_top, ピック済み = w_mid -> 残るは walls + w_low。
    obstacles = derive_obstacles(scene, "w_top", picked_ids=["w_mid"])
    centers = {(o.center.x, o.center.y, o.center.z) for o in obstacles}
    # 2 壁 + w_low の 1 球 = 3 球。
    assert len(obstacles) == 3
    assert (0.0, 0.0, -0.58) not in centers  # target 自身は障害物にしない
    assert (0.1, 0.0, -0.60) not in centers  # ピック済みも除く
    assert (-0.1, 0.0, -0.62) in centers  # 残った dynamic は障害物
    assert (0.15, 0.0, -0.57) in centers  # static 壁は常時障害物


def test_derive_obstacles_avoids_self_interference_trap():
    """対象自身を障害物に入れない -> 線分-球距離 0 の自己干渉 (Context の罠) を回避。"""
    scene = _bin_scene()
    settings = _settings()
    # w_top を単独で (他ワークも全部 picked 扱いで除外して) 探索しても候補が出る。
    req = build_request(
        scene, "w_top", settings, picked_ids=["w_mid", "w_low"]
    )
    from easy_extrude_core.engine import pipeline

    resp = pipeline.search(req)
    assert resp.candidates, "対象自身を障害物から除けば top-down 把持は feasible"


# --- 最上面順 (order_by_topmost) ----------------------------------------------


def test_targetable_entities_skips_walls_and_picked():
    scene = _bin_scene()
    ids = {e.entity_id for e in targetable_entities(scene, picked_ids=["w_top"])}
    assert ids == {"w_mid", "w_low"}  # 壁は対象でない, w_top はピック済み


def test_order_by_topmost_sorts_by_z_desc():
    scene = _bin_scene()
    ordered = order_by_topmost(targetable_entities(scene))
    assert [e.entity_id for e in ordered] == ["w_top", "w_mid", "w_low"]


def test_order_by_topmost_tiebreak_is_deterministic():
    a = _workpiece("b_id", 0.0, 0.05, -0.60)
    b = _workpiece("a_id", 0.0, -0.05, -0.60)  # 同 z
    ordered = order_by_topmost([a, b])
    # 同 z は entity_id 昇順 (決定的)。
    assert [e.entity_id for e in ordered] == ["a_id", "b_id"]


# --- build_request (scene -> 契約 request の seam) -----------------------------


def test_build_request_is_valid_engine_contract():
    scene = _bin_scene()
    settings = _settings()
    req = build_request(scene, "w_top", settings)
    data = req.grasp_search.model_dump(by_alias=True)
    # 対象の把持点が target に載る。
    assert data["target"]["surfaceSamples"][0]["point"] == [0.0, 0.0, -0.58]
    # 導出した障害物 = 2 壁 + w_mid + w_low = 4 球 (target 除外)。
    assert len(data["obstacles"]) == 4
    assert req.grasp_search.objective_weights["grasp_stability"] == 1.0
    assert req.grasp_search.top_n == 5


def test_build_request_rejects_non_targetable():
    scene = _bin_scene()
    settings = _settings()
    with pytest.raises(ValueError):
        build_request(scene, "wall_n", settings)  # 壁は対象にできない


# --- ピック列 orchestration (副作用境界) --------------------------------------


def test_run_pick_sequence_picks_all_reachable_topmost_first():
    scene = _bin_scene()
    results = run_pick_sequence(scene, _settings())
    # 3 ワークすべて feasible -> 最上面順にピック。
    assert [r.target_id for r in results] == ["w_top", "w_mid", "w_low"]
    assert all(isinstance(r, PickResult) and r.picked for r in results)
    # 各回 rank 1 は top-down (approach ~ [0,0,-1])。契約 v2 では approach は
    # ワイヤに載らず frame(-Z) から導出する -> codec で復元して意味を照合する。
    top = results[0].response.candidates[0]
    assert math.isclose(pose_from_payload(top.pose).approach.z, -1.0, abs_tol=1e-6)


def test_run_pick_sequence_obstacle_set_shrinks_each_pick():
    scene = _bin_scene()
    results = run_pick_sequence(scene, _settings())
    obstacle_counts = [len(r.request.grasp_search.obstacles) for r in results]
    # 2 壁 (常時) + 残りワーク。w_top 回=2壁+2ワーク=4, 次=3, 次=2。
    assert obstacle_counts == [4, 3, 2]


def test_run_pick_sequence_terminates_with_infeasible_remainder():
    """届かないワークが残っても無限ループせず終了する (picked 単調増加が上界)。"""
    scene = Scene(
        entities=(
            _workpiece("w_near", 0.0, 0.0, -0.58),
            _workpiece("w_far", 0.0, 0.0, -2.0),  # reach_max 0.95 外 -> feasible でない
        )
    )
    results = run_pick_sequence(scene, _settings())
    assert [r.target_id for r in results] == ["w_near"]  # 届くものだけ


def test_run_pick_sequence_respects_max_picks():
    scene = _bin_scene()
    results = run_pick_sequence(scene, _settings(), max_picks=1)
    assert [r.target_id for r in results] == ["w_top"]
