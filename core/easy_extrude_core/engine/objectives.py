"""objective 評価 + 絶対基準 0-1 正規化 (純粋・副作用なし)。

ADR-075 / ADR-074 の不変条件: objective は **絶対基準** で 0-1 に正規化してから
重み付けする。絶対基準にする理由 = テンプレ間でスコアを比較可能にする (= 商品価値)。
相対正規化 (その回の候補集合の min/max で割る) は禁止 (候補集合が変わると基準が動き
比較できなくなる)。

純粋関数のみ。各 objective は (raw 計算) -> (NormSpec で 0-1 化) の 2 段。raw の絶対上下限
(NormSpec) は指標ごとに固定値として明示する (ADR-075 Open 論点「objective 正規化」)。
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Callable

from .types import GraspCandidate, Problem, clamp, distance_point_to_segment


@dataclass(frozen=True)
class NormSpec:
    """raw 値を 0-1 に写す絶対基準。lo 以下で 0、hi 以上で 1、間は線形。

    lo < hi を前提。退化 (lo>=hi) はゼロ割りを避けて 0 を返す (数値的安定性優先)。
    """

    lo: float
    hi: float

    def normalize(self, raw: float) -> float:
        span = self.hi - self.lo
        if span <= 0.0:
            return 0.0
        return clamp((raw - self.lo) / span, 0.0, 1.0)


# raw 指標を計算する純粋関数の型。
RawEvaluator = Callable[[GraspCandidate, Problem], float]


# --- 組み込み objective の raw 計算 (純粋) -----------------------------------


def _raw_reach_margin(candidate: GraspCandidate, problem: Problem) -> float:
    """到達域 [reach_min, reach_max] の縁からの余裕 (近いほど小, 中央で最大)。

    余裕が大きい = 特異点/可動限界から遠い素朴な代理。within_reach を通った候補が前提
    なので非負。
    """
    r = candidate.pose.position.distance_to(problem.robot.base)
    robot = problem.robot
    return min(r - robot.reach_min, robot.reach_max - r)


def _raw_grasp_stability(candidate: GraspCandidate, problem: Problem) -> float:
    """安定把持の素朴な代理: 進入方向が表面法線の逆向きにどれだけ揃っているか。

    raw = dot(-approach, normal) in [-1, 1]。正対 (法線にまっすぐ進入) で 1。将来は
    wrench cone 計算に差し替える (ADR-075 Open 論点「把持安定性」) が、契約境界は
    0-1 正規化値のままで変わらない。
    """
    approach = candidate.pose.approach.normalized()
    normal = candidate.surface_normal.normalized()
    return approach.scaled(-1.0).dot(normal)


def _raw_approach_clearance(candidate: GraspCandidate, problem: Problem) -> float:
    """進入経路から最も近い障害物までの最短距離 (大きいほど安全)。障害物無しは +inf 相当。"""
    a = candidate.pre_grasp
    b = candidate.pose.position
    if not problem.obstacles:
        # 障害物が無ければクリアランスは基準上限 (満点) でよい。
        return problem.clearance_reference
    return min(
        distance_point_to_segment(obs.center, a, b) - obs.radius
        for obs in problem.obstacles
    )


@dataclass(frozen=True)
class ObjectiveDef:
    """objective 1 種の定義 = raw 計算 + 絶対基準 NormSpec。"""

    raw: RawEvaluator
    spec_for: Callable[[Problem], NormSpec]


# 組み込み objective レジストリ。キーは DSL 宣言の objectiveWeights / 契約の
# objectiveScores のキーと一致する。NormSpec は problem パラメータから引く (基準が
# 問題サイズに依存する指標があるため。ただし「その回の候補集合」には依存しない =
# 絶対基準は保つ)。
OBJECTIVE_REGISTRY: dict[str, ObjectiveDef] = {
    "reach_margin": ObjectiveDef(
        raw=_raw_reach_margin,
        # 余裕の絶対上限 = 到達域の半幅 (中央で最大余裕)。
        spec_for=lambda p: NormSpec(
            lo=0.0, hi=max((p.robot.reach_max - p.robot.reach_min) / 2.0, 0.0)
        ),
    ),
    "grasp_stability": ObjectiveDef(
        raw=_raw_grasp_stability,
        # dot は [-1,1]。逆向き (背いた進入) は 0、正対で 1。絶対基準で固定。
        spec_for=lambda p: NormSpec(lo=0.0, hi=1.0),
    ),
    "approach_clearance": ObjectiveDef(
        raw=_raw_approach_clearance,
        # clearance_reference 以上離れていれば満点。絶対基準 (問題が与える固定値)。
        spec_for=lambda p: NormSpec(lo=0.0, hi=max(p.clearance_reference, 0.0)),
    ),
}


def evaluate_objectives(
    candidate: GraspCandidate, problem: Problem, names: Iterable[str]
) -> dict[str, float]:
    """要求された objective 名について 0-1 正規化値を返す (純粋)。

    未知の objective 名は無視する (DSL が将来 objective を増やしても素朴版は壊れない)。
    返り値のキーは契約 ScoreBreakdown.objectiveScores にそのまま載る。
    """
    out: dict[str, float] = {}
    for name in names:
        definition = OBJECTIVE_REGISTRY.get(name)
        if definition is None:
            continue
        raw = definition.raw(candidate, problem)
        out[name] = definition.spec_for(problem).normalize(raw)
    return out
