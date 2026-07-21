"""段階フィルタの実行可能性判定 (ADR-075 リーチ / IK / 干渉 + ADR-081 可視性 / 把持性)。

安い順フィルタ (ADR-075) を保ちつつ、ADR-081 でドメイン段階 (見える/届く/掴める) に
増段した。高コスト判定に到達する候補を減らすため、pipeline は安い判定から順に当てて
短絡する (段の並びと根拠は pipeline.py 側に一箇所で書く)。

純粋/副作用の境界 (ADR-075):
- `within_reach` は純粋関数 (距離比較のみ)。
- IK ソルバ・干渉チェッカ・可視性チェッカ・把持性チェッカは Protocol で注入する。
  「解く処理」はコストが高く、将来は外部ライブラリ/サービス (副作用) になり得るため、
  純粋コアから切り離して注入する。
- 段階0 には naive な既定実装 (外部依存ゼロ) を同梱する: リーチ球殻 + 手首コーン +
  球障害物 + 視線遮蔽 (線分-球) + 平行ジョー開口幅。

near-miss の設計 (ADR-079 の一般化, ADR-081):
- 可視性/把持性の Protocol は bool ではなく **不足量 (miss)** を返す。0.0 = 合格、
  正 = その量だけ足りない、inf = その軸では測れない棄却 (視野外 / 接触対なし)。
  reach_miss と同じ「幾何の決定事実」であり、ゲート (miss <= 0) と診断 near-miss
  (棄却候補の最小 miss) を一つの計算で賄う (二度走らせない)。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Protocol

from .pose_codec import frame_axes
from .types import (
    Camera,
    GraspCandidate,
    Gripper,
    Obstacle,
    Robot,
    TargetObject,
    Vec3,
    angle_between,
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

    「可解」の素朴な定義: リーチ球殻に入っていて (within_reach)、かつ手首コーンの基準軸と
    進入方向 approach のなす角が手首コーン (robot.wrist_cone_half_angle) 以内なら、手首を
    その向きに合わせられるとみなして 1 解を返す。実 IK (関節限界・特異点) は将来差し替え。

    cone の基準軸 (ADR-084 §3):
    - `robot.tcp_orientation` が宣言されていれば、TCP body frame の前方軸
      `FORWARD_AXIS = +X` (ROS/URDF 慣例, CLAUDE.md の世界座標系正準 +X前方 と一致) を
      その姿勢で回したワールド方向を基準にする。tcp_orientation はフロント側で
      transformGraph を根までたどって**ワールド姿勢に合成済み**の四元数として渡る前提
      (`core/` は entity も親フレームも知らない — ADR-084 §2/§3)。
    - 未宣言 (None) なら旧挙動の代理軸 (base->把持点 方向) にフォールバックする。
      宣言した瞬間にだけ TCP 姿勢基準へ切り替わる (挙動を無言で変えない — #11 の双対)。

    注意: `FORWARD_AXIS = +X` は `pose_codec.py` が候補 frame を四元数へ往復させるための
    内部 gauge (`-Z`) とは**無関係の別概念**。前者はロボット実体の body-frame 規約、
    後者は candidate frame の任意 gauge であり、"前方軸" という言葉を安易に同一視しない。
    """

    # TCP body frame の前方 = +X (ROS/URDF 慣例)。pose_codec の -Z gauge とは無関係。
    FORWARD_AXIS = Vec3(1.0, 0.0, 0.0)

    def solve(self, candidate: GraspCandidate, robot: Robot) -> Optional[IkSolution]:
        if not within_reach(candidate, robot):
            return None
        if robot.tcp_orientation is not None:
            # TCP 姿勢基準 (ワールド座標系で解決済み) で FORWARD_AXIS を回す。
            reference_axis = robot.tcp_orientation.rotate(self.FORWARD_AXIS)
        else:
            # 後方互換フォールバック: base->把持点 方向の代理軸 (旧挙動)。
            reference_axis = candidate.pose.position - robot.base
        approach = candidate.pose.approach
        if reference_axis.norm() < _EPS or approach.norm() < _EPS:
            return None
        # なす角 (angle_between が正規化 + 定義域クランプを担う, ADR-084)。
        angle = angle_between(reference_axis, approach)
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


# --- 可視性 (見えるか: 注入 Protocol + naive 既定, ADR-081) -------------------


class VisibilityChecker(Protocol):
    """可視性チェッカの注入境界。遮蔽の不足量 (miss) を返す。

    返り値の規約 (near-miss 設計, モジュール docstring):
    - 0.0 …… 見える (遮蔽なし)。
    - 正値 … その深さだけ視線が遮られている (最も深く遮る球の食い込み量)。
    - inf …… 視野外など、遮蔽量では測れない棄却。

    実装はメッシュ遮蔽・視野角・被写界深度など高忠実度に差し替え可 (Phase 4)。
    契約に出るのは bool (visible) と near-miss 集計のみなので境界不変。
    """

    def occlusion_miss(
        self, candidate: GraspCandidate, camera: Camera, obstacles: tuple[Obstacle, ...]
    ) -> float: ...


def sightline_occlusion_miss(
    camera: Camera, point: Vec3, obstacles: tuple[Obstacle, ...]
) -> float:
    """カメラ -> 点の視線の遮蔽不足量 (純粋)。可視性 naive の共有幾何。

    候補粒度 (NaiveSightlineVisibilityChecker) とエンティティ粒度
    (scene.derivation の targetable 絞り込み, ADR-081 Decision 1) が同じ視線判定を
    共有するための単一実装 (第二の源を作らない)。返り値の規約は VisibilityChecker と
    同じ: 0.0 = 見える / 正 = 最も深く遮る球の食い込み量 / inf = 視野円錐外。
    """
    eye = camera.position
    # 視野円錐 (視軸 + 半角の両宣言時のみ)。円錐外は遮蔽量で測れない -> inf。
    if camera.view_axis is not None and camera.fov_half_angle is not None:
        axis = camera.view_axis.normalized()
        ray = (point - eye).normalized()
        if axis.norm() < _EPS or ray.norm() < _EPS:
            return math.inf
        cos_angle = max(-1.0, min(1.0, axis.dot(ray)))
        if math.acos(cos_angle) > camera.fov_half_angle + _EPS:
            return math.inf
    # 視線遮蔽: 最も深く食い込む球の食い込み量 (radius - 視線までの距離)。
    deepest = 0.0
    for obs in obstacles:
        depth = obs.radius - distance_point_to_segment(obs.center, eye, point)
        if depth > deepest:
            deepest = depth
    return deepest


class NaiveSightlineVisibilityChecker:
    """外部依存ゼロの素朴な可視性既定実装 (視線 = 線分, 遮蔽 = 球)。

    カメラ位置 -> 把持点の線分が障害物球に遮られなければ見えるとみなす
    (`sightline_occlusion_miss` = 干渉判定と同じ線分-球幾何)。camera が視軸 + FOV
    半角の両方を宣言していれば視野円錐も判定する (円錐外は inf = 測れない棄却)。

    素朴な近似の限界 (ADR-081 Consequences): 球近似のみ。対象自身による自己遮蔽は
    見ない (per-pick 導出の障害物集合は対象を含まない, ADR-078)。
    """

    def occlusion_miss(
        self, candidate: GraspCandidate, camera: Camera, obstacles: tuple[Obstacle, ...]
    ) -> float:
        return sightline_occlusion_miss(camera, candidate.pose.position, obstacles)


def visible(
    candidate: GraspCandidate,
    camera: Optional[Camera],
    obstacles: tuple[Obstacle, ...],
    checker: VisibilityChecker,
) -> bool:
    """注入チェッカで把持点がカメラから見えるか。

    camera 未宣言 (None) はゲート無効 = 常に True (既存挙動を無言で変えない)。
    """
    if camera is None:
        return True
    return checker.occlusion_miss(candidate, camera, obstacles) <= 0.0


# --- 把持性 (掴めるか: 注入 Protocol + naive 既定, ADR-081) -------------------


class GraspChecker(Protocol):
    """把持性チェッカの注入境界。開口の不足量 (miss) を返す。

    返り値の規約 (near-miss 設計, モジュール docstring):
    - 0.0 …… 掴める (幾何ゲート合格)。
    - 正値 … 開口幅がその分だけ足りない (必要幅 - max_opening)。
    - inf …… 接触対が定義できないなど、幅では測れない棄却。

    「どれくらい安定か」は objective (`grasp_stability`) の役割であり、ここは
    掴める/掴めないのハードゲートのみ (二層は混ぜない, ADR-081 Decision 1)。
    wrench cone 等の高忠実度実装への差し替えは Protocol 内で閉じる (Phase 4)。
    """

    def opening_miss(
        self, candidate: GraspCandidate, gripper: Gripper, target: TargetObject
    ) -> float: ...


class NaiveParallelJawGraspChecker:
    """外部依存ゼロの素朴な把持性既定実装 (平行ジョーの幾何ゲート)。

    判定 (ADR-081 Decision 1 の naive 既定):
    - 閉じ軸 = end-effector frame の x 軸 (approach と roll から pose_codec の
      FRAME_CONVENTION gauge で導出 — 規約の第二の源を作らない)。
    - 対象幅 = 対象の全表面サンプル点を閉じ軸へ射影した広がり (max - min)。
      凸対象では両端のサンプル対が対向接触面 (antipodal 対) の素朴な代理になる。
      サンプルが 1 点以下 / 広がりゼロなら接触対を定義できない -> inf (棄却)。
    - 開口ゲート: max_opening >= 対象幅 + finger_clearance。不足量 = 超過分。

    素朴な近似の限界 (ADR-081 Consequences): 幾何のみ (摩擦・力閉包は wrench cone
    差し替えまで扱わない)。凹形状では射影幅が真の把持幅を過大評価し得る。
    """

    # これ未満の射影広がりは「接触対なし」とみなす (数値ゼロ幅の退化ガード)。
    _MIN_WIDTH = 1e-9

    def opening_miss(
        self, candidate: GraspCandidate, gripper: Gripper, target: TargetObject
    ) -> float:
        if len(target.surface_samples) < 2:
            return math.inf
        closing_axis, _y, _z = frame_axes(candidate.pose)
        if closing_axis.norm() < _EPS:
            return math.inf
        projections = [p.dot(closing_axis) for (p, _n) in target.surface_samples]
        width = max(projections) - min(projections)
        if width < self._MIN_WIDTH:
            return math.inf
        required = width + gripper.finger_clearance
        return max(0.0, required - gripper.max_opening)


def graspable(
    candidate: GraspCandidate,
    gripper: Optional[Gripper],
    target: TargetObject,
    checker: GraspChecker,
) -> bool:
    """注入チェッカでグリッパが対象を幾何的に掴めるか。

    gripper 未宣言 (None) はゲート無効 = 常に True (既存挙動を無言で変えない)。
    """
    if gripper is None:
        return True
    return checker.opening_miss(candidate, gripper, target) <= 0.0
