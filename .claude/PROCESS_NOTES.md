# Process Notes — easy-extrude

Accumulated lessons about *how to work on this codebase* — validation
strategies, agent workflows, and meta-observations about the development
process itself.

Distinct from `MENTAL_MODEL.md`, which records rules about the *code*.
This file records rules about the *process*.

---

## Maintenance guidelines

Add an entry when:
- A repeated workflow pattern is found to be reliably better than alternatives
- An agent-level mistake was made that a future agent could avoid with a written rule
- A tooling or command limitation is discovered that affects how work is scoped

Remove an entry when it is superseded or no longer relevant.

---

## 1. Validation strategy

### Two-pass pattern (observed 2026-03-22)

**Observation**: A full-repo broad scan found 15 issues. A follow-up focused
scan on 5 recently changed files found 9 additional issues the broad scan
missed.

**Root cause**: When an agent reads 35+ files, context budget is dominated by
file content. Each file gets proportionally less "attention" for nuanced
checklist items. Broad scans reliably catch coarse-grained violations
("does this file follow ADR-011?") but miss subtle ones ("does the ADR *text*
still accurately describe the entity union after a new type was added?").

**Recommended pattern**:

| Pass | Command | Purpose |
|------|---------|---------|
| 1 — broad | `/validate-all` | Structural violations, obvious missing patterns, security issues |
| 2 — focused | `/sqa <file>`, `/adr-validate <file>`, etc. | Recently added entities, ADR text drift, silent UX failures |

**Trigger for Pass 2**: after any session that introduces a new domain entity,
a new service method, or a new interaction pattern not covered by existing ADRs.

### ADR gaps vs ADR violations

- **Violations** (code contradicts an ADR) → reliably caught by broad scans.
- **Gaps** (ADR text no longer describes reality fully) → require reading ADR
  prose carefully *alongside* new code; broad scans rarely surface these.
  Focused runs are needed.

### UX silent failures

Subtle regressions like "key shortcut consumed but no-ops silently" require
tracing a specific control flow path end-to-end. Broad UX scans confirm
existing patterns pass; they rarely surface new missing-feedback cases
introduced by feature guards. Flag files with new `instanceof` guards or new
`if (!supported) return` patterns for a focused UX pass.

---

## 2. Scoping agent work

### Prefer focused agents over broad agents for verification tasks

For tasks like "verify ADR compliance after adding ImportedMesh", give the
agent a small, named file list rather than `src/**/*.js`. A focused agent
reads fewer files, uses more of its context budget per file, and produces
higher-confidence findings.

### Parallel broad + sequential focused

Run the four broad validators in parallel (they are independent). When their
output surfaces a suspicious area, run a follow-up focused agent *sequentially*
on that area before closing the validation session.
