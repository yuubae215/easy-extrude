# ADR-041 — Semantic Inference Suggestions

**Status**: Accepted  
**Date**: 2026-05-17  
**Supersedes**: —  
**Related**: ADR-030 (SpatialLink), ADR-038 (URDF Link Taxonomy), ADR-039 (Operation State Machine)

---

## Context

easy-extrude supports a rich SpatialLink vocabulary (9 semanticTypes, 6 jointTypes — ADR-038) but
users consistently default to `fastened` for all links because the link-creation flow (L-key →
pick target → choose type) is explicit and manual. The richer vocabulary (`above`, `adjacent`,
`contains`, `aligned`, `mounts`) is effectively unused.

The domain model already encodes the geometry needed to _infer_ design intent: when a user drags
a Solid until it rests on top of another Solid, the system has all the information needed to
propose an `above` annotation automatically. The user's spatial action (the drag) embodies the
intent; the system's job is to elevate that accidental geometry into explicit semantics.

---

## Decision

After every confirmed grab/drag operation (G-key grab confirm, QuickDrag mouse-drag release), run
a lightweight geometric heuristic pass (`SemanticInferencer.js`) and show a non-intrusive
**suggestion banner** if a plausible SpatialLink is found.

The banner:
- Appears at the bottom of the screen (above the mobile toolbar)
- Describes the inferred relationship in plain language: `"Cube_001" is above "Floor_001"`
- Offers a single **Link (Label)** button and a **×** dismiss button
- Auto-dismisses after 6 seconds
- Is never mandatory — dismissal is always respected

---

## Heuristics

All heuristics operate on world-space AABB (Axis-Aligned Bounding Box) derived from `Solid.corners`.
AABB is conservative for rotated Solids (it expands), but precise enough for a suggestion signal.

| Heuristic | Condition | semanticType | Confidence formula |
|-----------|-----------|--------------|-------------------|
| **A. above** | `abs(moved.AABB.minZ − target.AABB.maxZ) < 0.15` AND XY footprints overlap | `above` (null joint) | `1 − gap / 0.15` |
| **B. adjacent** | Any side-face pair distance < 0.15 AND perpendicular overlap | `adjacent` (null joint) | `0.7 × (1 − dist / 0.15)` |
| **C. contains** | moved Solid's XY centroid inside AnnotatedRegion polygon | `contains` (null joint) | 0.85 (fixed) |

Priority rule: if heuristic A fires for a given pair, heuristic B is skipped for that same pair
(`continue` after A match prevents double-suggestions).

Only the **highest-confidence** suggestion is shown (at most 1 banner at a time).

---

## Constraints

1. **Single-object moves only** — inference is skipped when `selectedIds.size > 1` to avoid
   ambiguous multi-pair suggestions.
2. **Solid entities only** — only moved entities of type `Solid` are candidates.
   CoordinateFrame, ImportedMesh, MeasureLine, and Annotated* entities are excluded as sources.
3. **No duplicate links** — pairs that already share any SpatialLink are silently skipped.
4. **Pure computation** — `SemanticInferencer.js` has no DOM or scene-mutation side effects.
   It is a pure function of its inputs: `(moved, sceneObjects, existingPairs) → Suggestion[]`.
5. **Dismissal is the user's authority** — the banner never auto-creates a link; user must
   explicitly click **Link**. A single dismiss permanently drops that suggestion.

---

## Consequences

### Positive
- Rich semantic vocabulary becomes discoverable through natural spatial interaction.
- Zero friction when the user doesn't want the link (×, or just wait 6 s).
- No new mode, no new toolbar button — the feature is contextual and invisible until relevant.
- Pure computation module is independently testable without any UI or service setup.

### Negative / Trade-offs
- AABB-based proximity can produce false positives for rotated or irregularly-shaped Solids.
  The 6-second auto-dismiss and explicit dismiss button mitigate this.
- QuickDrag (desktop mouse drag) does not create a MoveCommand; if the user accepts the
  suggestion, the link is created without an accompanying undo for the move. This is an
  existing limitation of QuickDrag, not introduced by this ADR.
- Only 3 of the 9 semanticTypes are inferred today (`above`, `adjacent`, `contains`).
  Geometric types (`fastened`, `mounts`, `aligned`) require CoordinateFrame pairs and are
  best created explicitly via the L-key flow.

---

## Rejected Alternatives

**Always show the link picker after a move** — too disruptive; blocks orbit/camera interaction.

**Inline ghost-link preview during drag** — high implementation cost; requires per-frame
proximity computation in the animation loop.

**Infer for multi-object moves** — ambiguous (which pair?); deferred to a future iteration.
