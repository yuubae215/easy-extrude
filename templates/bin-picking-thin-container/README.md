# bin-picking-thin-container (薄型コンテナ + ランダム平置きワーク)

薄型 (浅い) コンテナの底にランダムに平置きされたワークを、ロボットが上面から把持する
シナリオの grasp search テンプレ。手で書ききった完成 DSL/入力で、既存の段階0 エンジン
(`core/`) がそのまま実行できる。

`version`: "layout/1.0" (入力 JSON の `layoutVersion`)。

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

- **hardConstraints** (`reachable` / `ik_solvable` / `collision_free`) は**参照名のみ**。
  解く実装はテンプレに書かない。エンジンの安い順フィルタ (リーチ -> IK -> 干渉) が暗黙に
  適用する (`engine/pipeline.py`)。
- **objectives** は `objectiveWeights` で宣言:
  - `grasp_stability` (1.0): 進入が上面法線の逆向き = top-down ほど高い。
  - `approach_clearance` (0.7): 進入経路から壁・隣接ワークまでの距離。薄型ゆえ重視。
  - `reach_margin` (0.3): 到達域の縁からの余裕。
  各指標は絶対基準で 0-1 正規化済み (`engine/objectives.py` の `NormSpec`) なので、
  他テンプレと総合スコアを比較できる。
- **sampling**: `approachTiltAngles [0, ~10deg]` (薄型ゆえ大きく寝かせない),
  `rollAngles [0, 90deg]` (平行ハンドの向き 2 種), `preGraspDistance 0.1` (10cm 上から降下),
  `clearanceReference 0.03` (壁・隣接ワークへの安全距離 3cm)。

## 手検証メモ (受け入れテスト `core/tests/test_templates.py` の根拠値)

代表値で手計算 + エンジン実行で確認済み:

- 中心 top-down 候補 (`point [0,0,-0.6]`, `approach ~ [0,0,-1]`) は
  **リーチ内** (距離 0.6 in [0.4,0.95]) / **IK 可** (なす角 ~0deg <= 0.7) /
  **干渉なし** (最近接障害物まで ~0.069m > 0) で、`grasp_stability`・`approach_clearance`
  ともに満点付近 -> **rank 1**。
- 端寄り / 傾けた候補は壁・隣接ワーク球で一部脱落、または clearance スコア低下で下位に入る。

受け入れテスト: `core/tests/test_templates.py` がこの JSON を読み、上記を自動で検証する。

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
- **ワーク姿勢ばらつき**: 「平置き」の実際の傾き (法線が厳密に +Z でない)・平行ハンドの
  開き幅は段階0 の範囲外。

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
