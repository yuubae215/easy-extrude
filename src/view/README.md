# View Layer — Three.js & DOM Rendering

**Responsibility**: Rendering, Three.js scene management, DOM UI.

Files: `MeshView.js`, `ImportedMeshView.js`, `SceneView.js`, `UIView.js`,
`OutlinerView.js`, `GizmoView.js`, `NodeEditorView.js`

---

## Meta Model: The Side-Effect Sink

The View layer is the designated home for Three.js and DOM side effects.

| Permitted | Prohibited |
|-----------|------------|
| Direct `THREE.*` manipulation | Domain logic (re-implementing `Cuboid.extrude()`, etc.) |
| `document.*` operations | Direct writes to `SceneModel` |
| Holding visual state | Calling Service methods directly (go through Controller) |

## Visual State Ownership (MENTAL_MODEL §1)

Each visual flag has **exactly one mutator method**:

| Element | Owner method |
|---------|-------------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

Never set these flags outside their designated owner.

## Memory Management Symmetry (MENTAL_MODEL §4)

Every `scene.add()` and `new THREE.BufferGeometry()` in the constructor must
have a matching `scene.remove()` and `.dispose()` in `dispose()`. Add teardown
in the same commit as the allocation.

## Mobile UI Stability (MENTAL_MODEL §3)

- The visible button set is fixed per mode. Use `disabled` instead of hiding
  buttons that are temporarily unavailable.
- `showToast()` must check `_isMobile()` and set `bottom: 96px` (desktop:
  `64px`) so the toast appears above the mobile toolbar.

## Lock Feedback (Concurrency)

When the Service emits `isProcessing = true`, the View is responsible for
disabling pointer events on the affected object and showing a loading
indicator. The `isProcessing` check logic must not live in the View — it is
delegated via a Controller method call. See `docs/CONCURRENCY.md` §4.
