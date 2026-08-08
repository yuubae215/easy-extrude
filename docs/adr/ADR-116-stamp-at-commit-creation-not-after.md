# 116. 観測トレーラはコミット生成時に刻む — amend の後追いをやめる

- Status: Accepted (実装済み 2026-08-08 — `.githooks/prepare-commit-msg` が主経路。`git commit && git push` の連鎖でも刻めることを再現ラボで確認。**実装で 1 点変わった**: 予備経路を消さず残した)
- Date: 2026-08-08
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: 採択されれば **ADR-092 §3 の書き込み機構**を置き換える
  (§4 の「数える」は ADR-115 が引き継いでいるので残る)

## Context

ADR-092 は観測トレーラの書き手を Claude Code の **PostToolUse hook + `git commit
--amend --only`** に置いた。この形は commit の**後**に走るため、
`git commit && git push` と 1 コマンドに連鎖されると、発火時点で既に公開済みで
amend できない。ADR-092 §4 はこれを「塞げない穴」として正しく予告し、ADR-115 が
実測 14 件として数えた (母集団 56、被覆 75%)。

ADR-092 は git 自身の `prepare-commit-msg` hook を 2 つの理由で却下していた:

1. git hook は transcript を知らないので model/effort を**根拠づけられない**
   (`Co-Authored-By` の自己申告に退化する)。
2. **人間のコミットにもモデル名を付けてしまう** — 帰属が壊れる。

## 提案

両方の理由は、**PreToolUse がセッションの根拠を置く**ことで解ける:

- Claude Code の `PreToolUse` (matcher `Bash`、コマンドが `git commit` を含むとき) が
  `.git/claude-commit-context` に transcript パスと時刻を書く。PreToolUse は
  刻めないが、**刻むための根拠を置くこと**はできる (対象コミットがまだ無いことは
  障害にならない — 置くのは根拠であって結果ではない)。
- repo 管理の `.githooks/prepare-commit-msg` (`core.hooksPath` 経由) が、その
  マーカーが**新しいとき**だけトレーラを組み立ててメッセージファイルに足す。
  古い/無いマーカー = 人間が自分の端末で打ったコミットなので、何もしない (帰属は保たれる)。

得られるもの:

- **連鎖が無関係になる。** メッセージはコミットオブジェクトが出来る前に確定するので、
  push がいつ走ろうと関係ない。
- **amend が消える。** SHA が変わらないので、ADR-092 が原則 #11 に従って出していた
  「控えていた SHA は無効です」という通知そのものが不要になる。
- ガードが減る (公開済み判定・300 秒窓・merge/rebase 中・detached HEAD)。
  `prepare-commit-msg` は git がそれらを既に区別して呼ぶ。

## 決めたこと (起票時の「未決」への答え)

- **`core.hooksPath` は SessionStart hook が張る** (`.claude/hooks/install-git-hooks.sh`)。
  リモートセッションは毎回新しい clone なので、「毎回」に対応する事象はセッションの
  開始しかない。**既に別の値が入っていれば何もしない** — `core.hooksPath` を張ると
  `.git/hooks/` が丸ごと無効になるので、利用者の hook を奪ってはいけない。その場合は
  黙って諦めず理由を出力する (原則 #11)。
- **`Task-Class` の diff 基準は「これから出来るコミットの親」**。通常は `HEAD`、
  `--amend` では `HEAD^`、初回コミットでは空ツリー。**`--amend` かどうかは git から
  判別できない** (`--amend` も `-C` も `$2=commit`) ので、PreToolUse が
  コマンド文字列から読み取った**意図**をマーカーで運ぶ。負の対照で確認済み:
  基準を誤ると `--amend --no-edit` が `feat/none` に化ける (今回は `feat/docs+front`)。
- **マーカーの鮮度は 300 秒、かつ使い切り** (刻んだら消す)。鮮度だけに頼ると窓の
  あいだ人のコミットを巻き込むため。窓を広げれば帰属が壊れ、狭めれば刻み漏れが
  増える — どちらに倒れても `pnpm test:trailers` が個数で見せる。

## 実装で変わったこと

**予備経路 (PostToolUse の amend) を消さずに残した。** 起票時は「ADR-092 §3 の機構を
置き換える」と書いたが、`core.hooksPath` が張られていない clone では
`prepare-commit-msg` が走らないので、消すとその場合に**何も刻まれず今より悪くなる**。
予備経路は冪等 (既に同じ値が在れば no-op) なので二重刻印にはならない。主経路が
死んだことは ADR-115 の計数が示す — 置き換えではなく**主経路の移動 + 予備の残置**が
正しい形だった。

連鎖の助言は消さずに**条件を狭めた**: `prepare-commit-msg` が張られていれば
`commit && push` は無害なので、そこで警告するのは誤発動でしかない (核 §6 シグナル(b))。
hook が張られていない clone でだけ出す。文面も「分けてください」から
「この clone には hook が張られていません」へ変えた — 助言が指すべきは症状ではなく原因。

## Consequences

- **Evidence (§1.2):** スクラッチ repo (bare remote + clone + 同じ hook) で 4 形を実測:
  (a) マーカーあり + `git commit && git push` を 1 コマンド → **刻印済** (ADR-115 が
  数えた穴が閉じた)、(b) マーカー無し (人間のコミット) → **刻まない**、
  (c) 600 秒前のマーカー → **刻まない**、(d) マーカーは使い切りなので同一呼び出しの
  2 本目 → 刻まない (予備経路が拾う)。`pnpm test:commit-meta` 26 件 pass。
- **残る欠測** (数える対象・塞いでいない): 1 つの Bash 呼び出しで 2 つ以上 commit した
  ときの 2 本目以降 (予備経路が HEAD だけ拾う)、`core.hooksPath` を既に持つ clone。
  どちらも `pnpm test:trailers` の母数に現れる。

### 主経路は、死んでも計数からは見えない (実装当日に踏んだ)

**ADR-115 の計数は結果を数えており、経路を数えていない。**書き手が 2 つある以上、
予備が覆っているあいだ被覆率は 100% のままで、主経路が一度も動いていなくても緑が出る。

実際に踏んだ。PreToolUse がマーカーを書く呼び出しは、モジュールのパスを **argv で**
渡していた:

```bash
node -e 'import(process.argv[1]).then(...)' "$pre_meta" "$pre_transcript" "$pre_amend"
```

`commit-meta.mjs` の `isMain` 判定は `import.meta.url === file://${process.argv[1]}` なので
**これが真になる**。ライブラリとして import したつもりの呼び出しで CLI が起動して
usage を吐き、マーカーは一度も書かれなかった。主経路は最初から動いておらず、
予備経路が全部拾っていたので**トレーラは正しく付いていた**。

気づけたのは予備経路の副作用の告知 (「SHA が変わりました」) が毎コミット出ていたから
であって、検査ではない。告知は人が読む文字列であって機械が読む信号ではない — これは
ADR-109 D3 / ADR-115 力学 1 と**同じ形**である (宣言は在る、読む機械が無い)。

修正は 2 つ: パスを **env で渡す** (argv だと `isMain` が誤爆し、JS 文字列リテラルへ
埋め込むと引用の入れ子で壊れる — env はどちらの罠も踏まない)、そして
**`scripts/prepare-commit-msg.test.mjs`** を足して *hook を実際に走らせる*。
一時 repo に `core.hooksPath` を張り、連鎖・人間のコミット・古いマーカー・使い切り・
`--amend` の基準・マージを 8 件で焼いた。今日のバグはこの層でしか捕まらない。
- **波及 (blast radius):** 新規 `.githooks/prepare-commit-msg` +
  `.claude/hooks/install-git-hooks.sh` + `.claude/settings.json` の SessionStart。
  `commit-meta.mjs` に純粋関数 3 つ (`subjectFromMessage` / `buildCommitContext` /
  `parseCommitContext`) と `derive --message-file` 経路。`commit-trailers.sh` の
  PreToolUse を書き換え。**`src/` は 1 行も触っていない。** `MISSING_BASELINE` は
  14 のまま (過去の欠測は遡及して直らない)。

## Lens notes

- **§1.1 真実の源は一つ:** マーカーの書式は `buildCommitContext` /
  `parseCommitContext` の対で 1 箇所。書き手 (PreToolUse・bash) と読み手
  (`prepare-commit-msg`・bash) がそれぞれ `key=value` を実装すると第二の源になる
   — どちらも node を呼んで同じ関数を通す。
- **原則 #3 (純粋/副作用の分離):** 追加した 3 関数はすべて文字列 → 値。git も fs も
  触らない。副作用は CLI と 2 つの shell hook だけ。
- **ADR-092 の却下理由は間違っていなかった。** 当時の前提 (git hook は transcript を
  知らない) は正しく、変わったのは**根拠を置く場所を分けられる**と気づいたこと。
  PreToolUse は*刻めない*が*根拠は置ける* — 「刻む」と「根拠を持つ」を 1 つの
  イベントで満たそうとしていたのが元の制約だった。

## References

- ADR-092 (観測トレーラの導入 — §3 の**機構**をこの ADR が主経路から降ろした。
  §4「塞げない穴は数える」は ADR-115 が継承)
- ADR-115 (欠測の計数 — この ADR が採択されても**残す**。主経路が死んだことを示すのが計数)
- ADR-100 (ratchet の形), ADR-102 (母集団の導出)
