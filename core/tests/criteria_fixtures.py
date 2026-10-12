"""判定基準レーンのテスト共通の線と案 (ADR-165 §PR4 の俯瞰 — 当事者への説明で使った例)。

田中さん (速さ寄り) はタクト 10 秒以下、佐藤さん (安全寄り) は人と 300mm 以上離れる。
案は A 高速 (8 秒 / 200mm)・B 協働 (12 秒 / 500mm)・C 柵つき 6 軸 (9 秒 / 400mm)。
ほかの 5 要素は 3 案とも同じ値で、どの期待値もゆるく満たす (例の 2 要素だけが効く)。
佐藤さんの距離の重みは小さい (0.1) — 「300mm が大事で、それ以上離れても嬉しさは小さい」。
重みが大きければ佐藤さん自身が C の余分な 100mm を喜ぶので、線を緩めても C のまま
(関心 0) — 関心は重みに依存する、が test_criteria の別の 1 本で焼かれている。
"""

from __future__ import annotations

from easy_extrude_core.criteria import Actual, Cell

KEYS = (
    "takt",
    "positionAccuracy",
    "holdMargin",
    "equipmentCost",
    "maintainability",
    "humanClearance",
    "stoppingDistance",
)

_SAME = {
    "positionAccuracy": 0.05,
    "holdMargin": 2.0,
    "equipmentCost": 8_000_000,
    "maintainability": 60,
    "stoppingDistance": 100,
}


def cell(cid: str, takt: float, clearance: float) -> Cell:
    actuals = {k: Actual(v) for k, v in _SAME.items()}
    actuals["takt"] = Actual(takt)
    actuals["humanClearance"] = Actual(clearance)
    return Cell(id=cid, label=cid, actuals=actuals)


A = cell("A", 8, 200)
B = cell("B", 12, 500)
C = cell("C", 9, 400)


class Cells:
    def __init__(self, *cells: Cell) -> None:
        self._cells = cells

    def cells(self):
        return self._cells


_LOOSE = {
    "positionAccuracy": ("<=", 1.0),
    "holdMargin": (">=", 1.0),
    "equipmentCost": ("<=", 50_000_000),
    "maintainability": ("<=", 600),
    "stoppingDistance": ("<=", 1000),
}


def end_user(
    ref: str, mix: dict, takt: float = 30, clearance: float = 0, weight: float = 1.0, clearance_weight: float | None = None
) -> dict:
    elements = [{"key": k, "op": op, "value": v, "weight": weight} for k, (op, v) in _LOOSE.items()]
    elements.append({"key": "takt", "op": "<=", "value": takt, "weight": weight})
    elements.append({
        "key": "humanClearance", "op": ">=", "value": clearance,
        "weight": weight if clearance_weight is None else clearance_weight,
    })
    return {"ref": ref, "mix": mix, "elements": elements}


TANAKA = end_user("tanaka", {"D": 60, "Q": 15, "C": 15, "S": 10}, takt=10)
SATO = end_user("sato", {"D": 10, "Q": 15, "C": 15, "S": 60}, clearance=300, clearance_weight=0.1)


def request(*users: dict, proposed: list[dict] | None = None) -> dict:
    body = {"line": {"endUsers": list(users)}}
    if proposed is not None:
        body["proposedLine"] = {"endUsers": proposed}
    return body
