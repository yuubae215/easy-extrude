# 116. 観測トレーラはコミット生成時に刻む — amend の後追いをやめる

- Status: **Proposed** (2026-08-08 起票。ADR-115 が欠測を数える側を閉じたので残るのは塞ぐ側。DEF-012 の満期がこの ADR)
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

## 未決 (採択前に決めること)

- `core.hooksPath` の設定を**どこが担保するか**。リモートセッションは毎回新しい
  クローンなので、設定が落ちれば同じ無言の失敗が戻る。SessionStart hook が有力だが、
  それ自体が新しい静かな失敗面になる — **だから ADR-115 の計数は塞いだ後も残す**
  (計数が落ちたことを計数が示す)。
- `prepare-commit-msg` 時点では HEAD がまだ動いていないので、`Task-Class` の
  パス集合は index (`git diff --cached --name-only`) から取る。`--amend` /
  merge / squash の各呼ばれ方 (`$2`) で母集団が変わるため、`deriveTaskClass` の
  呼び出し側を分岐させる必要がある。
- マーカーの「新しさ」の閾値。短すぎると長い commit で落ち、長すぎると人間の
  コミットを巻き込む。

## References

- ADR-092 (観測トレーラの導入 — §3 の機構を置き換える対象、§4 は ADR-115 が継承)
- ADR-115 (欠測の計数 — この ADR が採択されても**残す**)
- DEF-012 (`docs/DEFERRAL_LEDGER.md` — この ADR が満期)
