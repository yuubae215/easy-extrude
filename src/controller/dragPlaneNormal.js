/**
 * dragPlaneNormal — the one place a free-drag plane is chosen (ADR-097 §Decision 5).
 *
 * There were three drag-plane implementations, and they disagreed:
 *
 *   - `GrabOperationHandler.start()`  — annotations got the host / world XY plane,
 *                                       everything else the camera-facing plane
 *   - `GrabOperationHandler.restartFromPivot()` — camera-facing, unconditionally
 *   - `AppController` quick drag      — camera-facing, unconditionally (no entity
 *                                       branch existed at all)
 *
 * The user's "the cube's Grab is really hard to move" came out of that last
 * pair: a grounded entity dragged on a camera-facing plane acquires Z from the
 * camera's orientation, and the stack assist then pulls that Z back — input and
 * result twist twice. Making the plane a function of the DECLARED PLACEMENT
 * instead of the entity's class removes the twist for every kind at once, and
 * the annotation special case becomes an instance of the general rule rather
 * than an exception to it (§1.1 — three implementations folded into one).
 *
 * The decision itself is the pure `dragPlaneNormalFor()` in
 * `src/domain/placement.js`; this module only gathers the facts it needs (the
 * mounts host's local Z, the camera direction) from the host environment.
 *
 * @see docs/adr/ADR-097-support-is-entity-state-not-gesture-side-effect.md
 */

import * as THREE from 'three'
import { placementOf, dragPlaneNormalFor } from '../domain/placement.js'

/**
 * The world-space normal of the plane a free drag of `entity` should slide on.
 *
 * @param {*} entity                       the entity being dragged (null → camera plane)
 * @param {object} deps
 * @param {import('three').Camera} deps.camera
 * @param {{ getMountsLink: (id: string) => {targetId: string}|null }} deps.scene
 * @param {{ worldPoseOf: (id: string) => {quaternion: import('three').Quaternion}|null }} deps.service
 * @returns {import('three').Vector3}
 */
export function resolveDragPlaneNormal(entity, { camera, scene, service }) {
  const camDir = new THREE.Vector3()
  camera.getWorldDirection(camDir)
  if (!entity) return camDir

  // ADR-032 §6 survives as a *fact* fed to the policy: a mounted entity slides on
  // its host's plane rather than on the world XY plane.
  let hostNormal = null
  const mountLink = scene.getMountsLink?.(entity.id)
  if (mountLink) {
    const hostPose = service.worldPoseOf(mountLink.targetId)
    if (hostPose) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(hostPose.quaternion)
      hostNormal = { x: n.x, y: n.y, z: n.z }
    }
  }

  const n = dragPlaneNormalFor({
    placement:    placementOf(entity),
    hostNormal,
    cameraNormal: { x: camDir.x, y: camDir.y, z: camDir.z },
  })
  return new THREE.Vector3(n.x, n.y, n.z)
}
