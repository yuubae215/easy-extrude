# 097. 接地を「ジェスチャの副作用」から「実体の状態」へ — 配置方針を型で宣言し、pose の唯一の入口で強制する

- Status: Proposed
- Date: 2026-07-26
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: なし (ADR-071「配置の既定」を*補助*から*不変条件*へ一般化。ADR-032 §6 の mounts 配置規則を包含)

## Context — Goal と力学 (§1.2 Goal)

当事者の観測は 2 項目に分かれて届いたが、根は 1 つである:

> ・キューブは地面より下に行かないのだけれど、ロボットやマップオブジェクトなど、
> キューブ以外は突き抜ける。また、キューブも **Z 拘束すると**なぜか突き抜ける。
> さらに、キューブの Grab は突き抜けても良い前提で設計されているので、すごく動かしづらい。
>
> ・マップオブジェクトは基本的に何か (地面かオブジェクトか) に **on 状態**でしか存在
> できないはずだけど、move 操作 (これも Grab とは違うのか?) で空中に浮いたりなぜかできる。

持ち上げた Goal:

- **G1 — 「何の上に載っているか」はシーンの持続する事実である。** どの入力経路
  (Grab / 軸拘束 / クイックドラッグ / 数値入力 / import / undo / 毎フレームの制約解決) を
  通っても壊れない。
- **G2 — 接地している実体は、接地面に沿って動かせる。** 「地面から離れない」ことと
  「動かしやすい」ことが同じ設計から出る。今は前者の補助が後者を妨害している。
- **G3 — 床下は事故ではなく宣言である。** 基礎・杭・ピットは正当な要求なので禁止は
  しない。ただし「気づいたら潜っていた」と「潜ると決めた」を区別する。

### 力学 — 5 つの症状はすべて「接地が状態ではない」から出ている

| # | 症状 | 実際のコード上の理由 |
|---|------|-------------------|
| 1 | キューブは地面より下に行かない | 不変条件ではなく `GrabOperationHandler._applyStackSnap()` の**補助** (ADR-071)。ジェスチャが終われば何も残らない |
| 2 | Z 拘束すると突き抜ける | `stackApplies = s.stackMode && s.axis !== 'z'` — 軸拘束は「垂直方向の意図」として補助を降ろす設計。降ろした後に床が無い |
| 3 | ロボット・マップオブジェクトは突き抜ける | `_applyStackSnap()` は冒頭 `if (!(grabbed instanceof Solid)) { s.stacking = false; return }`。補助の対象が実体種で切られている |
| 4 | Grab が動かしづらい | 非注釈の自由ドラッグ平面は**カメラ正対面** (`camera.getWorldDirection()`)。接地した実体を接地面に沿って動かしたいのに、平面がカメラの向きで変わる。そこへ stack snap が Z を引き戻すので、入力と結果が二重にねじれる |
| 5 | マップオブジェクトが空中に浮く | Z の**書き手が 2 つ**ある。(a) ドラッグ中: `SceneService._mapObjectPlateDelta()` が `max(屋根, 0)` へ座り直させる。(b) 毎フレーム: `_updateMountedAnnotations()` が `mounts` ホストの pose + local から world 位置を書き戻す。**(b) が後に走るので (b) が勝つ**。ホスト CF が空中にあれば注釈も空中に行く (原則 #4 — 最後の書き込み勝ち) |

そして最も重要な構造的事実:

- **不変条件が散文にしか無い。** `SceneService._isMapObject()` の JSDoc は
  「*the entity family that must stay pinned to the ground plane or a building roof,
  never floating*」と書いているが、これを問う検査はどこにも無い。憲法 Q3 の答えが
  「誰も開かない散文」になっている典型 (原則 #19 / 核 §1.2)。
- **同じ規則が 2 箇所に別実装で書かれている** (§1.1 違反)。`applyPreviewTranslation()` の
  `_isMapObject` 分岐 (Z を捨てて表面へ座り直させる) と、`GrabOperationHandler.start()` の
  ドラッグ平面選択 (mounted → ホスト local XY / unmounted → world XY)。前者は「表面に
  載る」、後者は「掴んだ高さの平面に留まる」で、そもそも**規則が違う**。
- **地面が実体ではない。** `mounts` は SpatialLink なので端点は実体でなければならず、
  「地面の上」は `mounts` で表現できない。ゆえに最も普通のケースが**語彙の外**にあり、
  コードはその穴をジェスチャ局所のヒューリスティックで埋めている。
- **ADR-071 は補助を宣言した ADR であって、不変条件を宣言した ADR ではない。**
  当事者は症状 1 を見て「不変条件だ」と学習し、症状 2/3 で裏切られている。
  無言の失敗 (原則 #11) の変種 — 無言の**非適用**。

### 位置

ドメイン + サービス層。契約 (grasp) には触れない — ただしロボット base の Z が
方針の下で変わりうるので、コアAPI へ送る base pose の**値**は動く。**契約は不動**
(ADR-083 の `robot.base` は既に optional で、形は変わらない)。

## Options considered

- **A: 各経路に clamp を足す (対症)** — tradeoff: 経路の数だけ実装が要る
  (Grab 自由 / Grab 軸拘束 / クイックドラッグ / 数値入力 / stack snap / mounts の毎フレーム
  解決 / import / undo)。今回の 5 症状はまさに「ある経路には足したが別の経路には
  足していない」の結果であり、同じ手を繰り返すと 8 箇所目で同じ苦情が出る。
  原則 #1 (唯一の権威ある入口) の温存。
- **B: 実体種ごとに配置方針を宣言し、pose の唯一の入口で強制 (採用の骨格)** —
  型が能力契約 (原則 #2)。ハンドラは delta を渡すだけで clamp を持たない。
  tradeoff: pose 書き込みの入口を実際に 1 つに絞れているかの棚卸しが要る。
- **C: 地面を一級の実体にし、支持関係を SpatialLink (`restsOn`) として持つ** —
  「on」が既存の語彙で表現でき、LINK NETWORK にも現れる。tradeoff: scene JSON /
  Layout DSL / schema / 移行パスへ波及する版上げ行為。今回の Goal はそこまで要求
  していない (§5 過剰モデリング禁止)。
- **D: 現状維持** — tradeoff: G1〜G3 すべて未達。散文の不変条件が守られないまま残る。

## Decision — Strategy (§1.2 Strategy)

**案 B を骨格に、C から「地面を名指しできる」だけを最小で取り込む。**

### 1. 配置方針を宣言する (原則 #2 / 原則 #31 — 既定値で埋めず宣言させる)

`placement` を実体種の宣言として持つ。値は 3 つ:

| 値 | 意味 | 適用する種 |
|----|------|-----------|
| `supported` | **必ず何かの上**。支持を失う pose は存在できない。Z は支持面から導出され、入力の Z 成分は捨てる | AnnotatedPoint / AnnotatedLine / AnnotatedRegion (マップオブジェクト) |
| `grounded` | 床下へは行けない。ただし `belowGradeIntent` を立てれば行ける | Solid / ImportedMesh / ロボット base CF |
| `free` | 自由。支持の概念を持たない | ユーザー CF / body frame / `tcp` / MeasureLine |

`free` が既定ではない。**種ごとに表で宣言する**のがこの決定の要点で、新しい実体種を
足すときにこの欄を空にできない (原則 #31 — 正当な「支持なし」は推論させず宣言させる)。

### 2. 支持は導出、方針は宣言 (§1.1 — 第二の源を作らない)

`support` を保存フィールドにはしない。幾何が源であり、`supportOf(entity)` は
`highestSurfaceZAt()` の一般化として**毎回導出**する:

```
supportOf(e) → { kind: 'ground' } | { kind: 'entity', id } | null
```

不変条件はこう書ける — **`placement === 'supported'` の実体は、pose 書き込み後に
`supportOf` が必ず非 null を返す**。これは検査可能な形であり、散文の
「never floating」がそのまま述語になる (憲法 Q3 — 成果物は文書の行ではなくチェック)。

`{ kind: 'ground' }` が「地面の上」を**名指しできる**ようにする最小の取り込み (案 C の
一部)。地面を SpatialLink の端点になる実体へ昇格させるのは**本 ADR のスコープ外**
(要件が立てば別 ADR)。

### 3. 強制は pose の唯一の入口で (原則 #1)

`SceneService` の pose 書き込み入口 (`applyPreviewTranslation` とその兄弟) に
方針の適用を集約し、**ハンドラから clamp を取り上げる**。帰結:

- 症状 2 (Z 拘束) — 軸拘束はハンドラの関心であり、方針は入口が持つので抜けない。
- 症状 3 (非 Solid) — 入口は実体種で早期 return せず、方針表を引く。
- `_applyStackSnap()` は「床を作る」責務を失い、**「他の実体の上に載せる」補助**だけに
  縮む (ADR-071 の本来の価値はこちら側)。床は補助ではなく方針が持つ。

### 4. mounts の Z 二重書き込みを解消する (症状 5 の直接の原因)

`mounts` ホストへの追従 (`_updateMountedAnnotations`) と支持面への座り直しが、
同じ Z を毎フレーム奪い合っている。**`placement === 'supported'` の実体では、
mounts はホストの XY 追従だけを担い、Z は常に支持の導出に譲る**と決める
(書き手を 1 つにする — 原則 #4)。ホスト CF が空中にあっても、注釈は
その XY 直下の支持面に座る。

### 5. ドラッグ平面も方針から導く (症状 4 = G2)

自由ドラッグ平面の選択を、実体種の分岐 (現在: 注釈だけ特別扱い) から**方針の関数**へ:

- `supported` / `grounded` → 支持面に平行な平面 (world XY、あるいはホストの local XY)
- `free` → カメラ正対面 (現状のまま)

これで「接地しているものは接地面に沿って滑る」が全種で成立する。注釈が既にやっている
規則を一般化するだけで、新しい概念は増えない (§1.1 — 2 実装を 1 つへ畳む)。

### 6. 床下は宣言にする (G3)

`belowGradeIntent: boolean` を `grounded` 実体の永続状態として持つ。今日の
「Grab 中に S を押して stack assist を切る」はジェスチャ局所で、シーンに何も残らない —
だから次に触ったときにまた潜る/戻るが再現しない。永続化すれば、基礎・杭は
**そう宣言された実体**になり、`checkGroundClearance()` の警告 (ADR-071) は
「宣言していない実体が潜った」ときだけ出る本来の意味を取り戻す。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- **肯定的:**
  - G1 — 接地が入口 1 つの不変条件になるので、経路を増やしても漏れない
    (今回の 5 症状は「経路ごとに実装していた」ことの直接の結果だった)。
  - G2 — ドラッグ平面が方針から出るので、「動かしづらい」の原因である
    「カメラ平面で動かした結果を stack snap が引き戻す」二重のねじれが消える。
  - G3 — 床下が事故と宣言に分かれ、警告が意味を取り戻す。
  - 散文の不変条件 (`_isMapObject` の JSDoc) が述語 + テストになる。
  - `mounts` の Z 二重書き込み (原則 #4 違反) が解消する。
- **受け入れるコスト / 否定的:**
  - 実体が状態を 2 つ増やす (`placement` は生成時決定・不変、`belowGradeIntent` は可変)。
    台帳に行が増える。
  - `supported` の強制は「屋根の上に載せたい」を難しくしうる — 支持の導出が
    `highestSurfaceZAt` の下向きレイに依存するので、壁面・天井・傾斜面は表現できない。
    **本 ADR は水平支持面のみを扱う**と明示的に限定する (垂直面へのマウントは
    要件が立てば別 ADR)。
  - ロボット base を `grounded` にすると、既存シーン (床下に置かれた base を含む
    保存データ) の読み込みで pose が動きうる。import 時の方針適用は
    「読み込んだ値を尊重し、`belowGradeIntent` を立てて受け入れる」側に倒す
    (無言でデータを書き換えない — 原則 #11)。
  - コアAPI へ送る base pose の**値**が動く可能性がある (契約は不動)。
- **検証 (証拠):** 論証木は `docs/gsn/adr-097-support-as-entity-state.gsn`
  (goal ごとの支えの正本はそちら)。起票時点の証拠は**すべて未来形**であり、そう
  宣言している。実装時に閉じる予定の検査:
  - 純粋関数 `resolvePlacement({ placement, belowGradeIntent, support, requestedDelta })`
    の表テスト — 3 方針 × (支持あり / 支持なし) × (Z 成分あり / なし) の全組み合わせ。
  - **経路網羅の個数検査 (原則 #31 の形)**: pose を書きうる入口を*列挙*し、方針を
    適用していない入口が **0 個**であることを検査する。*在るもの* (今日の 2 経路) を
    辿る検査では、次に足された 3 本目の経路を素通りする — これが今回の欠陥の作られ方
    そのものだった。
  - 不変条件テスト: 任意の delta 列を `supported` 実体へ適用した後、
    `supportOf()` が常に非 null。`grounded` かつ `belowGradeIntent === false` の実体は
    常に `lowestZ >= -tolerance`。
  - 症状回帰 (5 本、当事者の報告に 1:1 対応): Z 拘束で床を抜けない / ロボットが床を
    抜けない / マップオブジェクトが床を抜けない / 空中のホストに mounts した注釈が
    支持面に座る / `grounded` 実体の自由ドラッグ平面がカメラ向きに依存しない。
  - 当事者による dogfooding (`docs/dogfooding/`) — 「動かしづらい」は主観なので
    テストでは閉じない。証拠は当事者の記録であり、そう宣言する。
- **波及 (blast radius):** `src/domain/*` (方針の宣言と `belowGradeIntent`)、
  `src/service/SceneService.js` (pose 入口・`supportOf` 導出・`_updateMountedAnnotations`・
  `_mapObjectPlateDelta` の吸収)、`src/controller/handler/GrabOperationHandler.js`
  (clamp とドラッグ平面選択の撤去)、`src/controller/AppController.js` (クイックドラッグ)、
  `src/controller/map/MapModeController.js` (生成時の支持)、`src/service/SceneImporter.js` /
  `src/layout/LayoutCompiler.js` (import 時の方針適用)、`docs/STATE_LEDGER.md` (2 行追加)、
  `docs/STATE_TRANSITIONS.md` (§1.4 の発動判定次第 — 下記)、ADR-071 (補助 → 不変条件へ一般化)。

## Lens notes

- **§1.4 状態機械の発動判定:** `placement` は 3 状態だが**生成時に決まり遷移しない**
  (分類であって lifecycle ではない)。`belowGradeIntent` は 2 状態で自由に遷移する。
  したがって「3 状態以上」は形式的に立つが「不正遷移が事故になる」は立たない。
  ただし**組み合わせ** (`supported` かつ支持なし) は**表現可能な不正状態**なので、
  §1.4 の「make illegal states unrepresentable」が効く: `supported` 実体の pose を
  支持なしで書けない API 形状にする (= 入口 1 つ + 導出) のが本決定そのもの。
  遷移図は起こさず、台帳の行 + 表テストで閉じる。
- **§1.3 グラフ:** 今回の欠陥の blast radius は「pose を書ける入口の集合」であって
  実体種の集合ではない。症状が実体種ごとに現れたのは**入口ごとに実装したから**で、
  種の問題に見えたのは症状の側。レンズを入口集合に当て直したのが案 B。
- **原則 #31 の現れ方:** 「マップオブジェクトは何かの上にしか存在できない」は
  *在るもの*を辿る検査では守れない — 支持が**無い**状態は検査対象のノードを持たない。
  だから検査は「支持を持つべき種を列挙して、支持を持たない個体の**個数**が 0 か」を
  問う形でなければならない。ADR-090 (0 台のロボット) / ADR-093 (N 個の lockstep) と
  同じ構図の 3 例目。
- **原則 #29 との関係:** `placement` はクライアント側の配置規律であって、ワイヤに
  載せる「ソルバが決定した事実」ではない。契約には足さない。

## References

- ADR-071 (配置の既定) — stack assist / below-grade 警告の出どころ。本 ADR は**補助**を**不変条件**へ一般化する (廃止ではない — 「他の実体の上に載せる」補助は残る)
- ADR-032 (Geometric Host Binding, `mounts`) — §6 の注釈配置規則と `_updateMountedAnnotations` の毎フレーム書き戻し。Z の書き手を 1 つにする対象
- ADR-040 (Solid の primary triple) — `move()` が pose の権威 API である根拠
- ADR-090 / ADR-093 — 「列挙して個数を検査する」形の先例 (0 台のロボット / N 個の lockstep)。本 ADR はその 3 例目
- ADR-083 (robot base placement と grasp 契約) — base pose の**値**は動きうるが**契約**は不動であることの根拠
- PHILOSOPHY #1 (唯一の権威ある入口), #2 (型が能力契約), #4 (表示フラグの単一所有者), #11 (無言の失敗の禁止), #31 (基数ゼロ)
