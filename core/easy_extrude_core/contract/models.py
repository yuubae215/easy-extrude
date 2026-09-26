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

from typing import Any, Literal, Optional

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


class ReachSolutionSolved(_ContractModel):
    """候補に届く**代表**関節配置 (契約 v6, ADR-135)。

    解析解は最大 8 個あるが段階0 が問うのは可解性なので、ソルバが決定的に 1 つ選ぶ
    (ADR-127 D5)。単位はラジアン、順序は宣言された `robot.kinematics` の鎖順
    (ベース→フランジ) で **ちょうど 6**。
    """

    kind: Literal["solved"] = "solved"
    # ワイヤ形は **list** (JSON の array)。エンジン側の `IkSolution.joints` は
    # 不変な tuple だが、契約モデルはワイヤの形を持つのが仕事なのでここで写す —
    # 準拠テストは model_dump() を JSON Schema に直接かけるため、tuple のままだと
    # 「型は array」を満たさない。
    joints: list[float] = Field(min_length=6, max_length=6)


class ReachSolutionUndeclared(_ContractModel):
    """関節配置を**誰も決めていない** (契約 v6, ADR-135)。

    `robot.kinematics` 未宣言 = 手首コーン代理判定 (ADR-127 D3) が可解性だけを答えた
    状態。クライアントは腕の姿勢を描いてはならない — 捏造した配置は「ソルバが決めた
    事実」ではないので、ワイヤに載る他のすべてと性質が違う (ADR-060)。

    **枝を持たせる理由** (原則 #31): 不在を「欄の省略」で示すと、未宣言と
    「まだ実装していない生産者」が同じ形になる。正当な 0 は宣言させる。
    """

    kind: Literal["undeclared"] = "undeclared"


# kind 判別の閉じた union。枝を足すのは契約の版を上げる意図的行為 (ADR-060 の統治)。
ReachSolution = ReachSolutionSolved | ReachSolutionUndeclared


class ScoreBreakdown(_ContractModel):
    """1 候補のスコア内訳 (ADR-074 / 契約 v4 でドメイン 5 段, ADR-081)。

    テンプレの「なぜこの姿勢か」の可視化材料。visible / graspable はリクエストが
    camera / gripper を宣言していない場合は空虚に True (どちらだったかはリクエスト
    宣言の有無から読める — Schema の記述と同一)。
    """

    # ドメイン段階フィルタの結果 (5 判定。段の実行順はエンジン所有 = 安い順実測,
    # engine/pipeline.py)。
    within_reach: bool
    visible: bool
    ik_solvable: bool
    interference_free: bool
    graspable: bool
    # 各 objective の正規化済み (0-1) 値。キーは objective 名。
    objective_scores: dict[str, float] = Field(default_factory=dict)
    # 加重和の総合スコア (0-1 正規化値の重み付き和)。
    total_score: float = Field(ge=0.0)
    # ソルバが決定した関節配置 (契約 v6, ADR-135)。kind 判別の閉じた union で、
    # **必須**。判別しているのは到達可否ではなく「描ける関節ベクトルが在るか」で、
    # 到達可否は上の `ik_solvable` が既に運んでいる (返る候補は短絡フィルタを
    # 通っているので必ず True)。
    reach_solution: ReachSolution = Field(discriminator="kind")


class PoseCandidate(_ContractModel):
    """ランキング 1 件分。pose は契約 v2 の kind 判別 union (endEffector / jointSpace)。"""

    rank: int = Field(ge=1)
    # ソルバが決定した姿勢。契約 v2 では閉じた kind 判別 union (endEffector.frame /
    # jointSpace.chainRef+joints)。境界では union dict を素通しし、形の権威は上流 Schema。
    # 演出 (接近ベクトル・色など) はワイヤに載せずクライアントが frame + 規約から導出する。
    pose: dict[str, Any] = Field(default_factory=dict)
    score: ScoreBreakdown
    # どの把持仕様 (request `target.graspSpecs[].id`) から生まれた候補か (契約 v7,
    # ADR-152 D4)。None = 導出サンプル (`surfaceSamples`) 由来。**必須の nullable** —
    # 閉じた層に optional 兄弟を生やさない (ADR-060)。既定値を持たせないのは、
    # 生産者が書き忘れた候補を「仕様なし」に黙って倒さないため (原則 #31)。
    grasp_spec_id: Optional[str]


class GraspNearestMiss(_ContractModel):
    """把持棄却の「あとどれだけ」を、量の種別つきで運ぶ (契約 v5, ADR-118)。

    kind 判別の有界 union。`opening` は平行ジョーの開口不足、`sealPatch` は吸引の
    シールパッチ不足で、どちらも長さだがユーザーに見せる文言もメーターの基準も違う。
    枝を足すのは契約の版を上げる意図的行為 (ADR-060 の統治をそのまま適用)。
    """

    kind: Literal["opening", "sealPatch"]
    shortfall: float = Field(ge=0.0)


class GraspSpecDiagnostics(_ContractModel):
    """把持仕様 1 つぶんの結果 (契約 v7, ADR-152 D4)。

    戦略が候補を返さなかった仕様も行を持つ — 「返さなかった」と「無かった」は別の事実
    (原則 #31)。段ごとの棄却内訳を仕様ごとに割るのは残し。
    """

    id: str = Field(min_length=1)
    candidates_generated: int = Field(ge=0)
    feasible: int = Field(ge=0)


class SearchDiagnostics(_ContractModel):
    """探索全体の棄却ファネル + ドメイン別 near-miss (契約 v4, ADR-079/081)。

    載せるのは「ソルバが決定した事実」の集計のみ。演出 (文言/色/メーター) は
    クライアント導出でここには含めない。不変条件 (正本 Schema と同一):
    candidates_generated = rejected_by_reach + rejected_by_visibility + rejected_by_ik
    + rejected_by_interference + rejected_by_grasp + feasible。
    """

    candidates_generated: int = Field(ge=0)
    rejected_by_reach: int = Field(ge=0)
    rejected_by_visibility: int = Field(ge=0)
    rejected_by_ik: int = Field(ge=0)
    rejected_by_interference: int = Field(ge=0)
    rejected_by_grasp: int = Field(ge=0)
    # 5 判定すべて通過した候補数 (= 採点対象)。
    feasible: int = Field(ge=0)
    # 実際に candidates[] へ載せた件数 (= min(feasible, topN))。
    returned: int = Field(ge=0)
    # リーチ棄却候補の到達殻までの最小不足距離。リーチ棄却ゼロなら None。
    reach_nearest_miss: Optional[float] = Field(default=None, ge=0.0)
    # 可視棄却候補の最小遮蔽量。測定可能な可視棄却が無ければ None (視野外のみ等)。
    occlusion_nearest_miss: Optional[float] = Field(default=None, ge=0.0)
    # 把持棄却候補の最小不足量を **種別つき** で運ぶ (契約 v5, ADR-118)。v4 の
    # `opening_nearest_miss` は名前も単位も平行ジョー専用だったので、吸引の
    # シールパッチ不足を同じ欄で報告すると、クライアントは違う量のメーターを描く。
    # 測定可能な把持棄却が無ければ None (接触対なし等 / gripper 未宣言)。
    grasp_nearest_miss: Optional[GraspNearestMiss] = None
    # 送られた把持仕様ごとの生成数・通過数を、リクエストの順で**全仕様ぶん** (契約 v7,
    # ADR-152 D4)。仕様を送らなければ空配列。必須 — 既定値を持たせない。
    grasp_specs: list[GraspSpecDiagnostics]


class GraspSearchResponse(_ContractModel):
    """コアAPI -> BFF の出力。上位N件 + スコア内訳 + 診断 (契約 v4)。"""

    contract_version: int = Field(default=CONTRACT_VERSION)
    # rank 昇順 (1 が最良) で並んだ上位N件。最良 1 件だけにしない。
    candidates: list[PoseCandidate] = Field(default_factory=list)
    # 探索全体の棄却ファネル + near-miss (v3 で必須化, v4 で 5 段, ADR-079/081)。
    # producer は常に emit する。
    diagnostics: SearchDiagnostics
