"""判定基準レーンの評価 (純粋計算) のテスト — ADR-165 D6。

当事者に説明した例 (田中さん / 佐藤さん、案 A・B・C) をそのまま焼く。説明と実装が
食い違えば、語が指す先が変わったということなので落ちる。
"""

import pytest

from criteria_fixtures import A, B, C, KEYS, SATO, TANAKA, Cells, end_user, request

from easy_extrude_core.contract import CriteriaTrialRequest
from easy_extrude_core.criteria import LineError, NominalCellCatalog, line_of, trial
from easy_extrude_core.criteria.assessment import best, feasible, interest, margin, Answer
from easy_extrude_core.criteria.catalog import CATEGORIES, ELEMENTS


def _trial(body, *cells):
    return trial(CriteriaTrialRequest.model_validate(body), source=Cells(*cells) if cells else None)


def test_the_example_keeps_c_because_a_and_b_each_fail_someone():
    line = line_of(CriteriaTrialRequest.model_validate(request(TANAKA, SATO)).line)
    assert not feasible(A, line, {}), "A は佐藤さんの 300mm を満たさない"
    assert not feasible(B, line, {}), "B は田中さんの 10 秒を満たさない"
    assert best((A, B, C), line).id == "C"


def test_interest_is_high_on_the_line_that_decides_and_zero_on_the_slack_one():
    # 佐藤さんが 300 → 200 に緩めれば A が選べる (= 決め手)。田中さんが 10 → 11 に緩めても C のまま。
    res = _trial(request(TANAKA, SATO), A, B, C)
    by = {(r.actor, r.category): r.value for r in res.interest}
    assert by[("sato", "S")] == 1.0
    assert by[("tanaka", "D")] == 0.0


def test_interest_has_exactly_one_row_per_end_user_and_category():
    res = _trial(request(TANAKA, SATO))
    assert sorted((r.actor, r.category) for r in res.interest) == sorted(
        (u, c) for u in ("tanaka", "sato") for c in CATEGORIES
    )
    assert all(0.0 <= r.value <= 1.0 for r in res.interest)


def test_interest_depends_on_the_weights__a_person_who_prizes_extra_margin_keeps_c():
    # 佐藤さんが余分な距離を大いに喜ぶなら (重み 1)、緩めても全員の採点で C が勝つ → 関心 0。
    sato = end_user("sato", SATO["mix"], clearance=300, clearance_weight=1.0)
    res = _trial(request(TANAKA, sato), A, B, C)
    by = {(r.actor, r.category): r.value for r in res.interest}
    assert by[("sato", "S")] == 0.0


def test_a_probe_too_small_to_reach_the_next_cell_reads_zero__the_naive_limit():
    # 佐藤さんの期待値が 400 なら probe (100mm) で 300 まで — A (200) にも届かない。
    sato = end_user("sato", SATO["mix"], clearance=400, clearance_weight=0.1)
    res = _trial(request(TANAKA, sato), A, B, C)
    by = {(r.actor, r.category): r.value for r in res.interest}
    assert by[("sato", "S")] == 0.0


def test_offerings_name_what_tightening_takt_takes_from_sato():
    # 田中さんが 8.5 秒に締めると A しか満たさず、A は佐藤さんの線で外れる → 提案は満たせない。
    tight = end_user("tanaka", TANAKA["mix"], takt=8.5)
    res = _trial(request(TANAKA, SATO, proposed=[tight, SATO]), A, B, C)
    assert res.proposal.kind == "unsatisfiable"
    # 佐藤さんも 200mm まで緩めた提案なら満たせ、差し出すのは佐藤さんの距離 400 → 200。
    loose = end_user("sato", SATO["mix"], clearance=200, clearance_weight=0.1)
    res = _trial(request(TANAKA, SATO, proposed=[tight, loose]), A, B, C)
    assert res.proposal.kind == "evaluated"
    assert (res.proposal.baseline, res.proposal.proposed) == ("C", "A")
    sato_gives = [(o.key, o.from_, o.to) for o in res.proposal.offerings if o.actor == "sato"]
    assert sato_gives == [("humanClearance", 400, 200)]


def test_a_change_that_keeps_the_same_cell_offers_nothing__inside_the_margin():
    looser = end_user("tanaka", TANAKA["mix"], takt=11)
    res = _trial(request(TANAKA, SATO, proposed=[looser, SATO]), A, B, C)
    assert res.proposal.kind == "evaluated"
    assert res.proposal.offerings == []


def test_no_candidate_meets_the_current_line__no_baseline_and_decisive_lines_read_one():
    impossible = end_user("tanaka", TANAKA["mix"], takt=7.5)
    res = _trial(request(impossible, SATO, proposed=[TANAKA, SATO]), A, B, C)
    assert res.proposal.kind == "noBaseline"
    by = {(r.actor, r.category): r.value for r in res.interest}
    # 田中さんが 7.5 → 8.5 に緩めれば A が満たす…が A は佐藤さんで外れる → 単独では決め手にならない。
    assert by[("tanaka", "D")] == 0.0


def test_without_a_proposed_line_the_proposal_is_declared_not_asked():
    assert _trial(request(TANAKA, SATO)).proposal.kind == "notAsked"


def test_the_same_line_returns_the_same_candidates_and_ids():
    a = _trial(request(TANAKA, SATO)).model_dump(by_alias=True)
    b = _trial(request(TANAKA, SATO)).model_dump(by_alias=True)
    assert a == b
    assert [c["id"] for c in a["candidates"]] == [c.id for c in NominalCellCatalog().cells()]


def test_every_nominal_cell_states_every_element_with_its_basis_and_range():
    for c in NominalCellCatalog().cells():
        assert set(c.actuals) == set(KEYS)
        for a in c.actuals.values():
            assert a.basis == "nominal"
            assert a.range is not None and a.range[0] <= a.value <= a.range[1]


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda u: u.update(mix={"D": 0, "Q": 0, "C": 0, "S": 0}), "all zeros"),
        (lambda u: u["elements"].__setitem__(0, dict(u["elements"][1])), "twice"),
    ],
)
def test_a_line_that_cannot_be_judged_is_refused_not_guessed(mutate, message):
    u = end_user("x", {"D": 1, "Q": 1, "C": 1, "S": 1})
    mutate(u)
    with pytest.raises(LineError, match=message):
        _trial(request(u))


def test_a_proposed_line_naming_other_people_is_refused():
    with pytest.raises(LineError, match="same end users"):
        _trial(request(TANAKA, SATO, proposed=[TANAKA]))


def test_equality_expectation_uses_the_catalog_tolerance():
    tol = ELEMENTS["takt"].eq_tolerance
    assert margin(10 + tol / 2, Answer("==", 10, 1), "takt") > 0
    assert margin(10 + tol * 2, Answer("==", 10, 1), "takt") < 0


def test_interest_never_reads_a_category_absent_from_the_catalog():
    # 大項目の母集団は catalog。どの要素もちょうど 1 つの大項目に属する。
    assert {e.category for e in ELEMENTS.values()} == set(CATEGORIES)
    line = line_of(CriteriaTrialRequest.model_validate(request(TANAKA, SATO)).line)
    assert set(interest((A, B, C), line)) == {(u, c) for u in ("tanaka", "sato") for c in CATEGORIES}
