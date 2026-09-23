"""ADR-147 / ADR-146 D3: 候補 frame ⇄ フランジ目標の gauge 準拠フィクスチャ。

規約 (FRAME_CONVENTION / FLANGE_Z_IS_APPROACH) を**宣言しているのは `core/`** なので、
数を生むのもこちら。JS 側はこの写しが写しであり続けるかを問われる立場に置く。

    cd core && uv run python ../scripts/gen-cross-language-gauge.py
"""

import json
import math
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "core"))

from easy_extrude_core.engine.pose_codec import pose_to_payload  # noqa: E402
from easy_extrude_core.engine.types import Pose, Vec3  # noqa: E402
from easy_extrude_core.engine.ur_solver import flange_target  # noqa: E402
from easy_extrude_core.engine.candidates import GraspCandidate  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "cross-language" / "ur5e-candidate-to-flange.json"

rnd = random.Random(1147)


def unit():
    while True:
        v = Vec3(rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))
        if v.norm() > 0.2:
            return v.normalized()


# 進入方向は**両方の極**を含める: gauge の基準軸は z 成分の大きさで切り替わるので
# (|z| < 0.9 か否か)、片側だけのフィクスチャでは分岐が 1 本しか通らない。
approaches = [
    Vec3(0.0, 0.0, -1.0),   # 真下 = |z| >= 0.9 の枝
    Vec3(0.0, 0.0, 1.0),
    Vec3(1.0, 0.0, 0.0),    # 水平 = |z| < 0.9 の枝
    Vec3(0.0, 1.0, 0.0),
]
while len(approaches) < 24:
    approaches.append(unit())

# ツール長 (ADR-150 D4) は**全ケースで明示**する — 欠けたキーを 0 と読ませると、
# 「0 を宣言した」と「書き忘れた」が区別できない (原則 #31)。0 と非 0 の両方を通す:
# 0 だけでは tool_length を無視する写しでも緑になる。
TOOL_LENGTHS = (0.0, 0.15)

cases = []
for i, approach in enumerate(approaches):
    roll = rnd.uniform(-math.pi, math.pi) if i >= 4 else (i * math.pi / 4)
    position = Vec3(rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0.1, 0.9))
    pose = Pose(position=position, approach=approach, roll=roll)
    candidate = GraspCandidate(
        pose=pose,
        pre_grasp=position - approach.scaled(0.1),
        surface_normal=approach.scaled(-1.0),
    )
    tool_length = TOOL_LENGTHS[i % 2] if i < 8 else rnd.uniform(0.0, 0.3)
    cases.append(
        {
            # ワイヤに載る形そのもの (JS が読むのはこれ)。
            "posePayload": pose_to_payload(pose),
            # robot.toolLength (ADR-150)。候補 position は TCP、フランジはここだけ戻る。
            "toolLength": tool_length,
            # 同じ pose から core/ が作るフランジ目標 (JS が再現すべき数)。
            "flangeTarget": [float(v) for v in flange_target(candidate, tool_length)],
        }
    )

OUT.write_text(
    json.dumps(
        {
            "$comment": (
                "ADR-147 / ADR-146 D3。候補 frame (FRAME_CONVENTION, +Z=-approach) と "
                "フランジ目標 (FLANGE_Z_IS_APPROACH, +Z=+approach) をつなぐ gauge の "
                "準拠フィクスチャ。生成物であって手書きしない — 再生成は "
                "cd core && uv run python ../scripts/gen-cross-language-gauge.py"
            ),
            "subject": "ur5e-candidate-to-flange",
            "source": "core/easy_extrude_core/engine/pose_codec.py",
            "tolerance": 1e-9,
            "cases": cases,
        },
        indent=2,
        ensure_ascii=False,
    )
    + "\n",
    encoding="utf-8",
)
print(f"{OUT.relative_to(ROOT)}: {len(cases)} 姿勢")
