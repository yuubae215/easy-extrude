"""段階0 エンジンのドメイン型 + 数値ヘルパ (純粋・副作用なし)。

ここには「解く処理」(IK / 干渉 / wrench cone) を置かない。それらは feasibility の
Protocol で注入する。数値的安定性を最優先する: 正規化前のゼロ長ガード、定義域クランプ、
ゼロ割り回避を徹底する。

座標系 (段階0 の素朴な前提):
- 単位はメートル想定だが純粋に相対量しか使わないので単位非依存。
- approach は「プリグラスプ位置から把持点へ向かう」単位ベクトル (進入方向)。
- surface_normal は把持点での対象表面の外向き法線 (単位)。安定把持は approach が
  法線の逆向きに近いほど良い、という素朴な前提を置く。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# ゼロ長判定のしきい値。これ未満は数値的にゼロ扱いし、正規化等で退化として扱う。
_EPS = 1e-12


def clamp(x: float, lo: float, hi: float) -> float:
    """x を [lo, hi] に収める。NaN 伝播を避けるため min/max で素直に。"""
    if x < lo:
        return lo
    if x > hi:
        return hi
    return x


@dataclass(frozen=True)
class Vec3:
    """不変の 3 次元ベクトル。演算は新しい Vec3 を返す純粋関数。"""

    x: float
    y: float
    z: float

    def __add__(self, other: "Vec3") -> "Vec3":
        return Vec3(self.x + other.x, self.y + other.y, self.z + other.z)

    def __sub__(self, other: "Vec3") -> "Vec3":
        return Vec3(self.x - other.x, self.y - other.y, self.z - other.z)

    def scaled(self, s: float) -> "Vec3":
        return Vec3(self.x * s, self.y * s, self.z * s)

    def dot(self, other: "Vec3") -> float:
        return self.x * other.x + self.y * other.y + self.z * other.z

    def norm(self) -> float:
        # math.hypot は中間オーバーフロー/アンダーフローに強い (数値的安定性優先)。
        return math.hypot(self.x, self.y, self.z)

    def normalized(self) -> "Vec3":
        """単位ベクトル。ゼロ長 (退化) は Vec3(0,0,0) を返す (ゼロ割り回避)。

        呼び出し側は退化を「方向なし」として扱える。例外は上げない (数値的に頑健に)。
        """
        n = self.norm()
        if n < _EPS:
            return Vec3(0.0, 0.0, 0.0)
        inv = 1.0 / n
        return Vec3(self.x * inv, self.y * inv, self.z * inv)

    def distance_to(self, other: "Vec3") -> float:
        return (self - other).norm()

    def as_list(self) -> list[float]:
        return [self.x, self.y, self.z]


def distance_point_to_segment(p: Vec3, a: Vec3, b: Vec3) -> float:
    """点 p と線分 ab の最短距離。退化線分 (a==b) は点 a への距離に落ちる。

    干渉判定 (進入経路 vs 障害物) と approach_clearance objective が共有する純粋ヘルパ。
    """
    ab = b - a
    ab_len2 = ab.dot(ab)
    if ab_len2 < _EPS:
        # 退化線分: 端点への距離。
        return p.distance_to(a)
    # p を ab 上に射影したパラメータ t を [0,1] にクランプ (線分の外には出さない)。
    t = clamp((p - a).dot(ab) / ab_len2, 0.0, 1.0)
    closest = a + ab.scaled(t)
    return p.distance_to(closest)


@dataclass(frozen=True)
class Pose:
    """把持姿勢。位置 + 進入方向 (単位) + ロール角 (進入軸まわり, ラジアン)。

    段階0 では関節値そのものは持たず、TCP 相当の幾何のみを持つ。関節値は IK ソルバが
    解いた結果 (IkSolution) として別に扱う。
    """

    position: Vec3
    approach: Vec3  # プリグラスプ -> 把持点 へ向かう単位ベクトル
    roll: float = 0.0


@dataclass(frozen=True)
class GraspCandidate:
    """離散候補 1 件。生成は純粋 (candidates.generate_candidates)。

    pre_grasp は進入経路の始点 (干渉判定で把持点へ向かう線分の端点)。surface_normal は
    把持点での外向き法線 (安定把持 objective が使う)。
    """

    pose: Pose
    pre_grasp: Vec3
    surface_normal: Vec3


@dataclass(frozen=True)
class Robot:
    """素朴なロボットモデル。リーチ判定と naive IK が使う最小限のパラメータ。

    - base: ベース原点。
    - reach_min / reach_max: 球殻状の到達域 (近似)。base からの距離がこの範囲なら届く前提。
    - wrist_cone_half_angle: naive IK が「手首を向けられる」とみなす角度上限 (ラジアン)。
      base->把持点 方向と approach のなす角がこの範囲なら可解とみなす素朴な近似。
    """

    base: Vec3
    reach_min: float
    reach_max: float
    wrist_cone_half_angle: float = math.pi  # 既定は無制限 (どの向きでも可解)


@dataclass(frozen=True)
class Obstacle:
    """素朴な障害物 (球)。段階0 は球近似のみ。最も高コストな干渉判定を安く保つため。"""

    center: Vec3
    radius: float


@dataclass(frozen=True)
class Camera:
    """カメラ宣言 (ADR-081 「見えるか」ドメインの入力)。

    - position: カメラ光学中心の位置。可視性 naive はここから把持点への視線
      (線分) が障害物球に遮られないかを判定する。
    - view_axis: 任意の視軸 (カメラが向く方向, 単位でなくてよい — 判定側で正規化)。
    - fov_half_angle: 任意の視野円錐の半角 (ラジアン)。view_axis と両方宣言された
      ときだけ視野判定が効く (片方だけなら視野は無制限として扱う)。

    宣言は graspSearch open payload の `camera` キー (layoutVersion 統治,
    contractVersion 版上げ不要 — ADR-081 §統治上の前提)。
    """

    position: Vec3
    view_axis: Vec3 | None = None
    fov_half_angle: float | None = None


@dataclass(frozen=True)
class Gripper:
    """グリッパ宣言 (ADR-081 「掴めるか」ドメインの入力)。

    - max_opening: 平行ジョーの最大開口幅。
    - finger_clearance: 指が対象の脇へ進入するのに要する追加クリアランス
      (naive ゲートは max_opening >= 対象幅 + finger_clearance を課す)。

    宣言は graspSearch open payload の `gripper` キー (camera と同じ統治)。
    """

    max_opening: float
    finger_clearance: float = 0.0


@dataclass(frozen=True)
class TargetObject:
    """把持対象。表面サンプル (点 + 外向き法線) の集合として与える。

    候補生成はこのサンプルごとに approach / roll を刻んで離散候補を作る。サンプリング
    密度は呼び出し側の責務 (DSL 宣言由来) で、エンジンは与えられた点をそのまま使う。
    """

    surface_samples: tuple[tuple[Vec3, Vec3], ...]  # (point, outward_normal)


@dataclass(frozen=True)
class Problem:
    """段階0 探索の入力ドメイン (純粋データ)。契約宣言から adapter で構築する。

    候補生成パラメータ:
    - approach_tilt_angles: 法線逆向きからの傾け角の刻み (ラジアン)。0 を含めると素直な
      正対進入も候補に入る。
    - roll_angles: 進入軸まわりのロール刻み (ラジアン)。
    - pre_grasp_distance: 把持点からプリグラスプ位置までの後退距離。
    """

    robot: Robot
    target: TargetObject
    obstacles: tuple[Obstacle, ...] = ()
    approach_tilt_angles: tuple[float, ...] = (0.0,)
    roll_angles: tuple[float, ...] = (0.0,)
    pre_grasp_distance: float = 0.1

    # ドメイン段階ゲートの宣言 (ADR-081)。None = 宣言なし = そのゲートは判定しない
    # (既存挙動を無言で変えない — ADR-084 のフォールバック規律と同じ)。
    camera: Camera | None = None
    gripper: Gripper | None = None

    # objective の正規化で参照する絶対基準の追加パラメータ (objectives.py が使う)。
    # 進入経路クリアランスを 0-1 化する基準距離 (これ以上離れていれば満点)。
    clearance_reference: float = 0.1
