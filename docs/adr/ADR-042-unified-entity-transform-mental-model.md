# ADR-042: Unified Entity Transform Mental Model — Fixed-Slot Transform Policy

**Status**: Accepted
**Date**: 2026-05-20
**Related**: ADR-024 (Mobile Toolbar Architecture), ADR-023 (Mobile Input Model),
             ADR-039 (Operation State Machine), ADR-037 (Body Frame Architecture)

---

## Context

ADR-024 established the fixed-slot principle for transient operation bars (Grab active,
Rotate active, etc.) and defined the Object mode home state as a 5-slot row:

```
Object mode (generic):      [ Add | Dup | Edit | Delete | Stack ]
Object mode (Solid):        [ Add | Dup | Edit | Delete | Rotate ]
Object mode (CoordFrame):   [ Rotate | Grab | Delete | Add Frame | spacer ]
```

This layout has accumulated three pain points as the entity taxonomy expanded:

1. **Non-symmetric entity treatment.** Solids and CoordinateFrames have categorically
   different button layouts. A user who selects a Solid and then a CF sees a completely
   different toolbar — forcing a visual search instead of a learned tap.

2. **Cognitive overhead from mixed action categories.** The 5-slot bar conflates four
   different action *kinds* in a single row (structural editing, lifecycle management,
   transform operations, spatial-hierarchy extension). Users must mentally parse the bar
   rather than act on muscle memory.

3. **Origin frame produces a row of disabled buttons.** Origin CFs cannot be translated
   or rotated (ADR-037). In the current layout this results in slots silently showing as
   disabled without explaining why. The ADR-024 rule "never remove a slot" is honoured,
   but the *semantic reason* for the disabled state is invisible to the user.

As the app grows (more entity types, multi-level CF hierarchies), the current layout
diverges further from a single learnable model.

---

## Decision

### 1. Unified Object-Mode Home State (4 semantic slots)

Replace the per-entity-type Object mode layouts with a **single 4-slot layout** that
applies to every entity type.

```
Object mode (any entity):  [ Deselect | Grab | Rotate | Add [Context] ]
```

| Slot | Index | Semantic role | Always present |
|------|-------|--------------|---------------|
| **Deselect** | 0 | Navigation — exit selection | Yes |
| **Grab** | 1 | Kinematic — translate the entity | Yes (may be locked) |
| **Rotate** | 2 | Kinematic — rotate the entity | Yes (may be locked) |
| **Add [Context]** | 3 | Structural — extend the hierarchy | Yes |

The toolbar width is constant (4 slots). No slot is ever removed or replaced with a spacer
in the Object mode home state.

### 2. Locked State Instead of Disabled or Hidden

When an entity *structurally cannot* be moved or rotated (e.g. an Origin CoordinateFrame
fixed to its parent Solid by ADR-037), the Grab and Rotate slots display a **locked
variant** rather than a generic greyed-out disabled state:

- Icon changes from the action icon to a 🔒 lock icon.
- Label changes to `Fixed`.
- Tapping shows a brief toast: *"This frame is pinned to its Solid's origin."*
- The StateMachine does **not** transition — no grab or rotate state is entered.

This preserves the positional invariant (slot semantics are always the same) while
communicating the *reason* for the restriction. Compare with ADR-024 §2 which uses
`disabled: true` for temporarily unavailable actions — the locked variant is a stronger
signal used only for structurally permanent restrictions.

### 3. Context-Sensitive Label on Slot 3 (Add)

The **Add** slot always creates a child entity of the entity type that makes most sense
in context. The icon is constant; only the label changes:

| Selected entity | Slot 3 label | Creates |
|-----------------|--------------|---------|
| `Solid` | Add CF | CoordinateFrame as child of Origin CF (ADR-037) |
| `CoordinateFrame` (any, including Origin) | Add Child CF | CoordinateFrame as child of the selected CF |
| `ImportedMesh` | Add CF | CoordinateFrame at mesh centroid |
| `MeasureLine` | Add CF | CoordinateFrame at midpoint |
| `AnnotatedLine/Region/Point` | Add CF | CoordinateFrame at centroid |

This makes the hierarchy extension path *always discoverable* regardless of what is
selected, without requiring users to remember which entity types support which actions.

### 4. Full-Screen Axis-Locked Interaction

When Grab or Rotate is activated (tapping slot 1 or 2), the 3D viewport enters an
**axis-locked full-screen interaction mode** with a floating axis sub-bar.

**Axis sub-bar** (appears above the main toolbar, 3 or 4 slots):

```
Grab active:    [ X | Y | Z | XY-plane ]   (default: last used axis, or Z for first use)
Rotate active:  [ X | Y | Z ]              (default: last used axis, or Z for first use)
```

The selected axis is highlighted. Tapping another axis switches without restarting
the operation.

**Full-screen drag** — the user does not aim at a gizmo arrow:

- A drag anywhere on the viewport computes the 3D delta by intersecting the pointer ray
  with a **constraint plane** perpendicular to the camera and containing the active axis.
- The entity slides (Grab) or rotates (Rotate) along the selected axis, mapped
  proportionally to the 2D screen displacement.
- A thick coloured guide ray is drawn from the entity through the scene along the active
  axis to reinforce which axis is locked.

**Pivot guarantee (Rotate)**: the rotation pivot is always `obj._position`
(the ADR-040 primary triple) — never `getCentroid(obj.corners)`.
See CODE_CONTRACTS §"Rotate Pivot Must Use `_position` Directly".

**Confirm / Cancel**: the 4-slot transient bar replaces the axis sub-bar on confirmation:

```
Grab / Rotate active (confirm bar):  [ Cancel | ← axis | axis → | Confirm ]
```

This follows the ADR-024 §3 semantic slot rule (slot 0 = Cancel, slot 3 = Confirm)
and keeps the axis switch buttons available mid-operation.

### 5. Action Category Separation

The actions previously in Object mode (Dup, Edit, Delete) are **not removed** — they
move to the long-press context menu (ADR-023 §"Long-Press Context Menu"):

```
Long-press context menu (any entity):
  [ Grab | Duplicate | Edit | Rename | Delete ]
  (filtered by entity type — same rules as before)
```

This separates transform operations (toolbar) from lifecycle operations (context menu),
reducing the cognitive load of the primary toolbar without removing capability.

---

## Consequences

### Positive

- **Single learnable toolbar layout.** Every entity type uses the same 4-slot home
  state. A user who learns to select a Solid can immediately operate a CoordinateFrame
  without visual re-scanning.
- **Locked state communicates intent.** Users understand *why* a frame cannot be moved;
  the 🔒 icon is semantically stronger than a greyed button.
- **Hierarchy extension always accessible.** Slot 3 (Add) is never disabled or hidden —
  CF trees can always be extended regardless of the selected entity.
- **Full-screen drag reduces precision requirement.** Users do not need to aim at a
  small gizmo arrow. The entire viewport is the drag target.
- **Transform / lifecycle separation is cleaner.** Toolbar = spatial operations.
  Context menu = structural operations. Two menus, one job each.

### Negative / Trade-offs

- **Dup, Edit, Delete leave the primary toolbar.** Users must learn that lifecycle
  operations are behind a long press. The discoverability cost is real; mitigated by
  the existing long-press pattern (ADR-023) which already exposes Grab and Duplicate.
- **4-slot home state is narrower than the 5-slot predecessor.** If a future entity type
  requires a fifth permanent action, this layout must be revisited.
- **Axis sub-bar requires a second rendering layer.** The floating axis selector appears
  between the 3D viewport and the main toolbar. CSS `z-index` and positioning must be
  audited to avoid overlap with the toast layer (bottom: 96px on mobile).

---

## Implementation Contract

`UIView._renderObjectModeToolbar(entity)` must implement the following:

```js
_renderObjectModeToolbar(entity) {
  const isLocked = this._isTransformLocked(entity)

  const slots = [
    {                                                        // [0] Deselect
      icon: ICONS.x,
      label: 'Deselect',
      onClick: () => this._controller.deselect(),
    },
    {                                                        // [1] Grab
      icon: isLocked ? ICONS.lock : ICONS.grab,
      label: isLocked ? 'Fixed' : 'Grab',
      disabled: isLocked,
      lockedReason: isLocked ? this._lockReason(entity) : null,
      onClick: () => isLocked
        ? this._showLockToast(entity)
        : this._controller.startGrabMode(entity),
    },
    {                                                        // [2] Rotate
      icon: isLocked ? ICONS.lock : ICONS.rotate,
      label: isLocked ? 'Fixed' : 'Rotate',
      disabled: isLocked,
      lockedReason: isLocked ? this._lockReason(entity) : null,
      onClick: () => isLocked
        ? this._showLockToast(entity)
        : this._controller.startRotateMode(entity),
    },
    {                                                        // [3] Add [Context]
      icon: ICONS.plusCircle,
      label: entity instanceof Solid ? 'Add CF' : 'Add Child CF',
      onClick: () => this._controller.executeCommand('CreateCoordinateFrameCommand', {
        parent: entity,
      }),
    },
  ]

  this.setMobileToolbar(slots)
}

_isTransformLocked(entity) {
  // Origin CFs are pinned to the Solid body frame (ADR-037)
  return entity instanceof CoordinateFrame && entity.role === 'Origin'
}

_lockReason(entity) {
  if (entity instanceof CoordinateFrame && entity.role === 'Origin') {
    return 'This frame is pinned to its Solid\'s origin.'
  }
  return 'This entity cannot be transformed.'
}
```

**Invariants**:
- `setMobileToolbar()` is always called with exactly 4 items. No spacers in the
  Object mode home state.
- `_isTransformLocked()` is the single point that decides lock status — never
  branched at individual call sites.
- The long-press context menu continues to use the existing `_showLongPressContextMenu()`
  path (ADR-023); no changes to that contract.

---

## Relationship to ADR-024

ADR-024 remains the authority on:

- Fixed slot count principle (now 4 slots for Object mode home state, updated from 5)
- Transient operation bars (Grab active, Rotate active) — semantics unchanged
- `{ spacer: true }` and `disabled: true` patterns — used in transient bars, not in the new home state
- Toast and status bar positioning

ADR-042 **extends** ADR-024's fixed-slot principle to cover the Object mode home state
with a unified layout. The per-entity-type layout exceptions in ADR-024 §3
(`Object mode (CoordFrame)`, `Object mode (Solid)`) are superseded by this ADR's
4-slot unified layout.

---

## References

- ADR-023: Mobile Input Model (long-press context menu, touch gesture model)
- ADR-024: Mobile Toolbar Architecture (fixed-slot principle, transient operation bars)
- ADR-037: Body Frame Architecture (Origin CF lock rationale)
- ADR-039: Operation State Machine (Grab / Rotate state transitions)
- ADR-040: Solid Data Model Redesign (`_position` as rotation pivot)
- CODE_CONTRACTS §"Mobile Toolbar Stability" (`docs/code_contracts/ui_layout.md`)
- CODE_CONTRACTS §"Rotate Pivot Must Use `_position` Directly"
- PHILOSOPHY #15: Toolbar Slots Are Fixed; Buttons Are Not Removed
