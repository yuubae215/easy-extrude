"""推薦/類似レーンの BFF <-> コアAPI I/O 契約の型 (ADR-077 / ADR-074 踏襲)。

入力 = 要件文 + 参照候補 (+ public 由来の決定論的出力を不透明に携える) + contractVersion。
出力 = 等価性 *候補* のランキング (similarity / structural_distance / confidence /
evidence) + contractVersion。

不変条件 (壁の番人, ADR-077 §5):
出力 wire に **真偽値 (等価か否か) フィールドを置かない**。lane は propose のみで decide
しない。これは domain 型 (recommendation.types) の規律を wire 境界まで貫くもの。

opaque 消費 (decide=public の死守):
- public の canonical signature は **不透明な文字列**として受け取り、中身を解釈しない。
- public の structural diff の `distance` (絶対基準 0-1) だけは public が decide した値として
  数値消費するが、lane は再計算しない。`detail` は人間可読メモで解釈しない。
- public ADR-056 の canonical form の wire 形をここで再定義しない (grasp の pose が
  境界で不透明 dict なのと同じ作法)。ADR-056 確定で形が変わったら contractVersion を上げる。

注意:
- この契約型は コア側の正本。最終的には中立な共有パッケージへ寄せ、BFF (TS) は
  そのミラーを参照する (ADR-074 §6 / grasp 契約と同じ運用)。
- 判定の実装 (embeddings / 類似計算) は入れない。ここは I/O の形 *だけ*。
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .version import CONTRACT_VERSION


class _ContractModel(BaseModel):
    """契約モデル共通設定。wire 形は camelCase、Python では snake_case + alias。

    grasp 契約 (models.py) の _ContractModel と同一方針。serialize は by_alias=True で
    wire 形 (camelCase) を出す。
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


# --- 入力 (BFF -> コアAPI) ----------------------------------------------------


class StructuralDiffWire(_ContractModel):
    """public structural diff の不透明な消費物 (ADR-056 由来)。

    `distance` は public が出した絶対基準 0-1 の構造距離 (0=同型)。lane は再計算しない。
    未提供 (null) なら lane は「構造的裏付けなし」として保守的に扱う。
    `detail` は人間可読メモ (解釈しない / そのまま evidence に転記しない)。
    """

    distance: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    detail: str = ""


class RequirementQueryWire(_ContractModel):
    """対応づけたい曖昧な要件文。

    `signature` は要件側にも public canonical signature がある場合に渡す (不透明文字列)。
    """

    text: str
    signature: Optional[str] = None


class ReferenceCandidateWire(_ContractModel):
    """対応づけ先の参照候補 1 件。public 由来の決定論的出力を不透明に携える。"""

    ref_id: str
    text: str
    # public canonical signature (不透明文字列。lane は中身を解釈しない)。
    signature: str
    diff: Optional[StructuralDiffWire] = None


class RecommendationRequest(_ContractModel):
    """BFF -> コアAPI の入力 (等価性候補の propose 要求)。"""

    contract_version: int = Field(default=CONTRACT_VERSION)
    # 前提とする Layout DSL のスキーマバージョン (public スキーマを *参照*)。
    layout_version: str
    requirement: RequirementQueryWire
    references: list[ReferenceCandidateWire] = Field(default_factory=list)
    # 上位何件返すか (省略時は全件)。BFF がフォールバック幅を決める。
    top_n: Optional[int] = Field(default=None, ge=1)
    # similarity を組む重み (省略時はサーバ既定)。絶対基準の指標重み。
    similarity_weights: Optional[dict[str, float]] = None


# --- 出力 (コアAPI -> BFF) ----------------------------------------------------


class ProposalEvidenceWire(_ContractModel):
    """提案 1 件の根拠内訳 (すべて絶対基準 0-1)。なぜこの順位かの可視化材料。"""

    semantic: float = Field(ge=0.0, le=1.0)
    lexical: float = Field(ge=0.0, le=1.0)
    structural_distance: float = Field(ge=0.0, le=1.0)
    structural_support: float = Field(ge=0.0, le=1.0)
    notes: str = ""


class EquivalenceProposalWire(_ContractModel):
    """等価性 *候補* 1 件。**真偽値を持たない** (lane は decide しない, ADR-077 §5)。

    ここに `equivalent` のような決定フィールドを足してはならない。足した瞬間に wire 境界で
    lane が decide 側へ踏み込み境界が溶ける。
    """

    rank: int = Field(ge=1)
    ref_id: str
    similarity: float = Field(ge=0.0, le=1.0)
    structural_distance: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: ProposalEvidenceWire


class RecommendationResponse(_ContractModel):
    """コアAPI -> BFF の出力。等価性候補のランキング (真偽値なし)。"""

    contract_version: int = Field(default=CONTRACT_VERSION)
    # rank 昇順 (1 が最有力候補) で並んだ等価性候補。
    proposals: list[EquivalenceProposalWire] = Field(default_factory=list)
