"""離散候補生成 (純粋・副作用なし)。ADR-075 Open 論点「候補生成」の素朴な確定。

戦略 (素朴版):
- 対象の表面サンプル (点 + 外向き法線) ごとに、進入方向の基準を「法線の逆向き」
  (= 正対進入) とする。
- そこから approach_tilt_angles だけ傾けた変種、roll_angles だけ回した変種を直積で列挙。
- プリグラスプ位置 = 把持点 - approach * pre_grasp_distance (進入経路の始点)。

最適化はしない (聞かれていない高速化を入れない)。数百〜数千候補を一気に yield する。
傾けの回転は数値的に頑健な Rodrigues 回転で行い、退化 (ゼロ長軸) はガードする。
"""

from __future__ import annotations

import math
from collections.abc import Iterator

from .pose_codec import roll_aligning_x
from .types import Vec3, Pose, GraspCandidate, GraspSpec, Problem

_EPS = 1e-12


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )


def _perpendicular_unit(v: Vec3) -> Vec3:
    """v に直交する単位ベクトルを 1 つ返す。傾け回転の軸に使う。

    v に平行でない基底を選んで外積を取る (数値的に最も安定な基底を選ぶ)。退化時は
    既定軸を返す。
    """
    # v の成分のうち絶対値が最小の軸ほど v に平行になりにくい -> 外積が安定。
    ax, ay, az = abs(v.x), abs(v.y), abs(v.z)
    if ax <= ay and ax <= az:
        seed = Vec3(1.0, 0.0, 0.0)
    elif ay <= az:
        seed = Vec3(0.0, 1.0, 0.0)
    else:
        seed = Vec3(0.0, 0.0, 1.0)
    perp = _cross(v, seed)
    if perp.norm() < _EPS:
        # v が退化 (ゼロ長) などの保険。
        return Vec3(1.0, 0.0, 0.0)
    return perp.normalized()


def _rotate_about_axis(v: Vec3, axis_unit: Vec3, angle: float) -> Vec3:
    """Rodrigues の回転公式で v を axis_unit まわりに angle 回す (純粋)。

    axis_unit は単位ベクトル前提。angle=0 は v をそのまま返す (無駄な誤差を入れない)。
    """
    if abs(angle) < _EPS:
        return v
    c = math.cos(angle)
    s = math.sin(angle)
    # v_rot = v*c + (k x v)*s + k*(k.v)*(1-c)
    kxv = _cross(axis_unit, v)
    kdotv = axis_unit.dot(v)
    return (
        v.scaled(c)
        + kxv.scaled(s)
        + axis_unit.scaled(kdotv * (1.0 - c))
    )


def generate_candidates(problem: Problem) -> Iterator[GraspCandidate]:
    """problem から離散把持候補を列挙する純粋ジェネレータ。

    順序は (表面サンプル, 傾け角, ロール角) の直積で決定的。決定的順序は素朴版の
    再現性 (テスト容易性) のために重要。
    """
    pre_d = problem.pre_grasp_distance
    for point, normal in problem.target.surface_samples:
        n_unit = normal.normalized()
        base_approach = n_unit.scaled(-1.0)  # 正対進入 = 法線の逆向き
        if base_approach.norm() < _EPS:
            # 退化した法線サンプルはスキップ (方向を定義できない)。
            continue
        tilt_axis = _perpendicular_unit(base_approach)
        for tilt in problem.approach_tilt_angles:
            approach = _rotate_about_axis(base_approach, tilt_axis, tilt).normalized()
            if approach.norm() < _EPS:
                continue
            pre_grasp = point - approach.scaled(pre_d)
            for roll in problem.roll_angles:
                yield GraspCandidate(
                    pose=Pose(position=point, approach=approach, roll=roll),
                    pre_grasp=pre_grasp,
                    surface_normal=n_unit,
                )


def tilts_within(tilts: tuple[float, ...], tolerance: "float | None") -> tuple[float, ...]:
    """許容傾き以内の傾きの刻み (純粋, ADR-152 D5)。

    未宣言 (None) は刻みをそのまま使う。宣言があって刻みが 1 つも残らないとき、
    正対 (0) だけを使う — 0 はどの許容傾きの内側にも在るので、宣言の意味を越えない。
    空にすると「仕様は在るのに候補 0」という、宣言の誤りと見分けのつかない答えになる。
    """
    if tolerance is None:
        return tilts
    kept = tuple(t for t in tilts if abs(t) <= tolerance + _EPS)
    return kept if kept else (0.0,)


def generate_spec_candidates(problem: Problem, spec: GraspSpec) -> Iterator[GraspCandidate]:
    """把持仕様 1 つから離散候補を列挙する純粋ジェネレータ (ADR-152 D5)。

    `generate_candidates` と同じ直積 (サンプル, 傾け, ロール) を、仕様の 3 事実で絞る:
    - 傾け: `tilt_tolerance` 以内だけ (`tilts_within`)。
    - ロール: `closing_axis` があれば frame x をその軸に合わせる 2 通り (r, r+π) だけ。
      合わせられない (進入軸と平行な) 傾けではその傾けの候補を作らない。
    - 位置: TCP = サンプル点から進入方向へ `depth` 進めた点。プリグラスプは面の外
      (サンプル点から後退) に置く — 深さぶん奥から後退すると、浅いプリグラスプ距離では
      進入の始点が物体の中に入る。

    宣言が何も無い仕様 (閉じ軸・深さ・許容傾きなし) は `generate_candidates` と
    同じ候補を同じ順で作る — 旧 `faces` 宣言の移行が答えを動かさない根拠。
    """
    pre_d = problem.pre_grasp_distance
    tilts = tilts_within(problem.approach_tilt_angles, spec.tilt_tolerance)
    for point, normal in spec.samples:
        n_unit = normal.normalized()
        base_approach = n_unit.scaled(-1.0)
        if base_approach.norm() < _EPS:
            continue
        tilt_axis = _perpendicular_unit(base_approach)
        for tilt in tilts:
            approach = _rotate_about_axis(base_approach, tilt_axis, tilt).normalized()
            if approach.norm() < _EPS:
                continue
            if spec.closing_axis is not None:
                r0 = roll_aligning_x(approach, spec.closing_axis)
                if r0 is None:
                    continue
                rolls: tuple[float, ...] = (r0, r0 + math.pi)
            else:
                rolls = problem.roll_angles
            pre_grasp = point - approach.scaled(pre_d)
            tcp = point + approach.scaled(spec.depth) if spec.depth > 0.0 else point
            for roll in rolls:
                yield GraspCandidate(
                    pose=Pose(position=tcp, approach=approach, roll=roll),
                    pre_grasp=pre_grasp,
                    surface_normal=n_unit,
                    spec_id=spec.id,
                    closing_axis=spec.closing_axis,
                    depth=spec.depth,
                )
