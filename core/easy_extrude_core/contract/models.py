"""BFF <-> コアAPI の I/O 契約の型 (ADR-074)。

入力 = graspSearch 宣言 (+ layout スキーマバージョン + contractVersion)。
出力 = 上位N件の姿勢ランキング (各候補にスコア内訳) + contractVersion。

注意:
- ここは契約 *だけ*。IK / 干渉 / リーチ / wrench cone の *解く処理* は入れない (DSL/判定の線引き)。
- Layout DSL (hardConstraints / objectives) の詳細スキーマは public 側の正本に属する。
  ここで二重定義せず、`layout_version` で参照するに留める (Documentation Drift 回避)。
- objective スコアは絶対基準で 0-1 正規化済みを契約として強制する
  (テンプレ間の比較可能性 = 商品価値)。
- この契約型は コア側の正本。最終的には中立な共有パッケージへ寄せ、
  BFF (TS) はそのミラーを参照する (ADR-074 §6)。
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .version import CONTRACT_VERSION


class _ContractModel(BaseModel):
    """契約モデル共通設定。

    wire 形 (BFF=TS と共有する JSON Schema) は camelCase。Python では snake_case の
    まま書き、エイリアスで camelCase に写す。serialize するときは by_alias=True で
    wire 形 (camelCase) を出す。中立スキーマは @easy-extrude/grasp-contract の正本。
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class GraspSearchDeclaration(_ContractModel):
    """graspSearch 宣言の契約境界での受け皿。

    宣言の中身 (hardConstraints / objectives など) の厳密な形は Layout DSL スキーマ
    (= public/共有パッケージの正本, `layout_version` が指す) に属する。ここでは
    コアが二重定義しないよう、payload を素通しの構造として保持する。
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="allow",
    )

    # objectives の重み (名前 -> weight)。スコア内訳のキーと対応する。
    objective_weights: dict[str, float] = Field(default_factory=dict)
    # 上位何件返すか。BFF が「1位がダメな時のフォールバック」に使う。
    top_n: int = Field(default=5, ge=1)


class GraspSearchRequest(_ContractModel):
    """BFF -> コアAPI の入力。"""

    contract_version: int = Field(default=CONTRACT_VERSION)
    # 前提とする Layout DSL のスキーマバージョン (例 "layout/1.0")。public スキーマを *参照*。
    layout_version: str
    grasp_search: GraspSearchDeclaration


class ScoreBreakdown(_ContractModel):
    """1 候補のスコア内訳 (ADR-074)。テンプレの「なぜこの姿勢か」の可視化材料。"""

    # 安い順フィルタの結果 (リーチ -> IK -> 干渉)。
    within_reach: bool
    ik_solvable: bool
    interference_free: bool
    # 各 objective の正規化済み (0-1) 値。キーは objective 名。
    objective_scores: dict[str, float] = Field(default_factory=dict)
    # 加重和の総合スコア (0-1 正規化値の重み付き和)。
    total_score: float = Field(ge=0.0)


class PoseCandidate(_ContractModel):
    """ランキング 1 件分。pose は契約 v2 の kind 判別 union (endEffector / jointSpace)。"""

    rank: int = Field(ge=1)
    # ソルバが決定した姿勢。契約 v2 では閉じた kind 判別 union (endEffector.frame /
    # jointSpace.chainRef+joints)。境界では union dict を素通しし、形の権威は上流 Schema。
    # 演出 (接近ベクトル・色など) はワイヤに載せずクライアントが frame + 規約から導出する。
    pose: dict[str, Any] = Field(default_factory=dict)
    score: ScoreBreakdown


class SearchDiagnostics(_ContractModel):
    """探索全体の棄却ファネル + reach near-miss (契約 v3, ADR-079)。

    載せるのは「ソルバが決定した事実」の集計のみ。演出 (文言/色/メーター) は
    クライアント導出でここには含めない。不変条件 (上流 Schema と同一):
    candidates_generated = rejected_by_reach + rejected_by_ik
    + rejected_by_interference + feasible。
    """

    candidates_generated: int = Field(ge=0)
    rejected_by_reach: int = Field(ge=0)
    rejected_by_ik: int = Field(ge=0)
    rejected_by_interference: int = Field(ge=0)
    # 3 判定すべて通過した候補数 (= 採点対象)。
    feasible: int = Field(ge=0)
    # 実際に candidates[] へ載せた件数 (= min(feasible, topN))。
    returned: int = Field(ge=0)
    # リーチ棄却候補の到達殻までの最小不足距離。リーチ棄却ゼロなら None。
    reach_nearest_miss: Optional[float] = Field(default=None, ge=0.0)


class GraspSearchResponse(_ContractModel):
    """コアAPI -> BFF の出力。上位N件 + スコア内訳 + 診断 (契約 v3)。"""

    contract_version: int = Field(default=CONTRACT_VERSION)
    # rank 昇順 (1 が最良) で並んだ上位N件。最良 1 件だけにしない。
    candidates: list[PoseCandidate] = Field(default_factory=list)
    # 探索全体の棄却ファネル + near-miss (契約 v3 で必須, ADR-079)。producer は常に emit する。
    diagnostics: SearchDiagnostics
