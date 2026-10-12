"""判定基準レーンの pydantic binding が中立スキーマに準拠するか (ADR-165 D6 / ADR-082)。

- 実インスタンス (lane が実際に出した応答) を wire 形にして JSON Schema で検証する。
- 要素の集合は契約の enum が正本: core/ の catalog はその写しで、集合が一致することを数える
  (フロントの CriteriaCatalog も src/CriteriaIndicatorCensus.test.js が同じ enum に縛る)。
- 提案の評価は閉じた kind 判別 union — 4 枝とも実際に通し、未知の kind と閉層への
  余計な欄 (総合点・顔) は拒否されることを焼く (使われない枝が壊れても緑、を防ぐ)。
"""

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from contract_pkg import load_schema
from criteria_fixtures import A, B, C, SATO, TANAKA, Cells, end_user, request

from easy_extrude_core.contract import CONTRACT_VERSION, CriteriaTrialRequest
from easy_extrude_core.criteria import trial
from easy_extrude_core.criteria.catalog import CATEGORIES, ELEMENTS

REQ = Draft202012Validator(load_schema("criteria-trial-request"))
RES = Draft202012Validator(load_schema("criteria-trial-response"))


def _wire(body, *cells):
    req = CriteriaTrialRequest.model_validate(body)
    REQ.validate(req.model_dump(by_alias=True, exclude_none=True))
    res = trial(req, source=Cells(*cells) if cells else None)
    return res.model_dump(mode="json", by_alias=True, exclude_none=True)


def test_core_catalog_is_exactly_the_contract_element_set():
    enum = load_schema("criteria-trial-request")["$defs"]["elementKey"]["enum"]
    assert sorted(ELEMENTS) == sorted(enum)
    assert load_schema("criteria-trial-response")["$defs"]["elementKey"]["enum"] == enum
    assert list(CATEGORIES) == load_schema("criteria-trial-response")["$defs"]["category"]["enum"]


def test_the_naive_response_conforms_and_pins_the_version():
    wire = _wire(request(TANAKA, SATO))
    RES.validate(wire)
    assert wire["contractVersion"] == CONTRACT_VERSION
    assert {a["basis"] for c in wire["candidates"] for a in c["actuals"]} == {"nominal"}


@pytest.mark.parametrize(
    "proposed, kind",
    [
        (None, "notAsked"),
        ([end_user("tanaka", TANAKA["mix"], takt=11), SATO], "evaluated"),
        ([end_user("tanaka", TANAKA["mix"], takt=8.5), SATO], "unsatisfiable"),
    ],
)
def test_every_branch_of_the_proposal_union_conforms(proposed, kind):
    wire = _wire(request(TANAKA, SATO, proposed=proposed), A, B, C)
    RES.validate(wire)
    assert wire["proposal"]["kind"] == kind


def test_no_baseline_branch_conforms():
    impossible = end_user("tanaka", TANAKA["mix"], takt=7.5)
    wire = _wire(request(impossible, SATO, proposed=[TANAKA, SATO]), A, B, C)
    RES.validate(wire)
    assert wire["proposal"]["kind"] == "noBaseline"


def test_evaluated_offerings_carry_from_and_to_on_the_wire():
    tight = end_user("tanaka", TANAKA["mix"], takt=8.5)
    loose = end_user("sato", SATO["mix"], clearance=200, clearance_weight=0.1)
    wire = _wire(request(TANAKA, SATO, proposed=[tight, loose]), A, B, C)
    RES.validate(wire)
    assert {"actor": "sato", "key": "humanClearance", "from": 400, "to": 200} in wire["proposal"]["offerings"]


@pytest.mark.parametrize(
    "smuggle",
    [
        lambda w: w.update(totalScore=0.7),                                    # 総合点は載せない
        lambda w: w["candidates"][0].update(face="smile"),                     # 顔はクライアントの導出
        lambda w: w["candidates"][0].update(best=True),                        # 選ぶのは人
        lambda w: w["interest"][0].update(formula="sum"),                      # 式は載せない
        lambda w: w.update(proposal={"kind": "maybe"}),                        # 閉じた union
        lambda w: w["candidates"][0]["actuals"][0].update(basis="guessed"),    # 出どころは 3 種
    ],
)
def test_the_closed_layers_reject_what_does_not_belong_on_the_wire(smuggle):
    wire = _wire(request(TANAKA, SATO))
    smuggle(wire)
    with pytest.raises(ValidationError):
        RES.validate(wire)
