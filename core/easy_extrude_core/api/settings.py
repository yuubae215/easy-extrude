"""コアAPI エンドポイント層の設定 (ADR-076)。

ADR-076 §4: コアAPI は BFF の背後に隠し、外から直接叩けないようにする。そのための
内部トークンや入力上限・タイムアウトは **コードに焼かず環境変数で注入**する。

ここは純粋な値オブジェクト (副作用なし)。env からの読み取りは `from_env` に閉じる。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping, Optional

# env 変数名。中立な接頭辞 (grasp-search service の設定であることだけ示す)。
_ENV_INTERNAL_TOKEN = "GRASP_API_INTERNAL_TOKEN"
_ENV_MAX_BODY_BYTES = "GRASP_API_MAX_BODY_BYTES"
_ENV_REQUEST_TIMEOUT = "GRASP_API_REQUEST_TIMEOUT_SECONDS"

# 既定値。素朴版は全探索なので、巨大入力で詰まらないよう最小形のガードを置く (ADR-076 Open)。
_DEFAULT_MAX_BODY_BYTES = 1_000_000  # 1 MB。表面サンプル x 傾け x ロールの素朴な上限。
_DEFAULT_REQUEST_TIMEOUT = 10.0  # 秒。client 向けレイテンシの上限 (worker は別途)。


@dataclass(frozen=True)
class ApiSettings:
    """エンドポイント層の差し込み設定。

    - internal_token: BFF だけが通れる内部トークン。None なら認証無効 (dev 既定)。
      ADR-076 §4 の「認証は差し込める形にしておく」を満たす最小形 (共有シークレット)。
    - max_body_bytes: リクエスト body の上限 (超過は 413)。
    - request_timeout_seconds: 探索の実行時間ガード (超過は 504)。
    """

    internal_token: Optional[str] = None
    max_body_bytes: int = _DEFAULT_MAX_BODY_BYTES
    request_timeout_seconds: float = _DEFAULT_REQUEST_TIMEOUT

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "ApiSettings":
        """環境変数から設定を組む。未設定は既定に落とす。"""
        env = os.environ if env is None else env

        token = env.get(_ENV_INTERNAL_TOKEN) or None  # 空文字も「未設定」扱い。

        raw_max = env.get(_ENV_MAX_BODY_BYTES)
        max_body_bytes = int(raw_max) if raw_max else _DEFAULT_MAX_BODY_BYTES

        raw_timeout = env.get(_ENV_REQUEST_TIMEOUT)
        request_timeout = (
            float(raw_timeout) if raw_timeout else _DEFAULT_REQUEST_TIMEOUT
        )

        return cls(
            internal_token=token,
            max_body_bytes=max_body_bytes,
            request_timeout_seconds=request_timeout,
        )

    @property
    def auth_enabled(self) -> bool:
        """内部トークン認証が有効か。dev (token 未設定) では False。"""
        return self.internal_token is not None
