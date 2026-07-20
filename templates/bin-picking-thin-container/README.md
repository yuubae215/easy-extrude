# bin-picking-thin-container (薄型コンテナ + ランダム平置きワーク)

薄型 (浅い) コンテナの底にランダムに平置きされたワークを、ロボットが上面から把持する
シナリオのテンプレ。段階0 エンジン (`core/`) がそのまま実行できる。

`version`: "layout/1.0" (入力 JSON の `layoutVersion`)。

## ファイル構成 (ADR-081 で scene 形式へ移行)

- **`pick-sequence.request.json` — 正本 (scene 形式)**。属性付きエンティティ
  (workpiece x5 + wall リム) + 共有設定 (robot / camera / gripper / sampling)。
  障害物は手書きせず、per-pick に `core/` の scene 層が属性から**導出**する
  (ADR-078 Decision 2。手書き再構築が精度劣化の主因だった — ADR-081 Decision 4)。
- `grasp-search.request.json` — 1 ピックぶんのエンジン契約リクエスト例 (対象 =
  work-center)。`obstacles[]` は scene 正本からの**導出値のピン留め**であり、
  `core/tests/test_templates.py` の回帰テストが scene 導出との一致を固定する
  (手で編集する場合は必ず scene 側を直してから導出し直す)。

## シナリオと座標系

- 単位: メートル。座標系: ロボット base を原点 `[0,0,0]` に置く。
- コンテナ床は `z = -0.6` (base の真下 0.6m)。薄型ゆえ壁は低く、リムは `z = -0.57` 付近。
- ワークは床に平置き = 上面法線が `+Z` (`[0,0,1]`)。よって素直な把持は **真下への top-down**
  (進入方向 `approach = [0,0,-1]`)。

## モデル化の判断 (素朴版 = 球近似)

段階0 エンジンの障害物は**球のみ** (`core/easy_extrude_core/engine/types.py` の `Obstacle`)。
薄型コンテナと隣接ワークを球で近似する:

- **対象ワーク**: `target.surfaceSamples` に対象 1 個の上面の数点 (中心 + 前後左右の微小
  オフセット)、全て法線 `[0,0,1]`。サンプル点ごとに候補が生成される。
- **隣接ワーク** (ランダム平置き): 周囲に散らした球障害物 (半径 ~0.025)。
- **コンテナ壁** (薄型リム): footprint (`+-0.15`) の周縁にリム高さの球を並べて近似。

### 重要: 1 リクエスト = 1 対象ワーク

全ワークをまとめて障害物に並べてはいけない。各候補の進入線分の終点は対象ワーク中心と
一致するため、対象自身を障害物にすると線分-球距離が 0 になり**必ず自己干渉**する
(`engine/feasibility.py` の `NaiveSphereCollisionChecker`)。

正しい分解は「**対象ワーク 1 個を `target`、残りのワーク + 壁を `obstacles`**」。
このテンプレはその 1 対象ぶんを示す (OpenQuestion の全数スキャンも参照)。

## DSL <-> エンジンの線引き (混ぜない)

- **hardConstraints** (`reachable` / `ik_solvable` / `collision_free` / `visible` /
  `graspable`) は**参照名のみ**。解く実装はテンプレに書かない。エンジンのドメイン段階
  フィルタ (リーチ -> IK -> 把持性 -> 可視性 -> 干渉, 安い順の実測は
  `engine/pipeline.py`) が暗黙に適用する。
- **camera / gripper** (ADR-081) も**宣言のみ**: カメラは位置 + 視軸 + FOV 半角、
  グリッパは開口幅 + 指クリアランス。可視性 (視線遮蔽) と把持性 (開口幾何) の判定は
  `core/` が解く。
- **objectives** は `objectiveWeights` で宣言:
  - `grasp_stability` (1.0): 進入が上面法線の逆向き = top-down ほど高い。
  - `approach_clearance` (0.7): 進入経路から壁・隣接ワークまでの距離。薄型ゆえ重視。
  - `reach_margin` (0.3): 到達域の縁からの余裕。
  各指標は絶対基準で 0-1 正規化済み (`engine/objectives.py` の `NormSpec`) なので、
  他テンプレと総合スコアを比較できる。
- **sampling**: `approachTiltAngles [0, ~10deg]` (薄型ゆえ大きく寝かせない),
  `rollAngles [0, 90deg]` (平行ハンドの向き 2 種), `preGraspDistance 0.1` (10cm 上から降下),
  `clearanceReference 0.03` (壁・隣接ワークへの安全距離 3cm)。

## 手検証メモ — 3 ドメイン (受け入れテスト `core/tests/test_templates.py` の根拠値)

代表値で手計算 + エンジン実行で、**見える / 届く / 掴める** (ADR-081) を確認済み:

- **届くか (Path)**: 中心 top-down 候補 (`point [0,0,-0.6]`, `approach ~ [0,0,-1]`) は
  **リーチ内** (距離 0.6 in [0.4,0.95]) / **IK 可** (なす角 ~0deg <= 0.7) /
  **干渉なし** (最近接障害物まで ~0.069m > 0)。
- **見えるか (Vision)**: カメラ `[0,0,0]` 真下視 (FOV 半角 0.6rad) から全把持点への
  視線が通る (最近接の隣接ワーク球まで ~0.094m > 0.025、壁リム球まで >= 0.15m >
  0.02。全サンプルの視線角 <= ~0.24rad < 0.6)。`rejectedByVisibility = 0`。
- **掴めるか (Grasp)**: 対象幅は閉じ軸 roll=0 で 0.03m / roll=90deg で 0.04m。
  開口 0.06 >= 幅 + 指クリアランス 0.01 (最悪 0.05) で全 roll 合格。
  `rejectedByGrasp = 0`。
- 総合: `grasp_stability`・`approach_clearance` とも満点付近の中心 top-down が **rank 1**。
  端寄り / 傾けた候補は壁・隣接ワーク球で一部脱落、または clearance スコア低下で下位。
- **L3 リスクの再現例 (ADR-081 KPI/階梯の固定ケース)**: カメラを壁側
  `[0.3, 0, -0.52]` に寄せて斜めから覗くと、壁リム球 `[0.15, 0, -0.57]` が全把持点の
  視線を遮り `rejectedByVisibility` が立つ (可視率 0 = 運用なら L3 再認識リトライ常連 →
  カメラ再配置 L5 相当の設計時警告)。受け入れテストが固定する。

受け入れテスト: `core/tests/test_templates.py` が scene 正本と導出の一致・上記 3 ドメインの
挙動・契約 v4 準拠を自動で検証する。

## OpenQuestion (現場で必ず聞かれる曖昧点)

- **全数スキャン / 障害物ロール**: ビン全体を当たるには「対象ごとに 1 リクエスト」を回す
  (対象を `target`、それ以外のワーク + 壁を `obstacles`)。本テンプレは 1 対象ぶんの例。
  「障害物かどうか」をエンティティ属性 (static 壁 / dynamic ワーク) として持たせ、
  per-pick で障害物集合を導出する設計は `docs/adr/ADR-078-bin-picking-scene-entities.md`。
  この導出 + 最上面順 反復ピックは `core/easy_extrude_core/scene` に実装済み
  (本テンプレの手書き `obstacles[]` を属性からの自動導出に置き換える層)。
- **壁の厳密さ**: 球近似は粗い。薄型壁との干渉を厳密に見たいなら、箱/半空間 (平面) 障害物の
  追加 (エンジン拡張) が後続課題 (段階0 では意図的に未対応)。
- **実機パラメータ**: ロボットのリーチ範囲・手首可動 (`wristConeHalfAngle`)・コンテナ寸法・
  ワーク寸法と把持点は現場値に差し替える。ここは代表値の仮置き。
- **ワーク姿勢ばらつき**: 「平置き」の実際の傾き (法線が厳密に +Z でない) は段階0 の
  範囲外。平行ハンドの開口幅は ADR-081 で `gripper` 宣言 + naive 幾何ゲート (幅 +
  クリアランス + 凸代理の接触対) に昇格した — 摩擦・力閉包 (wrench cone) は Phase 4。
- **カメラ忠実度**: naive 可視性は視線 (線分) と球遮蔽 + 視野円錐のみ。メッシュ遮蔽・
  被写界深度・露光は Phase 4 以降 (ADR-081 Consequences)。

## 実行方法

```sh
cd core
uv sync --extra dev --extra serve

# テンプレ入力でエンジンを直接実行し、上位候補を確認
uv run python - <<'PY'
import json, pathlib
from easy_extrude_core.contract import GraspSearchRequest
from easy_extrude_core.engine import pipeline
p = pathlib.Path("../templates/bin-picking-thin-container/grasp-search.request.json")
req = GraspSearchRequest.model_validate(json.loads(p.read_text(encoding="utf-8")))
resp = pipeline.search(req)
for c in resp.candidates:
    print(c.rank, round(c.score.total_score, 3), c.pose, c.score.objective_scores)
PY
```

期待: 候補が複数返り、中心 top-down (`approach ~ [0,0,-1]`) が rank 1。
