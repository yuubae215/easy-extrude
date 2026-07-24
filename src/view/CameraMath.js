/**
 * CameraMath — pure arithmetic for the focus/frame camera flight (ADR-068).
 *
 * Pure and THREE-free (bare `node --test` lane): every function maps plain
 * number records to number records. `SceneView.focusPose` and `CameraFlight`
 * apply the results to THREE vectors; `AppController._animate` owns the clock.
 *
 * The framing derivation (`focusPose`) is the ONE source shared by the instant
 * path (`SceneView.fitCameraToSphere`) and the animated path (`CameraFlight`),
 * so a "frame the scene" jump and a "frame the selection" flight can never
 * drift apart (核 §1.1 single source). Everything is deterministic.
 */

/**
 * Compute the camera pose that frames a bounding sphere, keeping the current
 * orbital direction — the THREE-free core of the old `fitCameraToSphere` math
 * (SceneView). The camera sits `dist` away from `center` along `dir`, where
 * `dist` fits the sphere into the vertical FOV with a 1.3× margin.
 *
 * @param {{x:number,y:number,z:number}} center  sphere centre (world)
 * @param {number} radius  sphere radius (world units; clamped ≥ 1e-6)
 * @param {{x:number,y:number,z:number}} dir  current view direction
 *   (camera − target); zero-length falls back to a 3/4 view
 * @param {number} fovDeg  perspective vertical FOV in degrees
 * @param {number} [margin=1.3]  distance multiplier (headroom around the sphere)
 * @returns {{position:{x:number,y:number,z:number},
 *            target:{x:number,y:number,z:number}, dist:number}}
 */
export function focusPose(center, radius, dir, fovDeg, margin = 1.3) {
  const r = Math.max(radius, 1e-6)
  const halfFovRad = (fovDeg * 0.5) * Math.PI / 180
  const dist = (r / Math.sin(halfFovRad)) * margin

  // Normalise the orbital direction; fall back to a pleasant 3/4 view.
  let dx = dir.x, dy = dir.y, dz = dir.z
  let len = Math.hypot(dx, dy, dz)
  if (!(len > 1e-5)) { dx = 1; dy = -0.7; dz = 0.5; len = Math.hypot(dx, dy, dz) }
  const s = dist / len

  return {
    position: { x: center.x + dx * s, y: center.y + dy * s, z: center.z + dz * s },
    target:   { x: center.x, y: center.y, z: center.z },
    dist,
  }
}

/** Absolute near-plane floor (world units) so tiny scenes keep a small near. */
const NEAR_FLOOR = 0.01

/**
 * Clip planes that frame a bounding sphere at camera distance `dist`, sharing
 * the framing derivation with `focusPose` (核 §1.1 single source — both the
 * instant `fitCameraToSphere` and the animated `CameraFlight` consume this).
 *
 * The near plane SCALES WITH the scene (`radius · 0.001`, floored at
 * `NEAR_FLOOR`), it is not capped at it. A fixed 0.01 near in a scene that is
 * thousands of units across (mm-authored layouts) collapses depth-buffer
 * precision at Z=0, so coplanar surfaces — a Solid's base and a Zone fill plane
 * both at Z=0 — Z-fight into shimmering "gabigabi" shading even though a
 * `polygonOffset` is meant to separate them. Scaling near with the scene keeps
 * the near:far ratio bounded, restoring precision where the geometry actually
 * sits. The `radius · 0.001` term stays well in front of the nearest visible
 * geometry (`dist − radius`), so nothing is clipped.
 *
 * Far never shrinks below the camera's current far (monotone growth as scenes
 * or selections are framed), matching the pre-extraction behaviour.
 *
 * @param {number} radius   bounding-sphere radius (world units)
 * @param {number} dist     camera→target distance (world units, from focusPose)
 * @param {number} currentFar  the camera's present far plane (never reduced)
 * @returns {{near:number, far:number}}
 */
export function clipPlanesFor(radius, dist, currentFar) {
  const r = Math.max(radius, 0)
  return {
    near: Math.max(NEAR_FLOOR, r * 0.001),
    far:  Math.max(currentFar, dist * 2 + r * 4),
  }
}

/**
 * Vertical extent (world units) a perspective camera at distance `dist` frames
 * on a plane through its target — i.e. the orthographic frustum height that
 * MATCHES the perspective framing at the moment of a projection swap
 * (ADR-072 decision 1: Map Mode enter). Inverse of `distanceForFrustum`.
 *
 * @param {number} dist  camera→target distance (world units, > 0)
 * @param {number} fovDeg  perspective vertical FOV in degrees ∈ (0, 180)
 * @returns {number} frustum height = 2·dist·tan(fov/2)
 */
export function frustumForDistance(dist, fovDeg) {
  return 2 * dist * Math.tan((fovDeg * 0.5) * Math.PI / 180)
}

/**
 * Camera→target distance at which a perspective camera frames `frustum`
 * world units vertically — the staging distance for the Map Mode EXIT swap
 * (ADR-072 decision 1). Inverse of `frustumForDistance` (round-trip identity
 * is machine-tested).
 *
 * @param {number} frustum  orthographic frustum height (world units, > 0)
 * @param {number} fovDeg  perspective vertical FOV in degrees ∈ (0, 180)
 * @returns {number} dist = frustum / (2·tan(fov/2))
 */
export function distanceForFrustum(frustum, fovDeg) {
  return frustum / (2 * Math.tan((fovDeg * 0.5) * Math.PI / 180))
}

/**
 * Linear interpolation between two 3-vectors at eased fraction `e`.
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @param {number} e  eased progress ∈ [0,1]
 * @returns {{x:number,y:number,z:number}}
 */
export function lerpVec(a, b, e) {
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    z: a.z + (b.z - a.z) * e,
  }
}
