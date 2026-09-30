"""objective 評価 + 絶対基準 0-1 正規化 (純粋・副作用なし)。

ADR-075 / ADR-074 の不変条件: objective は **絶対基準** で 0-1 に正規化してから
重み付けする。絶対基準にする理由 = テンプレ間でスコアを比較可能にする (= 商品価値)。
相対正規化 (その回の候補集合の min/max で割る) は禁止 (候補集合が変わると基準が動き
比較できなくなる)。

純粋関数のみ。各 objective は (raw 計算) -> (NormSpec で 0-1 化) の 2 段。raw の絶対上下限
(NormSpec) は指標ごとに固定値として明示する (ADR-075 Open 論点「objective 正規化」)。

**基準が未宣言なら評価しない (ADR-120 D2)。** 0-1 に写す絶対基準がリクエストに無いとき、
その objective は「0 点」ではなく **評価不能**である。閉じたスコア層には「測れなかった」を
書く欄が無い (ADR-060 — optional 兄弟を生やさない) ので、区別を運べるのは
`objectiveScores` の **鍵の不在**だけ。よって評価不能な objective は鍵ごと出さない。
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Callable, Optional

from .types import (
    GraspCandidate,
    Problem,
    SuctionGripper,
    Vec3,
    clamp,
    distance_point_to_segment,
)


@dataclass(frozen=True)
class NormSpec:
    """raw 値を 0-1 に写す絶対基準。lo 以下で 0、hi 以上で 1、間は線形。

    **基準が無いときは値を返さない (None = 評価不能)。** span が有限かつ正でないのは
    「この指標を 0-1 に写す絶対基準がリクエストに無い」という意味であって、「余裕が
    ゼロ」ではない。かつてここは両方に 0.0 を返しており、リーチ範囲を宣言しない既定の
    リクエストでは `reach_margin` が常に 0 = 「測っていない」が「0 点」として
    `totalScore` を押し下げていた (ADR-120)。

    2 つの退化はどちらも同じ意味を持つ:
    - `span` が無限 (`reachMax` 未宣言 = `inf`) — 上限が無いので比率が定義できない。
    - `span <= 0` (lo >= hi。`clearanceReference: 0` など) — 基準の幅が無い。
    """

    lo: float
    hi: float

    def normalize(self, raw: float) -> Optional[float]:
        span = self.hi - self.lo
        if not math.isfinite(span) or span <= 0.0:
            return None
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
        obs.surface_distance_to_segment(a, b)
        for obs in problem.obstacles
    )


# --- 吸着の保持 (ADR-156) — 静力学の利用率と、物理の両端での正規化 ----------------

#: 標準重力 (m/s²)。質量 (kg) と保持力 (N) の単位をそろえるためだけに使う。
STANDARD_GRAVITY = 9.80665
#: 重力方向 (ROS world frame: +Z up)。
_DOWN = Vec3(0.0, 0.0, -1.0)


@dataclass(frozen=True)
class SuctionUtilisation:
    """1 候補の吸着の利用率 (ADR-156 D2/D3)。u < 1 ⇔ 外れない。

    - peel / slip: めくれ・すべりそれぞれの利用率。
    - u: 悪いほう (max)。
    - u_best: この対象とこのハンドの組で物理的に可能な最良 (引き剥がす向きの姿勢での下限)。
      候補に依存しない — ADR-075 の絶対基準。
    """

    peel: float
    slip: float
    u_best: float

    @property
    def u(self) -> float:
        return max(self.peel, self.slip)


def suction_utilisation(
    contact: Vec3,
    normal: Vec3,
    center_of_mass: Vec3,
    mass: float,
    cup_radius: float,
    force: float,
    friction: float,
) -> SuctionUtilisation:
    """剛体カップの静的つり合いから利用率を出す (純粋)。式の正本は docs/ALGORITHMS.md §吸着の保持。

    長さはどの単位でもよい — 長さは M_peel / r の比でしか現れないので u から消える。
    質量 (kg)・g₀ (m/s²)・保持力 (N) の単位だけがそろっていればよい。
    """
    n = normal.normalized()
    weight = _DOWN.scaled(mass * STANDARD_GRAVITY)
    f_n = -weight.dot(n)                              # 引き剥がす力 (正 = 離れる向き)
    tangential = weight - n.scaled(weight.dot(n))
    torque = (center_of_mass - contact).cross(weight)
    m_peel = (torque - n.scaled(torque.dot(n))).norm()
    peel = (f_n + m_peel / cup_radius) / force
    slip = (f_n + tangential.norm() / friction) / force
    u_best = (mass * STANDARD_GRAVITY / force) * min(1.0, 1.0 / friction)
    return SuctionUtilisation(peel=peel, slip=slip, u_best=u_best)


def suction_hold_score(u: SuctionUtilisation) -> float:
    """u = 1 を 0 点、u = u_best を 1 点に写す (ADR-156 D3)。

    **u_best ≥ 1 は評価不能ではなく全候補 0 点。** `NormSpec` に渡すと幅が 0 以下で
    None (評価不能) になり、「このハンドではどこでも外れる」という決定された事実が
    「測っていない」に化ける。だから NormSpec を通さずここで分ける。
    `score == 0 ⇔ u ≥ 1` が成り立つ (D6 — クライアントはここから「外れる」を導出する)。
    """
    if u.u_best >= 1.0:
        return 0.0
    return clamp((1.0 - u.u) / (1.0 - u.u_best), 0.0, 1.0)


def _suction_hold(candidate: GraspCandidate, problem: Problem) -> Optional[float]:
    """`suction_hold` (ADR-156)。入力が 1 つでも欠ければ None = 鍵を出さない (D4)。

    欠ける種の列挙 (原則 #31): 吸着ハンドでない (平行ジョー / ハンド未宣言) ·
    `gripper.hold` · `target.mass` · `target.centerOfMass`。どれも 0 点にも図心にも倒さない。
    カップ径が 0 の宣言も、めくれに抗う腕の長さが無く比が定義できないので評価しない。
    """
    gripper = problem.gripper
    if not isinstance(gripper, SuctionGripper) or gripper.hold is None:
        return None
    target = problem.target
    if target.mass is None or target.center_of_mass is None:
        return None
    radius = gripper.cup_diameter / 2.0
    if not radius > 0.0:
        return None
    # 接触点 = TCP から進入方向へ depth 戻した面上の点 (candidates.py の逆)。
    contact = candidate.pose.position - candidate.pose.approach.normalized().scaled(candidate.depth)
    u = suction_utilisation(
        contact=contact,
        normal=candidate.surface_normal,
        center_of_mass=target.center_of_mass.point,
        mass=target.mass,
        cup_radius=radius,
        force=gripper.hold.force,
        friction=gripper.hold.friction,
    )
    return suction_hold_score(u)


@dataclass(frozen=True)
class ObjectiveDef:
    """objective 1 種の定義 = raw 計算 + 絶対基準 NormSpec。"""

    raw: RawEvaluator
    spec_for: Callable[[Problem], NormSpec]


@dataclass(frozen=True)
class ScoredObjectiveDef:
    """0-1 を直接返す objective (ADR-156)。None = 評価不能 (鍵を出さない)。

    `ObjectiveDef` の 2 段 (raw → NormSpec) に乗らないものの型。`suction_hold` は
    両端が物理から候補ごとではなく問題ごとに決まり、しかも「幅が無い」が評価不能では
    なく決定された 0 点を意味するので、NormSpec の退化規則 (ADR-120) をそのまま使えない。
    能力の違いは型で分ける (原則 #2)。
    """

    score: Callable[[GraspCandidate, Problem], Optional[float]]


# 組み込み objective レジストリ。キーは DSL 宣言の objectiveWeights / 契約の
# objectiveScores のキーと一致する。NormSpec は problem パラメータから引く (基準が
# 問題サイズに依存する指標があるため。ただし「その回の候補集合」には依存しない =
# 絶対基準は保つ)。
OBJECTIVE_REGISTRY: "dict[str, ObjectiveDef | ScoredObjectiveDef]" = {
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
    # 外れる (u ≥ 1) = 0、この対象とハンドの組で最良 (u_best) = 1 (ADR-156)。
    "suction_hold": ScoredObjectiveDef(score=_suction_hold),
}


def evaluate_objectives(
    candidate: GraspCandidate, problem: Problem, names: Iterable[str]
) -> dict[str, float]:
    """要求された objective 名について 0-1 正規化値を返す (純粋)。

    鍵が出ない理由は 2 つあり、どちらも「評価できなかった」に畳まれる (ADR-120 D2):

    - 未知の objective 名 (DSL が将来 objective を増やしても素朴版は壊れない)。
    - 絶対基準が未宣言で **評価不能** — 0.0 を入れない。入れると「0 点」と区別できず、
      しかも `weighted_sum` の分母に満額で居座って totalScore を押し下げる。

    返り値のキーは契約 ScoreBreakdown.objectiveScores にそのまま載る。要求した重みに
    対して**どの鍵が欠けたか**が「測れなかった objective」を運ぶ唯一の情報なので、
    呼び出し側は母集団を返り値ではなく **要求した重み** から取る (原則 #31)。
    """
    out: dict[str, float] = {}
    for name in names:
        definition = OBJECTIVE_REGISTRY.get(name)
        if definition is None:
            continue
        if isinstance(definition, ScoredObjectiveDef):
            score = definition.score(candidate, problem)
        else:
            score = definition.spec_for(problem).normalize(definition.raw(candidate, problem))
        if score is None:
            continue
        out[name] = score
    return out
