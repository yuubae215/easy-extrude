#!/usr/bin/env python3
"""gsn_tool.py — utilities for .gsn DSL files (GSN Assurance VS Code extension format).

Subcommands:
  uuid     Generate fresh UUID v4 values (batch).
  lint     Validate a .gsn file: indentation, required fields, UUID uniqueness/format,
           nesting sanity, depth/fan-out advisories.
  mermaid  Convert a .gsn file to a Mermaid flowchart.
  stats    Report node counts, max depth, fan-out range, and evidence debt
           (share of goals in state ToBeDeveloped).

Stdlib only. Exit code 0 = OK (lint: no errors; warnings allowed), 1 = errors found / bad input.
"""

import argparse
import re
import sys
import uuid as uuidlib
from dataclasses import dataclass, field

TYPES = {"goal", "strategy", "solution", "context", "assumption", "justification"}
STATES = {"Approved", "Disapproved", "UnderReview", "ToBeReviewed", "ToBeDeveloped"}
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
    children: list = field(default_factory=list)
    parent: "Node" = None


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
        elif head in ("labels", "groups"):
            in_artifacts = False
        elif head == "-":
            if not in_artifacts:
                m.warnings.append(f"line {lineno}: list item outside an artifacts block")
        else:
            m.warnings.append(f"line {lineno}: unrecognized line '{stripped[:40]}'")

    return m


def lint(m):
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
        if n.ntype == "goal" and not n.children:
            m.warnings.append(f"{where}: leaf goal has no solution/assumption support")

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
        m = lint(parse(path))
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
        print()
    return rc


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

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
