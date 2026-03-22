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
