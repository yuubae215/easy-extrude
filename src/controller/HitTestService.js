/**
 * HitTestService — centralises all raycasting and hit-detection for AppController.
 *
 * Uses ctrl as a back-reference to access shared scene state (raycaster, mouse,
 * camera, active object, service) without duplicating ownership of those resources.
 *
 * Owned by AppController as this._hitTest.
 */

import * as THREE from 'three'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { MeasureLine }     from '../domain/MeasureLine.js'
import { AnnotatedLine }   from '../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../domain/AnnotatedPoint.js'
import { toNDC }           from '../model/CuboidModel.js'
import { ROBOT_BASE_FRAME_NAME } from '../domain/robotFrames.js'

export class HitTestService {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl
  }

  /** Updates the shared NDC mouse vector from a pointer event. */
  updateMouse(e) {
    const v = toNDC(e.clientX, e.clientY, innerWidth, innerHeight)
    this._ctrl._mouse.copy(v)
  }

  /** Hits any visible object — returns { hit, obj } or null */
  hitAnyObject() {
    const { _ctrl: ctrl } = this
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const meshes = [...ctrl._scene.objects.values()]
      .filter(o => !(o instanceof MeasureLine) && !(o instanceof AnnotatedLine) && !(o instanceof AnnotatedRegion) && !(o instanceof AnnotatedPoint) && o.meshView.cuboid?.visible)
      .map(o => o.meshView.cuboid)
    const hits = ctrl._raycaster.intersectObjects(meshes)
    if (!hits.length) return null
    const hitMesh = hits[0].object
    const obj = [...ctrl._scene.objects.values()].find(o => o.meshView.cuboid === hitMesh)
    return obj ? { hit: hits[0], obj } : null
  }

  /**
   * Hits any visible annotation entity (AnnotatedLine/Region/Point) using a
   * bounding-box raycast. Called as a fallback when hitAnyObject() misses.
   * @returns {{ obj: object }|null}
   */
  hitAnyAnnotation() {
    const { _ctrl: ctrl } = this
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const ray = ctrl._raycaster.ray
    const pt  = new THREE.Vector3()

    let nearestDist = Infinity
    let nearestObj  = null

    for (const obj of ctrl._scene.objects.values()) {
      if (!(obj instanceof AnnotatedLine) && !(obj instanceof AnnotatedRegion) && !(obj instanceof AnnotatedPoint)) continue
      if (!obj.meshView?.visible) continue

      const corners = obj.corners
      if (!corners.length) continue

      const box = new THREE.Box3()
      for (const c of corners) box.expandByPoint(c)
      box.expandByScalar(0.3)

      const hitPt = ray.intersectBox(box, pt)
      if (hitPt) {
        const dist = ray.origin.distanceTo(hitPt)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestObj  = obj
        }
      }
    }

    return nearestObj ? { obj: nearestObj } : null
  }

  /**
   * Hits any visible CoordinateFrame by raycasting against its axis meshes and
   * origin sphere, with a bounding-box fallback to enlarge the tap area on mobile.
   * Called FIRST in _onPointerDown before cuboid hit-testing (PHILOSOPHY #22).
   * @returns {{ obj: object }|null}
   */
  hitAnyCoordinateFrame() {
    const { _ctrl: ctrl } = this
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const ray = ctrl._raycaster.ray
    const pt  = new THREE.Vector3()
    let nearestDist = Infinity
    let nearestObj  = null

    for (const obj of ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) continue
      if (!obj.meshView?.group?.visible) continue

      const hits = ctrl._raycaster.intersectObject(obj.meshView.group, true)
      if (hits.length > 0 && hits[0].distance < nearestDist) {
        nearestDist = hits[0].distance
        nearestObj  = obj
        continue
      }

      const wp = ctrl._service.worldPoseOf(obj.id)?.position
      if (wp) {
        const box = new THREE.Box3(wp.clone().subScalar(0.4), wp.clone().addScalar(0.4))
        const hitPt = ray.intersectBox(box, pt)
        if (hitPt) {
          const dist = ray.origin.distanceTo(hitPt)
          if (dist < nearestDist) { nearestDist = dist; nearestObj = obj }
        }
      }
    }

    return nearestObj ? { obj: nearestObj } : null
  }

  /**
   * Returns true if `cf` is a descendant of the entity with `ancestorId`.
   * Used to implement PHILOSOPHY #22: CF beats its own parent Solid, but must NOT
   * block selection of an unrelated Solid that overlaps the CF's bounding-box.
   * @param {CoordinateFrame} cf
   * @param {string} ancestorId
   * @returns {boolean}
   */
  isCfDescendantOf(cf, ancestorId) {
    let obj = cf
    while (obj instanceof CoordinateFrame) {
      if (obj.parentId === ancestorId) return true
      obj = this._ctrl._scene.getObject(obj.parentId)
    }
    return false
  }

  /**
   * Hits the visible robot skeleton (RobotStage) and resolves it to its
   * `robot_base` CoordinateFrame proxy — the entity that drives the skeleton's
   * pose (ADR-084 §2). The skeleton itself is a view-only decoration absent from
   * `scene.objects`, so without this a click on the arm/body selects nothing.
   * Used as a LOW-priority fallback in _onPointerDown (after CF / Solid /
   * annotation), so the base gizmo and any overlapping entity still win
   * (PHILOSOPHY #22 — the large skeleton volume must not shadow smaller targets).
   * @returns {{ obj: object }|null}
   */
  hitRobotStage() {
    const { _ctrl: ctrl } = this
    const stage = ctrl._sceneView?.robotStage
    if (!stage?.raycast) return null
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    if (!stage.raycast(ctrl._raycaster)) return null
    for (const o of ctrl._scene.objects.values()) {
      if (o instanceof CoordinateFrame && o.name === ROBOT_BASE_FRAME_NAME && o.parentId === null) {
        return { obj: o }
      }
    }
    return null
  }

  /** Hits only the active object's mesh. */
  hitActiveSolid() {
    const { _ctrl: ctrl } = this
    if (!ctrl._activeObj) return null
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const hits = ctrl._raycaster.intersectObject(ctrl._activeObj.meshView.cuboid)
    return hits.length ? hits[0] : null
  }

  /** Returns the hit face on the active solid, or null. */
  hitFace() {
    const hit = this.hitActiveSolid()
    if (!hit) return null
    const fi   = Math.floor(hit.face.a / 4)
    const face = this._ctrl._activeObj?.faces?.[fi] ?? null
    return face ? { face, point: hit.point } : null
  }

  /**
   * Multi-step hit test for link-creation target picking.
   * Step 0: CoordinateFrame (PHILOSOPHY #22 — CF priority over parent Solid).
   * Step 1: Cuboid-based raycast.
   * Step 2: Bounding-box fallback for non-cuboid entities.
   * Excludes the current spatial-link source entity from all steps.
   * @returns {{ obj: object }|null}
   */
  hitAnyEntityForLink() {
    const { _ctrl: ctrl } = this
    const sourceId = ctrl._spatialLinkMode.sourceId

    const cfHit = this.hitAnyCoordinateFrame()
    if (cfHit && cfHit.obj.id !== sourceId) return cfHit

    const cuboidHit = this.hitAnyObject()
    if (cuboidHit && cuboidHit.obj.id !== sourceId) return cuboidHit

    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const ray = ctrl._raycaster.ray
    const pt  = new THREE.Vector3()

    let nearestDist = Infinity
    let nearestObj  = null

    for (const obj of ctrl._scene.objects.values()) {
      if (obj.id === sourceId) continue
      if (obj.meshView?.cuboid?.visible) continue

      let box = null

      if (obj instanceof CoordinateFrame) {
        const wp = ctrl._service.worldPoseOf(obj.id)?.position
        if (wp) {
          box = new THREE.Box3(
            wp.clone().subScalar(0.4),
            wp.clone().addScalar(0.4),
          )
        }
      } else if (obj.corners && obj.corners.length > 0) {
        box = new THREE.Box3()
        for (const c of obj.corners) box.expandByPoint(c)
        box.expandByScalar(0.4)
      }

      if (!box) continue

      const hitPt = ray.intersectBox(box, pt)
      if (hitPt) {
        const dist = ray.origin.distanceTo(hitPt)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestObj  = obj
        }
      }
    }

    return nearestObj ? { obj: nearestObj } : null
  }
}
