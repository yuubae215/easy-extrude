# Mental Model: Memory Management (Three.js)

Detail file for `.claude/MENTAL_MODEL.md` Section 4.

---

## WsChannel Native Event Listener Cleanup

- **Principle**: Native `WebSocket.addEventListener` callbacks are not automatically removed when the socket is closed, so re-opening a channel without removing old listeners causes two handlers to fire for every server message.
- **Concrete Rule**: In `WsChannel._connect()`, save each bound handler as an instance property (`_onWsOpen`, `_onWsMessage`, `_onWsClose`, `_onWsError`). In `close()`, call `this._ws.removeEventListener(...)` for all four before calling `this._ws.close()`. Set `this._ws = null` after closing.

## Read-Only Entity Early-Return Must Show Feedback

- **Principle**: When an operation is silently blocked for a read-only entity type (`ImportedMesh`), the user sees no indication that the shortcut was consumed. This breaks the "shortcut -> visible effect" contract.
- **Concrete Rule**: Any early-return that blocks `setMode('edit')` or `_startGrab()` for `ImportedMesh` must call `this._uiView.showToast('Imported geometry is read-only')` before returning. The Tab key handler must additionally guard `e.preventDefault()` so the browser's own Tab behavior is not suppressed when no mode transition occurs.

## Object Lifecycle Symmetry

- **Principle**: Every dynamic memory allocation or scene addition must have a strictly enforced, symmetrical teardown in its disposal method to prevent memory leaks and ghost objects.
- **Concrete Rule**: In `MeshView`, every `scene.add()` or `new THREE.BufferGeometry()` in the constructor MUST have a matching `scene.remove()` and `.dispose()` in `dispose()`. Missing this breaks `SceneService.deleteObject()` — if `dispose()` throws (e.g. accessing a renamed property that is now `undefined`), `removeObject()` and `emit('objectRemoved')` never run, leaving the object in the model (outliner intact, snap candidates still active) while only the main mesh is visually removed. Whenever you add a new Three.js object in the constructor, add the teardown in the same commit.

## _clearScene Must Emit objectRemoved Before Swapping Model

- **Principle**: Replacing `this._model` in `_clearScene()` without emitting `objectRemoved` for each object causes an invisible split-brain state: the new model is empty, but the OutlinerView retains stale DOM rows and `AppController._activeObj` may hold references to disposed objects.
- **Concrete Rule**: `_clearScene()` must iterate `this._model.objects` **before** the swap, call `obj.meshView.dispose(threeScene)` and `this.emit('objectRemoved', id)` for every entry, then clear `_worldPoseCache`, and only then replace `this._model = new SceneModel()`. Failure to emit causes the Outliner to show deleted objects after a scene load (the "default Cube stays visible" bug).

```js
// CORRECT
_clearScene() {
  for (const [id, obj] of this._model.objects) {
    obj.meshView.dispose(this._threeScene)
    this.emit('objectRemoved', id)
  }
  this._worldPoseCache.clear()
  this._model = new SceneModel()
}
```

## SceneSerializer Must Handle Every Entity Type Explicitly

- **Principle**: Silently skipping an entity type in `serializeScene()` causes that type to disappear on the next load with no error. This is a silent data-loss bug — the save succeeds, the load succeeds, but objects are gone.
- **Concrete Rule**: Every domain entity class added to `SceneModel` (e.g. `Solid`, `Profile`, `MeasureLine`, `CoordinateFrame`, `ImportedMesh`) must be explicitly handled in `serializeScene()` — either serialized with a matching `_deserializeEntities` branch, or skipped with a comment explaining why. Verify that new entity types are covered in SceneSerializer in the same commit they are added to the domain layer.

## ImportedMesh Serialization: Base64 Typed Arrays + Position Offset

- **Principle**: Raw Float32/Uint32 buffers cannot be stored directly in JSON. Base64 encoding is used so geometry survives round-trip through the BFF DB without loss.
- **Concrete Rule**: `serializeScene()` encodes the three buffers via `f32ToBase64` / `u32ToBase64` (helpers in `SceneSerializer.js`) and stores `offset: {x,y,z}` for the current `cuboid.position`. On deserialization, `base64ToF32` / `base64ToU32` reconstruct the typed arrays, `updateGeometryBuffers()` re-creates the `BufferGeometry`, then `cuboid.position` is manually restored from `offset` **before** calling `initCorners(getInitialCorners8())`. This order matters: `getInitialCorners8()` reads `cuboid.position`, so setting the offset first ensures AABB corners are world-correct.
