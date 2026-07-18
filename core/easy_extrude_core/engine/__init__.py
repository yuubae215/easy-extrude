"""段階0 判定エンジン (レイヤ B のコア実装)。

ADR-075 の方針に従う素朴版:

    離散候補生成 -> 安い順フィルタ (リーチ -> IK 可解 -> 干渉) -> 加重和スコア -> 上位N件

設計規律 (ADR-075 / CLAUDE.md):
- 純粋関数 (候補生成・制約判定・objective 正規化・スコア計算) と
  副作用ありの orchestration (`pipeline.search`) を分離する。
- IK ソルバ・干渉チェッカは Protocol で注入する (素朴版は naive な既定実装を同梱)。
- 数値的安定性を最優先 (ゼロ長ガード / 定義域クランプ)、その次に計算時間。
- objective は絶対基準で 0-1 正規化してから重み付け加算 (テンプレ間比較可能性)。

公開 API は `search` (契約 GraspSearchRequest -> GraspSearchResponse) と
`search_report` (応答 + 棄却ファネル診断 SearchDiagnostics, ADR-079)。
"""

from __future__ import annotations

from .candidates import generate_candidates
from .feasibility import (
    CollisionChecker,
    IkSolution,
    IkSolver,
    NaiveIkSolver,
    NaiveSphereCollisionChecker,
    interference_free,
    ik_solvable,
    reach_miss,
    within_reach,
)
from .objectives import OBJECTIVE_REGISTRY, NormSpec, evaluate_objectives
from .pipeline import (
    SearchDiagnostics,
    SearchReport,
    problem_from_declaration,
    search,
    search_report,
)
from .pose_codec import pose_from_payload, pose_to_payload
from .scoring import weighted_sum
from .types import GraspCandidate, Obstacle, Pose, Problem, Robot, TargetObject, Vec3

__all__ = [
    # 公開エントリ
    "search",
    "search_report",
    "problem_from_declaration",
    # 診断 (ADR-079: 判定の証明)
    "SearchDiagnostics",
    "SearchReport",
    # ドメイン型
    "Vec3",
    "Pose",
    "GraspCandidate",
    "Robot",
    "Obstacle",
    "TargetObject",
    "Problem",
    # 候補生成 (純粋)
    "generate_candidates",
    # 実行可能性 (純粋判定 + 注入 Protocol + naive 既定)
    "within_reach",
    "reach_miss",
    "ik_solvable",
    "interference_free",
    "IkSolver",
    "IkSolution",
    "CollisionChecker",
    "NaiveIkSolver",
    "NaiveSphereCollisionChecker",
    # objective (純粋)
    "evaluate_objectives",
    "OBJECTIVE_REGISTRY",
    "NormSpec",
    # スコア (純粋)
    "weighted_sum",
    # pose <-> 契約 payload
    "pose_to_payload",
    "pose_from_payload",
]
