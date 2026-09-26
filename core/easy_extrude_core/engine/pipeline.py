"""段階0 探索の orchestration (副作用境界)。ADR-075 のパイプラインを ADR-081 で
ドメイン段階 (見える/届く/掴める) に増段した層。

    離散候補生成 -> リーチ -> IK -> 把持性(Grasp) -> 可視性(Vision) -> 干渉(Path)
                 -> 加重和スコア -> 上位N件

段の並びの根拠 (ADR-081 Decision 1 「安い順フィルタの原則を保つ。挿入位置は naive
実装のコスト実測で確定」): naive 実測 (2026-07-20, 障害物 12 / サンプル 5 の
テンプレ規模, 短絡なしの最悪ケースを揃えた 1 call あたり) は

    リーチ ~1µs < IK ~5µs < 把持性 ~9µs < 可視性 ~49µs ≈ 干渉 ~50µs

で、ADR-081 の括弧書き (可視性 naive は線分-球で干渉と同コスト帯 / 把持性 naive は
幅比較 + サンプル対探索) を裏付けた。よって安い順 = 上記の並び。同コスト帯の
可視性と干渉は ADR-081 のドメイン順 (Vision が先) でタイブレークする。棄却段は
短絡により排他なので、並びはファネルの各段への**帰属**を決めるだけで恒等式は不変。
可視性/把持性ゲートは宣言 (camera/gripper) が無ければ判定ごとスキップされるため、
未宣言リクエストのコストと挙動は増段前と不変。実ソルバ差し替え時に再測する (ADR-081)。

この層だけが副作用 (注入されたソルバ/チェッカの呼び出し) を持つ。候補生成・
判定・objective 正規化・スコア計算は純粋関数 (engine の他モジュール) に委譲する。

契約との接続 (ADR-074):
- 入力 GraspSearchRequest を受け、出力 GraspSearchResponse (rank 昇順の上位N件) を返す。
- contractVersion 検証ガード (check_contract_version) は **エンドポイント層** の責務。
  ここは検証済み宣言を受け取る計算に徹する (ADR-075 §4)。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

from ..contract import (
    GraspSearchDeclaration,
    GraspSearchRequest,
    GraspSearchResponse,
    PoseCandidate,
    ReachSolution,
    ReachSolutionSolved,
    ReachSolutionUndeclared,
    ScoreBreakdown,
)
from ..contract import SearchDiagnostics as SearchDiagnosticsWire
from ..contract import GraspSpecDiagnostics
from .candidates import generate_candidates, generate_spec_candidates
from .feasibility import (
    CollisionChecker,
    grasp_miss,
    GraspChecker,
    IkSolution,
    IkSolver,
    JointSolution,
    NaiveIkSolver,
    NaiveParallelJawGraspChecker,
    NaiveArmSweepCollisionChecker,
    NaiveSightlineVisibilityChecker,
    NaivePathCollisionChecker,
    NaiveHandCollisionChecker,
    VisibilityChecker,
    interference_free,
    palm_depth_miss,
    reach_miss,
    within_reach,
)
from .objectives import evaluate_objectives
from .pose_codec import pose_to_payload
from .scoring import weighted_sum
from .ur_solver import (
    UniversalRobotsIkSolver,
    ik_solver_from_declaration,
    tool_length_from_declaration,
)
from .types import (
    Camera,
    GripperKind,
    ParallelJawGripper,
    SuctionGripper,
    Gripper,
    GraspSpec,
    GraspStrategy,
    HandPart,
    HandShape,
    Obb,
    StrategyFallback,
    StrategyOrder,
    BoxObstacle,
    DeclarationError,
    quaternion_axes,
    Obstacle,
    Pose,
    Problem,
    Quaternion,
    Robot,
    TargetObject,
    Vec3,
)


# --- 契約宣言 -> ドメイン Problem の adapter -------------------------------------
#
# graspSearch 宣言は契約境界では素通し (open payload)。幾何の実体はここで取り出す。
# Layout DSL の厳密な形は public 正本に属するため、ここでは wire 形 (camelCase) の
# 既知キーを寛容に読む。欠損は素朴な既定値に落とす (素朴版を動かすのが先)。


def _vec3(raw: Any, default: Optional[Vec3] = None) -> Vec3:
    if raw is None:
        if default is None:
            return Vec3(0.0, 0.0, 0.0)
        return default
    return Vec3(float(raw[0]), float(raw[1]), float(raw[2]))


def _tuple_floats(raw: Any, default: tuple[float, ...]) -> tuple[float, ...]:
    if not raw:
        return default
    return tuple(float(x) for x in raw)


def _gripper_from_wire(raw: dict[str, Any]) -> Gripper:
    """ワイヤのハンド宣言をドメイン型へ (ADR-118)。

    kind ごとに読むフィールドが違うので、ここが唯一の分岐点。未宣言 / 未知の kind は
    既定へ倒さず ValueError を上げ、エンドポイント層が 400 に写す — 宣言と判定が
    食い違ったまま 200 を返すより、拒否するほうが安い。
    """
    kind = raw.get("kind")
    if kind == GripperKind.PARALLEL_JAW.value:
        max_opening = float(raw.get("maxOpening", 0.0))
        return ParallelJawGripper(
            max_opening=max_opening,
            finger_clearance=float(raw.get("fingerClearance", 0.0)),
            shape=_jaw_shape_from_wire(raw, max_opening),
        )
    if kind == GripperKind.SUCTION.value:
        cup = float(raw.get("cupDiameter", 0.0))
        shape = _suction_shape_from_wire(raw, cup)
        tolerance = raw.get("sealTiltTolerance")
        if tolerance is not None:
            return SuctionGripper(
                cup_diameter=cup, seal_tilt_tolerance=float(tolerance), shape=shape,
            )
        return SuctionGripper(cup_diameter=cup, shape=shape)
    raise ValueError(
        f"未宣言のハンド種別 {kind!r}: graspSearch.gripper.kind は "
        f"{[k.value for k in GripperKind]} のいずれかであること (ADR-118)"
    )


def _body_part_from_wire(body: dict[str, Any]) -> HandPart:
    """筐体の宣言 -> フランジ座標の箱 (ADR-152 D3)。円筒は外接箱 (保守側)。

    kind は閉じた union。未知の kind は throw — 箱や円筒へ倒すと、宣言した形と
    判定した形が黙ってずれる (原則 #31)。
    """
    kind = body.get("kind")
    if kind == "cylinder":
        r = float(body["radius"])
        length = float(body["length"])
        half = Vec3(r, r, length / 2.0)
    elif kind == "box":
        sx, sy, sz = (float(v) for v in body["size"])
        half = Vec3(sx / 2.0, sy / 2.0, sz / 2.0)
    else:
        raise DeclarationError(
            f"未宣言の筐体種別 {kind!r}: gripper.body.kind は cylinder / box (ADR-152 D3)"
        )
    if min(half.x, half.y, half.z) <= 0.0:
        raise DeclarationError("gripper.body の寸法は正であること (ADR-152 D3)")
    return HandPart(name="body", center=Vec3(0.0, 0.0, half.z), half=half)


def _jaw_shape_from_wire(raw: dict[str, Any], max_opening: float) -> Optional[HandShape]:
    """平行ジョーの形 (筐体 + 開いた爪 2 本)。未宣言は None (線分判定のまま)。

    爪は開口 `maxOpening` の位置 (内面間 = maxOpening) に立つ — 進入中の爪は開いている。
    """
    body_raw, fingers_raw = raw.get("body"), raw.get("fingers")
    if body_raw is None and fingers_raw is None:
        return None
    if body_raw is None or fingers_raw is None:
        raise DeclarationError("gripper.body と gripper.fingers は両方か、どちらも無しで宣言する (ADR-152 D3)")
    body = _body_part_from_wire(body_raw)
    palm_z = 2.0 * body.half.z
    f_len = float(fingers_raw["length"])
    f_thk = float(fingers_raw["thickness"])
    f_wid = float(fingers_raw["width"])
    if min(f_len, f_thk, f_wid) <= 0.0:
        raise DeclarationError("gripper.fingers の寸法は正であること (ADR-152 D3)")
    fx = max_opening / 2.0 + f_thk / 2.0
    fz = palm_z + f_len / 2.0
    fh = Vec3(f_thk / 2.0, f_wid / 2.0, f_len / 2.0)
    return HandShape(
        parts=(
            body,
            HandPart(name="finger", center=Vec3(-fx, 0.0, fz), half=fh),
            HandPart(name="finger", center=Vec3(fx, 0.0, fz), half=fh),
        ),
        palm_z=palm_z,
    )


def _suction_shape_from_wire(raw: dict[str, Any], cup_diameter: float) -> Optional[HandShape]:
    """吸引の形 (筐体 + カップ)。カップは径 = cupDiameter の円筒を外接箱で持つ。"""
    body_raw, cup_h = raw.get("body"), raw.get("cupHeight")
    if body_raw is None and cup_h is None:
        return None
    if body_raw is None or cup_h is None:
        raise DeclarationError("gripper.body と gripper.cupHeight は両方か、どちらも無しで宣言する (ADR-152 D3)")
    body = _body_part_from_wire(body_raw)
    palm_z = 2.0 * body.half.z
    h = float(cup_h)
    r = cup_diameter / 2.0
    if h <= 0.0 or r <= 0.0:
        raise DeclarationError("gripper.cupHeight と cupDiameter は正であること (ADR-152 D3)")
    return HandShape(
        parts=(body, HandPart(name="cup", center=Vec3(0.0, 0.0, palm_z + h / 2.0), half=Vec3(r, r, h / 2.0))),
        palm_z=palm_z,
    )


#: 取付け (toolLength) と形の一致を問う相対許容 (ADR-152 D3)。
_MOUNT_REL_TOL = 1e-6


def check_mount_matches_shape(gripper: Optional[Gripper], tool_length: float) -> None:
    """**形は取付けを導出しない。取付けは形と矛盾してはならない** (ADR-152 D3)。

    ジョー: TCP は爪の範囲内 (palm_z <= toolLength <= palm_z + 爪長)。
    吸引: TCP はカップ面 (toolLength = palm_z + cupHeight)。
    外れていれば ValueError (エンドポイントが 400 に写す)。どちらかを直して解くと、
    どちらが正だったのかが答えから消える。
    """
    shape = getattr(gripper, "shape", None) if gripper is not None else None
    if shape is None:
        return
    tol = _MOUNT_REL_TOL * max(1.0, abs(tool_length))
    tip = max(p.center.z + p.half.z for p in shape.parts)
    if isinstance(gripper, SuctionGripper):
        if abs(tool_length - tip) > tol:
            raise DeclarationError(
                f"robot.toolLength {tool_length} がカップ面 {tip} と一致しない — "
                "吸引の TCP はカップ面 (body.length + cupHeight) に在ること (ADR-152 D3)"
            )
        return
    if tool_length < shape.palm_z - tol or tool_length > tip + tol:
        raise DeclarationError(
            f"robot.toolLength {tool_length} が爪の範囲 [{shape.palm_z}, {tip}] の外 — "
            "平行ジョーの TCP は爪の上に在ること (ADR-152 D3)"
        )


def _samples_from_wire(raw: Any) -> tuple[tuple[Vec3, Vec3], ...]:
    return tuple(
        (_vec3(s.get("point")), _vec3(s.get("normal"))) for s in (raw or [])
    )


def _specs_from_wire(raw: Any) -> tuple[GraspSpec, ...]:
    """`target.graspSpecs` -> ドメインの仕様 (ADR-152 D4)。順序 = 優先順位のまま。"""
    specs: list[GraspSpec] = []
    seen: set[str] = set()
    for item in raw or []:
        spec_id = item.get("id")
        if not spec_id or spec_id in seen:
            raise DeclarationError(
                f"graspSpecs の id は空でなく一意であること ({spec_id!r}) — "
                "候補と診断がどの仕様のものか言えなくなる (ADR-152 D4)"
            )
        seen.add(spec_id)
        closing = item.get("closingAxis")
        tilt = item.get("tiltTolerance")
        specs.append(GraspSpec(
            id=spec_id,
            samples=_samples_from_wire(item.get("samples")),
            closing_axis=_vec3(closing).normalized() if closing is not None else None,
            depth=float(item.get("depth", 0.0) or 0.0),
            tilt_tolerance=float(tilt) if tilt is not None else None,
        ))
    return tuple(specs)


def _strategy_from_wire(raw: Any) -> GraspStrategy:
    """`target.strategy` -> ドメイン。未宣言は priority / none (ADR-119 D3「宣言が勝つ」と同じ既定)。"""
    if not raw:
        return GraspStrategy()
    return GraspStrategy(
        order=StrategyOrder(raw.get("order", StrategyOrder.PRIORITY.value)),
        fallback=StrategyFallback(raw.get("fallback", StrategyFallback.NONE.value)),
    )


def _target_box_from_wire(raw: Any) -> Optional[Obb]:
    if not raw:
        return None
    orientation = raw.get("orientation")
    return Obb(
        center=_vec3(raw.get("center")),
        axes=quaternion_axes(Quaternion.from_list(orientation) if orientation is not None else None),
        half=_vec3(raw.get("halfExtents")),
    )


#: 障害物の形 -> ドメイン型 (ADR-133 D5)。**未宣言の kind で throw する**
#: (ADR-118 の `_CHECKER_BY_KIND` と同じ規律)。倒す先を持たないのは、球へ倒すと
#: 「箱を宣言したのに外接球で判定された」が最も気づきにくい形で通るため —
#: 応答は候補が減った正しい形で返り、どの段で何が起きたかは誰にも見えない。
_OBSTACLE_KINDS = ("sphere", "box")

#: `kind` を持たない item は **ADR-133 以前の送信者**である。これは fall-through では
#: なく**名前のついた 1 つの分岐**で、球の必須キー `radius` が在ることを同時に要求する
#: (「形を述べていない」と「古い形式で述べた」を区別する)。新しい形を足すときこの
#: 行を読むことになるので、次の人は互換の対象が何だったかを知ったうえで判断できる。
_UNDECLARED_KIND_IS_LEGACY_SPHERE = True


def _obstacle_from_wire(raw: dict[str, Any]):
    """ワイヤの障害物 1 件をドメインの形へ (ADR-133 D5)。

    分岐は `kind` ただ 1 つ。**幾何キー (`radius` / `halfExtents`) から形を推測しない** —
    推測すると宣言と判定がずれたとき、どちらが正なのかを決める場所が無くなる (§1.1)。
    """
    kind = raw.get("kind")
    if kind is None and _UNDECLARED_KIND_IS_LEGACY_SPHERE and "radius" in raw:
        kind = "sphere"
    if kind == "sphere":
        return Obstacle(
            center=_vec3(raw.get("center")), radius=float(raw.get("radius", 0.0))
        )
    if kind == "box":
        half = raw.get("halfExtents")
        if half is None:
            raise ValueError(
                "box 障害物には halfExtents が要る (既定値で埋めない — "
                "寸法を述べていない箱は、点にも無限大にも読めてしまう)"
            )
        orientation_raw = raw.get("orientation")
        return BoxObstacle(
            center=_vec3(raw.get("center")),
            half_extents=_vec3(half),
            orientation=(
                Quaternion.from_list(orientation_raw)
                if orientation_raw is not None
                else None
            ),
        )
    raise ValueError(
        f"未宣言の障害物種別 {kind!r}: kind は {_OBSTACLE_KINDS} のいずれかであること "
        f"(ADR-133 D5 / 原則 #31 — 球へ倒すと「箱を宣言したのに外接球で判定された」が "
        f"候補が減っただけの正しい形で通る)"
    )


def problem_from_declaration(declaration: GraspSearchDeclaration) -> Problem:
    """graspSearch 宣言 (open payload) からドメイン Problem を構築する。

    既知の wire キー (camelCase) を読む。詳細スキーマは public DSL 正本に属するため、
    ここでは段階0 が必要とする幾何だけを寛容に抽出する。
    """
    data = declaration.model_dump(by_alias=True)

    robot_raw = data.get("robot") or {}
    # ADR-084 §4: judgement パラメータ (reach*/wristConeHalfAngle) は `plan{}` へ移設。
    # 旧 `robot.*` 直書きは後方互換フォールバックとして読む (既存テンプレ・呼び出しを
    # 無言で壊さない — ADR-084 のフォールバック規律)。同キーが両方在れば plan{} が勝つ。
    plan_raw = data.get("plan") or {}

    def _judgement(key: str, default: float) -> float:
        if key in plan_raw and plan_raw[key] is not None:
            return float(plan_raw[key])
        if key in robot_raw and robot_raw[key] is not None:
            return float(robot_raw[key])
        return default

    # tcp_orientation (ADR-084 §3): 宣言されると cone の基準軸が TCP 前方 (+X 回転) に
    # なる。ワールド姿勢に解決済みの四元数 [x,y,z,w] として渡る前提 (解決はフロント責務)。
    tcp_raw = robot_raw.get("tcpOrientation")
    tcp_orientation = Quaternion.from_list(tcp_raw) if tcp_raw is not None else None

    # base_orientation (ADR-129 D2): 据付姿勢。None は「直立」ではなく **述べていない**。
    # core/ は向き無しでは解けないので恒等で解くしかないが、その仮定を画面に出すのは
    # フロントの責務 — ここで既定を作らない (原則 #31)。
    base_rot_raw = robot_raw.get("baseOrientation")
    base_orientation = (
        Quaternion.from_list(base_rot_raw) if base_rot_raw is not None else None
    )

    robot = Robot(
        base=_vec3(robot_raw.get("base"), Vec3(0.0, 0.0, 0.0)),
        reach_min=_judgement("reachMin", 0.0),
        reach_max=_judgement("reachMax", float("inf")),
        wrist_cone_half_angle=_judgement("wristConeHalfAngle", math.pi),
        tcp_orientation=tcp_orientation,
        base_orientation=base_orientation,
    )

    target_raw = data.get("target") or {}
    grasp_specs = _specs_from_wire(target_raw.get("graspSpecs"))
    target = TargetObject(
        surface_samples=_samples_from_wire(target_raw.get("surfaceSamples")),
        # 閉じ軸なしの仕様の幅・パッチを測る母集団 = 全仕様のサンプルの和 (導出)。
        spec_samples=tuple(smp for spec in grasp_specs for smp in spec.samples),
        box=_target_box_from_wire(target_raw.get("box")),
    )

    obstacles: list[Any] = []
    for o in data.get("obstacles", []) or []:
        obstacles.append(_obstacle_from_wire(o))

    # camera / gripper 宣言 (ADR-081)。open payload の既知キーを寛容に読む。
    # 未宣言 (None) は該当ゲート無効 = 既存挙動 (robot/sampling と同じ規律)。
    camera: Optional[Camera] = None
    camera_raw = data.get("camera")
    if camera_raw:
        view_axis_raw = camera_raw.get("viewAxis")
        fov_raw = camera_raw.get("fovHalfAngle")
        camera = Camera(
            position=_vec3(camera_raw.get("position")),
            view_axis=_vec3(view_axis_raw) if view_axis_raw is not None else None,
            fov_half_angle=float(fov_raw) if fov_raw is not None else None,
        )

    # ハンド宣言は kind 判別の union (ADR-118 / 契約 v5)。**kind 欠落や未知の kind を
    # 平行ジョーへ倒さない** — 倒すと「吸引を宣言したのに幅で判定される」という、
    # 応答が正しい形をしているぶん最も気づきにくい嘘になる (原則 #31)。
    gripper: Optional[Gripper] = None
    gripper_raw = data.get("gripper")
    if gripper_raw:
        gripper = _gripper_from_wire(gripper_raw)
    tool_length = tool_length_from_declaration(data)
    check_mount_matches_shape(gripper, tool_length)

    sampling = data.get("sampling") or {}
    return Problem(
        robot=robot,
        target=target,
        obstacles=tuple(obstacles),
        approach_tilt_angles=_tuple_floats(
            sampling.get("approachTiltAngles"), (0.0,)
        ),
        roll_angles=_tuple_floats(sampling.get("rollAngles"), (0.0,)),
        pre_grasp_distance=float(sampling.get("preGraspDistance", 0.1)),
        clearance_reference=float(sampling.get("clearanceReference", 0.1)),
        camera=camera,
        gripper=gripper,
        grasp_specs=grasp_specs,
        strategy=_strategy_from_wire(target_raw.get("strategy")),
        tool_length=tool_length,
    )


# --- 診断 (ADR-079: 判定の証明) -------------------------------------------------


#: ハンド種別 -> ワイヤの near-miss kind (ADR-118 / 契約 v5)。**未宣言の種別で
#: KeyError を出す**のは意図的で、既定へ倒すと吸引の不足量が "opening" として
#: 報告され、クライアントは間違った量のメーターを描く (原則 #31)。
_MISS_KIND_BY_GRIPPER: dict[GripperKind, str] = {
    GripperKind.PARALLEL_JAW: "opening",
    GripperKind.SUCTION: "sealPatch",
}


@dataclass(frozen=True)
class SearchDiagnostics:
    """探索 1 回分の棄却ファネル + near-miss (ドメイン型, ADR-079 / ADR-081 で 5 段化)。

    短絡フィルタ (リーチ -> IK -> 把持性 -> 可視性 -> 干渉, 並びの根拠はモジュール
    docstring) なので棄却段は排他に定まり、
    candidates_generated = rejected_by_reach + rejected_by_visibility + rejected_by_ik
    + rejected_by_interference + rejected_by_grasp + feasible が常に成り立つ
    (テストで固定)。camera/gripper 未宣言のリクエストでは該当段の棄却は常に 0。

    載せるのは「ソルバが決定した事実」の集計のみ。演出 (文言/色/メーター) は
    クライアント所有。契約 v4 で wire (契約応答) にも同じ形で露出する (ADR-081)。
    """

    candidates_generated: int
    rejected_by_reach: int
    rejected_by_visibility: int
    rejected_by_ik: int
    rejected_by_interference: int
    rejected_by_grasp: int
    # 5 判定すべて通過した候補数 (= 採点対象)。
    feasible: int
    # 実際に応答へ載せた件数 (= min(feasible, topN))。
    returned: int
    # リーチ棄却候補の到達殻までの最小不足距離。リーチ棄却ゼロなら None。
    reach_nearest_miss: Optional[float]
    # 可視棄却候補の最小遮蔽量 (最も浅く遮られた候補の食い込み深さ)。測定可能な
    # 可視棄却が無ければ None (視野外のみの棄却は遮蔽量では測れない — feasibility)。
    occlusion_nearest_miss: Optional[float]
    # 把持棄却候補の最小不足量と、その **種別** (ADR-118 / 契約 v5)。平行ジョーなら
    # 開口幅の不足、吸引ならシールパッチの不足で、長さは同じでも量が違う。測定可能な
    # 把持棄却が無ければ None (接触対なしの棄却は幅では測れない — feasibility)。
    grasp_nearest_miss: Optional[float]
    grasp_nearest_miss_kind: Optional[str]
    # 送られた把持仕様ごとの生成数・通過数 (ADR-152 D4)。仕様なしなら空。
    grasp_specs: "tuple[GraspSpecDiagnostics, ...]" = ()


#: 通過候補 1 件 = (総合スコア, 姿勢, objective 内訳, IK 解, 仕様 id | None)。
_Scored = tuple


@dataclass
class _Funnel:
    """探索 1 回の棄却ファネルの**累積器** (可変 — search_report の中でだけ生きる)。

    仕様ごと・導出ごとに評価しても同じ 1 つのファネルに数える (恒等式は全候補で成立)。
    """

    generated: int = 0
    rejected_by_reach: int = 0
    rejected_by_visibility: int = 0
    rejected_by_ik: int = 0
    rejected_by_interference: int = 0
    rejected_by_grasp: int = 0
    reach_nearest_miss: Optional[float] = None
    occlusion_nearest_miss: Optional[float] = None
    grasp_nearest_miss: Optional[float] = None
    grasp_nearest_miss_kind: Optional[str] = None


@dataclass(frozen=True)
class SearchReport:
    """契約応答 + 診断の束。診断は探索ループからの導出値 (第二の源にしない)。"""

    response: GraspSearchResponse
    diagnostics: SearchDiagnostics


# --- 探索本体 (副作用境界) -----------------------------------------------------


def reach_solution_of(solution: IkSolution) -> ReachSolution:
    """IK 解を契約の `reachSolution` union へ写す **ただ 1 箇所** (ADR-135 D1/D2)。

    分岐は**型**で行う (原則 #2) — 関節の本数や「ソルバが何だったか」を呼び出し側で
    数え直すと、占位の解を `solved` として載せる経路がそのぶん増える。占位を載せた
    瞬間クライアントは**誰も決めていない腕の姿勢**を描くので、これは表示の乱れでは
    なく契約違反 (ADR-060「ワイヤに載るのはソルバが決定した事実のみ」)。

    純粋関数 (原則 #3)。
    """
    if isinstance(solution, JointSolution):
        return ReachSolutionSolved(joints=list(solution.joints))
    return ReachSolutionUndeclared()


def search_report(
    request: GraspSearchRequest,
    *,
    ik_solver: Optional[IkSolver] = None,
    collision_checker: Optional[CollisionChecker] = None,
    visibility_checker: Optional[VisibilityChecker] = None,
    grasp_checker: Optional[GraspChecker] = None,
) -> SearchReport:
    """段階0 の把持姿勢探索 + 診断。契約 GraspSearchRequest -> SearchReport。

    ソルバ/チェッカは注入可能 (省略時は naive 既定)。ドメイン段階フィルタ
    (安い順: リーチ -> IK -> 把持性 -> 可視性 -> 干渉, ADR-081) で短絡し、通過した候補だけを
    加重和スコアで採点して rank 昇順の上位N件を返す。棄却ファネルとドメイン別
    near-miss は同一ループで incidental に収集する (二度走らせない, ADR-079)。

    注: contractVersion 検証はエンドポイント層の責務 (ADR-074/002)。ここでは行わない。
    """
    # IK ソルバの決め方は 3 段 (優先順): 注入 > 宣言された運動学 > 素朴既定。
    # 宣言があるときだけ解析解へ切り替わるので、宣言しない呼び出しの答えは変わらない
    # (ADR-127 / ADR-084 §3 と同じ「宣言した瞬間にだけ挙動が変わる」規律)。
    if ik_solver is not None:
        solver: IkSolver = ik_solver
    else:
        declared = ik_solver_from_declaration(
            request.grasp_search.model_dump(by_alias=True)
        )
        solver = declared if declared is not None else NaiveIkSolver()
    # 干渉チェッカも 3 段 (優先順): 注入 > 宣言された運動学で腕を見る版 > 素朴既定。
    # **分岐は型で行う** (原則 #2) — 「DH を持っていそうか」を getattr で嗅ぐと、
    # 別の解析解ソルバが来た日に黙って腕を見なくなる。
    if collision_checker is not None:
        checker: CollisionChecker = collision_checker
    elif isinstance(solver, UniversalRobotsIkSolver):
        # ADR-145: 腕リンクの FK スイープを既存の進入経路判定に**足す** (置き換えない)。
        # 運動学を宣言したリクエストでだけ有効になるので、既存テンプレの答えは不変。
        checker = NaiveArmSweepCollisionChecker(
            dh=solver.dh, inner=NaivePathCollisionChecker(),
            tool_length=solver.tool_length,
        )
    else:
        checker = NaivePathCollisionChecker()
    vis_checker = (
        visibility_checker
        if visibility_checker is not None
        else NaiveSightlineVisibilityChecker()
    )
    # 既定を平行ジョーに固定しない (ADR-118): 種別ごとに測る量が違うので、
    # 注入が無ければ `grasp_miss` が宣言された kind から naive 既定を引く。
    # ここで固定すると、吸引を宣言したのに幅で判定される嘘が静かに通る。
    grip_checker = grasp_checker

    declaration = request.grasp_search
    problem = problem_from_declaration(declaration)
    weights = declaration.objective_weights
    objective_names = list(weights.keys())

    # ADR-152 D5: 手の形が宣言されていれば、手の OBB 判定を**足す** (置き換えない)。
    # 注入されたチェッカには足さない (注入 > 宣言 の優先順位を崩さない)。
    gripper_shape = getattr(problem.gripper, "shape", None)
    if collision_checker is None and gripper_shape is not None:
        checker = NaiveHandCollisionChecker(
            inner=checker, shape=gripper_shape, tool_length=problem.tool_length,
        )

    funnel = _Funnel()

    def evaluate(candidate) -> "Optional[_Scored]":
        """候補 1 件をドメイン段階フィルタにかける (並びの根拠はモジュール docstring)。

        各段で短絡するため棄却段は排他 = ファネル恒等式が成り立つ。仕様由来か導出由来か
        で段は変わらない — 全候補が同じ 1 つのファネルに数えられる。
        """
        funnel.generated += 1
        if not within_reach(candidate, problem.robot):
            funnel.rejected_by_reach += 1
            miss = reach_miss(candidate, problem.robot)
            if funnel.reach_nearest_miss is None or miss < funnel.reach_nearest_miss:
                funnel.reach_nearest_miss = miss
            return None
        # ADR-135 D2: 解を**保持**する。ここで `ik_solvable()` を呼ぶと解は
        # その場で bool に潰れて捨てられ、同じ解をもう一度解かせる羽目になる。
        ik_solution = solver.solve(candidate, problem.robot)
        if ik_solution is None:
            funnel.rejected_by_ik += 1
            return None
        if problem.gripper is not None:
            # ADR-152 D5: 深さのゲート (パームが面の下へ潜る) は把持性の段。開口や
            # シールの不足とは量が違うので near-miss には数えない (kind を持たない)。
            if palm_depth_miss(candidate, problem.gripper, problem.tool_length) > 0.0:
                funnel.rejected_by_grasp += 1
                return None
            miss = grasp_miss(
                candidate, problem.gripper, problem.target, grip_checker
            )
            if miss > 0.0:
                funnel.rejected_by_grasp += 1
                if math.isfinite(miss) and (
                    funnel.grasp_nearest_miss is None or miss < funnel.grasp_nearest_miss
                ):
                    funnel.grasp_nearest_miss = miss
                    funnel.grasp_nearest_miss_kind = _MISS_KIND_BY_GRIPPER[problem.gripper.kind]
                return None
        if problem.camera is not None:
            occlusion = vis_checker.occlusion_miss(
                candidate, problem.camera, problem.obstacles
            )
            if occlusion > 0.0:
                funnel.rejected_by_visibility += 1
                if math.isfinite(occlusion) and (
                    funnel.occlusion_nearest_miss is None
                    or occlusion < funnel.occlusion_nearest_miss
                ):
                    funnel.occlusion_nearest_miss = occlusion
                return None
        # ADR-135 D2 で保持した解をそのまま渡す (解き直さない)。腕を見ないチェッカは
        # 無視し、見るチェッカだけが `JointSolution` のときに腕を再構成する。
        if not interference_free(
            candidate,
            problem.obstacles,
            checker,
            solution=ik_solution,
            robot=problem.robot,
        ):
            funnel.rejected_by_interference += 1
            return None
        objective_scores = evaluate_objectives(candidate, problem, objective_names)
        total = weighted_sum(objective_scores, weights)
        return (total, candidate.pose, objective_scores, ik_solution, candidate.spec_id)

    def evaluate_all(candidates) -> "list[_Scored]":
        return [r for r in (evaluate(c) for c in candidates) if r is not None]

    # 仕様ごとに評価し、戦略で返す集合を選ぶ (ADR-152 D5)。**全仕様を評価する** —
    # priority でも後ろの仕様を数えないと、「返さなかった」と「無かった」が
    # 診断で区別できない (原則 #31)。
    spec_rows: list[GraspSpecDiagnostics] = []
    if problem.grasp_specs:
        per_spec: list[list[_Scored]] = []
        for spec in problem.grasp_specs:
            before = funnel.generated
            spec_scored = evaluate_all(generate_spec_candidates(problem, spec))
            per_spec.append(spec_scored)
            spec_rows.append(GraspSpecDiagnostics(
                id=spec.id,
                candidates_generated=funnel.generated - before,
                feasible=len(spec_scored),
            ))
        feasible_total = sum(len(x) for x in per_spec)
        if problem.strategy.order is StrategyOrder.PRIORITY:
            scored = next((x for x in per_spec if x), [])
        else:
            scored = [r for x in per_spec for r in x]
        if feasible_total == 0 and problem.strategy.fallback is StrategyFallback.DERIVED:
            scored = evaluate_all(generate_candidates(problem))
            feasible_total = len(scored)
    else:
        scored = evaluate_all(generate_candidates(problem))
        feasible_total = len(scored)

    # 総合スコア降順で並べ、rank 1.. を振り、上位N件を取る。
    # 同点は生成順 (決定的) を保つため安定ソート + key は score のみ。
    scored = list(scored)
    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[: declaration.top_n]

    candidates = [
        PoseCandidate(
            rank=i + 1,
            pose=pose_to_payload(pose),
            score=ScoreBreakdown(
                # 通過した候補なので 5 判定はすべて True (短絡で弾かれた候補は載らない)。
                # visible/graspable は該当ゲート未宣言 (camera/gripper なし) なら
                # 空虚に True — どちらだったかはリクエスト宣言の有無から読める
                # (契約 v4 Schema の記述と対応)。
                within_reach=True,
                visible=True,
                ik_solvable=True,
                interference_free=True,
                graspable=True,
                objective_scores=objective_scores,
                total_score=total,
                # 捨てずに運んできた代表解 (ADR-135)。`undeclared` は
                # 「robot.kinematics 未宣言なので誰も関節を決めていない」の宣言で、
                # 「到達不可」ではない (到達不可な候補はここに載らない)。
                reach_solution=reach_solution_of(ik_solution),
            ),
            grasp_spec_id=spec_id,
        )
        for i, (total, pose, objective_scores, ik_solution, spec_id) in enumerate(top)
    ]
    diagnostics = SearchDiagnostics(
        candidates_generated=funnel.generated,
        rejected_by_reach=funnel.rejected_by_reach,
        rejected_by_visibility=funnel.rejected_by_visibility,
        rejected_by_ik=funnel.rejected_by_ik,
        rejected_by_interference=funnel.rejected_by_interference,
        rejected_by_grasp=funnel.rejected_by_grasp,
        # 全評価候補のうち 5 判定を通った数 (恒等式の項)。戦略が返さなかった仕様の
        # 通過候補も含む — 返したかどうかは `returned` と `grasp_specs` が言う。
        feasible=feasible_total,
        returned=len(candidates),
        reach_nearest_miss=funnel.reach_nearest_miss,
        occlusion_nearest_miss=funnel.occlusion_nearest_miss,
        grasp_nearest_miss=funnel.grasp_nearest_miss,
        grasp_nearest_miss_kind=funnel.grasp_nearest_miss_kind,
        grasp_specs=tuple(spec_rows),
    )
    diagnostics_wire = SearchDiagnosticsWire(
        candidates_generated=diagnostics.candidates_generated,
        rejected_by_reach=diagnostics.rejected_by_reach,
        rejected_by_visibility=diagnostics.rejected_by_visibility,
        rejected_by_ik=diagnostics.rejected_by_ik,
        rejected_by_interference=diagnostics.rejected_by_interference,
        rejected_by_grasp=diagnostics.rejected_by_grasp,
        feasible=diagnostics.feasible,
        returned=diagnostics.returned,
        reach_nearest_miss=diagnostics.reach_nearest_miss,
        occlusion_nearest_miss=diagnostics.occlusion_nearest_miss,
        grasp_nearest_miss=(
            None if diagnostics.grasp_nearest_miss is None
            else {
                "kind": diagnostics.grasp_nearest_miss_kind,
                "shortfall": diagnostics.grasp_nearest_miss,
            }
        ),
        grasp_specs=list(diagnostics.grasp_specs),
    )
    return SearchReport(
        response=GraspSearchResponse(candidates=candidates, diagnostics=diagnostics_wire),
        diagnostics=diagnostics,
    )


def search(
    request: GraspSearchRequest,
    *,
    ik_solver: Optional[IkSolver] = None,
    collision_checker: Optional[CollisionChecker] = None,
    visibility_checker: Optional[VisibilityChecker] = None,
    grasp_checker: Optional[GraspChecker] = None,
) -> GraspSearchResponse:
    """契約応答のみが要る呼び出し側の従来入口 (search_report の薄い皮)。"""
    return search_report(
        request,
        ik_solver=ik_solver,
        collision_checker=collision_checker,
        visibility_checker=visibility_checker,
        grasp_checker=grasp_checker,
    ).response
