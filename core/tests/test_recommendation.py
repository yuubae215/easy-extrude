"""推薦/類似レーン (ADR-077) のテスト。

素朴版の規律「動く素朴版 -> テスト」に従い、まず壁の番人 (propose のみ・真偽値を返さない)、
絶対基準正規化、決定論的ランキング、Protocol 注入境界、public 構造証拠の消費を押さえる。
純粋関数 (正規化 / ランキング) と orchestration (副作用境界 propose) を分けて検証する。
"""

import dataclasses

from easy_extrude_core.recommendation import (
    METRIC_SPECS,
    CanonicalSignature,
    EquivalenceProposal,
    NaiveLexicalSimilarityModel,
    NormSpec,
    RawSimilarity,
    ReferenceCandidate,
    RequirementQuery,
    StructuralDiff,
    build_proposal,
    normalize_signals,
    propose,
    rank_proposals,
    weighted_average,
)
from easy_extrude_core.recommendation.normalization import NormalizedSignals


def _candidate(ref_id: str, text: str, distance=None) -> ReferenceCandidate:
    diff = StructuralDiff(distance=distance) if distance is not None else None
    return ReferenceCandidate(
        ref_id=ref_id,
        text=text,
        signature=CanonicalSignature(value=f"sig:{ref_id}"),
        diff=diff,
    )


# --- 壁の番人 (propose のみ・等価性を decide しない) --------------------------


def test_proposal_has_no_boolean_decision_field():
    # 不変条件: EquivalenceProposal は真偽値 (等価か否か) を **持たない**。
    # bool フィールドが紛れ込んだ瞬間に lane が decide 側へ踏み込み壁が溶ける (ADR-077 §5)。
    field_types = {f.name: f.type for f in dataclasses.fields(EquivalenceProposal)}
    assert not any("bool" in str(t).lower() for t in field_types.values())
    assert "equivalent" not in field_types
    assert "is_equivalent" not in field_types


# --- 絶対基準 0-1 正規化 ------------------------------------------------------


def test_normspec_clamps_to_unit_interval():
    spec = NormSpec(lo=0.0, hi=2.0)
    assert spec.normalize(-1.0) == 0.0
    assert spec.normalize(1.0) == 0.5
    assert spec.normalize(3.0) == 1.0
    # 退化 (lo>=hi) はゼロ割りせず 0。
    assert NormSpec(lo=1.0, hi=1.0).normalize(0.5) == 0.0


def test_semantic_spec_clamps_negative_cosine_to_zero():
    # embedding cosine の負相関 (-0.5) は 0 にクランプ (絶対基準 [0,1])。
    raw = RawSimilarity(semantic=-0.5, lexical=0.4)
    signals = normalize_signals(raw, diff=None)
    assert signals.semantic == 0.0
    assert signals.lexical == METRIC_SPECS["lexical"].normalize(0.4)


def test_missing_public_diff_is_conservative_no_support():
    # public が構造距離を出していない -> 最遠 (1.0) + 裏付けなし (support=0)。
    raw = RawSimilarity(semantic=0.9, lexical=0.9)
    signals = normalize_signals(raw, diff=None)
    assert signals.structural_distance == 1.0
    assert signals.structural_support == 0.0


def test_public_diff_distance_is_consumed_not_recomputed():
    # public が出した 0-1 距離をそのまま消費 (lane は再計算しない = decide しない)。
    raw = RawSimilarity(semantic=0.5, lexical=0.5)
    signals = normalize_signals(raw, diff=StructuralDiff(distance=0.2))
    assert signals.structural_distance == 0.2
    assert signals.structural_support == 1.0


# --- ランキング / 確信度 (純粋, propose のみ) --------------------------------


def test_weighted_average_is_normalized_and_handles_zero_weights():
    assert weighted_average({"a": 1.0, "b": 0.0}, {"a": 3.0, "b": 1.0}) == 0.75
    assert weighted_average({"a": 1.0}, {}) == 0.0


def test_confidence_drops_without_structural_support():
    # 信号が完全一致でも、public 構造裏付けが無ければ確信度は頭打ち (= agreement/2)。
    supported = NormalizedSignals(
        semantic=0.8, lexical=0.8, structural_distance=0.1, structural_support=1.0
    )
    unsupported = NormalizedSignals(
        semantic=0.8, lexical=0.8, structural_distance=1.0, structural_support=0.0
    )
    p_sup = build_proposal("a", supported, {"semantic": 1.0, "lexical": 1.0})
    p_unsup = build_proposal("b", unsupported, {"semantic": 1.0, "lexical": 1.0})
    assert p_sup.confidence > p_unsup.confidence
    # agreement=1 (一致), support=1/0 -> mean = 1.0 / 0.5。
    assert p_sup.confidence == 1.0
    assert p_unsup.confidence == 0.5


def test_rank_proposals_is_deterministic_and_assigns_rank():
    a = build_proposal(
        "a",
        NormalizedSignals(semantic=0.9, lexical=0.9, structural_distance=0.1, structural_support=1.0),
        {"semantic": 0.7, "lexical": 0.3},
    )
    b = build_proposal(
        "b",
        NormalizedSignals(semantic=0.2, lexical=0.2, structural_distance=0.5, structural_support=1.0),
        {"semantic": 0.7, "lexical": 0.3},
    )
    ranked = rank_proposals([b, a])  # 入力順に依らず similarity 降順で並ぶ。
    assert [p.ref_id for p in ranked] == ["a", "b"]
    assert [p.rank for p in ranked] == [1, 2]


def test_rank_tie_breaks_by_structural_distance_then_ref_id():
    # similarity 同点 -> structural_distance 昇順 -> ref_id 昇順 で決定論的に割る。
    base = dict(semantic=0.5, lexical=0.5, structural_support=1.0)
    near = build_proposal("z", NormalizedSignals(structural_distance=0.1, **base), {"semantic": 1.0})
    far = build_proposal("a", NormalizedSignals(structural_distance=0.9, **base), {"semantic": 1.0})
    ranked = rank_proposals([far, near])
    # similarity 同点だが near (structural_distance 小) が先。
    assert [p.ref_id for p in ranked] == ["z", "a"]


# --- orchestration (副作用境界) ---------------------------------------------


def test_propose_ranks_candidates_by_text_overlap_with_naive_model():
    query = RequirementQuery(text="pick small metal bracket from bin")
    candidates = [
        _candidate("near", "pick small metal bracket from the bin", distance=0.1),
        _candidate("far", "weld large plastic panel onto frame", distance=0.8),
    ]
    proposals = propose(query, candidates)
    assert [p.ref_id for p in proposals] == ["near", "far"]
    assert [p.rank for p in proposals] == [1, 2]
    assert proposals[0].similarity > proposals[1].similarity
    # すべて 0-1 に収まる。
    for p in proposals:
        assert 0.0 <= p.similarity <= 1.0
        assert 0.0 <= p.structural_distance <= 1.0
        assert 0.0 <= p.confidence <= 1.0


def test_propose_respects_top_n():
    query = RequirementQuery(text="alpha beta gamma")
    candidates = [
        _candidate("a", "alpha beta gamma"),
        _candidate("b", "alpha beta"),
        _candidate("c", "delta"),
    ]
    assert len(propose(query, candidates, top_n=2)) == 2


def test_injected_model_overrides_naive():
    # 常に最大類似を返す model を注入 -> 注入境界が効くことの確認 (engine と同形)。
    class _AlwaysMax:
        def score(self, query, candidate):
            return RawSimilarity(semantic=1.0, lexical=1.0)

    query = RequirementQuery(text="nothing in common")
    candidates = [_candidate("x", "totally different words", distance=0.0)]
    proposals = propose(query, candidates, model=_AlwaysMax())
    assert proposals[0].similarity == 1.0


def test_naive_model_is_deterministic():
    model = NaiveLexicalSimilarityModel()
    query = RequirementQuery(text="repeatable input")
    cand = _candidate("x", "repeatable input here")
    assert model.score(query, cand) == model.score(query, cand)


def test_propose_returns_proposals_never_booleans():
    # 出力は等価性候補 (連続値) のみ。真偽値は一切返らない (壁の番人, ランタイム確認)。
    query = RequirementQuery(text="grasp the part")
    proposals = propose(query, [_candidate("a", "grasp the part", distance=0.0)])
    assert all(isinstance(p, EquivalenceProposal) for p in proposals)
    assert all(not isinstance(p, bool) for p in proposals)
