"""価値木の要素表 — core/ 側の写し (ADR-165 D2)。

要素の**集合**の正本は契約 (`criteria-trial-request.schema.json` の `elementKey` enum)。
ここはその各要素に core/ のアイデアの側の係数を付けるだけで、集合を定義しない —
集合が契約と一致することは tests/test_criteria_contract.py が数える (原則 #31。
フロントの CriteriaCatalog も同じ enum に縛られる)。

係数 (アイデア — CLAUDE.md §AI 向けガード 軸 1。だから core/ に在る):

- `category` — どの大項目の要素か (比重を掛ける先)。
- `scale` — 余裕を 0〜1 へ正規化する目安 (「この量だけ超えれば十分に嬉しい」)。
- `probe` — 関心を測るとき線を試しに緩める幅 (naive な有限差分の刻み)。
- `eq_tolerance` — `==` の期待値をどこまでの差で満たすとみなすか。

数字は素朴な暫定値 (naive)。現場の値に差し替えるときはこの表 1 箇所を直す。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ElementSpec:
    key: str
    category: str
    scale: float
    probe: float
    eq_tolerance: float


ELEMENTS: dict[str, ElementSpec] = {
    e.key: e
    for e in (
        ElementSpec("takt", "D", scale=5.0, probe=1.0, eq_tolerance=0.25),
        ElementSpec("positionAccuracy", "Q", scale=0.1, probe=0.02, eq_tolerance=0.005),
        ElementSpec("holdMargin", "Q", scale=1.0, probe=0.2, eq_tolerance=0.05),
        ElementSpec("equipmentCost", "C", scale=5_000_000.0, probe=1_000_000.0, eq_tolerance=250_000.0),
        ElementSpec("maintainability", "C", scale=60.0, probe=15.0, eq_tolerance=3.0),
        ElementSpec("humanClearance", "S", scale=500.0, probe=100.0, eq_tolerance=25.0),
        ElementSpec("stoppingDistance", "S", scale=200.0, probe=50.0, eq_tolerance=10.0),
    )
}

CATEGORIES: tuple[str, ...] = ("D", "Q", "C", "S")


def elements_of(category: str) -> tuple[ElementSpec, ...]:
    return tuple(e for e in ELEMENTS.values() if e.category == category)
