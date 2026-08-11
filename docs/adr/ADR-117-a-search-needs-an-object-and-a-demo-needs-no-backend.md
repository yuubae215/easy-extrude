# 117. 探索には掴む対象が要り、デモにはバックエンドが要らない — 死んだ主経路と、配れる静的スタブ

- Status: Accepted (実装済み 2026-08-08 — 対象宣言 / objective 語彙 / root フレーム取り込み / 静的スタブレーン。**調査で 4 件の欠陥が連鎖して出た**: 出発点は「スタブが欲しい」だけだった)
- Date: 2026-08-08
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし (ADR-085 の無フォーム入口, ADR-090 の 0/N 規律, ADR-100 の色 ratchet, ADR-115/116 の「印字ではなく検査」を継承)

## Context

要求は 2 つだった: **grasp-search まで最速でたどり着く UX 検証シナリオ**と、
**フロントだけで UX を回せる簡易ロジック**。後者は「静的配布でないと触ってもらい
づらい」という理由づけを伴った — レビュアーに URL を渡したい。

スタブを書く前に主経路を実際に走らせたところ、**その経路は死んでいた**。

### 発見 1 — request が掴む対象を載せていない

`GraspController.runGraspSearch` が組む宣言は
`{ objectiveWeights, topN, robot, plan?, camera?, gripper? }` で、`target` が無い。
`core/` の adapter (`pipeline.problem_from_declaration`) は target 不在を
**空のサンプル列**に落とすので `generate_candidates` は 1 件も yield せず、
UI からの全実行が `candidatesGenerated: 0` を返していた。実測:

```
surface_samples: 0
candidates generated: 0
```

0 は**正しい形の答え**なので何も赤くならない。さらに悪いことに、パネルの 0 件分岐は
「レイアウトに掴める形状があるか確認してください」と案内する — request が運んで
いない幾何について、ユーザーに直しようのない指示を出していた。ADR-116 が名指しした
形 (「死んでいても計数は緑だった」) の再演で、今度は**製品の主機能**で起きていた。

### 発見 2 — 重みの名前がソルバに存在しない

パネルは `{ reach, clearance }` を `objectiveWeights` に載せる。`core/` の
`OBJECTIVE_REGISTRY` が知っているのは `reach_margin` / `approach_clearance` /
`grasp_stability` で、`evaluate_objectives` は**未知の名前を黙って捨てる**
(`if definition is None: continue`)。この寛容さはソルバ側の設計判断として正しいが、
結果として `objectiveScores: {}` / `totalScore: 0.0` が返り、5 件が全部 0 点で並び、
スコアバーは空だった。スライダーは動くのに答えが変わらない (原則 #11)。

### 発見 3 — starter がロボットを宣言していない

ADR-085 の「無フォームで grasp を開く」入口は、文脈が空なら `cell_robotics` を
自動で採る。その `cell_robotics` は名前が "Robot Cell" でありながら、実体は
Solid 3 + AnnotatedPoint 2 で、**ロボットの CoordinateFrame を 1 つも持たない**。
ADR-090 のゲートが正しく働いて Run は「no robot in the scene」で閉じたまま。
既存 e2e はここを `toBeVisible()` でしか見ていなかったので緑だった —
*到達*は焼かれていたが *使えること*は焼かれていなかった。

### 発見 4 — world 親のフレームが取り込みで消える

発見 3 を直して starter にロボットを足しても、シーンにロボットは現れなかった。
`SceneService._reconstructEntity` の CoordinateFrame 分岐:

```js
const newParentId = remapId(dto.parentId)
if (!this._model.getObject(newParentId)) return null   // ← parentId === null もここで死ぬ
```

`parentId == null` は **「world 親」** であって「親が見つからない」ではない。
ロボット base は構造上 world 親 (TF ツリーは world → robot_base → tcp、ADR-084 §2 /
ADR-085) なので、`getObject(null)` が undefined を返して base が捨てられ、子の tcp も
親を失って捨てられた。捨てるだけで `skipped++` — 誰も読まないカウンタ。**文書が
明らかに宣言しているロボットについて、grasp が「シーンにロボットがいない」と
言っていた。**

4 件は独立ではなく直列で、**どれか 1 つでも残っていれば主経路は死んだまま**だった。

## Decision

### D1 — 掴む対象を宣言する (`src/domain/graspTargets.js`)

Layout DSL の `Solid` から対象を解決し、上面グリッド 9 点を `target.surfaceSamples`
として、他の実体を `obstacles` として request に載せる。

これは**宣言であって解法ではない**。「セルに何があるか」だけを答え、「掴めるか」は
答えない。前例は ADR-084 §2 — `robot.base` / `tcpOrientation` を Layout DSL の
CoordinateFrame からフロント側でワールド姿勢に解決してから送る形。同じ動詞、同じ
境界の側。リーチ / IK / 把持性 / 可視性 / 干渉は `core/` に残る。

基数は明示状態 (`TARGET_CARDINALITY`)。**N で先頭へ既定で倒さない** — この starter の
先頭の Solid はロボット自身の台座なので、既定は「自分の台座を掴む」を誰も選ばずに
宣言することになる。ADR-090 がロボットについて閉じた欠陥と同型 (原則 #31)。

FSM に `no-target` を足す (`no-robot` の双子)。台帳 `docs/STATE_LEDGER.md` に 3 行:
grasp-search FSM が 7 → **8 状態**、**掴む対象の台数** (`0..N`、ロボット行の双子)、
**スタブのシナリオ** (`0..1` レーン × 7 値)。対象の基数はこの ADR まで**欄を持って
いなかった** — 欄が無いものは検査対象のノードを持たないので、`candidatesGenerated: 0`
は最後まで「正しい形の答え」として通り続けた (原則 #31)。

### D2 — objective 語彙を 1 箇所にし、母集団を `core/` から導出する

`GraspDeclarationCatalog.OBJECTIVE` がワイヤキーの唯一の宣言。照合検査
(`GraspObjectiveVocabulary.test.js`) は**期待値を書き並べない** — `core/` の
`OBJECTIVE_REGISTRY` の**ソースから母集団を読み出す**。「3 つあるはず」と書けば
それは `place-list` で、`core/` に 4 つ目が増えた日に緑のまま UI から到達不能になる
(ADR-102)。母集団が空になったこと自体も fail させる (ADR-115)。

### D3 — `parentId == null` は world 親として取り込む

孤児判定は「親を**名指ししていて**その親がいない」ときだけ。あわせてフレームを
親→子順に整列してから取り込む (`orderFramesParentFirst`) — 従来は配列の並び順に
暗黙依存しており、たまたま成立していた。

### D4 — 静的配布できるスタブレーンを `src/` の外に置く

`mocks/graspStub/` — `fetch` 形の transport double。`BffClient` に注入し、
`VITE_GRASP_STUB` (ビルド時定数) で切る。

**なぜ transport 差し替えか。** 要件は「サーバの無い静的 URL」なので vite dev
middleware は落選 (静的ビルドに存在しない)。Service Worker でも可能だが、依存 1 つと
初回登録レース、base path とスコープの同期が増える。`BffClient` が構築時に受け取る
`fetch` を差し替えれば同じ遮断が得られ、しかも **`Response` を本物で返す**ので
status 分岐は出荷されるコードそのものが走る。

**なぜ `src/` の外か。** スタブは粗いとはいえリーチ・可視性・干渉を*解く*。
CLAUDE.md の境界はその解法を `core/` に置く。スタブは `core/` の代役なので
バックエンド側の住人であり、同じワイヤ契約越しに届く。`src/` から
`mocks/` を静的 import する経路は存在しない (動的 import 1 箇所のみ、フラグの陰)。

**スタブは response 契約の第二の生産者**なので、`core/` と同じ縛りを受ける:
schema 適合、`contractVersion` は契約パッケージから読む、ファネル恒等式、段の排他と
順序、宣言の無い camera/gripper が段を素通しにする規則。数値の一致は**求めない**
(創作なので `core/` と食い違う) — 一致を焼けば虚構を凍結するだけ。

## Consequences

### 得られたもの

- 主経路が生きた。実スタック (BFF → コアAPI、両端で契約検証) が starter の
  `pick_table` に対して 5 件の候補を実スコア付きで返す。
- GitHub Pages がスタブレーンでビルドされ、**インストール無しで触れる URL** になる。
  従来この URL では grasp は必ず失敗していた (静的ホストに BFF はいない)。
- レビュアーが実ソルバでは滅多に出せない状態 (全棄却 / thin / 生成 0 / 502 / 503) へ
  URL 1 本で行ける。決定的なので、スクリーンショットが再現する。

### 払うもの / 残る非対称

- **スタブは嘘をつく。** ランキング・距離・スコアは創作。橙のバッジを常時出して
  `docs/dogfooding/` の記録に混ざるのを防ぐが、バッジは規律であって機構ではない。
- **リーチ範囲が未宣言のまま。** パネルは `plan.reachMin/reachMax` を集めないので
  `reach_max = ∞`、reach 段はほぼ棄却せず `reach_margin` は常に 0。「届くか」を
  問う画面が届かないことのない設定で動いている。今回は範囲を広げない判断をし、
  `docs/dogfooding/ux-scenarios.md` §既知の限界に**名前を付けて**残した。
- **対象幾何はシーンではなく文書由来。** `robot.base` はシーンのワールド姿勢から、
  対象は Layout DSL から解決される。ビューポートでソリッドを動かしても対象は
  動かない。どちらが所有するかは別 ADR の判断。
- **上面 9 点しか宣言できない。** 側面把持・斜面は表現できない。

### 検査 (原則 #19 Q3 — 成果物は文書の行ではなくチェック)

| 主張 | 問い所 |
|------|-------|
| 対象が request に載る / 0・N が状態 | `src/domain/graspTargets.test.js`, `GraspController.test.js` |
| objective 名が `core/` と一致する | `src/context/GraspObjectiveVocabulary.test.js` (母集団は `core/` のソースから導出) |
| スタブが契約に適合し恒等式を保つ | `mocks/graspStub/conformance.test.js` (検証器の**否定対照**込み) |
| スタブが通常ビルドに混入しない | `mocks/graspStub/mocks-excluded-from-build.test.js` (`dist/` を実測。CI の build 後) |
| シナリオが実際に到達できる | `e2e/grasp-stub.spec.js` (7 本。フラグ無しでは skip = 「走らなかった」が見える) |

`mocks-excluded-from-build.test.js` は書いた直後に**実際に落ちた** —
`import.meta.env?.VITE_GRASP_STUB` の optional chaining が Vite の define 置換を
外し、スタブ全体が遅延チャンクとして製品ビルドに載っていた。「フラグの陰だから
tree-shake される」は bundler の挙動についての主張であって、散文で主張してよい
ものではなかった。
