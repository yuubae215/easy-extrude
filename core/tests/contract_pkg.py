"""中立契約パッケージ (@easy-extrude/grasp-contract) の取得を一点に集約する。

中立な正本は JSON Schema。submodule `vendor/grasp-contract` (外部の中立 repo
easy-extrude-contract) を pin して参照する。テスト (conformance / HTTP 往復) は
ここ経由でだけ Schema / contractVersion を読む。

移設 (relocate) は完了済み: 取得経路はこの 1 ファイル (PKG) に集約されており、
契約の置き場所が変わってもここだけ差し替えれば全テストが追従する。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# core/tests/ -> core/ -> repo root。中立契約は submodule (vendor/grasp-contract = 外部の
# 中立 repo easy-extrude-contract) を pin して参照する。
_REPO_ROOT = Path(__file__).resolve().parents[2]
PKG = _REPO_ROOT / "vendor" / "grasp-contract"


def load_contract_json(relative: str) -> Any:
    """契約パッケージ内の JSON (schema/ や contract-version.json) を読む。"""
    return json.loads((PKG / relative).read_text(encoding="utf-8"))


def load_response_schema() -> dict:
    """GraspSearchResponse の中立 JSON Schema。"""
    return load_contract_json("schema/grasp-search-response.schema.json")


def load_request_schema() -> dict:
    """GraspSearchRequest の中立 JSON Schema。"""
    return load_contract_json("schema/grasp-search-request.schema.json")
