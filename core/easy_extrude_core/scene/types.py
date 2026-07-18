"""bin-picking シーン層のドメイン型 (純粋・副作用なし)。ADR-078 Decision 1/2。

ADR-078 の確定方針を型にする:
- 「障害物かどうか」はジオメトリ固定の性質ではなく **エンティティの属性** (Decision 1)。
  各エンティティに `kind` (wall/workpiece/fixture) と 永続性 (static/dynamic) を持たせ、
  ある 1 ピックの障害物集合は **属性から導出** する (手書きしない)。
- エンジン 1 リクエストの契約 (`target` + `obstacles[]`) は **不変** に保つ (Decision 2)。
  この層は契約の **上** に乗り、属性 + ピック履歴から per-pick の target / obstacles を導出する。

壁の規律 (CLAUDE.md / ADR-077 と同じ動詞境界):
- public (器) は「これは dynamic な workpiece だ」と **宣言** する (Layout DSL の属性語彙)。
- コア (この層, B) は「ではこのピックの障害物集合はこれ」と **導出・判定** する。
- entity / scene スキーマの **厳密な wire 形は public Layout DSL 正本待ち** (ADR-078 deferred)。
  よってここでは recommendation lane と同じく public 宣言を **ドメイン型として消費** し、
  wire スキーマを重複定義しない。

座標系は engine と同じ (ADR-075 の素朴な前提)。geometry は段階0 の球近似のみ
(`engine.types.Obstacle`)。薄型壁の厳密干渉 (箱/半空間) は ADR-078 deferred。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..engine.types import Obstacle, Vec3


class EntityKind(str, Enum):
    """シーンを構成するエンティティの種別 (ADR-078 Decision 1)。

    既定の永続性 (static/dynamic) はここから導く: wall/fixture = static (常時障害物),
    workpiece = dynamic (ピックで除去され得る・対象になり得る)。
    """

    WALL = "wall"
    WORKPIECE = "workpiece"
    FIXTURE = "fixture"


class Persistence(str, Enum):
    """エンティティの永続性 (ADR-078 Decision 1)。

    - STATIC: 状態変化なし。常に障害物、対象にはならない (例: 壁・治具)。
    - DYNAMIC: ピックで除去され得る。対象 (target) にも障害物にもなる (例: ワーク)。
    """

    STATIC = "static"
    DYNAMIC = "dynamic"


# kind -> 既定の永続性。UI では属性として編集可だが、既定はここから (ADR-078 UI 申し送り)。
_DEFAULT_PERSISTENCE: dict[EntityKind, Persistence] = {
    EntityKind.WALL: Persistence.STATIC,
    EntityKind.FIXTURE: Persistence.STATIC,
    EntityKind.WORKPIECE: Persistence.DYNAMIC,
}


@dataclass(frozen=True)
class SceneEntity:
    """属性付きシーンエンティティ 1 件 (ADR-078 Decision 1)。

    geometry を 2 つの役で持つ:
    - `collision_spheres`: このエンティティが **他の把持を遮る** ときの干渉形状
      (段階0 は球近似。1 エンティティ = 複数球も可。例: 薄型壁リムを球列で近似)。
    - `surface_samples`: このエンティティ自身が **対象 (target)** になるときの把持点
      (点 + 外向き法線)。対象になれないエンティティ (壁等) は空。

    `persistence` は明示できるが、None なら kind から既定を解決する (壁=static /
    ワーク=dynamic)。属性編集 (UI) で wall を dynamic にするといった上書きも許す。
    """

    entity_id: str
    kind: EntityKind
    collision_spheres: tuple[Obstacle, ...] = ()
    surface_samples: tuple[tuple[Vec3, Vec3], ...] = ()
    persistence: Persistence | None = None

    @property
    def resolved_persistence(self) -> Persistence:
        """明示があればそれ、無ければ kind 既定の永続性 (純粋)。"""
        if self.persistence is not None:
            return self.persistence
        return _DEFAULT_PERSISTENCE.get(self.kind, Persistence.STATIC)

    @property
    def is_static(self) -> bool:
        """常時障害物か (ピックで消えない)。"""
        return self.resolved_persistence is Persistence.STATIC

    @property
    def is_dynamic(self) -> bool:
        """ピックで除去され得るか。"""
        return self.resolved_persistence is Persistence.DYNAMIC

    @property
    def is_targetable(self) -> bool:
        """このピックの対象になり得るか。

        dynamic かつ把持点 (surface_samples) を持つものだけが対象になり得る。壁 (static) や
        把持点の無い dynamic は対象にしない (ADR-078 Decision 1: 対象は workpiece)。
        """
        return self.is_dynamic and len(self.surface_samples) > 0

    @property
    def top_z(self) -> float:
        """「最上面から取る」順序づけ用の代表 z (純粋)。

        把持点 (surface_samples) の最大 z を使う (上面把持の高さ)。把持点が無ければ
        干渉球中心の最大 z に落ちる。どちらも無ければ -inf (順序の最下位)。
        ADR-078: feasible な dynamic のうち z 最大を選ぶ反復ポリシが参照する。
        """
        zs: list[float] = [p.z for (p, _n) in self.surface_samples]
        zs.extend(o.center.z for o in self.collision_spheres)
        if not zs:
            return float("-inf")
        return max(zs)


@dataclass(frozen=True)
class Scene:
    """属性付きエンティティの集合としてのシーン (ADR-078 Decision 1)。

    フラットな `obstacles[]` 手書きリストではなく、属性付きエンティティで持つことで
    「対象除外」「壁は常時障害物」「ピックでシーンが縮む」を **属性から自動導出** できる。
    """

    entities: tuple[SceneEntity, ...] = ()

    def by_id(self, entity_id: str) -> SceneEntity:
        """entity_id でエンティティを引く。無ければ KeyError (曖昧に握りつぶさない)。"""
        for e in self.entities:
            if e.entity_id == entity_id:
                return e
        raise KeyError(f"unknown entity_id: {entity_id!r}")
