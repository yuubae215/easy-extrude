"""シーン層のピック設定 (純粋データ)。ADR-078 Decision 2/3。

per-entity でない設定 (ロボット / サンプリング / objective 重み / 出力件数) をまとめる。
scene (エンティティ集合) と組んで per-pick の `GraspSearchRequest` を作る材料になる。

ADR-078 Decision 3 の用語境界 (cone vs approach) をこの型でも徹底する:
- **許容角 (cone)** = `robot.wrist_cone_half_angle`: ロボット手首が向けられる向きの上限。
  IK 可解性の判定パラメータ (「届く向き」)。`engine.types.Robot` に属する。
- **進入角 (approach)** = `approach_tilt_angles` / `roll_angles`: 候補生成で「試す進入の向き」
  の刻み (「試す向き」)。サンプリング設定としてここに属する。
2 つは別軸・別目的。混ぜない (docs / UI でも別物として見せる)。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from ..engine.types import Robot


@dataclass(frozen=True)
class GraspSettings:
    """1 シーンの全ピックで共有する把持探索設定 (per-entity でない部分)。

    - `robot`: ロボットモデル (リーチ球殻 + 許容角 = 「届く向き」, ADR-078 Decision 3)。
    - `objective_weights`: objective 名 -> 重み。スコア内訳のキーに対応 (絶対基準 0-1)。
    - `approach_tilt_angles` / `roll_angles`: 進入角 = 「試す向き」(ADR-078 Decision 3)。
    - `pre_grasp_distance`: プリグラスプ後退距離。`clearance_reference`: クリアランス基準。
    - `top_n`: 各ピックで返す上位件数。`layout_version`: 参照する public スキーマ版。
    """

    robot: Robot
    objective_weights: Mapping[str, float] = field(default_factory=dict)
    approach_tilt_angles: tuple[float, ...] = (0.0,)
    roll_angles: tuple[float, ...] = (0.0,)
    pre_grasp_distance: float = 0.1
    clearance_reference: float = 0.1
    top_n: int = 5
    layout_version: str = "layout/1.0"
