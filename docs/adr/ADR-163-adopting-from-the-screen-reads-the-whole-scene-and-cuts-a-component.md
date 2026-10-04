# 163. 画面からの取り込みは、シーン全体を逆変換してから連結成分を切り出す — DEF-060 を決着する

- Status: Proposed
- Date: 2026-10-04
- Deciders: yuubae215, Claude
- 段: なし (DEF-060 の決着案。ADR-159 D4 が残した判断、ADR-162 の続き)
- Retires: GREP:src/domain/sceneAdoption.js::HAS_CHILDREN · GREP:src/domain/sceneAdoption.js::LINKED: — 「子がいる」「リンクがある」で取り込みを断る 2 つの理由。実装の PR で消え、DEF-060 も同じ PR で登録簿から消す
- Supersedes / Superseded by: なし (ADR-159 D4 の拒否規則を置き換える。D1〜D3 — 入口は 1 つ・f_on_screen の trace・スナップショットの undo — はそのまま)

## 用語 — 「逆変換」(ADR-055 の φ⁻¹)

このリポジトリでは、Layout DSL からシーンを作るコンパイル `compileLayout` を φ と書き、その逆向き
(シーンから Layout DSL を読み戻す) `decompileLayout` を **φ⁻¹** と書いてきた (ADR-055)。
本 ADR では**逆変換**と呼ぶ。逆変換は多対一の逆なので元の文字列には戻らず、**正規形**
(`strategy: 'manual'` + 明示 `position`) に戻る。成り立つ法則は
$\varphi(\varphi^{-1}(\text{scene})) \equiv \text{scene}$ (シーンの不動点) である (原則 #28)。

## Context — Goal と力学 (§1.2 Goal)

### 要求

> 文書を残すと言うか、カノニカルなデータモデルに写像して、Mutualにデータ交換できるように
> しとけばいいのでないの？ … ADRは起こしておいて

**Goal:** *画面にある物はどれでも、関係 (親子・リンク) を保ったままカノニカルなモデル (文書の
Layout) に入れられる。* 入れられないのは、カノニカルなモデルの語で**言えない**物だけで、
そのときは理由を言う。

### 力学 — 逆変換は既にシーン全体を読める。取り込みだけが切ってから読んでいた

```mermaid
flowchart LR
  S[シーン] -->|今: 物 1 個を切り出す<br/>links: []| C1[1 物だけ逆変換] --> X((関係が落ちる → DEF-060))
  S -->|案: 全体を逆変換| L[シーン全体の Layout<br/>entities + parentRef + constraints] -->|連結成分を切り出す| D[文書へ]
```

- 逆変換 `decompileLayout` は、シーン全体から `parentRef` (親子) と `constraints` (リンク) まで
  読み戻せる。grasp 探索は既にシーン全体を読んでいる (`SceneService.decompileToLayoutDsl`、ADR-132)。
- ADR-159 の取り込み `planSceneAdoption` は、逆変換の**前に**物を 1 個だけ切り出し、`links: []` を
  渡していた。関係は逆変換が読む前に捨てられており、だから「子がいる」「リンクがある」を拒否するしか
  なかった (DEF-060)。**欠けていたのは機構ではなく、切る順序**である。
- ADR-162 でテンプレの物は文書として開くようになり、ここへ来るのは画面で生まれた物 (Shift+A の箱、
  複製、Fasten で留めた物) だけになった。

### 文書の物を読み戻さない理由

シーン全体を逆変換して文書へ**書き戻す**と、文書の物の `$fact` / `$decision` 参照がただの数値で
上書きされ、なぜその値かが消える (逆変換は Why を運ばない — ADR-055 §3)。だから文書が持つ物は
今までどおり文書が権威で、逆変換から取るのは**文書がまだ持っていない部分**だけにする (ADR-129 / 131 の
「権威は実体の種で分ける」を保つ)。

## Options considered

- **A: シーン全体を逆変換し、頼まれた物の連結成分 (文書に無い物に限る) を切り出して入れる** —
  tradeoff: 頼んだ 1 個より多くの物が文書に入る (つながっている物だけ)。入ったことをトーストで言う必要がある。
- **B: 指し先を張り替える (子・リンクの id を新しい compiled id に書き換え、物は 1 個だけ入れる)** —
  tradeoff: 子とリンクの相手は文書に入らないまま、文書の物を指すことになる。文書の外の物が文書の物に
  依存する形で、次の再生成でどちらが権威かが曖昧になる。張り替えの規則が逆変換と別に 1 つ増える (§1.1)。
- **C: 文書に無い物を全部まとめて入れる** — tradeoff: 頼んでいない無関係な物まで文書へ入る。
  ADR-159 が守った「頼まれた物だけ」(ADR-046 不変条件 1 の精神) を破る。
- **D: 現状維持 (拒否)** — 画面で留めた物には宣言できないまま。

## Decision — Strategy (§1.2 Strategy) — 案 A

### D1 — 逆変換が先、切り出しが後

取り込みの計画は、シーン全体の逆変換 `decompileLayout(snapshotJson())` を 1 回読み、その結果から
切り出す。物を切ってから逆変換しない。逆変換の読みは grasp 探索と同じ 1 つ (§1.1)。

### D2 — 切り出す範囲は、文書に無い物の連結成分

$U$ = 文書が投影していない物 (ADR-131 の footprint の補集合)、$E$ = 親子 (`parentRef`) と
リンク (`constraints`) の無向辺とすると、取り込む物の集合は

$$
C(r) = \text{closure}_{E|_U}(\{r\})
$$

(頼まれた物 $r$ から、$U$ の中だけを $E$ で辿って届く物)。切り出しは純粋関数 `adoptionComponent` (`src/domain/sceneAdoption.js`) の 1 箇所が持つ。Solid の Origin と、その下のフレームは
今までどおり Solid の一部として数える。$C(r)$ の外の物 (無関係な物・文書の物) は入れない。
取り込んだ物の数が 2 以上なら、トーストがその数を言う (原則 #11)。

### D3 — 文書の物へのリンクは、制約として ref で入る

$C(r)$ と文書の物をつなぐリンクは、`constraints` に入る。文書の物は `ref` で指す (逆変換は
id → ref を持ち、文書の物の id は `solid_<ref>` なので ref はそのまま一致する)。文書の物そのものは
読み戻さない。trace は `f_on_screen` から、入れた全実体と全制約へ張る。

### D4 — 拒否は「Layout の語で言えない物」だけ

$C(r)$ に Layout DSL で表せない種 (`ImportedMesh` / `MeasureLine` / `Profile` — 逆変換が
`unconvertible` として報告するもの) が入っていたら、理由つきで拒否する。新しい拒否の語は
`unconvertible` で、`has-children` と `linked` は退役する。拒否の語彙は閉じたままで、未宣言の
理由は throw する (原則 #31)。

### D5 — undo は ADR-159 D3 のまま

押下の瞬間のシーン全体のスナップショットで戻す。入れた物が N 個でも undo は 1 回。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

### 得られるもの

- 画面で留めた物 (箱に Fasten したワークなど) にも、その場で宣言できる。DEF-060 が消える。
- 取り込みと grasp 探索が、同じ逆変換の読みを使う (読みが 2 つにならない)。
- 拒否の理由が「まだ決めていない」から「カノニカルなモデルの語で言えない」に変わる。

### 払うもの

- 1 回の押下で、頼んだ物以外 (つながっている物) も文書に入る。
- 取り込んだ物はすべて compiled id (`solid_<ref>`) で作り直される (ADR-159 と同じ。数が増えるだけ)。
- シーン全体の逆変換を毎回走らせる。物が多いシーンでは押下が重くなりうる。

### 検証 (証拠) — 予定

論証木: `docs/gsn/adr-163-adopting-from-the-screen-reads-the-whole-scene-and-cuts-a-component.gsn`
(goal ごとの支えの正本。いまは全 goal が support-exploring で、満期は機械可読)。

- `src/domain/sceneAdoption.test.js`: 成分の切り出し (子・リンク・推移・無関係な物を入れない・
  文書の物を読み戻さない)、`unconvertible` の拒否、退役した 2 理由が語彙に無いこと。
- `src/ScreenAdoption.test.js`: Shift+A の箱 2 個を Fasten してから片方へ質量を宣言 → 2 個とリンクが
  文書へ入り、undo 1 回で戻る。文書の物へ留めた箱では、文書の物の `$decision` が保たれる。
- e2e: 画面で留めた物への宣言が DEF-060 を出さない。

### 波及 (blast radius)

| 触るもの | 中身 |
|---|---|
| `src/domain/sceneAdoption.js` | 計画を「全体を逆変換 → 成分を切る」に。拒否の語彙を差し替え |
| `src/context/DocBuilder.js` | `adoptSceneEntity` が実体 N 個と制約を受ける |
| `src/controller/ContextController.js` | 入れた数のトースト |
| `src/service/ContextService.js` | `adoptFromScene` は id 集合を受けるので形は変わらない見込み |
| `docs/DEFERRAL_LEDGER.md` | DEF-060 を消す |
| `docs/STATE_LEDGER.md` | 「シーン実体の宣言の有無」の行: 遷移の guard が `unconvertible` だけになる |

**触らない:** 契約 (`packages/grasp-contract`)、`core/`、逆変換 `decompileLayout` そのもの、
文書の物の権威 (ADR-129 / 131)。

## 残し

- 逆変換が言えない種 (`ImportedMesh` ほか) をカノニカルなモデルへ入れるかは、まだ決めていない。

## Lens notes

- §1.1: 逆変換の読みは 1 つ (grasp 探索と取り込みが共有)。張り替え規則 (案 B) を足さない。
- §1.4: 「宣言されていない → 宣言されている」の遷移が、1 回の押下で N 個に起きる (基数が 1 から N へ)。
  台帳 `docs/STATE_LEDGER.md` の行は実装の PR で更新する。
- 原則 #28: 逆変換は正規形までの逆で、文書の物の Why を運ばない。だから文書の物は読み戻さない。
- 原則 #31: 成分の N 個は、N=1 の fixture では区別できない — テストは 2 個以上で焼く。
