# 132. 探索は画面に在るものについて解く — 入口は文書を採らない

- Status: Accepted (実装済み 2026-08-14 — D1〜D5)
- Date: 2026-08-14
- Deciders: yuubae215, Claude
- Retires: GREP:src/controller/ContextController.js::quickStartExample · GREP:src/controller/GraspController.js::GRASP_QUICKSTART_TEMPLATE_ID · GREP:src/service/SceneService.js::seed\s*=\s*false · GREP:src/controller/AppController.js::ensureRobotFrames — 4 つとも `src/SearchGeometryOwnership.test.js` / `src/RobotRosterAuthority.test.js` が**個数 0 で**問う (ADR-103: 退役の腐敗は違反を見逃すのではなく緑を出す)
- 段: **G-7** (`docs/grasp/implementation-order.md`)
- Supersedes / Superseded by: なし (ADR-131 の兄弟 — あちらは*再生成の意味*を分け、こちらは**入れ替えを誰が選ぶか**を分ける。ADR-055 の φ⁻¹ に初めて消費者を与える)

## Context — Goal と力学 (§1.2 Goal)

**Goal:** *探索は「いま画面に在るもの」について解く。入口を開く行為は、ユーザーが
選んでいない文書の採用ではない。*

### 見つかり方 — ユーザーが押したら画面が入れ替わった

> grasp search をすると、急に画面が切替わって、tcp教示点ピック、tcp教示点プレースと
> 出るんだけど、これは何？もともとロボットと把持する対象の関係性をモデリングしてたけど
> リセットされちゃう…
>
> あと、ロボットが初期シーンに存在するけど非表示になっているのが違和感。初期シーンで
> 見えなかったら気付かなくない？それだったら最初からヒエラルキーにも存在しないのと
> 変わらないような気が…

「TCP 教示点 pick / place」は `examples/cell_robotics_context.json` の実体である。
シーンが壊れたのではなく、**別の文書が読み込まれて入れ替わった**。経路は 1 本:

```
GraspController.openGrasp()
  → if (!this._ctrl._ctxService.loaded)      ← 判定はこの 1 行
    → ContextController.quickStartExample('cell_robotics')
      → loadContext → _projectScene({ preserveUndeclared: false })
        → SceneService._clearScene()          ← 全消し
```

### 力学 1 — `loaded` は「失うものが在るか」の答えではない

分岐が読んだのは **文書**についての boolean で、失われたのは**シーン**の中身である。
boot 直後なら確かに捨ててよいが、シーンは文書なしで N 個の実体を持てる。
**未宣言実体の個数には欄が無い** (原則 #31) ので、この分岐は一度も「失うものが在るか」を
聞いていない。ADR-131 が `applyContextDoc` で同じ形を閉じ、母集団 (`_undeclaredIds()`)
まで作っておきながら、**入口の側には持ち込まれなかった**。

ADR-131 D3 は「全消しは*意味の合う場面*に残る」と書いた。その意味とは「ユーザーが
**別の文書を採ったとき**」である。ここはその動詞を、ユーザーが選んでいないのに借りていた。

### 力学 2 — なぜそんな迂回が生まれたか: 主語が 2 つの源から来ていた

迂回には理由があった。**探索は文書が無いと動けなかった**からである:

| 主語 | 源 | 生きているか |
|---|---|---|
| どのロボットか | **live scene** (`resolveRobots` + `worldPoseOf`) | 常に |
| どの物か | **文書** (`ContextService.getCompiled().layoutDsl`) | 文書が在るときだけ |

同じリクエストの 2 つの主語が別の源を持つ。**どちらを読んでも欠陥は見えない** — 各々は
自分の源から正しく解決されており、食い違いは 2 つを並べたときにしか現れない。帰結は 2 つ:

1. シーンに直接置いた箱は**最初から探索の対象になれない**。だから「文書が無ければ文書を
   作る」という迂回が入口に生えた。
2. ビューポートで Solid を動かしても、文書を再コンパイルするまで**サンプルが動かない**。
   ADR-129 が名指しした「動かしたのに答えが変わらない」の幾何側で、しかも
   `_graspTargets` の doc コメントが**自分でそう書いていた**:

   > Noted rather than silently split: closing it means deciding which side owns
   > object geometry, which is an ADR, not a patch.

### 力学 3 — 逆写像は 3 か月前から在り、誰も呼んでいなかった

`decompileLayout` (ADR-055) は scene → Layout DSL の φ⁻¹ で、fixpoint law
(`compileLayout(decompileLayout(scene)) ≡ scene`) までテストされている。
**生産経路からの呼び出しは 0 件だった。** 「機構が在る」と「読む機械が在る」は別の
事実で、後者が無いあいだ検査は緑ですらなく**不在**だった (ADR-115 と同型)。

### 力学 4 — 見えないロボットは、基数 1 を基数 0 として提示していた

boot は `ensureRobotFrames({seed:true})` で 1 台作り、ADR-096 §Decision 3 が
その 1 台の `explicit` 既定を **false** と宣言していた (「1 本立つアームは雑然として
読める」)。**どちらも単体では正しく、合わせると欠陥**である: 見えない実体は「在る」と
「無い」の区別を持たないので、ユーザーが正しく指摘したとおり *最初からヒエラルキーに
存在しないのと変わらない*。ADR-090 が 0 台を一級市民にした後、**boot だけがそれに
反対し続けており、しかも反対していることが画面に出ていなかった**。

## Options considered

- **A: `loaded` の代わりに未宣言実体の個数で分岐する** — tradeoff: 破壊は止まるが、
  文書が無いシーンは依然として探索できないので、入口は「何もできません」で終わる。
  **力学 2 (源の非対称) を残したまま症状だけ塞ぐ。却下。**
- **B: 破壊の前に確認ダイアログを出す** — tradeoff: 安全だが、boot 直後の 1 クリック
  入口が 2 クリックになり、しかも**押す前に分かる**を全ケースに課す (DEF-011 が別途
  受けている問題)。源の非対称も残る。**却下。**
- **C: `resolveGraspTargets` をシーンから直接解決する** — tradeoff: 対象は取れるが、
  リクエストの他の部分 (`layoutVersion` / BFF の compile 往復) が依然 DSL を要る。
  **源が 3 つ (scene の対象 / scene のロボット / 文書の DSL) になる。却下。**
- **D: 幾何は live scene の decompile、宣言は文書から join** — tradeoff:
  `ContextService` の DSL が「探索の源」ではなくなる (ADR-054 の canonical は
  *文書の投影*としては生きている)。母集団が正しく、両方の主語が同じ源に揃い、
  ADR-055 の φ⁻¹ が初めて仕事をする。**採用。**
- **E: シーンを丸ごと採り、文書は見ない** — tradeoff: 最も単純だが、`graspFeature` は
  文書にしか無い (`DocBuilder` が `specification.layout.entities[].graspFeature` に書き、
  シーンには載らない) ので、**宣言済みの掴む場所が全部消える**。ADR-119 D3 が禁じた
  「宣言したのに無視した」そのもの。**却下。**

## Decision — Strategy (§1.2 Strategy)

### D1 — 幾何は live scene から来る

探索の Layout DSL は `decompileLayout(serializeScene(model))` で作る。ロボットの姿勢が
既に `worldPoseOf` (live) から来ているので、これで**両方の主語が同じ源**になる。
ADR-055 の φ⁻¹ に初めて消費者が付く。

### D2 — 宣言は文書から `ref` で join する。幾何と宣言は別の持ち主である

`graspFeature` は文書の宣言でシーンには載らないので、decompile 後の実体へ **`ref` で
join** する。ref が Scene → DSL を往復することは ADR-055 の fixpoint law が既に保証して
いる。これは ADR-129 の主張をコードにした形でもある — **宣言はそれを書いたインスタンス
より長生きする**のだから、その物が *いま在る場所* に付かなければならない。

| 半分 | 持ち主 | 理由 |
|---|---|---|
| 幾何 (どこに・どれだけ・どう向いて) | **live scene** | ユーザーが見ているもの。ロボット側が既にそう |
| 宣言 (`graspFeature` = どこを掴むか) | **文書** | シーンが運んでいない。捨てると ADR-119 D3 の嘘になる |

### D3 — 源は状態である。画面に出す

`geometrySource` / `declarationSource` を名前付きの値として返し、パネルに出す
(`sourceLabel` は**未宣言の源で throw** する)。「文書が何も宣言していない」と
「文書を読んでいない」は同じ対象を生むので、**源だけがこの 2 つを区別する**
(ADR-120 が閉じたスコア層で見つけたのと同じ、鍵の不在が運ぶ区別)。
DSL が表現できない実体 (ImportedMesh / MeasureLine / Profile) の個数も同じ理由で出す。

### D4 — quick-start を語彙から消す

D1 で「文書が無いと探索できない」が消えるので、`quickStartExample` の存在理由が消える。
**ガードするのではなく削除する** — ガードされた破壊経路は条件 1 つで復活し、次に
「速い開始」が欲しくなった入口は grep でそれを見つける。動詞を語彙から消すのが、
次の 1 つを**書けなくする**唯一の方法である (ADR-102 の手)。

### D5 — boot は 0 台で起動する

`ensureRobotFrames` の `seed` オプションと `addRobot` の `entry` 引数を**削除**する
(不使用にするのではなく)。ロボットは Add ▸ Robot で生まれ、そちらは見える。
`VISIBILITY_ENTRY.SEED` / `ROBOT_BASE_SEEDED` は**残る** — 読み込んだシーンに入っていた
ロボットの既定として今も生きている (他人のセルの家具であって、ユーザーがいま頼んだ
ものではない)。

### D6 — 数えるのは「消えてよかったものの個数」と「退役した形の個数」

消滅には状態が無い (ADR-131) ので、実機の検査は開く前後の**実体の集合**を比べる。
個数だけを比べると、同数の別物に入れ替わった場合に緑を出す — それはまさに今回の
欠陥の形である。加えて退役した 4 つの形を名前で列挙して個数 0 を問い、φ⁻¹ の
消費者が **1 以上**であることを逆向きに問う (0 に戻ったら D1 の主張は空洞化する)。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

### 得られるもの

- 入口が破壊しない。ユーザーの報告した事故が起きなくなる。
- **文書なしのシーンが探索できる** — これが quick-start を不要にした条件であって、
  quick-start を消したから探索できるようになったのではない (順序が逆だと D4 は改悪)。
- ビューポートで動かした物が、動かした場所で解かれる (ADR-129 の幾何側)。
- 初期シーンの基数と表示が一致する。
- `decompileLayout` が仕事を始める。

### 受け入れるコスト / 否定的

- **`ContextService` の Layout DSL は「探索の源」ではなくなった。** ADR-054 の
  「Context が canonical」は*文書とその投影*については生きているが、探索の幾何は
  もう文書経由では取らない。文書とシーンがずれているとき、探索は**シーン**を信じる。
- **decompile のコストが探索操作ごとに乗る。** シーン全体を serialize してから
  decompile するので O(実体数)。grasp の入口・Run・対象 pick でのみ走り、
  エンティティのライフサイクルイベントでは走らない (`refreshGraspTargets` は
  grasp の流れからしか呼ばれない)。1 回の Run 内では**ちょうど 1 回**に畳んである —
  ゲートと payload が別々に解決すると、その間にシーンが動いたときに食い違う
  (ADR-101 が pose で消した「2 つの時点を読む」形)。
- **文書が宣言したのにシーンに実体が無い ref は、黙って落ちる。** `declarationJoinCensus`
  が孤児として数えられる形にはしてあるが、**今日それを画面に出す場所は無い**。
  母集団は文書の宣言なので出せるはずのものが出ていない — 限界として宣言する。
- **`decompileLayout` が表現できない実体は探索に載らない。** 個数はパネルに出るが、
  「どれが」は出ない。
- boot に馴染みのロボットが居なくなるので、初見の導線は Add ▸ Robot を通る。

### 検証 (証拠)

`docs/gsn/adr-132-a-search-is-about-what-is-on-the-screen.gsn` が goal ごとの支えの正本。

| 主張 | 問い所 | 実行結果 |
|---|---|---|
| 源の規則 (幾何=scene / 宣言=文書 / 両者の欠如) | `src/domain/searchGeometry.test.js` | **11 pass** |
| 入口が文書を読み込まない | `src/controller/GraspController.test.js` | **45 pass** |
| 修正が無ければ落ちる (非空虚) | 旧 `openGrasp` の分岐を一時的に戻して再実行 | **2 fail** — 空回りしていない |
| 退役した 4 形がコードから消えている | `src/SearchGeometryOwnership.test.js` | **3 pass** (変更前は 6 箇所ヒット) |
| φ⁻¹ に消費者が 1 以上居る | 同上 | pass |
| seed 経路が 0 個 | `src/RobotRosterAuthority.test.js` | **1 pass** |
| 単体レーン全体 | `pnpm test` | **1274 pass / 0 fail** |
| THREE-free レーン | `pnpm test:context` | **554 pass / 0 fail** |
| 実機: 初期シーンのロボット 0 台 | `e2e/grasp-scene-source.spec.js` | **pass** |
| 実機: 入口を開いても実体が 1 つも消えない | 同上 (集合差が空 · `geometrySource: 'scene'`) | **pass** |
| ビルド | `pnpm build` | pass |

**この証拠が構造的に見逃すもの:**

- **join の正しさは 1 例でしか見ていない。** 単体は同じ ref を両側に持つ最小構成で、
  実機は宣言のないシーンしか通していない。**文書を読み込んだ状態で Solid を動かし、
  宣言が付いてくることを実機で通していない** — D2 の核心はそこなので、限界として大きい。
- **孤児になった宣言を画面に出す経路は未実装。** `declarationJoinCensus` に呼び手が
  居ない = ADR-115 の形を自分で 1 つ作った。ここで消費者を付けなかったのは、出す場所
  (パネルのどこに、どんな語で) が未決だからである — 「対象外」ではなく
  **まだ決めていない** (DEF-035)。
- **decompile が落とす実体の一覧を出していない。** 個数は出るが同一性は出ない。
- e2e は前方向の守りにしかならない (旧実装では `graspSource` API 自体が無い)。
  非空虚性は単体レーンで取った。

### 波及 (blast radius)

- `src/domain/searchGeometry.js` (新規) · `src/domain/searchGeometry.test.js` (新規)
- `src/SearchGeometryOwnership.test.js` (新規) · `e2e/grasp-scene-source.spec.js` (新規)
- `src/controller/GraspController.js` — `_searchLayout` · `openGrasp` · `runGraspSearch`
- `src/controller/ContextController.js` — `quickStartExample` 削除
- `src/controller/AppController.js` — boot seed 削除 · `graspSource` スナップショット
- `src/service/SceneService.js` — `decompileToLayoutDsl` · `ensureRobotFrames` · `addRobot`
- `src/components/Grasp/GraspSearchPanel.jsx` — 源の表示
- `src/RobotRosterAuthority.test.js` — 1 → 0
- `docs/STATE_LEDGER.md` · `docs/DEFERRAL_LEDGER.md` · `docs/grasp/implementation-order.md`

**触っていないもの (宣言):** 契約 (`packages/grasp-contract`) · `core/` · BFF ·
`LayoutCompiler` / `LayoutDecompiler` 本体 · CommandStack · 選択 · カメラ ·
ADR-131 の footprint 規則 · `ROBOT_BASE_SEEDED` の既定値 (load/import 経路で生きている)。

## Lens notes

- **§1.1:** 探索の幾何の源を決めるのは `resolveSearchLayout` ただ 1 つ。呼び手は
  何人でもよいが、「シーンと文書のどちらが幾何を持つか」を各所で書き直さない。
- **原則 #31:** 3 か所に現れた — (1) `loaded` は基数を聞いていない、(2) 見えない
  ロボットは 1 を 0 として提示する、(3) 源を出さないと「宣言が無い」と「読んでいない」が
  同じに見える。数えるのは在るものではなく、**消えてよかったもの**と**退役した形**。
- **原則 #11:** 入口が消費した入力に対して、必ず結果か理由を返す。
- **ADR-103 との関係:** 退役は「使わなくなる」ではなく「語彙から消える」で完了する。
- **ADR-115 との関係:** `decompileLayout` は「宣言は在るが読む機械が無い」の実例だった。
  今回それに消費者を与え、消費者の個数を検査で焼いた。ただし
  `declarationJoinCensus` で**同じ形を 1 つ作った**ことは隠さない (DEF-035)。
