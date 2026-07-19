"""推薦/類似レーン (バックエンドレイヤのコア実装)。ADR-077。

public ADR-056 の決定論的出力 (canonical signature / structural diff / reconcile
correspondence) の **上に乗り**、曖昧な要件文を仕様候補に対応づける等価性 *候補* を
embeddings / 外部知で **propose / rank** する層。

不変条件 (壁の番人):
**core が equivalence を decide / lane は propose のみ** (`never decides equivalence
inside the core`)。出力 EquivalenceProposal は真偽値を持たず、等価性候補のランキング
(similarity / structural_distance / confidence / evidence) だけを返す。decide=public /
propose=recommendation lane の動詞境界が境界そのもの。

設計規律 (ADR-077 / ADR-075 / CLAUDE.md, engine と同形):
- 純粋関数 (正規化 / 候補組み立て / ランキング) と副作用ありの orchestration
  (`lane.propose`) を分離する。
- 外部 similarity model は Protocol 注入 (素朴版は naive な字面既定を同梱)。
- 各指標は絶対基準で 0-1 正規化してから扱う (テンプレ/モデル間比較可能性)。

公開エントリは `propose`。

後続に defer (ADR-077 Still deferred):
- 本物の embeddings / 外部サービス実装 (Protocol 差し替え)。
- ADR-056 確定後の入力 wire 形の pydantic 配線 (現状 public 出力は不透明に消費)。
- HTTP エンドポイント (/recommendation 等) と contractVersion 設計。
- 各指標 NormSpec 絶対基準の確定 (現状は素朴な暫定値)。
"""

from __future__ import annotations

from .lane import propose, recommend
from .normalization import (
    METRIC_SPECS,
    NormalizedSignals,
    NormSpec,
    normalize_signals,
)
from .ranking import (
    DEFAULT_SIMILARITY_WEIGHTS,
    build_proposal,
    rank_proposals,
    weighted_average,
)
from .similarity import NaiveLexicalSimilarityModel, SimilarityModel
from .types import (
    CanonicalSignature,
    EquivalenceProposal,
    ProposalEvidence,
    RawSimilarity,
    ReferenceCandidate,
    RequirementQuery,
    StructuralDiff,
)

__all__ = [
    # 公開エントリ (副作用境界)
    "propose",  # ドメイン純粋型 I/O
    "recommend",  # 契約 wire I/O (RecommendationRequest -> RecommendationResponse)
    # 入力ドメイン型 (public 出力を不透明に消費)
    "CanonicalSignature",
    "StructuralDiff",
    "RequirementQuery",
    "ReferenceCandidate",
    # 出力ドメイン型 (真偽値を持たない = propose のみ)
    "EquivalenceProposal",
    "ProposalEvidence",
    # similarity model の注入境界 (Protocol + naive 既定)
    "SimilarityModel",
    "NaiveLexicalSimilarityModel",
    "RawSimilarity",
    # 正規化 (純粋, 絶対基準)
    "NormSpec",
    "METRIC_SPECS",
    "NormalizedSignals",
    "normalize_signals",
    # ランキング (純粋, propose のみ)
    "build_proposal",
    "rank_proposals",
    "weighted_average",
    "DEFAULT_SIMILARITY_WEIGHTS",
]
