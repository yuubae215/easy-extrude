"""コアAPI のローカル起動エントリ (`python -m easy_extrude_core.api`)。

開発/内部運用での素朴な起動。本番のホスティング先 (内部 bind か専用ネットワークか) と
内部認証の具体は ADR-076 Open の継続論点。ここではローカル ASGI サーバを上げるだけ。

ADR-076 §4: 既定で内部ネットワーク向けに 127.0.0.1 に bind する。フロントが
直接叩けない構成を既定にし、外部公開は意図的な設定 (env) でのみ可能にする。
"""

from __future__ import annotations

import os

from .app import create_app


def main() -> None:
    try:
        import uvicorn
    except ImportError as exc:  # pragma: no cover - serve は optional 依存
        raise SystemExit(
            "uvicorn is required to serve the app. Install with: pip install 'easy-extrude-core[serve]'"
        ) from exc

    # 既定は loopback (BFF/内部からのみ)。外部 bind は明示的な env でのみ。
    host = os.environ.get("GRASP_API_HOST", "127.0.0.1")
    # 既定を 4001 に合わせる: BFF の upstream 既定 (GRASP_SEARCH_URL) が 4001 なので、
    # コアAPI を素で起動しただけで疎通する。外部 bind は GRASP_API_HOST と同様に env で上書き。
    port = int(os.environ.get("GRASP_API_PORT", "4001"))

    uvicorn.run(create_app(), host=host, port=port)


if __name__ == "__main__":
    main()
