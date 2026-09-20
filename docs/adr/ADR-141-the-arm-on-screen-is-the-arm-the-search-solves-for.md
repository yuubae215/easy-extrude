# 141. 画面の腕と、探索が解く腕は同じ 1 台である — 「どのロボットか」を 1 つのモデル行へ畳む

- Status: Accepted (実装済み — `src/domain/robotModel.js` に出荷モデルの行と、描く URDF から導出する帯。`REACH_PRESETS` の想像上の腕 2 本を退役させ、reach の提示は「シーンに居る腕」1 行へ。宣言の食い違いは画面に出る。examples の宣言は検査が 1 台と突き合わせる)
- Date: 2026-09-20
- Deciders: yuubae215, Claude
- Retires: GREP:src/context/GraspDeclarationCatalog.js::REACH_PRESETS\s*=\s*Object\.freeze · GREP:src/components/Grasp/GraspSearchPanel.jsx::REACH_PRESETS\[0\]
- Supersedes / Superseded by: なし (ADR-127 の「DH は URDF から導出する」を覆さず、**同じ URDF から導出する事実を 1 つ増やす**。ADR-128 の「包絡は既定ではなく宣言」も不変 — 変えるのは*宣言の中身がどこから来るか*であって、宣言が任意であること自体ではない)

## Context — Goal と力学 (§1.2 Goal)

**Goal: ユーザーが見ている腕と、ソルバが解いている腕が、同じ 1 台である。**
違う腕を宣言することは許されてよいが、**違うことが黙っていられない**。

### 力学 1 — 「どの腕か」に著者が 5 人いた

| # | 場所 | 何と言っているか |
|---|---|---|
| 1 | `public/robot/skeleton_arm.urdf` | **UR5e** (DH は公開値そのもの)。画面が描く腕。ADR-127 以降 `robot.kinematics` はここから導出 |
| 2 | `GraspDeclarationCatalog.REACH_PRESETS` | 「small arm (≈0.5)」「medium arm (≈0.85)」「large arm (≈1.3)」の 3 本 |
| 3 | `examples/cell_region_context.json` | `f_robot.attrs.reach = 850 mm` |
| 4 | `examples/cell_robotics_context.json` | 同上 |
| 5 | `templates/bin-picking-thin-container/*.request.json` | `reachMin 0.4 / reachMax 0.95` |

**#2 の 3 本のうち 2 本は、このアプリが一度も出荷したことのない腕である。**
パネルは #2 の先頭を種にするので、UR5e を置いて画面で UR5e を見ながら
「large arm (≈1.3)」を宣言でき、`reach_margin` は**画面の腕より 50 cm 長い腕**に
対して採点される。どこにも失敗の痕跡は残らない。

**問題は値が間違っていることではない。** 850 mm も 0.85 も正しい。問題は
**1 つの事実に著者が複数いる**ことで (§1.1)、だから一方を直しても他方は無傷で残り、
食い違ったことに誰も気づけない。ADR-136 (単位) → ADR-137 (消費点) →
ADR-138 (尺度依存量) と**同じ形の 4 回目**で、今度の軸は「どの機械か」である。

### 力学 2 — 2 つを同じ視野に入れる場所が無かった

`REACH_PRESETS` は `src/context/` に、URDF は `public/` に、DH の導出は
`src/domain/robotKinematics.js` に居る。**どのファイルを開いても、片方しか見えない。**
食い違いは 2 つを同時に見たときだけ見えるのに、そうする場所が repo に存在しなかった。
成果物は文書の行ではなく**検査**でなければならない (核 §1.2 Q3)。

### 力学 3 — 包絡は URDF が述べていない事実である

「この腕はどこまで働けるか」はメーカーがハードウェアで測った数字で、URDF には
書かれていない。したがって**導出しきれない** — ここを無理に計算すると、
「最大到達距離」の定義 (フランジまで? 手首中心まで? 基準は base 原点? 関節軸?) を
勝手に 1 つ選ぶことになり、選んだこと自体が宣言されないまま数字だけが出てくる。

同時に、**放置もできない**。それが今日の姿だからである。

## Options considered

- **A: 包絡を URDF から完全に導出する** (DH から最大到達距離を閉形式で計算)。
  tradeoff: 上記のとおり「どの定義の最大か」を暗黙に選ぶ。UR5e の公称 850 mm は
  `|a2|+|a3| = 817` でも `+d5+d6 = 1017` でもなく、**素朴な導出のどれとも一致しない**
  (実測)。導出値を正とすると、公称値と食い違ったときに「どちらが嘘か」を判定する
  手段が無い。却下。
- **B: プリセットを残し、食い違いを警告するだけ。** tradeoff: 存在しない腕 2 本が
  選択肢として残る。**間違いを選びやすくしたまま注意書きを足す**形で、既定が
  「medium arm」である限り種は catalog のままになる。部分採用 (警告は採る)。
- **C (採用): 包絡は出荷モデル行の DECLARATION。ただし描く URDF から導出した
  帯の中に無ければ build を落とす。提示は「シーンに居る腕」1 行だけにする。**
- **D: 現状維持。** tradeoff: 当事者が「Add で追加できるロボットモデルに統一して
  ほしい」と名指しで報告している。却下。

## Decision — Strategy (§1.2 Strategy)

### D1 — `ROBOT_MODELS` — 出荷する腕 1 行につき 1 エントリ

`src/domain/robotModel.js` (純粋)。行は `{id, label, urdf, reach, reachProvenance}`。
`reachProvenance` を必須にしたのは、**出所の書かれていない包絡は誰かの推測と
区別がつかない**からで、退役する 3 本がまさにそれだった。

未宣言の id で `robotModelById()` は **throw する**。既定で UR5e を返すのは、
元の欠陥そのもの (原則 #31 — `EXPLICIT_DEFAULTS` と同じ手)。

### D2 — 宣言された行、導出された帯

```
band(dh) = [ |a2| + |a3| ,  |a2| + |a3| + d5 + d6 ]
           腕を伸ばし手首を畳んだ span     全部同一直線上に並べた極限

well-formedness:  band.lower ≤ reachMax ≤ band.upper   かつ   reachMin < reachMax
```

描く URDF の DH から帯を導き、**宣言がその中に無ければ build を落とす**。
UR5e の実測: 帯 = [817, 1017] mm、宣言 850 mm。退役する 500 と 1300 は**どちらも
帯の外**である — これが「別の腕だ」の機械的な意味になる。

導出しきれないものを宣言し、**宣言をそれ自身のループの外側にある何かへ縛る**のは
ADR-127 が `FLANGE_APPROACH_AXIS` でした判断と同じ形。自己整合的な間違いは
往復テストを必ず通るので、外側の何かが要る。

### D3 — `core/` の境界を越えない

この module は**到達可否を一度も判定しない**。答えるのは「この腕はどれだけ長いか」
だけで、腕自身の幾何から読み、どの対象も判定しない。ある把持点が包絡の内側かは
**reach solving** であり、従来どおり契約の向こうの `core/` に留まる
(CLAUDE.md の層規律 — フロントは宣言し、バックエンドが解く)。

### D4 — 提示は「シーンに居る腕」1 行

`REACH_PRESETS` (固定 3 行) → `reachPresetsFor(envelope, label)` (**渡された包絡から
作る 0 行 or 1 行**)。包絡は `robotSkeleton.js` が**描いている URDF から**導出し
(`ROBOT_REACH_ENVELOPE` = 1 つの URDF の 4 人目の消費者)、`ROBOT_KINEMATICS` と
同じ注入路で `GraspController` → `context.robots.model` → パネルへ届く。

ロボットが 0 台なら model は `null`、行は 0 本、種は無い。**置かれていないロボットの
包絡を提示するのは、ADR-120 が禁じる「発明された既定」そのもの**なので、
ここで 0 行を返すことが正しい答えである。

### D5 — 違う腕を宣言することは許す。ただし画面に出す

モデル化したいハードウェアが別にあることはありうるので、数値の手編集は**塞がない**
(Run も止めない — gap ではない)。しかし編集した瞬間に、シーンの腕との食い違いが
カードに出る (原則 #11 — 無言の no-op を禁じる)。

種の自動投入は `touched` フラグで止める: **空欄と「ユーザーが意図した 0.5」は
違う状態**であり (原則 #31)、埋めてよいのは前者だけ。宣言を黙って書き戻すのは、
そもそも 2 つの腕が食い違った原因と同じ操作である。

### D6 — examples が語る腕を検査が 1 台と突き合わせる

`src/RobotModelAgreement.test.js`。`examples/*.json` を走査して `attrs.reach` を
**語っているものを全部拾い**、出荷モデルと突き合わせる。単位は宣言必須 (単位の無い
数は比較できない — 既定で埋めない)。

**`templates/` は対象外**であることを**宣言して数える**: CLAUDE.md が明示的に
分けているとおり、あれはフロントの examples ではなくバックエンドレイヤ付属の受け入れ
フィクスチャ (`core/tests/test_templates.py` が消費) で、`0.4 / 0.95` は
ソルバを特定の包絡で試すための**意図的に別の腕**である。宣言の無い不一致は
「誰も考えなかった不一致」と区別がつかない (原則 #29)。

### 状態・基数

状態は増えない。**基数の行を起こす** (`docs/STATE_LEDGER.md`):

| 実体 | 基数 | 0 のとき |
|---|---|---|
| 出荷ロボットモデル | **ちょうど 1** | — (0 なら Add が何も挿せない) |
| シーンが提示する reach 包絡 | **0 or 1** | ロボット 0 台 → 行 0 本 → 包絡は未宣言のまま |

`SHIPPED_ROBOT_MODEL_ID` が定数でいられるのは出荷モデルの基数が 1 だからで、
**2 つ目が入った瞬間に検査が落ちて**「model はロースタではなくロボット実体の属性へ」
という判断を強制する。基数が 1 から N へ動くことは状態であり、状態に見えない。

## Consequences — Evidence と tradeoff

### 得られるもの

- 画面の腕・ソルバに渡す DH・包絡の 3 つが**同じ URDF の消費者**になった。
- 存在しない腕 2 本が選択肢から消えた (`RETIRED_REACH_PRESETS` が個数を持つ)。
- 「違う腕を宣言した」が可視になった (以前は無言)。
- URDF を UR10e へ差し替えると **build が落ちる** — 以前は静かに 2 台の腕になった。

### 払うもの / 受け入れるコスト

- **`reachProvenance` は人が書く文字列**で、正しさを機械は問えない (長さだけ問う)。
  出所の宣言が嘘であることは検出できない — 宣言しないよりましだが、過大評価しない。
- **帯は素朴**である。`|a2|+|a3|` 〜 `+d5+d6` は UR 型の直列 6 軸を前提にしていて、
  ADR-127 の構造検査を通った chain にしか意味が無い。7 軸や分岐のある chain では
  `kinematics` 自体が `null` になり、包絡も提示されない (安全側に倒れる)。
- **`core/` は包絡を再導出しない。** 契約はこれまでどおり `plan{}` を受け取るだけで、
  「送られてきた包絡が `kinematics` と整合するか」をバックエンドは問わない。
  front で閉じた不変条件であり、**ワイヤを跨ぐと保証が切れる**ことを宣言しておく
  (契約を変える = 版上げなので、今回は意図的にしない)。
- `templates/` の別の腕は残る (宣言された除外)。

### 検証 (証拠)

| 主張 | 問い所 | 実測 |
|---|---|---|
| 宣言された包絡が**描く URDF** に合う | `src/domain/robotModel.test.js` | 12 / 12 green。帯 = [817, 1017] mm、宣言 850 mm |
| 未宣言の model id で throw | 同上 | green |
| 退役した 2 本が model として戻っていない | 同上 | green |
| 帯の外の包絡が「別のロボット」と報告される | 同上 | 0.5 / 1.3 の両方で green |
| 比較するものが無いときに警告を捏造しない | 同上 | green |
| examples が語る腕が出荷モデルと同じ | `src/RobotModelAgreement.test.js` | 4 / 4 green (2 件の 850 mm 宣言) |
| 出荷モデルの基数が 1 | 同上 | green |

**検査が噛むことを実測した。** `examples/cell_region_context.json` の reach を
1300 mm に書き換えると `RobotModelAgreement` が fail し、戻すと green に戻る。

**この証拠が構造的に見逃す変化 (宣言):** 帯の検査は `reachMax` **しか**縛っていない
— `reachMin` と `wristConeHalfAngle` は「min < max」「> 0」以上の根拠を持たず、
0.2 と 1.05 は実質的に宣言されただけの数である (`reachProvenance` はデータシートの
到達半径だけを指しており、この 2 つを指していない)。また、パネルの食い違い警告は
**数値が違うこと**しか見ておらず、「同じ数値だが別の腕」(例: 偶然 850 mm の別機種)
は通る。GSN 木に `support-exploring` として登録した。

### 波及 (blast radius)

- 触った: `src/domain/robotModel.js` (新設) · `src/view/robotSkeleton.js`
  (包絡とラベルを導出) · `src/controller/AppController.js` (注入 1 箇所) ·
  `src/controller/GraspController.js` (ロースタに `model` を載せる) ·
  `src/store/uiStore.js` (read-model の形) · `src/context/GraspDeclarationCatalog.js`
  (`REACH_PRESETS` → `reachPresetsFor`) · `src/components/Grasp/GraspSearchPanel.jsx`。
- **触らないと宣言するもの**: `packages/grasp-contract` と `contractVersion` (**不変
  6** — ワイヤの形も意味も変えていない) · `core/` · `templates/` (宣言された除外) ·
  `public/robot/skeleton_arm.urdf` 自身 · ADR-127 の DH 導出 · ADR-128 の
  「包絡は任意の宣言」· `f_robot.attrs.reach` の値 (既に 850 で一致していたので
  **変更ではなく固定**した)。
- 越境なし: 到達可否の判定は `core/` のまま。front は腕の長さを宣言するだけ。

## Lens notes

**§1.1 の 3 スケールのうち「データ」:** この ADR は新しい層も契約も足していない。
足したのは**同じ事実の権威を 1 つに決めたこと**だけで、残り 4 人の著者は
読み手 (derived) か、宣言された除外になった。

**ADR-136 → 137 → 138 → 141 の系列:** 4 回とも「1 つの事実に複数の著者がいる」形で、
4 回目にして初めて軸が*量*ではなく**同一性**になった (どの機械か)。ADR-138 が
「尺度依存量は自分の単位を名乗る」と決めたのと同じ規律を、「ロボット諸元は自分の
機体を名乗る」へ当てている。原則は足していない — #31 と §1.1 の適用例であり、
成果物は文書の行ではなく 2 本の検査である。
