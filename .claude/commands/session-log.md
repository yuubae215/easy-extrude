Update the session history for the current session.

## Steps

1. **Gather session context**
   - Review git log since the last session entry: `git log --oneline -20`
   - Identify what changed: new features, bug fixes, refactors, design decisions, new ADRs

2. **Write the session entry**
   - Format: `- **YYYY-MM-DD**: <concise summary>`
   - One bullet per *logical topic* (not per commit). Group related commits.
   - Include: what was added/changed, key files/classes affected, ADR numbers if any.
   - Keep each bullet to 1–2 sentences. Use sub-bullets for multi-part sessions.
   - Date: use today's date from `currentDate` in the system prompt.

3. **Update `docs/SESSION_LOG.md`**
   - Insert the new entry at the TOP of the list (after the `---` separator).
   - Do not remove or alter existing entries.

4. **Update `CLAUDE.md` Session history section**
   - Keep only the **3 most recent** entries (by date, newest first).
   - Replace the oldest of the current 3 with the new entry if needed.
   - If the new entry is the same date as an existing one, prepend it above that entry and drop the now-fourth entry.

5. **Review `.claude/MENTAL_MODEL.md` for missing rules**
   - For each bug fix in this session, ask: "Did this bug reveal an implicit rule that isn't already in MENTAL_MODEL?"
   - Check the "What belongs here" criteria: real bug, hard-to-find state issue, non-obvious ownership contract, or conscious design choice over a simpler alternative.
   - If any rules are missing, add them now. When in doubt, add — omissions are harder to recover from than extras.
   - If MENTAL_MODEL was updated, include it in the staged files below.

6. **Commit**
   - Stage: `git add CLAUDE.md docs/SESSION_LOG.md .claude/MENTAL_MODEL.md`
   - Commit message: `docs: update session log YYYY-MM-DD`
   - Push to the current branch.
