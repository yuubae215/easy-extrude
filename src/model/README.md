# Model Layer — Pure Computation & Application State

**Responsibility**: Geometry computation (stateless pure functions) and the
scene-state aggregate root.

Files: `CuboidModel.js`, `SceneModel.js`

---

## Meta Model: Separate Computation from State

| File | Classification | Rule |
|------|---------------|------|
| `CuboidModel.js` | Pure computation | No side effects. Same input must always produce the same output. |
| `SceneModel.js` | Aggregate root (state) | Canonical collection of domain objects. No Three.js. |

## CuboidModel Purity Constraint

```js
// Good — pure function
export function computeGeometry(params) { return { vertices, indices } }

// Bad — side effect (forbidden)
export function computeGeometry(params) {
  scene.add(new THREE.Mesh(...))  // Three.js reference → move to View layer
}
```

## SceneModel Aggregate Rules (ADR-008)

- `SceneModel` is the single canonical collection of domain entities
- It is the canonical source for mode and substate (`selectionMode`, `editSubstate`)
- State transitions that bypass `setMode()` are forbidden (see `MENTAL_MODEL.md` §1)

## Concurrency Note

High-frequency `editSelection` updates are lock-free (optimistic). Heavy
consistency-critical operations (e.g. export) have their `isProcessing` flag
managed by the Service layer. See `docs/CONCURRENCY.md` §2–3.
