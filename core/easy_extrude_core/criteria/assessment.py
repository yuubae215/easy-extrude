"""判定基準の線の評価 — 純粋計算 (ADR-165 D6)。副作用なし (原則 #3 / ADR-075)。

ここが PR4 のコスト関数で、**アイデア** (CLAUDE.md §AI 向けガード 軸 1) — だから
core/ にだけ在る。フロントは返った値を描くだけで、重みから何も計算しない
(src/CriteriaIndicatorCensus.test.js がフロント側の 0 個を数える)。

## 1 つの採点表から 3 つが出る (ADR-165 §PR4 の俯瞰 2 — 当事者合意 2026-10-12)

**満たされ具合** (式の部品) — 人 u・要素 e・案 x について、

    余裕_ue(x) = 期待値の向きに測った「実態 − 期待値」  (≥ 0 なら満たす)
    超過_ue(x) = clip(余裕_ue(x) / scale_e, −1, 1)

    J(x) = Σ_u Σ_c 比重_uc / Σ比重_u  ×  平均_{e∈c} ( 重み_ue × 超過_ue(x) )

期待値は**しきい値** (満たさない案はその線のもとで候補から外れる = 可行)、重みは
**超えた分の嬉しさ**の傾き。最良の案 x* = 可行な案のうち J が最大のもの。

**関心** (線の感度 = シャドウプライスの有限差分) — 人 u の大項目 c の線を probe だけ
緩めて解き直し、J がどれだけ良くなるか:

    生_uc = J'(x*') − J'(x*)

J' は緩めた線で測った J (緩めた期待値に対する超過)、x*' は緩めた線での最良。両方の案を
**同じ緩めた線で**比べるので、緩めたことで全案の超過が一律に増える分は打ち消し合い、
残るのは「緩めたことで新しく選べるようになった案が、どれだけ良いか」だけになる。
x* は緩めた線でも可行なので 生 ≥ 0、x*' = x* なら厳密に 0。
    関心_uc = 生_uc / max 生   (0..1。全部 0 なら全部 0)

現在の線で可行な案が 1 つも無いとき J(x*) は無い。そのときは「緩めれば可行になる」
線を 1 (決め手)、ならない線を 0 とする。

**差し出すもの** — 提案後の線で解き直した案 x*' と x* を比べ、各人の (現在の) 期待値の
向きで余裕が減った要素を列挙する。空 = マージン内。

## naive の限界 (ADR-165 §PR4 に明記)

案は飛び飛び (名目セル表) なので、関心も飛び飛びになる: probe の幅では次の案に
届かない線は 0 と出て、幅を越えた途端に大きくなる。本物の最適化器に差し替えても
この関数群の契約 (入出力の意味) は変わらない。
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Optional

from .catalog import CATEGORIES, ELEMENTS, elements_of
from .cells import Cell


class LineError(ValueError):
    """線そのものが評価できない形 (要素の欠け・重複・全部 0 の比重)。エンドポイントで 400。"""


@dataclass(frozen=True)
class Answer:
    op: str
    value: float
    weight: float


@dataclass(frozen=True)
class EndUserLine:
    ref: str
    mix: Mapping[str, float]
    answers: Mapping[str, Answer]


Line = tuple[EndUserLine, ...]
# (人, 要素) ごとの緩め幅。無い組は 0。
Slack = Mapping[tuple[str, str], float]


@dataclass(frozen=True)
class Offering:
    actor: str
    key: str
    from_value: float
    to_value: float


@dataclass(frozen=True)
class ProposalOutcome:
    kind: str  # "evaluated" | "unsatisfiable" | "noBaseline"
    baseline: Optional[str] = None
    proposed: Optional[str] = None
    offerings: tuple[Offering, ...] = field(default_factory=tuple)


def check_line(line: Line) -> None:
    """評価の前提を検査する。欠けを推測で埋めない (原則 #31)。"""
    refs = [u.ref for u in line]
    if len(set(refs)) != len(refs):
        raise LineError(f"an end user appears twice in the line: {sorted(r for r in refs if refs.count(r) > 1)[0]}")
    for u in line:
        missing = sorted(set(ELEMENTS) - set(u.answers))
        if missing:
            raise LineError(f"end user {u.ref!r} has no answer for {', '.join(missing)}")
        if all(u.mix.get(c, 0) == 0 for c in CATEGORIES):
            raise LineError(f"end user {u.ref!r} has a ratio of all zeros")


def margin(actual: float, answer: Answer, key: str) -> float:
    """期待値の向きに測った余裕 (≥ 0 で満たす。`==` は許容差の残り)。"""
    if answer.op in ("<=", "<"):
        return answer.value - actual
    if answer.op in (">=", ">"):
        return actual - answer.value
    if answer.op == "==":
        return ELEMENTS[key].eq_tolerance - abs(actual - answer.value)
    raise LineError(f"unknown comparison {answer.op!r}")


def meets(actual: float, answer: Answer, key: str, slack: float = 0.0) -> bool:
    m = margin(actual, answer, key) + slack
    return m > 0 if answer.op in ("<", ">") else m >= 0


def feasible(cell: Cell, line: Line, slack: Slack) -> bool:
    return all(
        meets(cell.actuals[k].value, a, k, slack.get((u.ref, k), 0.0))
        for u in line
        for k, a in u.answers.items()
    )


def satisfaction(cell: Cell, line: Line, slack: Slack | None = None) -> float:
    """J(x) — 全員の比重で束ねた、重みつきの超過 (正規化済み) の和。slack は期待値を緩めた分。"""
    slack = slack or {}
    total = 0.0
    for u in line:
        mix_sum = sum(u.mix.get(c, 0.0) for c in CATEGORIES)
        for c in CATEGORIES:
            share = u.mix.get(c, 0.0) / mix_sum
            if share == 0:
                continue
            els = elements_of(c)
            per = [
                u.answers[e.key].weight
                * max(-1.0, min(1.0, (margin(cell.actuals[e.key].value, u.answers[e.key], e.key)
                                      + slack.get((u.ref, e.key), 0.0)) / e.scale))
                for e in els
            ]
            total += share * (sum(per) / len(per))
    return total


def best(cells: Sequence[Cell], line: Line, slack: Slack | None = None) -> Optional[Cell]:
    """可行な案のうち J が最大の案。同点は表の順 (安定)。無ければ None。"""
    slack = slack or {}
    chosen: Optional[Cell] = None
    chosen_j = -math.inf
    for cell in cells:
        if not feasible(cell, line, slack):
            continue
        j = satisfaction(cell, line, slack)
        if j > chosen_j:
            chosen, chosen_j = cell, j
    return chosen


def interest(cells: Sequence[Cell], line: Line) -> dict[tuple[str, str], float]:
    """(人, 大項目) → 関心 0..1。全員 × 4 大項目ちょうど (欠けを作らない)。"""
    base = best(cells, line)
    raw: dict[tuple[str, str], float] = {}
    for u in line:
        for c in CATEGORIES:
            slack = {(u.ref, e.key): e.probe for e in elements_of(c)}
            relaxed = best(cells, line, slack)
            if base is None:
                raw[(u.ref, c)] = math.inf if relaxed is not None else 0.0
            else:
                # 同じ緩めた線で 2 つの案を比べる。base も緩めた線で可行なので負にならない。
                raw[(u.ref, c)] = max(0.0, satisfaction(relaxed, line, slack) - satisfaction(base, line, slack))
    if any(math.isinf(v) for v in raw.values()):
        return {k: (1.0 if math.isinf(v) else 0.0) for k, v in raw.items()}
    top = max(raw.values(), default=0.0)
    return {k: (v / top if top > 0 else 0.0) for k, v in raw.items()}


def assess_proposal(cells: Sequence[Cell], line: Line, proposed: Line) -> ProposalOutcome:
    """提案後の線で解き直し、各人の現在の期待値の向きで余裕が減った要素を返す。"""
    if sorted(u.ref for u in line) != sorted(u.ref for u in proposed):
        raise LineError("the proposed line must name the same end users as the current line")
    b = best(cells, line)
    if b is None:
        return ProposalOutcome(kind="noBaseline")
    p = best(cells, proposed)
    if p is None:
        return ProposalOutcome(kind="unsatisfiable")
    offerings = []
    for u in line:
        for key, a in u.answers.items():
            before = b.actuals[key].value
            after = p.actuals[key].value
            if margin(after, a, key) < margin(before, a, key):
                offerings.append(Offering(actor=u.ref, key=key, from_value=before, to_value=after))
    return ProposalOutcome(kind="evaluated", baseline=b.id, proposed=p.id, offerings=tuple(offerings))
