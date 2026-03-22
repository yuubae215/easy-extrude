# Full Repository Validation — Orchestrator

Run all four validators (SQA · QC · ADR · UX) against **every** source file in
the repository, not just recently changed ones.

Pass an optional scope to `$ARGUMENTS` (e.g. `src/view/`) to restrict coverage.

---

## Execution plan

Run the four sub-validations **in parallel** (launch four Agent instances
simultaneously):

### Agent 1 — SQA (all src/ + server/src/)

Apply the checklist from `.claude/commands/sqa.md` to **every** `.js` file
under `src/` and `server/src/`.

Target files (enumerate with Glob `src/**/*.js` + `server/src/**/*.js`):

Priority order (read these first, as they carry the highest risk):
1. `src/view/MeshView.js` — memory management critical path
2. `src/controller/AppController.js` — pointer-event lifecycle
3. `server/src/routes/*.js` — security boundary
4. `server/src/db/database.js` — SQL injection surface
5. `server/src/middleware/auth.js` — authentication
6. All remaining `src/**/*.js` and `server/src/**/*.js`

### Agent 2 — QC (all src/ + server/src/)

Apply the checklist from `.claude/commands/qc.md` to every `.js` file.

Also read:
- `docs/ARCHITECTURE.md`
- `.claude/MENTAL_MODEL.md`

Checks to emphasise for whole-repo scope:
- Layer leakage (domain logic in View, Three.js in Model, etc.)
- Circular imports (trace `import` chains)
- Missing ADR coverage for non-obvious decisions

### Agent 3 — ADR Compliance (all src/ + server/src/)

Apply the checklist from `.claude/commands/adr-validate.md` against
**all 15 Accepted ADRs** (skip Rejected ADR-003, Superseded ADR-001).

Read `docs/adr/README.md` first to get the full index, then load every
Accepted ADR from `docs/adr/`.

Map each source file to its governing ADRs using the table in `adr-validate.md`,
then verify each contract.

Flag **gaps** — non-obvious design choices in the current code not covered by
any existing ADR.

### Agent 4 — UX (src/view/ + src/controller/ + index.html)

Apply the checklist from `.claude/commands/ux.md` to:
- `src/view/*.js`
- `src/controller/AppController.js`
- `index.html`

Also read:
- `.claude/MENTAL_MODEL.md` §2 and §3
- `docs/ROADMAP.md` (Mobile Support section)

---

## Output format

Each agent reports findings in its own section, using the severity/category
format defined in its validator command.

After all four complete, produce a **combined executive summary**:

```
=== FULL REPOSITORY VALIDATION SUMMARY ===

SQA  : N issues (C critical, H high, M medium, L low) across X files
QC   : N issues across X files. Categories: ...
ADR  : N violations, G gaps across X files. ADRs checked: ...
UX   : N issues across X files. Categories: ...

Total actionable items: N
Critical / blocking:    N
```

List the top-5 highest-priority findings across all four validators,
ranked by severity.

---

## Usage

```
/validate-all               # full repo
/validate-all src/view/     # scope to one directory
/validate-all src/service/SceneService.js   # single file
```

---

## Process lessons (updated as experience accumulates)

### 2026-03-22 — Broad scan misses focused details

**Observation**: The first full-repo run (35+ files per agent) found 15 issues.
A follow-up focused run on 5 Phase C files found 9 additional issues that the
broad run missed.

**Root cause**: When an agent reads 35+ files, context budget is dominated by
file content. Each file receives proportionally less "attention" for nuanced
checklist items. The broad run confirms coarse-grained contracts ("does
ImportedMesh follow ADR-011?") but misses subtle ones ("does the ADR *text*
still accurately describe the entity union after Phase C added a third type?").

**Recommended two-pass pattern**:

1. **Pass 1 — broad scan** (`/validate-all`): catches structural violations,
   obvious missing patterns, and security issues. Sufficient for most CI-style
   checks.

2. **Pass 2 — focused drill-down** (`/sqa <file>`, `/adr-validate <file>`,
   etc.): run on any feature area that was recently added or significantly
   changed (e.g., after each BFF Phase). Focus on:
   - Newly introduced entity types or ADR-adjacent design choices
   - Files where the broad scan found 0 issues but the feature is complex
   - ADR gaps: ask "does the ADR *text* still describe reality, or just the intent?"

**Trigger for Pass 2**: after any session that introduces a new domain entity,
a new service method, or a new interaction pattern not covered by existing ADRs.

### General heuristics

- **ADR gaps vs ADR violations**: broad scans reliably catch *violations*
  (code that contradicts an ADR). They are weaker at catching *gaps* (ADR text
  that no longer describes the full reality). Gaps require reading the ADR prose
  carefully alongside the new code, which needs a focused run.

- **UX silent failures need focused review**: subtle UX regressions like "key
  shortcut consumed but no-ops silently" require tracing a specific control flow
  path. Broad UX scans confirm existing patterns pass; they rarely surface new
  missing-feedback cases introduced by feature guards.
