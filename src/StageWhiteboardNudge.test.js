/**
 * StageWhiteboardNudge.test.js — 「ADR の段を実装して」と頼まれた瞬間に、/whiteboard を先に出して
 * 合意を待つことが問われるか (CLAUDE.md §ADR の段の実装 — 2026-10-24)。
 *
 * 規律の置き場所は散文ではなく `.claude/hooks/stage-whiteboard-nudge.sh` (UserPromptSubmit) で、
 * この検査はその hook を実際に走らせる。発火すべき依頼 (当事者が実際に打った「S1bを進めてください」
 * を含む) と、発火してはならない依頼 (既に /whiteboard / 段でない依頼) の両方を問う — 片方だけだと
 * 「常に発火する」か「決して発火しない」hook が緑になる。配線が settings.json から外れても落とす。
 *
 * この証拠が構造的に見逃すもの (宣言): 助言が出たあと実際に俯瞰を先に出して合意を待ったか。
 * それは会話の中の振る舞いで、機械はここまでしか問えない。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HOOK = fileURLToPath(new URL('../.claude/hooks/stage-whiteboard-nudge.sh', import.meta.url))
const SETTINGS = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'))

/** Run the hook on a prompt; the additionalContext it injects, or null. */
function nudge(prompt) {
  const out = execFileSync('bash', [HOOK], { input: JSON.stringify({ prompt }), encoding: 'utf8' })
  if (out.trim() === '') return null
  return JSON.parse(out).hookSpecificOutput.additionalContext
}

test('段の実装の依頼で発火する — 当事者が実際に打った文を含む', () => {
  for (const prompt of ['S1bを進めてください', 'ADR-168 の S2 に着手して', 'M5b を実装して', 'PR2 を進めて', 'Phase 3 を始めましょう', '次の段をやって']) {
    const ctx = nudge(prompt)
    assert.ok(ctx, `no nudge for "${prompt}"`)
    assert.match(ctx, /\/whiteboard/)
    assert.match(ctx, /合意を待って/)
  }
})

test('段でない依頼・既に /whiteboard の依頼では発火しない (誤発動は核 §6 シグナル b)', () => {
  for (const prompt of ['/whiteboard S1b', 'このバグを直して', 'PR #452 を見て', 'S1b って何？', '']) {
    assert.equal(nudge(prompt), null, `nudged on "${prompt}"`)
  }
})

test('hook は UserPromptSubmit に配線されている', () => {
  const commands = (SETTINGS.hooks?.UserPromptSubmit ?? []).flatMap(h => h.hooks ?? []).map(h => h.command)
  assert.ok(commands.some(c => c.includes('stage-whiteboard-nudge.sh')), 'the hook is not wired — the rule would be prose again')
})
