/**
 * SnapSystem — pure snap-candidate filtering and selection utilities.
 *
 * All functions are stateless and take camera as an explicit parameter,
 * making them testable in isolation and reusable across handlers.
 */

import * as THREE from 'three'

/**
 * Projects a world-space position to screen pixel coordinates.
 * @param {THREE.Vector3} position
 * @param {THREE.Camera} camera
 * @returns {{ x: number, y: number }}
 */
export function projectToScreen(position, camera) {
  const v = position.clone().project(camera)
  return {
    x: (v.x + 1) / 2 * innerWidth,
    y: (-v.y + 1) / 2 * innerHeight,
  }
}

/**
 * Filters snap targets to visible ones, then removes far-background
 * candidates that are occluded by closer geometry.
 * @param {{ position: THREE.Vector3, type: string }[]} targets
 * @param {THREE.Camera} camera
 * @param {number} [maxDepthRatio=2.0]  Keep targets within this multiple of the
 *   nearest candidate's camera distance.
 * @returns {{ position: THREE.Vector3, type: string }[]}
 */
export function filterNearbySnapTargets(targets, camera, maxDepthRatio = 2.0) {
  const camPos = camera.position
  const camDir = new THREE.Vector3()
  camera.getWorldDirection(camDir)

  // Pass 1: visibility filter — exclude points beyond the far clip plane
  // or behind the camera (both map to v.z > 1 after project()).
  const visible = targets.filter(({ position }) => {
    const v = position.clone().project(camera)
    return v.z <= 1
  })

  if (visible.length === 0) return visible

  // Pass 2: depth filter — keep only candidates within maxDepthRatio of the
  // nearest candidate in 3D space.  This hides occluded or far-background
  // points that happen to overlap foreground geometry on screen.
  const dists   = visible.map(({ position }) => position.distanceTo(camPos))
  const minDist = Math.min(...dists)
  const depthFiltered = visible.filter((_, i) => dists[i] <= minDist * maxDepthRatio)

  // Pass 3: remove face snap candidates whose normal points away from the camera.
  // Back-facing face centers are rarely useful snap targets and create visual noise.
  return depthFiltered.filter(t => {
    if (t.type !== 'face' || !t.normal) return true
    return t.normal.dot(camDir) < 0   // normal toward camera = front-facing
  })
}

/**
 * Returns the snap candidate nearest to screen position (sx, sy) within
 * maxPx pixels, applying back-face culling for face targets.
 * Used to drive the hover-highlight indicator before the snap locks.
 * @param {{ position: THREE.Vector3, type: string, normal?: THREE.Vector3 }[]} targets
 * @param {number} sx  cursor x (pixels)
 * @param {number} sy  cursor y (pixels)
 * @param {THREE.Camera} camera
 * @param {number} [maxPx=60]
 * @returns {{ position: THREE.Vector3, type: string, normal?: THREE.Vector3 }|null}
 */
export function findNearestSnapCandidate(targets, sx, sy, camera, maxPx = 60) {
  const camMat = camera.matrixWorldInverse
  const camDir = new THREE.Vector3()
  camera.getWorldDirection(camDir)
  let bestDist   = maxPx
  let bestTarget = null
  for (const t of targets) {
    const cp = t.position.clone().applyMatrix4(camMat)
    if (cp.z >= 0) continue
    if (t.type === 'face' && t.normal && t.normal.dot(camDir) >= 0) continue
    const s = projectToScreen(t.position, camera)
    const d = Math.hypot(sx - s.x, sy - s.y)
    if (d < bestDist) { bestDist = d; bestTarget = t }
  }
  return bestTarget
}

/**
 * Returns the best snap target from `targets` near screen position (sx, sy).
 *
 * Front-facing face bonus: among face candidates within SNAP_PX, those
 * whose normal is most directly toward the camera receive a screen-distance
 * discount (up to FRONTNESS_BONUS_PX), so they beat a slightly-closer
 * grazing-angle face snap target.
 *
 * @param {{ position: THREE.Vector3, type: string, normal?: THREE.Vector3 }[]} targets
 * @param {number} sx  cursor screen x (pixels)
 * @param {number} sy  cursor screen y (pixels)
 * @param {THREE.Camera} camera
 * @returns {{ position: THREE.Vector3, type: string, normal?: THREE.Vector3 }|null}
 */
export function pickBestSnapTarget(targets, sx, sy, camera) {
  const SNAP_PX            = 25
  const FRONTNESS_BONUS_PX = 5   // max screen-px discount for a face directly facing camera
  const camMat = camera.matrixWorldInverse
  const camDir = new THREE.Vector3()
  camera.getWorldDirection(camDir)

  let bestScore  = SNAP_PX
  let bestTarget = null

  for (const t of targets) {
    // Skip targets behind the camera
    const camPos = t.position.clone().applyMatrix4(camMat)
    if (camPos.z >= 0) continue

    // Skip back-facing face snap points
    if (t.type === 'face' && t.normal && t.normal.dot(camDir) >= 0) continue

    const s = projectToScreen(t.position, camera)
    const d = Math.hypot(sx - s.x, sy - s.y)

    // Front-facing face candidates get a screen-distance discount
    const bonus = (t.type === 'face' && t.normal)
      ? Math.max(0, -t.normal.dot(camDir)) * FRONTNESS_BONUS_PX
      : 0
    const score = d - bonus
    if (score < bestScore) { bestScore = score; bestTarget = t }
  }
  return bestTarget
}
