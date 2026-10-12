"""案の出どころ — naive な名目セル表 (ADR-165 §PR4 の俯瞰 1)。

案 (候補セルとその実態値) を作るのはアイデア (CLAUDE.md §AI 向けガード 軸 1) なので
core/ に在る。PR4 の既定は**キュレーションしたセルの型と名目値**の小さな表で、
シーンを読まない — 実態値はどれも `basis="nominal"` で、幅 (range) を持つ。

差し替えの継ぎ目は `CellSource` (Protocol)。シーンの幾何から導いた値 (`derived`) と、
人が見積・実測で上書きした値 (`declared`) は後続 PR (DEF-066) — そのとき変わるのは
この配線点だけで、契約も画面も変わらない (IK / 類似度の naive 既定と同じ扱い — ADR-076 §5)。

名目値は代表的な桁を置いた暫定値で、特定の機種の仕様ではない。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class Actual:
    value: float
    basis: str = "nominal"
    range: Optional[tuple[float, float]] = None


@dataclass(frozen=True)
class Cell:
    id: str
    label: str
    actuals: dict[str, Actual]


class CellSource(Protocol):
    """案を差し出す側。順序は安定であること (id で決まる)。"""

    def cells(self) -> Sequence[Cell]: ...


def _nominal(value: float, spread: float) -> Actual:
    """名目値と、その ±spread (相対) の幅。"""
    lo, hi = value * (1 - spread), value * (1 + spread)
    return Actual(value=value, basis="nominal", range=(min(lo, hi), max(lo, hi)))


_TABLE: tuple[Cell, ...] = (
    Cell(
        id="nominal:scara-fast",
        label="High-speed SCARA",
        actuals={
            "takt": _nominal(2.5, 0.15),
            "positionAccuracy": _nominal(0.02, 0.25),
            "holdMargin": _nominal(1.5, 0.15),
            "equipmentCost": _nominal(6_000_000, 0.2),
            "maintainability": _nominal(60, 0.25),
            "humanClearance": _nominal(200, 0.2),
            "stoppingDistance": _nominal(150, 0.2),
        },
    ),
    Cell(
        id="nominal:six-axis-fenced",
        label="6-axis arm behind a fence",
        actuals={
            "takt": _nominal(4.0, 0.15),
            "positionAccuracy": _nominal(0.05, 0.25),
            "holdMargin": _nominal(2.0, 0.15),
            "equipmentCost": _nominal(12_000_000, 0.2),
            "maintainability": _nominal(90, 0.25),
            "humanClearance": _nominal(800, 0.1),
            "stoppingDistance": _nominal(300, 0.2),
        },
    ),
    Cell(
        id="nominal:cobot",
        label="Collaborative arm (shared space)",
        actuals={
            "takt": _nominal(8.0, 0.15),
            "positionAccuracy": _nominal(0.1, 0.25),
            "holdMargin": _nominal(1.8, 0.15),
            "equipmentCost": _nominal(5_000_000, 0.2),
            "maintainability": _nominal(45, 0.25),
            "humanClearance": _nominal(50, 0.2),
            "stoppingDistance": _nominal(50, 0.2),
        },
    ),
    Cell(
        id="nominal:gantry",
        label="Gantry (Cartesian)",
        actuals={
            "takt": _nominal(5.0, 0.15),
            "positionAccuracy": _nominal(0.05, 0.25),
            "holdMargin": _nominal(3.0, 0.15),
            "equipmentCost": _nominal(9_000_000, 0.2),
            "maintainability": _nominal(120, 0.25),
            "humanClearance": _nominal(600, 0.1),
            "stoppingDistance": _nominal(100, 0.2),
        },
    ),
)


class NominalCellCatalog:
    """naive 既定: 名目セル表をそのまま差し出す。"""

    def cells(self) -> Sequence[Cell]:
        return _TABLE
