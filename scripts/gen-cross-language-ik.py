"""ADR-147 / ADR-146 D3: UR 解析解 IK の導出準拠フィクスチャを再生成する。

**数を生むのは `core/` 側**である。逆運動学の権威は `UniversalRobotsIkSolver` で、
JS 側はそれを再現できるかを問われる立場に置く (FK のフィクスチャが URDF を解く JS を
権威にしたのと逆向きなのは、それぞれ*源*が違う側に住んでいるため — FK の源は画面に
出る URDF、IK の源は探索が解く `core/`)。

    cd core && uv run python ../scripts/gen-cross-language-ik.py
"""

import json
import math
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "core"))

from easy_extrude_core.engine.ur_kinematics import (  # noqa: E402
    UrDhParameters,
    forward_kinematics,
    inverse_kinematics,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "cross-language" / "ur5e-inverse-kinematics.json"
FK_FIXTURE = ROOT / "fixtures" / "cross-language" / "ur5e-forward-kinematics.json"

# DH は FK フィクスチャと**同じ数を読む** — 寸法の源を 2 つにしない (§1.1)。
DH_RAW = json.loads(FK_FIXTURE.read_text(encoding="utf-8"))["dh"]
DH = UrDhParameters(**{k: float(v) for k, v in DH_RAW.items()})

# 目標姿勢は「到達できることが構成上わかっている」ものだけを使う: 適当な関節配置を
# FK に通して作る。届かない姿勢を混ぜても「両方とも空を返す」ことしか主張できず、
# 8 解の一致を問えない (空の一致は検査として弱い — 全部空を返す実装でも緑になる)。
rnd = random.Random(147)
configurations = [
    [0.0] * 6,
    [0.4, -1.2, 1.5, -0.9, 1.1, 0.3],
    [math.pi / 3, -0.7, 0.9, 0.2, -1.4, 2.0],
]
while len(configurations) < 24:
    configurations.append([rnd.uniform(-2.6, 2.6) for _ in range(6)])


def exact(xs):
    """丸めずにそのまま出す。

    **目標姿勢は入力である。** 12 桁へ丸めると、手首特異点の近くではその丸めだけで
    関節値が 1e-8 動く (実測) — つまり「フィクスチャを読み直した core/ が、
    フィクスチャを作った core/ と違う答えを出す」。Python の float は JSON へ
    往復可能な最短表記で書き出され、JS の `JSON.parse` も同じ double を復元するので、
    丸めないことが両言語で同じ入力を読む唯一の方法になる。
    """
    return [float(v) for v in xs]


def rounded(xs):
    """出力側は 12 桁で足りる (許容差 1e-9 で比較するため)。"""
    return [round(float(v), 12) for v in xs]


cases = []
for q in configurations:
    target = forward_kinematics(DH, tuple(q))
    solutions = inverse_kinematics(DH, target)
    cases.append(
        {
            "seedJoints": exact(q),
            "target": exact(target),
            # 解は `inverse_kinematics` の決定的な順序のまま並べる。**並べ替えない** —
            # 順序そのものが契約の一部で、代表解の再現性がそこに乗っている。
            "solutions": [rounded(s) for s in solutions],
        }
    )

OUT.write_text(
    json.dumps(
        {
            "$comment": (
                "ADR-147 / ADR-146 D3 の導出準拠フィクスチャ。両言語がこの同じ数を読む。"
                "生成物であって手書きしない — 再生成は "
                "cd core && uv run python ../scripts/gen-cross-language-ik.py"
            ),
            "subject": "ur5e-inverse-kinematics",
            "source": "core/easy_extrude_core/engine/ur_kinematics.py",
            "dh": DH_RAW,
            "tolerance": 1e-9,
            "cases": cases,
        },
        indent=2,
        ensure_ascii=False,
    )
    + "\n",
    encoding="utf-8",
)
counts = sorted({len(c["solutions"]) for c in cases})
print(f"{OUT.relative_to(ROOT)}: {len(cases)} 姿勢 / 解の個数 {counts}")
