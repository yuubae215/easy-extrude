#!/usr/bin/env bash
# install-git-hooks.sh — Claude Code SessionStart hook (ADR-116)
#
# `.githooks/prepare-commit-msg` を有効にする = `core.hooksPath` を張る。
#
# なぜ SessionStart か:
#   `core.hooksPath` は clone ごとの設定 (`.git/config`) であって版管理できない。
#   リモートセッションは毎回新しい clone なので、誰かが張り直さなければ主経路は
#   黙って走らなくなる。セッションの開始はその「毎回」に対応する唯一の事象。
#
# なぜ既存の設定を上書きしないか:
#   `core.hooksPath` を張ると `.git/hooks/` の中身は**すべて無効になる**。利用者が
#   自分の hooksPath を持っているなら、それを奪ってはいけない。既に別の値が
#   入っているときは何もせず、その事実を出力する (無言で諦めない — 原則 #11)。
#
# 規律: 何が起きても壊さない。セッションの開始を失敗させない (常に exit 0)。
# 取りこぼしは `pnpm test:trailers` が個数で数える (ADR-115)。

set -uo pipefail

repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$repo" ] || exit 0
[ -x "$repo/.githooks/prepare-commit-msg" ] || exit 0

current="$(git -C "$repo" config --get core.hooksPath 2>/dev/null)"

if [ "$current" = ".githooks" ]; then
  exit 0                       # 既に張られている
fi

if [ -n "$current" ]; then
  echo "[install-git-hooks] core.hooksPath は既に '$current' に設定されています。" >&2
  echo "  観測トレーラの主経路 (.githooks/prepare-commit-msg) は無効のままです —" >&2
  echo "  予備経路 (PostToolUse の amend) が働きますが、commit と push を 1 コマンドに" >&2
  echo "  連鎖させたコミットは刻めません (ADR-115 / ADR-116)。" >&2
  exit 0
fi

git -C "$repo" config core.hooksPath .githooks 2>/dev/null || exit 0
exit 0
