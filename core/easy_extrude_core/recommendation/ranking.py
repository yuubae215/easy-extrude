"""正規化済み信号 -> 等価性候補の組み立て + ランキング (純粋・副作用なし)。ADR-077 §2。

ここは propose だけを行う純粋層。**真偽値 (等価か否か) を一切返さない**。
similarity / structural_distance / confidence の連続値と、その順位付けに徹する。

- similarity: semantic / lexical の絶対基準 0-1 値の加重平均 (重み総和で割り 0-1 に収める。
  engine.scoring.weighted_sum と同じ「比較可能性のための加重平均」)。
- confidence: 信号の整合 (semantic と lexical の一致度) と public 構造裏付けの平均。
  証拠が食い違う / 構造裏付けが無い候補は確信度が下がる。
- 並べ替えは決定論的: similarity 降順 -> structural_distance 昇順 -> ref_id 昇順。
"""

from __future__ import annotations

from collections.abc import Iterable

from .normalization import NormalizedSignals
from .types import EquivalenceProposal, ProposalEvidence

# similarity を組む際の既定重み (絶対基準, 暫定 = ADR-077 Still deferred)。
# semantic 偏重: 字面より意味の対応づけを重視する素朴な既定。
DEFAULT_SIMILARITY_WEIGHTS: dict[str, float] = {"semantic": 0.7, "lexical": 0.3}


def weighted_average(values: dict[str, float], weights: dict[str, float]) -> float:
    """0-1 値の加重平均 (0-1)。重み総和で割り上限 1 を保つ (engine.scoring と同思想)。

    weights に在って values に無いキーは寄与 0。重み総和 0 はゼロ割りを避けて 0。
    """
    total = 0.0
    weight_sum = 0.0
    for name, w in weights.items():
        weight_sum += w
        v = values.get(name)
        if v is not None:
            total += w * v
    if weight_sum <= 0.0:
        return 0.0
    return total / weight_sum


def _confidence(signals: NormalizedSignals) -> float:
    """提案への確信度 (0-1, 純粋)。

    = mean(agreement, structural_support)。
    - agreement = 1 - |semantic - lexical|: 2 信号が一致するほど高い (食い違いは確信を下げる)。
    - structural_support: public 構造裏付けの有無 (1/0)。裏付けが無ければ確信度は頭打ち。
    確信度が高い = 等価候補として推せる、だが **等価と decide はしない** (propose のみ)。
    """
    agreement = 1.0 - abs(signals.semantic - signals.lexical)
    return (agreement + signals.structural_support) / 2.0


def build_proposal(
    ref_id: str,
    signals: NormalizedSignals,
    weights: dict[str, float],
) -> EquivalenceProposal:
    """正規化済み信号から等価性候補 1 件を組む (純粋, rank は未付与=0)。"""
    similarity = weighted_average(
        {"semantic": signals.semantic, "lexical": signals.lexical}, weights
    )
    confidence = _confidence(signals)
    evidence = ProposalEvidence(
        semantic=signals.semantic,
        lexical=signals.lexical,
        structural_distance=signals.structural_distance,
        structural_support=signals.structural_support,
        notes=(
            "structural evidence from public diff"
            if signals.structural_support >= 1.0
            else "no public structural evidence; structural_distance is conservative"
        ),
    )
    return EquivalenceProposal(
        ref_id=ref_id,
        similarity=similarity,
        structural_distance=signals.structural_distance,
        confidence=confidence,
        evidence=evidence,
    )


def rank_proposals(
    proposals: Iterable[EquivalenceProposal], top_n: int | None = None
) -> tuple[EquivalenceProposal, ...]:
    """提案を決定論的に並べ替え、rank を 1.. で振り、上位 N 件を返す (純粋)。

    並び順: similarity 降順 -> structural_distance 昇順 (構造的に近い方を優先) ->
    ref_id 昇順 (同点を決定論的に割る)。top_n=None は全件。
    """
    ordered = sorted(
        proposals,
        key=lambda p: (-p.similarity, p.structural_distance, p.ref_id),
    )
    if top_n is not None:
        ordered = ordered[:top_n]
    return tuple(
        EquivalenceProposal(
            ref_id=p.ref_id,
            similarity=p.similarity,
            structural_distance=p.structural_distance,
            confidence=p.confidence,
            evidence=p.evidence,
            rank=i + 1,
        )
        for i, p in enumerate(ordered)
    )
