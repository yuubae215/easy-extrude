/**
 * UIStateManager — N-panel, mobile toolbar, and status bar updates.
 *
 * Reads AppController state via ctrl.* and pushes to ctrl._uiView.
 * No state ownership — all state lives on AppController.
 *
 * Owned by AppController as this._uiStateMgr.
 */

import * as THREE from 'three'
import { Solid }           from '../domain/Solid.js'
import { Profile }         from '../domain/Profile.js'
import { ImportedMesh }    from '../domain/ImportedMesh.js'
import { MeasureLine }     from '../domain/MeasureLine.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { AnnotatedLine }   from '../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../domain/AnnotatedPoint.js'
import { SpatialLink }     from '../domain/SpatialLink.js'
import { getCentroid }     from '../model/CuboidModel.js'
import { ICONS }           from '../view/UIView.js'
import { createDeleteSpatialLinkCommand }     from '../command/DeleteSpatialLinkCommand.js'
import { createCreateCoordinateFrameCommand } from '../command/CreateCoordinateFrameCommand.js'
import {
  S_GRAB_ACTIVE, S_ROTATE_ACTIVE,
  S_MEASURE_PLACING, S_FRAME_PLACEMENT,
} from '../core/editorStates.js'

export class UIStateManager {
  /** @param {import('./AppController.js').AppController} ctrl */
  constructor(ctrl) {
    this._ctrl = ctrl
  }

  updateNPanel() {
    const ctrl = this._ctrl
    if (!ctrl._uiView.nPanelVisible) return
    const obj = ctrl._activeObj
    if (!obj) return

    if (obj instanceof CoordinateFrame) {
      const frameUnreferenced = ctrl._service.getLinksOf(obj.id).length === 0
      if (obj.name === 'Origin') {
        const wp = ctrl._service.worldPoseOf(obj.id)?.position ?? obj.translation
        ctrl._uiView.updateNPanelForFrame(
          { x: wp.x, y: wp.y, z: wp.z },
          { x: 0, y: 0, z: 0 },
          obj.name,
          true, null, null, frameUnreferenced
        )
        return
      }
      const euler = new THREE.Euler().setFromQuaternion(obj.rotation, 'ZYX')
      const parentOptions = [...ctrl._scene.objects.values()]
        .filter(o => {
          if (o.id === obj.id) return false
          if (o instanceof MeasureLine || o instanceof ImportedMesh) return false
          if (ctrl._service._isDescendant(obj.id, o.id)) return false
          return true
        })
        .map(o => ({ id: o.id, name: o.name }))
      const childFrames = [...ctrl._scene.objects.values()]
        .filter(o => o instanceof CoordinateFrame && o.parentId === obj.id)
        .map(f => ({ id: f.id, name: f.name, unreferenced: ctrl._service.getLinksOf(f.id).length === 0 }))
      ctrl._uiView.updateNPanelForFrame(obj.translation, {
        x: THREE.MathUtils.radToDeg(euler.x),
        y: THREE.MathUtils.radToDeg(euler.y),
        z: THREE.MathUtils.radToDeg(euler.z),
      }, obj.name, false, parentOptions, obj.parentId, frameUnreferenced,
        childFrames,
        () => ctrl._promptAddFrame(obj.id),
        (fid) => ctrl._switchActiveObject(fid, true),
      )
      return
    }

    if (obj instanceof SpatialLink) {
      const src = ctrl._scene.getObject(obj.sourceId)
      const tgt = ctrl._scene.getObject(obj.targetId)
      const srcName = src?.name ?? obj.sourceId
      const tgtName = tgt?.name ?? obj.targetId
      ctrl._uiView.updateNPanelForSpatialLink(obj, srcName, tgtName, () => {
        const link = ctrl._scene.getLink(obj.id)
        if (!link) return
        ctrl._service.detachSpatialLink(obj.id)
        ctrl._commandStack.push(createDeleteSpatialLinkCommand(link, ctrl._service))
        ctrl._uiView.showToast('Link deleted')
        ctrl._updateNPanel()
      })
      return
    }

    if (obj instanceof Profile && obj.sketchRect) {
      const { p1, p2 } = obj.sketchRect
      const centroid = new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0)
      const dims = new THREE.Vector3(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y), 0)
      ctrl._uiView.updateNPanel(centroid, dims, obj.name, obj.description ?? '')
      return
    }

    const corners = ctrl._corners
    if (!corners.length) return
    const centroid = getCentroid(corners)
    const bMin = new THREE.Vector3(Infinity, Infinity, Infinity)
    const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    corners.forEach(c => { bMin.min(c); bMax.max(c) })
    const dims = new THREE.Vector3().subVectors(bMax, bMin)
    const locationEditable = typeof obj.move === 'function' && !(obj instanceof CoordinateFrame)
    const showIfcClass    = obj instanceof Solid || obj instanceof ImportedMesh
    const showPlaceType   = obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint
    const placeTypeGeometry = obj instanceof AnnotatedLine   ? 'line'
      : obj instanceof AnnotatedRegion ? 'region'
      : obj instanceof AnnotatedPoint  ? 'point'
      : null
    const spatialLinks    = ctrl._service.getLinksOf(obj.id)
    const onDeleteSpatialLink = (linkId) => {
      const link = ctrl._scene.getLink(linkId)
      if (!link) return
      ctrl._service.detachSpatialLink(linkId)
      ctrl._commandStack.push(createDeleteSpatialLinkCommand(link, ctrl._service))
      ctrl._uiView.showToast('Link deleted')
      ctrl._updateNPanel()
    }

    const showFrames = obj instanceof Solid || obj instanceof AnnotatedLine ||
      obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint
    let frames = null
    let onAddFrame = null
    let onSelectFrame = null
    if (showFrames) {
      frames = [...ctrl._scene.objects.values()]
        .filter(o => o instanceof CoordinateFrame && o.parentId === obj.id)
        .map(f => {
          const linksToFrame = ctrl._service.getLinksOf(f.id)
          return { id: f.id, name: f.name, unreferenced: linksToFrame.length === 0 }
        })
      onAddFrame = () => {
        const frame = ctrl._service.createCoordinateFrame(obj.id)
        if (!frame) return
        ctrl._commandStack.push(createCreateCoordinateFrameCommand(
          frame, ctrl._service,
          () => { ctrl._updateNPanel() },
          (id) => { ctrl._updateNPanel() },
        ))
        ctrl._uiView.showToast(`Frame "${frame.name}" added`)
        ctrl._updateNPanel()
      }
      onSelectFrame = (frameId) => {
        ctrl._switchActiveObject(frameId)
      }
    }

    ctrl._uiView.updateNPanel(centroid, dims, obj.name, obj.description ?? '', {
      locationEditable,
      showIfcClass,
      ifcClass: showIfcClass ? (obj.ifcClass ?? null) : undefined,
      showPlaceType,
      placeType:        showPlaceType ? (obj.placeType ?? null) : undefined,
      placeTypeGeometry,
      spatialLinks:        spatialLinks.length > 0 ? spatialLinks : null,
      currentEntityId:     obj.id,
      onDeleteSpatialLink,
      getEntityName:       (id) => ctrl._scene.getObject(id)?.name ?? id,
      frames,
      onAddFrame,
      onSelectFrame,
    })
  }

  refreshUndoRedoState() {
    const ctrl = this._ctrl
    ctrl._uiView.setUndoRedoEnabled(
      ctrl._commandStack.canUndo,
      ctrl._commandStack.canRedo,
    )
  }

  updateMobileToolbar() {
    const ctrl = this._ctrl
    this.refreshUndoRedoState()
    const mode     = ctrl._scene.selectionMode
    const substate = ctrl._scene.editSubstate

    if (ctrl._mapModeCtrl.isActive) {
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.back, label: 'Exit Map', onClick: () => ctrl._mapModeCtrl.exit() },
        { spacer: true },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (ctrl._opState.is(S_MEASURE_PLACING)) {
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.cancel, label: 'Cancel', onClick: () => ctrl._measureHandler.cancel(), danger: true },
        { spacer: true },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (ctrl._opState.is(S_FRAME_PLACEMENT)) {
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.cancel, label: 'Cancel', onClick: () => ctrl._framePlacementHandler.cancel(), danger: true },
        { spacer: true },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (ctrl._opState.is(S_ROTATE_ACTIVE)) {
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => ctrl._rotateHandler.cancel(), danger: true },
        { icon: 'X', label: 'X', onClick: () => ctrl._rotateHandler.setAxis('x'), active: ctrl._rotateHandler.axis === 'x' },
        { icon: 'Y', label: 'Y', onClick: () => ctrl._rotateHandler.setAxis('y'), active: ctrl._rotateHandler.axis === 'y' },
        { icon: 'Z', label: 'Z', onClick: () => ctrl._rotateHandler.setAxis('z'), active: ctrl._rotateHandler.axis === 'z' },
        { icon: ICONS.confirm, label: 'Confirm', onClick: () => ctrl._rotateHandler.confirm() },
      ])
      return
    }

    if (ctrl._opState.is(S_GRAB_ACTIVE)) {
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => ctrl._grabHandler.cancel(), danger: true },
        { icon: 'X', label: 'X', onClick: () => ctrl._grabHandler.setAxis('x'), active: ctrl._grabHandler.axis === 'x' },
        { icon: 'Y', label: 'Y', onClick: () => ctrl._grabHandler.setAxis('y'), active: ctrl._grabHandler.axis === 'y' },
        { icon: 'Z', label: 'Z', onClick: () => ctrl._grabHandler.setAxis('z'), active: ctrl._grabHandler.axis === 'z' },
        { icon: ICONS.confirm, label: 'Confirm', onClick: () => ctrl._grabHandler.confirm() },
      ])
      return
    }

    if (mode === 'object') {
      const hasObj = ctrl._objSelected

      if (hasObj && ctrl._activeObj instanceof CoordinateFrame) {
        const isOriginCF = ctrl._activeObj.name === 'Origin'
        ctrl._uiView.setMobileToolbar([
          { icon: ICONS.frame,  label: 'Add Frame', onClick: () => ctrl._promptAddFrame(ctrl._scene.activeId) },
          { icon: ICONS.grab,   label: 'Move',      onClick: () => ctrl._grabHandler.start(),                                              disabled: isOriginCF },
          { spacer: true },
          { icon: ICONS.delete, label: 'Delete',    onClick: () => ctrl._deleteObject(ctrl._scene.activeId), danger: !isOriginCF, disabled: isOriginCF },
          { icon: ICONS.rotate, label: 'Rotate',    onClick: () => ctrl._rotateHandler.start(true),                                              disabled: isOriginCF },
        ])
        return
      }

      const _isAnnotated = o => o instanceof AnnotatedLine || o instanceof AnnotatedRegion || o instanceof AnnotatedPoint
      const _isSpatialLink = o => o instanceof SpatialLink
      if (hasObj && _isSpatialLink(ctrl._activeObj)) {
        ctrl._uiView.setMobileToolbar([
          { spacer: true }, { spacer: true },
          { icon: ICONS.delete, label: 'Delete', onClick: () => ctrl._deleteObject(ctrl._scene.activeId), danger: true },
          { spacer: true }, { spacer: true },
        ])
        return
      }
      if (hasObj && _isAnnotated(ctrl._activeObj)) {
        ctrl._uiView.setMobileToolbar([
          { icon: ICONS.grab,   label: 'Grab',   onClick: () => ctrl._grabHandler.start() },
          { icon: ICONS.map,    label: 'Map',    onClick: () => ctrl._mapModeCtrl.enter() },
          { icon: ICONS.delete, label: 'Delete', onClick: () => ctrl._deleteObject(ctrl._scene.activeId), danger: true },
          { spacer: true },
        ])
        return
      }

      const canGrab   = hasObj && !(ctrl._activeObj instanceof ImportedMesh)
      const canEdit   = hasObj && !(ctrl._activeObj instanceof ImportedMesh) && !(ctrl._activeObj instanceof CoordinateFrame) && !_isAnnotated(ctrl._activeObj) && !_isSpatialLink(ctrl._activeObj)
      const canStack  = hasObj && !(ctrl._activeObj instanceof ImportedMesh) && !(ctrl._activeObj instanceof MeasureLine)
        && !_isAnnotated(ctrl._activeObj)
        && !_isSpatialLink(ctrl._activeObj)
      const canRotate = hasObj && ctrl._activeObj instanceof Solid
      ctrl._uiView.setMobileToolbar([
        {
          icon: ICONS.add, label: 'Add',
          onClick: () => {
            const canAddFrame = ctrl._objSelected && !(ctrl._activeObj instanceof MeasureLine) && !(ctrl._activeObj instanceof ImportedMesh)
            ctrl._uiView.showAddMenu(
              window.innerWidth / 2, window.innerHeight / 2,
              () => ctrl._addObject('box'),
              () => ctrl._addObject('sketch'),
              () => ctrl._addObject('measure'),
              () => ctrl._triggerStepImport(),
              canAddFrame ? () => ctrl._addObject('frame') : undefined,
            )
          },
        },
        { icon: ICONS.grab,      label: 'Grab',   onClick: () => ctrl._grabHandler.start(),                                        disabled: !canGrab },
        { icon: ICONS.edit,      label: 'Edit',   onClick: () => ctrl.setMode('edit'),                                             disabled: !canEdit },
        { icon: ICONS.delete,    label: 'Delete', onClick: () => ctrl._deleteObject(ctrl._scene.activeId), danger: hasObj,         disabled: !hasObj },
        canRotate
          ? { icon: ICONS.rotate, label: 'Rotate', onClick: () => ctrl._rotateHandler.start(true) }
          : { icon: ICONS.stack,  label: 'Stack',  onClick: () => { ctrl._grabHandler.toggleStackMode(); this.updateMobileToolbar() }, active: ctrl._grabHandler.stackMode, disabled: !canStack },
      ])
      return
    }

    if (substate === '2d-sketch') {
      const hasRect = ctrl._sketch.p1 && ctrl._sketch.p2 &&
        (Math.abs(ctrl._sketch.p2.x - ctrl._sketch.p1.x) > 0.01 ||
         Math.abs(ctrl._sketch.p2.y - ctrl._sketch.p1.y) > 0.01)
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.back,    label: 'Object',  onClick: () => ctrl.setMode('object') },
        { spacer: true },
        { spacer: true },
        { icon: ICONS.extrude, label: 'Extrude', onClick: () => ctrl._enterExtrudePhase(), disabled: !hasRect },
      ])
      return
    }

    if (substate === '2d-extrude') {
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => ctrl._cancelExtrudePhase(), danger: true },
        { spacer: true },
        { spacer: true },
        { icon: ICONS.confirm, label: 'Confirm', onClick: () => ctrl._confirmExtrudePhase() },
      ])
      return
    }

    if (substate === '3d') {
      const em = ctrl._editSelectMode
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.back,   label: 'Object', onClick: () => ctrl.setMode('object') },
        { icon: ICONS.vertex, label: 'Vertex', onClick: () => ctrl._editSelHandler.setEditSelectMode('vertex'), active: em === 'vertex' },
        { icon: ICONS.edge,   label: 'Edge',   onClick: () => ctrl._editSelHandler.setEditSelectMode('edge'),   active: em === 'edge' },
        { icon: ICONS.face,   label: 'Face',   onClick: () => ctrl._editSelHandler.setEditSelectMode('face'),   active: em === 'face' },
      ])
    }

    if (substate === '1d') {
      ctrl._uiView.setMobileToolbar([
        { icon: ICONS.back, label: 'Object', onClick: () => ctrl.setMode('object') },
        { spacer: true },
        { spacer: true },
        { spacer: true },
      ])
    }
  }

  refreshObjectModeStatus() {
    const ctrl = this._ctrl
    if (!ctrl._objSelected || !ctrl._activeObj) {
      ctrl._uiView.setStatus('')
      return
    }
    const isReadOnly = ctrl._activeObj instanceof ImportedMesh
    const parts = [
      { text: ctrl._activeObj.name, bold: true, color: '#e8e8e8' },
      { text: 'selected', color: '#888' },
    ]
    if (isReadOnly) {
      parts.push({ text: 'read-only', color: '#ff9800' })
    }
    ctrl._uiView.setStatusRich(parts)
    ctrl._uiView.appendInfoHint(
      ctrl._activeObj instanceof CoordinateFrame ? 'R' : null,
      'Rotate',
    )
  }

  refreshEditMode1DStatus() {
    const ctrl = this._ctrl
    ctrl._uiView.setStatusRich([
      { text: 'Edit Mode · 1D', bold: true, color: '#e8e8e8' },
      { text: 'Drag an endpoint to reposition', color: '#555' },
    ])
  }

  updateExtrudePhaseStatus() {
    const ctrl = this._ctrl
    const parsed = parseFloat(ctrl._extrudePhase.inputStr)
    const height = ctrl._extrudePhase.hasInput
      ? (isNaN(parsed) ? 0 : parsed)
      : ctrl._extrudePhase.height
    const parts = [{ text: 'Extrude', bold: true, color: '#ffffff' }]
    if (ctrl._extrudePhase.hasInput) {
      parts.push({ text: ctrl._extrudePhase.inputStr + '_', color: '#ffeb3b' })
    } else {
      parts.push({ text: `H: ${height.toFixed(3)}`, color: '#ffeb3b' })
    }
    ctrl._uiView.setStatusRich(parts)
  }
}
