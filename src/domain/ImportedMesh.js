/**
 * ImportedMesh — domain entity for STEP / server-side geometry imports (Phase C).
 *
 * Thin-client entity: geometry is computed on the server and streamed via the
 * Geometry Service WebSocket. The entity itself carries only identity + display
 * state — no local vertex/edge/face graph.
 *
 * Type identity:
 *   `instanceof ImportedMesh` → read-only imported geometry; no Edit Mode.
 *   `instanceof Cuboid`       → locally-editable deformable box.
 *   `instanceof Sketch`       → 2D sketch awaiting extrusion.
 */
export class ImportedMesh {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('../view/ImportedMeshView.js').ImportedMeshView} meshView
   */
  constructor(id, name, meshView) {
    this.id       = id
    this.name     = name
    this.meshView = meshView
  }

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }
}
