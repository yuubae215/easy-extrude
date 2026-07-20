"""BFF <-> コアAPI 契約バージョン (ADR-074)。

contractVersion は public スキーマの `version: "layout/x.y"` とは別系統の
内部用整数。両側 (BFF / コアAPI) を自分が同時に直せるので破壊変更は気軽でよいが、
不一致は実行時に弾くことだけ必須 (片側だけ古いデプロイのズレを即特定するため)。

ここは純粋なガード (副作用なし)。HTTP 400 への変換はエンドポイント層の責務で、
この関数自体は例外を上げるだけ。
"""

# 現在の契約バージョン。
# 上げる条件 (ADR-074): 必須フィールドの追加・意味変更 -> 上げる。任意追加 -> 上げない。
# v2: grasp-search response の pose を opaque payload から kind 判別 union
# (endEffector / jointSpace) へ (上流 contract repo で版上げ済み, public ADR-060 決定 C)。
# v3: grasp-search response に diagnostics (棄却ファネル + reach near-miss) を必須で追加
# (上流 contract repo で版上げ済み, ADR-079)。
# v4: ドメイン段階バリデーション (ADR-081)。ScoreBreakdown に visible/graspable、
# diagnostics を 5 段ファネル (rejectedByVisibility/rejectedByGrasp) + ドメイン別
# near-miss (occlusionNearestMiss/openingNearestMiss) へ拡張 (repo 内正本
# packages/grasp-contract で同一 PR 版上げ, ADR-082)。リクエスト側の camera/gripper
# 宣言は open payload (layoutVersion 統治) で版上げ対象外。
CONTRACT_VERSION = 4


class ContractVersionMismatch(ValueError):
    """受信した contractVersion が想定と一致しない。エンドポイント層で 400 に写す。"""

    def __init__(self, received: int, expected: int) -> None:
        self.received = received
        self.expected = expected
        super().__init__(
            f"contractVersion mismatch: received={received}, expected={expected}"
        )


def check_contract_version(received: int, expected: int = CONTRACT_VERSION) -> None:
    """contractVersion を検証する純粋関数。不一致なら ContractVersionMismatch。

    曖昧に処理しない (ADR-074)。想定外バージョンは即拒否する。
    """
    if received != expected:
        raise ContractVersionMismatch(received=received, expected=expected)
