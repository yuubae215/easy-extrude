# Development — easy-extrude

Process knowledge for working on this codebase: how to design, implement,
and validate changes so errors are caught at the right stage.

Distinct from `docs/CODE_CONTRACTS.md`, which records rules about the *code*.
This file records rules about the *process*.

---

## Maintenance guidelines

Add an entry when:
- A repeated workflow pattern proves reliably better than alternatives
- An agent-level mistake could be avoided with a written rule
- A tooling or command limitation affects how work is scoped

Remove an entry when superseded or no longer relevant.

---

## 1. Design–Validation Pairing

Every implementation session has two phases that must both complete:

| Phase | What | When |
|-------|------|------|
| **Design** | Read relevant docs, consult ADRs, plan the change | Before writing code |
| **Validate** | Run focused validators on the changed files | After writing code, before committing |

**Design without validation is incomplete.** Writing code that satisfies the
design intent but violates a contract in `docs/CODE_CONTRACTS.md` or an ADR is
not a finished task — it is a deferred bug.

### Which docs to read before implementing

Use the Document navigation table in `CLAUDE.md`. The trigger column maps
the kind of change to the exact documents that apply.

### Validation checklist before committing

```
1. /adr-validate <changed files>   — ADR compliance
2. /qc <changed files>             — layers, naming, imports, docs
3. /sqa <changed files>            — memory, async, security, state
4. /ux <changed files>             — UX/interaction (view/controller files only)
```

Run 1–3 in parallel (they are independent). Run `/ux` only when
`src/view/`, `src/controller/`, CSS, or HTML files were changed.

---

## 2. Focused Validation — Tool Reference

| Command | Scope | Use when |
|---------|-------|---------|
| `/adr-validate <files>` | ADR compliance | Any `src/` or `server/` change |
| `/qc <files>` | Layers, naming, imports, docs | Any `src/` or `server/` change |
| `/sqa <files>` | Memory, async, security, state | Any `src/` or `server/` change |
| `/ux <files>` | Touch, toolbar, visual feedback | View, controller, CSS changes |

Always pass explicit file paths (`src/controller/AppController.js`), not globs.
Explicit paths keep the agent's context budget focused on the changed code.

### ADR gaps vs ADR violations

- **Violations** (code contradicts an accepted ADR) → caught by `/adr-validate`.
- **Gaps** (ADR text no longer fully describes reality after a new feature) →
  require reading ADR prose carefully alongside new code. Flag for a gap when
  introducing a new domain entity, service method, or interaction pattern.
  Broad scans rarely surface gaps; focused review of the relevant ADR does.

### UX silent failures

Key shortcut consumed but nothing happens, or a toolbar button gives no
feedback — these are not caught by structural checks. After any change to
`instanceof` guards or early-return paths, run `/ux` on the controller file
even if no view files changed.

---

## 3. Scoping Agent Work

### Prefer focused agents over broad agents

For verification, give the agent a small named file list. A focused agent
reads fewer files, spends more context per file, and produces higher-confidence
findings than a glob-based broad scan.

| Focused (preferred) | Broad (avoid) |
|---------------------|---------------|
| `/sqa src/controller/AppController.js` | `/sqa` with no argument |
| `/adr-validate src/domain/Cuboid.js` | agent reading `src/**/*.js` |

### Run independent validators in parallel

Validators 1–3 (ADR, QC, SQA) are independent — launch them as concurrent
agents in a single message. Wait for all three before deciding whether to
commit. `/ux` is also independent, so include it in the same parallel batch
when view/controller files changed.
