# 142. 選んだシーンは「他人のセル」ではない — テンプレート/import 由来のロボットは既定で表示する

- Status: Accepted
- Date: 2026-09-20
- Deciders: yuubae215, Claude (pairing)
- Retires: GREP:src/view/VisibilityAxes.js::\[VISIBILITY_KIND\.ROBOT_BASE_SEEDED\]:\s*false
- Supersedes / Superseded by: なし (ADR-096 §Decision 3 の 3 行あるうち **`robot_base` seeded の 1 行だけ**を改める。`GEOMETRY`/`COORDINATE_FRAME`/`ROBOT_BASE_ADDED` の既定、2 軸合成そのもの、`VISIBILITY_ENTRY` の型は不変)

## Context — Goal と力学 (§1.2 Goal)

当事者の観測:「サンプルシーンでロボットがあるシーンを選択してもロボットが
ビジュアライズされないのはなんで?」

**Goal: ユーザーが「ロボットの入っているシーン」を選んだら、ロボットが見える。**
選ぶという行為そのものが「これを見たい」という表明であり、選んだのに何も
起きないのは ADR-096 が名指しした最悪の失敗 (原則 #11) の別形である。

### 力学 1 — `ROBOT_BASE_SEEDED` の既定は、もう存在しない前提の上に立っていた

`src/view/VisibilityAxes.js` の `EXPLICIT_DEFAULTS` (ADR-096 §Decision 3):

```js
[VISIBILITY_KIND.ROBOT_BASE_SEEDED]: false,  // 「空シーンに腕 1 本はノイズ」
```

この行の根拠は ADR-089 follow-up — **ブート直後の空シーンに、ユーザーが
何も求めていないのに腕が 1 本突っ立っているのはノイズ**、という前提だった。
ところが **2026-08-14、ADR-132 Decision 5 がブートの seed 経路そのものを廃止した**
(`docs/SceneService.js` `ensureRobotFrames()` のコメント、および
`docs/STATE_LEDGER.md` 「実体の可視性」行が既に記録済み)。今日、
`VISIBILITY_ENTRY.SEED` は `addRobot()` を経由しないすべての到達経路 —
**テンプレート読み込み (`_loadLayoutTemplateDsl`) と .ctx.json / シーン import** —
だけを指す。前提(空シーン)が消えた後も、前提から導いた既定(`false`)だけが
コードに生き残っていた(原則 #24 の鏡像: 導出元が動いても導出値が追随しなかった)。

`src/controller/AppController.js` の `_loadLayoutTemplateDsl()` は現状これを
追認する形でコメントされている:

> 「A template's robot arrives through the scene, not through the user's Add
> menu, so it carries the seeded default and **stays down**」

「他人のセルの備品だから伏せておく」という言い分は、**ユーザーがそのシーンを
自分で選んだ**という事実の前では成立しない。Home 画面のテンプレートカード
(`layout_pick_place_cell.json` など)はロボットが主役の構成であり、選ぶ動機の
大半は「ロボットを見たい/触りたい」である。

### 力学 2 — ADR-096 が閉じた症状の鏡像が、ADR-096 自身の既定表に残っていた

ADR-096 の Goal G1 は「UI が語る可視性は実際の描画と常に一致する」、G2 は
「トグルは必ず何かを変える」だった。今回の症状はこの 2 つの**外側**にある
第三の顔: **UI は正しく「非表示」を示しており(嘘はついていない)、トグルも
機能する(Outliner の目を開けば映る) — それでも、選択という行為の結果が
「何も見えない」のままなのは、原則 #11 が禁じる無言の no-op と同型である。**
ADR-096 は「目が開いているのに何も見えない」を消したが、
「シーンを選んだのに何も見えない」は別の未閉鎖症状として残っていた。

### 位置

presentation / chrome 層の決定 1 行(`EXPLICIT_DEFAULTS` の 1 セル)。ドメイン・
契約・DSL には触れない(原則 #29)。ADR-096 が確立した「既定は種ではなく
入口で宣言する」という形は変えず、**入口の意味が ADR-132 で変わったことに
既定を追随させる**のが本 ADR の全体。

## Options considered

- **A (採用): `ROBOT_BASE_SEEDED` の既定を `false` → `true` にする。**
  `ROBOT_BASE_ADDED` と同値になるので、2 行を 1 行(`entry` に関わらず
  `robot_base` は既定で見える)へ畳めるが、**畳まない**(§Decision 参照)。
- **B: `_loadLayoutTemplateDsl()` だけで個別に `declareExplicitVisible(base, USER_ADDED)`
  を呼ぶ(import 経路は現状維持)。** tradeoff: 「テンプレートは表示・import は
  非表示」という**新しい第三の入口意味**を作ることになり、`VISIBILITY_ENTRY` が
  2 値では表現できなくなる(型を増やす)。しかも import (.ctx.json を開く)も
  「ユーザーが選んだ」ことに変わりはなく、区別する理由が無い。却下。
- **C: 現状維持 + Home 画面にトースト等で「Outliner でロボットを表示できます」と
  案内する(発見可能性の強化, 原則 #16)。** tradeoff: 症状の根治ではなく回避策の
  上乗せで、選んだ瞬間に見えないという体験そのものは変わらない。単独では不採用
  (ただし A と両立するので、発見性そのものは別途 ADR-096 の枠内で改善しうる)。
- **D: `robot_base` の既定を種ではなく「シーンにジオメトリが 1 つでもあるか」で
  動的に決める。** tradeoff: 既定が実行時の別の実体の有無に依存する形になり、
  ADR-096 が排除した「既定値で埋める/推論する」の逆側の複雑化(原則 #31 が問題に
  していた「宣言」を「条件」に置き換えてしまう)。却下。

## Decision — Strategy (§1.2 Strategy)

**案 A。** `src/view/VisibilityAxes.js` の `EXPLICIT_DEFAULTS[VISIBILITY_KIND.ROBOT_BASE_SEEDED]`
を `true` に変更する。

1. **`ROBOT_BASE_SEEDED` の行と根拠コメントを更新する。** 「空シーンに腕 1 本は
   ノイズ」(ADR-089 follow-up、もはや到達不能な前提)を削り、「読み込んだシーン
   由来でも、ユーザーが選んだ結果である以上ロボットは見える。何も現れない選択は
   原則 #11 の失敗」に置き換える。
2. **`ROBOT_BASE_SEEDED` の kind 自体は残す(畳まない)。** `ROBOT_BASE_ADDED` と
   値が同じになった今も、**入口を消さない**: (a) 将来また入口ごとに既定を分ける
   要求が来たときに `visibilityKindOf()` の分岐がそのまま使える、(b)
   `VisibilityAxes.test.js` の「入口で既定が決まる」という主張(§Decision 3 の
   骨子)を検査し続けるには 2 つの kind が値として区別できる必要はなく **経路として
   区別できれば足りる** — 値の一致は「今回たまたま同じ結論になった」であって
   「入口を区別する理由が消えた」ではない。畳むと後者を主張したことになり、
   証拠を超えた一般化になる(§1.2 — Evidence が支える主張の範囲を超えない)。
3. **`AppController._loadLayoutTemplateDsl()` のコメントを更新する。** 「seeded
   default のまま伏せる」という説明を削除し、テンプレートのロボットは今後
   既定で見えることを明記する。
4. **`docs/STATE_LEDGER.md`「実体の可視性」行に差分を追記する**(原則 #19 —
   俯瞰を書き換えず差分として残す)。`docs/adr/README.md` に本 ADR を追加する。

### 変わらないもの

- 2 軸合成 (`composeVisibility`)、`explicit`/`contextual` の書き手、
  `defaultExplicit()` が未宣言の kind で throw する規律 — 無改変。
- `GEOMETRY` (`true`) / `COORDINATE_FRAME` (`false`) の既定 — 無改変。CF の
  「選択で軸が出る」文脈表示は本 ADR の対象外。
- ブートの空シーン自体はロボットを 1 台も持たない(ADR-132 D5)ので、
  本 ADR は**ブート直後の見え方には影響しない**(見せる/見せないの判断対象が
  存在しない)。影響するのはテンプレート読み込みと import のみ。
- ユーザーが Outliner の目で明示的に非表示にした後、既定は上書きされない
  (`explicit` は宣言後は入口に関わらず唯一の書き手が持つ、ADR-096 不変)。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- **肯定的:**
  - Home のロボット入りテンプレートを選んだ直後にロボットが描画される —
    Goal が満たされる。
  - `addRobot()` 経由と入口が揃うので、「ロボットは既定で見える」という
    ユーザーの学習が一貫する(テンプレート由来だけ例外、という驚きが消える)。
  - 既定は今回も**宣言 1 行の書き換え**で閉じ、既定値で埋める/推論する経路は
    増えない(原則 #31 の規律を保ったまま値だけ変える)。
- **受け入れるコスト / 否定的:**
  - import で開いた**既存の**シーンが、作者が意図的に「腕は補助であって主役では
    ない」と伏せていた可能性のある構成でも、既定は今後「見える」側になる。
    ただしこれは `explicit` を保存しない設計(ADR-096 §Consequences —
    presentation 状態はワイヤに載せない)の帰結で、そもそも import のたびに
    既定へ復帰する挙動自体は本 ADR 以前から同じであり、変わるのは既定の値だけ。
  - `ROBOT_BASE_SEEDED` と `ROBOT_BASE_ADDED` が同値になり、2 kind を維持する
    コストの割に当面それを区別する消費者がいない(§Decision 2 で意図的に
    許容 — 再分岐の受け皿を残すコストは 1 行)。
- **検証 (証拠):**
  - `src/view/VisibilityAxes.test.js` の既定値アサーション
    (`ROBOT_BASE_SEEDED === false`)を `true` へ更新し、「seed と added で既定が
    違う」ことを主張していたテストは「入口で kind は分かれるが今日は同値」に
    書き換える(`notEqual` を使っていた箇所は削除または `visibilityKindOf` の
    戻り値の**種類**が違うことの検査に差し替える)。
  - 「ブート seed のロボット 1 台は base も tcp も伏せる」テストは、
    ADR-132 D5 によりブートがロボットを 0 台持つ前提のまま残っていた命題
    (「seed 由来の `explicit` は両方 false」)を主張しなくなるので削除し、
    「テンプレート/import 由来の robot_base と tcp は既定で表示される」ことを
    主張するテストに置き換える。
  - `e2e/smoke.spec.js` のブート回帰(`framesShown` が 0 件)は無改変(ブートは
    引き続きロボットを持たないため)。
  - `pnpm test:gsn` を通すため `docs/gsn/adr-142-a-picked-scene-is-not-someone-elses-furniture.gsn`
    を同じ PR で起こす。
- **波及 (blast radius):** `src/view/VisibilityAxes.js` (既定表 1 セル + コメント)、
  `src/view/VisibilityAxes.test.js`、`src/service/SceneService.js` (コメントのみ)、
  `src/controller/AppController.js` (コメントのみ)、`docs/STATE_LEDGER.md`
  (「実体の可視性」行への追記)、`docs/adr/README.md`。契約・DSL・ワイヤ・
  2 軸合成のロジックは無改変。

## Lens notes

- **§1.1 真実の源:** 既定の権威は `EXPLICIT_DEFAULTS` の 1 セルのまま(変更前後で
  権威の所在は動かない)。動いたのは **前提と結論の対応**(ADR-089 の前提が
  ADR-132 で消えたのに ADR-096 の結論が追随しなかった)であり、これは原則 #24
  (周期的に導出される値を入力に戻さない)の**片側だけが起きた事故** — ADR は
  ADR で改訂できるが、コードの定数は誰かが手で更新するまで古い前提を保持し続ける。
- **原則 #19:** 本 ADR 自体が Q1(暗黙ルールの欠落)の実例。「入口の意味が
  変わったら既定表を見直す」というルールはどこにも書かれておらず、次に同種の
  改廃(別の `VISIBILITY_ENTRY` 追加/削除)が起きたときのために
  `docs/code_contracts/` に一行残す価値があるかは実装後に判断する。

## References

- ADR-096 (可視性 2 軸 + 既定の宣言) — 本 ADR が改める既定表の出どころ
- ADR-132 (Decision 5: ブート seed 経路の廃止) — 本 ADR の前提となる差分
- ADR-089 follow-up — 「空シーンに腕 1 本はノイズ」という、もはや適用対象を
  持たない旧根拠
- PHILOSOPHY #11 (無言の失敗の禁止), #19 (ドキュメントドリフトはバグ),
  #24 (循環導出の禁止), #31 (既定値で埋めない/宣言させる)
