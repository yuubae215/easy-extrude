"""templates/ 完成テンプレの受け入れテスト。

`templates/` の完成テンプレが、段階0 エンジン (`core/`) でそのまま実行でき、手検証メモ
どおりの結果 (中心 top-down が最上位 / ドメイン段階フィルタ通過 / 契約準拠) になることを
自動で押さえる。templates/README.md の「手検証 -> core/ の受け入れテスト」経路の実体。

ADR-081 Decision 4: 正本は scene 形式 (`pick-sequence.request.json`)。単発の
`grasp-search.request.json` は導出値のピン留めで、scene からの導出と一致することを
回帰テストで固定する (手書き再構築の禁止)。3 ドメイン (見える/届く/掴める) の手検証値と
L3 リスク再現例 (カメラを壁側に寄せると可視率が落ちる) もここで固定する。
"""

import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator

from contract_pkg import load_response_schema

from easy_extrude_core.contract import GraspSearchRequest, PickSequenceRequest
from easy_extrude_core.engine import pipeline, pose_from_payload
from easy_extrude_core.scene import pick_sequence, run_pick_sequence
from easy_extrude_core.scene.orchestration import (
    _scene_from_wire,
    _settings_from_wire,
)

# core/tests/ -> core/ -> repo root。テンプレは repo root 直下 templates/。
_REPO_ROOT = Path(__file__).resolve().parents[2]
_TEMPLATE_DIR = _REPO_ROOT / "templates" / "bin-picking-thin-container"
_TEMPLATE = _TEMPLATE_DIR / "grasp-search.request.json"
_SCENE_TEMPLATE = _TEMPLATE_DIR / "pick-sequence.request.json"


def _load_request() -> GraspSearchRequest:
    raw = json.loads(_TEMPLATE.read_text(encoding="utf-8"))
    return GraspSearchRequest.model_validate(raw)


def _load_scene_request() -> PickSequenceRequest:
    raw = json.loads(_SCENE_TEMPLATE.read_text(encoding="utf-8"))
    return PickSequenceRequest.model_validate(raw)


def test_thin_container_template_runs_and_ranks():
    """テンプレ入力でエンジンが候補を返し、rank と総合スコアが整合する。"""
    resp = pipeline.search(_load_request())

    assert resp.candidates, "テンプレは少なくとも 1 件の把持候補を返すはず"
    # rank は 1.. の連番、topN (=5) 以内。
    ranks = [c.rank for c in resp.candidates]
    assert ranks == list(range(1, len(resp.candidates) + 1))
    assert len(resp.candidates) <= 5
    # 総合スコアは降順 (rank 昇順 = score 降順)。
    scores = [c.score.total_score for c in resp.candidates]
    assert scores == sorted(scores, reverse=True)
    # 通過候補なので 5 判定 (見える/届く 3 種/掴める) はすべて True。
    for c in resp.candidates:
        assert c.score.within_reach
        assert c.score.visible
        assert c.score.ik_solvable
        assert c.score.interference_free
        assert c.score.graspable


def test_thin_container_top_pick_is_top_down():
    """手検証メモ: 中心 top-down (approach ~ [0,0,-1]) が rank 1。"""
    resp = pipeline.search(_load_request())
    top = resp.candidates[0]
    # 契約 v2: approach はワイヤに載らず frame(-Z) から導出。codec で復元して意味を照合。
    approach = pose_from_payload(top.pose).approach
    # 真下向き: x,y ~ 0, z ~ -1。
    assert abs(approach.x) < 1e-6
    assert abs(approach.y) < 1e-6
    assert math.isclose(approach.z, -1.0, abs_tol=1e-6)
    # top-down は安定把持・クリアランスとも満点付近なので総合スコアが高い。
    assert top.score.objective_scores["grasp_stability"] > 0.99
    assert top.score.total_score > 0.9


def test_thin_container_response_conforms_to_schema():
    """応答が中立 JSON Schema (grasp-search-response) に準拠する。"""
    resp = pipeline.search(_load_request())
    payload = resp.model_dump(by_alias=True)
    Draft202012Validator(load_response_schema()).validate(payload)


# --- scene 形式が正本 (ADR-081 Decision 4 / ADR-078 Decision 2) ---------------


def test_scene_template_first_pick_derivation_matches_pinned_request():
    """scene 正本から導出した work-center の 1 ピック request が、ピン留めした
    grasp-search.request.json と完全一致する (obstacles 手書き廃止の回帰固定)。"""
    results = run_pick_sequence(
        _scene_from_wire(_load_scene_request()),
        _settings_from_wire(_load_scene_request()),
        max_picks=1,
    )
    assert results and results[0].target_id == "work-center"
    derived = results[0].request.model_dump(by_alias=True)
    pinned = json.loads(_TEMPLATE.read_text(encoding="utf-8"))
    assert derived["graspSearch"] == pinned["graspSearch"]
    assert derived["layoutVersion"] == pinned["layoutVersion"]
    assert derived["contractVersion"] == pinned["contractVersion"]


def test_scene_template_pick_sequence_picks_all_workpieces():
    """3 ドメイン宣言 (camera/gripper 込み) の scene で全 5 ワークがピックできる。
    各ステップの候補は 5 判定すべて True (= 3 ドメイン通し検証の完了形)。"""
    resp = pick_sequence(_load_scene_request())
    assert [p.target_id for p in resp.picks] == [
        "work-center", "work-ne", "work-nw", "work-se", "work-sw",
    ]
    for pick in resp.picks:
        assert pick.picked
        assert pick.candidates, f"{pick.target_id} は少なくとも 1 候補を持つはず"
        top = pick.candidates[0]
        assert top.score.visible and top.score.graspable
        assert top.score.within_reach and top.score.ik_solvable
        assert top.score.interference_free


def test_thin_container_domain_diagnostics_are_clean():
    """基準設定では可視/把持の棄却ゼロ (README 手検証値: 3 ドメインとも成立)。"""
    d = pipeline.search_report(_load_request()).diagnostics
    assert d.rejected_by_visibility == 0
    assert d.rejected_by_grasp == 0
    assert d.occlusion_nearest_miss is None
    assert d.opening_nearest_miss is None
    assert d.feasible > 0


def test_camera_moved_to_wall_side_drops_visibility_l3_risk():
    """L3 リスクの再現例 (ADR-081 KPI/階梯の固定ケース): カメラを壁側に寄せて
    斜めから覗くと壁リム球が視線を遮り、全候補が可視性棄却になる。"""
    raw = json.loads(_TEMPLATE.read_text(encoding="utf-8"))
    raw["graspSearch"]["camera"] = {
        "position": [0.3, 0.0, -0.52],
        # ビン中央へ向けた視軸 (FOV 内に対象を収めたまま、遮蔽だけを起こす)。
        "viewAxis": [-0.3, 0.0, -0.08],
        "fovHalfAngle": 0.6,
    }
    report = pipeline.search_report(GraspSearchRequest.model_validate(raw))
    d = report.diagnostics
    assert report.response.candidates == []
    assert d.feasible == 0
    assert d.rejected_by_visibility == d.candidates_generated > 0
    # 遮蔽量は測定可能 (壁リム球の食い込み) -> occlusion near-miss が立つ。
    assert d.occlusion_nearest_miss is not None
    assert d.occlusion_nearest_miss > 0.0
