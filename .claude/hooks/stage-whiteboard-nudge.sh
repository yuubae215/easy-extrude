#!/usr/bin/env bash
# stage-whiteboard-nudge.sh
# Claude Code UserPromptSubmit hook
#
# 「ADR の段を実装して」と頼まれた瞬間に、/whiteboard を先に出して合意を待つことを問う層
# (CLAUDE.md §ADR の段の実装 — 2026-10-24)。
#
# なぜ依頼の時点なのか: 2026-10-24、ADR-168 S1b は「S1b を進めてください」の 1 行で着手され、
# /whiteboard は実装・push の後に出された。核 §2 は「一拍俯瞰だけは飛ばさない」と書いていたが、
# それは常時 load の散文で、依頼を受けた瞬間に問う機械が無かった (憲法 Q3)。事後の俯瞰は作った
# ものの説明にしかならず、当事者が決めるべき判断 (D4 の読み方・絵をどの配置から描くか・status
# を色で言うか) は一人で決まって記録されただけだった。当事者は実装をすべて取り消した。
# state-ledger-nudge.sh (Edit|Write) では遅い — 最初の Edit の時点で設計はもう選ばれている。
#
# 規律 (誤発動は「鬱陶しいレンズ」= 核 §6 シグナル(b) なので、狭く):
#   - ブロックしない。exit 0 + additionalContext で助言するだけ。
#   - 発火は「段の名前」と「着手の動詞」が同じ依頼に両方あるときだけ。
#   - 依頼そのものが /whiteboard なら発火しない (既に問われている)。
#   - 判定・JSON 生成のどこかが失敗したら黙って素通り (fail-open)。
#
# 判定は stage_whiteboard_matches() 1 箇所。src/StageWhiteboardNudge.test.js が
# 発火すべき依頼・すべきでない依頼の両方で、このスクリプトを実際に走らせて問う。
#
# 配線: .claude/settings.json の hooks.UserPromptSubmit

set -uo pipefail

payload="$(cat)"
prompt="$(printf '%s' "$payload" | python3 -c "import sys,json; print(json.load(sys.stdin).get('prompt',''))" 2>/dev/null)" || exit 0
[ -n "$prompt" ] || exit 0

python3 - "$prompt" <<'PY' 2>/dev/null || exit 0
import json, re, sys

prompt = sys.argv[1]

def stage_whiteboard_matches(text: str) -> bool:
    if re.match(r'\s*/whiteboard\b', text):
        return False
    # 段の名前: ADR の §段 が使う形 (S1 / S1b / M5b / PR2 / Phase 3) と「段」
    stage = re.search(r'(?<![A-Za-z0-9#])(?:S|M|PR|Phase ?)[0-9]+[a-z]?(?![A-Za-z0-9])|段', text)
    # 着手の動詞
    verb = re.search(r'進め|実装|着手|やって|取り掛か|始め|implement|proceed|go ahead|start', text, re.I)
    return bool(stage and verb)

if not stage_whiteboard_matches(prompt):
    sys.exit(0)

context = """【ADR の段の実装 — CLAUDE.md §ADR の段の実装 (2026-10-24)】

この依頼は ADR の段の実装に見える。**コードを 1 行も書く前に** `/whiteboard` の §0〜§6
(語彙・Goal・状態表と基数・同一性の所有者・blast radius・検証の形と見逃すもの・ADR) を出し、
**当事者の合意を待ってから**実装に入ること。ADR が「何を作るか」を決めていても、
「どう読むか」(曖昧な決定の読み方・何から導出するか・既存の規律を外すか) は段ごとに残り、
それは当事者が決める。合意の前に決めたものは、事後に記録しても判断にはならない
(ADR-168 S1b は事後の俯瞰になり、実装をすべて取り消した)。

段の名前に見えて段ではない依頼 (例: S2 という別の語) なら、その旨を 1 行書いて進めてよい。"""

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": context,
    }
}, ensure_ascii=False))
PY
exit 0
