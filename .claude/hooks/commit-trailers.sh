#!/usr/bin/env bash
# commit-trailers.sh
# Claude Code PostToolUse hook (matcher: Bash)
#
# 直前の `git commit` が作ったコミットに、観測用トレーラを刻む:
#
#   Model-Effort: claude-opus-5/high        ← transcript が根拠 (申告ではない)
#   Task-Class:   feat/core+front            ← コミット自身から決定的に導出
#
# なぜ PostToolUse か:
#   - PreToolUse は任意のシェル文字列を書き換えることになる (heredoc・&& 連鎖・
#     引用の入れ子) — 壊し方が多すぎる。
#   - git の prepare-commit-msg hook は transcript を知らないので model/effort を
#     根拠づけられず、しかも**人間のコミットにもモデル名を付けてしまう**。
#     PostToolUse は Claude が作ったコミットにだけ発火するので帰属が正しい。
#
# なぜ `--amend --only` か:
#   素の `--amend` は **index にある変更を巻き込む**。`--only` を付けると HEAD の
#   tree のまま message だけ差し替わり、staged の変更はそのまま残る (実測確認済み)。
#
# 既知の穴 (塞げないので**数える**):
#   `git commit -m x && git push` のように 1 コマンドへ連鎖されると刻めない。
#   PostToolUse は push の**後**に発火し、公開済みコミットは amend できない。
#   PreToolUse は commit の**前**なので対象コミットがまだ存在しない。両者の間に
#   発火する hook は無い。そこで PreToolUse 側は連鎖を検出して**分けるよう促す**
#   だけにし (助言・非ブロック)、取りこぼしは `commit-meta.mjs report` の
#   「with Model-Effort」欄で母数として見えるようにしてある (原則 #31 —
#   不在を推測させず、数えて宣言する)。
#
# 規律: 何が起きても壊さない。判定・導出のどこかが失敗したら黙って素通り。
# 配線: .claude/settings.json の hooks.PreToolUse / hooks.PostToolUse (matcher "Bash")

set -uo pipefail

payload="$(cat)"
read_json() { printf '%s' "$payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

[ "$(read_json 'd.get("tool_name","")')" = "Bash" ] || exit 0
event="$(read_json 'd.get("hook_event_name","")')"

# --- PreToolUse: commit と push の連鎖を分けるよう促す (助言のみ) -------------
if [ "$event" = "PreToolUse" ]; then
  cmd="$(read_json 'd.get("tool_input",{}).get("command","")')"
  session="$(read_json 'd.get("session_id","")')"
  pre_cwd="$(read_json 'd.get("cwd","")')"
  [ -n "$cmd" ] || exit 0

  # 安い足切り (push を含まないコマンドで node を起動しない)。
  printf '%s' "$cmd" | grep -q 'push' || exit 0

  # 連鎖判定は **正規表現ではなく** トークン化して行う。素朴な grep は
  # コミットメッセージ本文 (heredoc / 引用の中) の文字列で誤発火する —
  # ADR-092 の導入コミット自身がそれを踏んだ。規則は
  # scripts/commit-meta.mjs の純粋関数にあり、テストで固定してある。
  pre_repo="$(git -C "${pre_cwd:-$PWD}" rev-parse --show-toplevel 2>/dev/null)" || exit 0
  [ -f "$pre_repo/scripts/commit-meta.mjs" ] || exit 0
  [ "$(node "$pre_repo/scripts/commit-meta.mjs" detect-chain --command "$cmd" 2>/dev/null)" = "chained" ] || exit 0

  # 鬱陶しい誤発動は「レンズを殺す」ので 1 セッション 1 回だけ (核 §6 シグナル(b))。
  marker_dir="${TMPDIR:-/tmp}/cc-commit-trailers"
  mkdir -p "$marker_dir" 2>/dev/null || exit 0
  marker="$marker_dir/${session:-nosession}.chain"
  [ -e "$marker" ] && exit 0
  : > "$marker" 2>/dev/null || exit 0

  python3 - <<'PY' 2>/dev/null || exit 0
import json
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": (
            "[commit-trailers hook — このセッションで 1 回だけ] "
            "`git commit` と `git push` が 1 コマンドに連鎖しています。この形だと "
            "観測トレーラ (Model-Effort / Task-Class) を刻む隙間が無く、"
            "そのコミットは分析対象から静かに漏れます。"
            "commit と push を別々の呼び出しに分けてください。"
        ),
    },
}))
PY
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
