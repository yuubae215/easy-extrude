"""ドメイン段階フィルタの段を 1 つの語彙で数える (純粋, ADR-172)。

段は 5 つ (リーチ・IK・把持性・可視性・干渉) で、探索はこの順に短絡する — ある段に
「入った」候補は、それより前の段をすべて通った候補である。応答はこの事実を段ごとに
1 つの型で言う:

- ``judged {entered, rejected, nearestMiss}`` — その段を問うた。
- ``notAsked {reason}`` — その段を問うていない (カメラ / ハンドの宣言が無い)。数を持たない。

v12 までは問うていない段が ``0`` と空虚な ``true`` で言われ、判定した 0 と区別できなかった
(ADR-172 力学 2)。

**出どころ** (宣言した把持仕様 1 つ、または導出) ごとに同じ集計を持ち、行の和が全体になる
(ADR-172 D4 — DEF-048)。全体は出どころの行を足して作る (第二の源にしない)。

フォールバック階梯のリスク (どの数ならどの手戻りの段か) もここで決める — キュレーション
された判断知はアイデアなので core/ に置く (ADR-146 軸 1、ADR-172 D8)。規則の中身は v12 の
フロントの表 (``src/view/GraspLadderMath.js``) をそのまま移し、分母だけ「入った数」にした
(ADR-081 追記 2026-11-11 と同じ読み)。

ここは純粋 (原則 #3) — パイプラインが候補ごとに ``SourceTally`` を更新し、最後に
``stage_verdicts`` / ``fallback_risks`` で読む。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Optional, Union


class Stage(str, Enum):
    """段の語彙 (ワイヤの ``stage`` 列挙と同じ値)。"""

    REACH = "reach"
    IK = "ik"
    GRASP = "grasp"
    VISIBILITY = "visibility"
    INTERFERENCE = "interference"


#: 探索が段を問う順 (短絡の順)。「入った数」はこの順で導く。並びの根拠はパイプラインの
#: モジュール docstring (ADR-081 の安い順)。並べ替えるときはここ 1 か所 (DEF-038)。
JUDGING_ORDER: "tuple[Stage, ...]" = (
    Stage.REACH,
    Stage.IK,
    Stage.GRASP,
    Stage.VISIBILITY,
    Stage.INTERFERENCE,
)


class MissQuantity(str, Enum):
    """最も惜しい差の量 (閉じた列挙)。段ごとに量が違う — 同じ長さでも意味が違う。"""

    REACH_DISTANCE = "reachDistance"
    OCCLUSION_DEPTH = "occlusionDepth"
    OPENING_SHORTFALL = "openingShortfall"
    SEAL_PATCH_SHORTFALL = "sealPatchShortfall"


class UnmeasurableReason(str, Enum):
    """棄却はあったが、差を量で測れなかった理由 (閉じた列挙)。"""

    OUTSIDE_FIELD_OF_VIEW = "outsideFieldOfView"
    PALM_BELOW_SURFACE = "palmBelowSurface"
    NO_CONTACT_PAIR = "noContactPair"


class NotAskedReason(str, Enum):
    """段を問うていない理由 (閉じた列挙)。"""

    CAMERA_UNDECLARED = "cameraUndeclared"
    GRIPPER_UNDECLARED = "gripperUndeclared"


#: 差の量を持たない段 (IK は解けたか否か、干渉は当たったか否か)。
STAGES_WITHOUT_QUANTITY: "frozenset[Stage]" = frozenset({Stage.IK, Stage.INTERFERENCE})


# --- 累積 (可変 — 探索 1 回の中でだけ生きる) --------------------------------------


@dataclass
class _StageCount:
    rejected: int = 0
    nearest: "Optional[tuple[MissQuantity, float]]" = None
    unmeasurable: "set[UnmeasurableReason]" = field(default_factory=set)


@dataclass
class SourceTally:
    """出どころ 1 つ (仕様 1 つ、または導出) の段ごとの集計。"""

    generated: int = 0
    feasible: int = 0
    counts: "dict[Stage, _StageCount]" = field(
        default_factory=lambda: {s: _StageCount() for s in JUDGING_ORDER}
    )

    def reject(
        self,
        stage: Stage,
        miss: "Optional[tuple[MissQuantity, float]]" = None,
        unmeasurable: "Optional[UnmeasurableReason]" = None,
    ) -> None:
        """その段で 1 件落とした。測れた差は最小を残し、測れなかった理由は集める。"""
        c = self.counts[stage]
        c.rejected += 1
        if miss is not None:
            if c.nearest is None or miss[1] < c.nearest[1]:
                c.nearest = miss
        elif unmeasurable is not None:
            c.unmeasurable.add(unmeasurable)


def merged(tallies: "Iterable[SourceTally]") -> SourceTally:
    """出どころの集計を足して全体を作る (純粋)。全体は行の和 — 第二の源にしない。"""
    out = SourceTally()
    for t in tallies:
        out.generated += t.generated
        out.feasible += t.feasible
        for s in JUDGING_ORDER:
            src, dst = t.counts[s], out.counts[s]
            dst.rejected += src.rejected
            if src.nearest is not None and (dst.nearest is None or src.nearest[1] < dst.nearest[1]):
                dst.nearest = src.nearest
            dst.unmeasurable |= src.unmeasurable
    return out


# --- 読み出し (純粋) ------------------------------------------------------------------


@dataclass(frozen=True)
class MissMeasured:
    quantity: MissQuantity
    value: float


@dataclass(frozen=True)
class MissUnmeasurable:
    reasons: "tuple[UnmeasurableReason, ...]"


@dataclass(frozen=True)
class MissNoRejection:
    pass


@dataclass(frozen=True)
class MissNoQuantity:
    pass


NearestMiss = Union[MissMeasured, MissUnmeasurable, MissNoRejection, MissNoQuantity]


@dataclass(frozen=True)
class StageJudged:
    stage: Stage
    entered: int
    rejected: int
    nearest_miss: NearestMiss


@dataclass(frozen=True)
class StageNotAsked:
    stage: Stage
    reason: NotAskedReason


StageVerdict = Union[StageJudged, StageNotAsked]


def _nearest_miss(stage: Stage, c: _StageCount) -> NearestMiss:
    if stage in STAGES_WITHOUT_QUANTITY:
        return MissNoQuantity()
    if c.rejected == 0:
        return MissNoRejection()
    if c.nearest is not None:
        return MissMeasured(quantity=c.nearest[0], value=c.nearest[1])
    return MissUnmeasurable(reasons=tuple(sorted(c.unmeasurable, key=lambda r: r.value)))


def stage_verdicts(
    tally: SourceTally, not_asked: "dict[Stage, NotAskedReason]"
) -> "tuple[StageVerdict, ...]":
    """段ごとの判定を、問うた順に 5 つ (純粋)。

    ``entered`` は短絡の順に導く: 生成した数から、前の段で落ちた数を引いたもの。問うていない段は
    誰も落とさないので、後ろの段の ``entered`` にはそのまま流れる。
    """
    entered = tally.generated
    out: "list[StageVerdict]" = []
    for stage in JUDGING_ORDER:
        c = tally.counts[stage]
        reason = not_asked.get(stage)
        if reason is not None:
            if c.rejected:
                raise ValueError(f"{stage.value} は問うていないのに {c.rejected} 件落としている (ADR-172 D2)")
            out.append(StageNotAsked(stage=stage, reason=reason))
            continue
        out.append(StageJudged(stage=stage, entered=entered, rejected=c.rejected,
                               nearest_miss=_nearest_miss(stage, c)))
        entered -= c.rejected
    if entered != tally.feasible:
        raise ValueError(f"段を通った数 {entered} が通過数 {tally.feasible} と合わない (ファネル恒等式)")
    return tuple(out)


# --- フォールバック階梯のリスク (アイデア — core/ が決める, ADR-172 D8) -------------------


class RiskDomain(str, Enum):
    VISION = "vision"
    PATH = "path"
    GRASP = "grasp"


class RiskReason(str, Enum):
    """リスクの理由 (閉じた列挙)。文言はフロントがこの列挙から引く (表示)。"""

    NONE_SEEN = "noneSeen"
    SOME_UNSEEN = "someUnseen"
    NONE_REACHABLE = "noneReachable"
    SOME_UNREACHABLE = "someUnreachable"
    NONE_CLOSABLE = "noneClosable"
    SOME_UNCLOSABLE = "someUnclosable"


#: ドメインを作る段。経路のドメインは順序の上で隣り合わない 3 段。
DOMAIN_STAGES: "dict[RiskDomain, tuple[Stage, ...]]" = {
    RiskDomain.VISION: (Stage.VISIBILITY,),
    RiskDomain.PATH: (Stage.REACH, Stage.IK, Stage.INTERFERENCE),
    RiskDomain.GRASP: (Stage.GRASP,),
}

#: (ドメイン, 全滅か) → (段, 理由)。v12 のフロントの表 (RISK_RULES) をそのまま移したもの。
_RISK_TABLE: "dict[tuple[RiskDomain, bool], tuple[int, RiskReason]]" = {
    (RiskDomain.VISION, True): (5, RiskReason.NONE_SEEN),
    (RiskDomain.VISION, False): (3, RiskReason.SOME_UNSEEN),
    (RiskDomain.PATH, True): (5, RiskReason.NONE_REACHABLE),
    (RiskDomain.PATH, False): (4, RiskReason.SOME_UNREACHABLE),
    (RiskDomain.GRASP, True): (5, RiskReason.NONE_CLOSABLE),
    (RiskDomain.GRASP, False): (4, RiskReason.SOME_UNCLOSABLE),
}


@dataclass(frozen=True)
class DomainRisk:
    domain: RiskDomain
    level: int
    reason: RiskReason


@dataclass(frozen=True)
class TogetherRisk:
    """どの姿勢も 2 つ以上のドメインを同時には満たさない — 配置を作り直す (L6)。"""

    domains: "tuple[RiskDomain, ...]"
    level: int = 6


FallbackRisk = Union[DomainRisk, TogetherRisk]


def fallback_risks(verdicts: "Iterable[StageVerdict]", feasible: int) -> "tuple[FallbackRisk, ...]":
    """段の判定から、フォールバック階梯のリスクを深い順に (純粋)。

    ドメインの通過率は、そのドメインの段に**入った**候補のうち通した割合の積
    (前の段で落ちた候補は、その段に問われていない)。問うていない段だけでできたドメインは
    リスクを出さない。誰も入らなかった段は率に寄与しない。
    """
    by_stage = {v.stage: v for v in verdicts}
    risks: "list[FallbackRisk]" = []
    rejecting: "list[RiskDomain]" = []
    for domain, stages in DOMAIN_STAGES.items():
        judged = [by_stage[s] for s in stages if isinstance(by_stage.get(s), StageJudged)]
        if not judged:
            continue
        rejected = sum(v.rejected for v in judged)
        if rejected == 0:
            continue
        rate = 1.0
        for v in judged:
            if v.entered > 0:
                rate *= 1 - v.rejected / v.entered
        level, reason = _RISK_TABLE[(domain, rate == 0)]
        risks.append(DomainRisk(domain=domain, level=level, reason=reason))
        rejecting.append(domain)
    if feasible == 0 and len(rejecting) >= 2:
        risks.append(TogetherRisk(domains=tuple(rejecting)))
    return tuple(sorted(risks, key=lambda r: -r.level))
