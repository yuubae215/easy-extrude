"""安い順フィルタの実行可能性判定 (ADR-075 Open 論点 リーチ / IK / 干渉)。

安い順 (リーチ = 最安 -> IK 可解 -> 干渉 = 最高コスト)。高コスト判定に到達する候補を
減らすため、pipeline は安い判定から順に当てて短絡する。

純粋/副作用の境界 (ADR-075):
- `within_reach` は純粋関数 (距離比較のみ)。
- IK ソルバ・干渉チェッカは Protocol で注入する。「解く処理」はコストが高く、将来は
  外部ライブラリ/サービス (副作用) になり得るため、純粋コアから切り離して注入する。
- 段階0 には naive な既定実装 (NaiveIkSolver / NaiveSphereCollisionChecker) を同梱する。
  これらは外部依存ゼロで、リーチ球殻 + 手首コーン + 球障害物という素朴な近似。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Protocol

from .types import (
    GraspCandidate,
    Obstacle,
    Robot,
    Vec3,
    distance_point_to_segment,
)

_EPS = 1e-12


# --- リーチ (最安: 純粋関数) -------------------------------------------------


def within_reach(candidate: GraspCandidate, robot: Robot) -> bool:
    """把持点が球殻状の到達域 [reach_min, reach_max] に入るか (純粋)。

    最も安い判定。安い順フィルタの先頭で短絡に使う。境界は閉区間 (届く前提)。
    """
    r = candidate.pose.position.distance_to(robot.base)
    return robot.reach_min <= r <= robot.reach_max


def reach_miss(candidate: GraspCandidate, robot: Robot) -> float:
    """到達殻 [reach_min, reach_max] までの不足距離 (殻内なら 0.0, 純粋)。

    リーチ棄却が「どれだけ惜しいか」を診断ファネルに載せるための幾何の決定事実
    (ADR-079)。within_reach と同じ距離比較のみ = 安い順フィルタのコストを崩さない。
    """
    r = candidate.pose.position.distance_to(robot.base)
    if r < robot.reach_min:
        return robot.reach_min - r
    if r > robot.reach_max:
        return r - robot.reach_max
    return 0.0


# --- IK 可解性 (注入: Protocol + naive 既定) ---------------------------------


@dataclass(frozen=True)
class IkSolution:
    """IK 解。段階0 は関節値の中身を契約境界に出さないため不透明でよい。

    `joints` は素朴版では占位 (naive ソルバは検証のためだけに 1 解を返す)。実ソルバに
    差し替えると本物の関節値が入る。
    """

    joints: tuple[float, ...]


class IkSolver(Protocol):
    """IK ソルバの注入境界。解けなければ None を返す。

    実装は解析的でもライブラリでも外部サービスでもよい (副作用を許す)。エンジンの純粋
    コアはこの Protocol だけに依存する。
    """

    def solve(self, candidate: GraspCandidate, robot: Robot) -> Optional[IkSolution]: ...


class NaiveIkSolver:
    """外部依存ゼロの素朴な IK 既定実装。

    「可解」の素朴な定義: リーチ球殻に入っていて (within_reach)、かつ base->把持点 方向と
    進入方向 approach のなす角が手首コーン (robot.wrist_cone_half_angle) 以内なら、手首を
    その向きに合わせられるとみなして 1 解を返す。実 IK (関節限界・特異点) は将来差し替え。
    """

    def solve(self, candidate: GraspCandidate, robot: Robot) -> Optional[IkSolution]:
        if not within_reach(candidate, robot):
            return None
        to_target = (candidate.pose.position - robot.base).normalized()
        approach = candidate.pose.approach.normalized()
        if to_target.norm() < _EPS or approach.norm() < _EPS:
            return None
        # なす角 = acos(clamp(dot, -1, 1))。dot を厳密に [-1,1] に丸めて acos の定義域を守る。
        cos_angle = max(-1.0, min(1.0, to_target.dot(approach)))
        angle = math.acos(cos_angle)
        if angle > robot.wrist_cone_half_angle + _EPS:
            return None
        # 占位の関節値 (素朴版では検証以外に使わない)。
        return IkSolution(joints=(angle,))


def ik_solvable(candidate: GraspCandidate, robot: Robot, solver: IkSolver) -> bool:
    """注入ソルバで IK が解けるか (解の有無を bool に写すだけ)。"""
    return solver.solve(candidate, robot) is not None


# --- 干渉 (最高コスト: 注入 Protocol + naive 既定) ---------------------------


class CollisionChecker(Protocol):
    """干渉チェッカの注入境界。進入経路が障害物と衝突するなら True。

    最もコストが高い判定なので安い順フィルタの最後段に置く前提。形状表現 (球/メッシュ等)
    は実装側の責務。
    """

    def in_collision(
        self, candidate: GraspCandidate, obstacles: tuple[Obstacle, ...]
    ) -> bool: ...


class NaiveSphereCollisionChecker:
    """外部依存ゼロの素朴な干渉既定実装 (球障害物)。

    進入経路 (pre_grasp -> 把持点) の線分と各障害物球の最短距離が球半径 + probe_radius を
    下回れば衝突とみなす。probe_radius はグリッパ太さの素朴な余裕代。
    """

    def __init__(self, probe_radius: float = 0.0) -> None:
        self.probe_radius = probe_radius

    def in_collision(
        self, candidate: GraspCandidate, obstacles: tuple[Obstacle, ...]
    ) -> bool:
        a = candidate.pre_grasp
        b = candidate.pose.position
        for obs in obstacles:
            d = distance_point_to_segment(obs.center, a, b)
            if d <= obs.radius + self.probe_radius + _EPS:
                return True
        return False


def interference_free(
    candidate: GraspCandidate,
    obstacles: tuple[Obstacle, ...],
    checker: CollisionChecker,
) -> bool:
    """衝突しないなら True (注入チェッカの否定)。"""
    return not checker.in_collision(candidate, obstacles)
