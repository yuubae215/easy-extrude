# 120. 評価できなかった objective は 0 点ではない — 分母に居座る空位を外す

- Status: Accepted (D2/D3 実装済み 2026-08-12 — スタブレーンとクライアント。**D1 は `core/` 側に残っている**: 下の実施記録)
- 実施記録: 鍵の不在で「測っていない」を運ぶ規律 (D2) と、それを 0 のバーで描かない
  提示 (D3) は、スタブレーン (`mocks/graspStub/solve.js`) と `src/view/GraspScoreMath.js` +
  `GraspSearchPanel` で実装済み。**分母の式そのもの (D1) は `core/easy_extrude_core/engine/scoring.py`
  にあり未着手** — 登録簿 DEF-013。順序はこちらが先: `core/` を先に直しても、スタブが
  `reach_margin: 0` を載せ続けるかぎり画面では確認できない (フロントは `plan{}` を
  集めていないので、既定の実行ではリーチ範囲が常に未宣言)。
- Date: 2026-08-11 (D2/D3 実装 2026-08-12)
- Deciders: yuubae215, Claude
- 段: **G-0** (`docs/grasp/implementation-order.md` — grasp レーンの順序表)。D1 は G-1 (ADR-121) の前提
- Supersedes / Superseded by: なし (ADR-105「未検証は問題なしではない」のスコア層版)

## Context

`core/engine/scoring.py:weighted_sum` はこうなっている:

```python
for name, w in weights.items():
    weight_sum += w                    # 評価できなくても分母に入る
    s = objective_scores.get(name)
    if s is not None:
        total += w * s                 # 分子には入らない
return total / weight_sum
```

**評価できなかった objective は、分母に満額で効いて分子に 0 で効く。** docstring は
「寄与 0 (評価不能な objective)」と*意図として*書いているが、これは
**「評価不能」と「0 点」を同じ数に潰している**。

実害はもう出ている。`reach_margin` はリーチ範囲 (`plan.reachMin/reachMax`) が
未宣言だと常に 0 になる。それは「余裕ゼロ」ではなく「測っていない」なのに、
同じ数として totalScore を押し下げている。候補間の順位は一様スケールなので変わらないが、
**絶対値が下がる** — 契約が「絶対基準なのでリクエスト間で比較可能」と明言している、
その比較可能性が静かに壊れている。

ADR-105 が場の集約で潰した「未検証と問題なしの混同」と同じ形で、今度はスコア層。

## Decision

### D1 — 重み付けされていても評価できなかった objective は、分子からも**分母からも**外す

`weight_sum` に加えるのは、実際に評価できた objective の重みだけ。totalScore は
「評価できたものの加重平均」になり、リクエスト間の比較可能性が保たれる。

### D2 — 評価しなかったことは `objectiveScores` の**鍵の不在**が表す

`core/` は既に未知の名前を返り値から落としている (`evaluate_objectives`)。同じ規律を
「知っているが評価できなかった」にも適用する。閉じたスコア層に「評価できなかった名前」の
欄を足す案 (版上げが要る) は却下 — ADR-060 が抑えている「optional 兄弟を生やさない」に
触れるうえ、不在で表現できることに欄を作る理由がない。

### D3 — クライアントは鍵の不在を「測っていない」として描く

バーを 0 で描かない。何が評価されなかったかを言う。これは提示なのでクライアント側
(原則 #29)。

## Consequences

### 得られるもの

- リーチ範囲を宣言していないリクエストのスコアが、宣言しているものと比較できるようになる。
- 重心 (ADR-121) を入れたとき、重心不在で `com_offset` が評価できなくても、
  他の候補が不当に低く見えることがない — **この ADR が先に要る理由**。

### 実装で分かったこと — 同じ欠陥がスタブにも居た

`core/` を直す前にスタブを開いたら、**同じ形の欠陥が二人目の生産者にも独立に居た**:
`solve.js` はリーチ範囲が未宣言のとき `reachMargin = 0` を載せていて、コメントは
`// undeclared envelope → no margin to report` と*意図*まで書いてあった。`core/` の
docstring が「寄与 0 (評価不能な objective)」と書いていたのと同じ形である。

意図が書いてあるのに値が嘘をつく、というのがこの ADR の主題そのもので、**書いた人が
その瞬間に問われる場所が無い**かぎり二人目・三人目が同じ形を再生産する。だから成果物は
散文ではなく検査にした (原則 #19 Q3) — スタブは契約の第二の生産者なので、
`conformance.test.js` が `core/` と同じ規律で縛る。

### 払うもの

- **応答の数値が変わる。** スキーマは変わらないので版上げ対象外だが、`core/` の
  数値テストは動く。既存の記録と比較するときは境界をまたぐ。
- 「全部評価できなかった」ときの totalScore が未定義になる (分母 0)。0 を返すか
  鍵ごと落とすかは実装時に決める — **どちらにせよ「0 点」と区別できる形**にすること。

### 検証 (証拠)

**値で比較すると「評価不能」と「0 点」はまさに同じに見える。だから検査は鍵の不在を問う**
— 検査の書き方そのものがこの ADR の主張である。

| 主張 | 問い所 | 状態 |
|------|-------|------|
| 評価不能な objective が分母に入らない | `mocks/graspStub/conformance.test.js`「評価できない objective に重みを付けても totalScore は動かない」 | ✅ スタブレーン |
| 同じ主張を実ソルバで | `core/tests/test_engine.py` — 同じ候補で重み 1 個追加しても totalScore が変わらない | ⬜ DEF-013 |
| 評価不能と 0 点が区別できる (ワイヤ) | 同上「リーチ範囲を宣言していなければ reach_margin は 0 ではなく鍵ごと出ない」— 宣言あり側との対照込み | ✅ |
| 評価不能と 0 点が区別できる (画面) | `src/view/GraspScoreMath.test.js`「未評価は 0 点と別物」+ e2e S8 | ✅ |
| 母集団が要求した重みである (不在を数えられる) | `GraspScoreMath.test.js`「要求した objective は全部行になる」 | ✅ |
| 測れなかったことが無言の省略にならない | e2e S8 — 画面に `not measured: <名前>` が出ること | ✅ |

論証木: `docs/gsn/adr-120-unevaluated-is-not-zero.gsn`
