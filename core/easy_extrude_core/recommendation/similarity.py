"""similarity model の注入境界 (副作用を許す seam) + 素朴な既定実装。ADR-077 §3。

設計規律 (engine の feasibility.py と同形):
- 本物の embedding service / 外部 similarity model は **Protocol 注入**で差し替える。
  「外部知で類似を測る処理」はコストが高く副作用 (ネットワーク I/O) になり得るため、
  純粋コアから切り離して注入する (engine の IkSolver / CollisionChecker と同形)。
- 純粋コア (normalization / ranking) は本 Protocol だけに依存する。
- 段階0 には外部依存ゼロの naive 既定 (NaiveLexicalSimilarityModel) を同梱する。
  これは token Jaccard による素朴な字面近似で、決定論的・オフラインで動く占位実装。
  本物の embeddings は ADR-056 確定後に Protocol 差し替えで載せる (ADR-077 Still deferred)。
"""

from __future__ import annotations

import re
from typing import Protocol

from .types import RawSimilarity, ReferenceCandidate, RequirementQuery


class SimilarityModel(Protocol):
    """要件文 <-> 参照候補 の生類似信号を返す注入境界。

    実装は素朴な字面でも embeddings でも外部サービスでもよい (副作用を許す)。返すのは
    **正規化前の生値** (RawSimilarity)。0-1 化は純粋な normalization 層に委ねる。
    """

    def score(
        self, query: RequirementQuery, candidate: ReferenceCandidate
    ) -> RawSimilarity: ...


# 単語トークン化: 英数字列を小文字で拾う素朴版。日本語など分かち書きが要る言語は本物の
# embedding model (Protocol 差し替え) の領分。naive 版は ASCII 語の重なりだけ見る。
_TOKEN_RE = re.compile(r"[0-9a-z]+")


def _tokens(text: str) -> frozenset[str]:
    return frozenset(_TOKEN_RE.findall(text.lower()))


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    """Jaccard 係数 |A∩B| / |A∪B| in [0, 1]。両空集合はゼロ割りを避けて 0。"""
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


class NaiveLexicalSimilarityModel:
    """外部依存ゼロの素朴な similarity 既定実装 (token Jaccard)。

    要件文と候補文の語集合の重なりを measure する。意味 (semantic) も字面 (lexical) も
    同じ Jaccard を返す占位実装 (naive 版は意味と字面を区別できない)。本物の embedding
    model は semantic に cosine 等 [-1,1] の生値を返し、Protocol 差し替えで載る。

    決定論的・副作用なし: 同じ入力には常に同じ生値を返す (テスト可能性 / 再現性)。
    """

    def score(
        self, query: RequirementQuery, candidate: ReferenceCandidate
    ) -> RawSimilarity:
        j = _jaccard(_tokens(query.text), _tokens(candidate.text))
        return RawSimilarity(semantic=j, lexical=j)
