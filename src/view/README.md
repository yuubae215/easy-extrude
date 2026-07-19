# View Layer — Three.js & DOM Rendering

**Responsibility**: Rendering, Three.js scene management, DOM UI.

Representative files: per-entity views (`MeshView`, `ImportedMeshView`,
`CoordinateFrameView`, `MeasureLineView`, `SpatialLinkView`,
`Annotated{Line,Region,Point}View`), scene infrastructure (`SceneView`,
`SceneStage`, `GizmoView`), DOM UI (`UIView`, `OutlinerView`,
`NodeEditorView`, bridges to React), and the motion system
(`MotionGovernor`, `CameraFlight`, `BootReveal`, effect views — ADR-065…068).

**`*Math.js` companion pattern** (pure/side-effect separation): every
nontrivial view has a paired pure-computation module with unit tests
(`StageMath`, `CameraMath`, `FeedbackMath`, `GraspGhostMath`, …). All
animation/layout math lives there; the view applies results to Three.js/DOM.

---

## Meta Model: The Side-Effect Sink

The View layer is the designated home for Three.js and DOM side effects.

| Permitted | Prohibited |
|-----------|------------|
| Direct `THREE.*` manipulation | Domain logic (re-implementing `Profile.extrude()`, etc.) |
| `document.*` operations | Direct writes to `SceneModel` |
| Holding visual state | Calling Service methods directly (go through Controller) |

## Visual State Ownership (PHILOSOPHY #4, `docs/code_contracts/architecture.md`)

Each visual flag has **exactly one mutator method**:

| Element | Owner method |
|---------|-------------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

Never set these flags outside their designated owner.

## Memory Management Symmetry (`docs/code_contracts/memory_management.md`)

Every `scene.add()` and `new THREE.BufferGeometry()` in the constructor must
have a matching `scene.remove()` and `.dispose()` in `dispose()`. Add teardown
in the same commit as the allocation.

## Mobile UI Stability (`docs/code_contracts/ui_layout.md`)

- The visible button set is fixed per mode. Use `disabled` instead of hiding
  buttons that are temporarily unavailable.
- `showToast()` must check `_isMobile()` and set `bottom: 96px` (desktop:
  `64px`) so the toast appears above the mobile toolbar.

## Lock Feedback (Concurrency)

When the Service emits `isProcessing = true`, the View is responsible for
disabling pointer events on the affected object and showing a loading
indicator. The `isProcessing` check logic must not live in the View — it is
delegated via a Controller method call. See `docs/CONCURRENCY.md` §4.
