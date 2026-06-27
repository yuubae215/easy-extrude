#!/usr/bin/env bash
# evidence-before-commit.sh
# Claude Code PreToolUse hook (matcher: Bash)
#
# §5「証拠なき完了禁止」の強制レイヤ。
# CLAUDE.md は context(助言)であって enforcement ではないため、
# 「commit 前にテストを通す」は prose ではなく hook に降ろす。
#
# 配置:  ~/.claude/hooks/evidence-before-commit.sh   (chmod +x を忘れず)
# 配線:  ~/.claude/settings.json の hooks.PreToolUse へ登録
#        → settings.hook-snippet.json を参照
#
# 仕様:
#   - 対象は `git commit` を含む Bash コマンドのみ。他は素通り (exit 0)。
#   - テストコマンドの「真実の源は一つ」(§1.1)。解決順:
#       1) 環境変数 CLAUDE_TEST_CMD
#       2) <repo>/.claude/test-command (先頭1行)
#       3) 自動検出 (npm / cargo / go / pytest / make)
#   - 特定できなければ warn のみ・ブロックしない (fail-open / §0「一番安いレンズ」)。
#   - テスト失敗時は exit 2 で commit をブロックし、理由を stderr に出す
#     (PreToolUse では exit 2 がブロック、stderr が Claude に渡る挙動)。
#
# 注意: hook の入出力スキーマ(exit 2 の意味・matcher 形式)は更新され得る。
#       現行仕様を Claude Code の hooks ドキュメントで確認のこと。

set -uo pipefail

# --- stdin の JSON から tool 名と command を取り出す -------------------------
payload="$(cat)"
read_json() { # $1: python 式 (変数 d = パース済み JSON)
  printf '%s' "$payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null
}
tool_name="$(read_json 'd.get("tool_name","")')"
command_str="$(read_json 'd.get("tool_input",{}).get("command","")')"

# --- 対象判定: Bash かつ git commit を含むときだけ働く ----------------------
case "$tool_name" in
  Bash|bash) ;;
  *) exit 0 ;;
esac
printf '%s' "$command_str" | grep -Eq 'git[[:space:]]+commit' || exit 0
# `--no-verify` を含む明示的バイパスは尊重する
printf '%s' "$command_str" | grep -Eq '(--no-verify|-n[[:space:]]|-n$)' && exit 0

# --- テストコマンドの解決(単一の源)---------------------------------------
project_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
test_cmd="${CLAUDE_TEST_CMD:-}"

if [ -z "$test_cmd" ] && [ -f "$project_root/.claude/test-command" ]; then
  test_cmd="$(head -n1 "$project_root/.claude/test-command")"
fi

if [ -z "$test_cmd" ]; then
  if   [ -f "$project_root/package.json" ] && grep -q '"test"' "$project_root/package.json"; then
    test_cmd="npm test --silent"
  elif [ -f "$project_root/Cargo.toml" ]; then
    test_cmd="cargo test"
  elif [ -f "$project_root/go.mod" ]; then
    test_cmd="go test ./..."
  elif [ -f "$project_root/pyproject.toml" ] || [ -f "$project_root/pytest.ini" ] || [ -d "$project_root/tests" ]; then
    test_cmd="python3 -m pytest -q"
  elif [ -f "$project_root/Makefile" ] && grep -Eq '^test:' "$project_root/Makefile"; then
    test_cmd="make test"
  fi
fi

# 特定不能 → ブロックしない(fail-open)
if [ -z "$test_cmd" ]; then
  echo "evidence-before-commit: テストコマンドを特定できず検証をスキップ。" \
       ".claude/test-command か CLAUDE_TEST_CMD で明示すると §5 が有効になります。" >&2
  exit 0
fi

# --- テスト実行 ------------------------------------------------------------
log="$(mktemp /tmp/cc-evidence.XXXXXX.log)"
echo "evidence-before-commit: 検証実行 → $test_cmd" >&2
if ( cd "$project_root" && eval "$test_cmd" ) >"$log" 2>&1; then
  rm -f "$log"
  exit 0
else
  {
    echo "BLOCKED (§5 証拠なき完了禁止): テスト失敗のため commit を中止。"
    echo "コマンド: $test_cmd"
    echo "--- ログ末尾 ---"
    tail -n 30 "$log"
    echo "----------------"
    echo "緑にしてから再 commit してください。意図的にバイパスするなら git commit --no-verify。"
  } >&2
  rm -f "$log"
  exit 2
fi
