#!/usr/bin/env bash
# state-ledger-nudge.sh
# Claude Code PreToolUse hook (matcher: Edit|Write)
#
# 核 §1.4 / §2 を **書く瞬間**に問う層。
#
# なぜ commit 時ではないのか: 既存の evidence-before-commit.sh は `git commit` で
# 発火する — コードを書き終わり、構造をやり直すコストが最大化した後である。
# 状態集合の設計と同一性の所有者は、書く前に決まっていなければ意味がない。
#
# 規律 (誤発動は「鬱陶しいレンズ」= 核 §6 シグナル(b) なので、狭く・一度だけ):
#   - ブロックしない。exit 0 + additionalContext で助言するだけ。
#   - 対象は src/ と core/ の実装ファイルのみ (テスト・ドキュメントは除外)。
#   - トリガ種別ごとに **1 セッション 1 回**だけ発火 (マーカーファイルで抑制)。
#   - 判定・JSON 生成のどこかが失敗したら黙って素通り (fail-open)。
#
# 配線: .claude/settings.json の hooks.PreToolUse (matcher "Edit|Write")
#
# 注意: hook の入出力スキーマは更新され得る。現行仕様は Claude Code の
#       hooks ドキュメントで確認のこと (additionalContext が無視されても
#       fail-open で害はない)。

set -uo pipefail

payload="$(cat)"
read_json() { printf '%s' "$payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

file_path="$(read_json 'd.get("tool_input",{}).get("file_path","")')"
session_id="$(read_json 'd.get("session_id","")')"
# Edit は new_string、Write は content
added="$(read_json 'd.get("tool_input",{}).get("new_string") or d.get("tool_input",{}).get("content") or ""')"

[ -n "$file_path" ] || exit 0
[ -n "$added" ]     || exit 0

# --- 対象ファイルの絞り込み -------------------------------------------------
case "$file_path" in
  *"/src/"*.js|*"/core/"*.py) ;;
  *) exit 0 ;;
esac
case "$file_path" in
  *.test.js|*_test.py|*/tests/*) exit 0 ;;
esac

# --- トリガ判定 -------------------------------------------------------------
# A: 同一性の duck-type — 実体を名前の等値で同定しようとしている
#    (原則 #2「能力分岐は型で」/ §1.1「同一性の源は一つ」)
trigger=""
if printf '%s' "$added" | grep -Eq '\.name[[:space:]]*[!=]==?[[:space:]]*("|'"'"'|[A-Z_]{3,})'; then
  trigger="identity"
# B: 状態リテラルの導入 — status/mode/phase/substate に文字列を割り当てている
elif printf '%s' "$added" | grep -Eiq '(status|mode|phase|substate|drawstate|opstate)[[:space:]]*[:=][[:space:]]*("|'"'"')'; then
  trigger="state"
fi
[ -n "$trigger" ] || exit 0

# --- 1 セッション 1 回に抑制 ------------------------------------------------
marker_dir="${TMPDIR:-/tmp}/cc-state-ledger"
mkdir -p "$marker_dir" 2>/dev/null || exit 0
marker="$marker_dir/${session_id:-nosession}.$trigger"
[ -e "$marker" ] && exit 0
: > "$marker" 2>/dev/null || exit 0

# --- 助言を組み立てる -------------------------------------------------------
if [ "$trigger" = "identity" ]; then
  body="この編集は実体を **名前の等値**で同定している (同一性の duck-type)。

- その規則の所有者は誰か？ 既に名前付き述語があるならそれを呼ぶ (例: \`isRobotBaseFrame()\`)。
  無いならドメイン側に 1 つ作り、呼び出し側は呼ぶだけにする — 呼び出し側で条件を
  並べ直すのは 1 行でも第二の源 (§1.1)。
- 同じ名前の実体が **2 つ**あったら何が起きるか。名前は同一性ではない (原則 #2)。
- 増やした規則は \`src/IdentityContainment.test.js\` の \`IDENTITY_RULES\` に登録すれば
  以後は機械が守る。"
else
  body="この編集は **状態リテラル**を導入している。

- \`docs/STATE_LEDGER.md\` の該当実体の行を、このコミットで更新すること (閾値未満でも記録 — 累積器)。
- **基数列を埋める**: 0 個は正当か / N 個は正当か。\`mode\`・\`status\` は状態として認識されるが
  「0 個」「N 個」は状態に見えない — ADR-090 の欠陥はここが空だったことに由来する。
- 累積して 3 状態以上になったら、クラスを書く前に状態機械を設計し
  \`docs/STATE_TRANSITIONS.md\` に節を起こす (核 §1.4)。不正状態は表現不能にする。"
fi

context="【状態台帳 nudge — 核 §1.4 / このセッションで 1 回だけ出ます】

${body}

核 §2 の一拍俯瞰 (数行で可): 1) 症状か根本か 2) blast radius 3) 状態を持つ実体に触るか。"

python3 - "$context" <<'PY' 2>/dev/null || exit 0
import json, sys
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": sys.argv[1],
    }
}))
PY
exit 0
