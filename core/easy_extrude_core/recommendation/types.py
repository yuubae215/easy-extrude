"""推薦/類似レーンのドメイン型 (純粋・副作用なし)。ADR-077。

このレーンの不変条件 (壁の番人):
**core が equivalence を decide / lane は propose のみ** (`never decides equivalence
inside the core`)。よってここには「等価か否か」を表す **真偽値フィールドを置かない**。
出力は等価性 *候補* のランキング (similarity / structural_distance / confidence /
evidence の連続値) だけで、真偽の判定は public の curated canonical form に委ねる。

seam (接合面 = 入力境界) について:
- 入力は public の決定論的出力 (canonical signature / structural diff /
  reconcile correspondence) + 要件文 / 参照候補。
- public ADR-056 はまだ未確定なので、その wire 形を **ここで再定義・配線しない**。
  public 由来の決定論的出力は **不透明値 (opaque)** として受け取り、中身を解釈しない
  (consume only)。ADR-056 確定後に厳密な pydantic 配線を後続で足す (ADR-077 Still deferred)。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CanonicalSignature:
    """public (ADR-056) が産出する決定論的な正準署名の **不透明ラッパ**。

    lane は `value` の中身を解釈・再計算しない (canonical form を decide するのは public)。
    等価性候補を propose するための材料として渡されるだけ。内部表現が確定したら public 側で
    拡張し、lane は引き続き不透明に消費する。
    """

    value: str


@dataclass(frozen=True)
class StructuralDiff:
    """public (ADR-056) の structural diff の **不透明な消費物**。

    `distance` は public が既に **絶対基準 0-1** で出した構造距離 (0=同型, 1=最も遠い)。
    lane はこれを再計算しない (構造距離を decide するのは public)。public が距離を出して
    いない場合は None で、lane は「構造的裏付けなし」として扱う (確信度を保守的に下げる)。
    `detail` は人間可読な差分メモ (evidence にそのまま転記する。解釈はしない)。
    """

    distance: float | None = None
    detail: str = ""


@dataclass(frozen=True)
class RequirementQuery:
    """曖昧な要件文 (対応づけたい側)。

    `signature` は要件側にも canonical signature がある場合に渡す (public 由来, 不透明)。
    無い場合 (生の自然言語要件) は None。
    """

    text: str
    signature: CanonicalSignature | None = None


@dataclass(frozen=True)
class ReferenceCandidate:
    """対応づけ先の参照候補 1 件 (仕様カタログ等のエントリ)。

    public 由来の決定論的出力 (signature / diff) を **不透明に** 携える。lane はこれらを
    材料に similarity を propose するだけで、canonical form / 構造距離を再定義しない。
    """

    ref_id: str
    text: str
    signature: CanonicalSignature
    diff: StructuralDiff | None = None


@dataclass(frozen=True)
class ProposalEvidence:
    """提案 1 件の根拠 (なぜこの順位か)。すべて絶対基準 0-1 の正規化済み内訳。

    similarity / confidence がどの内訳から組み上がったかを透明化する (検査可能性)。
    真偽の判定は含めない (evidence は decide しない)。
    """

    semantic: float  # 意味的類似 (正規化済み 0-1)
    lexical: float  # 字面の重なり (正規化済み 0-1)
    structural_distance: float  # 構造距離 (正規化済み 0-1, 0=近い)
    structural_support: float  # public 構造証拠の有無 (1=あり, 0=なし)
    notes: str = ""


@dataclass(frozen=True)
class EquivalenceProposal:
    """等価性 *候補* 1 件。**真偽値を持たない** (lane は decide しない)。

    - `similarity` (0-1): 近いほど等価候補として強い。
    - `structural_distance` (0-1): public 構造距離の消費値 (0=構造的に近い)。
    - `confidence` (0-1): この提案そのものへの確信度 (証拠の整合 + 構造裏付け)。
    - `evidence`: 上記の内訳。
    - `rank`: ランキング順位 (1 始まり)。

    ここに `equivalent: bool` のような決定フィールドを足してはならない。足した瞬間に
    lane が decide 側へ踏み込み境界が溶ける (ADR-077 §5 不変条件)。
    """

    ref_id: str
    similarity: float
    structural_distance: float
    confidence: float
    evidence: ProposalEvidence
    rank: int = 0


@dataclass(frozen=True)
class RawSimilarity:
    """(注入された) similarity model が返す **正規化前の生信号**。

    objectives の raw 計算と同じ思想: 生値は model 固有の絶対レンジで出し、0-1 化は純粋な
    normalization 層 (NormSpec) に委ねる。テンプレ/モデル間の比較可能性を保つため。

    - `semantic`: 意味的類似の生値。embedding cosine 等を想定し [-1, 1] を許容する
      (NormSpec が負を 0 にクランプする)。
    - `lexical`: 字面の重なりの生値 (素朴版は token Jaccard で [0, 1])。
    """

    semantic: float
    lexical: float
