# 118. ハンドは種別であり、掴む面はハンドに従う — 吸引を一級にし、near-miss の量を名乗らせる

- Status: Accepted (実装済み 2026-08-11 — 契約 v5 / core の吸引ゲート / 面サンプリングの kind 従属 / フロントの種別宣言。**実装で 2 件踏んだ**: 吸引ゲートの初版はカップが面からはみ出しても「完全にシール」と報告し、スタブは grasp 以外のレーンまで BFF を名乗っていた)
- Date: 2026-08-11
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし (ADR-081 の把持ゲートを kind 化、ADR-060 の統治を request 側へ適用、ADR-117 の面サンプリングを是正)

## Context

要件は 1 行だった: **「grasp の意味にエア吸引ハンドの想定も入れてください。ひとまず、チャックと吸引ぐらいで良いです」**。

契約を見ると、`gripper` は閉じたオブジェクトで `required: ["maxOpening"]`、説明文も
"parallel-jaw gripper" と名乗っていた。平行ジョーが**型として焼き込まれていた**。

### 力学 (1) — 二つのハンドは測る量が違う

|  | チャック | 吸引 |
|---|---|---|
| 幾何ゲート | 対向面の距離 ≤ 開口幅 | 接触点まわりにカップ径ぶんの**連続した平坦パッチ**が在るか |
| 進入方向 | 閉じ軸に直交していればよい | **法線にほぼ沿う**必要がある (傾くとシールが切れる) |
| 落ちる理由 | 開かない・指が入らない | 曲率・段差・面の縁でシールしない |

`max_opening` と `cup_diameter` を同じ平らなオブジェクトに同居させると
「開口 0 の吸引ハンド」という**表現不能にすべき状態が表現できてしまう**。

### 力学 (2) — 応答側の near-miss は名前が平行ジョー専用だった

`openingNearestMiss` は **閉じた層** (`additionalProperties: false`) の **required**
フィールドで、説明文は「required width minus the gripper's max opening」。吸引の
シールパッチ不足をこの欄で報告すると、クライアントは**名前が嘘をついている量で
メーターを描く**。generalise するには名前ごと変えるしかなく、それは版上げ行為。

### 力学 (3) — ADR-117 の面サンプリングは片方のハンドにしか正しくなかった

ADR-117 は対象の上面 3×3 グリッドを `target.surfaceSamples` に載せた。`core/` の
平行ジョーゲートは **対象幅をサンプルの閉じ軸射影の広がりとして測る**。縁から内側へ
インセットした 3×3 は `d/2` しか張らないので、幅 300 mm の箱は **150 mm** として
評価され、**閉じられないハンドが通っていた** (ちょうど 2 倍楽観的)。しかも平行ジョーが
実際に閉じるのは側面同士なのに、側面は 1 点もサンプルされていなかった。

吸引にとっては上面こそが正しい面である。つまり欠陥は「サンプリングが雑」ではなく
**ハンドの種別を言わずに片方だけを想定していた**こと。

## Decision

### D1 — `gripper` を kind 判別の有界 union にする (request)

`{ kind: "parallelJaw", maxOpening, fingerClearance? }` /
`{ kind: "suction", cupDiameter, sealTiltTolerance? }`。各枝は閉じたまま、成長点は
**kind を 1 つ足すこと**だけ。ADR-060 が response の `pose` に与えた統治を request 側へ
そのまま適用する。

`kind` は **required**。「optional 追加は版上げ不要」の先例 (ADR-083/084) は
*追加*の話であって、既定へ倒せる欄を作ってよいという意味ではない。未宣言の kind を
平行ジョーへ倒すと「吸引を宣言したのに幅で判定される」— 応答が正しい形をしているぶん
最も気づきにくい嘘になる (原則 #31)。in-repo のフィクスチャは同一 PR で更新した。

### D2 — `openingNearestMiss` を `graspNearestMiss` (kind 判別) へ置換、**版を上げる**

`{ kind: "opening" | "sealPatch", shortfall }` の union か `null`。閉じた層の必須
フィールドの置換なので **contractVersion 4 → 5**。

段階案 (吸引では `null` を返して版を据え置く) も検討したが却下した: 「あと何ミリ」
メーターがチャックには在り吸引には無い、という差が**理由なしに**生まれる。原則 #11 は
無言の欠落を禁じており、ここでは欠落そのものが仕様になってしまう。

### D3 — 掴む面は kind から引く (`FACES_BY_GRIPPER_KIND`)

ジョーは対向する 2 側面、吸引は上面。**未宣言の kind では throw** する — 既定へ倒すと
「触れもしない面のサンプルで把持ゲートが判定される」という力学 (3) をそのまま再生産する。
これで幅 300 mm の箱は 300 mm として測られる。

### D4 — `core/` に naive 吸引ゲートを置く

`NaiveSuctionGraspChecker`: カップ footprint 内のサンプルの法線が接触法線から
`seal_tilt_tolerance` 以内に収まる範囲をパッチとし、不足量 = カップ径 − パッチ径。
**既存の `surfaceSamples` 表現で計算できる** ので、対象側の契約は 1 文字も変えていない。

チェッカ選択は `_CHECKER_BY_KIND` / `checker_for()` の 1 箇所。パイプラインの
「既定は平行ジョー」も**外した** — 固定すると宣言と判定が食い違ったまま緑になる。

## Consequences

### 得られたもの

- 吸引ハンドが一級の宣言になり、判定も near-miss も**自分の量で**報告される。
- ADR-117 が仕込んだ 2 倍楽観的な把持ゲートが消えた。これは表現力の話ではなく**正しさ**の話だった。
- 「未宣言の種別で throw する表」が 4 つ増えた (`_CHECKER_BY_KIND` / `_MISS_KIND_BY_GRIPPER` /
  `FACES_BY_GRIPPER_KIND` / `GRIPPER_PRESETS_BY_KIND`)。どれも既定を持たない。

### 払うもの

- **request 側の破壊的変更。** `kind` 必須なので既存の呼び出しは全部落ちる。in-repo に
  閉じているので同一 PR で直せたが、外部の呼び手がいれば移行が要る。
- 吸引ゲートは**サンプル密度に依存する**。面が連続でもサンプルが疎ならパッチを過小評価する。
  点サンプル表現そのものの限界で、密度は宣言側の責任になる。
- `grasp_stability` (進入ベクトルと法線の内積) は**吸引にとってはほぼ正しく、チャックには
  弱い代理**のまま。objective の意味が既に種別依存だったことが露出しただけで、ここでは直していない。

### 実装で変わったこと (俯瞰との食い違いを残す — 原則 #19)

1. **吸引ゲートの初版が間違っていた。** 「footprint 内に法線の外れたサンプルが無ければ
   シール成功」としたので、小さな平面に巨大なカップを当てても不足量 0 を返した。パッチは
   *平坦でないサンプル*だけでなく**面がそこで終わること**でも切れる。テストが先に落ちた。
2. **スタブが grasp 以外まで BFF を名乗っていた。** `/auth/token` に答えるだけで
   `bffConnected` が真になり、WebSocket ジオメトリチャネルと Node Editor の配線まで進んで
   いた。スタブレーンを有効にして**全 e2e を通したとき初めて**露見した (無関係な smoke 3 本が
   落ち、フラグ無しでは通る)。`_initBff` をそこで止めて、スタブの主張を実装の広さに揃えた。
   ADR-117 でスタブを入れたときは grasp の 7 本しか流していなかったので見えなかった。

### 台帳 (`docs/STATE_LEDGER.md`)

**ハンドの種別** の行を追加 — `parallelJaw` / `suction` / 欄ごと不在 (3)、基数は
リクエスト 1 つにつき `0..1`、0 = 把持段が空位として真 (既存の vacuous gate と同じ)。
遷移を持たない値の種別なので `STATE_TRANSITIONS.md` には節を起こさない。

### 検証 (証拠)

| 主張 | 問い所 |
|------|-------|
| 未宣言の kind は既定へ倒れず throw する | `core/tests/test_engine.py` (adapter) · `src/context/GraspDeclarationCatalog.test.js` (presets / gaps) · `graspTargets` の面表 |
| 吸引は幅ではなくパッチを測る | `core/tests/test_engine.py::test_suction_seals_on_a_flat_patch_and_misses_on_a_small_one` |
| near-miss が種別つきで載る | `core/tests/test_engine.py` (opening / sealPatch) · `mocks/graspStub/conformance.test.js` |
| 面サンプリングが幅を正しく張る | `src/domain/graspTargets.test.js` |
| 契約が両側で一致し版が上がっている | `pnpm test:contract` · `core/tests/test_contract_conformance.py` · CI `contract-wall` |

論証木: `docs/gsn/adr-118-a-hand-is-a-kind.gsn`
