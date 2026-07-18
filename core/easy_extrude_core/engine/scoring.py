"""加重和スコア (純粋・副作用なし)。ADR-075: 正規化済み objective 値の重み付き和。

総合スコアは「重みの総和で割った加重平均」にする (= 0-1 に収める)。理由:
- objectiveScores は各 0-1。素の加重和 sum(w*s) は重みの総和に依存して上限が動き、
  テンプレ間 (重み構成が違う) で比較しづらい。重み総和で割れば常に 0-1 に収まり、
  絶対基準の比較可能性 (ADR-074/002 の狙い) を総合スコアでも保てる。
- 契約 (totalScore >= 0) を満たしつつ上限 1 も保証できる。

重みは非負前提 (DSL の objectiveWeights)。重み総和が 0 (または該当 objective が無い) なら
0 を返す (ゼロ割り回避)。
"""

from __future__ import annotations


def weighted_sum(
    objective_scores: dict[str, float], weights: dict[str, float]
) -> float:
    """正規化済み objective スコアの加重平均 (0-1)。

    weights に在って objective_scores に無いキーは寄与 0 (評価不能な objective)。
    objective_scores に在って weights に無いキーは無視 (重み未指定 = 採点しない)。
    """
    total = 0.0
    weight_sum = 0.0
    for name, w in weights.items():
        weight_sum += w
        s = objective_scores.get(name)
        if s is not None:
            total += w * s
    if weight_sum <= 0.0:
        return 0.0
    return total / weight_sum
