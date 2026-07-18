"""コアAPI エンドポイント層 (HTTP 境界, ADR-076)。

純粋コア (`engine.search` / `recommendation.recommend` / `scene.pick_sequence`) を BFF が
呼べる外部サービスに変える薄い境界。
- データ整形とパイプライン構築のみ (判定/類似ロジックは持たない)。
- contractVersion 検証 -> 400 / 形違い -> 422 / 認証失敗 -> 401 / 想定外 -> 500。
- naive ソルバ/チェッカ/similarity model の注入配線点 (ADR-076 §5)。

エンドポイント:
- POST /grasp-search   (段階0 判定エンジン, ADR-075)
- POST /recommendation (推薦/類似レーン = propose のみ, ADR-077)
- POST /pick-sequence  (bin-picking シーン層 = 最上面順反復ピック, ADR-078)

公開 API は `create_app` (ASGI アプリ factory) と設定/エラー型。
"""

from __future__ import annotations

from .app import Authenticator, create_app
from .errors import ErrorCode, ErrorDetail, ErrorResponse
from .settings import ApiSettings

__all__ = [
    "create_app",
    "Authenticator",
    "ApiSettings",
    "ErrorCode",
    "ErrorDetail",
    "ErrorResponse",
]
