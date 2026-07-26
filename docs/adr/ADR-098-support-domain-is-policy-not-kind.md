# 098. 「何の上に載れるか」を種から方針へ — stack assist の型ゲートを外し、支持プローブを方針表の隣で宣言する

- Status: Accepted (実装済み — `stackAssistApplies()` + `SUPPORT_PROBE_BY_KIND` の宣言、種の門 2 枚の撤去、プローブ 4 メソッドの `instanceof` 撤去、種分岐の個数検査、差分ペアの e2e 3 本)
- Date: 2026-07-26
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: なし (ADR-097 が剥がし残した半分を引き継ぐ。ADR-071 の補助はここで種から解放される)

## Context — Goal と力学 (§1.2 Goal)

当事者の観測:

> ・キューブはスタックするのに、ロボットはスタックしない。
> 片方向は有効なのに、もう片方向は有効でないのは違和感があります。SSOT が
> 上手く設計できていないかもしれません。

持ち上げた Goal:

- **G1 — 「この実体は何の上に載れるか」は配置方針の帰結であり、実体種の性質ではない。**
  種を足したときに「載る/載らない」が黙って分岐しない。
- **G2 — `grounded` という 1 語が、種によって違う意味を持たない** (ubiquitous
  language — 核 §1.1 DDD)。
- **G3 — 支持を *問える* 実体は、支持へ *座らせられる*。** 問いと適用の適用範囲が
  一致する。

### 力学 — ADR-097 は門を半分だけ壊した

ADR-097 は `_applyStackSnap()` から「**床を作る**」責務を剥がし、方針表
(`PLACEMENT_BY_KIND`) と pose の唯一の入口へ移した。残った補助は
`SceneService._applyStackAssist()` に改名して残っている — が、**種の門はそのまま
残っている**:

```js
_applyStackAssist(segStartCorners, segStartPositions, worldDelta, activeId, movingIds) {
  const grabbed = activeId ? this._model.getObject(activeId) : null
  if (!(grabbed instanceof Solid)) return null      // ← ADR-097 が数え上げた症状 3 と同じ形
  …
  for (const id of movingIds) {
    const selObj = this._model.getObject(id)
    if (!(selObj instanceof Solid)) continue        // ← 同じ門がもう 1 枚
```

帰結として、方針表の `grounded` は**種によって 2 つの異なる意味を持っている**:

| 種 | 宣言 | 実際に効いている規則 |
|----|------|-------------------|
| Solid / ImportedMesh | `grounded` | 床を割らない **かつ** 直下の面に載る |
| robot_base CF | `grounded` | 床を割らない **だけ** |

当事者が見ている「キューブはスタックするのにロボットはスタックしない」は、
方針の差ではなく**同じ方針語の下に別々の実装が残っている**ことの現れである。
これは ADR-097 が「症状が実体種ごとに現れたのは入口ごとに実装したからで、種の
問題ではない」と書いた、その主張の残り半分にあたる。

### 決定的な非対称 — 問いは既に一般化されている

支持を *問う* 側は、実装済みかつ全種で動く:

| 関数 | 種の扱い |
|------|---------|
| `SceneService.supportOf(entityId)` | 全種。`{kind:'ground'} \| {kind:'entity', id} \| null` |
| `_footprintSamplesOf(obj)` | CF は world 位置 1 点、それ以外は corners + 重心 |
| `_bottomZOf(obj)` | CF は world Z、それ以外は corners の最小 Z |

つまり **robot_base が「何の上に居るか」はすでに答えられる**。座らせる経路
(`_applyStackAssist`) だけが `instanceof Solid` で閉じている。*問いの適用範囲*と
*答えの適用範囲*がズレているのが欠陥の形であって、幾何の困難ではない。

もう一つの構造的事実 — **種の分岐が方針表の外にもう 1 組ある**。ADR-097 は
「`instanceof` の連鎖が在ってよい唯一の場所は `placementKindOf()`」と決め、
`PosePolicyOwnership.test.js` がそれを守っている。ところが `_footprintSamplesOf` /
`_bottomZOf` は `instanceof CoordinateFrame` で分岐しており、この 2 つは方針表と
**同じ問い (この種の底はどこか) に別々の場所で答えている** (§1.1 の第二の源)。
種を足したとき、方針表は throw して気づかせるが、プローブは黙って
`corners = []` → `null` を返して「支持なし」に見せる (原則 #31 — 不在は検査対象の
ノードを持たない)。

### 範囲の限界 (宣言しておく)

`highestSurfaceAt()` は**可視の cuboid メッシュ**へ下向きレイを撃つ。ゆえに:

- ロボットのスケルトンは支持面ではない (ロボットの上に物は載らない)。
- 非表示の実体は支持面ではない (ADR-096 の explicit 軸で消した実体は消える)。
- 水平面のみ (ADR-097 から継承)。

これらは本 ADR で**変えない**。変えないことをここに書くのは、次に
「ロボットのアーム上に載せたい」が来たときにこの行が引かれるためである。

### 位置

ドメイン (`src/domain/placement.js`) + サービス (`SceneService`)。契約・コアAPI には
触れない。ただしロボット base の Z が変わりうるので、送出する base pose の**値**は
動く (ADR-097 と同じ扱い — 契約は不動)。

## Options considered

- **A: `_applyStackAssist` の `instanceof Solid` を削除するだけ** — tradeoff: 最小で
  症状は消えるが、`_footprintSamplesOf` / `_bottomZOf` の種分岐が方針表の外に残る。
  次の実体種で同じ苦情が別の形で出る (今回がまさに ADR-097 の「残り半分」だった)。
- **B: 支持プローブを方針表の隣で種ごとに宣言し、assist を方針の関数にする (採用)** —
  「底はどこか」の宣言が `placementKindOf` と同じ表に並び、未宣言の種は throw する。
  tradeoff: `SceneService` の private 2 メソッドをドメインの純粋モジュールへ移す
  リファクタが要る (幾何アクセスは実体から渡す形にする)。
- **C: `PLACEMENT` に 4 つ目の値 (`stackable`) を足す** — tradeoff: 「床を割らない」と
  「面に載る」を別の値にすると、robot_base をどちらにするかという同じ議論が
  値の選択として再発するだけで、語は増える。ADR-097 の 3 値は
  *不変条件の強さ* の軸であり、assist の有無は*ジェスチャ支援*の軸 — 直交する 2 軸を
  1 つの enum に畳むのは原則 #31 が指す「宣言できない状態」を作る。
- **D: 現状維持** — tradeoff: `grounded` が種ごとに違う意味を持ち続ける。当事者の
  違和感は正しく、SSOT の破れとして残る。

## Decision — Strategy (§1.2 Strategy)

**案 B。「載る」を方針の関数にし、支持プローブの宣言を方針表の隣へ移す。**

### 1. assist の適用可否を方針から導く

`placement.js` に純粋述語を足す (`hasGroundInvariant` の兄弟):

```
stackAssistApplies(placement) → placement === 'grounded' || placement === 'supported'
```

`_applyStackAssist` から `instanceof Solid` の門を 2 枚とも外し、代わりに
この述語を引く。`free` の実体 (ユーザー CF / MeasureLine / Profile) は
これまでどおり素通し — **除外は種ではなく方針が理由**になる。

### 2. 支持プローブを種ごとに宣言する (原則 #31 の形)

`_footprintSamplesOf` / `_bottomZOf` の `instanceof` 分岐を、`PLACEMENT_BY_KIND` と
同じファイルの宣言表へ移す:

```
SUPPORT_PROBE_BY_KIND = {
  solid:            { footprint: 'cornersAndCentroid', bottom: 'minCornerZ' },
  importedMesh:     { footprint: 'cornersAndCentroid', bottom: 'minCornerZ' },
  annotation:       { footprint: 'cornersAndCentroid', bottom: 'minCornerZ' },
  robotBaseFrame:   { footprint: 'originPoint',        bottom: 'originZ'    },
  coordinateFrame:  { footprint: 'originPoint',        bottom: 'originZ'    },
  measureLine:      { footprint: 'none',               bottom: 'none'       },
  profile:          { footprint: 'none',               bottom: 'none'       },
}
```

`placementFor()` と同じく **未宣言の種で throw** する。`'none'` は「プローブを
持たない」の**宣言**であって既定ではない (`free` と同じ扱い — 原則 #31)。
`SceneService` 側は宣言を読んで幾何を渡すだけの薄い実行系になる。

ロボット base の底が原点である根拠は ADR-085 (`world → robot_base → tcp` の TF で
base 原点が床に立つ点) — ここで新しく決めるのではなく、既存の決定を**表に写す**。

### 3. 「載っている」の可視化は変えない

stack 中の接触点 FX (`stackContact`) はハンドラの所有のまま。ロボットが載った
ときも同じ FX が出る = 種によって feedback が消えない (原則 #11)。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- **肯定的:**
  - G1/G2 — `grounded` が 1 つの意味に戻る。ロボットもマップ注釈も、キューブと
    同じ規則で面に載る。
  - G3 — `supportOf()` が答えられる実体と、assist が座らせられる実体が一致する。
  - 種分岐の残り 1 組が方針表へ集まり、`instanceof` の連鎖が
    `placementKindOf` 1 箇所という ADR-097 の規律が**実際に**閉じる。
  - 新しい実体種を足すとき、方針とプローブの両方が未宣言で throw する。
- **受け入れるコスト / 否定的:**
  - ロボット base をキューブの上へ動かすと天面に載る = 「床から少し浮かせて
    置く」が自由ドラッグではできなくなる。ADR-097 が Solid に対して受け入れた
    のと同じコストを、ロボットにも払う (逃げ道も同じ: `S` で `belowGradeIntent`)。
  - コアAPI へ送る base pose の**値**が動きうる (契約は不動)。ロボットが箱の上に
    立つシーンは grasp 解の前提を変えるので、当事者の dogfooding で意味を確認する。
  - `SUPPORT_PROBE_BY_KIND` は幾何の *記述* であって幾何そのものではない。
    文字列タグでの分岐 (原則 #2 が嫌う形) に見えるが、これは**方針表と同じ
    宣言の層**であり、実体の能力分岐ではなく「種ごとの既定の宣言」である
    (ADR-096 `EXPLICIT_DEFAULTS` / ADR-097 `PLACEMENT_BY_KIND` と同じ位置)。
    この判断が誤りだった場合は、プローブを実体のメソッドへ戻す。
- **検証 (証拠):** 論証木は `docs/gsn/adr-098-support-domain-is-policy.gsn`
  (goal ごとの支えの正本はそちら)。起票時点の証拠は**すべて未来形**であり、そう
  宣言する。実装時に閉じる予定の検査:
  - `src/domain/placement.test.js` の拡張 — 種を*列挙*して
    `SUPPORT_PROBE_BY_KIND` の欠落が **0 個**、余りが **0 個**であること
    (`PLACEMENT_BY_KIND` の既存の両向き検査と同じ形)。未宣言の種で throw。
  - `src/PosePolicyOwnership.test.js` の拡張 — `instanceof` で種を分ける行が
    `placement.js` の外に **0 個**であること。今日は `_footprintSamplesOf` /
    `_bottomZOf` が数えられていない (規則が在るのに問われていない箇所)。
  - 症状回帰 (e2e、当事者の報告に 1:1): ロボット base をキューブの上へドラッグ
    すると `supportOf(robot_base).kind === 'entity'` になる。**差分ペア**にする —
    同じジェスチャで `S` を押した場合は載らない。片方だけではジェスチャが
    そもそも効いていない可能性を排除できない (ADR-097 の回帰が採った形)。
  - 逆向きの回帰: `free` な CF (ユーザー CF / `tcp`) は同じジェスチャで載らない。
    「全部に効かせた」ことと「方針どおりに効いた」ことを区別する。
- **波及 (blast radius):** `src/domain/placement.js` (述語 + プローブ宣言表)、
  `src/service/SceneService.js` (`_applyStackAssist` の門 2 枚、`_footprintSamplesOf`、
  `_bottomZOf`)、`src/domain/placement.test.js`、`src/PosePolicyOwnership.test.js`、
  `docs/STATE_LEDGER.md` (基数列: 支持を持つ/持たない実体の個数は既に ADR-097 の
  行が持つ — 種の追加のみ)。契約・BFF・`core/` は不変。

## 実装で変わったこと (起票時との差 — 黙って上書きしない)

俯瞰と実装が食い違ったら食い違いのほうを書く (原則 #19)。起票時の記述を書き換えず、
下に差分だけ足す。

1. **種分岐は 2 箇所ではなく 4 箇所あった。** §Decision 2 は `_footprintSamplesOf` /
   `_bottomZOf` を名指ししたが、実装時に **`_segmentStartBottomZ` /
   `_destinationSamples`** が同じ `instanceof CoordinateFrame` 分岐を持っていた —
   セグメント開始時点の幾何に対して「この種の底はどこか」に答える*同じ問い*の、
   1 フレーム前の写しである。4 つとも宣言表へ寄せた。

2. **`cornersAndCentroid` → `bottomFaceAndCentroid` に改名し、意味を狭めた。**
   起票時の名前は「全 corners + 重心」だったが、実装時に 3 つの呼び出し箇所が
   *それぞれ違う足跡*を使っていたことが判明した (`_footprintSamplesOf` = 全 corners、
   `_destinationSamples` = 全 corners で重心なし、`_applyStackAssist` = **最下面の
   corners + その重心**)。足跡とは接地している面であり、傾いた実体の側面輪郭ではない
   ので、3 つを最下面基準へ統一した。名前が意味を語らないと第二の源に戻る (§1.1)。
   非自明な帰結: 傾いた Solid の座り位置が変わりうる (側面の張り出しが屋根に
   当たって浮くことが無くなる = 改善方向)。水平な実体・軸整列の箱では不変。

3. **`stackAssistApplies()` は `hasGroundInvariant()` へ委譲する。** 起票時は
   「兄弟の述語」と書いたが、本体が同一の述語を 2 本書くのは第二の源そのもの
   だった。名前 (= 問い) は 2 つ、実装は 1 つにし、将来 2 つの問いが分かれたときの
   分岐点を 1 箇所に用意した。

4. **`PosePolicyOwnership.test.js` の検査単位はファイルでも行でもなく
   「名指ししたメソッド本体」にした。** §Consequences は「`instanceof` で種を分ける行が
   `placement.js` の外に 0 個」と書いたが、これは**そのままでは実装できない** —
   `src/` にはヒットテスト・N パネル・ツールバーなど配置と無関係な正当な
   `instanceof` が多数あり (ADR-097 が既に「そこへ規則を書いて外した」と記録して
   いる)、全域規則は無視される規則になる (希釈 — 憲法 Q3)。プローブ 7 メソッドを
   名指しし、その本体内の `instanceof` を 0 個に数える形に狭めた。**pose の書き込み
   ABI (`_applyEntityDelta`) だけは宣言された例外**として表に持ち、宣言の無い例外が
   0 個であることを逆向きにも数える。

5. **範囲外で 1 件バグを直した (検証を通すために不可避)。** 数値 Grab の
   `1`/`2`/`3` が `this._setSnapMode(...)` — **`src/` のどこにも存在しないメソッド** —
   を呼んでおり、毎回 TypeError を投げたうえで数値入力の分岐より先に `return`
   していた。つまり **1・2・3 を含む距離を打つとその桁が黙って消えていた**
   (入力は消費され何も起きない = 原則 #11 の最悪形)。snap の *モード* という概念は
   `SnapSystem` に存在しないので復元先が無く、宙に浮いた分岐を削除した。
   ADR-098 の e2e (画面座標に依存しない数値 Grab) が、この道を初めて通って露出させた。

## Lens notes

- **グラフ:** 波及は「pose を書く入口」ではなく「**種で分岐する行**」の集合。
  ADR-097 が入口集合にレンズを当てたのに対し、本 ADR は分岐集合に当てる。
  同じ欠陥の裏面 — 入口を 1 つにしても、その入口の中に種の門が残れば結果は同じ。
- **黒箱:** `supportOf()` の入出力契約は変えない。変えるのは「その答えを
  適用する側」の適用範囲だけ。
- **様態:** BPMN (逐次)。ドラッグ 1 回のあいだの決め打ちフローであり、
  事象駆動の裁量処理ではない。
- **状態機械 (§1.4):** 新しい状態は増えない。`belowGradeIntent` の基数
  (0..N) は ADR-097 の台帳行がすでに持つ。

## References

- ADR-097 (接地を実体の状態へ) — 本 ADR が引き継ぐ直接の前提。`_applyStackSnap` から「床を作る」責務を剥がした ADR であり、剥がし残した**種の門**が本 ADR の対象
- ADR-071 (配置の既定) — stack assist の出どころ。ADR-097 で「他の実体の上に載せる」補助へ縮んだものを、本 ADR で種から解放する
- ADR-085 (ロボットの TF 親子ツリー) — robot_base の底が base 原点である根拠 (本 ADR は決めずに写すだけ)
- ADR-096 (可視性の 2 軸) — `highestSurfaceAt` が可視メッシュのみを撃つため、explicit で消した実体が支持面にならないことの根拠
- ADR-083 (robot base placement と grasp 契約) — base pose の**値**は動きうるが**契約**は不動
- PHILOSOPHY #1 (唯一の権威ある入口), #2 (型が能力契約), #11 (無言の失敗の禁止), #31 (基数ゼロ / 未宣言の種で throw)
