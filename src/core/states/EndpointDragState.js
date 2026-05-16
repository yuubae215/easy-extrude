/**
 * Edit Mode operation handler for 1D endpoint drag (MeasureLine Edit Mode).
 *
 * Owns all mutable drag state (dragPlane, startCorners, endpointIndex).
 * Lifecycle matches the three-phase contract from ADR-039:
 *
 *   enter()       — pointerdown on an endpoint; sets up drag plane, snapshots corners
 *   onPointerMove — pointermove; intersects drag plane; delegates mutation to
 *                   SceneService.applyPreviewEndpointMove (Preview Pipeline)
 *   confirm()     — pointerup; pushes MoveCommand if endpoint actually moved
 *   cancel()      — mode exit / Escape; restores original corner positions via service
 *
 * Called by AppController when _editOpState is EO_1D_DRAG.
 * Context object (ctx) contains the minimal AppController state needed,
 * including sceneService for Preview Pipeline delegation.
 */
import * as THREE from 'three'
import { createMoveCommand } from '../../command/MoveCommand.js'
import { MeasureLine }       from '../../domain/MeasureLine.js'

export class EndpointDragState {
  constructor() {
    this._endpointIndex = null
    this._startCorners  = null
    this._dragPlane     = new THREE.Plane()
  }

  /**
   * @param {{ obj, camera, raycaster, controls, sceneService }} ctx
   * @param {import('../../graph/Vertex.js').Vertex} vertex  The hovered endpoint vertex
   * @param {number} endpointIndex  0 or 1
   */
  enter(ctx, vertex, endpointIndex) {
    const { obj, camera, controls } = ctx
    this._endpointIndex = endpointIndex
    this._startCorners  = obj.corners.map(c => c.clone())

    const camDir = new THREE.Vector3()
    camera.getWorldDirection(camDir)
    this._dragPlane.setFromNormalAndCoplanarPoint(camDir, vertex.position)

    controls.enabled = false
  }

  /**
   * Computes the ray-plane intersection and delegates the vertex mutation to
   * SceneService.applyPreviewEndpointMove (Preview Pipeline — no direct entity
   * mutation in the handler).
   * @param {{ obj, camera, mouse, raycaster, sceneService }} ctx
   */
  onPointerMove(ctx) {
    const { obj, camera, mouse, raycaster, sceneService } = ctx
    if (!obj) return
    raycaster.setFromCamera(mouse, camera)
    const pt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(this._dragPlane, pt)) {
      sceneService.applyPreviewEndpointMove(obj, this._endpointIndex, pt)
    }
  }

  /**
   * Completes the drag: pushes MoveCommand if the endpoint moved.
   * @param {{ obj, controls, commandStack, scene }} ctx
   */
  confirm(ctx) {
    const { obj, controls, commandStack, scene } = ctx
    controls.enabled = true
    if (!obj || !this._startCorners) return
    const endCorners = obj.corners.map(c => c.clone())
    const moved = this._startCorners.some(
      (sc, i) => sc.distanceToSquared(endCorners[i]) > 1e-10,
    )
    if (moved) {
      const startMap = new Map([[obj.id, this._startCorners]])
      const endMap   = new Map([[obj.id, endCorners]])
      commandStack.push(createMoveCommand('Move Endpoint', startMap, endMap, scene))
    }
    this._endpointIndex = null
    this._startCorners  = null
  }

  /**
   * Cancels the drag: restores both endpoints via SceneService to keep view in sync.
   * @param {{ obj, controls, sceneService }} ctx
   */
  cancel(ctx) {
    const { obj, controls, sceneService } = ctx
    controls.enabled = true
    if (obj instanceof MeasureLine && this._startCorners) {
      sceneService.applyPreviewEndpointMove(obj, 0, this._startCorners[0])
      sceneService.applyPreviewEndpointMove(obj, 1, this._startCorners[1])
    }
    this._endpointIndex = null
    this._startCorners  = null
  }
}
