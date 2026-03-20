# ADR-006: Right-Click as Cancel / Context Menu

**Date:** 2026-03-20
**Status:** Accepted

---

## Context

Right-click is currently used inconsistently: OrbitControls interprets it as orbit (right-drag), and AppController uses it to cancel Grab mode. This creates UX friction — especially in Sketch Mode where right-click should erase cells.

Freeing right-drag for orbit is addressed in ADR-003 (orbit → middle-click). This ADR defines what right-click *does* after that change.

## Decision

Right-click behaviour is **context-sensitive** based on whether an operation is in progress:

| State | Right-click action |
|-------|-------------------|
| Operation in progress (Grab, Extrude, Sketch) | **Cancel** the operation |
| Nothing in progress, object hovered | **Context menu** (future) |
| Nothing in progress, empty space clicked | **Deselect** (Object Mode) |

### Sketch Mode specifics

In Edit Mode · 2D (sketch cell painting):
- Right-click drag → **erase cells** (paint in erase mode)
- This is consistent with common pixel/voxel editors

### Implementation note

`contextmenu` browser event must be suppressed (`e.preventDefault()`) in all cases where the app handles right-click itself, to avoid the OS context menu appearing.

## Consequences

- Right-click is now fully consistent: it always means "cancel / undo this action" or opens a context menu
- No more confusion between orbit-drag and cancel
- Context menu (right-click → menu) is a **future feature** — the architecture reserves it but does not implement it now
- Mobile: long-press may trigger `contextmenu` on some browsers; suppress with `e.preventDefault()` in the `contextmenu` handler

## References

- ADR-003 (orbit → middle-click, which enables this ADR)
