"""テンプレ (レイヤ C) の受け入れテスト。

`templates/` の完成テンプレが、段階0 エンジン (`core/`) でそのまま実行でき、手検証メモ
どおりの結果 (中心 top-down が最上位 / 安い順フィルタ通過 / 契約準拠) になることを自動で
押さえる。templates/README.md の「手検証 -> core/ の受け入れテスト」経路の実体。
"""

import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator

from contract_pkg import load_response_schema

from easy_extrude_core.contract import GraspSearchRequest
from easy_extrude_core.engine import pipeline, pose_from_payload

# core/tests/ -> core/ -> repo root。テンプレは repo root 直下 templates/。
_REPO_ROOT = Path(__file__).resolve().parents[2]
_TEMPLATE = (
    _REPO_ROOT
    / "templates"
    / "bin-picking-thin-container"
    / "grasp-search.request.json"
)


def _load_request() -> GraspSearchRequest:
    raw = json.loads(_TEMPLATE.read_text(encoding="utf-8"))
    return GraspSearchRequest.model_validate(raw)


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
    # 通過候補なので 3 判定はすべて True。
    for c in resp.candidates:
        assert c.score.within_reach
        assert c.score.ik_solvable
        assert c.score.interference_free


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
