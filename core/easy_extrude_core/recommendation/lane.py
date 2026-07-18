"""推薦/類似レーンの orchestration (副作用境界)。ADR-077 §2 / §4。

    要件文 + 参照候補 (+ public 決定論的出力) -> [注入 model で生信号] -> 絶対基準 0-1 正規化
      -> 等価性候補の組み立て -> 決定論的ランキング -> 上位N件

この層だけが副作用 (注入された similarity model = 外部 embedding service になり得る) を
持つ。正規化・候補組み立て・ランキングは純粋関数 (他モジュール) に委譲する
(engine.pipeline.search と同形)。

不変条件 (壁の番人, ADR-077 §5):
**lane は等価性候補を propose するだけで decide しない**。返り値 EquivalenceProposal は
真偽値を持たず、`never decides equivalence inside the core` を型で担保する。

注意 (ADR-077 Still deferred): HTTP エンドポイント配線 (/recommendation 等) と
contractVersion 設計、ADR-056 確定後の入力 wire 形の pydantic 配線は後続に defer する。
本関数はドメイン純粋型を入出力する計算境界に徹する (api 層は載せない)。
"""

from __future__ import annotations

from collections.abc import Sequence

from ..contract import (
    EquivalenceProposalWire,
    ProposalEvidenceWire,
    RecommendationRequest,
    RecommendationResponse,
)
from .normalization import normalize_signals
from .ranking import DEFAULT_SIMILARITY_WEIGHTS, build_proposal, rank_proposals
from .similarity import NaiveLexicalSimilarityModel, SimilarityModel
from .types import (
    CanonicalSignature,
    EquivalenceProposal,
    ReferenceCandidate,
    RequirementQuery,
    StructuralDiff,
)


def propose(
    query: RequirementQuery,
    candidates: Sequence[ReferenceCandidate],
    *,
    model: SimilarityModel | None = None,
    weights: dict[str, float] | None = None,
    top_n: int | None = None,
) -> tuple[EquivalenceProposal, ...]:
    """要件文に対する等価性 *候補* を rank 昇順で propose する (副作用境界)。

    model は注入可能 (省略時は外部依存ゼロの naive 既定)。各候補について生信号を取り、
    絶対基準で 0-1 正規化し、提案を組み、決定論的に並べて上位 N 件を返す。

    **真偽値は返さない**: 等価性を decide するのは public の canonical form。ここは候補の
    ランキングを提案するだけ (ADR-077 §1/§5)。
    """
    similarity_model = model if model is not None else NaiveLexicalSimilarityModel()
    similarity_weights = weights if weights is not None else DEFAULT_SIMILARITY_WEIGHTS

    proposals = []
    for candidate in candidates:
        raw = similarity_model.score(query, candidate)  # 副作用はここだけ (外部 model)
        signals = normalize_signals(raw, candidate.diff)
        proposals.append(build_proposal(candidate.ref_id, signals, similarity_weights))

    return rank_proposals(proposals, top_n=top_n)


# --- 契約 wire <-> ドメインの adapter (engine.pipeline と同形) ------------------
#
# wire の canonical signature は不透明文字列、structural diff の distance は public が
# decide した 0-1 値として消費する (再計算しない)。contractVersion 検証はエンドポイント層の
# 責務 (ADR-076)。ここは検証済み契約を受け取る計算に徹する。


def _query_from_wire(request: RecommendationRequest) -> RequirementQuery:
    w = request.requirement
    signature = CanonicalSignature(value=w.signature) if w.signature is not None else None
    return RequirementQuery(text=w.text, signature=signature)


def _candidates_from_wire(request: RecommendationRequest) -> list[ReferenceCandidate]:
    out: list[ReferenceCandidate] = []
    for c in request.references:
        diff = (
            StructuralDiff(distance=c.diff.distance, detail=c.diff.detail)
            if c.diff is not None
            else None
        )
        out.append(
            ReferenceCandidate(
                ref_id=c.ref_id,
                text=c.text,
                signature=CanonicalSignature(value=c.signature),
                diff=diff,
            )
        )
    return out


def _proposal_to_wire(p: EquivalenceProposal) -> EquivalenceProposalWire:
    # 真偽値は載せない (evidence も連続値のみ)。壁の番人を wire 境界まで貫く。
    return EquivalenceProposalWire(
        rank=p.rank,
        ref_id=p.ref_id,
        similarity=p.similarity,
        structural_distance=p.structural_distance,
        confidence=p.confidence,
        evidence=ProposalEvidenceWire(
            semantic=p.evidence.semantic,
            lexical=p.evidence.lexical,
            structural_distance=p.evidence.structural_distance,
            structural_support=p.evidence.structural_support,
            notes=p.evidence.notes,
        ),
    )


def recommend(
    request: RecommendationRequest,
    *,
    model: SimilarityModel | None = None,
) -> RecommendationResponse:
    """契約 RecommendationRequest -> RecommendationResponse (副作用境界)。

    wire をドメインに写し、`propose` で等価性候補を rank し、wire 形に戻す。model は注入可能
    (省略時は naive 既定)。**真偽値は返さない** (propose のみ, ADR-077 §5)。

    注: contractVersion 検証はエンドポイント層の責務 (ADR-074/003)。ここでは行わない。
    """
    query = _query_from_wire(request)
    candidates = _candidates_from_wire(request)
    proposals = propose(
        query,
        candidates,
        model=model,
        weights=request.similarity_weights,
        top_n=request.top_n,
    )
    return RecommendationResponse(
        proposals=[_proposal_to_wire(p) for p in proposals],
    )
