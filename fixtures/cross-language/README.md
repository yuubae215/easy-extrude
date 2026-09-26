# fixtures/cross-language — 導出が導出であり続けることを問う数 (ADR-146 D3)

ADR-146 は「**公知の閉形式・一般ロジックはクライアントにも置いてよい。ただし第二の
源ではなく*導出*として置くこと**」と決めた。その「導出である」は主張であって、主張は
機械が問わなければ静かに腐る (ADR-115)。

ここに在るのはその問いに使う**共有フィクスチャ**である。両言語のテストが**同じファイル
の同じ数**を読み、同じ入力に同じ答えを出すことを問う。片方だけが読む数は対照にならない
(それは単なる回帰テストで、「2 つの実装が一致している」を一度も言わない)。

## 規律

- **フィクスチャは生成物であって手書きしない** (§1.1)。源は 1 つで、再生成コマンドを
  `$comment` に書く。手で数を直したくなったら、それは源がずれた合図である。
- **数を生むのは「画面に出るほう」**。ずれたときに直すべきは導出の側であって、
  ユーザーが見ている実体の側ではない。
- 消費者は**両方**が `pnpm` / `pytest` のどちらかのレーンで走ること。
  片側だけなら「読む機械が在る」は半分しか真でない。

## 登録簿

| subject | 源 | 消費者 (JS) | 消費者 (Python) |
|---|---|---|---|
| `ur5e-forward-kinematics` | `public/robot/skeleton_arm.urdf` | `src/robotics/CrossLanguageDerivation.test.js` | `core/tests/test_ur_kinematics.py` |
| `ur5e-inverse-kinematics` | `core/easy_extrude_core/engine/ur_kinematics.py` | `src/robotics/CrossLanguageDerivation.test.js` | `core/tests/test_ur_kinematics.py` |
| `ur5e-candidate-to-flange` | `core/easy_extrude_core/engine/pose_codec.py` | `src/robotics/CrossLanguageDerivation.test.js` | `core/tests/test_ur_kinematics.py` |
| `hand-parts-in-flange` (ADR-152) | `core/easy_extrude_core/engine/pipeline.py` | `src/robotics/CrossLanguageDerivation.test.js` | `core/tests/test_grasp_specs.py` |

**個数 = 4。** 表の行の個数は `src/robotics/CrossLanguageDerivation.test.js` の
`CROSS_LANGUAGE_DERIVATIONS` が宣言し、各行のフィクスチャの実在と両消費者がそれを
**実際に読んでいること**を同テストが問う。

**限界 (推論させない — ADR-124 の形):** この登録簿の母集団は**人が維持する**。
「同じ計算が 2 言語に在る」はコードの構文からは導出できない (grep できる形を持たない)
ので、検査が捕まえるのは*宣言された行の腐り*であって**宣言されなかった複製**ではない。
その穴は塞げないので**数える**: DEF-039。
