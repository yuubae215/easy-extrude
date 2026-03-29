# ADR-024: Mobile Toolbar Architecture — Fixed-Slot Layout and Context-Sensitive Actions

**Status**: Accepted
**Date**: 2026-03-29
**Related**: ADR-008 (Mode Transition), ADR-023 (Mobile Input Model)

---

## Context

A floating bottom toolbar replaces keyboard shortcuts on mobile. Early implementations
resized the toolbar dynamically as modes changed: when buttons were removed or disabled,
the toolbar shrank, shifting remaining button positions. This caused frequent misclicks
as users tapped where a button had previously been.

The toolbar also needed to surface different actions for different entity types
(CoordinateFrame has no edit mode; ImportedMesh has no duplicate), requiring a principled
policy for which actions appear and under what conditions.

---

## Decision

### 1. Fixed slot count per mode

Each mode shows a **fixed number of slots**. The toolbar width never changes within a mode.

| Mode | Slots |
|------|-------|
| Object mode (generic) | 5 |
| Object mode (CoordinateFrame selected) | 5 (specialized layout) |
| Edit 2D sketch | 4 |
| Edit 2D extrude | 4 |
| Edit 3D | 4 |
| Grab active | 4 |

Object mode uses 5 slots (the widest); all other modes use 4.
The toolbar is sized to 5 slots and never shrinks.

### 2. Unavailable actions use disabled or spacer, never removal

Within a mode, **temporarily unavailable** actions use `disabled: true` on the existing
slot. The slot remains visible and tappable but shows as greyed-out.

**Permanently inapplicable** slots (e.g. slot 5 in a 4-slot mode, or a spacer between
active actions) use `{ spacer: true }`, which renders as a `visibility: hidden` div of
identical dimensions occupying layout space without being tappable.

**Never remove a slot** — removing changes positions of adjacent buttons.

### 3. Mode-specific layouts

```
Object mode (generic):      [ Add | Dup | Edit | Delete | Stack ]
Object mode (CoordFrame):   [ Rotate | Grab | Delete | Add Frame | (spacer) ]
Edit 2D sketch:             [ <- Object | Extrude | (spacer) | (spacer) ]
Edit 2D extrude:            [ Confirm | Cancel | (spacer) | (spacer) ]
Edit 3D:                    [ <- Object | Vertex | Edge | Face ]
Grab active:                [ Confirm | Stack | Cancel | (spacer) ]
```

**CoordinateFrame exception**: when a CoordinateFrame is selected, the entire Object mode
toolbar switches to the specialized 5-slot layout (Rotate | Grab | Delete | Add Frame |
spacer). This is a full layout swap, not individual button disabling, because the set of
applicable actions is categorically different.

### 4. Entity-type disabled rules (Object mode)

| Button | Disabled for |
|--------|-------------|
| Dup | `ImportedMesh`, `MeasureLine`, `CoordinateFrame`, `Profile` |
| Edit | `ImportedMesh`, `MeasureLine`, `CoordinateFrame` |
| Stack | `ImportedMesh`, `MeasureLine`, `CoordinateFrame` |
| Delete | Never disabled |
| Add | Never disabled |

### 5. Stack button pre-sets grab mode

The Object mode Stack button pre-sets `_grab.stackMode = true` before the grab gesture
begins. `_startGrab()` does **not** reset `stackMode`, so the pre-set is respected.
`_confirmGrab()` and `_cancelGrab()` reset it to `false` when the grab ends.

This is the mobile equivalent of pressing the S key during a desktop grab.

### 6. Toast and status bar positioning

The floating toolbar's top edge is at 86 px from the bottom (`bottom: 26px` + `height: 60px`).
The `showToast()` method checks `_isMobile()` and uses `bottom: 96px` to appear above the
toolbar. Desktop toast uses `bottom: 64px`.

If the toolbar height or bottom offset changes, update both the toolbar CSS and the toast
offset constant together.

Status text on mobile is shown in the footer info bar (`_infoEl`), not the canvas pill or
header (both are too narrow). `setStatus()` and `setStatusRich()` update `_infoEl` on
mobile; `_setInfoText()` is a no-op on mobile.

---

## Consequences

**Positive**:
- Toolbar width is stable across state changes; misclicks from layout shifts are eliminated.
- `{ spacer: true }` is semantically clear: "this slot is intentionally empty".
- The CoordinateFrame specialized layout avoids confusing users with a row of disabled buttons.

**Negative / Trade-offs**:
- Adding a new mode-specific action may require a slot-count audit across all modes to
  ensure the 5-slot maximum is respected. Phase 3 mobile (axis-constraint buttons during
  Grab) will require expanding Grab active to 5 slots with a corresponding toolbar resize.
- The spacer pattern requires explicit awareness when refactoring toolbar state logic.

---

## Future: Phase 3 additions

Phase 3 plans to add X/Y/Z axis constraint buttons during Grab active
(see ROADMAP Phase 3). This will expand Grab active to 5 slots:
```
Grab active (Phase 3):   [ Confirm | X | Y | Z | Cancel ]
```
At that point, review whether Object mode still needs to remain at 5 to maintain the
"never shrink" invariant, or whether 5 becomes the universal fixed count.

---

## References

- ADR-008: Mode Transition State Machine (mode definitions)
- ADR-023: Mobile Input Model (touch gesture model, long-press context menu)
- MENTAL_MODEL §3 UI & Layout Adaptability (`.claude/mental_model/3_ui_layout.md`)
- ROADMAP: Mobile UX Phase 1 & 2 (2026-03-28), Phase 3 (planned)
