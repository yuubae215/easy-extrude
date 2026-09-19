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

import { MM_PER_METER } from '../domain/worldUnits.js'

/**
 * Framing radius floors, in world units (mm — ADR-136). Both used to be bare
 * metre-era literals scattered across `AppController` (`0.5` in `_focusSphere`,
 * `1` and `10` in `_frameLayoutDsl`), which is why ADR-136's mm decision could
 * not reach them: a floor spelled as a naked number does not say what it
 * measures. Expressed against the unit authority they are readable as physical
 * sizes, the same idiom ADR-136 used for the robot seed (ADR-137).
 *
 * `MIN_FRAME_RADIUS` (50mm = one default-cube half-extent) keeps a single small
 * part from being framed so closely the camera ends up inside it.
 * `EMPTY_SCENE_RADIUS` (1m) is what "frame nothing" means — a workspace-sized
 * view, not a pinhole.
 */
export const MIN_FRAME_RADIUS   = MM_PER_METER * 0.05
export const EMPTY_SCENE_RADIUS = MM_PER_METER

/**
 * Radius of the sphere the BOOT opening shot frames — a WORKSPACE around the
 * starter part, not the part itself (ADR-137).
 *
 * Expressed as a radius rather than as extra camera headroom because the framed
 * radius is what the rest of the stage derives from: `SceneView._updateGridScale`
 * sizes the ground grid from it and `SceneStage.setScale` thins the depth fog
 * from that same power-of-10 step. Pulling the camera back without telling those
 * two leaves the opening shot correctly framed and half-swallowed by fog tuned
 * for a closer eye — one number for "how big is the view" keeps camera, grid and
 * fog on the same page (§1.1).
 *
 * 300mm reproduces the opening shot this app shipped with: the old hand-authored
 * pose sat 7.81 units from the 1m starter cube's 0.866 half-diagonal, putting the
 * cube at ~11% of screen height, and `dist = radius / sin(fov/2) · 1.3` puts the
 * camera 780mm from a 300mm sphere at the boot FOV of 60°. Framing the scene at
 * boot without this would swap a familiar wide shot for a tight one — a change to
 * the product nobody asked for.
 */
export const BOOT_VIEW_RADIUS = MM_PER_METER * 0.3

/**
 * The opening shot's orbital DIRECTION — front (+X), right (−Y), above (+Z).
 *
 * A direction, not a pose: `focusPose` keeps the current orbital direction and
 * computes the distance from the framed radius, so the camera's constructed
 * position only ever contributed its direction. It used to be written
 * `camera.position.set(6, -4, 3)`, where the 6/−4/3 read as a distance and was
 * one — a metre-era one, which is how the camera ended up 7.81mm from a scene
 * measured in millimetres (ADR-137). Split out so the part that MEANS something
 * survives a unit decision and the part that does not cannot be mistaken for it.
 */
export const BOOT_VIEW_DIRECTION = Object.freeze({ x: 0.77, y: -0.51, z: 0.38 })

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
