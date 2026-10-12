"""判定基準の聞き取りレーンの orchestration (ADR-165 D3 / D6)。

    契約 (wire) -> 線 (ドメイン) -> [CellSource で案] -> 評価 (純粋) -> 契約 (wire)

副作用を持ちうるのは注入される `CellSource` だけ (既定は naive な名目セル表 —
将来はシーン由来・見積由来に差し替える)。評価は `assessment` の純粋関数に委ねる。
"""

from __future__ import annotations

from ..contract import (
    ActualWire,
    CandidateWire,
    CriteriaTrialRequest,
    CriteriaTrialResponse,
    InterestWire,
    LineWire,
    OfferingWire,
    ProposalEvaluated,
    ProposalNoBaseline,
    ProposalNotAsked,
    ProposalUnsatisfiable,
)
from .assessment import Answer, EndUserLine, Line, LineError, assess_proposal, check_line, interest
from .catalog import CATEGORIES, ELEMENTS
from .cells import CellSource, NominalCellCatalog


def line_of(wire: LineWire) -> Line:
    """wire の線をドメインの線へ。同じ要素への 2 つの答えは推測せず拒否する。"""
    out = []
    for u in wire.end_users:
        keys = [e.key for e in u.elements]
        dup = sorted({k for k in keys if keys.count(k) > 1})
        if dup:
            raise LineError(f"end user {u.ref!r} answered {dup[0]} twice")
        out.append(
            EndUserLine(
                ref=u.ref,
                mix={"D": u.mix.D, "Q": u.mix.Q, "C": u.mix.C, "S": u.mix.S},
                answers={e.key: Answer(op=e.op, value=e.value, weight=e.weight) for e in u.elements},
            )
        )
    line = tuple(out)
    check_line(line)
    return line


def trial(request: CriteriaTrialRequest, *, source: CellSource | None = None) -> CriteriaTrialResponse:
    cells = tuple((source or NominalCellCatalog()).cells())
    line = line_of(request.line)

    candidates = [
        CandidateWire(
            id=c.id,
            label=c.label,
            actuals=[
                ActualWire(key=k, value=c.actuals[k].value, basis=c.actuals[k].basis, range=c.actuals[k].range)
                for k in ELEMENTS
            ],
        )
        for c in cells
    ]
    values = interest(cells, line)
    rows = [InterestWire(actor=u.ref, category=c, value=values[(u.ref, c)]) for u in line for c in CATEGORIES]

    if request.proposed_line is None:
        proposal = ProposalNotAsked()
    else:
        outcome = assess_proposal(cells, line, line_of(request.proposed_line))
        if outcome.kind == "noBaseline":
            proposal = ProposalNoBaseline()
        elif outcome.kind == "unsatisfiable":
            proposal = ProposalUnsatisfiable()
        else:
            proposal = ProposalEvaluated(
                baseline=outcome.baseline,
                proposed=outcome.proposed,
                offerings=[
                    OfferingWire.model_validate({"actor": o.actor, "key": o.key, "from": o.from_value, "to": o.to_value})
                    for o in outcome.offerings
                ],
            )
    return CriteriaTrialResponse(candidates=candidates, interest=rows, proposal=proposal)
