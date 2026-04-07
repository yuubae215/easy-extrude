/**
 * Branded spatial types for compile-time coordinate space safety.
 *
 * Both WorldVector3 and LocalVector3 are THREE.Vector3 at runtime.
 * The `_brand` intersection makes them distinct to `tsc --checkJs`,
 * so the type checker rejects misuse without any runtime overhead
 * and without requiring a TypeScript migration (ADR-021, PHILOSOPHY #21).
 *
 * Usage in JSDoc:
 *   @param  {import('../types/spatial.js').WorldVector3} worldPos
 *   @returns {import('../types/spatial.js').LocalVector3[]}
 *
 * Enforcement:
 *   pnpm typecheck  →  tsc --noEmit --checkJs
 */

/**
 * A THREE.Vector3 expressed in the scene's global coordinate system.
 * - Cuboid.corners, Profile.corners, ImportedMesh.corners
 * - SceneService._worldPoseCache values (position)
 * - All centroids computed from geometry corners
 *
 * @typedef {import('three').Vector3 & { _brand: 'world' }} WorldVector3
 */

/**
 * A THREE.Vector3 expressed relative to a parent frame's world position.
 * - CoordinateFrame.translation
 * - CoordinateFrame.localOffset  (returns [this.translation])
 *
 * Passing a LocalVector3 where a WorldVector3 is expected (or vice versa)
 * produces a tsc type error at `pnpm typecheck`.
 *
 * @typedef {import('three').Vector3 & { _brand: 'local' }} LocalVector3
 */

export {}
