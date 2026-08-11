"""per-pick の target / obstacles 導出 (純粋・副作用なし)。ADR-078 Decision 2。

ADR-078 の確定式を純粋関数として実装する:

    obstacles(pick) = {全 static エンティティ}
                   + {全 dynamic エンティティ} - {今回の target} - {既にピック済み}

これで「対象除外」「壁は常時障害物」「ピックでシーンが縮む」が **属性から自動的に出る**
(手書き再構築をやめる)。最上面順の候補列挙 (z ソート) もここに置く。

純粋/副作用境界 (ADR-078 Decision 2 / ADR-075 踏襲):
- **導出は純粋関数** (このモジュール)。エンジン契約 (`GraspSearchRequest`) を組むところまで。
- **ピック列の進行 (除去・再評価) は副作用境界** (`orchestration.py`) に置く。

seam (接合面): エンジン 1 リクエストの契約は不変。ここは scene -> 契約 request の adapter。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from ..contract import CONTRACT_VERSION, GraspSearchRequest
from ..engine.feasibility import sightline_occlusion_miss
from ..engine.types import (
    Camera,
    GripperKind,
    Obstacle,
    ParallelJawGripper,
    SuctionGripper,
)
from .types import Scene, SceneEntity
from .settings import GraspSettings


def derive_obstacles(
    scene: Scene,
    target_id: str,
    picked_ids: Iterable[str] = (),
) -> tuple[Obstacle, ...]:
    """1 ピック要求に対する障害物集合を属性から導出する (純粋, ADR-078 Decision 2)。

    formula: {全 static} + {全 dynamic} - {target} - {picked}。
    実装は「target でも picked でもないエンティジ全部の干渉球を集める」だけ。static は
    target/picked に決してならないため常時残り、dynamic は target/picked のぶんだけ消える。
    -> 罠 (対象自身を障害物に入れて線分-球距離 0 で自己干渉, ADR-078 Context) を構造的に回避。
    """
    excluded = {target_id, *picked_ids}
    obstacles: list[Obstacle] = []
    for e in scene.entities:
        if e.entity_id in excluded:
            continue
        obstacles.extend(e.collision_spheres)
    return tuple(obstacles)


def targetable_entities(
    scene: Scene,
    picked_ids: Iterable[str] = (),
) -> tuple[SceneEntity, ...]:
    """まだピックしていない、対象になり得るエンティティ (純粋)。

    dynamic かつ把持点を持つもの (`is_targetable`) のうち picked 済みを除く。順序は scene
    の宣言順 (決定的)。最上面順に並べたい場合は `order_by_topmost` を通す。
    """
    picked = set(picked_ids)
    return tuple(
        e
        for e in scene.entities
        if e.is_targetable and e.entity_id not in picked
    )


def viewable_entities(
    scene: Scene,
    camera: Camera | None,
    entities: Sequence[SceneEntity],
    picked_ids: Iterable[str] = (),
) -> tuple[SceneEntity, ...]:
    """カメラから見えるエンティティだけに絞る (純粋, ADR-081 Decision 1)。

    エンティティ粒度の可視性: 把持点 (surface_samples) の少なくとも 1 点への視線が
    通るエンティティを「見える」とする。遮蔽物は **自分以外** の未ピック エンティティの
    干渉球 (自分の球で自分を遮らない — per-pick 導出の対象除外と同じ罠回避)。
    視線判定は候補粒度と同じ `sightline_occlusion_miss` (第二の源を作らない)。

    camera 未宣言 (None) は絞り込みなし (top_z 順という従来代理のまま)。ADR-081:
    top_z 順の「上 = 見える」という暗黙の代理が、カメラ宣言に基づく判定へ昇格する。
    """
    if camera is None:
        return tuple(entities)
    picked = set(picked_ids)
    visible_list: list[SceneEntity] = []
    for entity in entities:
        occluders: list[Obstacle] = []
        for other in scene.entities:
            if other.entity_id == entity.entity_id or other.entity_id in picked:
                continue
            occluders.extend(other.collision_spheres)
        occluder_tuple = tuple(occluders)
        for point, _normal in entity.surface_samples:
            if sightline_occlusion_miss(camera, point, occluder_tuple) <= 0.0:
                visible_list.append(entity)
                break
    return tuple(visible_list)


def order_by_topmost(entities: Sequence[SceneEntity]) -> tuple[SceneEntity, ...]:
    """エンティティを「最上面から」順 (top_z 降順) に並べる (純粋, ADR-078 Decision 1)。

    同 z は entity_id 昇順で決定的に割る (再現性 = テスト容易性, 素朴版の規律)。
    """
    return tuple(sorted(entities, key=lambda e: (-e.top_z, e.entity_id)))


def build_request(
    scene: Scene,
    target_id: str,
    settings: GraspSettings,
    picked_ids: Iterable[str] = (),
) -> GraspSearchRequest:
    """scene + 対象 + ピック履歴から **エンジン契約 request** を組む (純粋, seam)。

    エンジン 1 リクエストの契約 (`target` + `obstacles[]`) は不変 (ADR-078 Decision 2)。
    ここは scene -> 契約 wire 形 (camelCase) の adapter。実際の入力と同じ経路を通すため
    `model_validate` で組み立てる (engine.pipeline が読む既知キーに合わせる)。

    対象が targetable でない (把持点の無い dynamic / static) 場合は ValueError
    (曖昧に握りつぶさない = CLAUDE.md 設計方針)。
    """
    target = scene.by_id(target_id)
    if not target.is_targetable:
        raise ValueError(
            f"entity {target_id!r} is not targetable "
            f"(kind={target.kind.value}, persistence={target.resolved_persistence.value}, "
            f"surface_samples={len(target.surface_samples)})"
        )

    obstacles = derive_obstacles(scene, target_id, picked_ids)
    robot = settings.robot

    grasp_search = {
        "robot": {
            "base": robot.base.as_list(),
            "reachMin": robot.reach_min,
            "reachMax": robot.reach_max,
            "wristConeHalfAngle": robot.wrist_cone_half_angle,
        },
        "target": {
            "surfaceSamples": [
                {"point": p.as_list(), "normal": n.as_list()}
                for (p, n) in target.surface_samples
            ],
        },
        "obstacles": [
            {"center": o.center.as_list(), "radius": o.radius} for o in obstacles
        ],
        "sampling": {
            "approachTiltAngles": list(settings.approach_tilt_angles),
            "rollAngles": list(settings.roll_angles),
            "preGraspDistance": settings.pre_grasp_distance,
            "clearanceReference": settings.clearance_reference,
        },
        "objectiveWeights": dict(settings.objective_weights),
        "topN": settings.top_n,
    }
    # camera / gripper 宣言 (ADR-081)。未宣言はキーごと出さない (エンジン側の
    # ゲート無効の規約と一致。空 dict を送って意味を曖昧にしない)。
    if settings.camera is not None:
        camera_wire: dict = {"position": settings.camera.position.as_list()}
        if settings.camera.view_axis is not None:
            camera_wire["viewAxis"] = settings.camera.view_axis.as_list()
        if settings.camera.fov_half_angle is not None:
            camera_wire["fovHalfAngle"] = settings.camera.fov_half_angle
        grasp_search["camera"] = camera_wire
    if settings.gripper is not None:
        # kind 判別 (ADR-118)。ここはドメイン型 -> ワイヤの写しなので、種別ごとに
        # 出すキーが違う。既定へ倒す余地は無い (型が既に種別を持っている)。
        grasp_search["gripper"] = _gripper_to_wire(settings.gripper)
    return GraspSearchRequest.model_validate(
        {
            "contractVersion": CONTRACT_VERSION,
            "layoutVersion": settings.layout_version,
            "graspSearch": grasp_search,
        }
    )


def _gripper_to_wire(gripper) -> dict:
    """ドメインのハンド型をワイヤの kind 判別 union へ (ADR-118, 純粋)。

    種別ごとに出すキーが違う。未宣言の種別は **throw** する — 既定へ倒すと、
    シーン層が組んだ request が宣言と食い違ったままエンジンへ渡る。
    """
    if isinstance(gripper, ParallelJawGripper):
        return {
            "kind": GripperKind.PARALLEL_JAW.value,
            "maxOpening": gripper.max_opening,
            "fingerClearance": gripper.finger_clearance,
        }
    if isinstance(gripper, SuctionGripper):
        return {
            "kind": GripperKind.SUCTION.value,
            "cupDiameter": gripper.cup_diameter,
            "sealTiltTolerance": gripper.seal_tilt_tolerance,
        }
    raise ValueError(f"未宣言のハンド種別 {type(gripper).__name__} (ADR-118)")
