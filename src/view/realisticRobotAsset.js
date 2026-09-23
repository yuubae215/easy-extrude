// @ts-nocheck
/**
 * realisticRobotAsset (view) — the ONE load of Universal Robots' visual meshes
 * shared by every `RobotStage` (ADR-150 D1).
 *
 * Before this module each stage fetched and parsed its own ~9 MB copy inside
 * `RobotStage._loadRealisticRobot`, so every spawned arm was drawn as the
 * skeleton for the second the load took and then swapped — the flash the
 * dogfooder reported. Now:
 *
 *   - the parsed robot is a TEMPLATE loaded once (`createSharedAsset` — the
 *     pure memoiser in `domain/robotVisualStyle.js`, where `node --test` can
 *     ask "N requests, 1 fetch");
 *   - each stage gets `template.clone()` — its own joints (URDFRobot.copy
 *     rebuilds the joint map) over SHARED geometry, flagged
 *     `userData.sharedGeometry` so `RobotStage._disposeTree` releases the
 *     stage's materials but never the geometry other arms are drawing (原則 #9:
 *     the template's geometry lives as long as this module's cache);
 *   - `prefetchRealisticRobot()` starts the load at boot, so by the time a
 *     user spawns an arm the asset is usually already `ready`.
 *
 * BROWSER-ONLY MODULE (fetch + URDFLoader's DOMParser) — imported only by
 * `RobotStage.js` / `RobotStageSet.js`, never by a `node --test` file.
 */
import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import { createSharedAsset } from '../domain/robotVisualStyle.js'
import {
  realisticPackages, realisticUrdfUrl, REALISTIC_BASE_YAW_CORRECTION,
} from './robotVisualStyle.js'

async function loadTemplate() {
  const manager = new THREE.LoadingManager()
  const loaded = new Promise((resolve, reject) => {
    manager.onLoad = resolve
    manager.onError = (url) => reject(new Error(`realisticRobotAsset: failed to load "${url}"`))
  })
  const loader = new URDFLoader(manager)
  loader.packages = realisticPackages()
  const text = await fetch(realisticUrdfUrl()).then(r => {
    if (!r.ok) throw new Error(`realisticRobotAsset: failed to fetch realistic URDF (${r.status})`)
    return r.text()
  })
  const robot = loader.parse(text)
  // Cancel the official URDF's own base_link → base_link_inertia yaw
  // (REALISTIC_BASE_YAW_CORRECTION) so this root ends up in the SAME frame
  // convention as skeleton_arm.urdf's — and therefore the TCP marker
  // (derived solely from the skeleton) still lands on the drawn flange.
  robot.rotation.z = REALISTIC_BASE_YAW_CORRECTION
  await loaded   // wait for every referenced mesh, not just the URDF text
  return robot
}

const asset = createSharedAsset(loadTemplate)

/** Start the shared load without waiting for it. Failures surface on the next `instantiate`. */
export function prefetchRealisticRobot() {
  asset.request().catch(() => { /* reported by the stage that asks for it (原則 #11) */ })
}

/**
 * A stage-private copy of the realistic robot: own joints, shared geometry.
 * @returns {Promise<import('three').Object3D>}
 */
export async function instantiateRealisticRobot() {
  const template = await asset.request()
  const robot = template.clone()
  robot.userData.sharedGeometry = true
  return robot
}

/** Where the shared asset is in its lifecycle (read-only; e2e / diagnostics). */
export function realisticAssetState() { return asset.state }
