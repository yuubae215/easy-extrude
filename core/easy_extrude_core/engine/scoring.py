"""加重和スコア (純粋・副作用なし)。ADR-075: 正規化済み objective 値の重み付き和。

総合スコアは「重みの総和で割った加重平均」にする (= 0-1 に収める)。理由:
- objectiveScores は各 0-1。素の加重和 sum(w*s) は重みの総和に依存して上限が動き、
  テンプレ間 (重み構成が違う) で比較しづらい。重み総和で割れば常に 0-1 に収まり、
  絶対基準の比較可能性 (ADR-074/002 の狙い) を総合スコアでも保てる。
- 契約 (totalScore >= 0) を満たしつつ上限 1 も保証できる。

**分母は「評価できた objective の重み」だけ (ADR-120 D1)。** 評価できなかった objective
(= `objective_scores` に鍵が無い) を分母に満額・分子に 0 で置くと、「測れなかった」が
「0 点」として総合スコアを押し下げる。それは契約が明言する「絶対基準なのでリクエスト間で
比較可能」を静かに壊す — 同じ候補が、無関係な objective を宣言したかどうかで別の点数に
なるため。評価できたものだけで割れば、測れなかった軸は結果に**寄与しない**。

重みは非負前提 (DSL の objectiveWeights)。評価できた objective が 1 つも無ければ 0 を返す
(ゼロ割り回避)。この 0 は「全部 0 点」と同じ数だが、区別は `objectiveScores` が空である
ことが運ぶ — 値ではなく**鍵の有無**が答える (ADR-120 D2)。
"""

from __future__ import annotations


def weighted_sum(
    objective_scores: dict[str, float], weights: dict[str, float]
) -> float:
    """正規化済み objective スコアの加重平均 (0-1)。**評価できた重みだけで割る。**

    weights に在って objective_scores に無いキーは **評価不能** — 分子にも分母にも
    入れない (寄与 0 ではなく、そもそも平均を取る母集団に入らない)。
    objective_scores に在って weights に無いキーは無視 (重み未指定 = 採点しない)。
    """
    total = 0.0
    weight_sum = 0.0
    for name, w in weights.items():
        s = objective_scores.get(name)
        if s is None:
            continue
        weight_sum += w
        total += w * s
    if weight_sum <= 0.0:
        return 0.0
    return total / weight_sum
