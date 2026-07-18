"""エラーの約束 (ADR-076 §3 / ADR-074 の「エラーの約束」= 契約の 4 つ目)。

BFF はコアの中身を知らずに「入力の形 / 出力の形 / contractVersion / エラーの約束」の 4 つ
だけを頼りにフォールバックを組む (ADR-074)。その 4 つ目をここで具体化する:

- 一貫した envelope `{"error": {"code", "message", ...}}` で返す。
- contractVersion 不一致時は expected / received を載せ、片側だけ古いデプロイを即特定できる
  ようにする (ADR-074 の狙い)。

ここはエラー *表現* (整形) のみ。判定ロジックは持たない (境界は薄く)。
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


# --- エラーコード (BFF が分岐に使う安定な識別子) -------------------------------
class ErrorCode:
    CONTRACT_VERSION_MISMATCH = "contract_version_mismatch"  # 400
    VALIDATION_ERROR = "validation_error"  # 422 (形が契約スキーマに合わない)
    UNAUTHORIZED = "unauthorized"  # 401 (BFF 以外からの直叩き)
    PAYLOAD_TOO_LARGE = "payload_too_large"  # 413
    REQUEST_TIMEOUT = "request_timeout"  # 504
    INTERNAL_ERROR = "internal_error"  # 500


class ErrorDetail(BaseModel):
    """エラー本体。contractVersion 不一致のときだけ expected/received を載せる。"""

    code: str
    message: str
    # contractVersion 不一致のときのみ (それ以外は省略 = null)。
    expected: Optional[int] = None
    received: Optional[int] = None


class ErrorResponse(BaseModel):
    """エラー応答の envelope。全エラーでこの形に統一する。"""

    error: ErrorDetail

    def to_payload(self) -> dict:
        # 省略可能フィールド (expected/received) は None を落として返す。
        return self.model_dump(exclude_none=True)


# --- エンドポイント層が上げる例外 (副作用境界での失敗) -------------------------
#
# contractVersion 不一致は contract.ContractVersionMismatch を再利用する (engine の純粋ガード
# が上げ、ここで 400 に写す = ADR-076 §2)。下記はエンドポイント層固有の失敗。


class InternalAuthError(Exception):
    """BFF だけが通れる内部トークンが無い/不一致。401 に写す (ADR-076 §4)。"""


class RequestTimeoutError(Exception):
    """探索が実行時間ガードを超過した。504 に写す (ADR-076 Open: 実行時間ガード)。"""


def error_payload(
    code: str,
    message: str,
    *,
    expected: Optional[int] = None,
    received: Optional[int] = None,
) -> dict:
    """envelope を組んで dict (wire 形) を返すヘルパ。"""
    return ErrorResponse(
        error=ErrorDetail(
            code=code, message=message, expected=expected, received=received
        )
    ).to_payload()
