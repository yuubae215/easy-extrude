"""ピック列の orchestration (副作用境界)。ADR-078 Decision 1/2。

ADR-078 の「最上面から取る」反復ポリシを実装する:

    feasible かつ collision-free な把持を持つ dynamic エンティティのうち z 最大を選び、
    ピック後に scene から除去して再評価する。

純粋/副作用境界 (ADR-078 Decision 2 / ADR-075 踏襲):
- 導出 (per-pick の target / obstacles, 最上面順) は **純粋** (`derivation.py`)。
- **ピック列の進行 (注入ソルバ/チェッカでの判定呼び出し・除去・再評価) は副作用境界**
  = このモジュール。`engine.pipeline.search` と同形に、IK ソルバ / 干渉チェッカを注入する。

seam: 1 ピックは **エンジン契約 (`GraspSearchRequest` -> `GraspSearchResponse`)** を通る。
エンジンの契約は不変 (ADR-078 Decision 2)。この層はその往復を反復で束ねるだけ。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..contract import (
    GraspSearchRequest,
    GraspSearchResponse,
    PickSequenceRequest,
    PickSequenceResponse,
    PickStepWire,
)
from ..engine.feasibility import CollisionChecker, IkSolver
from ..engine.pipeline import search
from ..engine.types import Obstacle, Robot, Vec3
from .derivation import build_request, order_by_topmost, targetable_entities
from .settings import GraspSettings
from .types import EntityKind, Persistence, Scene, SceneEntity


@dataclass(frozen=True)
class PickResult:
    """ピック列 1 ステップの結果 (どの対象を、どの導出で、どう判定したか)。

    - `target_id`: この回に選んだ対象エンティティ。
    - `request`: 属性 + ピック履歴から導出した per-pick のエンジン契約 request
      (target + 導出 obstacles)。検査可能性のため残す。
    - `response`: エンジンが返した把持ランキング (rank 昇順)。空 = この回は feasible な
      把持なし。
    - `picked`: feasible な把持があり、対象を scene から除去したか。
    """

    target_id: str
    request: GraspSearchRequest
    response: GraspSearchResponse
    picked: bool


def run_pick_sequence(
    scene: Scene,
    settings: GraspSettings,
    *,
    ik_solver: Optional[IkSolver] = None,
    collision_checker: Optional[CollisionChecker] = None,
    max_picks: Optional[int] = None,
) -> list[PickResult]:
    """最上面順の反復ピックを回す (副作用境界, ADR-078 Decision 1)。

    各反復で「まだ取っていない targetable エンティティ」を最上面順 (top_z 降順) に並べ、
    上から順に per-pick request を導出してエンジンで判定する。feasible な把持を持つ
    最初の (= 最上面の) エンティティをピックして履歴に積み、scene から論理的に除去して
    次の反復へ。1 反復で誰も feasible でなければ終了 (それ以上は取れない)。

    除去で障害物集合が縮むため、ある回に詰まっていた下位ワークが次回 feasible になり得る。
    よって毎反復で全 targetable を取り直す (恒久スキップしない)。picked は単調増加で
    targetable 数が上界 -> 必ず停止。

    ソルバ/チェッカは注入可能 (省略時は engine の naive 既定)。`max_picks` でピック数を
    上限できる (None なら取れるだけ取る)。

    返り値はピックできた順の `PickResult` 列。各 request/response を載せるので、呼び出し側
    (UI/BFF) は「どの対象を、どの障害物導出で、どう順位づけたか」を読み取れる
    (ADR-078 UI 申し送り: 出力プレビュー)。
    """
    picked_ids: list[str] = []
    results: list[PickResult] = []

    while max_picks is None or len(picked_ids) < max_picks:
        ordered = order_by_topmost(targetable_entities(scene, picked_ids))
        progressed = False
        for entity in ordered:
            request = build_request(scene, entity.entity_id, settings, picked_ids)
            response = search(
                request,
                ik_solver=ik_solver,
                collision_checker=collision_checker,
            )
            if response.candidates:
                results.append(
                    PickResult(
                        target_id=entity.entity_id,
                        request=request,
                        response=response,
                        picked=True,
                    )
                )
                picked_ids.append(entity.entity_id)
                progressed = True
                break  # 除去したので最上面から取り直す。
        if not progressed:
            break  # この反復で誰も feasible でない -> これ以上取れない。

    return results


# --- 契約 wire <-> ドメインの adapter (recommendation.lane と同形) --------------
#
# wire 入力 = エンティティ属性の宣言 (器)。これをドメイン型に写し、`run_pick_sequence` を
# 回し、wire 出力 (per-pick の把持ランキング) に戻す。障害物導出・把持判定は domain/engine に
# 閉じ、ここは整形のみ (壁の規律, ADR-078 Decision 2)。contractVersion 検証はエンドポイント層の
# 責務 (ADR-076)。ここは検証済み契約を受け取る計算に徹する。


def _vec(xyz: list[float]) -> Vec3:
    # [x, y, z] の 3 要素配列を Vec3 に。長さが違えば ValueError (曖昧に握りつぶさない)。
    x, y, z = xyz
    return Vec3(x, y, z)


def _scene_from_wire(request: PickSequenceRequest) -> Scene:
    entities: list[SceneEntity] = []
    for e in request.scene.entities:
        spheres = tuple(
            Obstacle(center=_vec(s.center), radius=s.radius) for s in e.collision_spheres
        )
        samples = tuple(
            (_vec(s.point), _vec(s.normal)) for s in e.surface_samples
        )
        # persistence は省略可 (None なら SceneEntity 側が kind から既定を解決する)。
        persistence = Persistence(e.persistence) if e.persistence is not None else None
        entities.append(
            SceneEntity(
                entity_id=e.entity_id,
                kind=EntityKind(e.kind),
                collision_spheres=spheres,
                surface_samples=samples,
                persistence=persistence,
            )
        )
    return Scene(entities=tuple(entities))


def _settings_from_wire(request: PickSequenceRequest) -> GraspSettings:
    s = request.settings
    r = s.robot
    robot = Robot(
        base=_vec(r.base),
        reach_min=r.reach_min,
        reach_max=r.reach_max,
        wrist_cone_half_angle=r.wrist_cone_half_angle,  # 許容角 (届く向き, Decision 3)
    )
    return GraspSettings(
        robot=robot,
        objective_weights=dict(s.objective_weights),
        approach_tilt_angles=tuple(s.approach_tilt_angles),  # 進入角 (試す向き, Decision 3)
        roll_angles=tuple(s.roll_angles),
        pre_grasp_distance=s.pre_grasp_distance,
        clearance_reference=s.clearance_reference,
        top_n=s.top_n,
        layout_version=request.layout_version,
    )


def pick_sequence(
    request: PickSequenceRequest,
    *,
    ik_solver: Optional[IkSolver] = None,
    collision_checker: Optional[CollisionChecker] = None,
) -> PickSequenceResponse:
    """契約 PickSequenceRequest -> PickSequenceResponse (副作用境界)。

    wire の属性宣言をドメイン (`Scene` / `GraspSettings`) に写し、`run_pick_sequence` で
    最上面順の反復ピックを回し、各ステップを wire 形に戻す。ソルバ/チェッカは注入可能
    (省略時は engine の naive 既定)。

    `derivedObstacleCount` は導出した障害物の **個数** だけを載せる (どの球かは判定なので
    出さない = 壁の規律)。`candidates` は grasp の `PoseCandidate` をそのまま再利用する。

    注: contractVersion 検証はエンドポイント層の責務 (ADR-074/003)。ここでは行わない。
    """
    scene = _scene_from_wire(request)
    settings = _settings_from_wire(request)
    results = run_pick_sequence(
        scene,
        settings,
        ik_solver=ik_solver,
        collision_checker=collision_checker,
        max_picks=request.max_picks,
    )
    picks: list[PickStepWire] = []
    for pr in results:
        # build_request が grasp_search に載せた導出済み obstacles の個数 (extra="allow" で
        # 属性露出。test_scene と同じ参照経路)。空でも常に list なので getattr で頑健に。
        derived = getattr(pr.request.grasp_search, "obstacles", []) or []
        picks.append(
            PickStepWire(
                target_id=pr.target_id,
                picked=pr.picked,
                derived_obstacle_count=len(derived),
                candidates=pr.response.candidates,  # 既存 PoseCandidate を再利用
            )
        )
    return PickSequenceResponse(picks=picks)
