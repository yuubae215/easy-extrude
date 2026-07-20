"""ドメイン Pose <-> 契約境界の pose payload の変換 (純粋・副作用なし)。

契約 v2 (上流 contract repo / public ADR-060 決定 C) では pose は **閉じた kind 判別
union**。ワイヤに載せてよいのは「ソルバが *決定* した事実」だけで、演出 (接近ベクトル・
ゴースト色・表示用グリッパ幅・アニメ) はクライアントが frame + 規約から導出する = ワイヤに
載せない。段階0 は TCP 相当の手先姿勢を解くので endEffector 枝を emit する:

    { "kind": "endEffector",
      "frame": { "position":    [x, y, z],
                 "orientation": [qx, qy, qz, qw] } }   # 四元数

jointSpace 枝 (chainRef + joints) は段階0 のドメイン Pose に対応物を持たない (段階0 は
関節値を Pose に持たない = types.Pose の docstring) ため、この codec は endEffector のみ
往復させる。jointSpace の消費は将来の関節解ソルバ導入時の課題。

## FRAME_CONVENTION (frame と approach/roll の対応)
接近方向は end-effector frame の **-Z 軸** (public GraspGhostMath と同じ規約)。すなわち
frame の +Z (world) = -approach。roll は approach 軸まわりの回転。基準となる x/y 軸は z から
決定論的に選んだ参照ベクトルで張る (下記 _basis_from_z)。この gauge を encode/decode で
共有することで (approach, roll) <-> 四元数 が正確な逆写像になる (round-trip 保存)。
"""

from __future__ import annotations

import math
from typing import Any

from .types import Pose, Vec3

# 参照ベクトル選択のしきい値。z がほぼ world-Z と平行なら別の参照に切り替え、
# 外積が退化 (ゼロ長) するのを避ける (数値的安定性優先)。
_PARALLEL = 0.9

POSE_KIND_END_EFFECTOR = "endEffector"
POSE_KIND_JOINT_SPACE = "jointSpace"


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )


def _basis_from_z(z: Vec3) -> tuple[Vec3, Vec3]:
    """z 軸 (単位) から決定論的に基準 x/y 軸 (bx, by) を張る (roll=0 の gauge)。

    encode/decode で同一の参照選択を使うことが round-trip 保存の前提。
    """
    ref = Vec3(0.0, 0.0, 1.0) if abs(z.z) < _PARALLEL else Vec3(1.0, 0.0, 0.0)
    bx = _cross(ref, z).normalized()
    by = _cross(z, bx)  # z, bx が単位で直交なので by も単位 (右手系)
    return bx, by


def _matrix_to_quaternion(x: Vec3, y: Vec3, z: Vec3) -> list[float]:
    """回転行列の列 (x|y|z, world 軸) を四元数 [qx, qy, qz, qw] に写す。

    trace の符号で分岐する数値的に安定な抽出 (Shepperd)。負の平方根や小さい割り算を避ける。
    """
    m00, m10, m20 = x.x, x.y, x.z
    m01, m11, m21 = y.x, y.y, y.z
    m02, m12, m22 = z.x, z.y, z.z
    trace = m00 + m11 + m22
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2.0
        qw = 0.25 * s
        qx = (m21 - m12) / s
        qy = (m02 - m20) / s
        qz = (m10 - m01) / s
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2.0
        qw = (m21 - m12) / s
        qx = 0.25 * s
        qy = (m01 + m10) / s
        qz = (m02 + m20) / s
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2.0
        qw = (m02 - m20) / s
        qx = (m01 + m10) / s
        qy = 0.25 * s
        qz = (m12 + m21) / s
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2.0
        qw = (m10 - m01) / s
        qx = (m02 + m20) / s
        qy = (m12 + m21) / s
        qz = 0.25 * s
    # 正規化 (fp 誤差を吸収し単位四元数に保つ)。
    n = math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    if n < 1e-12:
        return [0.0, 0.0, 0.0, 1.0]
    inv = 1.0 / n
    return [qx * inv, qy * inv, qz * inv, qw * inv]


def _quaternion_to_columns(q: list[float]) -> tuple[Vec3, Vec3, Vec3]:
    """四元数 [qx, qy, qz, qw] を回転行列の列 (x, y, z の world 軸) に戻す。"""
    qx, qy, qz, qw = q[0], q[1], q[2], q[3]
    n = math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    if n < 1e-12:
        return Vec3(1.0, 0.0, 0.0), Vec3(0.0, 1.0, 0.0), Vec3(0.0, 0.0, 1.0)
    inv = 1.0 / n
    qx, qy, qz, qw = qx * inv, qy * inv, qz * inv, qw * inv
    xx, yy, zz = qx * qx, qy * qy, qz * qz
    xy, xz, yz = qx * qy, qx * qz, qy * qz
    wx, wy, wz = qw * qx, qw * qy, qw * qz
    x_axis = Vec3(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy))
    y_axis = Vec3(2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx))
    z_axis = Vec3(2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy))
    return x_axis, y_axis, z_axis


def frame_axes(pose: Pose) -> tuple[Vec3, Vec3, Vec3]:
    """FRAME_CONVENTION に従う end-effector frame の world 軸 (x, y, z) を返す (純粋)。

    z = -approach、x = roll 適用後の基準軸、y = 右手系の残り。encode
    (pose_to_payload) とここが同一 gauge を共有する唯一の実装であり、frame 軸を
    参照する判定 (例: naive 把持ゲートの閉じ軸 = x 軸, ADR-081) はこの関数を通す
    (規約の第二の源を作らない)。
    """
    z = pose.approach.normalized().scaled(-1.0)  # +Z(world) = -approach
    bx, by = _basis_from_z(z)
    c, s = math.cos(pose.roll), math.sin(pose.roll)
    x = bx.scaled(c) + by.scaled(s)  # roll 適用後の x 軸
    y = _cross(z, x)  # 右手系を保証
    return x, y, z


def pose_to_payload(pose: Pose) -> dict[str, Any]:
    """Pose を契約 v2 の pose union (endEffector 枝) に写す。

    approach = frame の -Z、roll = approach 軸まわり回転、という規約で四元数を組む。
    """
    x, y, z = frame_axes(pose)
    orientation = _matrix_to_quaternion(x, y, z)
    return {
        "kind": POSE_KIND_END_EFFECTOR,
        "frame": {
            "position": pose.position.as_list(),
            "orientation": orientation,
        },
    }


def pose_from_payload(payload: dict[str, Any]) -> Pose:
    """契約 v2 の pose union (endEffector 枝) を Pose に戻す (round-trip 用)。

    endEffector 以外の kind は段階0 ドメイン Pose に対応物を持たないため拒否する
    (曖昧に処理しない = ADR-074)。
    """
    kind = payload.get("kind")
    if kind != POSE_KIND_END_EFFECTOR:
        raise ValueError(
            f"pose_from_payload supports kind='{POSE_KIND_END_EFFECTOR}' only "
            f"(stage-0 domain Pose has no joint-space representation); got kind={kind!r}"
        )
    frame = payload["frame"]
    pos = frame["position"]
    position = Vec3(float(pos[0]), float(pos[1]), float(pos[2]))
    x_axis, _y_axis, z_axis = _quaternion_to_columns(
        [float(v) for v in frame["orientation"]]
    )
    approach = z_axis.scaled(-1.0)  # approach = -Z
    # 同一 gauge で基準 x/y を張り直し、x 軸との角度から roll を復元。
    bx, by = _basis_from_z(z_axis)
    roll = math.atan2(x_axis.dot(by), x_axis.dot(bx))
    return Pose(position=position, approach=approach, roll=roll)
