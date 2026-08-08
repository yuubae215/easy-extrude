#!/usr/bin/env bash
# commit-trailers.sh
# Claude Code PreToolUse + PostToolUse hook (matcher: Bash)
#
# 観測用トレーラの主経路は **`.githooks/prepare-commit-msg`** に移った (ADR-116)。
# このファイルが持つのは、その両側の 2 つの役だけ:
#
#   PreToolUse  — 刻むための**根拠を置く** (`.git/claude-commit-context`)。
#   PostToolUse — git hook が張られていない clone のための**予備経路** (amend)。
#
#   Model-Effort: claude-opus-5/high        ← transcript が根拠 (申告ではない)
#   Task-Class:   feat/core+front            ← 変更集合から決定的に導出
#
# なぜ主経路を移したか (ADR-092 §3 → ADR-116):
#   PostToolUse は commit の**後**に走るので、`git commit && git push` と 1 コマンドに
#   連鎖されると発火時点で既に公開済みで amend できない。ADR-092 §4 はこれを
#   「塞げない穴」として正しく予告し、ADR-115 が実測 14 件として数えた。
#   `prepare-commit-msg` はコミットオブジェクトが出来る**前**に走るので連鎖が
#   無関係になり、amend しないので SHA も動かない。
#
#   ADR-092 が git hook を却下した 2 理由は、マーカー経由で両方解けた:
#   「transcript を知らない」→ PreToolUse が置く。「人間のコミットにも付く」→
#   マーカーが新しいときだけ刻む (人が自分の端末で打った commit には無い)。
#
# なぜ予備経路を残すか (ADR-116 の実装で変わった点):
#   `core.hooksPath` が張られていない clone では prepare-commit-msg が走らない。
#   主経路を消してしまうとその場合に**何も刻まれず**、今より悪くなる。予備経路は
#   冪等 (既に同じ値が在れば何もしない) なので二重刻印にはならない。
#
# なぜ `--amend --only` か (予備経路):
#   素の `--amend` は **index にある変更を巻き込む**。`--only` を付けると HEAD の
#   tree のまま message だけ差し替わり、staged の変更はそのまま残る (実測確認済み)。
#
# 取りこぼしは `pnpm test:trailers` が個数で数える (ADR-115 — 原則 #31)。
#
# 規律: 何が起きても壊さない。判定・導出のどこかが失敗したら黙って素通り。
# 配線: .claude/settings.json の hooks.PreToolUse / hooks.PostToolUse (matcher "Bash")

set -uo pipefail

payload="$(cat)"
read_json() { printf '%s' "$payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

[ "$(read_json 'd.get("tool_name","")')" = "Bash" ] || exit 0
event="$(read_json 'd.get("hook_event_name","")')"

# --- PreToolUse: 刻むための「根拠」を置く (ADR-116) ---------------------------
# PreToolUse は commit の前なので**刻めない**が、刻むための根拠を置くことはできる。
# `.git/claude-commit-context` に transcript パスと時刻を書き、コミット生成時に
# 走る .githooks/prepare-commit-msg がそれを読む。マーカーの存在そのものが
# 「いま Claude が commit を走らせている」証拠であり、人間のコミットに刻まない
# ための唯一の判別になる (帰属 — ADR-092 §2)。
if [ "$event" = "PreToolUse" ]; then
  cmd="$(read_json 'd.get("tool_input",{}).get("command","")')"
  session="$(read_json 'd.get("session_id","")')"
  pre_cwd="$(read_json 'd.get("cwd","")')"
  pre_transcript="$(read_json 'd.get("transcript_path","")')"
  [ -n "$cmd" ] || exit 0

  # 安い足切り (commit を含まないコマンドで node を起動しない)。
  printf '%s' "$cmd" | grep -Eq 'git[^|;&]*commit' || exit 0
  # dry-run は hook を走らせないので、マーカーを置くと古いまま残る。
  printf '%s' "$cmd" | grep -Eq '\-\-dry-run' && exit 0

  pre_repo="$(git -C "${pre_cwd:-$PWD}" rev-parse --show-toplevel 2>/dev/null)" || exit 0
  pre_git_dir="$(git -C "$pre_repo" rev-parse --absolute-git-dir 2>/dev/null)" || exit 0
  pre_meta="$pre_repo/scripts/commit-meta.mjs"
  [ -f "$pre_meta" ] || exit 0

  # `--amend` かどうかは git 側から判別できない (`--amend` も `-C` も source=commit)
  # ので、コマンドの**意図**をここで写して運ぶ。Task-Class の diff 基準が 1 段ずれる
  # (親が HEAD^ になる) のはこの情報が無いと決められない。
  pre_amend=0
  printf '%s' "$cmd" | grep -q -- '--amend' && pre_amend=1

  # 書式の正本は commit-meta.mjs の buildCommitContext (第二の源を作らない)。
  node -e '
    import(process.argv[1]).then((m) => {
      process.stdout.write(m.buildCommitContext({
        transcript: process.argv[2] || null,
        amend: process.argv[3] === "1",
        nowSec: Date.now() / 1000,
      }));
    }).catch(() => process.exit(1));
  ' "$pre_meta" "$pre_transcript" "$pre_amend" > "$pre_git_dir/claude-commit-context" 2>/dev/null \
    || rm -f "$pre_git_dir/claude-commit-context" 2>/dev/null

  # --- 連鎖の助言は「git hook が入っていないとき」だけ --------------------------
  # prepare-commit-msg が張られていれば `commit && push` は無害になった (刻印が
  # push より前に済む) ので、そこで警告するのは誤発動でしかない (核 §6 シグナル(b))。
  # 張られていないときだけ、予備経路 (PostToolUse の amend) の穴が生きている。
  pre_hooks_path="$(git -C "$pre_repo" config --get core.hooksPath 2>/dev/null)"
  case "$pre_hooks_path" in
    '')  pre_hook_file="$pre_git_dir/hooks/prepare-commit-msg" ;;
    /*)  pre_hook_file="$pre_hooks_path/prepare-commit-msg" ;;
    *)   pre_hook_file="$pre_repo/$pre_hooks_path/prepare-commit-msg" ;;
  esac
  [ -x "$pre_hook_file" ] && exit 0

  printf '%s' "$cmd" | grep -q 'push' || exit 0
  [ "$(node "$pre_meta" detect-chain --command "$cmd" 2>/dev/null)" = "chained" ] || exit 0

  # 鬱陶しい誤発動は「レンズを殺す」ので 1 セッション 1 回だけ (核 §6 シグナル(b))。
  marker_dir="${TMPDIR:-/tmp}/cc-commit-trailers"
  mkdir -p "$marker_dir" 2>/dev/null || exit 0
  marker="$marker_dir/${session:-nosession}.chain"
  [ -e "$marker" ] && exit 0
  : > "$marker" 2>/dev/null || exit 0

  python3 - <<'ADVISE' 2>/dev/null || exit 0
import json
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": (
            "[commit-trailers hook — このセッションで 1 回だけ] "
            "この clone には .githooks/prepare-commit-msg が張られていません "
            "(`git config core.hooksPath .githooks`)。そのため観測トレーラは "
            "PostToolUse の amend でしか刻めず、`git commit` と `git push` を "
            "1 コマンドに連鎖させるとそのコミットは分析対象から静かに漏れます "
            "(ADR-115 が数えた 14 件の形)。commit と push を別々の呼び出しに "
            "分けてください。"
        ),
    },
}))
ADVISE
  exit 0
fi

[ "$event" = "PostToolUse" ] || exit 0

command_str="$(read_json 'd.get("tool_input",{}).get("command","")')"
transcript="$(read_json 'd.get("transcript_path","")')"
cwd="$(read_json 'd.get("cwd","")')"
[ -n "$command_str" ] || exit 0

# --- コミットを作りうるコマンドか (本判定は下の git 状態検査) ----------------
printf '%s' "$command_str" | grep -Eq 'git[^|;&]*commit' || exit 0
printf '%s' "$command_str" | grep -Eq '\-\-dry-run' && exit 0

repo="$(git -C "${cwd:-$PWD}" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0
g() { git -C "$repo" "$@"; }

# --- 実際に「いま」コミットが出来ているか ------------------------------------
# コマンドが失敗していれば HEAD は古いまま。時刻で見るのが最も素直な成功判定。
committed_at="$(g log -1 --format=%ct 2>/dev/null)" || exit 0
[ -n "$committed_at" ] || exit 0
now="$(date +%s)"
[ "$((now - committed_at))" -le 300 ] || exit 0

# --- 触ってはいけない状態を除外 ----------------------------------------------
# 進行中の rebase / merge 中に HEAD を書き換えない。
[ -e "$repo/.git/MERGE_HEAD" ] && exit 0
[ -d "$repo/.git/rebase-merge" ] && exit 0
[ -d "$repo/.git/rebase-apply" ] && exit 0

# detached HEAD では amend の行き先が曖昧なので触らない。
g symbolic-ref -q HEAD >/dev/null 2>&1 || exit 0

# マージコミットは変更集合を持たないので分類の意味が無い。
[ "$(g rev-list --parents -n 1 HEAD | wc -w)" -le 2 ] || exit 0

# **公開済みなら絶対に書き換えない。** amend は SHA を変えるので、push 済みの
# コミット (`git commit && git push` のような連鎖) を amend すると履歴が分岐する。
remote_has="$(g branch -r --contains HEAD 2>/dev/null | head -1)"
[ -z "$remote_has" ] || exit 0

# --- トレーラを導出 -----------------------------------------------------------
meta_script="$repo/scripts/commit-meta.mjs"
[ -f "$meta_script" ] || exit 0
trailers="$(node "$meta_script" derive --transcript "$transcript" --repo "$repo" --rev HEAD 2>/dev/null)" || exit 0
[ -n "$trailers" ] || exit 0

model_effort="$(printf '%s\n' "$trailers" | grep '^Model-Effort:' | head -1)"
task_class="$(printf '%s\n' "$trailers" | grep '^Task-Class:' | head -1)"
[ -n "$model_effort" ] && [ -n "$task_class" ] || exit 0

# 既に同じ値が入っているなら何もしない (amend を繰り返して SHA を動かさない)。
existing="$(g log -1 --format='%(trailers:key=Model-Effort,valueonly,separator=%x2c)%(trailers:key=Task-Class,valueonly,separator=%x2c)' 2>/dev/null)"
want="${model_effort#Model-Effort: }${task_class#Task-Class: }"
[ "$existing" = "$want" ] && exit 0

# --- 刻む ---------------------------------------------------------------------
# --if-exists replace: 同じ key が既にあれば置換 (amend を跨いでも重複しない)。
new_msg="$(g log -1 --format=%B | g interpret-trailers \
  --if-exists replace \
  --trailer "$model_effort" \
  --trailer "$task_class" 2>/dev/null)" || exit 0
[ -n "$new_msg" ] || exit 0

before="$(g rev-parse --short HEAD)"
# 元の author を保つ (committer は amend した主体なので更新されてよい)。
GIT_AUTHOR_NAME="$(g log -1 --format=%an)" \
GIT_AUTHOR_EMAIL="$(g log -1 --format=%ae)" \
GIT_AUTHOR_DATE="$(g log -1 --format=%aI)" \
  g commit --amend --only --no-edit --quiet -m "$new_msg" 2>/dev/null || exit 0
after="$(g rev-parse --short HEAD)"

# SHA が変わったことは黙らせない (原則 #11): 直前に控えた SHA は無効になる。
python3 - "$before" "$after" "$model_effort" "$task_class" <<'PY' 2>/dev/null || exit 0
import json, sys
before, after, me, tc = sys.argv[1:5]
msg = f"観測トレーラを刻みました ({before} → {after}): {me} / {tc}"
print(json.dumps({
    "suppressOutput": True,
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": (
            f"[commit-trailers hook] 直前のコミットに観測トレーラを付与し、amend したため "
            f"SHA が {before} → {after} に変わりました。控えていた SHA は無効です。\n"
            f"  {me}\n  {tc}"
        ),
    },
    "systemMessage": msg,
}))
PY
exit 0
