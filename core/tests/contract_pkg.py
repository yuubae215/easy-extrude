"""中立契約パッケージ (@easy-extrude/grasp-contract) の取得を一点に集約する。

中立な正本は JSON Schema。repo 内の `packages/grasp-contract` (ADR-082 で submodule から
吸収した正本) を参照する。テスト (conformance / HTTP 往復) はここ経由でだけ
Schema / contractVersion を読む。

取得経路はこの 1 ファイル (PKG) に集約されており、契約の置き場所が変わっても
ここだけ差し替えれば全テストが追従する (ADR-082 の吸収でもここ 1 箇所の変更で済んだ)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# core/tests/ -> core/ -> repo root。中立契約は repo 内正本 packages/grasp-contract (ADR-082)。
_REPO_ROOT = Path(__file__).resolve().parents[2]
PKG = _REPO_ROOT / "packages" / "grasp-contract"


def load_contract_json(relative: str) -> Any:
    """契約パッケージ内の JSON (schema/ や contract-version.json) を読む。"""
    return json.loads((PKG / relative).read_text(encoding="utf-8"))


def load_response_schema() -> dict:
    """GraspSearchResponse の中立 JSON Schema。"""
    return load_contract_json("schema/grasp-search-response.schema.json")


def load_request_schema() -> dict:
    """GraspSearchRequest の中立 JSON Schema。"""
    return load_contract_json("schema/grasp-search-request.schema.json")


def load_schema(endpoint: str) -> dict:
    """任意のエンドポイントの中立 JSON Schema (`<endpoint>.schema.json`)。"""
    return load_contract_json(f"schema/{endpoint}.schema.json")


# --- v13 (ADR-172) の診断をテストで組む・読むための小道具 -------------------------------

STAGE_NAMES = ("reach", "ik", "grasp", "visibility", "interference")


def all_passed_stages(generated: int) -> "list[dict]":
    """全候補が全段を通った (カメラ・ハンドは問うていない) 段の列 (wire 形)。"""
    return [
        {"stage": "reach", "kind": "judged", "entered": generated, "rejected": 0,
         "nearestMiss": {"kind": "noRejection"}},
        {"stage": "ik", "kind": "judged", "entered": generated, "rejected": 0,
         "nearestMiss": {"kind": "noQuantity"}},
        {"stage": "grasp", "kind": "notAsked", "reason": "gripperUndeclared"},
        {"stage": "visibility", "kind": "notAsked", "reason": "cameraUndeclared"},
        {"stage": "interference", "kind": "judged", "entered": generated, "rejected": 0,
         "nearestMiss": {"kind": "noQuantity"}},
    ]


def stage_of(diagnostics: "dict", name: str) -> "dict":
    """wire の診断から段 1 つ (camelCase の dict)。"""
    return next(v for v in diagnostics["stages"] if v["stage"] == name)


def rejected_at(diagnostics: "dict", name: str) -> int:
    """その段で落ちた数。問うていない段は 0 ではなく例外 (読み違えを黙らせない)。"""
    v = stage_of(diagnostics, name)
    if v["kind"] != "judged":
        raise AssertionError(f"{name} は問うていない ({v['reason']}) — 数を持たない")
    return v["rejected"]
