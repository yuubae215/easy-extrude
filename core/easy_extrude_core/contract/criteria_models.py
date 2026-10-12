"""判定基準の聞き取りレーンの BFF <-> コアAPI I/O 契約の型 (ADR-165 D3 / D6)。

入力 = エンドユーザ全員の線 (比重 QCD+S + 要素ごとの期待値と重み) と、任意で提案後の線。
出力 = 案 (候補セルとその実態値)、エンドユーザ × 大項目の関心、提案の評価 (差し出すもの)。

不変条件 (ワイヤに載せるのはソルバが決定した事実だけ — ADR-060 / 原則 #29):
- 総合点を載せない (重みの組み合わせ方は core/ のアイデア — ADR-165 D3)。
- どの案が「最良」かを案の列に載せない (選ぶのは人 — D3)。提案の評価だけが、
  差し出すものを説明するために「現在の線で残る案」と「提案後に残る案」の id を運ぶ。
- 顔 (☺ ○ ☹) や色を載せない — 期待値と実態の差は閉形式でクライアントが導く。

中立な正本は packages/grasp-contract の criteria-trial-{request,response}.schema.json。
この pydantic はその binding で、準拠は tests/test_criteria_contract.py が縛る。
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .version import CONTRACT_VERSION

ElementKey = Literal[
    "takt",
    "positionAccuracy",
    "holdMargin",
    "equipmentCost",
    "maintainability",
    "humanClearance",
    "stoppingDistance",
]
Category = Literal["D", "Q", "C", "S"]
CriterionOp = Literal[">=", "<=", ">", "<", "=="]
ActualBasis = Literal["nominal", "derived", "declared"]


class _ContractModel(BaseModel):
    """wire 形は camelCase、Python では snake_case + alias (grasp 契約と同一方針)。

    閉じた層 (additionalProperties:false) を pydantic 側でも閉じる (extra="forbid")。
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


# --- 入力 (BFF -> コアAPI) ----------------------------------------------------


class MixWire(_ContractModel):
    """エンドユーザの比重 (D 速さ / Q 品質 / C コスト / S 安全)。"""

    # 鍵は大文字 1 字のまま wire に出る (camelCase 化で "d" にしない)。
    model_config = ConfigDict(alias_generator=None, extra="forbid", populate_by_name=True)

    D: float = Field(ge=0.0)
    Q: float = Field(ge=0.0)
    C: float = Field(ge=0.0)
    S: float = Field(ge=0.0)


class ElementAnswerWire(_ContractModel):
    """1 要素の答え = 期待値 (op + value) と、期待を超えた分の重み。"""

    key: ElementKey
    op: CriterionOp
    value: float
    weight: float = Field(ge=0.0)


class EndUserLineWire(_ContractModel):
    ref: str = Field(min_length=1)
    mix: MixWire
    elements: list[ElementAnswerWire] = Field(min_length=7, max_length=7)


class LineWire(_ContractModel):
    end_users: list[EndUserLineWire] = Field(min_length=1)


class CriteriaTrialRequest(_ContractModel):
    contract_version: int = Field(default=CONTRACT_VERSION)
    line: LineWire
    proposed_line: Optional[LineWire] = None


# --- 出力 (コアAPI -> BFF) ----------------------------------------------------


class ActualWire(_ContractModel):
    key: ElementKey
    value: float
    basis: ActualBasis
    # [low, high]。省略 = その basis で正確な値。
    range: Optional[tuple[float, float]] = None


class CandidateWire(_ContractModel):
    id: str = Field(min_length=1)
    label: str
    actuals: list[ActualWire] = Field(min_length=7, max_length=7)


class InterestWire(_ContractModel):
    actor: str = Field(min_length=1)
    category: Category
    value: float = Field(ge=0.0, le=1.0)


class OfferingWire(_ContractModel):
    actor: str = Field(min_length=1)
    key: ElementKey
    from_: float = Field(alias="from")
    to: float


class ProposalNotAsked(_ContractModel):
    kind: Literal["notAsked"] = "notAsked"


class ProposalEvaluated(_ContractModel):
    kind: Literal["evaluated"] = "evaluated"
    baseline: str
    proposed: str
    offerings: list[OfferingWire] = Field(default_factory=list)


class ProposalUnsatisfiable(_ContractModel):
    kind: Literal["unsatisfiable"] = "unsatisfiable"


class ProposalNoBaseline(_ContractModel):
    kind: Literal["noBaseline"] = "noBaseline"


ProposalAssessmentWire = Annotated[
    Union[ProposalNotAsked, ProposalEvaluated, ProposalUnsatisfiable, ProposalNoBaseline],
    Field(discriminator="kind"),
]


class CriteriaTrialResponse(_ContractModel):
    contract_version: int = Field(default=CONTRACT_VERSION)
    candidates: list[CandidateWire] = Field(default_factory=list)
    interest: list[InterestWire] = Field(default_factory=list)
    proposal: ProposalAssessmentWire = Field(default_factory=ProposalNotAsked)
