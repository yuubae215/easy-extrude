"""bin-picking シーン層の BFF <-> コアAPI I/O 契約の型 (ADR-078 / ADR-074 踏襲)。

入力 = 属性付きエンティティの集合 (`SceneWire`) + per-pick でない設定 (`GraspSettingsWire`)
       + contractVersion + layoutVersion (+ 任意の maxPicks)。
出力 = 最上面順の反復ピック列 (`PickStepWire` の並び) + contractVersion。

壁の規律 (ADR-078 Decision 1/2):
- 入力 wire は **エンティティ属性の宣言 (器)** のみを運ぶ: `kind` / 永続性 / 干渉球 / 把持点。
  「これは障害物だ」「障害物集合はこれ」という **判定 (decide) を wire に置かない**。
  障害物集合はコア側 (`scene.derive_obstacles`) が属性から導出する。
- 出力は各ピックの把持ランキング (`PoseCandidate` を再利用)。これは grasp-search が既に
  出している形。`derivedObstacleCount` は「どの障害物導出で」の検査材料
  (ADR-078 UI 申し送り: 出力プレビュー)。

contractVersion (ADR-074):
- pick-sequence は **新規契約** (既存の grasp/recommendation の必須を壊さない) なので
  **番号は上げない**。`CONTRACT_VERSION` を共有する。

注意:
- この契約型はコア側の **暫定の正本**。最終的には中立な JSON Schema を正本にし、
  pydantic と BFF (TS) が両端でそれから導出する (grasp と同じ運用, ADR-074 §6)。

- 判定の実装 (障害物導出 / IK / 干渉 / リーチ / スコア) は入れない。ここは I/O の形 *だけ*。
- pose / score の wire 形は grasp 契約 (`models.py`) の `PoseCandidate` / `ScoreBreakdown`
  を **再利用** する (二重定義しない = 真実の源は一つ)。
"""

from __future__ import annotations

import math
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .models import PoseCandidate
from .version import CONTRACT_VERSION


class _ContractModel(BaseModel):
    """契約モデル共通設定。wire 形は camelCase、Python では snake_case + alias。

    grasp / recommendation 契約の _ContractModel と同一方針。serialize は by_alias=True で
    wire 形 (camelCase) を出す。
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


# --- 入力 (BFF -> コアAPI): エンティティ属性の宣言 (器) ------------------------


class SphereWire(_ContractModel):
    """干渉球 1 個 (段階0 の球近似)。center は [x, y, z] の配列 (engine 契約と同形)。"""

    center: list[float]
    radius: float = Field(ge=0.0)


class SurfaceSampleWire(_ContractModel):
    """把持点 1 個 = 点 + 外向き法線。各々 [x, y, z] の配列。"""

    point: list[float]
    normal: list[float]


class SceneEntityWire(_ContractModel):
    """属性付きシーンエンティティ 1 件の宣言 (ADR-078 Decision 1)。

    geometry を 2 役で持つ: `collisionSpheres` (他の把持を遮るときの干渉形状) と
    `surfaceSamples` (自身が対象になるときの把持点)。`persistence` は省略可 (None なら
    kind から既定: wall/fixture=static / workpiece=dynamic を コア側が解決)。
    """

    entity_id: str
    kind: str  # "wall" | "workpiece" | "fixture" (コア側で EntityKind に写す)
    collision_spheres: list[SphereWire] = Field(default_factory=list)
    surface_samples: list[SurfaceSampleWire] = Field(default_factory=list)
    # "static" | "dynamic" | null。null は kind 既定 (UI 申し送りの属性編集に対応)。
    persistence: Optional[str] = None


class SceneWire(_ContractModel):
    """属性付きエンティティの集合としてのシーン (ADR-078 Decision 1)。"""

    entities: list[SceneEntityWire] = Field(default_factory=list)


class RobotWire(_ContractModel):
    """ロボットモデルの宣言 (リーチ球殻 + 許容角)。

    `wristConeHalfAngle` = 許容角 = 「届く向き」(ADR-078 Decision 3, IK 可解性の上限)。
    進入角 (試す向き) はサンプリング側 (`GraspSettingsWire.approachTiltAngles`) に置き、
    型レベルで別軸に保つ。
    """

    base: list[float]
    reach_min: float = Field(ge=0.0)
    reach_max: float = Field(ge=0.0)
    wrist_cone_half_angle: float = math.pi  # 既定は無制限 (engine.types.Robot と同じ)


class GraspSettingsWire(_ContractModel):
    """1 シーンの全ピックで共有する把持探索設定 (per-entity でない部分)。

    Decision 3 の用語境界を wire でも保つ: `robot.wristConeHalfAngle` = 許容角 (届く向き) /
    `approachTiltAngles` / `rollAngles` = 進入角 (試す向き)。混ぜない。
    """

    robot: RobotWire
    objective_weights: dict[str, float] = Field(default_factory=dict)
    approach_tilt_angles: list[float] = Field(default_factory=lambda: [0.0])
    roll_angles: list[float] = Field(default_factory=lambda: [0.0])
    pre_grasp_distance: float = 0.1
    clearance_reference: float = 0.1
    top_n: int = Field(default=5, ge=1)


class PickSequenceRequest(_ContractModel):
    """BFF -> コアAPI の入力 (最上面順の反復ピック要求)。"""

    contract_version: int = Field(default=CONTRACT_VERSION)
    # 前提とする Layout DSL のスキーマバージョン (public スキーマを *参照*)。
    layout_version: str
    scene: SceneWire
    settings: GraspSettingsWire
    # ピック数の上限。None なら取れるだけ取る。
    max_picks: Optional[int] = Field(default=None, ge=0)


# --- 出力 (コアAPI -> BFF): per-pick の把持ランキング --------------------------


class PickStepWire(_ContractModel):
    """反復ピック 1 ステップの結果。

    - `targetId`: この回に選んだ対象エンティティ。
    - `picked`: feasible な把持があり対象を除去したか。
    - `derivedObstacleCount`: 属性 + ピック履歴から導出した障害物の個数 (検査材料。
      「どの障害物導出で」= ADR-078 UI 申し送り)。導出そのもの (どの球か) は判定なので出さない。
    - `candidates`: この対象の把持ランキング (rank 昇順)。grasp の `PoseCandidate` を再利用。
    """

    target_id: str
    picked: bool
    derived_obstacle_count: int = Field(ge=0)
    candidates: list[PoseCandidate] = Field(default_factory=list)


class PickSequenceResponse(_ContractModel):
    """コアAPI -> BFF の出力。ピックできた順のステップ列。"""

    contract_version: int = Field(default=CONTRACT_VERSION)
    picks: list[PickStepWire] = Field(default_factory=list)
