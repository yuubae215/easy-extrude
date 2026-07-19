"""bin-picking シーン層 (バックエンドレイヤのコア実装)。ADR-078。

フラットな `obstacles[]` 手書きリストの代わりに、シーンを **属性付きエンティティの集合**
(`Scene` / `SceneEntity`) で表し、ある 1 ピックの target / obstacles を **属性から導出** する。

    obstacles(pick) = {全 static} + {全 dynamic} - {今回の target} - {既にピック済み}

「最上面から取る」反復ポリシ (feasible な dynamic のうち z 最大を選び、ピック後に除去して
再評価) で多ピックのシーケンスに乗せる。

層の関係 (ADR-078 Decision 2 = 壁の規律):
- エンジン 1 リクエストの契約 (`target` + `obstacles[]`) は **不変**。この層はその **上** に
  乗り、エンティティ属性 + ピック履歴から per-pick の契約 request を導出する (seam = 契約)。
- DSL (器) は「これは dynamic な workpiece だ」と **宣言**、コア (この層) は「では
  このピックの障害物集合・把持はこれ」と **導出・判定** する (decide/propose と同じ動詞境界)。

設計規律 (ADR-078 / ADR-075 / CLAUDE.md, engine と同形):
- **導出は純粋関数** (`derivation`: derive_obstacles / order_by_topmost / build_request)。
- **ピック列の進行 (除去・再評価) は副作用境界** (`orchestration.run_pick_sequence`)。
  IK ソルバ / 干渉チェッカは Protocol 注入 (省略時は engine の naive 既定)。
- 用語境界 (Decision 3): cone = 許容角 (届く向き, robot) / approach = 進入角 (試す向き,
  sampling)。`settings.GraspSettings` で両者を別軸に保つ。

後続に defer (ADR-078 Still deferred):
- entity / scene の **厳密な wire スキーマ** (public Layout DSL 正本待ち。現状は public
  宣言を **ドメイン型として消費**し、重複定義しない = recommendation lane と同形)。
- 箱 / 半空間 (平面) 障害物 = 薄型壁の厳密干渉 (ADR-075 の球近似 deferred と同根)。
- 本物の wrench cone 把持安定性 (ADR-075 既出)。
"""

from __future__ import annotations

from .derivation import (
    build_request,
    derive_obstacles,
    order_by_topmost,
    targetable_entities,
)
from .orchestration import PickResult, pick_sequence, run_pick_sequence
from .settings import GraspSettings
from .types import EntityKind, Persistence, Scene, SceneEntity

__all__ = [
    # ドメイン型 (属性付きエンティティ)
    "EntityKind",
    "Persistence",
    "SceneEntity",
    "Scene",
    # ピック設定 (per-entity でない部分; cone/approach を別軸に保つ)
    "GraspSettings",
    # 導出 (純粋: target/obstacles 導出, 最上面順, 契約 request 組み立て)
    "derive_obstacles",
    "targetable_entities",
    "order_by_topmost",
    "build_request",
    # ピック列 orchestration (副作用境界: 最上面順の反復ピック)
    "run_pick_sequence",  # ドメイン純粋型 I/O
    "pick_sequence",  # 契約 wire I/O (PickSequenceRequest -> PickSequenceResponse)
    "PickResult",
]
