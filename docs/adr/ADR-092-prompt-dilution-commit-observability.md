# 092. 常時ロードから一般モデル挙動の写しを外し、観測はプロンプトではなくコミットに刻む

- Status: Accepted (実装済)
- Date: 2026-07-25
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: **§3 の書き込み機構は ADR-116 が主経路から降ろした**
  (PostToolUse の `--amend` → `prepare-commit-msg`。予備経路としては残置)。
  §4「塞げない穴は数える」は ADR-115 が検査として実装した — 本 ADR の決定は
  正しく、欠けていたのは数を読む機械だった
- 状態台帳: `docs/STATE_LEDGER.md` の「コミットの観測メタデータ」行 (基数 `0..1` —
  0 = 人間のコミット / 刻む隙間が無かったもの)。遷移の正本は
  `docs/STATE_TRANSITIONS.md` §Commit observation metadata

## Context — Goal と力学 (§1.2)

要件は二つの解の形で来た:「トレーラ拡張の hook を書く」「behavior doc を消す」。
Goal へ持ち上げると一つに繋がる — **統治を、読ませて守らせる散文から、
書く瞬間に問われる機械へ移す**。散文は増えるほど原則を引き当てるコストを上げ、
守られなさを悪化させる (CLAUDE.md「After fixing a bug」Q3 が名指しする希釈)。

- **G1 — 常時ロードの希釈を減らす**: 毎回先頭に載る文書から、プロジェクト固有で
  ないものを外す。
- **G2 — 作業を後から解析可能にする**: どのモデルが・どの effort で・どの種類の
  作業をしたかを、事後に集計できる形で残す。
- **G3 — G2 の記録がプロンプト負荷を増やさない**: 観測のために「毎回こう書け」と
  散文を足したら G1 と衝突する。

### 力学 — 実測した現状 (2026-07-25)

**(1) 常時ロード 60,005 字のうち 25,411 字 (42.3%) が一般モデル挙動の写しだった。**
`docs/CLAUDE_FABLE5_BEHAVIOR.md` の中身は製品情報・拒否の扱い・トーン・箇条書きの
作法・ウェルビーイング・検索と著作権 — プロジェクト固有語の出現は **0 件**
(`easy-extrude`/`grasp`/`ADR-`/`src/` 等で grep して一致なし)。モデルとハーネスが
既定で持つ規範の複製であり、**同じ事実の第二の源** (核 §1.1)。

**(2) しかもその写しは、走っているモデルについて偽を述べていた。** 文書は
「This iteration of Claude is Claude Fable 5」「知識カットオフは 2026-01 末」と
断言する。7 月の Claude 作成コミット 69 本の内訳は Opus 4.8 が 30、Fable 5 が 28、
Opus 5 が 9、Sonnet 5 が 2 — **41 本 (59%) は Fable 5 以外**が書いており、その全
セッションに「あなたは Fable 5 です」という 25K 字が載っていた。希釈だけでなく
誤情報でもある。

**(3) 記録がモデル名しか無く、母集団が読めなかった。** コミットに残るのは
`Co-Authored-By:` だけ。しかもこれは**モデルが散文で書く申告**なので、忘れれば
欠ける (7 月の 74 本中 5 本が無記名)。effort もタスク種別も残っていないため、
「7 月の 74 本」は「モデル名 × コミット統計」以上には読めなかった。

**(4) 一方で `effort` は既に観測可能だった。** セッション transcript (JSONL) の
`assistant` 行は `effort` と `message.model` を持つ (実測: `effort: "high"`,
`model: "claude-opus-5"`)。**新しく記録を発明する必要はなく、既にある事実を
コミットへ写せばよい** — 第二の源を作らず、参照を繋ぐだけの問題だった。

## Decision

### 1. `docs/CLAUDE_FABLE5_BEHAVIOR.md` を削除し、`CLAUDE.md` の `@` import を外す

プロジェクト固有情報の損失は 0。常時ロードは **60,005 → 34,561 字 (−42.4%)**。

規範の所有者はモデル/ハーネス側であって repo ではない。repo が持つべきは
**このプロジェクトでしか成り立たない制約**だけ (核 §4「核には方法だけを置き、
インスタンスは置かない」の repo 版)。

### 2. 観測トレーラは PostToolUse hook が刻む (`.claude/hooks/commit-trailers.sh`)

```
Model-Effort: claude-opus-5/high      ← transcript が根拠 (申告ではない)
Task-Class:   feat/core+front          ← コミット自身から決定的に導出
```

*なぜ PostToolUse か。* PreToolUse は任意のシェル文字列 (heredoc・`&&` 連鎖・
引用の入れ子) を書き換えることになり壊し方が多すぎる。git の `prepare-commit-msg`
は transcript を知らないので model/effort を根拠づけられず、しかも**人間のコミット
にもモデル名を付けてしまう**。PostToolUse は Claude が作ったコミットにだけ発火する
ので帰属が正しい。

*なぜ `--amend --only` か。* 素の `--amend` は index にある変更を巻き込む。`--only`
なら HEAD の tree のまま message だけ差し替わり、staged の変更は残る (実測確認済)。

*刻まない条件 (安全側に倒す)*: 公開済み (`git branch -r --contains HEAD` が非空) /
rebase・merge 進行中 / detached HEAD / マージコミット / 直近 300 秒に新しい
コミットが無い (= コマンドが失敗した)。いずれも該当したら黙って素通りする。

### 3. Task-Class は**モデルの自己申告にしない** — コミットから決定的に導出する

`<conventional type>/<触れたレイヤ>`。レイヤ写像は CLAUDE.md のスコープ境界表
(front / bff / core / contract / docs / governance / build) をそのまま使い、
新しい境界を発明しない。

自己申告を採らない理由は二つ。**(a)** 申告はプロンプトに「毎回こう書け」を足す —
本 ADR の G1 と正面衝突する (G3)。**(b)** 決定的なら**既存履歴にも遡及適用できる**。
実際 7 月の 74 本は今日から分類済みで読める (effort だけは遡及不能 — 記録が源)。

導出規則の正本は `scripts/commit-meta.mjs` の純粋関数に一本化した。hook (書き手) と
`report` (読み手) が別々に「タスク種別とは何か」を実装すると、遡及分類と新規分類が
静かにズレる (§1.1)。

### 4. 塞げない穴は**数える** (原則 #31)

`git commit -m x && git push` と 1 コマンドに連鎖されると刻めない。PostToolUse は
push の**後**に発火し公開済みコミットは amend できず、PreToolUse は commit の**前**
なので対象がまだ無い。両者の間に発火する hook は存在しない。

そこで穴を隠さず二段で可視化する: PreToolUse が連鎖を検出して**分けるよう促し**
(助言・非ブロック・1 セッション 1 回)、取りこぼしは `report` の
`with Model-Effort: N / 総数` として**母数に現れる**。不在を推測させず、数えて宣言する。

*連鎖判定は文字列でなく構造で行う。* 最初の実装はコマンド文字列への正規表現で、
**本 ADR を導入するコミット自身で誤発火した** — hook に渡るコマンド文字列には
heredoc のコミットメッセージ本文が含まれ、そのメッセージが「`git commit && git push`
の連鎖」と*説明していた*ため。修正は heredoc を落とし引用を尊重してトークン化し、
shell の区切り (`&&` / `;` / `||` / **改行**) でセグメント化する形
(`detectsCommitPushChain`)。この過程で「改行はコマンド区切り」を落としていたことも
露見し、別行の `git push` を見落としていた。教訓は Yellow Cards と
CODE_CONTRACTS「統治 hook のトリガ判定は構造で行う」に降ろした — 入力が
**判定ルール自体に言及しうる**場 (コミットメッセージ・ログ・プロンプト) では、
文字列判定は必ず破れる。

## Consequences

- 常時ロード −42.4%。失うプロジェクト固有情報は 0。
- 以後のコミットは `Model-Effort` / `Task-Class` を持ち、`pnpm metrics:commits` で
  モデル × effort × タスク種別が読める。`Co-Authored-By` の申告と transcript の
  実測が食い違うコミットは report が警告する (申告の信頼性そのものを観測対象にする)。
- **amend により SHA が変わる。** 直前に控えた SHA は無効になるため、hook は
  `additionalContext` と `systemMessage` で変化を告げる (原則 #11 — 黙って変えない)。
- 分類規則の変更は遡及分類と新規分類を同時に動かす。CI の `pnpm test:commit-meta`
  が規則を固定し、「追跡中の全ファイルが宣言済みレイヤに落ちる」ことも個数で検査する
  (新しいトップレベルディレクトリはどのバケツにも現れないまま漏れるため — 原則 #31)。

## Evidence (§1.2)

| Goal | Evidence |
|------|----------|
| G1 希釈が減った | `wc -c` で 60,005 → 34,561。削除文書のプロジェクト固有語 grep が 0 件 |
| G2 解析可能になった | `pnpm metrics:commits` が 7 月 74 本をタスク種別で分類 (遡及導出)。以後は effort も乗る |
| G3 プロンプトを増やしていない | 導出は transcript とコミットのみが入力。CLAUDE.md への追記は 0 行 |
| hook が壊さない | 実測: staged 変更が amend を跨いで保持 / 再実行で SHA 不動 (冪等) / push 済みは skip / 壊れた payload で fail-open |
| 規則が固定される | `scripts/commit-meta.test.mjs` 13 本、CI ステップ `Commit metadata derivation rules` |

## References

- ADR-082 (契約 submodule の repo 内吸収 — 壁は散文でなく CI ガードで守る、の先例)
- ADR-086 (決定的スライスだけを必須 gate に落とす)
- PHILOSOPHY #31 (Zero Is a State That Does Not Look Like One), #19, #11, #1
- 核 §1.1 (真実の源は一つ), §1.2 (正当化の鎖), §4 (セッション間契約の二経路)
- CLAUDE.md「After fixing a bug」Q3 (ルールは*どこで問われるか*)
- 先行コミット `4b76d0d` chore(governance): 原則を「読む場所」から「問われる場所」へ降ろす
