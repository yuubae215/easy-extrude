"""生信号 -> 絶対基準 0-1 正規化 (純粋・副作用なし)。ADR-077 §3 / ADR-075 §3 と同規律。

不変条件: 各指標は **絶対基準** で 0-1 に正規化してから扱う。相対正規化 (その回の候補集合の
min/max で割る) は禁止 (候補集合が変わると基準が動き、テンプレ間で比較できなくなる =
商品価値を損なう)。engine.objectives の NormSpec と同じ思想。

注意 (ADR-077 Still deferred): ここで使う絶対基準 (METRIC_SPECS) は素朴版の **暫定値**。
本物の embedding model のスコア分布に合わせた基準値の確定は後続セッションに defer する。
0.x 精神で「まず動く素朴版」を置き、基準は見直し可能とする。
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import RawSimilarity, StructuralDiff

# public が構造距離を出していないときの保守的な既定 (最も遠い = 構造的裏付けなし)。
_NO_STRUCTURAL_EVIDENCE_DISTANCE = 1.0


def _clamp(x: float, lo: float, hi: float) -> float:
    """x を [lo, hi] に収める (engine.types.clamp と同じ NaN 非伝播の素直な実装)。"""
    if x < lo:
        return lo
    if x > hi:
        return hi
    return x


@dataclass(frozen=True)
class NormSpec:
    """raw 値を 0-1 に写す絶対基準。lo 以下で 0, hi 以上で 1, 間は線形。

    engine.objectives.NormSpec と同一仕様 (退化 lo>=hi はゼロ割りを避けて 0)。レーンを
    engine から独立して読めるよう意図的に再掲する (両者の規律が同型であることの明示)。
    """

    lo: float
    hi: float

    def normalize(self, raw: float) -> float:
        span = self.hi - self.lo
        if span <= 0.0:
            return 0.0
        return _clamp((raw - self.lo) / span, 0.0, 1.0)


# 指標ごとの絶対基準 (暫定)。
# - semantic: cosine 等 [-1,1] を想定し、正の相関 [0,1] を採る (負相関は 0 にクランプ)。
# - lexical : token Jaccard はそのまま [0,1]。
# - structural_distance: public が既に 0-1 で出すので恒等的に通す ([0,1])。
METRIC_SPECS: dict[str, NormSpec] = {
    "semantic": NormSpec(lo=0.0, hi=1.0),
    "lexical": NormSpec(lo=0.0, hi=1.0),
    "structural_distance": NormSpec(lo=0.0, hi=1.0),
}


@dataclass(frozen=True)
class NormalizedSignals:
    """1 候補ぶんの正規化済み信号 (すべて絶対基準 0-1)。ranking の純粋入力。

    `structural_support` は public 構造証拠の有無 (1=public が距離を出した, 0=未提供)。
    距離そのものとは別に「裏付けの有無」を持つことで、confidence が証拠不足を反映できる。
    """

    semantic: float
    lexical: float
    structural_distance: float
    structural_support: float


def normalize_signals(raw: RawSimilarity, diff: StructuralDiff | None) -> NormalizedSignals:
    """生 similarity 信号 + public structural diff を絶対基準 0-1 に正規化する (純粋)。

    public が構造距離を出していない (diff が None / distance が None) 場合は、構造距離を
    保守的に最遠 (1.0) とみなし、structural_support を 0 にする (裏付けなしを confidence に
    伝える)。距離は public の決定論的出力をそのまま消費し、再計算しない (lane は decide しない)。
    """
    semantic = METRIC_SPECS["semantic"].normalize(raw.semantic)
    lexical = METRIC_SPECS["lexical"].normalize(raw.lexical)

    if diff is not None and diff.distance is not None:
        structural_distance = METRIC_SPECS["structural_distance"].normalize(diff.distance)
        structural_support = 1.0
    else:
        structural_distance = _NO_STRUCTURAL_EVIDENCE_DISTANCE
        structural_support = 0.0

    return NormalizedSignals(
        semantic=semantic,
        lexical=lexical,
        structural_distance=structural_distance,
        structural_support=structural_support,
    )
