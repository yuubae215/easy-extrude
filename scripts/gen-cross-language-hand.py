"""ADR-152 D3/D5 / ADR-146 D3: 手の部品をフランジ座標に置く閉形式の準拠フィクスチャ。

手の形は `core/` が**判定する**形 (`_jaw_shape_from_wire` / `_suction_shape_from_wire`) と、
フロントが**描く**形 (`src/domain/robotTool.js: toolParts`) の 2 か所で同じ閉形式から
置かれる (爪は開口の位置、筐体はフランジ面から)。判定する側が源なので数を生むのは
こちらで、描く側はこの写しが写しであり続けるかを問われる — 描く爪と判定する爪がずれると
「見えている爪が判定されている爪」(ADR-152 の Goal) が黙って崩れる。

    cd core && uv run python ../scripts/gen-cross-language-hand.py
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "core"))

from easy_extrude_core.engine.pipeline import _gripper_from_wire  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "cross-language" / "hand-parts-in-flange.json"

# 手はフロントの既定 (src/domain/robotHand.js: DEFAULT_HAND_BY_KIND) を m にしたもの +
# 箱の筐体の 1 件。フロントの既定は mm だが、ワイヤと core は m で話す。
CASES = [
    {
        "kind": "parallelJaw", "maxOpening": 0.06, "fingerClearance": 0.01,
        "body": {"kind": "cylinder", "radius": 0.032, "length": 0.078},
        "fingers": {"length": 0.072, "thickness": 0.012, "width": 0.021},
    },
    {
        "kind": "parallelJaw", "maxOpening": 0.085,
        "body": {"kind": "box", "size": [0.09, 0.05, 0.07]},
        "fingers": {"length": 0.05, "thickness": 0.008, "width": 0.02},
    },
    {
        "kind": "suction", "cupDiameter": 0.04, "sealTiltTolerance": 0.35,
        "body": {"kind": "cylinder", "radius": 0.032, "length": 0.13},
        "cupHeight": 0.02,
    },
]


def main() -> None:
    cases = []
    for wire in CASES:
        shape = _gripper_from_wire(wire).shape
        cases.append({
            "gripper": wire,
            "palmZ": shape.palm_z,
            "parts": [
                {"name": p.name, "center": p.center.as_list(), "half": p.half.as_list()}
                for p in shape.parts
            ],
        })
    OUT.write_text(json.dumps({
        "$comment": "ADR-152 D3/D5 / ADR-146 D3。手の部品 (筐体・開いた爪・カップ) のフランジ座標の中心と半寸法 (m)。core/ が判定に使う形そのもの。生成物であって手書きしない — 再生成は cd core && uv run python ../scripts/gen-cross-language-hand.py",
        "subject": "hand-parts-in-flange",
        "source": "core/easy_extrude_core/engine/pipeline.py",
        "tolerance": 1e-12,
        "cases": cases,
    }, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
