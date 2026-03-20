# Session Log

Full history of all development sessions. See `CLAUDE.md` for the 3 most recent entries.

---

- **2026-03-17**: Refactored `src/main.js` to MVC pattern. Separated pure functions from side effects into `model/` / `view/` / `controller/`. Session complete.
- **2026-03-18**: Documentation update. Fully revised README.md to match the implemented MVC structure. Added `computeOutwardFaceNormal` to the Model pure function list in CLAUDE.md; updated MeshView and UIView responsibility descriptions to match reality.
- **2026-03-18**: Added Blender-style grab controls (G/X/Y/Z, numeric input, confirm/cancel). Disabled OrbitControls inertia (enableDamping = false). Translated all in-repo text from Japanese to English.
- **2026-03-19**: Adopted ROS world frame (+X forward, +Y left, +Z up). Updated coordinate system in CuboidModel (face definitions, corner labels), SceneView (camera.up, grid rotation), AppController (Ctrl+drag rotation axis Y→Z), MeshView (extrusion arm axis preference), and GizmoView (top/bottom snap Z+/Z-).
- **2026-03-19**: Blender-style UI overhaul. Added header bar with mode dropdown (Object Mode / Edit Mode), Tab key toggle, N panel (N key) for Location/Dimensions, bottom info bar with context-sensitive key hints. Renamed 'face' mode to 'edit'.
- **2026-03-19**: Refined status display to be fully Blender-like. Removed floating yellow status div; integrated status into the header bar (centered). Added `setStatusRich(parts)` to UIView for colored, segmented status text. Grab now shows axis in X/Y/Z colors (red/green/blue), Extrude shows face name + distance, object selection shows object name.
- **2026-03-20**: Architecture design session (no implementation). Decided on voxel-based modeling approach. Defined two modeling methods: Method A (Primitive Box) and Method B (Sketch → Extrude → same Edit Mode). Adopted middle-click for orbit (freeing right-click for cancel/context-menu). Defined Edit Mode adapting to object type (1D/2D/3D) instead of separate Sketch Mode. Designed object hierarchy with dimensional classification. Mobile support added to backlog (low priority). ADRs written to `docs/adr/` (ADR-001 through ADR-006). `docs/ROADMAP.md` fully revised.
- **2026-03-20**: Added `docs/adr/README.md` (ADR index with rules and new-ADR procedure). Added `.claude/commands/adr.md` (`/adr <topic>` slash command). Added Document navigation section to CLAUDE.md. Refactored CLAUDE.md to agent-instructions-only format; moved full session log to `docs/SESSION_LOG.md`.
