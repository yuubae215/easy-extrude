# ADR-003: Orbit Control Migrated to Middle-Click

**Date:** 2026-03-20
**Status:** Rejected — Implemented alongside the voxel model but reverted. Right-drag orbit is retained (current implementation).

---

## Context

Currently, camera orbit is bound to **right-drag** (OrbitControls default). This conflicts with:

- Right-click as a **cancel** action (Grab mode already uses right-click to cancel)
- Right-click as a **context menu** trigger (planned)
- Sketch Mode, where right-click should erase painted cells

The right mouse button is overloaded and the behaviour is inconsistent across modes.

## Decision

Move camera orbit to **middle-click drag** (mouse button 1 in Three.js / button 2 on device).

| Input | Action |
|-------|--------|
| Middle-drag | Orbit camera |
| Scroll wheel | Zoom |
| Right-click | Cancel current operation **or** context menu (context-sensitive, see ADR-006) |

OrbitControls configuration:
```javascript
controls.mouseButtons = {
  LEFT:   THREE.MOUSE.PAN,     // not used for orbit
  MIDDLE: THREE.MOUSE.ROTATE,  // orbit
  RIGHT:  THREE.MOUSE.DOLLY,   // zoom (optional, scroll preferred)
}
// Disable right-drag orbit entirely; right-click handled by AppController
```

## Consequences

**Benefits:**
- Right-click is freed for a consistent cancel/context-menu role across all modes
- Matches Blender's control convention (familiar to target users)
- Middle-drag orbit works in all modes without mode-switching confusion

**Trade-offs:**
- Users without a middle mouse button (e.g., trackpad-only) need an alternative:
  - Two-finger drag on trackpad → orbit (OrbitControls touch already supports this)
  - Alt+left-drag as fallback (optional, lower priority)
- Mobile has no middle button — addressed in mobile backlog (see ROADMAP.md)

## References

- ADR-006 (right-click role)
- Blender mouse button conventions
