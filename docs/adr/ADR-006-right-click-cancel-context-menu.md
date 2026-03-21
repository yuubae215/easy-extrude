# ADR-006: Right-Click as Cancel / Context Menu

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — removed voxel-specific descriptions)

---

## Context

The right mouse button is used by OrbitControls for "right-drag = camera orbit" and by
AppController for "Grab cancel = right-click", causing a role conflict.

In the current implementation `controls.mouseButtons = { RIGHT: THREE.MOUSE.ROTATE }`,
so right-drag is orbit, but AppController intercepts right-click as a cancel during Grab.

## Decision

Right-click behaviour is **context-sensitive** depending on whether an operation is in progress:

| State | Right-click behaviour |
|-------|-----------------------|
| Operation in progress (Grab, Extrude, Sketch) | **Cancel** the current operation |
| No operation, hovering an object | **Context menu** (future implementation) |
| No operation, clicking empty space | **Deselect** (Object Mode) |
| No operation | Delegate to OrbitControls (right-drag = orbit) |

### Current Orbit Conflict

- OrbitControls handles right-drag as orbit
- AppController's `mousedown (button 2)` is used for cancel only during Grab
- Right-drag when no operation is active is handled by OrbitControls as orbit (intentional coexistence)
- When implementing the context menu in the future, `e.preventDefault()` on the `contextmenu` event will be needed

### Sketch Mode

In Edit Mode · 2D (rectangle sketch):
- Right-click → cancel the sketch operation (discard the rectangle being drawn)

## Consequences

- Right-click consistently means "cancel / context menu"
- Context menu is a future feature — the architecture reserves the slot
- On mobile, long-press fires `contextmenu` — `e.preventDefault()` is required
