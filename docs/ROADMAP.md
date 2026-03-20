# Roadmap

## Design Direction (2026-03-20)

This project is a **cuboid-based modeling application**. Each shape is a deformable box defined by 8 corner vertices. Complex scenes are built by placing and deforming multiple cuboid objects. See `docs/adr/` for detailed design decisions.

---

## Backlog

| Priority | Item | Complexity | ADR / Notes |
|----------|------|-----------|-------------|
| 🔴 High | Method B: Sketch → Extrude (2D rect → Cuboid) | Medium | ADR-002 |
| 🔴 High | Edit Mode adapts to object type (2D/3D dispatch) | Medium | ADR-004 |
| 🟡 Medium | Object hierarchy + Outliner tree view | Medium | ADR-005 |
| 🟡 Medium | Right-click context menu (currently: cancel only) | Low | ADR-006 |
| 🟡 Medium | Multi-face extrude (Shift+click) | Medium | — |
| 🟡 Medium | Export (OBJ / GLTF) | Low | — |
| 🟢 Low | Mobile / touch support | Medium | See below |
| 🟢 Low | 1D objects: MeasureLine, reference line | Medium | ADR-005 |

---

## Mobile Support (Backlog · Low Priority)

**Goal:** Allow cuboid editing and scene navigation on smartphones and tablets.

### Challenge: no middle mouse button on touch

The desktop scheme uses right-drag for orbit. Touch devices have no right button.

### Proposed touch mapping

| Gesture | Action |
|---------|--------|
| 1-finger drag | Edit action (extrude face / sketch rect) |
| 2-finger drag | Orbit camera |
| Pinch | Zoom |
| Long-press | Context menu (replaces right-click) |
| Tap | Select / confirm |

OrbitControls already handles 2-finger orbit and pinch-to-zoom natively. The main work is routing single-finger drag to edit actions while letting 2-finger gestures pass through to OrbitControls.

### Implementation notes

- Replace `mousedown/mousemove/mouseup` with **Pointer Events API** (`pointerdown`, `pointermove`, `pointerup`) — unifies mouse, touch, stylus
- Track `_activeDragPointerId`; ignore secondary pointers during an edit drag
- Suppress browser context menu on long-press: `contextmenu` → `e.preventDefault()`
- Add `touch-action: none` CSS on canvas
- Ensure all UI tap targets >= 44x44 px
- Verify `renderer.setPixelRatio(window.devicePixelRatio)` for HiDPI screens

### Key risks

- Long-press context menu conflicts with hold-to-drag on some Android browsers
- Alt+left-drag (orbit fallback for trackpad users) may be worth adding simultaneously

---

## Completed

| Item | Date |
|------|------|
| Custom BufferGeometry cuboid + Face Extrude | 2026-03-17 |
| MVC refactor (Model / View / Controller separation) | 2026-03-17 |
| Blender-style Grab controls (G/X/Y/Z, numeric input) | 2026-03-18 |
| ROS world frame (+X forward, +Y left, +Z up) | 2026-03-19 |
| Blender-style UI (header bar, N panel, bottom info bar) | 2026-03-19 |
| Colored status display (`setStatusRich`) | 2026-03-19 |
| Cuboid-based architecture design + ADRs (ADR-007) | 2026-03-20 |
