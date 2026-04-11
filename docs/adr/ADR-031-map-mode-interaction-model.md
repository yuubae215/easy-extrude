# ADR-031 — Map Mode Interaction Model & Visual Language

**Status:** Accepted
**Date:** 2026-04-11
**References:** ADR-023, ADR-024, ADR-029, ADR-006

---

## Context

Map mode (introduced with ADR-029) accumulated UX inconsistencies as features were added
incrementally without a unified interaction model:

1. **Inconsistent confirm flow.** Zone drag confirmed immediately on `pointerup`; Point click
   confirmed immediately; Line required multi-click then Enter/RMB.  No single mental model
   covered all three geometry types.

2. **No platform differentiation.** Mobile touch and PC mouse used the same code path
   despite fundamentally different input affordances (no hover on touch; no precision on
   fat-finger).

3. **WYSIWYG gap.** The rubber-band preview showed `[...points, cursor]` but confirmed
   entities only contained the explicitly clicked `points`.  The final endpoint visible in the
   preview was silently discarded.

4. **Visual state ambiguity.** "Drawing in progress" (rubber-band following cursor),
   "awaiting confirmation" (gesture complete, entity not yet created), and "confirmed entity"
   had no visually distinct representations.  Users could not tell whether an object existed
   yet or not.

5. **No naming in creation flow.** Entities were created with auto-generated names; the only
   way to rename was post-hoc via the N-panel or Outliner.

6. **Animation deficiencies.**
   - Route particle animation was silently broken: `AnnotatedLineView.setPlaceType()` did not
     call `_rebuildParticles()`, so particles were never created when type was set after
     construction.
   - Zone (fill breathing: 0.10 → 0.28) and Anchor (ring breathing) animations were too
     subtle to be perceived as "alive".

---

## Decision

### 1. Three-State Drawing Model

All Map mode drawing follows a strict three-state lifecycle.  No entity is created until the
user explicitly confirms from the `pending` state.

```
idle ──[select tool]──▶ drawing ──[gesture complete]──▶ pending ──[confirm]──▶ idle
                                                              │
                                                        [cancel / ESC]
                                                              │
                                                            idle
```

| State | Meaning |
|-------|---------|
| `idle` | No active tool; pan/select is available |
| `drawing` | Gesture or multi-click in progress; rubber-band preview active |
| `pending` | Geometry fully defined; entity preview shown statically; awaiting name + confirm |

### 2. Platform-Specific Interaction

Detection uses `window.matchMedia('(pointer: coarse)')` (same as ADR-023).

#### Mobile (pointer: coarse)

All geometry types use a **single drag gesture**.  Complexity (polylines, arbitrary polygons)
is deferred to a future control-point editing mode.

| Type | Gesture | Result |
|------|---------|--------|
| Point | Tap (any movement) | Single-point → `pending` |
| Line | Drag (pointerdown → pointerup) | 2-point straight line → `pending` |
| Region | Drag (pointerdown → pointerup) | Axis-aligned rectangle → `pending` |

**Minimum drag threshold:** If pointer movement < 8 px screen-space AND geometry is Line or
Region, the gesture is cancelled silently (prevents zero-length lines and zero-area regions).
Point is exempt — a tap always produces a valid point.

- `pointerdown` → records start; enters `drawing`; shows live preview
- `pointermove` → updates preview (straight line or rectangle from start to cursor)
- `pointerup` → validates movement threshold, enters `pending` or cancels

#### PC (pointer: fine)

| Type | Interaction | → `pending` trigger |
|------|-------------|---------------------|
| Point | Single click | Immediately on click |
| Line | Multi-click vertices (rubber-band after each click) | Enter or RMB |
| Region | Drag-rectangle (same gesture as Mobile) | `pointerup` (no movement threshold) |

**PC Line rules:**
- Each click adds a vertex to `points[]` and updates the rubber-band preview.
- Enter / RMB with `points.length < 2` is a no-op (status bar shows minimum-point hint).
- The cursor position at the moment of Enter/RMB is **not** automatically added as a final
  vertex.  Every vertex must be explicitly clicked.  This matches CAD conventions and avoids
  "phantom endpoints" caused by cursor drift.

### 3. Pending State Visual Language

The three states are visually unambiguous:

| State | Line style | Opacity | Motion |
|-------|-----------|---------|--------|
| `drawing` | Solid, place-type colour | 70% | Follows cursor live (rubber-band) |
| `pending` | **Dashed**, place-type colour | 90% | Static; no cursor following |
| `confirmed` | Solid, place-type colour | 100% | Type-specific animation (see §8) |

The dashed outline in `pending` communicates "this shape exists but is not committed".
Vertex dot markers are shown in both `drawing` and `pending`.

### 4. Naming Before Confirm

Entering `pending` state triggers a **name input field** in the Map toolbar (both platforms).

- Default name: `"{PlaceType} {N}"` — e.g. "Route 1", "Zone 3" — where N is the
  per-type creation counter.
- User may edit the name inline or accept the default.
- Confirm button (Mobile) / Enter key (PC) creates the entity with the current name and
  resets the tool to `idle`.
- Cancel button (Mobile) / ESC (PC) discards the pending entity and resets to `idle`.

### 5. Tool Reset After Confirm

All geometry types reset to `idle` after confirmation.  **Chain drawing is removed.**

The use case previously served by chain drawing (connecting adjacent lines) is addressed
instead by **endpoint snapping** (§6), which is more flexible: any new Line can start from
any existing endpoint regardless of creation order.

### 6. Endpoint Snapping (PC only)

When placing Line vertices or any geometry start point on PC, the cursor **snaps** to:

- Endpoints of existing `AnnotatedLine` entities
- Vertex positions of existing `AnnotatedRegion` entities

Snap activates within **20 px screen-space** of an eligible vertex.  A snap-indicator ring
(same colour as the target entity, `renderOrder` above preview) appears on the target.

Snapping is **not** applied on Mobile (tap imprecision makes it unreliable).

Deferred: midpoint snapping, intersection snapping.

### 7. Cancellation

| Platform | `drawing` state | `pending` state |
|----------|-----------------|-----------------|
| Mobile | Cancel button in Map toolbar | Cancel button in Map toolbar |
| PC | ESC key | ESC key |

The Cancel button is always visible in the Map toolbar while a tool is active (during both
`drawing` and `pending`).  This satisfies the mobile toolbar stability rule (ADR-024 §2):
slots are fixed; Cancel occupies a dedicated slot.

### 8. Animations

#### Route (AnnotatedLineView) — Bug Fix

`setPlaceType()` must call `_rebuildParticles(this._points)` after updating `this._placeType`.
Points must be stored as `this._points` (updated in constructor and `updateGeometry()`).

Parameters unchanged: 4 particles, speed 0.22 length/sec.

#### Zone (AnnotatedRegionView) — Strengthened

| Parameter | Before | After |
|-----------|--------|-------|
| Fill opacity range | 0.10 → 0.28 | 0.15 → 0.65 |
| Fill cycle | 4 s sine | 4 s sine (unchanged) |
| Rim ring | — | New: ring at boundary, scale 1.0× → 1.08×, opacity 0.40 → 0, 3 s cycle |

The rim ring gives a "living aura" effect — the region radiates outward subtly without
obscuring the fill.

#### Hub (AnnotatedPointView) — Unchanged

Sonar-ping ring: scale 1× → 4×, opacity 0.65 → 0, 2 s cycle.

#### Anchor (AnnotatedPointView) — Redesigned

Replace ring breathing with a **crosshair pulse**:

- 4 short line segments radiating from the central dot (±X, ±Y directions, length 0.18 m)
- Crosshair scale pulses: 1.0× → 1.3× → 1.0×, 4 s sine cycle
- Opacity: 0.55 (constant) — calm, unhurried, "pinned in place"
- Removes the sonar ring; replaces `_ringMat` breathing

The crosshair viewed from overhead reads as a map pushpin or survey datum marker — a fixed
reference that does not move.

#### Boundary (AnnotatedLineView) — Unchanged

Static solid line.  No animation.  Conveys "barrier" semantics.

---

## Consequences

**Positive:**
- One mental model covers all geometry types on both platforms.
- Visual state machine (drawing → pending → confirmed) is explicit and perceivable.
- Mobile interaction reduces to one gesture per entity — no toolbar mode changes mid-draw.
- Naming integrated into creation flow; N-panel rename becomes an edit-only operation.
- Endpoint snapping enables connected networks without chain drawing.
- Route animation bug eliminated; Zone and Anchor animations are visually engaging.

**Negative / Trade-offs:**
- Point creation adds one step (pending state + Confirm) compared to the previous
  immediate-confirm behaviour.
- PC multi-click Line loses the implicit "cursor = final vertex at Enter" shortcut.
- Endpoint snapping adds implementation complexity (screen-space projection, hit testing
  against annotation vertices).

**Deferred:**
- Multi-vertex polygon drawing on Mobile (requires a future control-point editing mode).
- Complex polyline editing: vertex insert, delete, drag mid-line.
- Midpoint and intersection snapping.
- Mobile endpoint snapping (requires larger snap radius tuning for touch).
