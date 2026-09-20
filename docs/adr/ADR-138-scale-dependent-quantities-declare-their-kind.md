# 138. 尺度に依存する量は三種のいずれかを名乗る — 宣言されていない量の個数を、コードの側で数える

- Status: Accepted (実装済み 2026-09-20)
- Date: 2026-09-19 (起票) / 2026-09-20 (ADR-137 との衝突を受けて改稿)
- Deciders: yuubae215, Claude
- Retires: GREP:src/controller/handler/FaceExtrudeHandler.js::SNAP_THRESHOLD\s*=\s*0\.15 · GREP:src/domain/placement.js::SUPPORT_TOLERANCE\s*=\s*0\.001 · GREP:src/service/SceneService.js::tolerance\s*=\s*0\.001 · GREP:src/view/SceneView.js::GridHelper\(20,\s*20
- Supersedes / Superseded by: なし。**ADR-137 の後続**であり、その決定を覆さない —
  ADR-137 が「起動画面もフレーミングの入口」として*消費点*を数え直したのに対し、
  本 ADR は **残った消費点を三種の語彙で名乗らせ、名乗っていない量の個数をコードの
  側で数える機械**を置く。ADR-136 の 4 (5) 変換点も不変。

## Context — Goal と力学

本 ADR は **ADR-137 と並行に、別セッションで書かれた**。同じ実測 (起動直後の既定
シーンが画面から消える) から出発し、ADR-137 が先に main へ入った。**Context の大半は
ADR-137 に書かれているのでここには複製しない** (核 §1.1) — 読む順は ADR-136 →
ADR-137 → 本 ADR。

ADR-137 が閉じたのは **boot の framing と、そこに連なる消費点** (`_restStarterCube` の
`multiplyScalar(0.5)`・`SceneView` のカメラ pose と far 平面・`GraspGhostView` の
`GLYPH_MIN_WORLD`)。実測すると、**同じ形の消費点が 3 つ、main に残っている**:

| 番地 | 書かれている意図 | 実際の意味 (world-unit = mm) |
|------|-----------------|---------------------------|
| `src/domain/placement.js` | 「接地判定の許容 (**1 mm**)」 | `0.001` = **1 µm** |
| `src/service/SceneService.js` | 「**1 mm** — matches the stack-snap rest tolerance」 | `0.001` = 1 µm、しかも**同じ事実の 2 枚目の写し** (§1.1) |
| `src/controller/handler/FaceExtrudeHandler.js` | 「Snap distance threshold in **world units**」 | `0.15` = 0.15 mm = 面押し出しスナップが事実上無効 |

3 つとも**コメントが「1 mm」と書いているのに値がメートル読み**である。つまり
「単位を間違えた」のではなく、**単位を名乗る欄が無いので、書いた本人の理解が
コメントにしか残らなかった**。

### なぜ「消費点を数え直す」だけでは足りないか

ADR-137 は消費点を*人が*数え直して 3 つ直した。本 ADR が残っている 3 つを見つけられた
のは、**別セッションが独立に同じ repo を読んだから**であって、仕組みではない。
並行作業という偶然が無ければ、この 3 つは今日も緑のまま残っていた。

数え直しは 1 回きりの行為であり、**次に world-unit を持つ定数を書いた人には届かない**。
必要なのは数え直しではなく、**書く瞬間に問う機械**である (核 §1.2 Q3)。

**Goal (解ではなく性質): 尺度に依存する量が、自分の単位と根拠を自分で名乗る。そして
「名乗っていない量の個数」が、人の数え直しではなく毎 PR の検査で数えられる。**

## Options considered

- **A: 見つけた 3 つを直して終わり (ADR-137 の続きとして実装だけ)。**
  tradeoff: 今日の 3 つは直る。母集団は依然として人の記憶で、次の消費点は次の偶然を
  待つことになる — **ADR-136 → ADR-137 → 本 ADR と 3 回続いた形そのもの**。却下。
- **B: world 座標を型で持つ** (branded type)。
  tradeoff: 最も強いが `THREE.Vector3` 全域に及び、この repo は ingress の大半が
  `@ts-nocheck`。今日の問題 (数えられないこと) に対して過大 (核 §5)。**単位だけを
  ブランドしても利き手・up 軸は捕まらない**ことが後に分かり、別 ADR (ADR-139) へ。
- **C (採用): 尺度依存量の種を 3 つに閉じ、第四の種 (裸の定数) の個数を数える。**
- **D: 現状維持。** 3 つの消費点が壊れたまま。却下。

## Decision — Strategy

### D1 — 尺度依存量は三種のいずれかとして宣言する。第四の種は無い

| 種 | 何に比例するか | 書き方 | 先例 |
|----|---------------|--------|------|
| **画面空間** | 画面 px (シーン尺度に不変) | `*_PX` | `SnapSystem.SNAP_PX` / `GrabOperationHandler.SNAP_PX` |
| **シーン由来** | シーンの bounding radius | radius を引数に取る関数 | `focusPose` / `clipPlanesFor` / `_updateGridScale` / `setWorldCap` |
| **宣言された物理長** | 実世界の長さ | `mm(…)` または `MM_PER_METER * k` | `BOOT_VIEW_RADIUS` (ADR-137) / `SUPPORT_TOLERANCE` (本 ADR) |

**ADR-137 が採った `MM_PER_METER * k` も「宣言された物理長」である** — メートルを
名乗っているので三種の中に在る。本 ADR は `mm(n)` を足すが、**ADR-137 の定数を
書き換えない**: どちらも単位を名乗っており、語彙を 1 つに畳む価値より、他人の決定を
後から書き換えるコストのほうが高い (並行実装の衝突を、片方の idiom で塗り潰さない)。
ただし **2 つの綴りが在ることは宣言しておく** — 黙って 2 つ在ると、次の人はどちらが
正かを推論することになる (§1.1)。

### D2 — `mm(n)` は変換ではなく宣言

`src/domain/worldUnits.js` に `mm(n)` を足す。`mm(1)` は `1` であり、変換は何もしない。
足すのは**単位が呼び出し側の構文に乗る**ことで、次に書く人が単位を選ばずに済まない。
ADR-136 の `mmToM`/`mToMM` は**境界での変換**、`mm()` は**その場の宣言** — 役割が違う
(同じモジュールに置くのは単位の権威が一つだから)。

### D3 — 残った 3 つの消費点を三種へ寄せる

- `SUPPORT_TOLERANCE = mm(1)` — コメントが元から言っていた物理量をそのまま宣言する。
- `checkGroundClearance(tolerance = SUPPORT_TOLERANCE)` — **写しをやめて定数を引く**。
  doc は既に「matches the stack-snap rest tolerance」と書いていたのに数値は写しで、
  片方だけが ADR-136 で再検討されなかったのが 1 µm 化の経路そのもの (§1.1)。
- `SNAP_THRESHOLD = mm(15)` — 「既定オブジェクトの 15%」を保存する。絶対 0.15 m 読みは
  既定キューブ (100mm) より大きい snap になり、その読み自体シーン内容には一度も
  成り立っていなかった (Layout DSL は元から mm)。

### D3′ — census の初回実行が、ADR-137 の取りこぼしを 2 件出した (実測)

本 ADR を main へ合流させた直後、`WorldUnitCensus` を ADR-137 のコードに当てた**初回の
実行**が 2 件を報告した:

- `SceneView` の `new THREE.PerspectiveCamera(60, aspect, 0.1, 100)` — ADR-137 は
  カメラ *pose* を方向のみに変えたが、この clip 対は残り、**散文で「placeholder」と
  宣言されていた**。真ではあるが、最初の frame-the-scene 呼び出しまでは 0.1mm / 100mm を
  意味する裸のメートル時代のリテラルである。
- `new THREE.GridHelper(20, 20, …)` — 地面グリッドの基底幅。

どちらも **ADR-137 の「消費点を数え直す」が人の手だったために残った**。数え直しは
1 回きりの行為で、次の人には届かない — これが D4 を文書でも実装でもなく*検査*に
置く理由の、実測による裏づけである (核 §1.2 Q3)。

直し方は **ADR-137 自身の語彙で**行った: clip 対は彼らの `BOOT_VIEW_RADIUS` を
彼らの `clipPlanesFor` に通して導出し、grid は `GRID_BASE_SPAN = mm(20)` として宣言する。
他人の決定を別の idiom で塗り潰さず、その決定を**完成させる**。

### D4 — 数えるのは「三種のどれでもない量の個数」。母集団は sink の構文から導出する

*在る定数*を辿ると、定義上「宣言されていない定数」は出てこない (原則 #31)。辿るのは
**消費点 (sink)** のほうで、そこに**リテラルが直接届いている箇所**を数える:
`camera.near`/`camera.far` への代入 · `camera.position.set` · `new THREE.GridHelper` ·
`fitCameraToSphere` の radius 実引数 · world 座標と比較される閾値。

`src/WorldUnitCensus.test.js` に置き、baseline **0**。`src/census/sources.js` を引く
census 形なので `src/CensusCoverage.test.js` の登録簿に載る (ADR-102)。

**ADR-137 の e2e (`robot-scale-parity.spec.js`) との関係**: あちらは *実行時*に
「シーンに在るのに画面に無い実体の個数」を数える。こちらは *ソース*に
「単位を名乗らないリテラルの個数」を数える。**症状と原因で、同じものを二度数えて
いない**。起票時に書いた `e2e/boot-framing.spec.js` は ADR-137 の e2e と同じ症状を
測っていたので**破棄した** — あちらのほうが形が正しい (比率の帯ではなく**個数**を
数えており、原則 #31 に沿う)。

### 状態・基数

この決定は実体の状態も基数も増やさないので、`docs/STATE_LEDGER.md` に新しい行は
起きない。**宣言であって既定ではない** (原則 #31) — 数える対象は実体ではなく定数で、
累積器は台帳ではなく D4 の census。

## Consequences — Evidence と tradeoff

### 得られるもの
- ADR-137 が届かなかった 3 つの消費点が直る (接地判定 1 µm / 面押し出しスナップの無効化)。
- 次に world-unit を持つ量を書いた人が、**書く瞬間に**問われる — 数え直しが要らなくなる。
- ADR-136 → 137 → 138 と 3 回続いた「後から数え直す」連鎖が、ここで機械に変わる。

### 払うもの / 受け入れるコスト
- **宣言の綴りが 2 つある** (`mm(n)` と `MM_PER_METER * k`)。並行実装の衝突を片方で
  塗り潰さない選択の代償で、上に明示的に宣言した。
- **限界 (推論させない)**: D4 の母集団は sink の**手書き列挙**であり、新しい種類の
  world 空間 API はこの表に登録されるまで見えない — ADR-102 の `place-list` が
  一段上に残る。導出へ広げるには「world 座標とは何か」を型で持つ必要があり、
  それは却下案 B (→ ADR-139 が別の理由で扱う)。**この限界が耐えられなくなった日が
  トリガである。**

### 検証(証拠)

| 主張 | 問い所 | 結果 |
|------|-------|------|
| 三種のどれでもない量が 0 個 | `src/WorldUnitCensus.test.js` (ratchet baseline 0) | green |
| 退役した形が src/** に無い | 同上 `RETIRED` 表 (ADR-103 — 退役の腐敗は緑を出す) | green |
| 接地許容が 1 mm である | `src/domain/placement.test.js` (fixture をメートル読みから mm へ訂正) | green |
| ADR-137 の boot framing を壊していない | `e2e/robot-scale-parity.spec.js` (main 由来、無改訂) | green |

**検査が噛むことを実測した** (落ちない検査は不在と同じ — ADR-115):
`camera.near = 0.1` / `camera.far = 100` を再注入すると census が 2 箇所を報告して fail。

### 波及(blast radius)

触った: `src/domain/worldUnits.js` (D2) · `src/domain/placement.js` ·
`src/service/SceneService.js` · `src/controller/handler/FaceExtrudeHandler.js` ·
`src/view/CameraMath.js` (`NEAR_FLOOR` を `mm()` で宣言) · 新設
`src/WorldUnitCensus.test.js` · `src/CensusCoverage.test.js` (登録)。

**触らなかったと宣言するもの**: **ADR-137 が入れた boot framing の実装一式**
(`SceneView` のカメラ seed · `AppController._frameScene` · `CuboidModel` の
`DEFAULT_HALF_EXTENT` export · `GraspGhostView` · `RobotStage`/`RobotStageSet` ·
`e2e/robot-scale-parity.spec.js`) — 起票時に書いた自分の実装は**破棄して main のものを
採った** · `packages/grasp-contract` · `core/` · ADR-136 の変換点。

## Lens notes

**同じ形が 3 回続いたことの意味:** ADR-136 は変換点を数え、ADR-137 は消費点を数え直し、
本 ADR は残りを見つけた。3 回とも「人が数え直す」で解いており、3 回目は**並行作業という
偶然**が見つけた。数え直しが要る設計は、数え直す人が居るあいだだけ正しい —
だから成果物を文書でも実装でもなく **検査** に置く (核 §1.2 Q3)。

**並行実装の衝突そのものについて:** 同じ欠陥を 2 セッションが独立に直し、ADR 番号まで
衝突した (双方 137)。main に先に入ったほうを正とし、こちらを 138 へ改番して**後続**に
書き直した。破棄したのは実装と e2e で、**残したのは相手が持っていなかったもの**だけ
である。並行して同じ所を触ったとき、良いほうを採るのではなく **先に入ったほうを土台に
差分を足す** ほうが履歴が読める (相手の決定を後から塗り潰さない)。
