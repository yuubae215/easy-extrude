/**
 * SceneExporter — produce a human-readable JSON snapshot of the current scene.
 *
 * Pure computation: no I/O, no DOM, no Three.js scene mutations.
 *
 * Export format (v1.0):
 * {
 *   version: "1.0",
 *   coordinateSystem: "ROS REP-103 (+X forward, +Y left, +Z up)",
 *   exportedAt: <ISO timestamp>,
 *   objects: SceneExportObject[]
 * }
 *
 * SceneExportObject discriminated union by `type`:
 *  - "Solid"           — cuboid geometry (8 vertices, 6 faces, bounding box)
 *  - "Profile"         — 2-D sketch rect (p1/p2 + bounding box)
 *  - "MeasureLine"     — two endpoints + computed distance
 *  - "CoordinateFrame" — SE(3) frame relative to parent; world pose included when cached
 *  - "ImportedMesh"    — server-computed mesh; AABB from synthetic corners + offset + base64 geometry buffers
 *
 * Every solid/profile/importedMesh entry also includes an `attachedFrames` array
 * listing all CoordinateFrame children with their world poses.
 */

import * as THREE from 'three'
import { Solid }           from '../domain/Solid.js'
import { Profile }         from '../domain/Profile.js'
import { MeasureLine }     from '../domain/MeasureLine.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { ImportedMesh }    from '../domain/ImportedMesh.js'
import { FACES, computeOutwardFaceNormal, getCentroid } from '../model/CuboidModel.js'
import { f32ToBase64, u32ToBase64 } from './SceneSerializer.js'

// ── Internal helpers ──────────────────────────────────────────────────────────

/** @param {THREE.Vector3} v @returns {{x:number,y:number,z:number}} */
function vec3(v) {
  return { x: round(v.x), y: round(v.y), z: round(v.z) }
}

/** @param {THREE.Quaternion} q @returns {{x:number,y:number,z:number,w:number}} */
function quat(q) {
  return { x: round(q.x), y: round(q.y), z: round(q.z), w: round(q.w) }
}

/** Round to 6 significant decimal places to avoid floating-point noise. */
function round(n) { return Math.round(n * 1e6) / 1e6 }

/**
 * Convert a quaternion to Euler ZYX angles (ROS RPY convention) in degrees.
 * ZYX order matches Blender / ROS REP-103: roll=X, pitch=Y, yaw=Z.
 * @param {THREE.Quaternion} q
 * @returns {{ roll: number, pitch: number, yaw: number }}
 */
function eulerZYX(q) {
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX')
  const deg = THREE.MathUtils.radToDeg
  return {
    roll:  round(deg(e.x)),
    pitch: round(deg(e.y)),
    yaw:   round(deg(e.z)),
  }
}

/**
 * Compute axis-aligned bounding box from an array of THREE.Vector3 positions.
 * @param {THREE.Vector3[]} positions
 * @returns {{ min: object, max: object, size: object, center: object }}
 */
function boundingBox(positions) {
  if (positions.length === 0) return null
  const box = new THREE.Box3().setFromPoints(positions)
  const size   = new THREE.Vector3(); box.getSize(size)
  const center = new THREE.Vector3(); box.getCenter(center)
  return {
    min:    vec3(box.min),
    max:    vec3(box.max),
    size:   vec3(size),
    center: vec3(center),
  }
}

/**
 * Build the `attachedFrames` list for a given parent object id.
 * Includes translation, rotation, euler angles, and world pose if available.
 *
 * @param {string} parentId
 * @param {import('../model/SceneModel.js').SceneModel} scene
 * @param {(id: string) => {position: THREE.Vector3, quaternion: THREE.Quaternion}|null} worldPoseOf
 * @returns {object[]}
 */
function attachedFrames(parentId, scene, worldPoseOf) {
  return [...scene.objects.values()]
    .filter(o => o instanceof CoordinateFrame && o.parentId === parentId)
    .map(frame => {
      const wp = worldPoseOf(frame.id)
      const entry = {
        id:       frame.id,
        name:     frame.name,
        translation: vec3(frame.translation),
        rotation:    quat(frame.rotation),
        eulerZYX_deg: eulerZYX(frame.rotation),
      }
      if (wp) {
        entry.worldPosition = vec3(wp.position)
        entry.worldRotation = quat(wp.quaternion)
        entry.worldEulerZYX_deg = eulerZYX(wp.quaternion)
      }
      return entry
    })
}

// ── Main export function ──────────────────────────────────────────────────────

/**
 * Serialize the current scene into a structured JSON-ready object.
 *
 * @param {import('../model/SceneModel.js').SceneModel} scene
 * @param {(id: string) => {position: THREE.Vector3, quaternion: THREE.Quaternion}|null} worldPoseOf
 *   Callback that returns the cached world pose for a CoordinateFrame id.
 *   Pass `(id) => sceneService.worldPoseOf(id)` from AppController.
 * @returns {object} Plain JSON-serializable object.
 */
export function exportScene(scene, worldPoseOf) {
  const objects = []

  for (const obj of scene.objects.values()) {
    // ── CoordinateFrame: emitted standalone (also listed under parent) ──────
    if (obj instanceof CoordinateFrame) {
      const wp = worldPoseOf(obj.id)
      const entry = {
        type:     'CoordinateFrame',
        id:       obj.id,
        name:     obj.name,
        parentId: obj.parentId,
        translation:  vec3(obj.translation),
        rotation:     quat(obj.rotation),
        eulerZYX_deg: eulerZYX(obj.rotation),
      }
      if (wp) {
        entry.worldPosition    = vec3(wp.position)
        entry.worldRotation    = quat(wp.quaternion)
        entry.worldEulerZYX_deg = eulerZYX(wp.quaternion)
      }
      objects.push(entry)
      continue
    }

    // ── MeasureLine ──────────────────────────────────────────────────────────
    if (obj instanceof MeasureLine) {
      objects.push({
        type:     'MeasureLine',
        id:       obj.id,
        name:     obj.name,
        p1:       vec3(obj.p1),
        p2:       vec3(obj.p2),
        distance: round(obj.distance),
      })
      continue
    }

    // ── Solid (cuboid) ───────────────────────────────────────────────────────
    if (obj instanceof Solid) {
      const corners = obj.corners          // THREE.Vector3[]
      const centroid = getCentroid(corners)

      const faces = FACES.map((faceDef, fi) => {
        const normal = computeOutwardFaceNormal(corners, fi)
        const faceCenter = faceDef.corners
          .reduce((acc, ci) => acc.clone().add(corners[ci]), new THREE.Vector3())
          .divideScalar(faceDef.corners.length)
        return {
          index:  fi,
          name:   faceDef.name,
          normal: vec3(normal),
          center: vec3(faceCenter),
        }
      })

      objects.push({
        type:        'Solid',
        id:          obj.id,
        name:        obj.name,
        description: obj.description ?? '',
        boundingBox: boundingBox(corners),
        centroid:    vec3(centroid),
        vertices:    obj.vertices.map(v => ({
          id: v.id,
          x: round(v.position.x),
          y: round(v.position.y),
          z: round(v.position.z),
        })),
        faces,
        attachedFrames: attachedFrames(obj.id, scene, worldPoseOf),
      })
      continue
    }

    // ── Profile (2-D sketch) ─────────────────────────────────────────────────
    if (obj instanceof Profile) {
      const sr = obj.sketchRect
      const corners = obj.corners
      const entry = {
        type:        'Profile',
        id:          obj.id,
        name:        obj.name,
        description: obj.description ?? '',
        sketchRect:  sr ? {
          p1: vec3(sr.p1),
          p2: vec3(sr.p2),
        } : null,
        boundingBox: corners.length ? boundingBox(corners) : null,
        attachedFrames: attachedFrames(obj.id, scene, worldPoseOf),
      }
      objects.push(entry)
      continue
    }

    // ── ImportedMesh ─────────────────────────────────────────────────────────
    if (obj instanceof ImportedMesh) {
      const corners = obj.corners          // synthetic AABB corners (8×)
      const bufs    = obj.meshView?.getGeometryBuffers?.()
      const entry = {
        type:        'ImportedMesh',
        id:          obj.id,
        name:        obj.name,
        boundingBox: corners.length ? boundingBox(corners) : null,
        attachedFrames: attachedFrames(obj.id, scene, worldPoseOf),
      }
      if (bufs?.offset) entry.offset = bufs.offset
      if (bufs?.positions) {
        entry.geometry = {
          positions: f32ToBase64(bufs.positions),
          normals:   bufs.normals ? f32ToBase64(bufs.normals) : null,
          indices:   bufs.indices ? u32ToBase64(bufs.indices) : null,
        }
      }
      objects.push(entry)
      continue
    }
  }

  return {
    version:          '1.1',
    coordinateSystem: 'ROS REP-103 (+X forward, +Y left, +Z up)',
    exportedAt:       new Date().toISOString(),
    objects,
  }
}

/**
 * Trigger a browser file-download of the scene JSON.
 * Side-effectful; must only be called from the Controller layer.
 *
 * @param {import('../model/SceneModel.js').SceneModel} scene
 * @param {(id: string) => object|null} worldPoseOf
 * @param {string} [filename]
 */
export function downloadSceneJson(scene, worldPoseOf, filename = 'scene.json') {
  const payload = exportScene(scene, worldPoseOf)
  const json    = JSON.stringify(payload, null, 2)
  const blob    = new Blob([json], { type: 'application/json' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href        = url
  a.download    = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
