#!/usr/bin/env python3
"""gsn_tool.py — utilities for .gsn DSL files (GSN Assurance VS Code extension format).

Subcommands:
  uuid     Generate fresh UUID v4 values (batch).
  lint     Validate a .gsn file: indentation, required fields, UUID uniqueness/format,
           nesting sanity, support cardinality, artifact existence, depth/fan-out advisories.
  mermaid  Convert a .gsn file to a Mermaid flowchart.
  stats    Report node counts, max depth, fan-out range, and evidence debt
           (goals ToBeDeveloped, split into exploring / unexplored).
  selftest Run the linter against inline fixtures (guards the checks themselves).

Stdlib only. Exit code 0 = OK (lint: no errors; warnings allowed), 1 = errors found / bad input.

## Support cardinality (why the zero cases are checked)

A goal supported by nothing has no node to inspect, so every check written against
*present* content passes it silently — the empty branch reads exactly like a finished
one. The linter therefore iterates over the *required kinds* of support, not over the
children that happen to exist, and a zero must be declared rather than inferred:

  supported     ≥1 strategy, ≥1 solution, or ≥1 sub-goal under the goal.
  declared zero the goal carries exactly one `support-*` label (below).

The two declared zeros are different engineering states with different next actions,
and the trees already distinguished them in prose ("証拠予定:" vs "プレースホルダ:").
The labels lift that prose convention into something machine-checkable:

  support-exploring   探索中 — the check that would settle this goal is named in a child
                      assumption, but has not been executed. Next action: run/write it.
                      Requires ≥1 assumption child; without one the label is a costume.
  support-unexplored  未探索 — nothing has been named yet. Next action: decide what would
                      settle it. Not falsifiable, and honest about being so.

Collapsing the two into a single `state ToBeDeveloped` makes evidence debt
uninterpretable: "9/15 ToBeDeveloped" says nothing about how much is in flight.
"""

import argparse
import os
import re
import sys
import tempfile
import uuid as uuidlib
from dataclasses import dataclass, field

TYPES = {"goal", "strategy", "solution", "context", "assumption", "justification"}
STATES = {"Approved", "Disapproved", "UnderReview", "ToBeReviewed", "ToBeDeveloped"}
SUPPORT_LABELS = {"support-exploring", "support-unexplored"}
URL_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

MERMAID_SHAPE = {  # (open, close) per GSN node convention approximations
    "goal": ("[", "]"),          # rectangle
    "strategy": ("[/", "/]"),    # parallelogram
    "solution": ("((", "))"),    # circle
    "context": ("([", "])"),     # stadium
    "assumption": ("([", "])"),
    "justification": ("([", "])"),
}


@dataclass
class Node:
    ntype: str
    ident: str
    line: int
    indent: int
    uuid: str = ""
    summary: str = ""
    state: str = ""
    labels: list = field(default_factory=list)
    artifacts: list = field(default_factory=list)  # (lineno, path) pairs
    children: list = field(default_factory=list)
    parent: "Node" = None

    def count_kids(self, ntype):
        return sum(1 for c in self.children if c.ntype == ntype)

    def support_labels(self):
        return [l for l in self.labels if l in SUPPORT_LABELS]


@dataclass
class Model:
    namespace: str = ""
    roots: list = field(default_factory=list)
    nodes: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


def parse(path):
    m = Model()
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError as e:
        m.errors.append(f"cannot read {path}: {e}")
        return m

    stack = []  # nodes by increasing indent
    current = None
    in_artifacts = False

    for lineno, raw in enumerate(lines, 1):
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        if "\t" in line[:indent + 1]:
            m.errors.append(f"line {lineno}: tab character in indentation (use 4 spaces)")
            continue
        stripped = line.strip()
        tokens = stripped.split(None, 1)
        head = tokens[0]

        if head == "GOALS":
            if m.namespace:
                m.warnings.append(f"line {lineno}: multiple GOALS namespaces; only the first is used by convention")
            else:
                m.namespace = tokens[1].strip() if len(tokens) > 1 else ""
                if not m.namespace:
                    m.errors.append(f"line {lineno}: GOALS keyword without a namespace name")
            in_artifacts = False
            continue

        if head in TYPES:
            in_artifacts = False
            if indent % 4 != 0:
                m.errors.append(f"line {lineno}: entity indent {indent} is not a multiple of 4")
            ident = tokens[1].strip() if len(tokens) > 1 else ""
            node = Node(ntype=head, ident=ident, line=lineno, indent=indent)
            if not ident:
                m.errors.append(f"line {lineno}: {head} entity has no identifier")
            elif not IDENT_RE.match(ident):
                m.errors.append(f"line {lineno}: identifier '{ident}' contains spaces or invalid characters")
            # attach to hierarchy
            while stack and stack[-1].indent >= indent:
                stack.pop()
            if stack:
                node.parent = stack[-1]
                stack[-1].children.append(node)
            else:
                m.roots.append(node)
            stack.append(node)
            m.nodes.append(node)
            current = node
            continue

        # property lines belong to the current entity
        if current is None:
            m.errors.append(f"line {lineno}: content before any entity: '{stripped[:40]}'")
            continue

        if head == "uuid":
            in_artifacts = False
            current.uuid = tokens[1].strip() if len(tokens) > 1 else ""
        elif head == "summary":
            in_artifacts = False
            val = tokens[1].strip() if len(tokens) > 1 else ""
            if not (val.startswith('"') and val.endswith('"') and len(val) >= 2):
                m.errors.append(f"line {lineno}: summary must be a double-quoted string")
            current.summary = val.strip('"')
        elif head == "state":
            in_artifacts = False
            current.state = tokens[1].strip() if len(tokens) > 1 else ""
            if current.state not in STATES:
                m.errors.append(
                    f"line {lineno}: invalid state '{current.state}' (valid: {', '.join(sorted(STATES))})"
                )
        elif head == "artifacts":
            in_artifacts = True
        elif head == "labels":
            in_artifacts = False
            raw_labels = tokens[1] if len(tokens) > 1 else ""
            current.labels = [v.strip() for v in raw_labels.split(",") if v.strip()]
        elif head == "groups":
            in_artifacts = False
        elif head == "-":
            if not in_artifacts:
                m.warnings.append(f"line {lineno}: list item outside an artifacts block")
            else:
                val = (tokens[1].strip() if len(tokens) > 1 else "").strip('"')
                if val:
                    current.artifacts.append((lineno, val))
                else:
                    m.errors.append(f"line {lineno}: empty artifacts entry")
        else:
            m.warnings.append(f"line {lineno}: unrecognized line '{stripped[:40]}'")

    return m


def repo_root(path):
    """Walk up from a .gsn file to the enclosing repo root (the dir holding .git).

    Artifact paths in the trees are repo-root-relative, so they must resolve the
    same way no matter which directory the linter is invoked from. Falls back to
    the file's own directory when no .git is found (e.g. a tree outside a repo).
    """
    d = os.path.dirname(os.path.abspath(path)) or os.getcwd()
    while True:
        if os.path.exists(os.path.join(d, ".git")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return os.path.dirname(os.path.abspath(path)) or os.getcwd()
        d = parent


def check_artifacts(m, n, root):
    """An artifact path that resolves to nothing is a dangling evidence pointer.

    Hard error under `solution`: a solution asserts the evidence exists, so a path
    that does not resolve makes the claim unfalsifiable while still reading as
    settled. Warning elsewhere — a context/assumption may legitimately point at a
    document that is planned but not yet written.
    """
    where = f"line {n.line} ({n.ntype} {n.ident or '?'})"
    for lineno, rel in n.artifacts:
        if URL_RE.match(rel):
            continue
        if os.path.exists(os.path.join(root, rel)):
            continue
        msg = f"{where}: artifact does not exist: '{rel}' (line {lineno}, resolved against {root})"
        if n.ntype == "solution":
            m.errors.append(msg)
        else:
            m.warnings.append(msg)


def check_goal_support(m, n):
    """A goal's support cardinality must be non-zero or explicitly declared.

    Zero support is invisible to any check that inspects the children a goal has:
    there is no node carrying a wrong value, only an absence. So the zero itself is
    the thing tested, and a declared zero must say *which* zero it is (see module
    docstring: exploring vs unexplored).
    """
    where = f"line {n.line} ({n.ntype} {n.ident or '?'})"
    strategies = n.count_kids("strategy")
    solutions = n.count_kids("solution")
    subgoals = n.count_kids("goal")
    supported = strategies or solutions or subgoals
    declared = n.support_labels()

    if len(declared) > 1:
        m.errors.append(f"{where}: {len(declared)} support labels ({', '.join(declared)}); declare exactly one")
    elif supported and declared:
        m.errors.append(
            f"{where}: labelled '{declared[0]}' but is supported "
            f"({strategies} strategy / {solutions} solution / {subgoals} sub-goal); "
            "a support label declares an absence and must be removed once support exists"
        )
    elif not supported and not declared:
        m.errors.append(
            f"{where}: unsupported goal — 0 strategy, 0 solution, 0 sub-goal. "
            "Add support, or declare the zero with 'labels support-exploring' "
            "(a child assumption names the check that would settle it) or "
            "'labels support-unexplored' (nothing named yet)"
        )
    elif declared == ["support-exploring"] and not n.count_kids("assumption"):
        m.errors.append(
            f"{where}: labelled 'support-exploring' but no assumption child names the "
            "planned check — that is 'support-unexplored' wearing a costume"
        )

    if subgoals and not strategies:
        m.warnings.append(
            f"{where}: decomposes into {subgoals} sub-goal(s) with no strategy naming the argument "
            "(GSN permits goal→goal; the justification chain Goal ← Strategy ← Evidence does not)"
        )


def lint(m, path=None):
    root = repo_root(path) if path else os.getcwd()
    seen_uuids = {}
    seen_idents = {}
    for n in m.nodes:
        where = f"line {n.line} ({n.ntype} {n.ident or '?'})"
        if not n.uuid:
            m.errors.append(f"{where}: missing uuid")
        elif not UUID_RE.match(n.uuid):
            m.errors.append(f"{where}: malformed uuid '{n.uuid}'")
        elif n.uuid in seen_uuids:
            m.errors.append(f"{where}: duplicate uuid (also on line {seen_uuids[n.uuid]})")
        else:
            seen_uuids[n.uuid] = n.line
        if not n.summary:
            m.errors.append(f"{where}: missing summary")
        if n.ident:
            if n.ident in seen_idents:
                m.errors.append(f"{where}: duplicate identifier (also on line {seen_idents[n.ident]})")
            else:
                seen_idents[n.ident] = n.line

        for label in n.labels:
            if label in SUPPORT_LABELS and n.ntype != "goal":
                m.errors.append(f"{where}: support label '{label}' is only meaningful on a goal")

        check_artifacts(m, n, root)

        # structural sanity
        if n.ntype in ("solution", "context", "assumption", "justification") and n.children:
            kinds = ", ".join(c.ntype for c in n.children)
            m.warnings.append(f"{where}: {n.ntype} nodes are normally leaves but has children ({kinds})")
        if n.ntype == "strategy":
            goal_kids = [c for c in n.children if c.ntype == "goal"]
            if not goal_kids:
                m.warnings.append(f"{where}: strategy has no sub-goals")
            elif not (2 <= len(goal_kids) <= 7):
                m.warnings.append(f"{where}: strategy fans out to {len(goal_kids)} goals (recommended 2–7)")
        if n.ntype == "goal":
            check_goal_support(m, n)

    if not m.namespace:
        m.warnings.append("file has no 'GOALS <namespace>' header")
    root_goals = [r for r in m.roots if r.ntype == "goal"]
    if m.nodes and not root_goals:
        m.errors.append("no top-level goal found")
    if len(root_goals) > 1:
        m.warnings.append(f"{len(root_goals)} top-level goals; single-rooted trees are easier to review")

    d = depth(m)
    if d and not (3 <= d <= 5):
        m.warnings.append(f"goal-tree depth is {d} goal level(s) (recommended 3–5)")
    return m


def depth(m):
    """Depth measured in goal levels (strategies/contexts don't add depth)."""
    def rec(n):
        below = max((rec(c) for c in n.children), default=0)
        return below + (1 if n.ntype == "goal" else 0)
    return max((rec(r) for r in m.roots), default=0)


def cmd_lint(args):
    worst = 0
    for path in args.files:
        m = lint(parse(path), path)
        for e in m.errors:
            print(f"ERROR   [{path}] {e}")
        for w in m.warnings:
            print(f"WARNING [{path}] {w}")
        print(f"{path}: {len(m.nodes)} entities, {len(m.errors)} error(s), {len(m.warnings)} warning(s)\n")
        if m.errors:
            worst = 1
    return worst


def cmd_uuid(args):
    for _ in range(args.count):
        print(uuidlib.uuid4())
    return 0


def esc(s):
    return s.replace('"', "'")


def cmd_mermaid(args):
    m = parse(args.file)
    if m.errors:
        for e in m.errors:
            print(f"ERROR   {e}", file=sys.stderr)
        print("fix parse errors before generating a diagram", file=sys.stderr)
        return 1
    out = ["flowchart TB"]
    for n in m.nodes:
        o, c = MERMAID_SHAPE[n.ntype]
        label = n.summary or n.ident
        if len(label) > 70:
            label = label[:67] + "…"
        out.append(f'    {n.ident}{o}"{esc(n.ident)}: {esc(label)}"{c}')
    out.append("")
    for n in m.nodes:
        for ch in n.children:
            arrow = "-.->" if ch.ntype in ("context", "assumption", "justification") else "-->"
            out.append(f"    {n.ident} {arrow} {ch.ident}")
    text = "\n".join(out) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write("```mermaid\n" + text + "```\n")
        print(f"wrote {args.output}")
    else:
        print(text)
    return 0


def cmd_stats(args):
    rc = 0
    for path in args.files:
        m = parse(path)
        if m.errors:
            for e in m.errors:
                print(f"ERROR   [{path}] {e}", file=sys.stderr)
            rc = 1
            continue
        counts = {}
        for n in m.nodes:
            counts[n.ntype] = counts.get(n.ntype, 0) + 1
        goals = [n for n in m.nodes if n.ntype == "goal"]
        tbd = [n for n in goals if n.state == "ToBeDeveloped"]
        stale = [n for n in goals if n.state == "ToBeReviewed"]
        exploring = [n for n in goals if "support-exploring" in n.labels]
        unexplored = [n for n in goals if "support-unexplored" in n.labels]
        fanouts = [len([c for c in n.children if c.ntype == "goal"])
                   for n in m.nodes if n.ntype == "strategy"]
        print(f"== {path} ==")
        print(f"namespace : {m.namespace or '(none)'}")
        for t in ("goal", "strategy", "solution", "context", "assumption", "justification"):
            if counts.get(t):
                print(f"{t:10}: {counts[t]}")
        print(f"depth     : {depth(m)}")
        if fanouts:
            print(f"fan-out   : min {min(fanouts)} / max {max(fanouts)} goals per strategy")
        if goals:
            pct = 100.0 * len(tbd) / len(goals)
            print(f"evidence debt: {len(tbd)}/{len(goals)} goals ToBeDeveloped ({pct:.0f}%)"
                  + (f", {len(stale)} stale (ToBeReviewed)" if stale else ""))
            # The split is the actionable half of the debt: exploring branches have a
            # named next check, unexplored ones only have an admission.
            print(f"unsupported  : {len(exploring)} exploring (check named) / "
                  f"{len(unexplored)} unexplored (nothing named)")
        print()
    return rc


# --------------------------------------------------------------------------
# selftest — the linter's own regression guard.
#
# A check that stops firing fails the same way the defect it guards does: in
# silence. These fixtures pin what each check reports, so a refactor that makes
# the support/artifact checks vacuous fails here rather than in a tree six
# months later.
# --------------------------------------------------------------------------

def _fixture(body):
    """Fill a fixture's `uuid <n>` placeholders with real UUIDs."""
    out = []
    for line in body.strip("\n").split("\n"):
        if line.strip().startswith("uuid "):
            out.append(line.split("uuid")[0] + "uuid " + str(uuidlib.uuid4()))
        else:
            out.append(line)
    return "\n".join(out) + "\n"


SELFTESTS = [
    (
        "unsupported goal is an error",
        """
GOALS t
goal Root
uuid x
summary "root"
    strategy S
    uuid x
    summary "Argument by two branches"
        goal A
        uuid x
        summary "a"
            solution E
            uuid x
            summary "ran it"
        goal Bare
        uuid x
        summary "supported by nothing at all"
""",
        {"errors": ["unsupported goal — 0 strategy, 0 solution, 0 sub-goal"]},
    ),
    (
        "an assumption child alone does not count as support",
        """
GOALS t
goal Root
uuid x
summary "root"
    strategy S
    uuid x
    summary "Argument by two branches"
        goal A
        uuid x
        summary "a"
            solution E
            uuid x
            summary "ran it"
        goal Planned
        uuid x
        summary "b"
            assumption P
            uuid x
            summary "証拠予定: some test"
""",
        {"errors": ["unsupported goal"]},
    ),
    (
        "support-unexplored declares the zero and clears the error",
        """
GOALS t
goal Root
uuid x
summary "root"
    strategy S
    uuid x
    summary "Argument by two branches"
        goal A
        uuid x
        summary "a"
            solution E
            uuid x
            summary "ran it"
        goal Stub
        uuid x
        summary "nothing named yet"
        labels support-unexplored
""",
        {"clean": True},
    ),
    (
        "support-exploring requires an assumption naming the check",
        """
GOALS t
goal Root
uuid x
summary "root"
    strategy S
    uuid x
    summary "Argument by two branches"
        goal A
        uuid x
        summary "a"
            solution E
            uuid x
            summary "ran it"
        goal Claimed
        uuid x
        summary "claims to be in flight"
        labels support-exploring
""",
        {"errors": ["wearing a costume"]},
    ),
    (
        "support-exploring with a named check is clean",
        """
GOALS t
goal Root
uuid x
summary "root"
    strategy S
    uuid x
    summary "Argument by two branches"
        goal A
        uuid x
        summary "a"
            solution E
            uuid x
            summary "ran it"
        goal InFlight
        uuid x
        summary "in flight"
        labels support-exploring
            assumption P
            uuid x
            summary "証拠予定: pytest tests/test_x.py"
""",
        {"clean": True},
    ),
    (
        "a support label on a supported goal is a contradiction",
        """
GOALS t
goal Root
uuid x
summary "root"
labels support-unexplored
    strategy S
    uuid x
    summary "Argument by two branches"
        goal A
        uuid x
        summary "a"
            solution E
            uuid x
            summary "ran it"
        goal B
        uuid x
        summary "b"
            solution E2
            uuid x
            summary "ran it too"
""",
        {"errors": ["must be removed once support exists"]},
    ),
    (
        "missing solution artifact is an error",
        """
GOALS t
goal Root
uuid x
summary "root"
    solution E
    uuid x
    summary "ran it"
    artifacts
    - "evidence.txt"
    - "no/such/file.txt"
""",
        {"errors": ["artifact does not exist: 'no/such/file.txt'"],
         "absent": ["artifact does not exist: 'evidence.txt'"]},
    ),
    (
        "missing artifact under a non-solution node is a warning, not an error",
        """
GOALS t
goal Root
uuid x
summary "root"
    context C
    uuid x
    summary "planned doc"
    artifacts
    - "not/written/yet.md"

    solution E
    uuid x
    summary "ran it"
    artifacts
    - "evidence.txt"
""",
        {"clean": True, "warnings": ["artifact does not exist: 'not/written/yet.md'"]},
    ),
    (
        "URL artifacts are not resolved against the filesystem",
        """
GOALS t
goal Root
uuid x
summary "root"
    solution E
    uuid x
    summary "ran it"
    artifacts
    - "https://example.invalid/report"
""",
        {"clean": True},
    ),
    (
        "goal→goal decomposition without a strategy warns",
        """
GOALS t
goal Root
uuid x
summary "root"
    goal Sub
    uuid x
    summary "sub"
        solution E
        uuid x
        summary "ran it"
""",
        {"clean": True, "warnings": ["no strategy naming the argument"]},
    ),
]


def cmd_selftest(args):
    failures = []
    with tempfile.TemporaryDirectory() as tmp:
        os.mkdir(os.path.join(tmp, ".git"))  # makes tmp the repo root for artifact resolution
        with open(os.path.join(tmp, "evidence.txt"), "w", encoding="utf-8") as f:
            f.write("output\n")
        for i, (name, body, expect) in enumerate(SELFTESTS):
            path = os.path.join(tmp, f"case{i}.gsn")
            with open(path, "w", encoding="utf-8") as f:
                f.write(_fixture(body))
            m = lint(parse(path), path)
            errs, warns = "\n".join(m.errors), "\n".join(m.warnings)
            for needle in expect.get("errors", []):
                if needle not in errs:
                    failures.append(f"{name}: expected error containing {needle!r}\n  got: {errs or '(none)'}")
            for needle in expect.get("warnings", []):
                if needle not in warns:
                    failures.append(f"{name}: expected warning containing {needle!r}\n  got: {warns or '(none)'}")
            for needle in expect.get("absent", []):
                if needle in errs or needle in warns:
                    failures.append(f"{name}: did not expect {needle!r} to be reported")
            if expect.get("clean") and m.errors:
                failures.append(f"{name}: expected no errors\n  got: {errs}")

    for f in failures:
        print(f"FAIL {f}")
    print(f"selftest: {len(SELFTESTS)} cases, {len(failures)} failure(s)")
    return 1 if failures else 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    pu = sub.add_parser("uuid", help="generate UUID v4 values")
    pu.add_argument("--count", type=int, default=1)
    pu.set_defaults(func=cmd_uuid)

    pl = sub.add_parser("lint", help="validate one or more .gsn files")
    pl.add_argument("files", nargs="+")
    pl.set_defaults(func=cmd_lint)

    pm = sub.add_parser("mermaid", help="convert a .gsn file to a Mermaid flowchart")
    pm.add_argument("file")
    pm.add_argument("-o", "--output", help="write to a markdown file instead of stdout")
    pm.set_defaults(func=cmd_mermaid)

    ps = sub.add_parser("stats", help="node counts, depth, fan-out, evidence debt (one or more files)")
    ps.add_argument("files", nargs="+")
    ps.set_defaults(func=cmd_stats)

    pt = sub.add_parser("selftest", help="run the linter against inline fixtures")
    pt.set_defaults(func=cmd_selftest)

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
